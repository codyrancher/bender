<script setup lang="ts">
import { onMounted, onUnmounted, useSlots } from 'vue'

defineProps<{
  title?: string
  subtitle?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()
const slots = useSlots()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @mousedown.self="emit('close')">
      <div class="modal-box">
        <div class="modal-head">
          <div class="modal-title-area">
            <slot name="title">
              <h3 class="modal-title">{{ title }}</h3>
              <span v-if="subtitle" class="modal-subtitle">{{ subtitle }}</span>
            </slot>
          </div>
          <button class="modal-x" @click="emit('close')">✕</button>
        </div>
        <div class="modal-content">
          <slot />
        </div>
        <div v-if="slots.footer" class="modal-foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 10px;
  width: 50vw;
  min-width: 480px;
  max-width: 1000px;
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px var(--color-shadow-dark);
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}

.modal-title-area {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.modal-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
}

.modal-x {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.modal-x:hover {
  background: var(--color-bg-element);
  color: var(--color-text-hover);
}

.modal-content {
  overflow-y: auto;
  flex: 1;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}
</style>
