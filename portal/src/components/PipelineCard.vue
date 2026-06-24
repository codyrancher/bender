<script setup lang="ts">
// One pipeline in the list: header actions, the stage graph (with live status +
// rerun affordance) + Run/Cancel button, and expandable run history. Derives its
// run-display state from props; all user actions are emitted to the page.
import { computed } from 'vue'
import type { Pipeline, PipelineStage, PipelineStageRecord, PipelineRun } from '@/types'
import PipelineGraph from './PipelineGraph.vue'
import IconButton from './primitives/IconButton.vue'
import EditIcon from '@/assets/icons/edit.svg?component'
import HistoryIcon from '@/assets/icons/history.svg?component'
import SlidersIcon from '@/assets/icons/sliders.svg?component'
import TrashIcon from '@/assets/icons/trash.svg?component'
import RerunIcon from '@/assets/icons/rerun.svg?component'
import FileLinesIcon from '@/assets/icons/file-lines.svg?component'
import {
  statusColor, stageStatusColor, stageStatusIcon, liveStageDuration, runNo, formatTime, runDuration,
} from '@/utils/pipelineFormat'

const props = defineProps<{
  pipeline: Pipeline
  runs: PipelineRun[]
  expanded: boolean
  starting: boolean
  now: number
}>()
const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'toggle-history'): void
  (e: 'edit-args'): void
  (e: 'delete'): void
  (e: 'run', event: Event): void
  (e: 'rerun', stageIndex: number): void
  (e: 'select-stage', sel: { stageIndex: number; runId: number | null }): void
  (e: 'view-pipeline-md', run: PipelineRun): void
}>()

const argEntries = computed(() => Object.entries(props.pipeline.args || {}))

const latestRun = computed<PipelineRun | null>(() => props.runs.length ? props.runs[0] : null)

const isRunActive = computed(() => latestRun.value?.status === 'running' || props.starting)

// A stage can be re-run (as a new run, seeded from preceding stages) once the
// latest run has settled — completed, failed, or cancelled.
const canRerunStages = computed(() => {
  if (isRunActive.value) return false
  const s = latestRun.value?.status
  return s === 'completed' || s === 'failed' || s === 'cancelled'
})

function isEntryStage(stages: PipelineStage[], index: number): boolean {
  return !stages.some(s => (s.next || []).includes(index))
}

// Stage records to render on the graph: the real latest-run stages, or — while a
// run is optimistically starting and the real record hasn't landed — a synthetic
// set with the entry stage(s) running and the rest pending.
const displayStages = computed<PipelineStageRecord[]>(() => {
  if (props.starting && latestRun.value?.status !== 'running') {
    const defs = props.pipeline.stages || []
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
  return latestRun.value?.stages || []
})
</script>

<template>
  <div class="pipeline-card" :class="{ deleting: pipeline.status === 'deleting' }">
    <div class="pipeline-header">
      <div class="pipeline-name-row">
        <span class="pipeline-name">{{ pipeline.label || pipeline.name }}</span>
        <span v-if="pipeline.status === 'deleting'" class="deleting-badge">
          <span class="deleting-spinner"></span> Deleting…
        </span>
        <div class="header-actions">
          <IconButton title="Edit pipeline in the definitions editor" @click.stop="emit('edit')">
            <EditIcon width="15" height="15" />
          </IconButton>
          <IconButton :active="expanded" title="Run history" @click.stop="emit('toggle-history')">
            <HistoryIcon width="15" height="15" />
          </IconButton>
          <IconButton title="Edit env args" @click.stop="emit('edit-args')">
            <SlidersIcon width="15" height="15" />
          </IconButton>
          <IconButton variant="danger" title="Delete pipeline" @click.stop="emit('delete')">
            <TrashIcon width="15" height="15" />
          </IconButton>
        </div>
      </div>
      <div v-if="argEntries.length" class="pipeline-args">
        <span v-for="[k, v] in argEntries" :key="k" class="pipeline-arg">
          <span class="arg-k">{{ k }}</span>=<span class="arg-v">{{ v }}</span>
        </span>
      </div>
    </div>

    <!-- Stage graph + Run -->
    <div class="stage-row">
      <PipelineGraph v-if="pipeline.stages?.length" class="stage-graph" :stages="pipeline.stages">
        <template #node="{ stage, index }">
          <div
            class="node-stage gnode"
            :class="displayStages[index]?.status || 'pending'"
            @click="emit('select-stage', { stageIndex: index, runId: null })"
          >
            <svg v-if="displayStages[index]?.status === 'running'" class="running-ring">
              <rect />
            </svg>
            <div class="stage-elapsed" :style="{ color: stageStatusColor(displayStages[index]?.status || 'pending') }">
              {{ displayStages[index] ? liveStageDuration(displayStages[index], now) : '—' }}
            </div>
            <div class="stage-info">
              <span class="stage-name">{{ stage.name }}</span>
              <span class="stage-meta">
                <span class="stage-skill">{{ stage.skill }}</span>
              </span>
            </div>
            <div
              v-if="displayStages[index]?.success_criteria_met"
              class="criteria-check"
              title="Success criteria met"
            >✓</div>
            <button
              v-if="canRerunStages && displayStages[index]"
              class="stage-rerun-btn"
              title="Rerun from this stage (new run, preceding stages kept)"
              @click.stop="emit('rerun', index)"
            >
              <RerunIcon width="13" height="13" />
            </button>
          </div>
        </template>
      </PipelineGraph>
      <div class="stage-map empty-map" v-else>
        <span class="empty-text">No stages defined</span>
      </div>

      <button
        v-if="pipeline.stages?.length"
        class="btn-run-lg"
        :class="{ cancelling: isRunActive }"
        :title="isRunActive ? 'Cancel run' : 'Start a new run'"
        @click="emit('run', $event)"
      >{{ isRunActive ? '■ Cancel' : '▶ Run' }}</button>
    </div>

    <!-- Expanded run history -->
    <div v-if="expanded" class="run-history">
      <div class="run-history-header">
        <span class="run-history-title">Run History</span>
      </div>
      <div v-if="!runs.length" class="no-runs">
        No runs recorded yet
      </div>
      <div
        v-for="run in runs"
        :key="run.id"
        class="run-record"
      >
        <div class="run-summary">
          <div class="run-status-dot" :style="{ background: statusColor(run.status) }"></div>
          <span class="run-id">#{{ runNo(run) }}</span>
          <span class="run-status-text" :class="run.status">{{ run.status }}</span>
          <button
            class="run-md-btn"
            title="View pipeline.yaml as it was for this run"
            @click.stop="emit('view-pipeline-md', run)"
          >
            <FileLinesIcon width="11" height="11" />
            pipeline.yaml
          </button>
          <span class="run-time">{{ formatTime(run.started_at) }}</span>
          <span class="run-duration">{{ runDuration(run, now) }}</span>
        </div>
        <div class="run-stages">
          <div
            v-for="stage in run.stages"
            :key="stage.id"
            class="run-stage-row"
            @click="emit('select-stage', { stageIndex: stage.stage_index, runId: run.id })"
          >
            <div class="run-stage-status" :style="{ color: stageStatusColor(stage.status) }">
              {{ stageStatusIcon(stage.status) }}
            </div>
            <span class="run-stage-name">{{ stage.stage_name }}</span>
            <span class="run-stage-duration">{{ liveStageDuration(stage, now) }}</span>
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
</template>

<style scoped>
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

.pipeline-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.pipeline-args {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 4px;
  font-size: 11px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  color: var(--color-text-muted);
}

.pipeline-arg .arg-k { color: var(--color-text-secondary); }
.pipeline-arg .arg-v { color: var(--color-text-muted); }

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

.stage-map {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow-x: auto;
  padding: 2px 0;
}

.empty-map {
  justify-content: center;
  min-height: 40px;
}

.empty-text {
  font-size: 12px;
  color: var(--color-text-muted);
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

/* Rotating dashed "marching ants" ring around a running stage */
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

.node-stage.running { border-color: var(--color-status-running); }
.node-stage.completed { border-color: var(--color-status-running); }
.node-stage.failed { border-color: var(--color-error); }
.node-stage.cancelled { border-color: var(--color-warning); }

.stage-elapsed {
  flex-shrink: 0;
  min-width: 46px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
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

.criteria-check {
  color: var(--color-status-running);
  font-size: 12px;
  font-weight: 700;
  margin-left: auto;
  flex-shrink: 0;
}

/* Rerun-from-this-stage affordance — top-right corner of the stage card. */
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
</style>
