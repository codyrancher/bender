<script setup lang="ts">
// Left sidebar: the list of skill definitions plus a "create new" field.
import { ref } from 'vue'

interface SkillSummary { id: string; name: string; description: string; fileCount: number }

defineProps<{
  skills: SkillSummary[]
  selectedId: string | null
  creating: boolean
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create', id: string): void
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
  <div class="skills-list">
    <div class="skills-list-header">{{ skills.length }} skills</div>
    <button
      v-for="s in skills"
      :key="s.id"
      class="skills-item"
      :class="{ active: selectedId === s.id }"
      @click="emit('select', s.id)"
    >
      <span class="skills-item-name">{{ s.name }}</span>
      <span class="skills-item-meta">{{ s.id }} · {{ s.fileCount }} file{{ s.fileCount === 1 ? '' : 's' }}</span>
    </button>
    <div class="skills-create">
      <input v-model="newId" placeholder="new-skill-id" @keydown.enter="create" />
      <button class="skills-create-btn" :disabled="creating || !newId.trim()" @click="create">+ Create</button>
    </div>
  </div>
</template>

<style scoped>
.skills-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-dark);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
}

.skills-list-header {
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border-dark);
}

.skills-item {
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

.skills-item:hover { background: var(--color-bg-tertiary); }
.skills-item.active { background: var(--color-bg-element); border-left-color: var(--color-accent); }
.skills-item-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.skills-item-meta { font-size: 10px; color: var(--color-text-muted); }

.skills-create {
  margin-top: auto;
  padding: 12px;
  border-top: 1px solid var(--color-border-dark);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skills-create input {
  padding: 7px 10px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.skills-create input:focus { border-color: var(--color-accent); }

.skills-create-btn {
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
.skills-create-btn:hover:not(:disabled) { background: var(--color-accent); color: var(--color-text-bright); }
.skills-create-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
