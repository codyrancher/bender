<script setup lang="ts">
// Read-only preview of a pipeline definition's stage graph. Each node is a
// button that asks the editor to jump to that stage's section.
import PipelineGraph from './PipelineGraph.vue'

defineProps<{ stages: Array<{ name: string; skill: string; next: number[] }> }>()
const emit = defineEmits<{ (e: 'jump', index: number): void }>()
</script>

<template>
  <PipelineGraph v-if="stages.length" :stages="stages">
    <template #node="{ stage, index }">
      <button type="button" class="defs-gnode" title="Jump to this stage in the editor" @click="emit('jump', index)">
        <span class="defs-gnode-name">{{ stage.name }}</span>
        <span class="defs-gnode-skill">{{ stage.skill }}</span>
      </button>
    </template>
  </PipelineGraph>
  <div v-else class="defs-empty">No valid graph yet — add stages below</div>
</template>

<style scoped>
.defs-gnode {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  text-align: left;
  gap: 2px;
  padding: 8px 12px;
  background: var(--color-bg-element);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
}

.defs-gnode:hover { border-color: var(--color-accent); background: var(--color-bg-element-hover); }

.defs-gnode-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.defs-gnode-skill { font-size: 11px; color: var(--color-text-muted); }

.defs-empty { font-size: 12px; color: var(--color-text-muted); }
</style>
