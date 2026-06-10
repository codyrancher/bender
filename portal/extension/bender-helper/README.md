# VS Code Storage Isolator

Chrome extension that isolates browser storage (IndexedDB, localStorage, sessionStorage) per VS Code project instance. Without this, all VS Code iframes share the same origin and leak state between projects.

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder (`portal/extension/vscode-storage-isolator`)

## What it does

- Namespaces IndexedDB, localStorage, and sessionStorage with the project name prefix
- Wraps `Worker` and `SharedWorker` constructors so workers also get namespaced IndexedDB
- Pre-seeds VS Code's global state database to suppress onboarding dialogs (trust prompt, welcome tab, theme notification)
- Auto-dismisses any onboarding dialogs that still appear due to race conditions
- Overrides `window.open` to route links through the portal (local URLs open in browser iframe, external URLs open in new tab)
