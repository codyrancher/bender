// Service worker — three responsibilities:
//   1. Reply to `get-github-cookies` with the host's github.com cookies
//      (used by the existing cookie-bridge → /api/browser/sync-cookies path).
//   2. Long-poll the harness at /api/browser/agent/poll. When the harness
//      hands us a github.com fetch job, execute it in this SW context (so
//      cookies + cached HTTP basic auth + CSRF flow naturally) and POST
//      the response back to /api/browser/agent/respond. Project containers
//      drive the proxy via /api/github/proxy on the harness side.
//   3. Push a snapshot of github cookies to /api/browser/cookie-snapshot
//      whenever they change. The harness re-injects the snapshot into any
//      newly-started browser sidecar so projects come up auto-logged-in
//      to github (no manual sync click needed).
//
// We use long-polling instead of a WebSocket because Chrome service
// workers do NOT inherit cached HTTP basic-auth credentials for WebSocket
// upgrades — only for fetch() requests. Important when the harness is
// hosted behind nginx with basic auth (e.g. code.ourhome.dev).

const ALLOWED_HOSTS = [
  /(^|\.)github\.com$/i,
  /(^|\.)githubusercontent\.com$/i,
];

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return ALLOWED_HOSTS.some(re => re.test(u.hostname));
  } catch {
    return false;
  }
}

// --- 1. cookie reader for sidecar sync ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'get-github-cookies') {
    chrome.cookies.getAll({ domain: '.github.com' }, (cookies) => {
      chrome.cookies.getAll({ domain: 'github.com' }, (exact) => {
        const seen = new Set();
        const all = [];
        for (const c of cookies.concat(exact)) {
          const key = c.name + '|' + c.domain + '|' + c.path;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
          });
        }
        sendResponse({ cookies: all });
      });
    });
    return true;
  }

  if (message && message.type === 'harness-url') {
    if (typeof message.origin === 'string') {
      chrome.storage.local.set({ harnessOrigin: message.origin });
      ensurePollLoop(message.origin);
      pushCookieSnapshot(message.origin);
    }
    sendResponse({ ok: true });
    return true;
  }
});

// --- Cookie snapshot push ---
// Whenever github cookies change, push the full snapshot to the harness so
// new browser sidecars come up auto-logged-in.

function gatherGithubCookies() {
  return new Promise(resolve => {
    chrome.cookies.getAll({ domain: '.github.com' }, (cookies) => {
      chrome.cookies.getAll({ domain: 'github.com' }, (exact) => {
        const seen = new Set();
        const all = [];
        for (const c of cookies.concat(exact)) {
          const key = c.name + '|' + c.domain + '|' + c.path;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({
            name: c.name, value: c.value, domain: c.domain, path: c.path,
            secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
            expirationDate: c.expirationDate,
          });
        }
        resolve(all);
      });
    });
  });
}

let pushDebounce = null;
let lastPushOrigin = null;

async function pushCookieSnapshot(origin) {
  lastPushOrigin = origin || lastPushOrigin;
  const target = lastPushOrigin;
  if (!target) return;
  const cookies = await gatherGithubCookies();
  if (!cookies.length) return;
  try {
    await fetch(target + '/api/browser/cookie-snapshot', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies }),
    });
  } catch { /* silent — try again on next change */ }
}

function schedulePush() {
  if (pushDebounce) clearTimeout(pushDebounce);
  pushDebounce = setTimeout(() => { pushDebounce = null; pushCookieSnapshot(); }, 1500);
}

chrome.cookies.onChanged.addListener((info) => {
  const d = info.cookie && info.cookie.domain;
  if (!d) return;
  if (d === 'github.com' || d === '.github.com' || d.endsWith('.github.com')) schedulePush();
});

// --- 2. Long-poll loop for GitHub proxy jobs ---

let currentOrigin = null;
let loopRunning = false;

function ensurePollLoop(origin) {
  if (!origin) return;
  if (currentOrigin === origin && loopRunning) return;
  currentOrigin = origin;
  if (loopRunning) return;
  loopRunning = true;
  pollLoop().finally(() => { loopRunning = false; });
}

async function pollLoop() {
  let backoff = 1000;
  while (currentOrigin) {
    const origin = currentOrigin;
    let resp;
    try {
      resp = await fetch(origin + '/api/browser/agent/poll', {
        credentials: 'include',
        cache: 'no-store',
      });
    } catch (err) {
      // Network/auth failure — back off and retry. Most common case is the
      // user closed/restarted the harness, or basic-auth needs to be
      // re-entered in a tab.
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
      continue;
    }

    if (resp.status === 401 || resp.status === 403) {
      // Auth not yet established — wait for the user to load the harness
      // page in a tab so basic-auth gets cached.
      await sleep(5000);
      continue;
    }
    if (!resp.ok) {
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
      continue;
    }

    backoff = 1000;
    let data;
    try { data = await resp.json(); } catch { continue; }
    if (data && data.job) {
      // Don't await — start the next poll immediately so we don't serialize jobs.
      handleJob(origin, data.job);
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function handleJob(origin, job) {
  const result = await executeProxyFetch(job);
  try {
    await fetch(origin + '/api/browser/agent/respond', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: job.requestId, ...result }),
    });
  } catch (err) {
    // Nothing to do — the harness side will time out the original request.
  }
}

async function executeProxyFetch(job) {
  const { method, url, headers, body, bodyEncoding } = job;

  if (!isAllowedUrl(url)) {
    return { error: 'URL not in allowed host list (github.com / githubusercontent.com only)' };
  }

  let init = {
    method: method || 'GET',
    credentials: 'include',
    headers: headers || {},
    redirect: 'follow',
  };

  if (body != null && method && method !== 'GET' && method !== 'HEAD') {
    if (bodyEncoding === 'base64') {
      init.body = Uint8Array.from(atob(body), c => c.charCodeAt(0));
    } else {
      init.body = body;
    }
  }

  let resp;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    return { error: 'fetch failed: ' + (err && err.message || String(err)) };
  }

  const respHeaders = {};
  resp.headers.forEach((v, k) => { respHeaders[k] = v; });

  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);

  let b64 = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  b64 = btoa(b64);

  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: respHeaders,
    body: b64,
    bodyEncoding: 'base64',
    finalUrl: resp.url,
  };
}

// Restore the loop on SW startup using the last-known harness origin.
chrome.runtime.onStartup.addListener(restoreLoop);
chrome.runtime.onInstalled.addListener(restoreLoop);
restoreLoop();

function restoreLoop() {
  chrome.storage.local.get('harnessOrigin', (data) => {
    if (data && data.harnessOrigin) ensurePollLoop(data.harnessOrigin);
  });
}

// Keep the SW alive between long-poll cycles. The active fetch keeps it up,
// but if the SW is killed mid-cycle this alarm restarts the loop.
chrome.alarms.create('agent-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'agent-keepalive') return;
  if (!loopRunning) restoreLoop();
});


// =============================================================================
// Tab Auto-Pin — auto-pin tabs by URL rules, reorder pinned tabs by priority
// =============================================================================

const DEFAULT_RULES = [
  { name: 'Harness', color: 'pink', patterns: ['https?://code\\.ourhome\\.dev'], enabled: true },
  { name: 'SUSE', color: 'green', patterns: ['https?://id\\.suse\\.com'], enabled: true },
  { name: 'Slack', color: 'purple', patterns: ['https?://app\\.slack\\.com'], enabled: true },
  { name: 'Gmail', color: 'red', patterns: ['https?://mail\\.google\\.com'], enabled: true },
  { name: 'Calendar', color: 'blue', patterns: ['https?://calendar\\.google\\.com', 'https?://meet\\.google\\.com'], enabled: true },
  { name: 'PR Lists', color: 'cyan', patterns: ['https?://github\\.com/.+/pulls'], enabled: true },
  { name: 'PRs', color: 'cyan-subtle', patterns: ['https?://github\\.com/.+/pull/\\d+'], enabled: true },
  { name: 'Issue Lists', color: 'yellow', patterns: ['https?://github\\.com/.+/issues(?:[?#]|$)'], enabled: true },
  { name: 'Issues', color: 'yellow-subtle', patterns: ['https?://github\\.com/.+/issues/\\d+'], enabled: true },
];

let pinRules = [];
let pinProcessing = false;
let pinPending = false;
const managedPins = new Set();
let reordering = false;

async function loadPinRules() {
  const data = await chrome.storage.sync.get('rules');
  pinRules = data.rules || DEFAULT_RULES;
}

function matchRule(url) {
  if (!url) return null;
  for (let i = 0; i < pinRules.length; i++) {
    const rule = pinRules[i];
    if (!rule.enabled) continue;
    for (let p = 0; p < rule.patterns.length; p++) {
      try {
        if (new RegExp(rule.patterns[p]).test(url)) {
          return { rule, ruleIndex: i, patternIndex: p };
        }
      } catch {}
    }
  }
  return null;
}

function sortKey(url) {
  const m = matchRule(url);
  if (!m) return 99999;
  return m.ruleIndex * 100 + m.patternIndex;
}

async function processAllTabs() {
  if (pinProcessing) { pinPending = true; return; }
  pinProcessing = true;

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const match = matchRule(tab.url);
      if (match && !tab.pinned) {
        try {
          await chrome.tabs.update(tab.id, { pinned: true });
          managedPins.add(tab.id);
        } catch {}
      } else if (!match && tab.pinned && managedPins.has(tab.id)) {
        try {
          await chrome.tabs.update(tab.id, { pinned: false });
          managedPins.delete(tab.id);
        } catch {}
      } else if (match && tab.pinned) {
        managedPins.add(tab.id);
      }
    }

    await reorderPins();
  } catch (e) {
    console.error('tab-auto-pin error:', e);
  } finally {
    pinProcessing = false;
    if (pinPending) {
      pinPending = false;
      setTimeout(processAllTabs, 100);
    }
  }
}

async function reorderPins() {
  reordering = true;
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const win of windows) {
      await reorderWindow(win.id);
    }
  } finally {
    reordering = false;
  }
}

async function reorderWindow(windowId) {
  const pinned = await chrome.tabs.query({ windowId, pinned: true });
  if (pinned.length < 2) return;

  const desired = pinned
    .map(tab => ({ id: tab.id, key: sortKey(tab.url) }))
    .sort((a, b) => a.key - b.key);

  for (let target = 0; target < desired.length; target++) {
    const fresh = await chrome.tabs.query({ windowId, pinned: true });
    const current = fresh.findIndex(t => t.id === desired[target].id);
    if (current === -1 || current === target) continue;
    try {
      await chrome.tabs.move(desired[target].id, { index: target });
    } catch {}
  }
}

let pinDebounceTimer = null;
function debouncedProcess() {
  if (pinDebounceTimer) clearTimeout(pinDebounceTimer);
  pinDebounceTimer = setTimeout(processAllTabs, 150);
}

chrome.tabs.onCreated.addListener(debouncedProcess);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete' || changeInfo.pinned !== undefined) {
    debouncedProcess();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  managedPins.delete(tabId);
  debouncedProcess();
});
chrome.tabs.onAttached.addListener(debouncedProcess);
chrome.tabs.onMoved.addListener(() => {
  if (!reordering) debouncedProcess();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.rules) {
    pinRules = changes.rules.newValue || DEFAULT_RULES;
    debouncedProcess();
  }
});

loadPinRules().then(processAllTabs);
