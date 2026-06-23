<script setup lang="ts">
// Sync the definitions repo with a git remote, per directory. Each pipeline and
// skill is a selectable item with its own status (in sync / local-only /
// remote-only / local-ahead / remote-ahead / conflict). Select items, then Push
// (local → remote) or Pull (remote → local). There's no content merge — an op
// overwrites the whole directory in that direction; "Force" overwrites even when
// the other side also changed (a conflict) or is ahead.
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/api'
import type { SyncStatus, SyncItemStatus } from '@/services/api'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'
import FormField from './primitives/FormField.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const status = ref<SyncStatus | null>(null)
const loading = ref(true)
const busy = ref('')
const error = ref('')
const message = ref('')
const force = ref(false)
const selected = ref<Set<string>>(new Set())

const editing = ref(false)
const urlInput = ref('')
const branchInput = ref('')

const items = computed(() => status.value?.items ?? [])
const selectablePaths = computed(() => items.value.filter(i => i.status !== 'in-sync').map(i => i.path))
const allSelected = computed(() => selectablePaths.value.length > 0 && selectablePaths.value.every(p => selected.value.has(p)))
const hasConflictSelected = computed(() =>
  items.value.some(i => selected.value.has(i.path) && (i.status === 'conflict' || i.status === 'local-ahead' || i.status === 'remote-ahead')),
)

const STATUS_LABEL: Record<SyncItemStatus, string> = {
  'in-sync': 'in sync',
  'local-only': 'local only',
  'remote-only': 'remote only',
  'local-ahead': 'local ahead',
  'remote-ahead': 'remote ahead',
  'conflict': 'conflict',
}

async function refresh() {
  loading.value = true; error.value = ''
  try {
    status.value = await api.getSyncStatus()
    if (!status.value.configured) editing.value = true
    urlInput.value = status.value.url || ''
    branchInput.value = status.value.branch || 'main'
    selected.value = new Set()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load sync status'
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

function toggle(path: string) {
  const s = new Set(selected.value)
  s.has(path) ? s.delete(path) : s.add(path)
  selected.value = s
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(selectablePaths.value)
}

async function run(action: 'push' | 'pull') {
  if (busy.value || !selected.value.size) return
  busy.value = action; error.value = ''; message.value = ''
  try {
    const paths = [...selected.value]
    const r = action === 'push' ? await api.syncPush(paths, force.value) : await api.syncPull(paths, force.value)
    const parts: string[] = []
    if (r.done.length) parts.push(`${action === 'push' ? 'Pushed' : 'Pulled'} ${r.done.length}`)
    if (r.skipped.length) parts.push(`skipped ${r.skipped.length} (${r.skipped[0].reason}${r.skipped.length > 1 ? ', …' : ''})`)
    message.value = parts.join(' · ') || 'Nothing to do.'
    status.value = await api.getSyncStatus()
    selected.value = new Set()
  } catch (e) {
    error.value = e instanceof Error ? e.message : `${action} failed`
  } finally {
    busy.value = ''
  }
}

const saveRemote = async () => {
  if (busy.value) return
  busy.value = 'save'; error.value = ''; message.value = ''
  try {
    status.value = await api.setSyncRemote(urlInput.value, branchInput.value)
    editing.value = false
    message.value = status.value.configured ? 'Remote saved.' : 'Remote cleared.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save remote'
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <Modal title="Sync definitions" subtitle="select pipelines & skills to push or pull" @close="!busy && emit('close')">
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
            <Button variant="primary" :disabled="busy === 'save'" @click="saveRemote">{{ busy === 'save' ? 'Saving…' : 'Save remote' }}</Button>
          </div>
        </div>

        <template v-else>
          <div class="sync-remote-row">
            <div class="sync-remote-info">
              <div class="sync-url">{{ status.url }}</div>
              <div class="sync-meta">branch <code>{{ status.branch }}</code><span v-if="!status.remoteExists" class="sync-muted"> · remote branch not created yet</span></div>
            </div>
            <button class="sync-edit" :disabled="!!busy" @click="editing = true">Edit</button>
          </div>

          <div v-if="!status.hasToken" class="sync-warn">No GitHub token found in the container — push/pull will fail until one is mounted.</div>
          <div v-if="status.fetchError" class="sync-warn">Fetch: {{ status.fetchError }}</div>

          <!-- Item list -->
          <div class="sync-list">
            <label class="sync-row sync-head">
              <input type="checkbox" :checked="allSelected" :disabled="!selectablePaths.length" @change="toggleAll" />
              <span class="sync-name">{{ selected.size }} selected</span>
              <span class="sync-kind"></span>
              <span class="sync-status"></span>
            </label>
            <label v-for="it in items" :key="it.path" class="sync-row" :class="{ insync: it.status === 'in-sync' }">
              <input type="checkbox" :checked="selected.has(it.path)" :disabled="it.status === 'in-sync'" @change="toggle(it.path)" />
              <span class="sync-name">{{ it.id }}</span>
              <span class="sync-kind">{{ it.kind }}</span>
              <span class="sync-status" :class="'st-' + it.status">{{ STATUS_LABEL[it.status] }}</span>
            </label>
            <div v-if="!items.length" class="sync-muted sync-empty">No pipelines or skills.</div>
          </div>

          <label class="sync-force" :class="{ active: hasConflictSelected }">
            <input type="checkbox" v-model="force" />
            Force — overwrite the other side for conflicting / ahead items
          </label>

          <div class="sync-actions">
            <Button variant="secondary" :disabled="!!busy || !selected.size" @click="run('pull')">{{ busy === 'pull' ? 'Pulling…' : `↓ Pull selected` }}</Button>
            <Button variant="primary" :disabled="!!busy || !selected.size" @click="run('push')">{{ busy === 'push' ? 'Pushing…' : `↑ Push selected` }}</Button>
          </div>
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
.sync-url { color: var(--color-text-primary); font-family: 'SF Mono', Menlo, monospace; font-size: 12.5px; word-break: break-all; }
.sync-meta { color: var(--color-text-muted); margin-top: 4px; }
.sync-meta code { color: var(--color-text-hover); }
.sync-edit {
  flex-shrink: 0; padding: 4px 10px; font-size: 12px; cursor: pointer;
  background: transparent; color: var(--color-text-muted);
  border: 1px solid var(--color-border-medium); border-radius: 5px;
}
.sync-edit:hover:not(:disabled) { color: var(--color-text-primary); }

.sync-warn { padding: 8px 12px; font-size: 12px; color: var(--color-warning); background: rgba(232, 128, 96, 0.1); border-radius: 6px; }

.sync-list {
  border: 1px solid var(--color-border-medium); border-radius: 8px; overflow: hidden;
  max-height: 320px; overflow-y: auto;
}
.sync-row {
  display: grid; grid-template-columns: 20px 1fr auto auto; align-items: center; gap: 10px;
  padding: 7px 12px; border-bottom: 1px solid var(--color-border-dark); cursor: pointer;
}
.sync-row:last-child { border-bottom: none; }
.sync-row.insync { cursor: default; opacity: 0.65; }
.sync-head { background: var(--color-bg-element); cursor: default; position: sticky; top: 0; }
.sync-head .sync-name { color: var(--color-text-muted); font-size: 12px; }
.sync-name { color: var(--color-text-primary); font-family: 'SF Mono', Menlo, monospace; font-size: 12.5px; }
.sync-kind { color: var(--color-text-muted); font-size: 11px; }
.sync-status { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; white-space: nowrap; }
.st-in-sync { color: var(--color-text-muted); }
.st-local-only, .st-local-ahead { color: var(--color-accent); background: rgba(176, 104, 160, 0.14); }
.st-remote-only, .st-remote-ahead { color: var(--color-status-running); background: rgba(91, 168, 160, 0.14); }
.st-conflict { color: var(--color-error); background: rgba(232, 88, 88, 0.12); }

.sync-empty { padding: 16px; text-align: center; }

.sync-force { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-muted); cursor: pointer; }
.sync-force.active { color: var(--color-warning); }

.sync-actions { display: flex; justify-content: flex-end; gap: 8px; }

.sync-msg { padding: 8px 12px; font-size: 12px; color: var(--color-status-running); background: rgba(91, 168, 160, 0.1); border-radius: 6px; }
.sync-error { padding: 8px 12px; font-size: 12px; color: var(--color-error); background: rgba(232, 88, 88, 0.08); border-radius: 6px; }
</style>
