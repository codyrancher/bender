<script setup lang="ts">
// Per-stage history, rendered inline below the card with the same visual
// language as the run-history dropdown: how this one stage fared across every
// run (status / duration / criteria), plus a digestible history of how its
// SKILL.md changed, shown as diffs between runs.
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/api'
import { diffLines } from '@/utils/lineDiff'
import {
  statusColor, stageStatusColor, stageStatusIcon,
  formatTime, liveStageDuration, runNo,
} from '@/utils/pipelineFormat'
import type { PipelineRun, PipelineStageRecord, SkillVersion } from '@/types'

const props = defineProps<{
  pipeline: string
  stageName: string
  stageIndex: number
  runs: PipelineRun[]
  now: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select-stage', sel: { stageIndex: number; runId: number }): void
}>()

// --- This stage across runs (runs arrive newest-first) ---
interface StageRun { run: PipelineRun; rec: PipelineStageRecord }
const stageRuns = computed<StageRun[]>(() =>
  props.runs
    .map(run => ({ run, rec: run.stages.find(s => s.stage_name === props.stageName) }))
    .filter((x): x is StageRun => !!x.rec),
)

function isCarried(run: PipelineRun, rec: PipelineStageRecord): boolean {
  return !!(run.started_at && rec.started_at && rec.started_at < run.started_at)
}

// --- Skill change history ---
const versions = ref<SkillVersion[]>([])
const loading = ref(true)
const error = ref('')
const expanded = ref<Set<number>>(new Set())

interface Entry {
  v: SkillVersion
  idx: number
  isInitial: boolean
  diff: ReturnType<typeof diffLines> | null
}

const entries = computed<Entry[]>(() =>
  versions.value
    .map((v, idx): Entry => ({
      v,
      idx,
      isInitial: idx === 0,
      diff: idx > 0 ? diffLines(versions.value[idx - 1].skillMd, v.skillMd) : null,
    }))
    .reverse(),
)

const changeCount = computed(() => Math.max(0, versions.value.length - 1))

function runLabel(v: SkillVersion): string {
  return v.firstRunNumber === v.lastRunNumber
    ? `run #${v.firstRunNumber}`
    : `runs #${v.firstRunNumber}–#${v.lastRunNumber}`
}

function toggle(idx: number) {
  const s = new Set(expanded.value)
  s.has(idx) ? s.delete(idx) : s.add(idx)
  expanded.value = s
}

onMounted(async () => {
  try {
    const r = await api.getStageSkillHistory(props.pipeline, props.stageName)
    versions.value = r.versions
    if (r.versions.length > 1) expanded.value = new Set([r.versions.length - 1])
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="run-history stage-history">
    <div class="run-history-header">
      <span class="run-history-title">{{ stageName }} — Stage History</span>
      <button class="sh-close" title="Close" @click="emit('close')">✕</button>
    </div>

    <!-- Runs of this stage -->
    <div class="sh-sub">Runs ({{ stageRuns.length }})</div>
    <div v-if="!stageRuns.length" class="no-runs">This stage hasn't run yet</div>
    <div
      v-for="{ run, rec } in stageRuns"
      :key="run.id"
      class="sh-row"
      :class="{ dim: isCarried(run, rec) || !rec.started_at }"
      title="View stage details"
      @click="emit('select-stage', { stageIndex: rec.stage_index, runId: run.id })"
    >
      <span class="sh-status" :style="{ color: stageStatusColor(rec.status) }">{{ stageStatusIcon(rec.status) }}</span>
      <span class="sh-runid">
        <span class="sh-dot" :style="{ background: statusColor(run.status) }"></span>
        #{{ runNo(run) }}
      </span>
      <span class="sh-time">{{ formatTime(run.started_at) }}</span>
      <span class="sh-dur" :class="{ carried: isCarried(run, rec) }">{{ isCarried(run, rec) ? 'carried' : liveStageDuration(rec, now) }}</span>
      <span
        v-if="rec.success_criteria"
        class="sh-crit"
        :class="{ met: rec.success_criteria_met, unmet: !rec.success_criteria_met && (rec.status === 'completed' || rec.status === 'failed') }"
        :title="rec.success_criteria"
      >{{ rec.success_criteria_met ? '✓ criteria met' : (rec.status === 'completed' || rec.status === 'failed' ? '✕ not met' : 'pending') }}</span>
      <span v-if="rec.error" class="sh-err" :title="rec.error">{{ rec.error }}</span>
      <span class="sh-go">Details ›</span>
    </div>

    <!-- Skill change history -->
    <div class="sh-sub">
      Skill changes
      <span v-if="!loading && !error" class="sh-muted">
        · {{ changeCount === 0 ? 'never changed' : changeCount + (changeCount === 1 ? ' change' : ' changes') }}
      </span>
    </div>
    <div v-if="loading" class="no-runs">Loading…</div>
    <div v-else-if="error" class="no-runs err">{{ error }}</div>
    <div v-else-if="!versions.length" class="no-runs">No skill recorded for this stage</div>

    <div v-for="e in entries" :key="e.idx" class="skill-entry">
      <div class="se-head" @click="toggle(e.idx)">
        <span class="se-caret" :class="{ open: expanded.has(e.idx) }">▸</span>
        <template v-if="e.isInitial">
          <span class="se-label">Initial skill</span>
          <span class="se-runs">{{ runLabel(e.v) }}</span>
        </template>
        <template v-else>
          <span class="se-label">Changed</span>
          <span class="se-runs">{{ runLabel(e.v) }}</span>
          <span class="se-stat add">+{{ e.diff!.adds }}</span>
          <span class="se-stat del">−{{ e.diff!.dels }}</span>
        </template>
      </div>

      <div v-if="expanded.has(e.idx)" class="se-body">
        <pre v-if="e.isInitial" class="skill-full">{{ e.v.skillMd || '(empty)' }}</pre>
        <div v-else class="diff">
          <div v-for="(row, i) in e.diff!.rows" :key="i" class="diff-row" :class="row.type">
            <span class="diff-sign">{{ row.type === 'add' ? '+' : row.type === 'del' ? '−' : '' }}</span>
            <span v-if="row.type === 'gap'" class="diff-gap">⋯ {{ row.count }} unchanged line{{ row.count === 1 ? '' : 's' }}</span>
            <span v-else class="diff-text">{{ row.text || ' ' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage-history { position: relative; }
.run-history-header { display: flex; align-items: center; justify-content: space-between; }
.sh-close {
  border: none; background: transparent; color: var(--color-text-muted);
  cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px;
}
.sh-close:hover { color: var(--color-text-primary); }

.sh-sub {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--color-text-muted); margin: 12px 0 6px;
}
.sh-muted { text-transform: none; letter-spacing: 0; }
.no-runs.err { color: var(--color-error); }

/* Per-run rows — one line, obviously clickable (opens the stage detail modal) */
.sh-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.12s;
}
.sh-row:hover { background: var(--color-bg-tertiary); }
.sh-row.dim { opacity: 0.25; }
.sh-status { width: 14px; text-align: center; flex-shrink: 0; }
.sh-runid { display: flex; align-items: center; gap: 5px; min-width: 44px; color: var(--color-text-primary); flex-shrink: 0; }
.sh-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.sh-time { color: var(--color-text-muted); flex-shrink: 0; }
.sh-dur { color: var(--color-text-muted); flex-shrink: 0; }
.sh-dur.carried { font-style: italic; }
.sh-crit { font-size: 10px; color: var(--color-text-muted); flex-shrink: 0; }
.sh-crit.met { color: var(--color-status-success); }
.sh-crit.unmet { color: var(--color-error); }
.sh-err { color: var(--color-error); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sh-go { margin-left: auto; padding-left: 12px; color: var(--color-text-muted); flex-shrink: 0; opacity: 0.6; transition: color 0.12s, opacity 0.12s; }
.sh-row:hover .sh-go { opacity: 1; color: var(--color-accent); }

/* Skill change entries */
.skill-entry { border: 1px solid var(--color-border-dark); border-radius: var(--radius-sm); margin-bottom: 6px; overflow: hidden; }
.se-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; background: var(--color-bg-secondary); font-size: 11px; }
.se-head:hover { background: var(--color-bg-element); }
.se-caret { color: var(--color-text-muted); transition: transform 0.12s; display: inline-block; }
.se-caret.open { transform: rotate(90deg); }
.se-label { font-weight: 600; color: var(--color-text-primary); }
.se-runs { color: var(--color-text-muted); }
.se-stat { font-family: var(--font-mono, monospace); font-weight: 600; }
.se-stat.add { color: var(--color-status-success); }
.se-stat.del { color: var(--color-error); }

.se-body { border-top: 1px solid var(--color-border-dark); }
.skill-full {
  margin: 0; padding: 10px; max-height: 320px; overflow: auto;
  font-family: var(--font-mono, monospace); font-size: 11px; line-height: 1.5;
  color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word;
}
.diff { max-height: 320px; overflow: auto; font-family: var(--font-mono, monospace); font-size: 11px; line-height: 1.5; }
.diff-row { display: flex; padding: 0 6px; white-space: pre-wrap; word-break: break-word; }
.diff-row.add { background: rgba(46, 160, 67, 0.15); }
.diff-row.del { background: rgba(248, 81, 73, 0.15); }
.diff-row.gap { background: var(--color-bg-secondary); color: var(--color-text-muted); font-style: italic; }
.diff-sign { width: 12px; flex-shrink: 0; color: var(--color-text-muted); user-select: none; }
.diff-row.add .diff-sign { color: var(--color-status-success); }
.diff-row.del .diff-sign { color: var(--color-error); }
.diff-text { flex: 1; }
.diff-gap { flex: 1; }
</style>
