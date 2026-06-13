<script setup lang="ts">
// Import a definition from a running pipeline instance — pushes that pipeline's
// current pipeline.md + referenced skills into the definitions repo. Self-contained:
// fetches the instance list when opened, emits `imported` with the new id on success.
import { ref, watch } from 'vue'
import { api } from '@/services/api'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'
import FormField from './primitives/FormField.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'imported', definitionId: string): void
}>()

const instances = ref<string[]>([])
const pipeline = ref('')
const definitionId = ref('')
const message = ref('')
const saving = ref(false)
const error = ref('')

watch(() => props.open, async (open) => {
  if (!open) return
  instances.value = []; pipeline.value = ''; definitionId.value = ''; message.value = ''; saving.value = false; error.value = ''
  try {
    const r = await api.getPipelines()
    const list = r.pipelines.map(p => p.name)
    instances.value = list
    const first = list[0] || ''
    pipeline.value = first
    definitionId.value = first
    message.value = first ? `Update ${first} definition` : ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load pipelines'
  }
})

function onPickPipeline() {
  definitionId.value = pipeline.value
  message.value = `Update ${pipeline.value} definition`
}

function close() {
  if (!saving.value) emit('update:open', false)
}

async function confirm() {
  if (saving.value || !pipeline.value || !definitionId.value.trim()) return
  saving.value = true; error.value = ''
  try {
    const id = definitionId.value.trim()
    await api.pushPipelineDefinition(pipeline.value, id, message.value.trim())
    emit('imported', id)
    emit('update:open', false)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Import failed'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal
    v-if="open"
    title="Import from pipeline"
    subtitle="Push a pipeline's current pipeline.md + skills into a definition"
    @close="close"
  >
    <div class="imp-pad">
      <p v-if="!instances.length && !error" class="imp-empty">No pipelines available to import from.</p>
      <template v-else>
        <FormField label="Pipeline">
          <select v-model="pipeline" @change="onPickPipeline">
            <option v-for="i in instances" :key="i" :value="i">{{ i }}</option>
          </select>
        </FormField>
        <FormField label="Definition id">
          <input v-model="definitionId" type="text" placeholder="my-definition" spellcheck="false" />
        </FormField>
        <FormField label="Commit message">
          <input v-model="message" type="text" @keydown.enter="confirm" />
        </FormField>
      </template>
      <div v-if="error" class="imp-error">{{ error }}</div>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="saving" @click="close">Cancel</Button>
      <Button
        v-if="instances.length"
        variant="primary"
        :disabled="saving || !definitionId.trim()"
        @click="confirm"
      >
        {{ saving ? 'Importing…' : 'Import' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.imp-pad { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.imp-empty { font-size: 13px; color: var(--color-text-muted); margin: 0; }
.imp-pad input, .imp-pad select {
  padding: 8px 11px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.imp-pad input:focus, .imp-pad select:focus { border-color: var(--color-accent); }
.imp-error { padding: 8px 12px; color: var(--color-error); font-size: 12px; background: rgba(232, 88, 88, 0.08); border-radius: 6px; }
</style>
