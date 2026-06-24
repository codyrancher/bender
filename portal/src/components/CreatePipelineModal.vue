<script setup lang="ts">
// "New Pipeline" modal: pick a definition, fill its declared args, create. Loads
// the definition list itself when opened. v-model:open controls visibility.
import { ref, computed, watch } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import { api } from '@/services/api'
import type { PipelineArg } from '@/types'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'
import SearchCombobox from './primitives/SearchCombobox.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const pipelinesStore = usePipelinesStore()

const definitions = ref<Array<{ id: string; name: string; args?: PipelineArg[] }>>([])
const newName = ref('')
const selectedDefinition = ref('')
const argValues = ref<Record<string, string>>({})
const creating = ref(false)

const selectedArgs = computed<PipelineArg[]>(() =>
  selectedDefinition.value
    ? definitions.value.find(d => d.id === selectedDefinition.value)?.args || []
    : [],
)
const argsValid = computed(() =>
  selectedArgs.value.every(a => !a.required || (argValues.value[a.name] || '').trim()),
)

// Seed the arg form with declared defaults (keeping any values already entered).
function seedArgs() {
  const next: Record<string, string> = {}
  for (const a of selectedArgs.value) next[a.name] = argValues.value[a.name] ?? a.default ?? ''
  argValues.value = next
}
watch(selectedArgs, seedArgs)

watch(() => props.open, async (open) => {
  if (!open) return
  newName.value = ''
  argValues.value = {}
  try {
    const data = await api.getDefinitions()
    definitions.value = data.definitions
    if (data.definitions.length && !data.definitions.find(d => d.id === selectedDefinition.value)) {
      selectedDefinition.value = data.definitions[0].id
    }
    seedArgs()
  } catch {}
})

function close() {
  if (!creating.value) emit('update:open', false)
}

async function handleCreate() {
  if (!newName.value.trim() || creating.value || !argsValid.value) return
  creating.value = true
  try {
    const args: Record<string, string> = {}
    for (const a of selectedArgs.value) {
      const v = (argValues.value[a.name] || '').trim()
      if (v) args[a.name] = v
    }
    await pipelinesStore.createPipeline(newName.value.trim(), {
      definitionId: selectedDefinition.value || undefined,
      ...(Object.keys(args).length && { args }),
    })
    emit('update:open', false)
  } catch {
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <Modal v-if="open" title="New Pipeline" @close="close">
    <div class="modal-pad">
      <div class="form-group">
        <label>Name</label>
        <input
          v-model="newName"
          type="text"
          placeholder="my-pipeline"
          autofocus
          @keydown.enter="handleCreate"
        />
      </div>
      <div class="form-group">
        <label>Pipeline Definition</label>
        <select v-model="selectedDefinition">
          <option v-for="def in definitions" :key="def.id" :value="def.id">
            {{ def.name }}
          </option>
        </select>
      </div>
      <div v-if="selectedArgs.length" class="args-form">
        <label>Arguments</label>
        <div v-for="a in selectedArgs" :key="a.name" class="arg-field">
          <div class="arg-label">
            <span class="arg-name">{{ a.name }}</span>
            <span v-if="a.required" class="arg-required">required</span>
          </div>
          <p v-if="a.description" class="arg-desc">{{ a.description }}</p>
          <SearchCombobox
            v-if="a.options && a.options.length"
            v-model="argValues[a.name]"
            :options="a.options"
            :placeholder="a.default || a.name"
            @submit="handleCreate"
          />
          <input
            v-else
            v-model="argValues[a.name]"
            type="text"
            :placeholder="a.default || a.name"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="creating" @click="close">Cancel</Button>
      <Button variant="primary" :disabled="!newName.trim() || creating || !argsValid" @click="handleCreate">
        {{ creating ? 'Creating...' : 'Create' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.modal-pad { padding: 20px; }

.form-group { margin-bottom: 14px; }

.form-group label,
.args-form > label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 9px 12px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.form-group input:focus,
.form-group select:focus { border-color: var(--color-accent); }
.form-group input::placeholder { color: var(--color-text-muted); }

.args-form { margin-bottom: 14px; }

.arg-field { margin-bottom: 12px; }

.arg-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.arg-name {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.arg-required {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-status-stopped);
  border: 1px solid var(--color-status-stopped);
  border-radius: 4px;
  padding: 1px 5px;
}

.arg-desc {
  margin: 0 0 5px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.args-form input {
  width: 100%;
  padding: 9px 12px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.args-form input:focus { border-color: var(--color-accent); }
.args-form input::placeholder { color: var(--color-text-muted); }
</style>
