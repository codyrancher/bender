<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { usePipelineId, useViewMode, useIsHarness } from '@/composables/route'
import { getBrowserUrl, getVscodeUrl } from '@/services/urls'
import Spinner from './primitives/Spinner.vue'
import PlayIcon from '@/assets/icons/play.svg?component'

const router = useRouter()
const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const pipelineId = usePipelineId()
const viewMode = useViewMode()
const isHarness = useIsHarness()
const harnessDevRunning = computed(() => pipelinesStore.harnessStatus.devRunning)
const harnessOperationActive = computed(() => pipelinesStore.harnessOperationActive)
const harnessLogs = computed(() => pipelinesStore.harnessLogs)
const harnessVscodeUrl = getVscodeUrl('bender-dev')
const harnessVscodeReady = ref(false)
const harnessVscodeLoaded = ref(false)
const logsContainer = ref<HTMLElement | null>(null)

// Auto-scroll logs to bottom
watch(harnessLogs, () => {
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  })
}, { deep: true })

const noPipelines = computed(() => pipelinesStore.pipelines.length === 0)
const isRunning = computed(() => pipelineId.value ? pipelinesStore.isPipelineRunning(pipelineId.value) : false)
const isStarting = computed(() => pipelineId.value ? pipelinesStore.isPipelineStarting(pipelineId.value) : false)
const isStopping = computed(() => pipelineId.value ? pipelinesStore.isPipelineStopping(pipelineId.value) : false)

// Track URL reachability (polling) and iframe load state
const readyViews = ref<Set<string>>(new Set())
const loadedViews = ref<Set<string>>(new Set())
const pollingTimers = new Map<string, ReturnType<typeof setTimeout>>()

function viewKey(pipelineName: string, view: string) {
  return `${pipelineName}:${view}`
}

function isViewReady(pipelineName: string, view: string) {
  return readyViews.value.has(viewKey(pipelineName, view))
}

function isViewLoaded(pipelineName: string, view: string) {
  return loadedViews.value.has(viewKey(pipelineName, view))
}

function onIframeLoad(pipelineName: string, view: string) {
  loadedViews.value.add(viewKey(pipelineName, view))
}

async function pollUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    clearTimeout(timeoutId)
    return response.status < 500
  } catch {
    return false
  }
}

function startPolling(pipelineName: string, view: string, url: string) {
  const key = viewKey(pipelineName, view)
  if (readyViews.value.has(key) || pollingTimers.has(key)) return

  async function check() {
    if (await pollUrl(url)) {
      readyViews.value.add(key)
      pollingTimers.delete(key)
    } else {
      pollingTimers.set(key, setTimeout(check, 2000))
    }
  }
  check()
}

function clearProjectReady(pipelineName: string) {
  for (const view of ['vscode', 'browser']) {
    const key = viewKey(pipelineName, view)
    readyViews.value.delete(key)
    loadedViews.value.delete(key)
    const timer = pollingTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      pollingTimers.delete(key)
    }
  }
  delete browserOverrides.value[pipelineName]
}

// Start polling when projects become iframe-loaded and running
watch(
  () => pipelinesStore.pipelines.map((p) => ({
    name: p.name,
    loaded: pipelinesStore.isIframeLoaded(p.name),
    running: p.status === 'running',
    browserPort: p.browserPort,
  })),
  (current) => {
    for (const pl of current) {
      if (pl.loaded && pl.running) {
        startPolling(pl.name, 'vscode', getVscodeSrc(pl.name))
        if (pl.browserPort) {
          const src = getBrowserSrc(pl.name)
          if (src) startPolling(pl.name, 'browser', src)
        }
      } else {
        clearProjectReady(pl.name)
      }
    }
  },
  { immediate: true, deep: true },
)

onUnmounted(() => {
  for (const timer of pollingTimers.values()) clearTimeout(timer)
  pollingTimers.clear()
  window.removeEventListener('message', handleVscodeOpenUrl)
})

async function handleStart() {
  if (!pipelineId.value || isStarting.value) return
  await pipelinesStore.startPipeline(pipelineId.value)
}

async function handleHarnessStart() {
  await pipelinesStore.harnessAction('start')
}

// Poll harness VS Code URL when dev is running
watch(
  () => pipelinesStore.harnessStatus.devRunning,
  (running) => {
    if (running && !harnessVscodeReady.value) {
      pollHarnessVscode()
    } else if (!running) {
      harnessVscodeReady.value = false
      harnessVscodeLoaded.value = false
    }
  },
  { immediate: true },
)

async function pollHarnessVscode() {
  if (harnessVscodeReady.value) return
  if (await pollUrl(harnessVscodeUrl)) {
    harnessVscodeReady.value = true
  } else {
    setTimeout(pollHarnessVscode, 2000)
  }
}

function getVscodeSrc(pipelineName: string) {
  return getVscodeUrl(pipelineName)
}

function getBrowserSrc(pipelineName: string) {
  const port = pipelinesStore.getPipelineBrowserPort(pipelineName)
  if (!port) return ''
  const host = pipelinesStore.getPipelineBrowserHost(pipelineName)
  return getBrowserUrl(pipelineName, port, host)
}

const isSplit = computed(() => viewMode.value === 'split')

function isVscodeActive(pipelineName: string) {
  return pipelineId.value === pipelineName && (viewMode.value === 'vscode' || viewMode.value === 'split')
}

function isBrowserActive(pipelineName: string) {
  return pipelineId.value === pipelineName && (viewMode.value === 'browser' || viewMode.value === 'split')
}

// Browser URL overrides from VS Code link clicks
const browserOverrides = ref<Record<string, string>>({})

function shouldShowBrowser(pipelineName: string, browserPort?: number): boolean {
  if (!pipelinesStore.isIframeLoaded(pipelineName) || !pipelinesStore.isPipelineRunning(pipelineName)) return false
  if (browserOverrides.value[pipelineName]) return true
  return !!browserPort && isViewReady(pipelineName, 'browser')
}

function getEffectiveBrowserSrc(pipelineName: string): string {
  return browserOverrides.value[pipelineName] || getBrowserSrc(pipelineName)
}

function handleVscodeOpenUrl(event: MessageEvent) {
  if (event.data?.type !== 'open-url') return
  const { project, url, isLocal, port, path } = event.data as {
    project: string; url: string; isLocal: boolean; port: string; path: string
  }

  if (!isLocal) {
    // External URL - open in a new browser tab from the parent frame
    window.open(url, '_blank')
    return
  }

  // Local URL - route to the browser iframe
  const urlPrefix = import.meta.env.VITE_URL_PREFIX || ''
  browserOverrides.value[project] = `${urlPrefix}/d/${project}/${port}${path}`
  // Clear loaded state so spinner shows while new URL loads
  loadedViews.value.delete(viewKey(project, 'browser'))
  // Switch to split view if currently viewing this project's vscode
  if (pipelineId.value === project && viewMode.value === 'vscode') {
    router.push(`/${project}/split`)
  }
}

window.addEventListener('message', handleVscodeOpenUrl)
</script>

<template>
  <div class="iframe-container" :class="{ 'split-view': isSplit }">
    <!-- Persistent harness iframe - stays mounted while dev is running -->
    <iframe
      v-if="harnessVscodeReady"
      :src="harnessVscodeUrl"
      :class="{ active: isHarness && harnessDevRunning && !harnessOperationActive }"
      allow="clipboard-read; clipboard-write; cross-origin-isolated"
      @load="harnessVscodeLoaded = true"
    ></iframe>

    <!-- Persistent pipeline iframes - stay mounted for all loaded+running pipelines -->
    <template v-for="pl in pipelinesStore.pipelines" :key="pl.name">
      <iframe
        v-if="pipelinesStore.isIframeLoaded(pl.name) && pipelinesStore.isPipelineRunning(pl.name) && isViewReady(pl.name, 'vscode')"
        :src="getVscodeSrc(pl.name)"
        :class="{ active: !isHarness && isVscodeActive(pl.name), 'split-left': isSplit && isVscodeActive(pl.name) }"
        allow="clipboard-read; clipboard-write; cross-origin-isolated"
        @load="onIframeLoad(pl.name, 'vscode')"
      ></iframe>

      <iframe
        v-if="shouldShowBrowser(pl.name, pl.browserPort)"
        :src="getEffectiveBrowserSrc(pl.name)"
        :class="{ active: !isHarness && isBrowserActive(pl.name), 'split-right': isSplit && isBrowserActive(pl.name) }"
        @load="onIframeLoad(pl.name, 'browser')"
      ></iframe>
    </template>

    <!-- Overlays - rendered on top based on current view state -->
    <template v-if="isHarness">
      <div v-if="harnessOperationActive" class="loading-overlay">
        <div class="harness-logs-container">
          <div class="status-container">
            <Spinner />
          </div>
          <div class="harness-logs" ref="logsContainer">
            <div v-for="(log, i) in harnessLogs" :key="i" class="harness-log-line">{{ log }}</div>
          </div>
        </div>
      </div>
      <div v-else-if="!harnessDevRunning" class="loading-overlay">
        <div class="not-running-container">
          <span class="not-running-message">Dev environment is not running</span>
          <button class="start-btn" @click="handleHarnessStart">
            <PlayIcon />
            Start Dev Environment
          </button>
        </div>
      </div>
      <div v-else-if="!harnessVscodeLoaded" class="loading-overlay">
        <div class="status-container">
          <Spinner />
          <span>Loading VSCode...</span>
        </div>
      </div>
    </template>

    <template v-else>
      <div v-if="uiStore.isLoading" class="loading-overlay">
        {{ uiStore.loadingMessage }}
      </div>
      <div v-else-if="noPipelines" class="loading-overlay">
        No pipelines yet. Click "+ New" to create one.
      </div>
      <div v-else-if="isStopping" class="loading-overlay">
        <div class="status-container">
          <Spinner />
          <span>Stopping {{ pipelineId }}...</span>
        </div>
      </div>
      <div v-else-if="isStarting" class="loading-overlay">
        <div class="status-container">
          <Spinner />
          <span>Starting {{ pipelineId }}...</span>
        </div>
      </div>
      <div v-else-if="pipelineId && !isRunning" class="loading-overlay">
        <div class="not-running-container">
          <span class="not-running-message">Container is not running</span>
          <button class="start-btn" @click="handleStart">
            <PlayIcon />
            Start Container
          </button>
        </div>
      </div>
      <!-- VSCode/Browser loading spinners for active project -->
      <template v-else-if="pipelineId">
        <div
          v-if="pipelineId && pipelinesStore.isIframeLoaded(pipelineId) && isRunning && isVscodeActive(pipelineId) && !isViewLoaded(pipelineId, 'vscode')"
          class="loading-overlay"
          :class="{ 'split-left': isSplit }"
        >
          <div class="status-container">
            <Spinner />
            <span>Loading VSCode...</span>
          </div>
        </div>
        <div
          v-if="pipelineId && pipelinesStore.isIframeLoaded(pipelineId) && isRunning && isBrowserActive(pipelineId) && !isViewLoaded(pipelineId, 'browser')"
          class="loading-overlay"
          :class="{ 'split-right': isSplit }"
        >
          <div class="status-container">
            <Spinner />
            <span>Loading Browser...</span>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.iframe-container {
  flex: 1;
  position: relative;
}

.iframe-container iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  visibility: hidden;
  pointer-events: none;
}

.iframe-container iframe.active {
  visibility: visible;
  pointer-events: auto;
}

.iframe-container iframe.active.split-left {
  width: 50%;
}

.iframe-container iframe.active.split-right {
  width: 50%;
  left: 50%;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  z-index: 10;
}

.loading-overlay.split-left {
  right: 50%;
}

.loading-overlay.split-right {
  left: 50%;
}

.not-running-container,
.status-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-lg);
}

.not-running-message {
  color: var(--color-text-muted);
  font-size: var(--font-size-lg);
}

.start-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  background: var(--color-accent);
  color: var(--color-bg-primary);
  border: none;
  padding: var(--spacing-md) var(--spacing-xl);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-md);
  font-family: inherit;
  font-weight: 500;
  transition: background var(--transition-fast);
}

.start-btn:hover {
  background: var(--color-accent-hover);
}

.start-btn svg {
  width: 20px;
  height: 20px;
}

.harness-logs-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-lg);
  max-width: 600px;
  width: 100%;
}

.harness-logs {
  width: 100%;
  max-height: 300px;
  overflow-y: auto;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  font-family: monospace;
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.harness-log-line {
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
