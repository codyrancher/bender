<script setup lang="ts">
// Docker system-prune modal: runs the prune, streams its log lines, and emits
// `pruned` on success so the opener can refresh anything affected (disk stats).
import { ref, nextTick } from 'vue'
import { api } from '@/services/api'
import Button from './primitives/Button.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'pruned'): void }>()

const running = ref(false)
const logs = ref<string[]>([])
const logContainer = ref<HTMLElement | null>(null)

async function runPrune() {
  if (running.value) return
  running.value = true
  logs.value = []
  try {
    await api.systemPrune((msg) => {
      logs.value.push(msg)
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight
        }
      })
    })
    logs.value.push('--- Prune complete ---')
    emit('pruned')
  } catch (err) {
    logs.value.push(`Error: ${err}`)
  } finally {
    running.value = false
  }
}

function close() {
  if (running.value) return
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @mousedown.self="close">
      <div class="modal">
        <h2>Docker System Prune</h2>
        <p class="modal-desc">This will remove all unused containers, networks, images, and volumes.</p>
        <div v-if="logs.length" ref="logContainer" class="prune-logs">
          <div v-for="(line, i) in logs" :key="i" class="prune-log-line">{{ line }}</div>
        </div>
        <div class="modal-buttons">
          <Button variant="secondary" :disabled="running" @click="close">
            {{ logs.length && !running ? 'Close' : 'Cancel' }}
          </Button>
          <Button v-if="!logs.length || running" variant="primary" :disabled="running" @click="runPrune">
            {{ running ? 'Running...' : 'Run Prune' }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
