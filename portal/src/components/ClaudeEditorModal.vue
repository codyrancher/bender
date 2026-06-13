<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const mdContent = ref('')
const mdSaving = ref(false)
const mdError = ref('')

// Load the current CLAUDE.md each time the modal opens.
watch(() => props.open, async (open) => {
  if (!open) return
  mdError.value = ''
  try {
    const resp = await fetch('/api/cli/md')
    if (!resp.ok) throw new Error(await resp.text())
    const data = await resp.json()
    mdContent.value = data.content || ''
  } catch (err) {
    mdError.value = `Load failed: ${err instanceof Error ? err.message : String(err)}`
  }
})

function close() {
  emit('update:open', false)
}

async function saveMd() {
  mdSaving.value = true
  mdError.value = ''
  try {
    const resp = await fetch('/api/cli/md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: mdContent.value }),
    })
    if (!resp.ok) throw new Error(await resp.text())
    close()
  } catch (err) {
    mdError.value = `Save failed: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    mdSaving.value = false
  }
}

async function resetMd() {
  if (!confirm('Reset CLAUDE.md to the default? Your changes will be lost.')) return
  mdSaving.value = true
  mdError.value = ''
  try {
    const resp = await fetch('/api/cli/md/reset', { method: 'POST' })
    if (!resp.ok) throw new Error(await resp.text())
    const data = await resp.json()
    mdContent.value = data.content || ''
  } catch (err) {
    mdError.value = `Reset failed: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    mdSaving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="md-overlay" @mousedown.self="!mdSaving && close()">
      <div class="md-modal">
        <div class="md-modal-header">
          <h2>CLAUDE.md</h2>
          <span class="md-hint">Global instructions for the CLI. Saved to <code>/data/cli/workspace/CLAUDE.md</code>. Restart the session to reload.</span>
        </div>
        <textarea
          v-model="mdContent"
          class="md-textarea"
          spellcheck="false"
          :disabled="mdSaving"
        ></textarea>
        <div v-if="mdError" class="md-error">{{ mdError }}</div>
        <div class="md-modal-buttons">
          <button class="md-reset" :disabled="mdSaving" @click="resetMd">Reset to default</button>
          <div class="md-spacer"></div>
          <button class="md-cancel" :disabled="mdSaving" @click="close">Cancel</button>
          <button class="md-save" :disabled="mdSaving" @click="saveMd">
            {{ mdSaving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.md-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.md-modal {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-xl);
  width: min(900px, 90vw);
  height: min(700px, 85vh);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  box-shadow: 0 var(--spacing-xs) var(--spacing-xl) var(--color-shadow-dark);
}

.md-modal-header h2 {
  font-size: var(--font-size-lg);
  font-weight: 500;
  margin-bottom: var(--spacing-xs);
}

.md-hint {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.md-hint code {
  background: var(--color-bg-primary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.md-textarea {
  flex: 1;
  min-height: 0;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
}

.md-textarea:focus {
  border-color: var(--color-accent);
}

.md-error {
  color: var(--color-warning, #e05050);
  font-size: var(--font-size-xs);
}

.md-modal-buttons {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.md-spacer {
  flex: 1;
}

.md-reset,
.md-cancel,
.md-save {
  padding: var(--spacing-sm) var(--spacing-lg);
  border: none;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.md-reset {
  background: transparent;
  color: var(--color-text-muted);
}

.md-reset:hover:not(:disabled) {
  color: var(--color-warning, #e05050);
}

.md-cancel {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
}

.md-cancel:hover:not(:disabled) {
  background: var(--color-bg-element-hover);
  color: var(--color-text-hover);
}

.md-save {
  background: var(--color-accent);
  color: var(--color-bg-primary);
  font-weight: 500;
}

.md-save:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.md-reset:disabled,
.md-cancel:disabled,
.md-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
