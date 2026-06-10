// Content script (ISOLATED world) - bridges between page JS and the extension service worker.
// The page can't talk to chrome.runtime directly, so it posts a message here.

// On load, announce the harness origin to the SW so it can long-poll
// /api/browser/agent/poll for GitHub-proxy jobs from project containers.
// This is what powers things like uploading PR videos to GitHub user-attachments
// using the host browser's logged-in session.
try {
  chrome.runtime.sendMessage({ type: 'harness-url', origin: window.location.origin });
} catch { /* extension context not ready yet */ }

// Announce the installed extension version to the page so the harness can
// detect when an update is available and prompt the user. Re-broadcast
// periodically in case the page hadn't installed its listener yet on load.
try {
  var extInfo = { type: 'bender-extension-info', version: chrome.runtime.getManifest().version };
  window.postMessage(extInfo, window.location.origin);
  setTimeout(function () { window.postMessage(extInfo, window.location.origin); }, 500);
  setTimeout(function () { window.postMessage(extInfo, window.location.origin); }, 2000);
} catch { /* manifest unavailable */ }

window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'harness-sync-cookies') return;

  var project = event.data.project;
  var apiBase = event.data.apiBase || '/api';

  chrome.runtime.sendMessage({ type: 'get-github-cookies' }, function (response) {
    if (!response || !response.cookies || response.cookies.length === 0) {
      window.postMessage({ type: 'harness-sync-cookies-result', success: false, error: 'No GitHub cookies found. Make sure you are logged into GitHub in this browser.' }, '*');
      return;
    }

    // POST cookies to the harness API
    fetch(apiBase + '/browser/sync-cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project, cookies: response.cookies })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        window.postMessage({ type: 'harness-sync-cookies-result', success: !data.error, error: data.error, count: response.cookies.length }, '*');
      })
      .catch(function (err) {
        window.postMessage({ type: 'harness-sync-cookies-result', success: false, error: err.message }, '*');
      });
  });
});
