<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import PipelineTab from './PipelineTab.vue'
import type { Pipeline, PipelineGroup, ViewMode } from '@/types'
import blankIcon from '@/assets/icons/blank.svg'
import vueIcon from '@/assets/icons/vue.svg'
import rancherIcon from '@/assets/icons/rancher.svg'
import PlusIcon from '@/assets/icons/plus.svg?component'

// Maps group ID to template ID for the new project modal
const GROUP_TEMPLATE_MAP: Record<string, string | undefined> = {
  blank: 'blank',
  vue3: 'vue3-hello-world',
  rancher: 'rancher-dashboard',
}

const props = defineProps<{
  groupId: PipelineGroup
  label: string
  pipelines: Pipeline[]
  activePipelineId: string | null
  viewMode: ViewMode
  collapsed: boolean
}>()

const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const isExpanded = computed(() => !pipelinesStore.isGroupCollapsed(props.groupId))
const isDragOver = ref(false)

function toggleExpanded() {
  pipelinesStore.toggleGroupCollapsed(props.groupId)
}

function handleDragOver(e: DragEvent) {
  if (pipelinesStore.isDraggingPipeline) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    isDragOver.value = true
  }
}

function handleDragLeave() {
  isDragOver.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  const pipelineName = e.dataTransfer?.getData('text/pipeline-name')
  if (pipelineName) {
    pipelinesStore.setPipelineGroupOverride(pipelineName, props.groupId)
  }
}

const groupIconSrc = computed(() => {
  switch (props.groupId) {
    case 'vue3': return vueIcon
    case 'rancher': return rancherIcon
    default: return blankIcon
  }
})
</script>

<template>
  <div
    class="project-group"
    v-if="pipelines.length > 0 || (isDragOver || pipelinesStore.isDraggingPipeline)"
  >
    <button
      class="group-header"
      :class="{ 'drag-over': isDragOver }"
      @click="toggleExpanded"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <img class="group-icon" :src="groupIconSrc" :alt="label" />
      <span v-if="!collapsed" class="group-label">{{ label }}</span>
      <button
        v-if="!collapsed"
        class="group-add"
        title="New pipeline"
        @click.stop="uiStore.openNewPipelineModal(GROUP_TEMPLATE_MAP[groupId])"
      >
        <PlusIcon />
      </button>
    </button>
    <div v-if="isExpanded" class="group-projects">
      <PipelineTab
        v-for="pl in pipelines"
        :key="pl.name"
        :pipeline="pl"
        :is-active="pl.name === activePipelineId"
        :view-mode="viewMode"
        :collapsed="collapsed"
      />
    </div>
  </div>
</template>

<style scoped>
.project-group {
  border-bottom: var(--border-width-sm) solid var(--color-bg-element);
}

.group-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  height: 40px;
  padding: 0 var(--spacing-lg);
  border: none;
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs, 11px);
  font-family: inherit;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}

.group-header:hover {
  color: var(--color-text-hover);
  background: var(--color-bg-element);
}

.group-header.drag-over {
  background: var(--color-accent);
  color: var(--color-text-bright);
}

.group-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.group-projects {
  background: rgba(0, 0, 0, 0.15);
  box-shadow: inset 0 4px 8px rgba(0, 0, 0, 0.25), inset 0 1px 2px rgba(0, 0, 0, 0.2);
}

.group-label {
  flex: 1;
  text-align: left;
}

.group-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: var(--radius-xs);
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
  flex-shrink: 0;
}

.group-add svg {
  width: 12px;
  height: 12px;
}

.group-header:hover .group-add {
  opacity: 1;
}

.group-add:hover {
  color: var(--color-accent);
  background: var(--color-bg-element-hover);
}

</style>
