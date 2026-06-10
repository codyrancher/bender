<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouterLink } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { getPipelineIdFromRoute, getViewModeFromRoute, isHarnessRoute } from '@/router'
import { getBrowserUrl, getVscodeUrl } from '@/services/urls'

const route = useRoute()
const router = useRouter()
const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const isHarness = computed(() => isHarnessRoute(route))
const pipelineId = computed(() => getPipelineIdFromRoute(route))
const viewMode = computed(() => getViewModeFromRoute(route))
const isSplit = computed(() => viewMode.value === 'split')
const isRunning = computed(() => pipelineId.value ? pipelinesStore.isPipelineRunning(pipelineId.value) : false)
const pipelineForwards = computed(() =>
  pipelinesStore.portForwards.filter(f => f.pipeline === pipelineId.value)
)
const hasForwards = computed(() => pipelineForwards.value.length > 0)
const showForwardForm = ref(false)
const fwdPublicPort = ref('')
const fwdLocalPort = ref('')
const availablePorts = ref<number[]>([])
const listeningPorts = ref<number[]>([])
const loadingOptions = ref(false)
const isStarting = computed(() => pipelineId.value ? pipelinesStore.isPipelineStarting(pipelineId.value) : false)
const isStopping = computed(() => pipelineId.value ? pipelinesStore.isPipelineStopping(pipelineId.value) : false)
const isBusy = computed(() => isStarting.value || isStopping.value)
const browserPort = computed(() => pipelineId.value ? pipelinesStore.getPipelineBrowserPort(pipelineId.value) : undefined)
const browserHost = computed(() => pipelineId.value ? pipelinesStore.getPipelineBrowserHost(pipelineId.value) : undefined)

// Harness state
const harnessDevRunning = computed(() => pipelinesStore.harnessStatus.devRunning)
const harnessOperationActive = computed(() => pipelinesStore.harnessOperationActive)

async function handleReprovision() {
  if (!pipelineId.value) return
  await pipelinesStore.reprovisionPipeline(pipelineId.value)
}

async function handleToggleProject() {
  if (!pipelineId.value || isBusy.value) return
  if (isRunning.value) {
    await pipelinesStore.stopPipeline(pipelineId.value)
  } else {
    await pipelinesStore.startPipeline(pipelineId.value)
  }
}

function openVscodeNewTab() {
  if (!pipelineId.value) return
  window.open(getVscodeUrl(pipelineId.value), '_blank')
}

function openBrowserNewTab() {
  if (!pipelineId.value || !browserPort.value) return
  window.open(getBrowserUrl(pipelineId.value, browserPort.value, browserHost.value), '_blank')
}

import { api } from '@/services/api'

async function toggleForwardForm() {
  showForwardForm.value = !showForwardForm.value
  if (showForwardForm.value && pipelineId.value) {
    fwdPublicPort.value = ''
    fwdLocalPort.value = ''
    loadingOptions.value = true
    try {
      const opts = await api.getForwardOptions(pipelineId.value)
      availablePorts.value = opts.availablePorts
      listeningPorts.value = opts.listeningPorts
    } catch { /* ignore */ }
    loadingOptions.value = false
  }
}

async function submitForward() {
  if (!pipelineId.value) return
  const pub = parseInt(fwdPublicPort.value, 10)
  const local = parseInt(fwdLocalPort.value, 10)
  if (isNaN(pub) || isNaN(local) || pub < 1 || local < 1) {
    uiStore.showToast('Enter valid port numbers', 'error')
    return
  }
  await pipelinesStore.startPortForward(pipelineId.value, pub, local)
  showForwardForm.value = false
}

function toggleSplit() {
  if (!pipelineId.value) return
  if (isSplit.value) {
    router.push(`/${pipelineId.value}/vscode`)
  } else {
    router.push(`/${pipelineId.value}/split`)
  }
}

// Harness actions
async function handleHarnessStart() {
  await pipelinesStore.harnessAction('start')
}

async function handleHarnessRebuild() {
  await pipelinesStore.harnessAction('rebuild')
}

async function handleHarnessPromote() {
  if (!confirm('Promote dev changes to production? This will rebuild the production API and portal, then remove the dev environment.')) return
  await pipelinesStore.harnessAction('promote')
}

async function handleHarnessAbandon() {
  if (!confirm('Abandon dev environment? All uncommitted changes will be lost.')) return
  await pipelinesStore.harnessAction('abandon')
}

</script>

<template>
  <div class="toolbar">
    <!-- Harness toolbar -->
    <template v-if="isHarness">
      <div class="tabs">
        <div class="tab-wrapper active">
          <span class="tab-label">Harness Dev</span>
        </div>
      </div>
      <div class="toolbar-buttons">
        <template v-if="!harnessDevRunning && !harnessOperationActive">
          <button class="toolbar-btn text-btn accent" @click="handleHarnessStart">
            Start Dev
          </button>
        </template>
        <template v-else-if="harnessOperationActive">
          <button class="toolbar-btn text-btn" disabled>
            <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" />
            </svg>
            Working...
          </button>
        </template>
        <template v-else>
          <button class="toolbar-btn text-btn" @click="handleHarnessRebuild" title="Rebuild dev API from current source">
            Rebuild
          </button>
          <button class="toolbar-btn text-btn accent" @click="handleHarnessPromote" title="Promote dev changes to production">
            Promote
          </button>
          <button class="toolbar-btn text-btn danger" @click="handleHarnessAbandon" title="Discard dev environment">
            Abandon
          </button>
        </template>
      </div>
    </template>

    <!-- Project toolbar -->
    <template v-else>
      <div class="tabs">
        <div v-if="pipelineId" class="tab-wrapper" :class="{ active: viewMode === 'vscode' || viewMode === 'split' }">
          <RouterLink class="tab-link" :to="`/${pipelineId}/vscode`">
            VSCode
          </RouterLink>
          <button class="tab-external" title="Open in new tab" @click="openVscodeNewTab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
        <div v-if="pipelineId && browserPort" class="tab-wrapper" :class="{ active: viewMode === 'browser' || viewMode === 'split' }">
          <RouterLink class="tab-link" :to="`/${pipelineId}/browser`">
            Browser
          </RouterLink>
          <button class="tab-external" title="Open in new tab" @click="openBrowserNewTab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
      </div>
      <div class="toolbar-buttons">
        <div v-if="pipelineId && isRunning" class="forward-wrap">
          <button
            class="toolbar-btn icon-btn"
            :class="{ active: hasForwards || showForwardForm }"
            title="Port forwarding"
            @click="toggleForwardForm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
          <div v-if="showForwardForm" class="forward-dropdown">
            <div v-for="fwd in pipelineForwards" :key="fwd.publicPort" class="forward-row">
              <span class="forward-label">:{{ fwd.publicPort }} → :{{ fwd.localPort }}</span>
              <button class="btn-icon" title="Stop" @click="pipelinesStore.stopPortForward(fwd.publicPort)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div v-if="loadingOptions" class="forward-loading">Loading ports...</div>
            <div v-else class="forward-new">
              <select v-model="fwdPublicPort" class="fwd-select">
                <option value="" disabled>Public port</option>
                <option v-for="p in availablePorts" :key="p" :value="String(p)">{{ p }}</option>
              </select>
              <span class="fwd-arrow">→</span>
              <select v-model="fwdLocalPort" class="fwd-select">
                <option value="" disabled>Local port</option>
                <option v-for="p in listeningPorts" :key="p" :value="String(p)">{{ p }}</option>
              </select>
              <button class="btn btn-primary btn-sm" :disabled="!fwdPublicPort || !fwdLocalPort" @click="submitForward">Add</button>
            </div>
          </div>
        </div>
        <button
          v-if="pipelineId && browserPort"
          class="toolbar-btn icon-btn"
          :class="{ active: isSplit }"
          title="Split view"
          @click="toggleSplit"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="3" x2="12" y2="21" />
          </svg>
        </button>
        <button
          v-if="pipelineId && isRunning"
          class="toolbar-btn icon-btn"
          title="Reprovision sidecars"
          @click="handleReprovision"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
        <button
          class="toolbar-btn icon-btn"
          :class="{
            running: isRunning && !isStopping,
            busy: isBusy
          }"
          :disabled="!pipelineId || isBusy"
          :title="isStarting ? 'Starting...' : isStopping ? 'Stopping...' : isRunning ? 'Stop container' : 'Start container'"
          @click="handleToggleProject"
        >
          <svg v-if="isBusy" class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" />
          </svg>
          <svg v-else-if="isRunning" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  height: var(--size-header-height);
  padding: 0 var(--spacing-md) 0 0;
  background: var(--color-bg-secondary);
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
  flex-shrink: 0;
}

.tabs {
  display: flex;
  gap: var(--spacing-xs);
  height: 100%;
  align-items: flex-end;
}

.tab-wrapper {
  display: flex;
  align-items: center;
  background: var(--color-bg-element);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: background var(--transition-fast);
}

.tab-wrapper:hover:not(.active) {
  background: var(--color-bg-element-hover);
}

.tab-wrapper.active {
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-bottom-color: var(--color-bg-primary);
  margin-bottom: calc(-1 * var(--border-width-sm));
}

.tab-link {
  color: var(--color-text-muted);
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-lg);
  font-size: var(--font-size-sm);
  font-weight: 500;
  text-decoration: none;
  transition: color var(--transition-fast);
}

.tab-label {
  color: var(--color-text-primary);
  padding: var(--spacing-sm) var(--spacing-lg);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.tab-wrapper:hover .tab-link {
  color: var(--color-text-hover);
}

.tab-wrapper.active .tab-link {
  color: var(--color-text-primary);
}

.tab-external {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: var(--spacing-xs);
  margin-right: var(--spacing-xs);
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-muted);
  opacity: 0.5;
  transition: opacity var(--transition-fast), color var(--transition-fast);
}

.tab-external svg {
  width: 12px;
  height: 12px;
}

.tab-wrapper:hover .tab-external {
  opacity: 0.8;
}

.tab-external:hover {
  opacity: 1;
  color: var(--color-text-primary);
}

.toolbar-buttons {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  height: 100%;
}

.toolbar-btn {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
  border: none;
  height: 28px;
  padding: 0 var(--spacing-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: inherit;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.toolbar-btn:hover {
  background: var(--color-bg-element-hover);
  color: var(--color-text-hover);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn.text-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 0 var(--spacing-lg);
  font-weight: 500;
}

.toolbar-btn.text-btn.accent {
  color: var(--color-accent);
}

.toolbar-btn.text-btn.accent:hover {
  color: var(--color-accent-hover);
}

.toolbar-btn.text-btn.danger {
  color: var(--color-warning);
}

.toolbar-btn.text-btn.danger:hover {
  color: var(--color-warning-hover);
}

.toolbar-btn.icon-btn {
  width: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn.icon-btn svg {
  width: 14px;
  height: 14px;
}

.toolbar-btn.icon-btn.active {
  color: var(--color-accent);
  background: var(--color-bg-primary);
}

.toolbar-btn.icon-btn.running {
  color: var(--color-warning);
}

.toolbar-btn.icon-btn.running:hover {
  color: var(--color-warning-hover);
}

.toolbar-btn.icon-btn:not(.running):not(.busy) {
  color: var(--color-accent);
}

.toolbar-btn.icon-btn:not(.running):not(.busy):hover {
  color: var(--color-accent-hover);
}

.toolbar-btn.icon-btn.forwarded-elsewhere {
  color: var(--color-warning);
}

.toolbar-btn.icon-btn.forwarded-elsewhere:hover {
  color: var(--color-warning-hover);
}

.toolbar-btn.icon-btn.busy {
  cursor: wait;
}

.toolbar-btn .spinner,
.toolbar-btn.icon-btn .spinner {
  width: 14px;
  height: 14px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.forward-wrap {
  position: relative;
}

.forward-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--spacing-xs);
  background: var(--color-bg-element);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm);
  min-width: 260px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.forward-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-xxs) 0;
}

.forward-label {
  font-size: var(--font-size-xs);
  font-family: monospace;
  color: var(--color-text-primary);
}

.forward-new {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding-top: var(--spacing-xs);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
}

.fwd-select {
  flex: 1;
  padding: var(--spacing-xxs) var(--spacing-xs);
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  font-family: monospace;
  cursor: pointer;
}

.fwd-select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.forward-loading {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: var(--spacing-xs) 0;
  text-align: center;
}

.fwd-arrow {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
