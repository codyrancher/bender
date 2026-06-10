<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

defineProps<{
  title?: string
  subtitle?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="vp-overlay">
      <div class="vp-bar">
        <div class="vp-title-area">
          <slot name="title">
            <span class="vp-title">{{ title }}</span>
            <span v-if="subtitle" class="vp-subtitle">{{ subtitle }}</span>
          </slot>
        </div>
        <div class="vp-actions">
          <slot name="actions" />
          <button class="vp-close" @click="emit('close')">✕ Close</button>
        </div>
      </div>
      <div class="vp-body">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.vp-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-bg-primary);
  z-index: 1300;
  display: flex;
  flex-direction: column;
}

.vp-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border-dark);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
}

.vp-title-area {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.vp-title {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vp-subtitle {
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vp-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.vp-close {
  padding: 6px 14px;
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.vp-close:hover {
  background: var(--color-bg-element);
  border-color: var(--color-accent);
}

.vp-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}
</style>
