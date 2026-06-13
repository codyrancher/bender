<script setup lang="ts">
// Left sidebar of the pipeline-definitions browser: the list plus create / import.
import { ref } from 'vue'

interface DefSummary { id: string; name: string; stages: any[]; skills: string[] }

defineProps<{
  definitions: DefSummary[]
  selectedId: string | null
  creating: boolean
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create', id: string): void
  (e: 'import'): void
}>()

const newId = ref('')

function create() {
  const id = newId.value.trim()
  if (!id) return
  emit('create', id)
  newId.value = ''
}
</script>

<template>
  <div class="defs-list">
    <div class="defs-list-header">{{ definitions.length }} definitions</div>
    <button
      v-for="d in definitions"
      :key="d.id"
      class="defs-item"
      :class="{ active: selectedId === d.id }"
      @click="emit('select', d.id)"
    >
      <span class="defs-item-name">{{ d.name }}</span>
      <span class="defs-item-meta">{{ d.stages.length }} stages · {{ d.skills.length }} skills</span>
    </button>
    <div class="defs-create">
      <input v-model="newId" placeholder="new-definition-id" @keydown.enter="create" />
      <button class="defs-create-btn" :disabled="creating || !newId.trim()" @click="create">+ Create</button>
      <button class="defs-create-btn alt" title="Import a running pipeline's pipeline.md + skills as a definition" @click="emit('import')">↑ From pipeline</button>
    </div>
  </div>
</template>

<style scoped>
.defs-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-dark);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
}

.defs-list-header {
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border-dark);
}

.defs-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.defs-item:hover { background: var(--color-bg-tertiary); }
.defs-item.active { background: var(--color-bg-element); border-left-color: var(--color-accent); }

.defs-item-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.defs-item-meta { font-size: 10px; color: var(--color-text-muted); }

.defs-create {
  margin-top: auto;
  padding: 12px;
  border-top: 1px solid var(--color-border-dark);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.defs-create input {
  padding: 7px 10px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.defs-create input:focus { border-color: var(--color-accent); }

.defs-create-btn {
  padding: 7px;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.defs-create-btn:hover:not(:disabled) { background: var(--color-accent); color: var(--color-text-bright); }
.defs-create-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.defs-create-btn.alt { border-color: var(--color-border-medium); color: var(--color-text-muted); }
.defs-create-btn.alt:hover:not(:disabled) { background: var(--color-bg-element); color: var(--color-text-hover); border-color: var(--color-text-muted); }
</style>
