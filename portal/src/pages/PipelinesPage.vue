<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'
import type { PipelineRun } from '@/types'
import { runNo } from '@/utils/pipelineFormat'
import PipelineCard from '../components/PipelineCard.vue'
import StageDetailModal from '../components/StageDetailModal.vue'
import CreatePipelineModal from '../components/CreatePipelineModal.vue'
import PipelineArgsModal from '../components/PipelineArgsModal.vue'
import DeletePipelineConfirm from '../components/DeletePipelineConfirm.vue'
import ClaudeAuthModal from '../components/ClaudeAuthModal.vue'
import ArtifactViewers from '../components/ArtifactViewers.vue'

const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()
const router = useRouter()

const pipelineRuns = ref<Record<string, PipelineRun[]>>({})
const expandedPipeline = ref<string | null>(null)
const selectedStage = ref<{ pipeline: string; stageIndex: number; runId: number | null } | null>(null)

const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

// Modal triggers
const showNew = ref(false)
const argsPipeline = ref<string | null>(null)
const deleteTarget = ref<string | null>(null)
const claudeGate = ref<string | null>(null)

const viewers = ref<InstanceType<typeof ArtifactViewers> | null>(null)

onMounted(() => {
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
// stage state by default (without expanding run history).
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

function toggleExpand(name: string) {
  if (expandedPipeline.value === name) {
    expandedPipeline.value = null
  } else {
    expandedPipeline.value = name
    fetchRuns(name)
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

const startingRuns = ref<Set<string>>(new Set())

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
    // Hard-gate the run on the stage-executor Claude CLI being signed in.
    const auth = await api.getClaudeAuth(pipeline)
    if (!auth.authenticated) {
      setStarting(pipeline, false)
      claudeGate.value = pipeline
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

function onClaudeAuthed(pipeline?: string) {
  claudeGate.value = null
  if (pipeline) startRun(pipeline)
}

// Editing skills/pipelines happens in the Definitions editor pages; the Edit
// buttons route there.
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
  // the modal tracks the new run). A concrete runId = pinned from run history.
  const run = sel.runId !== null
    ? pipelineRuns.value[sel.pipeline]?.find(r => r.id === sel.runId) || null
    : latestRun(sel.pipeline)
  const record = run?.stages?.find(s => s.stage_index === sel.stageIndex) || null
  return { pipeline: sel.pipeline, stageIndex: sel.stageIndex, defStage, record, run }
})

// Read-only snapshot of pipeline.yaml as it was when a run started
function viewPipelineMd(pipeline: string, run: PipelineRun) {
  viewers.value?.openFile({
    name: 'pipeline.yaml',
    url: `/api/pipelines/${pipeline}/runs/${run.id}/pipeline-md`,
    subtitle: `run #${runNo(run)} · read-only snapshot`,
  })
}

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
        <button class="btn-new" @click="showNew = true">+ New Pipeline</button>
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
          @edit-args="argsPipeline = pl.name"
          @delete="deleteTarget = pl.name"
          @run="toggleRun(pl.name, $event)"
          @rerun="rerunStageAsNew(pl.name, $event)"
          @select-stage="selectStage(pl.name, $event.stageIndex, $event.runId)"
          @view-pipeline-md="viewPipelineMd(pl.name, $event)"
        />

        <div v-if="!pipelines.length" class="empty-state">
          <p>No pipelines yet</p>
        </div>
      </div>
    </div>

    <StageDetailModal
      v-if="stageDetail"
      :detail="stageDetail"
      :now="now"
      @close="closeStageModal"
      @edit-skill="editSkillInDefinitions"
      @open-file="viewers?.openFile($event)"
      @open-image="viewers?.openImage($event)"
      @open-video="viewers?.openVideo($event)"
      @open-diff="viewers?.openDiff($event)"
    />

    <CreatePipelineModal v-model:open="showNew" />
    <PipelineArgsModal v-if="argsPipeline" :pipeline="argsPipeline" @close="argsPipeline = null" />
    <DeletePipelineConfirm v-if="deleteTarget" :pipeline="deleteTarget" @close="deleteTarget = null" />
    <ClaudeAuthModal v-if="claudeGate" :pipeline="claudeGate" @close="claudeGate = null" @authenticated="onClaudeAuthed" />

    <ArtifactViewers ref="viewers" />
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
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.pipelines-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
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
</style>
