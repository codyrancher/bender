<script setup lang="ts">
// GitHub browser-session gate for a pipeline run. Only the upload/PR stages need
// a logged-in github.com session in the sidecar (GitHub has no API for
// user-attachments), so this is a soft gate the user can run past. Emits
// `proceed` to run anyway / once a session is present.
import { ref } from 'vue'
import { api } from '@/services/api'
import type { GithubAuthStatus } from '@/services/api'
import { usePipelinesStore } from '@/stores/pipelines'
import { getBrowserUrl } from '@/services/urls'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'

const props = defineProps<{ pipeline: string; status: GithubAuthStatus }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'proceed', pipeline: string): void
}>()

const pipelinesStore = usePipelinesStore()

const status = ref<GithubAuthStatus>(props.status)
const loading = ref(false)
const error = ref('')

function syncedAgo(updatedAt?: number): string {
  if (!updatedAt) return ''
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

// Open the project's sidecar browser in a new tab so the user can sign in to
// GitHub there, then come back and "Capture session".
function openSidecarBrowser() {
  const port = pipelinesStore.getPipelineBrowserPort(props.pipeline)
  if (!port) {
    error.value = 'Browser sidecar isn’t running yet — start a run (or the sidecar) first, sign in to github.com there, then capture.'
    return
  }
  const url = getBrowserUrl(props.pipeline, port, pipelinesStore.getPipelineBrowserHost(props.pipeline))
  window.open(url, '_blank', 'noopener')
}

async function recheck() {
  loading.value = true; error.value = ''
  try { status.value = await api.getGithubAuth(props.pipeline) }
  catch (e) { error.value = e instanceof Error ? e.message : 'Check failed' }
  finally { loading.value = false }
}

async function capture() {
  loading.value = true; error.value = ''
  try {
    const s = await api.captureGithubSession(props.pipeline)
    status.value = s
    if (!s.authenticated && s.reason) error.value = s.reason
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not capture the session'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Modal title="GitHub session not detected" :subtitle="pipeline" @close="!loading && emit('close')">
    <div class="modal-pad">
      <p class="auth-desc">
        Stages that upload screenshots or videos to a PR/issue do it through a
        <strong>logged-in GitHub browser session</strong> in the sidecar — not a token
        (GitHub has no API for user-attachments). The rest of the run works without it;
        only the upload/PR steps need it.
      </p>
      <div class="gh-status" :class="{ ok: status.authenticated }">
        <span class="gh-dot"></span>
        <template v-if="status.authenticated">
          Session present{{ status.login ? ` — signed in as ${status.login}` : '' }}
          <span v-if="status.updatedAt" class="gh-meta">· synced {{ syncedAgo(status.updatedAt) }}</span>
        </template>
        <template v-else>
          No active GitHub login in the synced session
        </template>
      </div>
      <ol class="auth-steps">
        <li>Sign in to <strong>github.com</strong> in your browser with the bender extension active (it auto-syncs the session), <em>or</em></li>
        <li><a href="#" @click.prevent="openSidecarBrowser">Open the sidecar browser ↗</a>, sign in to github.com there, then <strong>Capture session</strong> below.</li>
      </ol>
      <div v-if="error" class="auth-error">{{ error }}</div>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="loading" @click="emit('close')">Cancel</Button>
      <Button variant="secondary" :disabled="loading" @click="recheck">
        {{ loading ? 'Checking…' : 'Re-check' }}
      </Button>
      <Button variant="secondary" :disabled="loading" @click="capture">Capture session</Button>
      <Button
        v-if="status.authenticated"
        variant="primary"
        :disabled="loading"
        @click="emit('proceed', pipeline)"
      >Run</Button>
      <Button v-else variant="secondary" :disabled="loading" @click="emit('proceed', pipeline)">Run anyway</Button>
    </template>
  </Modal>
</template>

<style scoped>
.modal-pad { padding: 20px; }
.auth-desc { font-size: 13px; color: var(--color-text-hover); margin: 0 0 14px; line-height: 1.5; }
.auth-steps { margin: 0 0 12px; padding-left: 20px; font-size: 13px; color: var(--color-text-primary); }
.auth-steps li { margin: 4px 0; }
.auth-steps a { color: var(--color-accent); }
.auth-error { margin-top: 10px; padding: 8px 12px; color: var(--color-error); font-size: 12px; background: rgba(232, 88, 88, 0.08); border-radius: 6px; }

.gh-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--color-text-primary);
  background: var(--color-bg-element);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
}
.gh-status .gh-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-error);
  flex-shrink: 0;
}
.gh-status.ok .gh-dot { background: var(--color-status-running); }
.gh-meta { color: var(--color-text-muted); margin-left: 2px; }
</style>
