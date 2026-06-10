<script setup lang="ts">
import { ref } from 'vue'
import { useUiStore } from '@/stores/ui'

const uiStore = useUiStore()

const justCopied = ref<number | null>(null)

async function copy(toastId: number, text: string) {
  try {
    await navigator.clipboard.writeText(text)
    justCopied.value = toastId
    setTimeout(() => { if (justCopied.value === toastId) justCopied.value = null }, 1500)
  } catch { /* clipboard blocked — silent fail */ }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-for="toast in uiStore.toasts"
      :key="toast.id"
      class="toast"
      :class="toast.type"
    >
      <span class="toast-message">{{ toast.message }}</span>
      <a
        v-if="toast.action"
        class="toast-action"
        :href="toast.action.href"
        :target="toast.action.target"
        :rel="toast.action.target === '_blank' ? 'noopener' : undefined"
      >{{ toast.action.label }}</a>
      <button
        v-if="toast.copyText"
        class="toast-copy"
        :title="`Click to copy: ${toast.copyText.text}`"
        @click="copy(toast.id, toast.copyText.text)"
      >{{ justCopied === toast.id ? 'Copied!' : toast.copyText.label }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: var(--spacing-xl);
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  padding: var(--spacing-md) var(--spacing-xl);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  z-index: 1001;
  box-shadow: 0 var(--spacing-xs) var(--spacing-md) var(--color-shadow-medium);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.toast.success {
  border-left: var(--border-width-md) solid var(--color-accent);
}

.toast.error {
  border-left: var(--border-width-md) solid var(--color-error);
}

.toast.info {
  border-left: var(--border-width-md) solid var(--color-accent);
}

.toast-action {
  color: var(--color-accent);
  text-decoration: underline;
  font-weight: 500;
  white-space: nowrap;
}

.toast-action:hover {
  opacity: 0.8;
}

.toast-copy {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  padding: 2px 8px;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  white-space: nowrap;
}

.toast-copy:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}
</style>
