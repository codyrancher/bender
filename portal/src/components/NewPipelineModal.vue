<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'
import SearchCombobox from './primitives/SearchCombobox.vue'

// All pipelines use the single Rancher template.
const TEMPLATE_ID = 'rancher-dashboard'

const RANCHER_TAGS = [
  'head',
  'v2.14-head',
  'v2.13-head',
  'v2.12-head',
  'v2.11-head',
  'v2.10-head',
]

const NODE_VERSIONS = [
  '24.0.0',
  '22.16.0',
  '20.19.2',
]

const router = useRouter()
const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const pipelineName = ref('')
const rancherTag = ref('head')
const nodeVersion = ref('24.0.0')
const error = ref('')
const isCreating = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)

watch(
  () => uiStore.showNewPipelineModal,
  (isOpen) => {
    if (isOpen) {
      pipelineName.value = ''
      error.value = ''
      rancherTag.value = 'head'
      nodeVersion.value = '24.0.0'
      nextTick(() => {
        nameInput.value?.focus()
        nameInput.value?.select()
      })
    }
  }
)

function validate(): boolean {
  const name = pipelineName.value.trim()

  if (!name) {
    error.value = 'Pipeline name is required'
    return false
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    error.value = 'Use only letters, numbers, hyphens, and underscores'
    return false
  }

  error.value = ''
  return true
}

async function handleCreate() {
  if (!validate() || isCreating.value) return

  isCreating.value = true
  const name = pipelineName.value.trim()
  try {
    await pipelinesStore.createPipeline(name, {
      template: TEMPLATE_ID,
      vars: { rancherTag: rancherTag.value, nodeVersion: nodeVersion.value },
    })
    uiStore.closeNewPipelineModal()
    router.push(`/${name}/vscode`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create pipeline'
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <Modal v-if="uiStore.showNewPipelineModal" title="New Pipeline" @close="uiStore.closeNewPipelineModal()">
    <div class="new-pipeline-body">
      <div class="selected-template">Rancher</div>
      <input
        ref="nameInput"
        v-model="pipelineName"
        class="name-input"
        type="text"
        placeholder="Pipeline name (e.g., my-pipeline)"
        autocomplete="off"
        @keydown.enter="handleCreate"
      />
      <div class="field-group">
        <label class="field-label">Rancher Image Tag</label>
        <SearchCombobox
          v-model="rancherTag"
          :options="RANCHER_TAGS"
          placeholder="e.g. v2.13-head"
          @submit="handleCreate"
        />
      </div>
      <div class="field-group">
        <label class="field-label">Node Version</label>
        <SearchCombobox
          v-model="nodeVersion"
          :options="NODE_VERSIONS"
          placeholder="e.g. 24.0.0"
          @submit="handleCreate"
        />
      </div>
      <div v-if="error" class="error">{{ error }}</div>
    </div>
    <template #footer>
      <Button variant="secondary" @click="uiStore.closeNewPipelineModal">Cancel</Button>
      <Button variant="primary" :disabled="isCreating" @click="handleCreate">
        {{ isCreating ? 'Creating...' : 'Create' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.new-pipeline-body {
  padding: var(--spacing-xl);
}

.selected-template {
  display: inline-block;
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-bg-element);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-accent);
  margin-bottom: var(--spacing-md);
}

.name-input {
  width: 100%;
  padding: 10px var(--spacing-md);
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-medium);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-family: inherit;
  margin-bottom: var(--spacing-lg);
}

.name-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.error {
  color: var(--color-error);
  font-size: var(--font-size-xs);
  margin-top: calc(var(--spacing-md) * -1);
  margin-bottom: var(--spacing-md);
}

.field-group {
  margin-bottom: var(--spacing-lg);
}

.field-label {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: var(--spacing-xs);
}
</style>
