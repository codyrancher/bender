(function () {
  // Extract project name from VS Code path: /c/{project}/...
  var m = location.pathname.match(/\/c\/([^\/]+)/);
  if (!m) return;

  var proj = m[1];
  var ns = proj + '::';

  // --- IndexedDB namespacing ---
  var origOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = function (name, version) {
    return origOpen(ns + name, version);
  };

  var origDelete = indexedDB.deleteDatabase.bind(indexedDB);
  indexedDB.deleteDatabase = function (name) {
    return origDelete(ns + name);
  };

  // --- Pre-seed namespaced global state DB to suppress onboarding dialogs ---
  try {
    var seedReq = origOpen(ns + 'vscode-web-state-db-global', 1);
    seedReq.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('ItemTable')) {
        db.createObjectStore('ItemTable');
      }
    };
    seedReq.onsuccess = function (e) {
      var db = e.target.result;
      try {
        var tx = db.transaction('ItemTable', 'readwrite');
        var store = tx.objectStore('ItemTable');
        // Mirror the entries from entrypoint.sh storage.json
        var defaults = {
          'workbench.welcomePageHasBeenShown': 'true',
          'gettingStartedService.walkthroughHasBeenShown': 'true',
          'security.workspace.trust.banner': 'never',
          'workbench.activity.showAccounts': 'false',
          'claude.welcomePageShown': 'true',
          'claude.hasShownWelcome': 'true',
          'trustedDomains/trustedDomains': '["*"]',
          'memento/gettingStartedService': JSON.stringify({
            'ms-vscode.vscode-welcome': {
              stepIds: ['pickColorTheme', 'settingsSync', 'commandPaletteTask', 'terminal', 'settings', 'extensions']
            }
          }),
          'workbench.welcomePage.hiddenCategories': '["Setup","Beginner","Intermediate","Advanced"]'
        };
        for (var key in defaults) {
          // Only write if key doesn't already exist (don't clobber user state)
          var check = store.get(key);
          (function (k, v) {
            check.onsuccess = function (ev) {
              if (ev.target.result === undefined) {
                store.put(v, k);
              }
            };
          })(key, defaults[key]);
        }
        tx.oncomplete = function () { db.close(); };
        tx.onerror = function () { db.close(); };
      } catch (err) {
        db.close();
      }
    };
  } catch (e) { }

  // --- Auto-dismiss VS Code dialogs (fallback for race conditions) ---
  function autoDismiss() {
    // Trust dialog: click "Yes, I trust the authors"
    document.querySelectorAll('.monaco-dialog-box .dialog-buttons .monaco-button').forEach(function (btn) {
      if (/trust/i.test(btn.textContent) && !/don't/i.test(btn.textContent)) {
        btn.click();
      }
    });

    // Theme notification: dismiss "Dark Modern" prompt
    document.querySelectorAll('.notifications-list-container .notification-list-item').forEach(function (item) {
      if (/new default theme|Dark Modern/i.test(item.textContent)) {
        var dismiss = item.querySelector('.codicon-notifications-clear, .codicon-close, [title="Clear Notification"]');
        if (dismiss) dismiss.click();
        else {
          // Try clicking "Cancel" action button
          item.querySelectorAll('.monaco-button').forEach(function (btn) {
            if (/cancel|dismiss/i.test(btn.textContent)) btn.click();
          });
        }
      }
    });

    // Close Welcome/Walkthrough tab if it opens
    document.querySelectorAll('.tab').forEach(function (tab) {
      if (/walkthrough|welcome|getting started/i.test(tab.textContent)) {
        var close = tab.querySelector('.codicon-close, [title="Close"]');
        if (close) close.click();
      }
    });
  }

  var observer = new MutationObserver(autoDismiss);
  function startObserver() {
    var target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
      autoDismiss();
    }
  }

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);

  // Stop observing after 30s (onboarding is long done by then)
  setTimeout(function () { observer.disconnect(); }, 30000);


  // --- localStorage & sessionStorage namespacing ---
  function wrapStorage(storage) {
    var _getItem = storage.getItem.bind(storage);
    var _setItem = storage.setItem.bind(storage);
    var _removeItem = storage.removeItem.bind(storage);
    var _key = storage.key.bind(storage);

    function namespacedLength() {
      var count = 0;
      for (var i = 0; i < storage.length; i++) {
        if (_key(i).indexOf(ns) === 0) count++;
      }
      return count;
    }

    return {
      getItem: function (key) { return _getItem(ns + key); },
      setItem: function (key, val) { return _setItem(ns + key, val); },
      removeItem: function (key) { return _removeItem(ns + key); },
      key: function (index) {
        for (var i = 0, n = 0; i < storage.length; i++) {
          var k = _key(i);
          if (k.indexOf(ns) === 0) {
            if (n === index) return k.slice(ns.length);
            n++;
          }
        }
        return null;
      },
      clear: function () {
        for (var i = storage.length - 1; i >= 0; i--) {
          var k = _key(i);
          if (k.indexOf(ns) === 0) _removeItem(k);
        }
      },
      get length() { return namespacedLength(); }
    };
  }

  var origLocalStorage = window.localStorage;
  var origSessionStorage = window.sessionStorage;

  try {
    Object.defineProperty(window, 'localStorage', {
      get: function () { return wrapStorage(origLocalStorage); },
      configurable: true
    });
  } catch (e) { }

  try {
    Object.defineProperty(window, 'sessionStorage', {
      get: function () { return wrapStorage(origSessionStorage); },
      configurable: true
    });
  } catch (e) { }

  // --- Worker wrapping (namespace IndexedDB inside web workers) ---
  var idbCode = 'var ns="' + ns + '";'
    + 'var O=indexedDB.open.bind(indexedDB);'
    + 'indexedDB.open=function(n,v){return O(ns+n,v)};'
    + 'var D=indexedDB.deleteDatabase.bind(indexedDB);'
    + 'indexedDB.deleteDatabase=function(n){return D(ns+n)};';

  var OrigWorker = Worker;
  Worker = function (url, options) {
    try {
      var absUrl = new URL(url, location.href).href;
      var isModule = options && options.type === 'module';
      var code = isModule
        ? idbCode + 'import "' + absUrl + '";'
        : idbCode + 'importScripts("' + absUrl + '");';
      var blob = new Blob([code], { type: 'application/javascript' });
      return new OrigWorker(URL.createObjectURL(blob), options);
    } catch (e) {
      return new OrigWorker(url, options);
    }
  };
  Worker.prototype = OrigWorker.prototype;

  // --- SharedWorker wrapping ---
  if (window.SharedWorker) {
    var OrigSharedWorker = SharedWorker;
    SharedWorker = function (url, options) {
      try {
        var absUrl = new URL(url, location.href).href;
        var isModule = typeof options === 'object' && options && options.type === 'module';
        var code = isModule
          ? idbCode + 'import "' + absUrl + '";'
          : idbCode + 'importScripts("' + absUrl + '");';
        var blob = new Blob([code], { type: 'application/javascript' });
        var opts = typeof options === 'string' ? { name: options } : Object.assign({}, options || {});
        return new OrigSharedWorker(URL.createObjectURL(blob), opts);
      } catch (e) {
        return new OrigSharedWorker(url, options);
      }
    };
    SharedWorker.prototype = OrigSharedWorker.prototype;
  }

  // --- window.open override (route links through portal) ---
  var origWindowOpen = window.open;
  window.open = function (url, target, features) {
    try {
      if (url && parent !== window) {
        var u = new URL(url, location.origin);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          var isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
          parent.postMessage({
            type: 'open-url',
            project: proj,
            url: url,
            isLocal: isLocal,
            port: isLocal ? u.port || '80' : '',
            path: isLocal ? u.pathname + u.search + u.hash : ''
          }, '*');
          return null;
        }
      }
    } catch (e) { }
    return origWindowOpen.call(window, url, target, features);
  };
})();
