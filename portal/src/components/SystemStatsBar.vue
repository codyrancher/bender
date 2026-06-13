<script setup lang="ts">
// Memory/disk usage bars for the bottom bar. Self-fetches on an interval; the
// disk row is clickable to open the prune flow (parent owns the modal). Exposes
// refresh() so the parent can re-pull after a prune completes.
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '@/services/api'

const emit = defineEmits<{ (e: 'open-prune'): void }>()

const stats = ref<{ memTotal: number; memUsed: number; diskTotal: number; diskUsed: number } | null>(null)
let interval: ReturnType<typeof setInterval> | undefined

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB'
  return (bytes / 1e3).toFixed(0) + ' KB'
}

function memPercent(): number {
  if (!stats.value) return 0
  return Math.round((stats.value.memUsed / stats.value.memTotal) * 100)
}

function diskPercent(): number {
  if (!stats.value) return 0
  return Math.round((stats.value.diskUsed / stats.value.diskTotal) * 100)
}

async function fetchStats() {
  try {
    stats.value = await api.getSystemStats()
  } catch { /* ignore */ }
}

onMounted(() => {
  fetchStats()
  interval = setInterval(fetchStats, 30_000)
})

onUnmounted(() => {
  if (interval) clearInterval(interval)
})

defineExpose({ refresh: fetchStats })
</script>

<template>
  <div v-if="stats" class="system-stats">
    <div class="stat-row">
      <span class="stat-label">MEM</span>
      <div class="stat-bar"><div class="stat-fill" :style="{ width: memPercent() + '%' }" :class="{ warn: memPercent() > 80 }"></div></div>
      <span class="stat-value">{{ formatBytes(stats.memUsed) }}</span>
    </div>
    <div class="stat-row clickable" @click="emit('open-prune')">
      <span class="stat-label">DISK</span>
      <div class="stat-bar"><div class="stat-fill" :style="{ width: diskPercent() + '%' }" :class="{ warn: diskPercent() > 80 }"></div></div>
      <span class="stat-value">{{ formatBytes(stats.diskUsed) }}</span>
    </div>
  </div>
</template>

<style scoped>
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
</style>
