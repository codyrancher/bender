<script setup lang="ts">
import { ref, watch } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { useScrollToBottom } from '@/composables/useScrollToBottom'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'

const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const isDeleting = ref(false)
const logs = ref<string[]>([])
const logContainer = ref<HTMLElement | null>(null)
useScrollToBottom(logContainer, () => logs.value.length)

watch(
  () => uiStore.deletePipelineName,
  (name) => {
    if (name) {
      isDeleting.value = false
      logs.value = []
    }
  }
)

function appendLog(message: string) {
  logs.value.push(message)
}

// Closing is blocked while a delete is streaming.
function close() {
  if (!isDeleting.value) uiStore.closeDeletePipelineModal()
}

async function handleDelete() {
  const name = uiStore.deletePipelineName
  if (!name || isDeleting.value) return

  isDeleting.value = true
  try {
    await pipelinesStore.deletePipeline(name, appendLog)
    uiStore.closeDeletePipelineModal()
  } catch {
    isDeleting.value = false
  }
}
</script>

<template>
  <Modal v-if="uiStore.deletePipelineName" title="Delete Pipeline" @close="close">
    <div class="dp-body">
      <p v-if="!isDeleting" class="message">
        Are you sure you want to delete
        <strong>{{ uiStore.deletePipelineName }}</strong>?
        This will stop the container and remove all pipeline files.
      </p>
      <div v-else class="deleting">
        <div class="deleting-header">
          <div class="spinner"></div>
          <p>Shutting down <strong>{{ uiStore.deletePipelineName }}</strong>...</p>
        </div>
        <div
          v-if="logs.length > 0"
          ref="logContainer"
          class="log-output"
        >
          <div v-for="(line, i) in logs" :key="i" class="log-line">{{ line }}</div>
        </div>
        <p v-else class="sub">Starting cleanup...</p>
      </div>
    </div>
    <template v-if="!isDeleting" #footer>
      <Button variant="secondary" @click="close">Cancel</Button>
      <Button variant="danger" @click="handleDelete">Delete</Button>
    </template>
  </Modal>
</template>

<style scoped>
.dp-body {
  padding: var(--spacing-xl);
}

.message {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 0;
}

.message strong {
  color: var(--color-text-primary);
}

.deleting {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.deleting-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.deleting-header p {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.deleting-header strong {
  color: var(--color-text-bright);
}

.deleting .sub {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.log-output {
  background: var(--color-bg-primary);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  max-height: 200px;
  overflow-y: auto;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 11px;
  line-height: 1.6;
}

.log-line {
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-all;
}

.spinner {
  width: 20px;
  height: 20px;
  min-width: 20px;
  border: 2px solid var(--color-bg-element);
  border-top-color: var(--color-accent);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
