<script setup lang="ts">
// Claude sign-in (OAuth device-code) gate for a pipeline run. Self-contained:
// fetches a sign-in link, accepts the code, and emits `authenticated` so the
// caller can proceed with the run.
import { ref } from 'vue'
import { api } from '@/services/api'
import Modal from './primitives/Modal.vue'
import Button from './primitives/Button.vue'

const props = defineProps<{ pipeline: string }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'authenticated', pipeline: string): void
}>()

const url = ref<string>()
const sessionId = ref<string>()
const code = ref('')
const loading = ref(false)
const error = ref('')

async function fetchLoginLink() {
  loading.value = true; error.value = ''
  try {
    const r = await api.startClaudeLogin(props.pipeline)
    url.value = r.url; sessionId.value = r.sessionId
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to get a sign-in link'
  } finally {
    loading.value = false
  }
}

async function submitLoginCode() {
  if (!sessionId.value || !code.value.trim()) return
  loading.value = true; error.value = ''
  try {
    const r = await api.completeClaudeLogin(props.pipeline, sessionId.value, code.value.trim())
    if (r.authenticated) {
      emit('authenticated', props.pipeline)
    } else {
      error.value = 'Sign-in did not complete — double-check the code and try again.'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Sign-in failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Modal title="Claude sign-in required" :subtitle="pipeline" @close="!loading && emit('close')">
    <div class="modal-pad">
      <p class="auth-desc">
        Pipeline stages run the Claude CLI inside the pipeline container, which isn't signed in.
        Sign in once — credentials are shared across all pipelines.
      </p>
      <div v-if="!url" class="auth-getlink">
        <Button variant="primary" :disabled="loading" @click="fetchLoginLink">
          {{ loading ? 'Getting link…' : 'Get sign-in link' }}
        </Button>
      </div>
      <template v-else>
        <ol class="auth-steps">
          <li><a :href="url" target="_blank" rel="noopener">Open the Claude sign-in page ↗</a></li>
          <li>Approve access, then paste the code it gives you below.</li>
        </ol>
        <input
          v-model="code"
          class="auth-code"
          type="text"
          placeholder="Paste authentication code"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="submitLoginCode"
        />
      </template>
      <div v-if="error" class="auth-error">{{ error }}</div>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="loading" @click="emit('close')">Cancel</Button>
      <Button
        v-if="url"
        variant="primary"
        :disabled="loading || !code.trim()"
        @click="submitLoginCode"
      >
        {{ loading ? 'Signing in…' : 'Complete sign-in & run' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.modal-pad { padding: 20px; }
.auth-desc { font-size: 13px; color: var(--color-text-hover); margin: 0 0 14px; line-height: 1.5; }
.auth-getlink { display: flex; }
.auth-steps { margin: 0 0 12px; padding-left: 20px; font-size: 13px; color: var(--color-text-primary); }
.auth-steps li { margin: 4px 0; }
.auth-steps a { color: var(--color-accent); }
.auth-code {
  width: 100%;
  padding: 9px 12px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  outline: none;
}
.auth-code:focus { border-color: var(--color-accent); }
.auth-error { margin-top: 10px; padding: 8px 12px; color: var(--color-error); font-size: 12px; background: rgba(232, 88, 88, 0.08); border-radius: 6px; }
</style>
