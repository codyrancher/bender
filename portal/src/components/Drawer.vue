<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{ open: boolean }>()

// Lazy-mount the content on first open, then keep it alive — we collapse the
// panel to height 0 when closed but never unmount it, so anything stateful
// inside (a terminal's PTY/websocket session) survives the drawer closing.
const mountedOnce = ref(false)
watch(() => props.open, (open) => { if (open) mountedOnce.value = true })

// Panel height, resizable by dragging the top handle. Docked above the bottom
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
  if (!props.open) return
  dragStartY = e.clientY
  dragStartH = height.value
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

onBeforeUnmount(onDragEnd)
</script>

<template>
  <div class="drawer" :style="{ height: open ? height + 'px' : '0px' }">
    <div class="drawer-handle" title="Drag to resize" @pointerdown="startResize">
      <span class="drawer-grip"></span>
    </div>
    <!-- Mounted on first open, then kept alive so the session persists. -->
    <div v-if="mountedOnce" class="drawer-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.drawer {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #1a1418;
  border-top: 1px solid var(--color-border-dark);
  transition: height 0.2s ease;
}

.drawer-handle {
  height: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ns-resize;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border-dark);
}

.drawer-grip {
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: var(--color-border-medium);
}

.drawer-handle:hover .drawer-grip {
  background: var(--color-text-muted);
}

.drawer-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
