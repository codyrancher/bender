<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@/services/api'
import { useUiStore } from '@/stores/ui'
import type { PortRange, PortAllocation } from '@/types'
import InsightsPanel from './InsightsPanel.vue'

const uiStore = useUiStore()

const externalIp = ref('')

const portRange = ref<PortRange>({ start: 8200, end: 8299 })
const allocations = ref<PortAllocation[]>([])
const loading = ref(true)

const editStart = ref(8200)
const editEnd = ref(8299)
const isEditing = ref(false)

// Template keys are now configured via environment variables (see .env.example),
// so no template/keys management surface is exposed in the UI anymore.

// Global keys (kept for backward compat with settings API)
const keys = ref<Record<string, string>>({})

const totalPorts = computed(() => portRange.value.end - portRange.value.start + 1)
const usedPorts = computed(() => allocations.value.length)
const availablePorts = computed(() => totalPorts.value - usedPorts.value)

async function fetchSettings() {
  try {
    const data = await api.getSettings()
    portRange.value = data.portRange
    allocations.value = data.allocations
    externalIp.value = data.externalIp
    keys.value = data.keys || {}
    editStart.value = data.portRange.start
    editEnd.value = data.portRange.end
  } catch (err) {
    uiStore.showToast('Failed to load settings', 'error')
  } finally {
    loading.value = false
  }
}

function startEditing() {
  editStart.value = portRange.value.start
  editEnd.value = portRange.value.end
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
}

async function savePortRange() {
  try {
    await api.updatePortRange({ start: editStart.value, end: editEnd.value })
    portRange.value = { start: editStart.value, end: editEnd.value }
    isEditing.value = false
    uiStore.showToast('Port range updated')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update'
    uiStore.showToast(message, 'error')
  }
}

async function removeMapping(pipeline: string, service: string) {
  try {
    await api.removePortMapping(pipeline, service)
    allocations.value = allocations.value.filter(
      a => !(a.pipeline === pipeline && a.service === service)
    )
    uiStore.showToast('Port mapping removed')
  } catch (err) {
    uiStore.showToast('Failed to remove mapping', 'error')
  }
}

// --- Browser extension ---
const extensionVersion = ref<string | null>(null)
const extensionInstalledVersion = ref<string | null>(null)
const extensionConnected = ref<boolean | null>(null)
const extensionLastPollAgoMs = ref<number | null>(null)

function onExtensionInfoMessage(event: MessageEvent) {
  if (event.source !== window) return
  if (!event.data || event.data.type !== 'bender-extension-info') return
  if (typeof event.data.version === 'string') {
    extensionInstalledVersion.value = event.data.version
  }
}

async function fetchExtensionInfo() {
  try {
    const versionResp = await fetch('/api/extension/version', { credentials: 'include' })
    if (versionResp.ok) {
      const data = await versionResp.json()
      extensionVersion.value = data.version
    } else {
      extensionVersion.value = null
    }
  } catch { extensionVersion.value = null }

  try {
    const statusResp = await fetch('/api/github/proxy/status', { credentials: 'include' })
    if (statusResp.ok) {
      const data = await statusResp.json()
      extensionConnected.value = !!data.connected
      extensionLastPollAgoMs.value = data.lastPollAgoMs ?? null
    }
  } catch { extensionConnected.value = false }
}

function downloadExtension() {
  window.location.href = '/api/extension.zip'
}

let extensionPollTimer: number | null = null

onMounted(() => {
  fetchSettings()
  fetchExtensionInfo()
  extensionPollTimer = window.setInterval(fetchExtensionInfo, 5000)
  window.addEventListener('message', onExtensionInfoMessage)
})

onBeforeUnmount(() => {
  if (extensionPollTimer !== null) clearInterval(extensionPollTimer)
  window.removeEventListener('message', onExtensionInfoMessage)
})
</script>

<template>
  <div class="settings-page">
    <div class="settings-content">
      <h1>Settings</h1>

      <div v-if="loading" class="loading">Loading settings...</div>

      <template v-else>
        <section class="section">
          <h2>Browser Extension</h2>
          <p class="description">
            Installs in your host browser so the harness can act as you on github.com (uploading PR videos, querying session data, etc.). Required for the GitHub proxy.
          </p>
          <div class="ext-row">
            <div class="ext-status">
              <span class="ext-dot" :class="{ 'on': extensionConnected, 'off': extensionConnected === false }"></span>
              <span v-if="extensionConnected">Proxy connected</span>
              <span v-else-if="extensionConnected === false">Proxy disconnected</span>
              <span v-else>Checking...</span>
              <span v-if="extensionVersion" class="ext-version">
                <template v-if="extensionInstalledVersion">installed: v{{ extensionInstalledVersion }} · </template>latest: v{{ extensionVersion }}
              </span>
            </div>
            <button class="btn btn-primary" @click="downloadExtension" :disabled="!extensionVersion">
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

        <section class="section">
          <h2>External IP</h2>
          <p class="description">
            The public IP address of this network.
          </p>
          <div class="info-display">
            <span class="info-value">{{ externalIp }}</span>
          </div>
        </section>

        <section class="section">
          <h2>External Port Range</h2>
          <p class="description">
            Ports available to expose project services publicly.
          </p>

          <div v-if="!isEditing" class="port-range-display">
            <div class="range-info">
              <span class="range-value">{{ portRange.start }} - {{ portRange.end }}</span>
              <span class="range-meta">{{ totalPorts }} ports total, {{ usedPorts }} used, {{ availablePorts }} available</span>
            </div>
            <button class="btn btn-secondary" @click="startEditing">Edit</button>
          </div>

          <div v-else class="port-range-edit">
            <div class="input-row">
              <label>
                Start
                <input type="number" v-model.number="editStart" min="1024" max="65535" />
              </label>
              <span class="range-dash">-</span>
              <label>
                End
                <input type="number" v-model.number="editEnd" min="1024" max="65535" />
              </label>
            </div>
            <div class="edit-actions">
              <button class="btn btn-primary" @click="savePortRange">Save</button>
              <button class="btn btn-secondary" @click="cancelEditing">Cancel</button>
            </div>
          </div>
        </section>

        <section class="section">
          <h2>Port Allocations</h2>

          <div v-if="allocations.length === 0" class="empty-state">
            No ports are currently allocated.
          </div>

          <table v-else class="allocations-table">
            <thead>
              <tr>
                <th>Port</th>
                <th>Project</th>
                <th>Service</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="alloc in allocations" :key="`${alloc.pipeline}-${alloc.service}`">
                <td class="port-cell">{{ alloc.port }}</td>
                <td>{{ alloc.pipeline }}</td>
                <td>{{ alloc.service }}</td>
                <td class="action-cell">
                  <button class="btn-icon" title="Remove mapping" @click="removeMapping(alloc.pipeline, alloc.service)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </div>

    <div class="insights-wrap">
      <h2 class="insights-title">Insights</h2>
      <InsightsPanel />
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  flex: 1;
  overflow-y: auto;
  background: var(--color-bg-primary);
}

/* Insights lives full-width at the bottom of Settings (its table is wide). */
.insights-wrap {
  padding: var(--spacing-xl) var(--spacing-lg) var(--spacing-xxl);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
}

.insights-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin-bottom: var(--spacing-lg);
}

.settings-content {
  max-width: 700px;
  margin: 0 auto;
  padding: var(--spacing-xl) var(--spacing-lg);
}

h1 {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-xl);
}

.section {
  margin-bottom: var(--spacing-xl);
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

.loading {
  color: var(--color-text-muted);
  padding: var(--spacing-xl);
  text-align: center;
}

.info-display {
  background: var(--color-bg-element);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.info-value {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
}

.info-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.port-range-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-bg-element);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
}

.range-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.range-value {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.range-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.port-range-edit {
  background: var(--color-bg-element);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.input-row label {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.input-row input {
  width: 120px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}

.input-row input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.range-dash {
  color: var(--color-text-muted);
  padding-bottom: var(--spacing-sm);
}

.edit-actions {
  display: flex;
  gap: var(--spacing-sm);
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

.btn-secondary {
  background: var(--color-bg-element-hover);
  color: var(--color-text-primary);
}

.btn-secondary:hover {
  background: var(--color-border-dark);
}

.empty-state {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  padding: var(--spacing-lg);
  text-align: center;
  background: var(--color-bg-element);
  border-radius: var(--radius-md);
}

.allocations-table {
  width: 100%;
  border-collapse: collapse;
}

.allocations-table th {
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
}

.allocations-table td {
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  border-bottom: var(--border-width-sm) solid var(--color-bg-element);
}

.port-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.action-cell {
  width: 40px;
  text-align: right;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-muted);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.btn-icon:hover {
  color: var(--color-warning);
  background: var(--color-bg-element);
}

.btn-icon svg {
  width: 14px;
  height: 14px;
}

/* Templates */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-xs);
}

.section-header h2 {
  margin-bottom: 0;
}

.btn-sm {
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--font-size-xs);
}

.btn-danger {
  background: var(--color-error);
  color: var(--color-text-bright);
}

.btn-danger:hover {
  background: #c84848;
}

.template-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.template-card {
  background: var(--color-bg-element);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.template-card-header {
  display: flex;
  gap: var(--spacing-md);
  align-items: flex-start;
}

.template-icon-wrap {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}

.template-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.template-icon-placeholder {
  width: 100%;
  height: 100%;
  color: var(--color-text-muted);
}

.template-icon-placeholder svg {
  width: 100%;
  height: 100%;
}

.template-info {
  flex: 1;
  min-width: 0;
}

.template-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}

.template-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-top: var(--spacing-xxs);
}

.template-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  opacity: 0.7;
  margin-top: var(--spacing-xs);
}

.template-card-actions {
  display: flex;
  gap: var(--spacing-xs);
  justify-content: flex-end;
  border-top: var(--border-width-sm) solid var(--color-border-dark);
  padding-top: var(--spacing-sm);
}

.btn-icon-danger:hover {
  color: var(--color-error);
  background: var(--color-bg-element);
}

.edit-files-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-right: auto;
}

.edit-files-btn svg {
  width: 14px;
  height: 14px;
}

.edit-files-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Template keys */
.tpl-expand-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  width: 100%;
  padding: var(--spacing-xs) 0;
  background: transparent;
  border: none;
  border-top: var(--border-width-sm) solid var(--color-border-dark);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.tpl-expand-btn:hover {
  color: var(--color-text-primary);
}

.tpl-expand-chevron {
  width: 14px;
  height: 14px;
  transition: transform var(--transition-fast);
}

.tpl-expand-chevron.expanded {
  transform: rotate(180deg);
}

.template-keys {
  border-top: var(--border-width-sm) solid var(--color-border-dark);
  padding-top: var(--spacing-sm);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.tpl-key-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxs);
}

.tpl-key-header {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tpl-key-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-primary);
}

.tpl-key-desc {
  font-size: 10px;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.tpl-keys-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--spacing-xs);
}

.template-form {
  background: var(--color-bg-element);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.template-form label,
.template-edit-fields label {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.template-form input,
.template-edit-fields input {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.template-form input:focus,
.template-edit-fields input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-sm);
}

.template-edit-form {
  display: flex;
  gap: var(--spacing-md);
  width: 100%;
}

.template-edit-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}

.template-edit-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.icon-upload-btn {
  cursor: pointer;
  white-space: nowrap;
}

.delete-confirm {
  text-align: center;
  padding: var(--spacing-sm);
}

.delete-confirm p {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-sm);
}

.delete-warning {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.delete-confirm .edit-actions {
  justify-content: center;
}

/* Keys */
.keys-list {
  background: var(--color-bg-element);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.key-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.key-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.key-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxs);
}

.key-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.key-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.key-description {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.key-input-row {
  display: flex;
  gap: var(--spacing-sm);
}

.key-input-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.key-input-wrap:focus-within {
  border-color: var(--color-accent);
}

.key-input {
  flex: 1;
  padding: var(--spacing-sm) var(--spacing-md);
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: monospace;
}

.key-input:focus {
  outline: none;
}

.key-toggle {
  flex-shrink: 0;
  margin-right: var(--spacing-xs);
}

.keys-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--spacing-sm);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
}
</style>
