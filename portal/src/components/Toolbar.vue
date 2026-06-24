<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { usePipelineId, useViewMode } from '@/composables/route'
import { getBrowserUrl, getVscodeUrl } from '@/services/urls'
import ExternalLinkIcon from '@/assets/icons/external-link.svg?component'
import SplitIcon from '@/assets/icons/split.svg?component'
import RefreshIcon from '@/assets/icons/refresh.svg?component'
import StopIcon from '@/assets/icons/stop.svg?component'
import PlayIcon from '@/assets/icons/play.svg?component'
import SpinnerIcon from '@/assets/icons/spinner.svg?component'

const router = useRouter()
const pipelinesStore = usePipelinesStore()

const pipelineId = usePipelineId()
const viewMode = useViewMode()
const isSplit = computed(() => viewMode.value === 'split')
const isRunning = computed(() => pipelineId.value ? pipelinesStore.isPipelineRunning(pipelineId.value) : false)
const isStarting = computed(() => pipelineId.value ? pipelinesStore.isPipelineStarting(pipelineId.value) : false)
const isStopping = computed(() => pipelineId.value ? pipelinesStore.isPipelineStopping(pipelineId.value) : false)
const isBusy = computed(() => isStarting.value || isStopping.value)
const browserPort = computed(() => pipelineId.value ? pipelinesStore.getPipelineBrowserPort(pipelineId.value) : undefined)
const browserHost = computed(() => pipelineId.value ? pipelinesStore.getPipelineBrowserHost(pipelineId.value) : undefined)

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

function toggleSplit() {
  if (!pipelineId.value) return
  if (isSplit.value) {
    router.push(`/${pipelineId.value}/vscode`)
  } else {
    router.push(`/${pipelineId.value}/split`)
  }
}
</script>

<template>
  <div class="toolbar">
    <div class="tabs">
      <div v-if="pipelineId" class="tab-wrapper" :class="{ active: viewMode === 'vscode' || viewMode === 'split' }">
        <RouterLink class="tab-link" :to="`/${pipelineId}/vscode`">
          VSCode
        </RouterLink>
        <button class="tab-external" title="Open in new tab" @click="openVscodeNewTab">
          <ExternalLinkIcon />
        </button>
      </div>
      <div v-if="pipelineId && browserPort" class="tab-wrapper" :class="{ active: viewMode === 'browser' || viewMode === 'split' }">
        <RouterLink class="tab-link" :to="`/${pipelineId}/browser`">
          Browser
        </RouterLink>
        <button class="tab-external" title="Open in new tab" @click="openBrowserNewTab">
          <ExternalLinkIcon />
        </button>
      </div>
    </div>
    <div class="toolbar-buttons">
      <button
        v-if="pipelineId && browserPort"
        class="toolbar-btn icon-btn"
        :class="{ active: isSplit }"
        title="Split view"
        @click="toggleSplit"
      >
        <SplitIcon />
      </button>
      <button
        v-if="pipelineId && isRunning"
        class="toolbar-btn icon-btn"
        title="Reprovision sidecars"
        @click="handleReprovision"
      >
        <RefreshIcon />
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
        <SpinnerIcon v-if="isBusy" class="spinner" />
        <StopIcon v-else-if="isRunning" />
        <PlayIcon v-else />
      </button>
    </div>
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

.toolbar-btn.icon-btn.busy {
  cursor: wait;
}

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
</style>
