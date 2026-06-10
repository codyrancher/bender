const DEFAULT_RULES = [
  { name: 'SUSE', color: 'green', patterns: ['https?://id\\.suse\\.com'], enabled: true },
  { name: 'Slack', color: 'purple', patterns: ['https?://app\\.slack\\.com'], enabled: true },
  { name: 'Gmail', color: 'red', patterns: ['https?://mail\\.google\\.com'], enabled: true },
  { name: 'Calendar', color: 'blue', patterns: ['https?://calendar\\.google\\.com', 'https?://meet\\.google\\.com'], enabled: true },
  { name: 'PR Lists', color: 'cyan', patterns: ['https?://github\\.com/.+/pulls'], enabled: true },
  { name: 'PRs', color: 'cyan-subtle', patterns: ['https?://github\\.com/.+/pull/\\d+'], enabled: true },
  { name: 'Issue Lists', color: 'yellow', patterns: ['https?://github\\.com/.+/issues(?:[?#]|$)'], enabled: true },
  { name: 'Issues', color: 'yellow-subtle', patterns: ['https?://github\\.com/.+/issues/\\d+'], enabled: true },
];

let rules = [];
let processing = false;
let pending = false;
const managedPins = new Set();
let reordering = false;

async function loadRules() {
  const data = await chrome.storage.sync.get('rules');
  rules = data.rules || DEFAULT_RULES;
}

function matchRule(url) {
  if (!url) return null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
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
  if (processing) { pending = true; return; }
  processing = true;

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
    processing = false;
    if (pending) {
      pending = false;
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

let debounceTimer = null;
function debouncedProcess() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(processAllTabs, 150);
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
    rules = changes.rules.newValue || DEFAULT_RULES;
    debouncedProcess();
  }
});

loadRules().then(processAllTabs);
