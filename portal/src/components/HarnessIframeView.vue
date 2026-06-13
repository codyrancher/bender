<script setup lang="ts">
// The harness dev VS Code iframe plus its overlays (working/not-running/loading).
// Always mounted so the iframe survives navigating away (shown only when on the
// harness route, via the `active` class) — never v-if'd out, or it would reload.
import { computed, ref, watch, onUnmounted } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import { useIsHarness } from '@/composables/route'
import { getVscodeUrl } from '@/services/urls'
import { pollUrl } from '@/utils/pollUrl'
import { useScrollToBottom } from '@/composables/useScrollToBottom'
import Spinner from './primitives/Spinner.vue'
import PlayIcon from '@/assets/icons/play.svg?component'

const pipelinesStore = usePipelinesStore()
const isHarness = useIsHarness()

const devRunning = computed(() => pipelinesStore.harnessStatus.devRunning)
const operationActive = computed(() => pipelinesStore.harnessOperationActive)
const logs = computed(() => pipelinesStore.harnessLogs)
const vscodeUrl = getVscodeUrl('bender-dev')
const vscodeReady = ref(false)
const vscodeLoaded = ref(false)

// Auto-scroll logs to the bottom as they stream in.
const logsContainer = ref<HTMLElement | null>(null)
useScrollToBottom(logsContainer, () => logs.value.length)

let pollTimer: ReturnType<typeof setTimeout> | null = null

async function pollVscode() {
  if (vscodeReady.value) return
  if (await pollUrl(vscodeUrl)) {
    vscodeReady.value = true
  } else {
    pollTimer = setTimeout(pollVscode, 2000)
  }
}

// Poll the harness VS Code URL whenever dev is running.
watch(
  () => pipelinesStore.harnessStatus.devRunning,
  (running) => {
    if (running && !vscodeReady.value) {
      pollVscode()
    } else if (!running) {
      vscodeReady.value = false
      vscodeLoaded.value = false
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer)
})

async function handleStart() {
  await pipelinesStore.harnessAction('start')
}
</script>

<template>
  <iframe
    v-if="vscodeReady"
    :src="vscodeUrl"
    class="harness-frame"
    :class="{ active: isHarness && devRunning && !operationActive }"
    allow="clipboard-read; clipboard-write; cross-origin-isolated"
    @load="vscodeLoaded = true"
  ></iframe>

  <template v-if="isHarness">
    <div v-if="operationActive" class="loading-overlay">
      <div class="harness-logs-container">
        <div class="status-container">
          <Spinner />
        </div>
        <div class="harness-logs" ref="logsContainer">
          <div v-for="(log, i) in logs" :key="i" class="harness-log-line">{{ log }}</div>
        </div>
      </div>
    </div>
    <div v-else-if="!devRunning" class="loading-overlay">
      <div class="not-running-container">
        <span class="not-running-message">Dev environment is not running</span>
        <button class="start-btn" @click="handleStart">
          <PlayIcon />
          Start Dev Environment
        </button>
      </div>
    </div>
    <div v-else-if="!vscodeLoaded" class="loading-overlay">
      <div class="status-container">
        <Spinner />
        <span>Loading VSCode...</span>
      </div>
    </div>
  </template>
</template>

<style scoped>
.harness-frame {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  visibility: hidden;
  pointer-events: none;
}

.harness-frame.active {
  visibility: visible;
  pointer-events: auto;
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
