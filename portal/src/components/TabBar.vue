<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { useUiStore } from '@/stores/ui'
import Button from './primitives/Button.vue'
import GridIcon from '@/assets/icons/grid.svg?component'
import BookIcon from '@/assets/icons/book.svg?component'
import SettingsIcon from '@/assets/icons/settings.svg?component'
import TerminalIcon from '@/assets/icons/terminal.svg?component'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const systemStats = ref<{ memTotal: number; memUsed: number; diskTotal: number; diskUsed: number } | null>(null)
const showPruneModal = ref(false)
const pruneRunning = ref(false)
const pruneLogs = ref<string[]>([])
const pruneLogContainer = ref<HTMLElement | null>(null)
let statsInterval: ReturnType<typeof setInterval> | undefined

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB'
  return (bytes / 1e3).toFixed(0) + ' KB'
}

function memPercent(): number {
  if (!systemStats.value) return 0
  return Math.round((systemStats.value.memUsed / systemStats.value.memTotal) * 100)
}

function diskPercent(): number {
  if (!systemStats.value) return 0
  return Math.round((systemStats.value.diskUsed / systemStats.value.diskTotal) * 100)
}

async function fetchStats() {
  try {
    systemStats.value = await api.getSystemStats()
  } catch { /* ignore */ }
}

async function runPrune() {
  if (pruneRunning.value) return
  pruneRunning.value = true
  pruneLogs.value = []
  try {
    await api.systemPrune((msg) => {
      pruneLogs.value.push(msg)
      nextTick(() => {
        if (pruneLogContainer.value) {
          pruneLogContainer.value.scrollTop = pruneLogContainer.value.scrollHeight
        }
      })
    })
    pruneLogs.value.push('--- Prune complete ---')
    fetchStats()
  } catch (err) {
    pruneLogs.value.push(`Error: ${err}`)
  } finally {
    pruneRunning.value = false
  }
}

const isHome = computed(() => route.name === 'home')
const isDefinitions = computed(() => route.name === 'definitions')
const isSettings = computed(() => route.name === 'settings')

onMounted(() => {
  fetchStats()
  statsInterval = setInterval(fetchStats, 30_000)
})

onUnmounted(() => {
  if (statsInterval) clearInterval(statsInterval)
})
</script>

<template>
  <div class="bottom-bar">
    <div class="bottom-actions">
      <button
        class="bottom-icon-btn"
        :class="{ active: isHome }"
        title="Pipelines"
        @click="router.push('/')"
      >
        <GridIcon />
      </button>
      <button
        class="bottom-icon-btn"
        :class="{ active: isDefinitions }"
        title="Pipeline Definitions"
        @click="router.push('/definitions')"
      >
        <BookIcon />
      </button>
      <button
        class="bottom-icon-btn"
        :class="{ active: isSettings }"
        title="Settings"
        @click="router.push('/settings')"
      >
        <SettingsIcon />
      </button>
    </div>

    <!-- Centered terminal toggle: opens the global terminal as a bottom drawer
         so it's reachable on any page without losing the session. -->
    <button
      class="bottom-icon-btn term-toggle"
      :class="{ active: ui.terminalOpen }"
      title="Terminal (global Claude CLI)"
      @click="ui.toggleTerminal()"
    >
      <TerminalIcon />
    </button>

    <div v-if="systemStats" class="system-stats">
      <div class="stat-row">
        <span class="stat-label">MEM</span>
        <div class="stat-bar"><div class="stat-fill" :style="{ width: memPercent() + '%' }" :class="{ warn: memPercent() > 80 }"></div></div>
        <span class="stat-value">{{ formatBytes(systemStats.memUsed) }}</span>
      </div>
      <div class="stat-row clickable" @click="showPruneModal = true">
        <span class="stat-label">DISK</span>
        <div class="stat-bar"><div class="stat-fill" :style="{ width: diskPercent() + '%' }" :class="{ warn: diskPercent() > 80 }"></div></div>
        <span class="stat-value">{{ formatBytes(systemStats.diskUsed) }}</span>
      </div>
    </div>
  </div>

  <!-- Docker Prune Modal -->
  <Teleport to="body">
    <div v-if="showPruneModal" class="modal-overlay" @mousedown.self="!pruneRunning && (showPruneModal = false)">
      <div class="modal">
        <h2>Docker System Prune</h2>
        <p class="modal-desc">This will remove all unused containers, networks, images, and volumes.</p>
        <div v-if="pruneLogs.length" ref="pruneLogContainer" class="prune-logs">
          <div v-for="(line, i) in pruneLogs" :key="i" class="prune-log-line">{{ line }}</div>
        </div>
        <div class="modal-buttons">
          <Button variant="secondary" :disabled="pruneRunning" @click="showPruneModal = false">
            {{ pruneLogs.length && !pruneRunning ? 'Close' : 'Cancel' }}
          </Button>
          <Button v-if="!pruneLogs.length || pruneRunning" variant="primary" :disabled="pruneRunning" @click="runPrune">
            {{ pruneRunning ? 'Running...' : 'Run Prune' }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bottom-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 100%;
  background: var(--color-bg-secondary);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
  padding: var(--spacing-sm) var(--spacing-md);
  gap: var(--spacing-md);
}

/* Terminal toggle: centered in the bar, independent of the side groups. */
.term-toggle {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.system-stats {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  /* Match the aggregate height of the icon buttons (32px) */
  height: 32px;
  min-width: 180px;
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-label {
  font-size: 9px;
  font-weight: 600;
  color: var(--color-text-muted);
  width: 28px;
  flex-shrink: 0;
  letter-spacing: 0.03em;
}

.stat-bar {
  flex: 1;
  height: 4px;
  background: var(--color-bg-element);
  border-radius: 2px;
  overflow: hidden;
}

.stat-fill {
  height: 100%;
  background: var(--color-text-muted);
  border-radius: 2px;
  transition: width 1s ease;
}

.stat-fill.warn {
  background: var(--color-error, #e05050);
}

.stat-value {
  font-size: 9px;
  color: var(--color-text-muted);
  width: 48px;
  text-align: right;
  flex-shrink: 0;
}

.bottom-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.bottom-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.bottom-icon-btn svg {
  width: 16px;
  height: 16px;
}

.bottom-icon-btn:hover {
  background: var(--color-bg-element);
  color: var(--color-text-hover);
}

.bottom-icon-btn.active {
  color: var(--color-accent);
  background: var(--color-bg-element);
}

.stat-row.clickable {
  cursor: pointer;
  border-radius: 3px;
  padding: 1px 2px;
  margin: -1px -2px;
  transition: background var(--transition-fast);
}

.stat-row.clickable:hover {
  background: var(--color-bg-element);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-xxl);
  min-width: 400px;
  max-width: 600px;
  box-shadow: 0 var(--spacing-xs) var(--spacing-xl) var(--color-shadow-dark);
}

.modal h2 {
  margin-bottom: var(--spacing-sm);
  font-size: var(--font-size-lg);
  font-weight: 500;
}

.modal-desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-lg);
}

.prune-logs {
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-medium);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm);
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: var(--spacing-lg);
  font-family: monospace;
  font-size: var(--font-size-xs);
}

.prune-log-line {
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

</style>
