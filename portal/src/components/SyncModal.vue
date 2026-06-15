<script setup lang="ts">
// Sync the shared definitions repo (pipelines + skills) with a git remote.
// Push/Pull are always available; a pull that conflicts swaps in resolve actions
// (use remote / use local / abort). Auth uses the mounted GitHub token server-side
// — only the non-secret remote URL + branch are configured here.
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/api'
import type { SyncStatus } from '@/services/api'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'
import FormField from './primitives/FormField.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const status = ref<SyncStatus | null>(null)
const loading = ref(true)
const busy = ref('')          // which action is in flight ('' = none)
const error = ref('')
const message = ref('')

// Remote config form
const editing = ref(false)
const urlInput = ref('')
const branchInput = ref('')

const conflicted = computed(() => !!status.value?.conflicted)

async function refresh() {
  loading.value = true; error.value = ''
  try {
    status.value = await api.getSyncStatus()
    if (!status.value.configured) editing.value = true
    urlInput.value = status.value.url || ''
    branchInput.value = status.value.branch || 'main'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load sync status'
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

async function run(action: string, fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = action; error.value = ''; message.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e instanceof Error ? e.message : `${action} failed`
  } finally {
    busy.value = ''
  }
}

const saveRemote = () => run('save', async () => {
  status.value = await api.setSyncRemote(urlInput.value, branchInput.value)
  editing.value = false
  message.value = status.value.configured ? 'Remote saved.' : 'Remote cleared.'
})

const push = () => run('push', async () => {
  const r = await api.syncPush()
  message.value = 'Pushed.' + (r.output ? ` ${r.output.split('\n').pop()}` : '')
  status.value = await api.getSyncStatus()
})

const pull = () => run('pull', async () => {
  const r = await api.syncPull()
  if (r.conflicted) message.value = `Pulled with conflicts in ${r.files.length} file(s) — resolve below.`
  else message.value = r.output || 'Pulled.'
  status.value = await api.getSyncStatus()
})

const resolve = (strategy: 'theirs' | 'ours' | 'abort') => run('resolve', async () => {
  await api.syncResolve(strategy)
  message.value = strategy === 'abort' ? 'Merge aborted.' : `Resolved (${strategy === 'theirs' ? 'kept remote' : 'kept local'}).`
  status.value = await api.getSyncStatus()
})
</script>

<template>
  <Modal title="Sync definitions" subtitle="pipelines + skills · one git repo" @close="!busy && emit('close')">
    <div class="sync-body">
      <div v-if="loading" class="sync-muted">Loading…</div>

      <template v-else-if="status">
        <!-- Remote config -->
        <div v-if="editing" class="sync-form">
          <FormField label="Remote URL" hint="https://github.com/owner/repo.git — auth uses the mounted GitHub token">
            <input v-model="urlInput" class="sync-input" placeholder="https://github.com/owner/definitions.git" spellcheck="false" />
          </FormField>
          <FormField label="Branch">
            <input v-model="branchInput" class="sync-input" placeholder="main" spellcheck="false" />
          </FormField>
          <div class="sync-form-actions">
            <Button v-if="status.configured" variant="secondary" :disabled="!!busy" @click="editing = false">Cancel</Button>
            <Button variant="primary" :disabled="busy === 'save'" @click="saveRemote">
              {{ busy === 'save' ? 'Saving…' : 'Save remote' }}
            </Button>
          </div>
        </div>

        <!-- Status + actions -->
        <template v-else>
          <div class="sync-remote-row">
            <div class="sync-remote-info">
              <div class="sync-url">{{ status.url }}</div>
              <div class="sync-meta">
                branch <code>{{ status.branch }}</code>
                <span v-if="status.remoteExists" class="sync-counts">
                  · <span :class="{ hot: status.ahead }">↑{{ status.ahead }}</span>
                  <span :class="{ hot: status.behind }">↓{{ status.behind }}</span>
                </span>
                <span v-else class="sync-muted"> · remote branch not created yet</span>
              </div>
            </div>
            <button class="sync-edit" :disabled="!!busy" @click="editing = true">Edit</button>
          </div>

          <div v-if="!status.hasToken" class="sync-warn">No GitHub token found in the container — push/pull will fail until one is mounted.</div>
          <div v-if="status.fetchError" class="sync-warn">Fetch: {{ status.fetchError }}</div>
          <div v-if="status.dirty && !conflicted" class="sync-warn">Working tree has uncommitted changes.</div>

          <!-- Conflict resolution (only after a conflicted pull) -->
          <div v-if="conflicted" class="sync-conflict">
            <div class="sync-conflict-title">⚠ Merge conflicts in {{ status.conflictedFiles.length }} file(s)</div>
            <ul class="sync-conflict-files"><li v-for="f in status.conflictedFiles" :key="f">{{ f }}</li></ul>
            <div class="sync-conflict-actions">
              <Button variant="secondary" :disabled="!!busy" @click="resolve('theirs')">Use remote</Button>
              <Button variant="secondary" :disabled="!!busy" @click="resolve('ours')">Use local</Button>
              <Button variant="danger" :disabled="!!busy" @click="resolve('abort')">Abort merge</Button>
            </div>
          </div>

          <div v-else class="sync-actions">
            <Button variant="secondary" :disabled="!!busy" @click="pull">{{ busy === 'pull' ? 'Pulling…' : '↓ Pull' }}</Button>
            <Button variant="primary" :disabled="!!busy" @click="push">{{ busy === 'push' ? 'Pushing…' : '↑ Push' }}</Button>
          </div>

          <div class="sync-last">last commit: <code>{{ status.lastCommit || '—' }}</code></div>
        </template>
      </template>

      <div v-if="message" class="sync-msg">{{ message }}</div>
      <div v-if="error" class="sync-error">{{ error }}</div>
    </div>

    <template #footer>
      <Button variant="secondary" :disabled="!!busy" @click="emit('close')">Close</Button>
    </template>
  </Modal>
</template>

<style scoped>
.sync-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; font-size: 13px; }
.sync-muted { color: var(--color-text-muted); }

.sync-form { display: flex; flex-direction: column; gap: 14px; }
.sync-input {
  width: 100%; padding: 8px 10px; background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium); border-radius: 6px;
  color: var(--color-text-primary); font-family: 'SF Mono', Menlo, monospace; font-size: 12.5px; outline: none;
}
.sync-input:focus { border-color: var(--color-accent); }
.sync-form-actions { display: flex; justify-content: flex-end; gap: 8px; }

.sync-remote-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.sync-remote-info { min-width: 0; }
.sync-url { color: var(--color-text-primary); font-family: 'SF Mono', Menlo, monospace; font-size: 12.5px; word-break: break-all; }
.sync-meta { color: var(--color-text-muted); margin-top: 4px; }
.sync-meta code { color: var(--color-text-hover); }
.sync-counts .hot { color: var(--color-accent); font-weight: 600; }
.sync-edit {
  flex-shrink: 0; padding: 4px 10px; font-size: 12px; cursor: pointer;
  background: transparent; color: var(--color-text-muted);
  border: 1px solid var(--color-border-medium); border-radius: 5px;
}
.sync-edit:hover:not(:disabled) { color: var(--color-text-primary); }

.sync-actions { display: flex; gap: 8px; }

.sync-warn { padding: 8px 12px; font-size: 12px; color: var(--color-warning); background: rgba(232, 128, 96, 0.1); border-radius: 6px; }

.sync-conflict { padding: 10px 12px; background: rgba(232, 88, 88, 0.08); border: 1px solid var(--color-error); border-radius: 6px; }
.sync-conflict-title { color: var(--color-error); font-weight: 600; margin-bottom: 6px; }
.sync-conflict-files { margin: 0 0 10px; padding-left: 18px; color: var(--color-text-hover); font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.sync-conflict-files li { margin: 2px 0; }
.sync-conflict-actions { display: flex; gap: 8px; }

.sync-last { color: var(--color-text-muted); font-size: 12px; }
.sync-last code { color: var(--color-text-hover); }
.sync-msg { padding: 8px 12px; font-size: 12px; color: var(--color-status-running); background: rgba(91, 168, 160, 0.1); border-radius: 6px; }
.sync-error { padding: 8px 12px; font-size: 12px; color: var(--color-error); background: rgba(232, 88, 88, 0.08); border-radius: 6px; }
</style>
