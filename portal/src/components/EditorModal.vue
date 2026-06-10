<script setup lang="ts">
import { ref, computed } from 'vue'

interface RerunOption {
  label: string
  value: string
  hint?: string
}

const props = defineProps<{
  title: string
  subtitle?: string
  content: string
  placeholder?: string
  rerunOptions?: RerunOption[]
  onSave: (content: string) => Promise<void>
  onRerun?: (value: string) => Promise<void>
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const text = ref(props.content)
const lastSaved = ref(props.content)
const phase = ref<'edit' | 'rerun'>('edit')
const busy = ref(false)
const error = ref('')

const dirty = computed(() => text.value !== lastSaved.value)
const rerunOptions = computed(() => props.rerunOptions || [])

async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await props.onSave(text.value)
    lastSaved.value = text.value
    if (rerunOptions.value.length && props.onRerun) {
      phase.value = 'rerun'
    } else {
      emit('close')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    busy.value = false
  }
}

async function doRerun(value: string) {
  if (busy.value || !props.onRerun) return
  busy.value = true
  error.value = ''
  try {
    await props.onRerun(value)
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to rerun'
  } finally {
    busy.value = false
  }
}

function close() {
  if (busy.value) return
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @mousedown.self="close">
      <div class="editor-modal">
        <div class="editor-header">
          <div class="editor-title">
            <h3>{{ title }}</h3>
            <span v-if="subtitle" class="editor-subtitle">{{ subtitle }}</span>
          </div>
          <button class="editor-close" @click="close">✕</button>
        </div>

        <!-- Edit phase -->
        <template v-if="phase === 'edit'">
          <div class="editor-body">
            <textarea
              v-model="text"
              class="editor-textarea"
              :placeholder="placeholder"
              spellcheck="false"
              autofocus
            ></textarea>
          </div>
          <div v-if="error" class="editor-error">{{ error }}</div>
          <div class="editor-footer">
            <span class="dirty-indicator" v-if="dirty">● Unsaved changes</span>
            <div class="footer-buttons">
              <button class="modal-btn cancel" :disabled="busy" @click="close">Cancel</button>
              <button class="modal-btn create" :disabled="busy || !dirty" @click="save">
                {{ busy ? 'Saving...' : 'Save' }}
              </button>
            </div>
          </div>
        </template>

        <!-- Rerun phase -->
        <template v-else>
          <div class="rerun-body">
            <div class="rerun-check">✓</div>
            <p class="rerun-message">Saved. Would you like to rerun?</p>
            <div v-if="error" class="editor-error standalone">{{ error }}</div>
            <div class="rerun-options">
              <button
                v-for="opt in rerunOptions"
                :key="opt.value"
                class="rerun-btn"
                :disabled="busy"
                @click="doRerun(opt.value)"
              >
                <span class="rerun-btn-label">{{ opt.label }}</span>
                <span v-if="opt.hint" class="rerun-btn-hint">{{ opt.hint }}</span>
              </button>
              <button class="rerun-btn skip" :disabled="busy" @click="close">
                <span class="rerun-btn-label">Not now</span>
                <span class="rerun-btn-hint">Just save and close</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.editor-modal {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 10px;
  width: 720px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px var(--color-shadow-dark);
}

.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}

.editor-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.editor-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.editor-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
}

.editor-close {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.editor-close:hover {
  background: var(--color-bg-element);
  color: var(--color-text-hover);
}

.editor-body {
  flex: 1;
  overflow: hidden;
  padding: 16px 20px;
  display: flex;
}

.editor-textarea {
  flex: 1;
  width: 100%;
  min-height: 320px;
  resize: none;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px 14px;
  outline: none;
  tab-size: 2;
  transition: border-color 0.15s;
}

.editor-textarea:focus {
  border-color: var(--color-accent);
}

.editor-error {
  padding: 8px 20px;
  color: var(--color-error);
  font-size: 12px;
  background: rgba(232, 88, 88, 0.08);
}

.editor-error.standalone {
  margin: 0 0 12px;
  border-radius: 4px;
  padding: 8px 12px;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}

.dirty-indicator {
  font-size: 11px;
  color: var(--color-warning);
}

.footer-buttons {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.modal-btn {
  padding: 8px 18px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  transition: background 0.15s, opacity 0.15s;
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
  color: var(--color-text-bright);
}

.modal-btn.create:hover {
  background: var(--color-accent-hover);
}

.modal-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Rerun phase */
.rerun-body {
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.rerun-check {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(91, 168, 160, 0.15);
  color: var(--color-status-running);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
}

.rerun-message {
  font-size: 14px;
  color: var(--color-text-primary);
  margin: 0 0 18px;
}

.rerun-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 360px;
}

.rerun-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid var(--color-border-medium);
  background: var(--color-bg-element);
  color: var(--color-text-primary);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.rerun-btn:hover {
  border-color: var(--color-accent);
  background: var(--color-bg-element-hover);
}

.rerun-btn.skip {
  border-color: transparent;
  background: transparent;
}

.rerun-btn.skip:hover {
  background: var(--color-bg-element);
  border-color: var(--color-border-medium);
}

.rerun-btn-label {
  font-size: 13px;
  font-weight: 600;
}

.rerun-btn-hint {
  font-size: 11px;
  color: var(--color-text-muted);
}

.rerun-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
