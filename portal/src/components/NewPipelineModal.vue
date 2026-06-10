<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'

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
const rancherTagSearch = ref('')
const showTagDropdown = ref(false)
const nodeVersion = ref('24.0.0')
const nodeVersionSearch = ref('')
const showNodeDropdown = ref(false)
const error = ref('')
const isCreating = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)

const filteredTags = computed(() => {
  const search = rancherTagSearch.value.toLowerCase()
  if (!search) return RANCHER_TAGS
  return RANCHER_TAGS.filter(t => t.toLowerCase().includes(search))
})

const filteredNodeVersions = computed(() => {
  const search = nodeVersionSearch.value.toLowerCase()
  if (!search) return NODE_VERSIONS
  return NODE_VERSIONS.filter(v => v.toLowerCase().includes(search))
})

watch(
  () => uiStore.showNewPipelineModal,
  (isOpen) => {
    if (isOpen) {
      pipelineName.value = ''
      error.value = ''
      rancherTag.value = 'head'
      rancherTagSearch.value = ''
      showTagDropdown.value = false
      nodeVersion.value = '24.0.0'
      nodeVersionSearch.value = ''
      showNodeDropdown.value = false
      nextTick(() => {
        nameInput.value?.focus()
        nameInput.value?.select()
      })
    }
  }
)

function selectTag(tag: string) {
  rancherTag.value = tag
  rancherTagSearch.value = ''
  showTagDropdown.value = false
}

function handleTagInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  rancherTagSearch.value = value
  rancherTag.value = value
  showTagDropdown.value = true
}

function handleTagFocus() {
  showTagDropdown.value = true
}

function handleTagBlur() {
  setTimeout(() => { showTagDropdown.value = false }, 150)
}

function selectNodeVersion(ver: string) {
  nodeVersion.value = ver
  nodeVersionSearch.value = ''
  showNodeDropdown.value = false
}

function handleNodeInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  nodeVersionSearch.value = value
  nodeVersion.value = value
  showNodeDropdown.value = true
}

function handleNodeFocus() {
  showNodeDropdown.value = true
}

function handleNodeBlur() {
  setTimeout(() => { showNodeDropdown.value = false }, 150)
}

function validate(): boolean {
  const name = pipelineName.value.trim()

  if (!name) {
    error.value = 'Project name is required'
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
    error.value = err instanceof Error ? err.message : 'Failed to create project'
  } finally {
    isCreating.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    handleCreate()
  } else if (e.key === 'Escape') {
    uiStore.closeNewPipelineModal()
  }
}

let mouseDownOnOverlay = false

function handleOverlayMousedown(e: MouseEvent) {
  mouseDownOnOverlay = e.target === e.currentTarget
}

function handleOverlayMouseup(e: MouseEvent) {
  if (mouseDownOnOverlay && e.target === e.currentTarget) {
    uiStore.closeNewPipelineModal()
  }
  mouseDownOnOverlay = false
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="uiStore.showNewPipelineModal"
      class="modal-overlay"
      @mousedown="handleOverlayMousedown"
      @mouseup="handleOverlayMouseup"
      @keydown.escape="uiStore.closeNewPipelineModal()"
    >
      <div class="modal">
        <h2>New Pipeline</h2>
        <div class="selected-template">Rancher</div>
        <input
          ref="nameInput"
          v-model="pipelineName"
          type="text"
          placeholder="Project name (e.g., my-project)"
          autocomplete="off"
          @keydown="handleKeydown"
        />
        <div class="field-group">
          <label class="field-label">Rancher Image Tag</label>
          <div class="combobox">
            <input
              type="text"
              :value="rancherTag"
              placeholder="e.g. v2.13-head"
              autocomplete="off"
              @input="handleTagInput"
              @focus="handleTagFocus"
              @blur="handleTagBlur"
              @keydown.enter.prevent="handleCreate"
            />
            <div v-if="showTagDropdown && filteredTags.length" class="combobox-dropdown">
              <button
                v-for="tag in filteredTags"
                :key="tag"
                class="combobox-option"
                :class="{ selected: tag === rancherTag }"
                @mousedown.prevent="selectTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Node Version</label>
          <div class="combobox">
            <input
              type="text"
              :value="nodeVersion"
              placeholder="e.g. 24.0.0"
              autocomplete="off"
              @input="handleNodeInput"
              @focus="handleNodeFocus"
              @blur="handleNodeBlur"
              @keydown.enter.prevent="handleCreate"
            />
            <div v-if="showNodeDropdown && filteredNodeVersions.length" class="combobox-dropdown">
              <button
                v-for="ver in filteredNodeVersions"
                :key="ver"
                class="combobox-option"
                :class="{ selected: ver === nodeVersion }"
                @mousedown.prevent="selectNodeVersion(ver)"
              >
                {{ ver }}
              </button>
            </div>
          </div>
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <div class="modal-buttons">
          <button class="modal-btn cancel" @click="uiStore.closeNewPipelineModal">
            Cancel
          </button>
          <button
            class="modal-btn create"
            :disabled="isCreating"
            @click="handleCreate"
          >
            {{ isCreating ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-xxl);
  min-width: var(--size-modal-min-width);
  box-shadow: 0 var(--spacing-xs) var(--spacing-xl) var(--color-shadow-dark);
}

.modal h2 {
  margin-bottom: var(--spacing-lg);
  font-size: var(--font-size-lg);
  font-weight: 500;
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

.modal input {
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

.modal input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

.modal-btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.modal-btn.cancel {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
}

.modal-btn.cancel:hover {
  background: var(--color-bg-element-hover);
  color: var(--color-text-hover);
}

.modal-btn.create {
  background: var(--color-accent);
  color: var(--color-bg-primary);
  font-weight: 500;
}

.modal-btn.create:hover {
  background: var(--color-accent-hover);
}

.modal-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.combobox {
  position: relative;
}

.combobox input {
  margin-bottom: 0;
}

.combobox-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-medium);
  border-top: none;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  z-index: 10;
  max-height: 160px;
  overflow-y: auto;
}

.combobox-option {
  display: block;
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.combobox-option:hover {
  background: var(--color-bg-element);
}

.combobox-option.selected {
  color: var(--color-accent);
}
</style>
