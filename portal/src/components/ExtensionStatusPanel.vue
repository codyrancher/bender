<script setup lang="ts">
// Browser-extension section of Settings: shows proxy connection + version,
// offers the download, and polls status. Fully self-contained.
import { ref, onMounted, onBeforeUnmount } from 'vue'

const version = ref<string | null>(null)
const installedVersion = ref<string | null>(null)
const connected = ref<boolean | null>(null)

function onInfoMessage(event: MessageEvent) {
  if (event.source !== window) return
  if (!event.data || event.data.type !== 'bender-extension-info') return
  if (typeof event.data.version === 'string') {
    installedVersion.value = event.data.version
  }
}

async function fetchInfo() {
  try {
    const versionResp = await fetch('/api/extension/version', { credentials: 'include' })
    if (versionResp.ok) {
      const data = await versionResp.json()
      version.value = data.version
    } else {
      version.value = null
    }
  } catch { version.value = null }

  try {
    const statusResp = await fetch('/api/github/proxy/status', { credentials: 'include' })
    if (statusResp.ok) {
      const data = await statusResp.json()
      connected.value = !!data.connected
    }
  } catch { connected.value = false }
}

function download() {
  window.location.href = '/api/extension.zip'
}

let pollTimer: number | null = null

onMounted(() => {
  fetchInfo()
  pollTimer = window.setInterval(fetchInfo, 5000)
  window.addEventListener('message', onInfoMessage)
})

onBeforeUnmount(() => {
  if (pollTimer !== null) clearInterval(pollTimer)
  window.removeEventListener('message', onInfoMessage)
})
</script>

<template>
  <section class="section">
    <h2>Browser Extension</h2>
    <p class="description">
      Installs in your host browser so the harness can act as you on github.com (uploading PR videos, querying session data, etc.). Required for the GitHub proxy.
    </p>
    <div class="ext-row">
      <div class="ext-status">
        <span class="ext-dot" :class="{ 'on': connected, 'off': connected === false }"></span>
        <span v-if="connected">Proxy connected</span>
        <span v-else-if="connected === false">Proxy disconnected</span>
        <span v-else>Checking...</span>
        <span v-if="version" class="ext-version">
          <template v-if="installedVersion">installed: v{{ installedVersion }} · </template>latest: v{{ version }}
        </span>
      </div>
      <button class="btn btn-primary" :disabled="!version" @click="download">
        Download Extension
      </button>
    </div>
    <details class="ext-help">
      <summary>How to install</summary>
      <ol>
        <li>Click <b>Download Extension</b> and save the zip somewhere stable (e.g. <code>~/.bender-extension/</code>).</li>
        <li>Unzip it (overwriting any previous version).</li>
        <li>First time only: open <code>chrome://extensions</code>, enable <b>Developer mode</b>, click <b>Load unpacked</b>, and pick the extracted <code>bender-helper/</code> folder.</li>
        <li>On future updates: just download + unzip + click the <b>Reload</b> arrow on the extension card.</li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.section {
  margin-bottom: var(--spacing-xl);
}

h2 {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-xs);
}

.description {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}

.ext-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.ext-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.ext-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
  flex-shrink: 0;
}

.ext-dot.on { background: #22c55e; }
.ext-dot.off { background: #ef4444; }

.ext-version {
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
}

.ext-help {
  margin-top: var(--spacing-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.ext-help summary {
  cursor: pointer;
  user-select: none;
  color: var(--color-text-secondary);
}

.ext-help ol {
  margin: var(--spacing-sm) 0 0 var(--spacing-lg);
  padding: 0;
}

.ext-help li {
  margin-bottom: var(--spacing-xs);
  line-height: 1.5;
}

.ext-help code {
  background: var(--color-bg-tertiary, var(--color-bg-secondary));
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}

.btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-weight: 500;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-bg-primary);
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}
</style>
