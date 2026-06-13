<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'
import type { GithubAuthStatus } from '@/services/api'
import DiffViewer from '../components/primitives/DiffViewer.vue'
import FileViewer from '../components/primitives/FileViewer.vue'
import ViewportOverlay from '../components/primitives/ViewportOverlay.vue'
import Modal from '../components/primitives/Modal.vue'
import Button from '../components/primitives/Button.vue'
import PipelineCard from '../components/PipelineCard.vue'
import StageDetailModal from '../components/StageDetailModal.vue'
import { getBrowserUrl } from '@/services/urls'
import { runNo } from '@/utils/pipelineFormat'
import type { PipelineRun, Artifact, PipelineArg } from '@/types'

const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()
const router = useRouter()

const definitions = ref<Array<{ id: string; name: string; stages?: any[]; skills?: string[]; args?: PipelineArg[] }>>([])
const showNewModal = ref(false)
const newName = ref('')
const selectedDefinition = ref('')
const argValues = ref<Record<string, string>>({})
const creating = ref(false)

const pipelineRuns = ref<Record<string, PipelineRun[]>>({})
const expandedPipeline = ref<string | null>(null)
const selectedStage = ref<{ pipeline: string; stageIndex: number; runId: number | null } | null>(null)

const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

const deleteTarget = ref<string | null>(null)
const deleting = ref(false)

// Edit this pipeline INSTANCE's env arg values (declared via the pipeline's
// "## Args" section, persisted to .bender.json, passed to runs as env vars).
interface ArgDef { name: string; description: string; required: boolean; default: string; value: string }
const argsEditor = ref<{ pipeline: string; defs: ArgDef[]; values: Record<string, string>; saving: boolean; error: string } | null>(null)

async function openArgsEditor(pipeline: string) {
  try {
    const a = await api.getPipelineArgs(pipeline)
    const values: Record<string, string> = {}
    for (const d of a.args) values[d.name] = d.value
    argsEditor.value = { pipeline, defs: a.args, values, saving: false, error: '' }
  } catch (e) {
    uiStore.showToast(e instanceof Error ? e.message : 'Failed to load args', 'error')
  }
}

async function saveArgsEditor() {
  const ed = argsEditor.value
  if (!ed || ed.saving) return
  ed.saving = true; ed.error = ''
  try {
    await api.savePipelineArgs(ed.pipeline, ed.values)
    argsEditor.value = null
  } catch (err) {
    ed.error = err instanceof Error ? err.message : 'Save failed'
  } finally {
    if (argsEditor.value) argsEditor.value.saving = false
  }
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await pipelinesStore.deletePipeline(deleteTarget.value)
    deleteTarget.value = null
  } catch {
  } finally {
    deleting.value = false
  }
}

async function loadDefinitions() {
  try {
    const data = await api.getDefinitions()
    definitions.value = data.definitions
    if (data.definitions.length && !data.definitions.find(d => d.id === selectedDefinition.value)) {
      selectedDefinition.value = data.definitions[0].id
    }
  } catch {}
}

onMounted(async () => {
  await loadDefinitions()

  nowTimer = setInterval(() => { now.value = Date.now() }, 1000)
  // Poll runs for any pipeline with an in-flight run so stages/logs update live
  pollTimer = setInterval(() => {
    for (const pl of pipelinesStore.pipelines) {
      if (latestRun(pl.name)?.status === 'running') fetchRuns(pl.name)
    }
  }, 2000)
})

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
  if (pollTimer) clearInterval(pollTimer)
})

// Load the latest runs for each pipeline as the list loads, so the graph shows
// stage state by default (without expanding run history). Robust to the pipeline
// list arriving after mount.
watch(
  () => pipelinesStore.pipelines.map(p => p.name).join('\n'),
  () => {
    for (const pl of pipelinesStore.pipelines) {
      if (!pipelineRuns.value[pl.name]) fetchRuns(pl.name)
    }
  },
  { immediate: true },
)

async function fetchRuns(pipeline: string) {
  try {
    const data = await api.getPipelineRuns(pipeline, 5)
    pipelineRuns.value = { ...pipelineRuns.value, [pipeline]: data.runs }
  } catch {}
}

const pipelines = computed(() => pipelinesStore.pipelines)

const selectedArgs = computed<PipelineArg[]>(() => {
  if (!selectedDefinition.value) return []
  const def = definitions.value.find(d => d.id === selectedDefinition.value)
  return def?.args || []
})

// Seed the arg form with declared defaults whenever the selected definition changes.
watch(selectedArgs, (args) => {
  const next: Record<string, string> = {}
  for (const a of args) next[a.name] = argValues.value[a.name] ?? a.default ?? ''
  argValues.value = next
}, { immediate: true })

const argsValid = computed(() =>
  selectedArgs.value.every(a => !a.required || (argValues.value[a.name] || '').trim()),
)

function toggleExpand(name: string) {
  if (expandedPipeline.value === name) {
    expandedPipeline.value = null
  } else {
    expandedPipeline.value = name
    fetchRuns(name)
  }
}

function openNewModal() {
  newName.value = ''
  showNewModal.value = true
}

async function handleCreate() {
  if (!newName.value.trim() || creating.value || !argsValid.value) return
  creating.value = true
  try {
    // collect non-empty arg values into the env-args payload
    const args: Record<string, string> = {}
    for (const a of selectedArgs.value) {
      const v = (argValues.value[a.name] || '').trim()
      if (v) args[a.name] = v
    }
    await pipelinesStore.createPipeline(newName.value.trim(), {
      definitionId: selectedDefinition.value || undefined,
      ...(Object.keys(args).length && { args }),
    })
    showNewModal.value = false
  } catch {
  } finally {
    creating.value = false
  }
}

// Pipelines whose rerun-from-stage we've just kicked off (prevents double-fire
// while the new run record is being fetched).
const rerunningStage = ref<Set<string>>(new Set())

async function rerunStageAsNew(pipeline: string, stageIndex: number) {
  const run = latestRun(pipeline)
  if (!run || rerunningStage.value.has(pipeline)) return
  const next = new Set(rerunningStage.value); next.add(pipeline); rerunningStage.value = next
  setStarting(pipeline, true)
  try {
    await api.rerunStageAsNewRun(pipeline, run.id, stageIndex)
    await fetchRuns(pipeline)
  } catch (err) {
    uiStore.showToast(err instanceof Error ? err.message : 'Rerun failed', 'error')
  } finally {
    setStarting(pipeline, false)
    const n = new Set(rerunningStage.value); n.delete(pipeline); rerunningStage.value = n
  }
}

function setStarting(pipeline: string, on: boolean) {
  const next = new Set(startingRuns.value)
  if (on) next.add(pipeline); else next.delete(pipeline)
  startingRuns.value = next
}

// Run button doubles as a cancel toggle while a run is in flight
async function toggleRun(pipeline: string, e: Event) {
  e.stopPropagation()
  const run = latestRun(pipeline)
  if ((run && run.status === 'running') || startingRuns.value.has(pipeline)) {
    setStarting(pipeline, false)
    if (run && run.status === 'running') {
      try { await api.cancelPipelineRun(pipeline, run.id); await fetchRuns(pipeline) } catch {}
    }
    return
  }
  // Optimistic feedback: flip to Cancel + show the entry stage running now.
  setStarting(pipeline, true)
  try {
    // Gate the run on the stage-executor Claude CLI being signed in.
    const auth = await api.getClaudeAuth(pipeline)
    if (!auth.authenticated) {
      setStarting(pipeline, false)
      authModal.value = { pipeline, code: '', loading: false, error: '' }
      return
    }
    // Soft-gate on a GitHub browser session (needed only by upload/PR stages, so
    // it's a warning the user can run past — not a hard block like Claude).
    const gh = await api.getGithubAuth(pipeline)
    if (!gh.authenticated) {
      setStarting(pipeline, false)
      githubAuthModal.value = { pipeline, loading: false, error: '', status: gh }
      return
    }
    await startRun(pipeline)
  } catch {
    // leave it to the next poll/fetch to reflect reality
  } finally {
    setStarting(pipeline, false)
  }
}

async function startRun(pipeline: string) {
  try {
    await api.createPipelineRun(pipeline)
    await fetchRuns(pipeline)
  } catch {}
}

// --- Claude sign-in (OAuth) gate ---
const authModal = ref<{ pipeline: string; url?: string; sessionId?: string; code: string; loading: boolean; error: string } | null>(null)

async function fetchLoginLink() {
  const m = authModal.value
  if (!m) return
  m.loading = true; m.error = ''
  try {
    const r = await api.startClaudeLogin(m.pipeline)
    m.url = r.url; m.sessionId = r.sessionId
  } catch (e) {
    m.error = e instanceof Error ? e.message : 'Failed to get a sign-in link'
  } finally {
    if (authModal.value) authModal.value.loading = false
  }
}

async function submitLoginCode() {
  const m = authModal.value
  if (!m || !m.sessionId || !m.code.trim()) return
  m.loading = true; m.error = ''
  try {
    const r = await api.completeClaudeLogin(m.pipeline, m.sessionId, m.code.trim())
    if (r.authenticated) {
      const pipeline = m.pipeline
      authModal.value = null
      await startRun(pipeline)
    } else {
      m.error = 'Sign-in did not complete — double-check the code and try again.'
    }
  } catch (e) {
    m.error = e instanceof Error ? e.message : 'Sign-in failed'
  } finally {
    if (authModal.value) authModal.value.loading = false
  }
}

// --- GitHub browser-session gate (for uploading media to the PR) ---
const githubAuthModal = ref<{ pipeline: string; loading: boolean; error: string; status: GithubAuthStatus } | null>(null)

function githubSyncedAgo(updatedAt?: number): string {
  if (!updatedAt) return ''
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

// Open the project's sidecar browser in a new tab so the user can sign in to
// GitHub there, then come back and "Capture session".
function openSidecarBrowserForLogin() {
  const m = githubAuthModal.value
  if (!m) return
  const port = pipelinesStore.getPipelineBrowserPort(m.pipeline)
  if (!port) {
    m.error = 'Browser sidecar isn’t running yet — start a run (or the sidecar) first, sign in to github.com there, then capture.'
    return
  }
  const url = getBrowserUrl(m.pipeline, port, pipelinesStore.getPipelineBrowserHost(m.pipeline))
  window.open(url, '_blank', 'noopener')
}

async function recheckGithubAuth() {
  const m = githubAuthModal.value
  if (!m) return
  m.loading = true; m.error = ''
  try { m.status = await api.getGithubAuth(m.pipeline) }
  catch (e) { m.error = e instanceof Error ? e.message : 'Check failed' }
  finally { if (githubAuthModal.value) githubAuthModal.value.loading = false }
}

async function captureGithubSession() {
  const m = githubAuthModal.value
  if (!m) return
  m.loading = true; m.error = ''
  try {
    const status = await api.captureGithubSession(m.pipeline)
    m.status = status
    if (!status.authenticated && status.reason) m.error = status.reason
  } catch (e) {
    m.error = e instanceof Error ? e.message : 'Could not capture the session'
  } finally {
    if (githubAuthModal.value) githubAuthModal.value.loading = false
  }
}

// Proceed with the run despite a missing/uncertain GitHub session.
async function runAnywayWithoutGithub() {
  const m = githubAuthModal.value
  if (!m) return
  const pipeline = m.pipeline
  githubAuthModal.value = null
  await startRun(pipeline)
}

// Editing skills/pipelines happens in the Definitions editor pages (richer
// multi-file editor + validation + history); the Edit buttons route there.
function editSkillInDefinitions(skill: string) {
  if (skill) router.push('/definitions/skills/' + skill)
}
function editPipelineInDefinitions(definition?: string) {
  // Link to the definition this instance was created from — NOT the instance
  // name (they often differ). If unknown, open the Pipelines definitions list.
  router.push(definition ? '/definitions/pipelines/' + definition : '/definitions/pipelines')
}

function selectStage(pipeline: string, stageIndex: number, runId: number | null) {
  selectedStage.value = { pipeline, stageIndex, runId }
}

function closeStageModal() {
  selectedStage.value = null
}

const stageDetail = computed(() => {
  const sel = selectedStage.value
  if (!sel) return null
  const pl = pipelines.value.find(p => p.name === sel.pipeline)
  const defStage = pl?.stages?.[sel.stageIndex]
  // runId null = opened from the DAG → follow the latest run (so after a rerun
  // the modal and "View at run time" track the new run, not the stale one).
  // A concrete runId = opened from run history → pin that specific run.
  const run = sel.runId !== null
    ? pipelineRuns.value[sel.pipeline]?.find(r => r.id === sel.runId) || null
    : latestRun(sel.pipeline)
  const record = run?.stages?.find(s => s.stage_index === sel.stageIndex) || null
  return { pipeline: sel.pipeline, stageIndex: sel.stageIndex, defStage, record, run }
})

const diffViewer = ref<{ commits: Artifact[]; index: number } | null>(null)
const videoOverlay = ref<{ url: string; name: string } | null>(null)
const fileViewer = ref<{ url: string; name: string; subtitle?: string } | null>(null)
const imageOverlay = ref<{ url: string; name: string } | null>(null)

// Read-only snapshot of pipeline.md as it was when a run started
function viewPipelineMdSnapshot(pipeline: string, run: PipelineRun) {
  fileViewer.value = {
    name: 'pipeline.md',
    url: `/api/pipelines/${pipeline}/runs/${run.id}/pipeline-md`,
    subtitle: `run #${runNo(run)} · read-only snapshot`,
  }
}

const startingRuns = ref<Set<string>>(new Set())

function latestRun(pipeline: string): PipelineRun | null {
  const runs = pipelineRuns.value[pipeline]
  return runs?.length ? runs[0] : null
}
</script>

<template>
  <div class="pipelines-page">
    <div class="page-header">
      <h1>Pipelines</h1>
      <div class="page-header-actions">
        <button class="btn-new" @click="openNewModal">+ New Pipeline</button>
      </div>
    </div>

    <div class="pipelines-content">
      <div class="pipelines-list">
        <PipelineCard
          v-for="pl in pipelines"
          :key="pl.name"
          :pipeline="pl"
          :runs="pipelineRuns[pl.name] || []"
          :expanded="expandedPipeline === pl.name"
          :starting="startingRuns.has(pl.name)"
          :now="now"
          @edit="editPipelineInDefinitions(pl.definition)"
          @toggle-history="toggleExpand(pl.name)"
          @edit-args="openArgsEditor(pl.name)"
          @delete="deleteTarget = pl.name"
          @run="toggleRun(pl.name, $event)"
          @rerun="rerunStageAsNew(pl.name, $event)"
          @select-stage="selectStage(pl.name, $event.stageIndex, $event.runId)"
          @view-pipeline-md="viewPipelineMdSnapshot(pl.name, $event)"
        />

        <div v-if="!pipelines.length" class="empty-state">
          <p>No pipelines yet</p>
          <button class="btn-new" @click="openNewModal">Create your first pipeline</button>
        </div>
      </div>
    </div>

    <!-- Stage detail modal -->
    <StageDetailModal
      v-if="stageDetail"
      :detail="stageDetail"
      :now="now"
      @close="closeStageModal"
      @edit-skill="editSkillInDefinitions"
      @open-file="fileViewer = $event"
      @open-image="imageOverlay = $event"
      @open-video="videoOverlay = $event"
      @open-diff="diffViewer = $event"
    />

    <!-- Delete pipeline confirm -->
    <Modal v-if="deleteTarget" title="Delete pipeline" @close="!deleting && (deleteTarget = null)">
      <div class="modal-pad">
        <p class="confirm-text">
          Delete <strong>{{ deleteTarget }}</strong>? This stops and removes its container and all of its data, including run history and artifacts. This cannot be undone.
        </p>
      </div>
      <template #footer>
        <Button variant="secondary" :disabled="deleting" @click="deleteTarget = null">Cancel</Button>
        <Button variant="danger" :disabled="deleting" @click="confirmDelete">
          {{ deleting ? 'Deleting...' : 'Delete' }}
        </Button>
      </template>
    </Modal>

    <!-- Edit env args (this pipeline instance) -->
    <Modal v-if="argsEditor" title="Edit env args" :subtitle="argsEditor.pipeline" @close="!argsEditor.saving && (argsEditor = null)">
      <div class="modal-pad">
        <p v-if="!argsEditor.defs.length" class="confirm-text">This pipeline declares no args.</p>
        <div v-else class="args-form">
          <div v-for="d in argsEditor.defs" :key="d.name" class="args-row">
            <div class="args-label">
              <span class="args-name">{{ d.name }}<span v-if="d.required" class="args-req">*</span></span>
              <span v-if="d.description" class="args-desc">{{ d.description }}</span>
            </div>
            <input
              v-model="argsEditor.values[d.name]"
              class="args-input"
              spellcheck="false"
              :placeholder="d.default ? `default: ${d.default}` : ''"
            />
          </div>
          <p class="args-note">Saved values are passed as environment variables to future runs of this pipeline.</p>
        </div>
        <div v-if="argsEditor.error" class="auth-error">{{ argsEditor.error }}</div>
      </div>
      <template #footer>
        <Button variant="secondary" :disabled="argsEditor.saving" @click="argsEditor = null">Cancel</Button>
        <Button v-if="argsEditor.defs.length" variant="primary" :disabled="argsEditor.saving" @click="saveArgsEditor">
          {{ argsEditor.saving ? 'Saving…' : 'Save' }}
        </Button>
      </template>
    </Modal>

    <!-- New Pipeline Modal -->
    <Modal v-if="showNewModal" title="New Pipeline" @close="!creating && (showNewModal = false)">
      <div class="modal-pad">
        <div class="form-group">
          <label>Name</label>
          <input
            v-model="newName"
            type="text"
            placeholder="my-pipeline"
            autofocus
            @keydown.enter="handleCreate"
          />
        </div>
        <div class="form-group">
          <label>Pipeline Definition</label>
          <select v-model="selectedDefinition">
            <option v-for="def in definitions" :key="def.id" :value="def.id">
              {{ def.name }}
            </option>
          </select>
        </div>
        <div v-if="selectedArgs.length" class="args-form">
          <label>Arguments</label>
          <div v-for="a in selectedArgs" :key="a.name" class="arg-field">
            <div class="arg-label">
              <span class="arg-name">{{ a.name }}</span>
              <span v-if="a.required" class="arg-required">required</span>
            </div>
            <p v-if="a.description" class="arg-desc">{{ a.description }}</p>
            <input
              v-model="argValues[a.name]"
              type="text"
              :placeholder="a.default || a.name"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <Button variant="secondary" :disabled="creating" @click="showNewModal = false">Cancel</Button>
        <Button variant="primary" :disabled="!newName.trim() || creating || !argsValid" @click="handleCreate">
          {{ creating ? 'Creating...' : 'Create' }}
        </Button>
      </template>
    </Modal>

    <!-- Claude sign-in gate -->
    <Modal v-if="authModal" title="Claude sign-in required" :subtitle="authModal.pipeline" @close="!authModal.loading && (authModal = null)">
      <div class="modal-pad">
        <p class="auth-desc">
          Pipeline stages run the Claude CLI inside the pipeline container, which isn't signed in.
          Sign in once — credentials are shared across all pipelines.
        </p>
        <div v-if="!authModal.url" class="auth-getlink">
          <Button variant="primary" :disabled="authModal.loading" @click="fetchLoginLink">
            {{ authModal.loading ? 'Getting link…' : 'Get sign-in link' }}
          </Button>
        </div>
        <template v-else>
          <ol class="auth-steps">
            <li><a :href="authModal.url" target="_blank" rel="noopener">Open the Claude sign-in page ↗</a></li>
            <li>Approve access, then paste the code it gives you below.</li>
          </ol>
          <input
            v-model="authModal.code"
            class="auth-code"
            type="text"
            placeholder="Paste authentication code"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter="submitLoginCode"
          />
        </template>
        <div v-if="authModal.error" class="auth-error">{{ authModal.error }}</div>
      </div>
      <template #footer>
        <Button variant="secondary" :disabled="authModal.loading" @click="authModal = null">Cancel</Button>
        <Button
          v-if="authModal.url"
          variant="primary"
          :disabled="authModal.loading || !authModal.code.trim()"
          @click="submitLoginCode"
        >
          {{ authModal.loading ? 'Signing in…' : 'Complete sign-in & run' }}
        </Button>
      </template>
    </Modal>

    <!-- GitHub browser-session gate -->
    <Modal v-if="githubAuthModal" title="GitHub session not detected" :subtitle="githubAuthModal.pipeline" @close="!githubAuthModal.loading && (githubAuthModal = null)">
      <div class="modal-pad">
        <p class="auth-desc">
          Stages that upload screenshots or videos to a PR/issue do it through a
          <strong>logged-in GitHub browser session</strong> in the sidecar — not a token
          (GitHub has no API for user-attachments). The rest of the run works without it;
          only the upload/PR steps need it.
        </p>
        <div class="gh-status" :class="{ ok: githubAuthModal.status.authenticated }">
          <span class="gh-dot"></span>
          <template v-if="githubAuthModal.status.authenticated">
            Session present{{ githubAuthModal.status.login ? ` — signed in as ${githubAuthModal.status.login}` : '' }}
            <span v-if="githubAuthModal.status.updatedAt" class="gh-meta">· synced {{ githubSyncedAgo(githubAuthModal.status.updatedAt) }}</span>
          </template>
          <template v-else>
            No active GitHub login in the synced session
          </template>
        </div>
        <ol class="auth-steps">
          <li>Sign in to <strong>github.com</strong> in your browser with the bender extension active (it auto-syncs the session), <em>or</em></li>
          <li><a href="#" @click.prevent="openSidecarBrowserForLogin">Open the sidecar browser ↗</a>, sign in to github.com there, then <strong>Capture session</strong> below.</li>
        </ol>
        <div v-if="githubAuthModal.error" class="auth-error">{{ githubAuthModal.error }}</div>
      </div>
      <template #footer>
        <Button variant="secondary" :disabled="githubAuthModal.loading" @click="githubAuthModal = null">Cancel</Button>
        <Button variant="secondary" :disabled="githubAuthModal.loading" @click="recheckGithubAuth">
          {{ githubAuthModal.loading ? 'Checking…' : 'Re-check' }}
        </Button>
        <Button variant="secondary" :disabled="githubAuthModal.loading" @click="captureGithubSession">Capture session</Button>
        <Button
          v-if="githubAuthModal.status.authenticated"
          variant="primary"
          :disabled="githubAuthModal.loading"
          @click="runAnywayWithoutGithub"
        >Run</Button>
        <Button v-else variant="secondary" :disabled="githubAuthModal.loading" @click="runAnywayWithoutGithub">Run anyway</Button>
      </template>
    </Modal>

    <!-- local diff viewer (GitHub-PR style) -->
    <DiffViewer
      v-if="diffViewer"
      :commits="diffViewer.commits"
      :initial-index="diffViewer.index"
      @close="diffViewer = null"
    />

    <!-- file viewer (syntax-highlighted, full viewport) -->
    <FileViewer
      v-if="fileViewer"
      :url="fileViewer.url"
      :name="fileViewer.name"
      :subtitle="fileViewer.subtitle"
      @close="fileViewer = null"
    />

    <!-- video filling the browser viewport -->
    <ViewportOverlay v-if="videoOverlay" :title="videoOverlay.name" @close="videoOverlay = null">
      <video class="vp-video" :src="videoOverlay.url" controls autoplay></video>
    </ViewportOverlay>

    <!-- screenshot / photo filling the browser viewport -->
    <ViewportOverlay v-if="imageOverlay" :title="imageOverlay.name" @close="imageOverlay = null">
      <template #actions>
        <a class="vp-raw" :href="imageOverlay.url" target="_blank" rel="noopener">Open raw ↗</a>
      </template>
      <div class="vp-image-wrap">
        <img class="vp-image" :src="imageOverlay.url" :alt="imageOverlay.name" />
      </div>
    </ViewportOverlay>
  </div>
</template>

<style scoped>
.pipelines-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-primary);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}

.page-header h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-new {
  padding: 7px 16px;
  border-radius: 6px;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn-new:hover {
  background: var(--color-accent);
  color: var(--color-text-bright);
}

.pipelines-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.pipelines-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.confirm-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
}

.confirm-text strong {
  color: var(--color-text-bright);
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 0;
  color: var(--color-text-muted);
}

.empty-state p {
  font-size: 14px;
  margin: 0;
}

/* Modal forms */
.modal-pad {
  padding: 20px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label,
.args-form > label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 9px 12px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--color-accent);
}

.form-group input::placeholder {
  color: var(--color-text-muted);
}

.arg-field {
  margin-bottom: 12px;
}

.arg-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.arg-name {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.arg-required {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-status-stopped);
  border: 1px solid var(--color-status-stopped);
  border-radius: 4px;
  padding: 1px 5px;
}

.arg-desc {
  margin: 0 0 5px;
  font-size: 11px;
  color: var(--color-text-muted);
}

/* env args editor */
.args-form { display: flex; flex-direction: column; gap: 14px; width: 100%; margin-bottom: 14px; }
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
.args-input,
.args-form input {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
}
.args-input:focus,
.args-form input:focus { border-color: var(--color-accent); }
.args-form input::placeholder { color: var(--color-text-muted); }
.args-note { font-size: 12px; color: var(--color-text-muted); margin: 4px 0 0; }

/* Claude sign-in / GitHub session modals */
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

/* viewport-overlay body content (video / image) */
.vp-video {
  flex: 1;
  min-height: 0;
  width: 100%;
  object-fit: contain;
  background: #000;
}

.vp-image-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}

.vp-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.vp-raw {
  font-size: 12px;
  color: var(--color-text-muted);
  text-decoration: none;
}

.vp-raw:hover {
  color: var(--color-accent);
}
</style>
