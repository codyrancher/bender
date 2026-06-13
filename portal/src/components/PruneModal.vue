<script setup lang="ts">
// Docker system-prune modal: runs the prune, streams its log lines, and emits
// `pruned` on success so the opener can refresh anything affected (disk stats).
import { ref } from 'vue'
import { api } from '@/services/api'
import { useScrollToBottom } from '@/composables/useScrollToBottom'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'pruned'): void }>()

const running = ref(false)
const logs = ref<string[]>([])
const logContainer = ref<HTMLElement | null>(null)
useScrollToBottom(logContainer, () => logs.value.length)

async function runPrune() {
  if (running.value) return
  running.value = true
  logs.value = []
  try {
    await api.systemPrune((msg) => {
      logs.value.push(msg)
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
  <Modal v-if="open" title="Docker System Prune" @close="close">
    <div class="prune-body">
      <p class="prune-desc">This will remove all unused containers, networks, images, and volumes.</p>
      <div v-if="logs.length" ref="logContainer" class="prune-logs">
        <div v-for="(line, i) in logs" :key="i" class="prune-log-line">{{ line }}</div>
      </div>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="running" @click="close">
        {{ logs.length && !running ? 'Close' : 'Cancel' }}
      </Button>
      <Button v-if="!logs.length || running" variant="primary" :disabled="running" @click="runPrune">
        {{ running ? 'Running...' : 'Run Prune' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.prune-body {
  padding: var(--spacing-xl);
}

.prune-desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin: 0 0 var(--spacing-lg);
}

.prune-logs {
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-medium);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm);
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  font-size: var(--font-size-xs);
}

.prune-log-line {
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
