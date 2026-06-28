<script setup lang="ts">
// Per-stage history, rendered inline below the card with the same visual
// language as the run-history dropdown: how this one stage fared across every
// run (status / duration / criteria), plus a digestible history of how its
// SKILL.md changed, shown as diffs between runs.
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/api'
import { diffLines } from '@/utils/lineDiff'
import { statusColor, formatTime, runNo } from '@/utils/pipelineFormat'
import HistoryDrawer from './HistoryDrawer.vue'
import HistoryCard from './HistoryCard.vue'
import StageRow from './StageRow.vue'
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
  <HistoryDrawer :title="`${stageName} — Stage History`" closable @close="emit('close')">
    <HistoryCard>
      <!-- Runs of this stage -->
      <div class="sh-section">
        <div class="sh-sub">Runs ({{ stageRuns.length }})</div>
        <div class="sh-rows">
          <div v-if="!stageRuns.length" class="no-runs">This stage hasn't run yet</div>
          <StageRow
            v-for="{ run, rec } in stageRuns"
            :key="run.id"
            :record="rec"
            :now="now"
            :carried="isCarried(run, rec)"
            :dim="isCarried(run, rec) || !rec.started_at"
            @click="emit('select-stage', { stageIndex: rec.stage_index, runId: run.id })"
          >
            <template #label>
              <span class="sh-dot" :style="{ background: statusColor(run.status) }"></span>
              #{{ runNo(run) }}
              <span class="sh-time">{{ formatTime(run.started_at) }}</span>
            </template>
            <template #trailing><span class="sh-go">Details ›</span></template>
          </StageRow>
        </div>
      </div>

      <!-- Skill change history -->
      <div class="sh-section">
        <div class="sh-sub">
          Skill changes
          <span v-if="!loading && !error" class="sh-muted">
            · {{ changeCount === 0 ? 'never changed' : changeCount + (changeCount === 1 ? ' change' : ' changes') }}
          </span>
        </div>
        <div v-if="loading" class="no-runs">Loading…</div>
        <div v-else-if="error" class="no-runs err">{{ error }}</div>
        <div v-else-if="!versions.length" class="no-runs">No skill recorded for this stage</div>

        <div v-for="e in entries" :key="e.idx" class="sk-entry">
          <div class="sk-head" @click="toggle(e.idx)">
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
    </HistoryCard>
  </HistoryDrawer>
</template>

<style scoped>
/* Two sections (runs, skill changes) share one card, split by a divider. */
.sh-section + .sh-section { border-top: 1px solid var(--color-border-dark); }

.sh-sub {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--color-text-muted); padding: 10px 12px 4px;
}
.sh-muted { text-transform: none; letter-spacing: 0; }
.no-runs { font-size: 12px; color: var(--color-text-muted); padding: 4px 12px 8px; }
.no-runs.err { color: var(--color-error); }

.sh-rows { padding-bottom: 6px; }

/* Content rendered inside a StageRow's label / trailing slots. */
.sh-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.sh-time { color: var(--color-text-muted); font-weight: 400; }
.sh-go { color: var(--color-text-muted); opacity: 0.6; }

/* Skill-version entries (collapsible rows within the card). */
.sk-entry + .sk-entry { border-top: 1px solid var(--color-border-dark); }
.sk-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; font-size: 11px; }
.sk-head:hover { background: var(--color-bg-element); }
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
