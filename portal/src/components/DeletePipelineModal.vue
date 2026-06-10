<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { getPipelineIdFromRoute } from '@/router'

const router = useRouter()
const route = useRoute()
const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const isDeleting = ref(false)
const logs = ref<string[]>([])
const logContainer = ref<HTMLElement | null>(null)

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
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

async function handleDelete() {
  const name = uiStore.deletePipelineName
  if (!name || isDeleting.value) return

  isDeleting.value = true
  const wasActive = getPipelineIdFromRoute(route) === name
  try {
    await pipelinesStore.deletePipeline(name, appendLog)
    uiStore.closeDeletePipelineModal()
    if (wasActive) {
      const remaining = pipelinesStore.pipelines
      if (remaining.length > 0) {
        router.replace(`/${remaining[0].name}/vscode`)
      } else {
        router.replace('/')
      }
    }
  } catch {
    isDeleting.value = false
  }
}

let mouseDownOnOverlay = false

function handleOverlayMousedown(e: MouseEvent) {
  mouseDownOnOverlay = e.target === e.currentTarget
}

function handleOverlayMouseup(e: MouseEvent) {
  if (mouseDownOnOverlay && e.target === e.currentTarget && !isDeleting.value) {
    uiStore.closeDeletePipelineModal()
  }
  mouseDownOnOverlay = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !isDeleting.value) {
    uiStore.closeDeletePipelineModal()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="uiStore.deletePipelineName"
      class="modal-overlay"
      @mousedown="handleOverlayMousedown"
      @mouseup="handleOverlayMouseup"
      @keydown="handleKeydown"
    >
      <div class="modal" :class="{ 'modal-wide': isDeleting && logs.length > 0 }">
        <template v-if="!isDeleting">
          <h2>Delete Pipeline</h2>
          <p class="message">
            Are you sure you want to delete
            <strong>{{ uiStore.deletePipelineName }}</strong>?
            This will stop the container and remove all pipeline files.
          </p>
          <div class="modal-buttons">
            <button
              class="modal-btn cancel"
              @click="uiStore.closeDeletePipelineModal"
            >
              Cancel
            </button>
            <button
              class="modal-btn delete"
              @click="handleDelete"
            >
              Delete
            </button>
          </div>
        </template>
        <template v-else>
          <div class="deleting">
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
        </template>
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
  min-width: var(--size-modal-min-width);
  max-width: 400px;
  box-shadow: 0 var(--spacing-xs) var(--spacing-xl) var(--color-shadow-dark);
}

.modal.modal-wide {
  max-width: 520px;
  width: 520px;
}

.modal h2 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-lg);
  font-weight: 500;
}

.message {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: 1.5;
  margin-bottom: var(--spacing-lg);
}

.message strong {
  color: var(--color-text-primary);
}

.modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

.modal-btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.modal-btn.cancel {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
}

.modal-btn.cancel:hover {
  background: var(--color-bg-element-hover);
  color: var(--color-text-hover);
}

.modal-btn.delete {
  background: var(--color-error);
  color: white;
  font-weight: 500;
}

.modal-btn.delete:hover {
  opacity: 0.9;
}

.deleting {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
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
