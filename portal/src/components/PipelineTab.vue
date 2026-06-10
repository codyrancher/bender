<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { usePipelinesStore } from '@/stores/pipelines'
import type { Pipeline, ViewMode } from '@/types'

const props = defineProps<{
  pipeline: Pipeline
  isActive: boolean
  viewMode: ViewMode
  collapsed?: boolean
}>()

const uiStore = useUiStore()
const pipelinesStore = usePipelinesStore()

const isDraggable = computed(() => pipelinesStore.isPipelineDraggable(props.pipeline))

function handleDragStart(e: DragEvent) {
  if (!isDraggable.value) return
  e.dataTransfer!.setData('text/pipeline-name', props.pipeline.name)
  e.dataTransfer!.effectAllowed = 'move'
  pipelinesStore.isDraggingPipeline = true
}

function handleDragEnd() {
  pipelinesStore.isDraggingPipeline = false
}
</script>

<template>
  <RouterLink
    class="tab"
    :class="{ active: isActive, draggable: isDraggable }"
    :to="`/${pipeline.name}/${viewMode}`"
    :draggable="isDraggable"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
  >
    <span class="status" :class="pipeline.status"></span>
    <span v-if="!collapsed" class="name">{{ pipeline.name }}</span>
    <span
      v-if="!collapsed"
      class="delete-btn"
      title="Delete pipeline"
      @click.prevent.stop="uiStore.openDeletePipelineModal(pipeline.name)"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
        <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M4 4v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4" />
        <line x1="6.5" y1="7" x2="6.5" y2="11" />
        <line x1="9.5" y1="7" x2="9.5" y2="11" />
      </svg>
    </span>
  </RouterLink>
</template>

<style scoped>
.tab {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  height: 30px;
  padding: 0 var(--spacing-lg);
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-family: inherit;
  border-radius: 0;
  border-left: var(--border-width-md) solid transparent;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  text-align: left;
  width: 100%;
  text-decoration: none;
}

.tab.draggable {
  cursor: grab;
}

.tab.draggable:active {
  cursor: grabbing;
}

.tab:hover {
  background: var(--color-bg-element);
  color: var(--color-text-hover);
}

.tab.active {
  background: var(--color-bg-primary);
  color: var(--color-text-bright);
  border-left-color: var(--color-accent);
}

.status {
  width: var(--size-status-indicator);
  height: var(--size-status-indicator);
  border-radius: var(--radius-full);
  background: var(--color-status-default);
  flex-shrink: 0;
}

.status.running {
  background: var(--color-status-running);
}

.status.stopped {
  background: var(--color-status-stopped);
}

.name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  color: var(--color-text-muted);
  opacity: 0.3;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.tab:hover .delete-btn {
  opacity: 0.7;
}

.delete-btn:hover {
  color: var(--color-error);
  background: var(--color-bg-element-hover);
}

.delete-btn svg {
  width: 12px;
  height: 12px;
}
</style>
