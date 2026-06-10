<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTemplateIdFromRoute } from '@/router'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'

const route = useRoute()
const router = useRouter()
const uiStore = useUiStore()

const templateId = computed(() => getTemplateIdFromRoute(route))
const stopping = ref(false)

function goBack() {
  router.push('/settings')
}

async function stopEditor() {
  if (!templateId.value || stopping.value) return
  stopping.value = true
  try {
    await api.stopTemplateEditor(templateId.value)
    uiStore.showToast('Template editor stopped')
    router.push('/settings')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to stop editor'
    uiStore.showToast(message, 'error')
  } finally {
    stopping.value = false
  }
}
</script>

<template>
  <div class="template-editor-toolbar">
    <button class="back-btn" @click="goBack" title="Back to settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    </button>
    <div class="toolbar-info">
      <span class="toolbar-label">Template Editor</span>
      <span class="toolbar-template-id">{{ templateId }}</span>
    </div>
    <div class="toolbar-spacer" />
    <button class="stop-btn" :disabled="stopping" @click="stopEditor">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </svg>
      {{ stopping ? 'Stopping...' : 'Stop Editor' }}
    </button>
  </div>
</template>

<style scoped>
.template-editor-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-bg-secondary);
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
  min-height: 40px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-muted);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.back-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-element-hover);
}

.back-btn svg {
  width: 18px;
  height: 18px;
}

.toolbar-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.toolbar-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}

.toolbar-template-id {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-family: monospace;
}

.toolbar-spacer {
  flex: 1;
}

.stop-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-bg-element-hover);
  color: var(--color-text-primary);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: inherit;
  font-weight: 500;
  transition: background var(--transition-fast);
}

.stop-btn:hover {
  background: var(--color-border-dark);
}

.stop-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.stop-btn svg {
  width: 14px;
  height: 14px;
}
</style>
