<script setup lang="ts">
// The expandable history container shared by run history and stage history:
// a bordered panel with an uppercase title and an optional close button.
defineProps<{ title?: string; closable?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div class="history-drawer">
    <div class="hd-header">
      <slot name="title"><span class="hd-title">{{ title }}</span></slot>
      <button v-if="closable" class="hd-close" title="Close" @click="emit('close')">✕</button>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.history-drawer {
  border-top: 1px solid var(--color-border-dark);
  padding: 12px 20px 16px;
  background: var(--color-bg-primary);
}

.hd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.hd-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hd-close {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
}
.hd-close:hover { color: var(--color-text-primary); }
</style>
