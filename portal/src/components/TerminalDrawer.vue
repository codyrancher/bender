<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useUiStore } from '@/stores/ui'
import ClaudeCliPage from './ClaudeCliPage.vue'

const ui = useUiStore()

// Keep the terminal mounted once it has been opened, so its PTY/websocket
// session survives navigation and closing the drawer (we collapse the panel to
// height 0, never unmount it — that's what "don't lose context" needs).
const mountedOnce = ref(false)
watch(() => ui.terminalOpen, (open) => { if (open) mountedOnce.value = true })

// Panel height (resizable by dragging the top handle). Docked above the bottom
// bar; opening slides the page content up, like an integrated terminal.
const height = ref(Math.round(Math.min(420, window.innerHeight * 0.45)))
let dragStartY = 0
let dragStartH = 0

function onDragMove(e: PointerEvent) {
  const delta = dragStartY - e.clientY // drag up → taller
  const max = window.innerHeight - 120
  height.value = Math.max(140, Math.min(max, dragStartH + delta))
}
function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  document.body.style.userSelect = ''
}
function startResize(e: PointerEvent) {
  if (!ui.terminalOpen) return
  dragStartY = e.clientY
  dragStartH = height.value
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

onBeforeUnmount(onDragEnd)
</script>

<template>
  <div class="term-drawer" :style="{ height: ui.terminalOpen ? height + 'px' : '0px' }">
    <div class="term-drawer-handle" title="Drag to resize" @pointerdown="startResize">
      <span class="term-drawer-grip"></span>
    </div>
    <!-- Mounted on first open, then kept alive so the session persists. -->
    <div v-if="mountedOnce" class="term-drawer-body">
      <ClaudeCliPage />
    </div>
  </div>
</template>

<style scoped>
.term-drawer {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #1a1418;
  border-top: 1px solid var(--color-border-dark);
  transition: height 0.2s ease;
}

.term-drawer-handle {
  height: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ns-resize;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border-dark);
}

.term-drawer-grip {
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: var(--color-border-medium);
}

.term-drawer-handle:hover .term-drawer-grip {
  background: var(--color-text-muted);
}

.term-drawer-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
