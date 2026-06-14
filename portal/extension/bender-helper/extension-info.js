// Content script (ISOLATED world) — announces the installed extension version to
// the page so the harness can detect when an update is available and prompt the
// user. (The old GitHub cookie-sync / browser-session bridge was removed; all
// GitHub access now goes through the `gh` CLI / a token inside the container.)
try {
  var extInfo = { type: 'bender-extension-info', version: chrome.runtime.getManifest().version };
  window.postMessage(extInfo, window.location.origin);
  setTimeout(function () { window.postMessage(extInfo, window.location.origin); }, 500);
  setTimeout(function () { window.postMessage(extInfo, window.location.origin); }, 2000);
} catch { /* manifest unavailable */ }
