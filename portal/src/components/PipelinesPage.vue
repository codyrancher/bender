<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'
import type { GithubAuthStatus } from '@/services/api'
import EditorModal from './EditorModal.vue'
import DiffViewer from './DiffViewer.vue'
import FileViewer from './FileViewer.vue'
import ViewportOverlay from './ViewportOverlay.vue'
import Modal from './Modal.vue'
import PipelineGraph from './PipelineGraph.vue'
import { getBrowserUrl } from '@/services/urls'
import type { PipelineStage, PipelineRun, PipelineStageRecord, Artifact, PipelineArg } from '@/types'

const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const definitions = ref<Array<{ id: string; name: string; stages?: PipelineStage[]; skills?: string[]; args?: PipelineArg[] }>>([])
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

const pushTarget = ref<{ pipeline: string; definitionId: string; message: string } | null>(null)
const pushing = ref(false)

function openPush(pipeline: string) {
  pushTarget.value = { pipeline, definitionId: pipeline, message: `Update ${pipeline} definition` }
}

async function confirmPush() {
  const t = pushTarget.value
  if (!t || pushing.value || !t.definitionId.trim()) return
  pushing.value = true
  try {
    const r = await api.pushPipelineDefinition(t.pipeline, t.definitionId.trim(), t.message.trim())
    await loadDefinitions()
    pushTarget.value = null
    uiStore.showToast(`Pushed "${r.id}" (${r.skillCount} skill${r.skillCount === 1 ? '' : 's'}) to definitions`, 'success')
  } catch (err) {
    uiStore.showToast(err instanceof Error ? err.message : 'Push failed', 'error')
  } finally {
    pushing.value = false
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

const mdEditor = ref<{ pipeline: string; content: string; claude: string } | null>(null)
// Declared pipeline args + working/baseline values for the editor's "env args" tab.
interface ArgDef { name: string; description: string; required: boolean; default: string; value: string }
const editArgDefs = ref<ArgDef[]>([])
const editArgValues = ref<Record<string, string>>({})
const editArgOriginal = ref<Record<string, string>>({})
const editArgsDirty = computed(() => JSON.stringify(editArgValues.value) !== JSON.stringify(editArgOriginal.value))
const skillEditor = ref<{
  pipeline: string
  skill: string
  stageIndex: number
  runId: number | null
  content: string
} | null>(null)

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

async function startRunDirect(pipeline: string) {
  await api.createPipelineRun(pipeline)
  await fetchRuns(pipeline)
}

// A stage can be re-run (as a new run, seeded from preceding stages) only when
// the latest run actually settled in a failed/cancelled state — i.e. there's a
// concrete run to copy the earlier stages from and nothing is in flight.
function canRerunStages(pipeline: string): boolean {
  if (isRunActive(pipeline)) return false
  const s = latestRun(pipeline)?.status
  return s === 'failed' || s === 'cancelled'
}

// Pipelines whose rerun-from-stage we've just kicked off (prevents double-fire
// while the new run record is being fetched).
const rerunningStage = ref<Set<string>>(new Set())

async function rerunStageAsNew(pipeline: string, stageIndex: number, e: Event) {
  e.stopPropagation()
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

function isRunActive(pipeline: string): boolean {
  return latestRun(pipeline)?.status === 'running' || startingRuns.value.has(pipeline)
}

// Per-pipeline run ordinal for display; falls back to the global id.
function runNo(run: { run_number?: number; id: number }): number {
  return run.run_number ?? run.id
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

function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB'
  return bytes + ' B'
}

// --- pipeline.md editor ---

async function openMdEditor(pipeline: string) {
  try {
    const [md, claude, args] = await Promise.all([
      api.getPipelineMd(pipeline),
      api.getPipelineClaudeMd(pipeline),
      api.getPipelineArgs(pipeline),
    ])
    editArgDefs.value = args.args
    const vals: Record<string, string> = {}
    for (const a of args.args) vals[a.name] = a.value
    editArgValues.value = vals
    editArgOriginal.value = { ...vals }
    mdEditor.value = { pipeline, content: md.content, claude: claude.content }
  } catch {}
}

async function saveMd(content: string) {
  if (!mdEditor.value) return
  await api.savePipelineMd(mdEditor.value.pipeline, content)
  await pipelinesStore.fetchPipelines()
}

async function saveClaude(content: string) {
  if (!mdEditor.value) return
  await api.savePipelineClaudeMd(mdEditor.value.pipeline, content)
}

async function saveArgs() {
  if (!mdEditor.value) return
  await api.savePipelineArgs(mdEditor.value.pipeline, editArgValues.value)
  editArgOriginal.value = { ...editArgValues.value }
}

async function rerunFromMd(value: string) {
  if (!mdEditor.value) return
  if (value === 'pipeline') {
    await startRunDirect(mdEditor.value.pipeline)
  }
}

// --- skill editor ---

async function openSkillEditor(pipeline: string, skill: string, stageIndex: number, runId: number | null) {
  try {
    const data = await api.getSkill(pipeline, skill)
    skillEditor.value = { pipeline, skill, stageIndex, runId, content: data.content }
  } catch {}
}

async function saveSkill(content: string) {
  if (!skillEditor.value) return
  await api.saveSkill(skillEditor.value.pipeline, skillEditor.value.skill, content)
}

async function rerunFromSkill(value: string) {
  const se = skillEditor.value
  if (!se) return
  if ((value === 'stage' || value === 'stage-snapshot') && se.runId !== null) {
    await api.rerunStage(se.pipeline, se.runId, se.stageIndex, { fromSnapshot: value === 'stage-snapshot' })
    await fetchRuns(se.pipeline)
  } else if (value === 'pipeline') {
    await startRunDirect(se.pipeline)
  }
}

const skillRerunOptions = computed(() => {
  const se = skillEditor.value
  if (!se) return []
  const opts: Array<{ label: string; value: string; hint?: string }> = []
  if (se.runId !== null) {
    opts.push({ label: 'Rerun this stage from saved state', value: 'stage-snapshot', hint: "Restore the workspace to this stage's start, with your edited skill" })
    opts.push({ label: 'Rerun this stage', value: 'stage', hint: 'Re-execute against the current workspace' })
  }
  opts.push({ label: 'Rerun pipeline', value: 'pipeline', hint: 'Start a fresh run from the beginning' })
  return opts
})

function selectStage(pipeline: string, stageIndex: number, runId: number | null) {
  selectedStage.value = { pipeline, stageIndex, runId }
  showLiveBrowser.value = false
}

function closeStageModal() {
  selectedStage.value = null
  showLiveBrowser.value = false
}

// Live browser view: the agent drives the project's browser sidecar over CDP,
// and that same browser streams its screen (Selkies) — so embedding the stream
// shows the agent clicking/typing/navigating in real time.
const showLiveBrowser = ref(false)
const liveBrowserUrl = computed(() => {
  const name = stageDetail.value?.pipeline
  if (!name) return ''
  const port = pipelinesStore.getPipelineBrowserPort(name)
  if (!port) return ''
  return getBrowserUrl(name, port, pipelinesStore.getPipelineBrowserHost(name))
})
const canWatchLiveBrowser = computed(() =>
  !!liveBrowserUrl.value && stageDetail.value?.record?.status === 'running',
)

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

const stageArtifacts = computed<Artifact[]>(() => {
  const raw = stageDetail.value?.record?.artifacts
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})

const diffViewer = ref<{ commits: Artifact[]; index: number } | null>(null)
const videoOverlay = ref<{ url: string; name: string } | null>(null)
const fileViewer = ref<{ url: string; name: string; subtitle?: string } | null>(null)
const imageOverlay = ref<{ url: string; name: string } | null>(null)

function openFile(art: Artifact) {
  if (art.url) fileViewer.value = { url: art.url, name: art.name }
}

// Read-only snapshots of the definition files as they were when a run started
function viewPipelineMdSnapshot(pipeline: string, run: PipelineRun, e: Event) {
  e.stopPropagation()
  fileViewer.value = {
    name: 'pipeline.md',
    url: `/api/pipelines/${pipeline}/runs/${run.id}/pipeline-md`,
    subtitle: `run #${runNo(run)} · read-only snapshot`,
  }
}

function viewSkillSnapshot() {
  const sd = stageDetail.value
  if (!sd?.run) return
  fileViewer.value = {
    name: 'SKILL.md',
    url: `/api/pipelines/${sd.pipeline}/runs/${sd.run.id}/stages/${sd.stageIndex}/skill-md`,
    subtitle: `${sd.defStage?.skill || sd.record?.skill} · run #${runNo(sd.run)} · read-only snapshot`,
  }
}

function openImage(art: Artifact) {
  if (art.url) imageOverlay.value = { url: art.url, name: art.name }
}

function openDiff(art: Artifact) {
  const commits = stageArtifacts.value.filter(a => a.type === 'commit')
  const index = Math.max(0, commits.findIndex(c => c.url === art.url))
  diffViewer.value = { commits, index }
}

// Keep the log view pinned to the newest line as logs stream in
const logsEl = ref<HTMLElement | null>(null)
watch(() => stageDetail.value?.record?.logs, () => {
  nextTick(() => {
    if (logsEl.value) logsEl.value.scrollTop = logsEl.value.scrollHeight
  })
})

function statusColor(status: string): string {
  if (status === 'running') return 'var(--color-status-running)'
  if (status === 'stopped' || status === 'failed') return 'var(--color-status-stopped)'
  if (status === 'completed') return 'var(--color-status-running)'
  if (status === 'cancelled') return 'var(--color-warning)'
  return 'var(--color-status-default)'
}

function stageStatusColor(status: string): string {
  if (status === 'running') return 'var(--color-status-running)'
  if (status === 'completed') return 'var(--color-status-running)'
  if (status === 'failed') return 'var(--color-error)'
  if (status === 'cancelled') return 'var(--color-warning)'
  if (status === 'skipped') return 'var(--color-text-muted)'
  return 'var(--color-status-default)'
}

function stageStatusIcon(status: string): string {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✕'
  if (status === 'running') return '●'
  if (status === 'skipped') return '–'
  if (status === 'cancelled') return '⊘'
  return '○'
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  return `${mins}m ${remainSecs}s`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function runDuration(run: PipelineRun): string {
  if (!run.started_at) return '—'
  const start = new Date(run.started_at).getTime()
  const end = run.completed_at ? new Date(run.completed_at).getTime() : now.value
  return formatDuration(end - start)
}

// Live elapsed time for a stage: final duration once recorded, otherwise ticks from start
function liveStageDuration(record: { started_at: string | null; completed_at: string | null; duration_ms: number | null }): string {
  if (record.duration_ms !== null) return formatDuration(record.duration_ms)
  if (!record.started_at) return '—'
  const end = record.completed_at ? new Date(record.completed_at).getTime() : now.value
  return formatDuration(end - new Date(record.started_at).getTime())
}

function latestRun(pipeline: string): PipelineRun | null {
  const runs = pipelineRuns.value[pipeline]
  return runs?.length ? runs[0] : null
}

function latestRunStages(pipeline: string): PipelineStageRecord[] {
  const run = latestRun(pipeline)
  return run?.stages || []
}

// Pipelines whose run we've just kicked off, for optimistic UI before the real
// run record arrives (so the button flips to Cancel and the entry stage shows
// running immediately).
const startingRuns = ref<Set<string>>(new Set())

function isEntryStage(stages: PipelineStage[], index: number): boolean {
  return !stages.some(s => (s.next || []).includes(index))
}

// Stage records to render on the graph: the real latest-run stages, or — while
// a run is optimistically starting and the real record hasn't landed yet — a
// synthetic set with the entry stage(s) running and the rest pending.
function displayStages(pipeline: string): PipelineStageRecord[] {
  if (startingRuns.value.has(pipeline) && latestRun(pipeline)?.status !== 'running') {
    const defs = pipelines.value.find(p => p.name === pipeline)?.stages || []
    const nowIso = new Date().toISOString()
    return defs.map((_, i) => {
      const running = isEntryStage(defs, i)
      return {
        stage_index: i,
        status: running ? 'running' : 'pending',
        started_at: running ? nowIso : null,
        completed_at: null,
        duration_ms: null,
        success_criteria_met: 0,
      } as unknown as PipelineStageRecord
    })
  }
  return latestRunStages(pipeline)
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
        <div
          v-for="pl in pipelines"
          :key="pl.name"
          class="pipeline-card"
          :class="{ deleting: pl.status === 'deleting' }"
        >
          <div class="pipeline-header">
            <div class="pipeline-name-row">
              <span class="pipeline-name">{{ pl.name }}</span>
              <span v-if="pl.status === 'deleting'" class="deleting-badge">
                <span class="deleting-spinner"></span> Deleting…
              </span>
              <div class="header-actions">
                <button
                  class="icon-btn"
                  title="Edit pipeline.md"
                  @click.stop="openMdEditor(pl.name)"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  class="icon-btn"
                  :class="{ active: expandedPipeline === pl.name }"
                  title="Run history"
                  @click.stop="toggleExpand(pl.name)"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 4v6h6" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    <polyline points="12 7 12 12 15 14" />
                  </svg>
                </button>
                <button
                  class="icon-btn"
                  title="Push to definitions repo"
                  @click.stop="openPush(pl.name)"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19V6" /><path d="M5 12l7-7 7 7" /><path d="M5 21h14" />
                  </svg>
                </button>
                <button
                  class="icon-btn danger"
                  title="Delete pipeline"
                  @click.stop="deleteTarget = pl.name"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Stage graph + Run -->
          <div class="stage-row">
            <PipelineGraph v-if="pl.stages?.length" class="stage-graph" :stages="pl.stages">
              <template #node="{ stage, index }">
                <div
                  class="node-stage gnode"
                  :class="displayStages(pl.name)[index]?.status || 'pending'"
                  @click="selectStage(pl.name, index, null)"
                >
                  <svg v-if="displayStages(pl.name)[index]?.status === 'running'" class="running-ring">
                    <rect />
                  </svg>
                  <div class="stage-elapsed" :style="{ color: stageStatusColor(displayStages(pl.name)[index]?.status || 'pending') }">
                    {{ displayStages(pl.name)[index] ? liveStageDuration(displayStages(pl.name)[index]) : '—' }}
                  </div>
                  <div class="stage-info">
                    <span class="stage-name">{{ stage.name }}</span>
                    <span class="stage-meta">
                      <span class="stage-skill">{{ stage.skill }}</span>
                    </span>
                  </div>
                  <div
                    v-if="displayStages(pl.name)[index]?.success_criteria_met"
                    class="criteria-check"
                    title="Success criteria met"
                  >✓</div>
                  <button
                    v-if="canRerunStages(pl.name) && displayStages(pl.name)[index]"
                    class="stage-rerun-btn"
                    title="Rerun from this stage (new run, preceding stages kept)"
                    @click.stop="rerunStageAsNew(pl.name, index, $event)"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M23 4v6h-6" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                </div>
              </template>
            </PipelineGraph>
            <div class="stage-map empty-map" v-else>
              <span class="empty-text">No stages defined</span>
            </div>

            <button
              v-if="pl.stages?.length"
              class="btn-run-lg"
              :class="{ cancelling: isRunActive(pl.name) }"
              :title="isRunActive(pl.name) ? 'Cancel run' : 'Start a new run'"
              @click="toggleRun(pl.name, $event)"
            >{{ isRunActive(pl.name) ? '■ Cancel' : '▶ Run' }}</button>
          </div>

          <!-- Expanded run history -->
          <div v-if="expandedPipeline === pl.name" class="run-history">
            <div class="run-history-header">
              <span class="run-history-title">Run History</span>
            </div>
            <div v-if="!pipelineRuns[pl.name]?.length" class="no-runs">
              No runs recorded yet
            </div>
            <div
              v-for="run in pipelineRuns[pl.name]"
              :key="run.id"
              class="run-record"
            >
              <div class="run-summary">
                <div class="run-status-dot" :style="{ background: statusColor(run.status) }"></div>
                <span class="run-id">#{{ runNo(run) }}</span>
                <span class="run-status-text" :class="run.status">{{ run.status }}</span>
                <button
                  class="run-md-btn"
                  title="View pipeline.md as it was for this run"
                  @click="viewPipelineMdSnapshot(pl.name, run, $event)"
                >
                  <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="1.5" width="9" height="11" rx="1" /><line x1="4.5" y1="4.5" x2="9.5" y2="4.5" /><line x1="4.5" y1="7" x2="9.5" y2="7" /><line x1="4.5" y1="9.5" x2="7.5" y2="9.5" /></svg>
                  pipeline.md
                </button>
                <span class="run-time">{{ formatTime(run.started_at) }}</span>
                <span class="run-duration">{{ runDuration(run) }}</span>
              </div>
              <div class="run-stages">
                <div
                  v-for="stage in run.stages"
                  :key="stage.id"
                  class="run-stage-row"
                  @click="selectStage(pl.name, stage.stage_index, run.id)"
                >
                  <div class="run-stage-status" :style="{ color: stageStatusColor(stage.status) }">
                    {{ stageStatusIcon(stage.status) }}
                  </div>
                  <span class="run-stage-name">{{ stage.stage_name }}</span>
                  <span class="run-stage-duration">{{ liveStageDuration(stage) }}</span>
                  <span
                    v-if="stage.success_criteria"
                    class="run-criteria"
                    :class="{ met: stage.success_criteria_met, unmet: !stage.success_criteria_met && (stage.status === 'completed' || stage.status === 'failed') }"
                    :title="stage.success_criteria"
                  >
                    {{ stage.success_criteria_met ? '✓ criteria met' : (stage.status === 'completed' || stage.status === 'failed' ? '✕ criteria not met' : 'pending') }}
                  </span>
                  <span v-if="stage.error" class="run-stage-error" :title="stage.error">
                    {{ stage.error }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!pipelines.length" class="empty-state">
          <p>No pipelines yet</p>
          <button class="btn-new" @click="openNewModal">Create your first pipeline</button>
        </div>
      </div>

    </div>

    <!-- Stage detail modal -->
    <Modal
      v-if="stageDetail"
      :title="stageDetail.defStage?.name || stageDetail.record?.stage_name"
      @close="closeStageModal"
    >
      <template #title>
        <h3 class="detail-title-h">{{ stageDetail.defStage?.name || stageDetail.record?.stage_name }}</h3>
        <span class="detail-pipeline">{{ stageDetail.pipeline }}<template v-if="stageDetail.run"> · run #{{ runNo(stageDetail.run) }}</template></span>
      </template>

      <div class="detail-body">
            <div class="detail-section">
              <div class="detail-label">Skill</div>
              <div class="detail-skill-row">
                <span class="detail-value">{{ stageDetail.defStage?.skill || stageDetail.record?.skill }}</span>
                <div class="detail-skill-actions">
                  <button
                    v-if="stageDetail.run"
                    class="btn-edit-skill"
                    title="View SKILL.md as it was for this run"
                    @click="viewSkillSnapshot"
                  >
                    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" /><circle cx="7" cy="7" r="1.6" /></svg>
                    View at run time
                  </button>
                  <button
                    class="btn-edit-skill"
                    @click="openSkillEditor(
                      stageDetail.pipeline,
                      (stageDetail.defStage?.skill || stageDetail.record?.skill) as string,
                      stageDetail.stageIndex,
                      stageDetail.run?.id ?? null,
                    )"
                  >
                    <svg viewBox="0 0 14 14" width="12" height="12"><path d="M9.5 2.5l2 2L5 11l-2.5.5L3 9l6.5-6.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></svg>
                    Edit skill
                  </button>
                </div>
              </div>
            </div>

            <div class="detail-section" v-if="stageDetail.defStage?.description">
              <div class="detail-label">Description</div>
              <div class="detail-value description">{{ stageDetail.defStage.description }}</div>
            </div>

            <div class="detail-section" v-if="stageDetail.defStage?.successCriteria || stageDetail.record?.success_criteria">
              <div class="detail-label">Success Criteria</div>
              <div class="detail-value criteria" :class="{
                met: stageDetail.record?.success_criteria_met,
                unmet: !stageDetail.record?.success_criteria_met && (stageDetail.record?.status === 'completed' || stageDetail.record?.status === 'failed')
              }">
                <span class="criteria-icon" v-if="stageDetail.record?.status === 'completed' || stageDetail.record?.status === 'failed'">
                  {{ stageDetail.record.success_criteria_met ? '✓' : '✕' }}
                </span>
                {{ stageDetail.defStage?.successCriteria || stageDetail.record?.success_criteria }}
              </div>
            </div>

            <template v-if="stageDetail.record">
              <div class="detail-section">
                <div class="detail-label">Status</div>
                <div class="detail-value">
                  <span class="detail-status" :style="{ color: stageStatusColor(stageDetail.record.status) }">
                    {{ stageStatusIcon(stageDetail.record.status) }} {{ stageDetail.record.status }}
                  </span>
                </div>
              </div>

              <div class="detail-section" v-if="canWatchLiveBrowser">
                <div class="detail-label">Live Browser</div>
                <button v-if="!showLiveBrowser" class="btn-live-browser" @click="showLiveBrowser = true">
                  ▶ Watch the agent drive the browser
                </button>
                <div v-else class="live-browser">
                  <div class="live-browser-bar">
                    <span class="live-dot"></span> Live
                    <a class="live-browser-open" :href="liveBrowserUrl" target="_blank" rel="noopener" title="Open in a new tab">↗</a>
                    <button class="live-browser-hide" @click="showLiveBrowser = false">Hide</button>
                  </div>
                  <iframe
                    :src="liveBrowserUrl"
                    class="live-browser-frame"
                    allow="autoplay; clipboard-read; clipboard-write"
                  ></iframe>
                </div>
              </div>

              <div class="detail-section">
                <div class="detail-label">Timing</div>
                <div class="detail-timing">
                  <div class="timing-row">
                    <span class="timing-label">Started</span>
                    <span class="timing-value">{{ formatDateTime(stageDetail.record.started_at) }}</span>
                  </div>
                  <div class="timing-row">
                    <span class="timing-label">Completed</span>
                    <span class="timing-value">{{ formatDateTime(stageDetail.record.completed_at) }}</span>
                  </div>
                  <div class="timing-row">
                    <span class="timing-label">Duration</span>
                    <span class="timing-value highlight">{{ liveStageDuration(stageDetail.record) }}</span>
                  </div>
                </div>
              </div>

              <div class="detail-section" v-if="stageDetail.record.error">
                <div class="detail-label">Error</div>
                <div class="detail-value error-block">{{ stageDetail.record.error }}</div>
              </div>

              <div class="detail-section">
                <div class="detail-label">
                  Logs
                  <span v-if="stageDetail.record.status === 'running'" class="log-live">● live</span>
                </div>
                <div ref="logsEl" class="detail-logs">
                  <pre v-if="stageDetail.record.logs" class="logs-text">{{ stageDetail.record.logs }}</pre>
                  <div class="logs-placeholder" v-else-if="stageDetail.record.status === 'pending'">
                    Stage has not started yet
                  </div>
                  <div class="logs-placeholder" v-else>
                    No logs captured for this run
                  </div>
                </div>
              </div>

              <div class="detail-section">
                <div class="detail-label">Artifacts</div>
                <div v-if="stageArtifacts.length" class="artifact-grid">
                  <template v-for="(art, ai) in stageArtifacts" :key="ai">
                    <!-- screenshot -->
                    <div v-if="art.type === 'screenshot'" class="artifact artifact-media">
                      <button class="media-thumb" title="Fill browser viewport" @click="openImage(art)">
                        <img :src="art.url" :alt="art.name" loading="lazy" />
                        <span class="media-expand">
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
                          </svg>
                        </span>
                      </button>
                      <div class="artifact-caption">
                        <span class="artifact-icon">🖼</span>
                        <button class="artifact-name link" @click="openImage(art)">{{ art.name }}</button>
                        <span class="artifact-size">{{ formatSize(art.size) }}</span>
                      </div>
                    </div>
                    <!-- video -->
                    <div v-else-if="art.type === 'video'" class="artifact artifact-media">
                      <div class="video-wrap">
                        <video class="artifact-video-player" :src="art.url" controls preload="metadata" :poster="art.poster"></video>
                        <button
                          class="video-expand"
                          title="Fill browser viewport"
                          @click="videoOverlay = { url: art.url!, name: art.name }"
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
                          </svg>
                        </button>
                      </div>
                      <div class="artifact-caption">
                        <span class="artifact-icon">🎬</span>
                        <a class="artifact-name link" :href="art.url" target="_blank" rel="noopener">{{ art.name }}</a>
                        <span class="artifact-size">{{ formatSize(art.size) }}</span>
                      </div>
                    </div>
                    <!-- commit -->
                    <button v-else-if="art.type === 'commit'" class="artifact artifact-row commit-btn" @click="openDiff(art)">
                      <span class="artifact-icon">⎇</span>
                      <div class="artifact-commit-info">
                        <span class="commit-sha">{{ art.name }}</span>
                        <span class="commit-msg">{{ art.message }}</span>
                      </div>
                      <span class="commit-stat add">+{{ art.additions }}</span>
                      <span class="commit-stat del">−{{ art.deletions }}</span>
                    </button>
                    <!-- link -->
                    <a v-else-if="art.type === 'link'" class="artifact artifact-row" :href="art.url" target="_blank" rel="noopener">
                      <span class="artifact-icon">🔗</span>
                      <span class="artifact-name">{{ art.name }}</span>
                      <span class="artifact-ext">↗</span>
                    </a>
                    <!-- file -->
                    <button v-else class="artifact artifact-row file-btn" @click="openFile(art)">
                      <span class="artifact-icon">📄</span>
                      <span class="artifact-name">{{ art.name }}</span>
                      <span class="artifact-size">{{ formatSize(art.size) }}</span>
                      <span class="artifact-view">View</span>
                    </button>
                  </template>
                </div>
                <div v-else class="detail-artifacts">
                  <div class="artifacts-placeholder">No artifacts produced</div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="detail-section">
                <div class="detail-label">Status</div>
                <div class="detail-value muted">No run data — start a run to see execution details</div>
              </div>
            </template>
      </div>
    </Modal>

    <!-- Delete pipeline confirm -->
    <Modal v-if="deleteTarget" title="Delete pipeline" @close="!deleting && (deleteTarget = null)">
      <div class="modal-pad">
        <p class="confirm-text">
          Delete <strong>{{ deleteTarget }}</strong>? This stops and removes its container and all of its data, including run history and artifacts. This cannot be undone.
        </p>
      </div>
      <template #footer>
        <button class="modal-btn cancel" :disabled="deleting" @click="deleteTarget = null">Cancel</button>
        <button class="modal-btn danger" :disabled="deleting" @click="confirmDelete">
          {{ deleting ? 'Deleting...' : 'Delete' }}
        </button>
      </template>
    </Modal>

    <!-- Push to definitions -->
    <Modal v-if="pushTarget" title="Push to definitions" :subtitle="pushTarget.pipeline" @close="!pushing && (pushTarget = null)">
      <div class="modal-pad">
        <p class="confirm-text" style="margin-bottom: 14px;">
          Commits this pipeline's <strong>pipeline.md</strong> and its referenced <strong>SKILL.md</strong> files to the global definitions repo. Subsequent pipelines can be created from it.
        </p>
        <div class="form-group">
          <label>Definition id</label>
          <input v-model="pushTarget.definitionId" type="text" placeholder="my-definition" />
        </div>
        <div class="form-group">
          <label>Commit message</label>
          <input v-model="pushTarget.message" type="text" @keydown.enter="confirmPush" />
        </div>
      </div>
      <template #footer>
        <button class="modal-btn cancel" :disabled="pushing" @click="pushTarget = null">Cancel</button>
        <button class="modal-btn create" :disabled="pushing || !pushTarget.definitionId.trim()" @click="confirmPush">
          {{ pushing ? 'Pushing...' : 'Push' }}
        </button>
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
        <button class="modal-btn cancel" :disabled="creating" @click="showNewModal = false">Cancel</button>
        <button class="modal-btn create" :disabled="!newName.trim() || creating || !argsValid" @click="handleCreate">
          {{ creating ? 'Creating...' : 'Create' }}
        </button>
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
          <button class="modal-btn create" :disabled="authModal.loading" @click="fetchLoginLink">
            {{ authModal.loading ? 'Getting link…' : 'Get sign-in link' }}
          </button>
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
        <button class="modal-btn cancel" :disabled="authModal.loading" @click="authModal = null">Cancel</button>
        <button
          v-if="authModal.url"
          class="modal-btn create"
          :disabled="authModal.loading || !authModal.code.trim()"
          @click="submitLoginCode"
        >
          {{ authModal.loading ? 'Signing in…' : 'Complete sign-in & run' }}
        </button>
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
        <button class="modal-btn cancel" :disabled="githubAuthModal.loading" @click="githubAuthModal = null">Cancel</button>
        <button class="modal-btn" :disabled="githubAuthModal.loading" @click="recheckGithubAuth">
          {{ githubAuthModal.loading ? 'Checking…' : 'Re-check' }}
        </button>
        <button class="modal-btn" :disabled="githubAuthModal.loading" @click="captureGithubSession">Capture session</button>
        <button
          v-if="githubAuthModal.status.authenticated"
          class="modal-btn create"
          :disabled="githubAuthModal.loading"
          @click="runAnywayWithoutGithub"
        >Run</button>
        <button v-else class="modal-btn" :disabled="githubAuthModal.loading" @click="runAnywayWithoutGithub">Run anyway</button>
      </template>
    </Modal>

    <!-- pipeline.md editor -->
    <EditorModal
      v-if="mdEditor"
      title="Edit pipeline"
      :subtitle="mdEditor.pipeline"
      :tabs="[
        { key: 'pipeline', label: 'pipeline.md', content: mdEditor.content, placeholder: '# Pipeline\n\n## Stages\n\n### 1. Stage Name\n**Skill:** skill-name\n**Success Criteria:** ...\nDescription', onSave: saveMd },
        { key: 'claude', label: 'CLAUDE.md', content: mdEditor.claude, placeholder: '# Project instructions for the agent at run time…', onSave: saveClaude },
        { key: 'args', label: 'env args', custom: true, dirty: editArgsDirty, onSaveCustom: saveArgs },
      ]"
      :rerun-options="[{ label: 'Rerun pipeline', value: 'pipeline', hint: 'Start a fresh run with the new definition' }]"
      :on-rerun="rerunFromMd"
      @close="mdEditor = null"
    >
      <template #args>
        <div class="args-tab">
          <p v-if="!editArgDefs.length" class="args-empty">This pipeline declares no args.</p>
          <div v-for="a in editArgDefs" :key="a.name" class="args-row">
            <div class="args-label">
              <span class="args-name">{{ a.name }}<span v-if="a.required" class="args-req">*</span></span>
              <span v-if="a.description" class="args-desc">{{ a.description }}</span>
            </div>
            <input
              v-model="editArgValues[a.name]"
              class="args-input"
              spellcheck="false"
              :placeholder="a.default ? `default: ${a.default}` : ''"
            />
          </div>
          <p class="args-note">Saved values are passed as environment variables to future runs of this pipeline.</p>
        </div>
      </template>
    </EditorModal>

    <!-- skill editor -->
    <EditorModal
      v-if="skillEditor"
      title="Edit skill"
      :subtitle="`${skillEditor.pipeline} · ${skillEditor.skill}`"
      :content="skillEditor.content"
      placeholder="---&#10;name: skill-name&#10;description: ...&#10;---&#10;&#10;Instructions for this skill"
      :rerun-options="skillRerunOptions"
      :on-save="saveSkill"
      :on-rerun="rerunFromSkill"
      @close="skillEditor = null"
    />

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

.btn-secondary {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--color-border-medium);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.btn-secondary:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
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

/* Pipeline card */
.pipeline-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s, opacity 0.2s;
}

.pipeline-card.deleting {
  opacity: 0.55;
  pointer-events: none;
}

.deleting-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-status-stopped);
}

.deleting-spinner {
  width: 11px;
  height: 11px;
  border: 2px solid var(--color-status-stopped);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.pipeline-header {
  padding: 14px 20px;
}

.pipeline-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pipeline-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.pipeline-status-badge {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.pipeline-status-badge.running {
  color: var(--color-status-running);
  background: rgba(91, 168, 160, 0.12);
}

.pipeline-status-badge.stopped {
  color: var(--color-status-stopped);
  background: rgba(232, 128, 96, 0.12);
}

.pipeline-status-badge.not_found {
  color: var(--color-status-default);
  background: rgba(106, 88, 104, 0.15);
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  padding: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 5px;
  transition: background 0.15s, color 0.15s;
  display: flex;
  align-items: center;
}

.icon-btn:hover {
  background: var(--color-bg-element);
  color: var(--color-text-hover);
}

.icon-btn.active {
  color: var(--color-accent);
  background: var(--color-bg-element);
}

.icon-btn.danger:hover {
  color: var(--color-error);
}

/* Stage row holds the stage graph plus a large, right-aligned Run button */
.stage-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 20px 14px;
}

.stage-graph {
  flex: 1;
  min-width: 0;
}

/* stage card fills the graph's fixed node box */
.gnode {
  width: 100%;
  height: 100%;
  min-width: 0;
}

.btn-run-lg {
  flex-shrink: 0;
  align-self: center;
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid var(--color-status-running);
  background: var(--color-status-running);
  color: var(--color-text-bright);
  font-size: 12px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
}

.btn-run-lg:hover {
  opacity: 0.88;
}

.btn-run-lg.cancelling {
  border-color: var(--color-status-stopped);
  background: transparent;
  color: var(--color-status-stopped);
}

.btn-run-lg.cancelling:hover {
  background: var(--color-status-stopped);
  color: var(--color-text-bright);
  opacity: 1;
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

/* Stage map */
.stage-map {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  padding: 2px 0;
}

.stage-map::-webkit-scrollbar {
  height: 4px;
}
.stage-map::-webkit-scrollbar-thumb {
  background: var(--color-border-medium);
  border-radius: 2px;
}

.empty-map {
  justify-content: center;
  min-height: 40px;
}

.empty-text {
  font-size: 12px;
  color: var(--color-text-muted);
}

.node { flex-shrink: 0; }

.node-start, .node-end {
  display: flex;
  align-items: center;
  padding: 0 2px;
}

.node-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.start-dot { background: var(--color-accent); }

.end-dot {
  background: var(--color-border-medium);
  border: 2px solid var(--color-text-muted);
  width: 10px;
  height: 10px;
  transition: background 0.2s, border-color 0.2s;
}

.end-dot.done {
  background: var(--color-status-running);
  border-color: var(--color-status-running);
}

/* Stage node — clickable */
.node-stage {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-bg-element);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  padding: 8px 12px;
  min-width: 130px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.15s, box-shadow 0.2s;
}

/* Rotating dashed "marching ants" ring around a running stage, ~2px outside the card */
.running-ring {
  position: absolute;
  inset: -3px;
  width: calc(100% + 6px);
  height: calc(100% + 6px);
  overflow: visible;
  pointer-events: none;
}

.running-ring rect {
  x: 0;
  y: 0;
  width: 100%;
  height: 100%;
  rx: 9px;
  ry: 9px;
  fill: none;
  stroke: var(--color-status-running);
  stroke-width: 1.5px;
  stroke-dasharray: 6 5;
  animation: marching-ants 0.6s linear infinite;
}

@keyframes marching-ants {
  to { stroke-dashoffset: -11px; }
}

.node-stage:hover {
  background: var(--color-bg-element-hover);
}

.node-stage.running {
  border-color: var(--color-status-running);
}

.node-stage.completed {
  border-color: var(--color-status-running);
}

.node-stage.failed {
  border-color: var(--color-error);
}

.node-stage.cancelled {
  border-color: var(--color-warning);
}

.stage-elapsed {
  flex-shrink: 0;
  min-width: 46px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.stage-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.stage-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stage-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-skill {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.stage-duration {
  font-size: 10px;
  color: var(--color-status-running);
  font-weight: 500;
}

.criteria-check {
  color: var(--color-status-running);
  font-size: 12px;
  font-weight: 700;
  margin-left: auto;
  flex-shrink: 0;
}

/* Rerun-from-this-stage affordance — only rendered when the latest run
   failed/cancelled. Sits in the top-right corner of the stage card. */
.stage-rerun-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--color-border-medium);
  background: var(--color-bg-element);
  color: var(--color-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, border-color 0.15s, background 0.15s, transform 0.15s;
  z-index: 3;
}

.node-stage:hover .stage-rerun-btn {
  opacity: 1;
}

.stage-rerun-btn:hover {
  color: var(--color-status-running);
  border-color: var(--color-status-running);
  background: var(--color-bg-element-hover);
  transform: rotate(-30deg);
}

/* Connector */
.connector {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 28px;
}

.connector-line {
  flex: 1;
  height: 2px;
  background: var(--color-border-medium);
  transition: background 0.2s;
}

.connector.active .connector-line {
  background: var(--color-status-running);
}

.connector-arrow {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 6px solid var(--color-border-medium);
  flex-shrink: 0;
  transition: border-color 0.2s;
}

.connector.active .connector-arrow {
  border-left-color: var(--color-status-running);
}

/* Run history */
.run-history {
  border-top: 1px solid var(--color-border-dark);
  padding: 12px 20px 16px;
  background: var(--color-bg-primary);
}

.run-history-header {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.run-history-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.no-runs {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: 8px 0;
}

.run-record {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  margin-bottom: 8px;
  overflow: hidden;
}

.run-record:last-child { margin-bottom: 0; }

.run-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-dark);
}

.run-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.run-id {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.run-status-text {
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.run-status-text.running { color: var(--color-status-running); }
.run-status-text.completed { color: var(--color-status-running); }
.run-status-text.failed { color: var(--color-error); }
.run-status-text.pending { color: var(--color-status-default); }
.run-status-text.cancelled { color: var(--color-warning); }

.run-time {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-left: auto;
}

.run-duration {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 500;
}

.run-stages { padding: 4px 0; }

.run-stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.run-stage-row:hover {
  background: var(--color-bg-tertiary);
}

.run-stage-status {
  font-size: 12px;
  font-weight: 700;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.run-stage-name {
  color: var(--color-text-primary);
  font-weight: 500;
  min-width: 80px;
}

.run-stage-duration {
  color: var(--color-text-muted);
  font-size: 11px;
  min-width: 40px;
}

.run-criteria {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.run-criteria.met {
  color: var(--color-status-running);
  background: rgba(91, 168, 160, 0.12);
}

.run-criteria.unmet {
  color: var(--color-error);
  background: rgba(232, 88, 88, 0.12);
}

.run-stage-error {
  color: var(--color-error);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
  margin-left: auto;
}

/* Stage detail modal */
.detail-title-h {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.detail-pipeline {
  font-size: 11px;
  color: var(--color-text-muted);
}

.detail-section {
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border-dark);
}

.detail-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.detail-value {
  font-size: 13px;
  color: var(--color-text-primary);
  line-height: 1.5;
}

.detail-value.description {
  font-size: 12px;
  color: var(--color-text-hover);
}

.detail-skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.detail-skill-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.run-md-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border-medium);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 10px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  margin-left: 4px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.run-md-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-edit-skill {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid var(--color-border-medium);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.btn-edit-skill:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.detail-value.criteria {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--color-bg-primary);
}

.detail-value.criteria.met {
  color: var(--color-status-running);
  border-left: 3px solid var(--color-status-running);
}

.detail-value.criteria.unmet {
  color: var(--color-error);
  border-left: 3px solid var(--color-error);
}

.criteria-icon {
  font-weight: 700;
  margin-right: 4px;
}

.detail-value.muted {
  color: var(--color-text-muted);
  font-size: 12px;
  font-style: italic;
}

.detail-status {
  font-weight: 600;
  text-transform: capitalize;
}

/* Live browser stream */
.btn-live-browser {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.btn-live-browser:hover { background: var(--color-accent); color: var(--color-text-bright); }

.live-browser {
  border: 1px solid var(--color-border-dark);
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}
.live-browser-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border-dark);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-running);
  animation: pulse 1.5s ease-in-out infinite;
}
.live-browser-open {
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 13px;
}
.live-browser-open:hover { color: var(--color-accent); }
.live-browser-hide {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.live-browser-hide:hover { color: var(--color-text-primary); }
.live-browser-frame {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: none;
  background: #000;
}

.detail-timing {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timing-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.timing-label {
  color: var(--color-text-muted);
}

.timing-value {
  color: var(--color-text-primary);
}

.timing-value.highlight {
  color: var(--color-status-running);
  font-weight: 600;
}

.error-block {
  font-size: 12px;
  color: var(--color-error);
  background: rgba(232, 88, 88, 0.08);
  padding: 8px 10px;
  border-radius: 4px;
  border-left: 3px solid var(--color-error);
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-logs {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-dark);
  border-radius: 4px;
  min-height: 80px;
  max-height: 220px;
  overflow-y: auto;
  padding: 8px 10px;
}

.logs-text {
  margin: 0;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  color: var(--color-text-hover);
  white-space: pre-wrap;
  word-break: break-word;
}

.logs-placeholder {
  color: var(--color-text-muted);
  font-size: 12px;
}

.log-live {
  color: var(--color-status-running);
  font-size: 9px;
  margin-left: 6px;
  animation: pulse 1.5s ease-in-out infinite;
}

.detail-artifacts {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-dark);
  border-radius: 4px;
  padding: 8px 10px;
}

.artifacts-placeholder {
  color: var(--color-text-muted);
  font-size: 12px;
}

/* Artifacts */
.artifact-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.artifact {
  text-decoration: none;
  color: inherit;
}

.artifact-media {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-bg-primary);
  transition: border-color 0.15s;
}

.artifact-media:hover {
  border-color: var(--color-accent);
}

.artifact-media img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
  background: var(--color-bg-tertiary);
}

.video-wrap {
  position: relative;
}

.artifact-video-player {
  width: 100%;
  max-height: 200px;
  display: block;
  background: #000;
}

/* hover-reveal expand button shared by video + screenshot thumbnails */
.media-thumb {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: var(--color-bg-tertiary);
  cursor: pointer;
}

.media-thumb img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
}

.video-expand,
.media-expand {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.video-wrap:hover .video-expand,
.media-thumb:hover .media-expand {
  opacity: 1;
}

.video-expand:hover {
  background: rgba(0, 0, 0, 0.8);
}

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

.artifact-name.link {
  text-decoration: none;
}

button.artifact-name.link {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font: inherit;
}

.artifact-name.link:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.artifact-caption {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
}

.artifact-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  background: var(--color-bg-primary);
  font-size: 12px;
  transition: border-color 0.15s;
}

a.artifact-row:hover,
.commit-btn:hover {
  border-color: var(--color-accent);
}

.commit-btn,
.file-btn {
  width: 100%;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.file-btn:hover {
  border-color: var(--color-accent);
}

.artifact-view {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-accent);
  margin-left: auto;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.file-btn .artifact-size {
  margin-left: 0;
}

.artifact-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.artifact-name {
  color: var(--color-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artifact-size {
  color: var(--color-text-muted);
  font-size: 10px;
  margin-left: auto;
  flex-shrink: 0;
}

.artifact-ext {
  color: var(--color-text-muted);
  margin-left: auto;
  flex-shrink: 0;
}

.artifact-commit-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.commit-sha {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--color-accent);
  font-weight: 600;
}

.commit-msg {
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-stat {
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.commit-stat.add { color: var(--color-status-running); }
.commit-stat.del { color: var(--color-status-stopped); }
.commit-stat.add { margin-left: auto; }

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

/* Modal */
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

.args-form {
  margin-bottom: 14px;
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

.args-form input {
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

.args-form input:focus { border-color: var(--color-accent); }
.args-form input::placeholder { color: var(--color-text-muted); }

/* Claude sign-in modal */
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

.modal-btn.danger {
  background: var(--color-error);
  color: var(--color-text-bright);
}

.modal-btn.danger:hover {
  background: var(--color-status-stopped);
}

.modal-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* env args tab (custom slot in EditorModal) */
.args-tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.args-empty {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0;
}

.args-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.args-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.args-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}

.args-req {
  color: var(--color-error);
  margin-left: 2px;
}

.args-desc {
  font-size: 12px;
  color: var(--color-text-muted);
}

.args-input {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 0.15s;
}

.args-input:focus {
  border-color: var(--color-accent);
}

.args-note {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 4px 0 0;
}
</style>
