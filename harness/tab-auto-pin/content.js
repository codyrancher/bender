// Mouse button 4 (back) and 5 (forward) navigation
// Selkies WebRTC forwards mouse events to the inner browser, but Chromium
// doesn't always translate auxiliary button clicks into navigation.  Intercept
// them here and drive history.back()/history.forward() explicitly.
document.addEventListener('mouseup', (e) => {
  if (e.button === 3) { // back
    e.preventDefault();
    e.stopPropagation();
    history.back();
  } else if (e.button === 4) { // forward
    e.preventDefault();
    e.stopPropagation();
    history.forward();
  }
}, true); // capture phase so we beat any other handlers

// Also block the 'mousedown' so pages don't see a stray auxiliary click
document.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

(async () => {
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

  // Chrome tab group color names → CSS colors
  const COLOR_MAP = {
    grey: '#5f6368',
    blue: '#4688f1',
    red: '#d93025',
    yellow: '#f9ab00',
    green: '#188038',
    pink: '#e91e8f',
    purple: '#a142f4',
    cyan: '#007b83',
    orange: '#fa903e',
    'cyan-subtle': '#8ecfd4',
    'yellow-subtle': '#fde29b',
  };

  const data = await chrome.storage.sync.get('rules');
  const rules = data.rules || DEFAULT_RULES;
  const url = window.location.href;

  let matchedRule = null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const pattern of rule.patterns) {
      try {
        if (new RegExp(pattern).test(url)) { matchedRule = rule; break; }
      } catch {}
    }
    if (matchedRule) break;
  }
  if (!matchedRule) return;

  const ruleColor = COLOR_MAP[matchedRule.color] || COLOR_MAP.grey;
  const isSubtle = matchedRule.color.endsWith('-subtle');

  function addColorToFavicon() {
    const SIZE = 32;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    // Find existing favicon
    const existingLink = document.querySelector('link[rel*="icon"]');
    const faviconUrl = existingLink?.href;

    function applyOverlay(img) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (img) {
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
      }
      const barHeight = isSubtle ? 9 : 18;
      ctx.fillStyle = ruleColor;
      ctx.fillRect(0, SIZE - barHeight, SIZE, barHeight);

      setFavicon(canvas.toDataURL('image/png'));
    }

    if (faviconUrl && !faviconUrl.startsWith('data:')) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => applyOverlay(img);
      img.onerror = () => applyOverlay(null);
      img.src = faviconUrl;
    } else if (faviconUrl?.startsWith('data:')) {
      const img = new Image();
      img.onload = () => applyOverlay(img);
      img.onerror = () => applyOverlay(null);
      img.src = faviconUrl;
    } else {
      applyOverlay(null);
    }
  }

  function setFavicon(dataUrl) {
    let link = document.querySelector('link[rel="icon"][data-auto-pin]');
    if (!link) {
      // Remove existing favicons so ours takes priority
      document.querySelectorAll('link[rel*="icon"]').forEach(el => {
        if (!el.hasAttribute('data-auto-pin')) el.remove();
      });
      link = document.createElement('link');
      link.rel = 'icon';
      link.setAttribute('data-auto-pin', '1');
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = dataUrl;
  }

  // Wait for page to set its favicon, then overlay
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(addColorToFavicon, 500));
  } else {
    setTimeout(addColorToFavicon, 500);
  }

  // Re-apply when the page changes its favicon
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeName === 'LINK' && node.rel?.includes('icon') && !node.hasAttribute('data-auto-pin')) {
          setTimeout(addColorToFavicon, 100);
        }
      }
    }
  }).observe(document.head || document.documentElement, { childList: true, subtree: true });
})();
