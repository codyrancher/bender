<script setup lang="ts">
// A single clickable row in a history drawer — used both for a stage within a
// run (run history) and for a run of a stage (stage history). The caller fills
// the `label` slot (stage name, or run #/time) and an optional `trailing` slot.
import { computed } from 'vue'
import { stageStatusColor, stageStatusIcon, liveStageDuration } from '@/utils/pipelineFormat'
import type { PipelineStageRecord } from '@/types'

const props = defineProps<{
  record: PipelineStageRecord
  now: number
  // Carried over from a previous run (replayed verbatim, not actually re-run).
  carried?: boolean
  // Dimmed because it didn't run this run (carried, or never started).
  dim?: boolean
}>()

defineEmits<{ (e: 'click'): void }>()

const isDone = computed(() => props.record.status === 'completed' || props.record.status === 'failed')
const critClass = computed(() => ({
  met: !!props.record.success_criteria_met,
  unmet: !props.record.success_criteria_met && isDone.value,
}))
const critLabel = computed(() =>
  props.record.success_criteria_met ? '✓ criteria met' : (isDone.value ? '✕ criteria not met' : 'pending'),
)
</script>

<template>
  <div class="stage-row" :class="{ dim }" @click="$emit('click')">
    <span class="sr-status" :style="{ color: stageStatusColor(record.status) }">{{ stageStatusIcon(record.status) }}</span>
    <span class="sr-label"><slot name="label" /></span>
    <span
      class="sr-dur"
      :class="{ carried }"
      :title="carried ? 'Carried over from a previous run — not re-run' : ''"
    >{{ carried ? 'carried' : liveStageDuration(record, now) }}</span>
    <span v-if="record.success_criteria" class="sr-crit" :class="critClass" :title="record.success_criteria">{{ critLabel }}</span>
    <span v-if="record.error" class="sr-err" :title="record.error">{{ record.error }}</span>
    <span v-if="$slots.trailing" class="sr-trailing"><slot name="trailing" /></span>
  </div>
</template>

<style scoped>
.stage-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
  gap: 8px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  border-radius: var(--radius-xs);
  transition: background 0.1s;
}
.stage-row:hover { background: var(--color-bg-tertiary); }
.stage-row.dim { opacity: 0.25; }

.sr-status { font-size: 12px; font-weight: 700; width: 16px; text-align: center; flex-shrink: 0; }
.sr-label { display: flex; align-items: center; gap: 6px; color: var(--color-text-primary); font-weight: 500; min-width: 80px; flex-shrink: 0; }
.sr-dur { color: var(--color-text-muted); font-size: 11px; min-width: 40px; flex-shrink: 0; }
.sr-dur.carried { font-style: italic; }
.sr-crit { font-size: 10px; padding: 1px 6px; border-radius: 3px; white-space: nowrap; color: var(--color-text-muted); flex-shrink: 0; }
.sr-crit.met { color: var(--color-status-running); background: rgba(91, 168, 160, 0.12); }
.sr-crit.unmet { color: var(--color-error); background: rgba(232, 88, 88, 0.12); }
.sr-err { flex: 1; min-width: 0; color: var(--color-error); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.sr-trailing { margin-left: auto; flex-shrink: 0; }
</style>
