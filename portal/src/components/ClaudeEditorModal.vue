<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'

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
  if (!mdSaving.value) emit('update:open', false)
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
    emit('update:open', false)
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
  <Modal v-if="open" title="CLAUDE.md" @close="close">
    <div class="md-body">
      <p class="md-hint">Global instructions for the CLI. Saved to <code>/data/cli/workspace/CLAUDE.md</code>. Restart the session to reload.</p>
      <textarea
        v-model="mdContent"
        class="md-textarea"
        spellcheck="false"
        :disabled="mdSaving"
      ></textarea>
      <div v-if="mdError" class="md-error">{{ mdError }}</div>
    </div>
    <template #footer>
      <button class="md-reset" :disabled="mdSaving" @click="resetMd">Reset to default</button>
      <Button variant="secondary" :disabled="mdSaving" @click="close">Cancel</Button>
      <Button variant="primary" :disabled="mdSaving" @click="saveMd">
        {{ mdSaving ? 'Saving...' : 'Save' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.md-body {
  padding: var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.md-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin: 0;
}

.md-hint code {
  background: var(--color-bg-primary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.md-textarea {
  min-height: 50vh;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.md-textarea:focus {
  border-color: var(--color-accent);
}

.md-error {
  color: var(--color-warning, #e05050);
  font-size: var(--font-size-xs);
}

/* Subtle "reset" action, pushed to the left of the footer's right-aligned buttons. */
.md-reset {
  margin-right: auto;
  padding: var(--spacing-sm) var(--spacing-lg);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.md-reset:hover:not(:disabled) {
  color: var(--color-warning, #e05050);
}

.md-reset:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
