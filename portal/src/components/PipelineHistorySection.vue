<script setup lang="ts">
// Commit history for a pipeline definition, with a diff viewer opened per commit.
import { ref, computed } from 'vue'
import { api } from '@/services/api'
import DiffViewer from './primitives/DiffViewer.vue'

const props = defineProps<{
  history: Array<{ sha: string; author: string; date: string; message: string }>
  definitionId: string
}>()

const diffOpen = ref(false)
const diffInitial = ref(0)

const diffCommits = computed(() =>
  props.history.map(c => ({
    name: c.sha.slice(0, 7),
    message: c.message,
    url: api.definitionCommitUrl(props.definitionId, c.sha),
  })),
)

function openDiffAt(index: number) {
  diffInitial.value = index
  diffOpen.value = true
}

function shortDate(iso: string): string {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
</script>

<template>
  <div class="defs-section">
    <div class="defs-section-title">History</div>
    <div class="defs-history">
      <button
        v-for="(c, i) in history"
        :key="c.sha"
        class="defs-commit"
        @click="openDiffAt(i)"
      >
        <span class="defs-commit-sha">{{ c.sha.slice(0, 7) }}</span>
        <span class="defs-commit-msg">{{ c.message }}</span>
        <span class="defs-commit-date">{{ shortDate(c.date) }}</span>
      </button>
      <div v-if="!history.length" class="defs-empty">No commits</div>
    </div>
  </div>

  <DiffViewer
    v-if="diffOpen && diffCommits.length"
    :commits="diffCommits"
    :initial-index="diffInitial"
    @close="diffOpen = false"
  />
</template>

<style scoped>
.defs-section { margin-bottom: 22px; }

.defs-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.defs-history { display: flex; flex-direction: column; gap: 4px; }

.defs-commit {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.15s;
}

.defs-commit:hover { border-color: var(--color-accent); }

.defs-commit-sha {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-accent);
  font-weight: 600;
  flex-shrink: 0;
}

.defs-commit-msg {
  font-size: 12px;
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.defs-commit-date { font-size: 11px; color: var(--color-text-muted); flex-shrink: 0; }

.defs-empty { font-size: 12px; color: var(--color-text-muted); }
</style>
