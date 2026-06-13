<script setup lang="ts">
// Edit a pipeline INSTANCE's env arg values (declared via its "## Args" section,
// persisted to .bender.json, passed to runs as env vars). Loads the args when
// given a pipeline; emits `close` when done.
import { ref, watch } from 'vue'
import { api } from '@/services/api'
import { useUiStore } from '@/stores/ui'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'

interface ArgDef { name: string; description: string; required: boolean; default: string; value: string }

const props = defineProps<{ pipeline: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const uiStore = useUiStore()

const defs = ref<ArgDef[]>([])
const values = ref<Record<string, string>>({})
const saving = ref(false)
const error = ref('')

watch(() => props.pipeline, async (pipeline) => {
  defs.value = []
  values.value = {}
  error.value = ''
  try {
    const a = await api.getPipelineArgs(pipeline)
    const next: Record<string, string> = {}
    for (const d of a.args) next[d.name] = d.value
    defs.value = a.args
    values.value = next
  } catch (e) {
    uiStore.showToast(e instanceof Error ? e.message : 'Failed to load args', 'error')
    emit('close')
  }
}, { immediate: true })

async function save() {
  if (saving.value) return
  saving.value = true; error.value = ''
  try {
    await api.savePipelineArgs(props.pipeline, values.value)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Save failed'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal title="Edit env args" :subtitle="pipeline" @close="!saving && emit('close')">
    <div class="modal-pad">
      <p v-if="!defs.length" class="confirm-text">This pipeline declares no args.</p>
      <div v-else class="args-form">
        <div v-for="d in defs" :key="d.name" class="args-row">
          <div class="args-label">
            <span class="args-name">{{ d.name }}<span v-if="d.required" class="args-req">*</span></span>
            <span v-if="d.description" class="args-desc">{{ d.description }}</span>
          </div>
          <input
            v-model="values[d.name]"
            class="args-input"
            spellcheck="false"
            :placeholder="d.default ? `default: ${d.default}` : ''"
          />
        </div>
        <p class="args-note">Saved values are passed as environment variables to future runs of this pipeline.</p>
      </div>
      <div v-if="error" class="auth-error">{{ error }}</div>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="saving" @click="emit('close')">Cancel</Button>
      <Button v-if="defs.length" variant="primary" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.modal-pad { padding: 20px; }

.confirm-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
}

.args-form { display: flex; flex-direction: column; gap: 14px; width: 100%; }
.args-row { display: flex; flex-direction: column; gap: 6px; }
.args-label { display: flex; flex-direction: column; gap: 2px; }
.args-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.args-req { color: var(--color-error); margin-left: 2px; }
.args-desc { font-size: 12px; color: var(--color-text-muted); }
.args-input {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 0.15s;
}
.args-input:focus { border-color: var(--color-accent); }
.args-note { font-size: 12px; color: var(--color-text-muted); margin: 4px 0 0; }

.auth-error { margin-top: 10px; padding: 8px 12px; color: var(--color-error); font-size: 12px; background: rgba(232, 88, 88, 0.08); border-radius: 6px; }
</style>
