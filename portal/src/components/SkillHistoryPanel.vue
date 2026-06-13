<script setup lang="ts">
// Commit history for a skill definition, with a diff viewer opened per commit.
import { ref, computed } from 'vue'
import { api } from '@/services/api'
import DiffViewer from './primitives/DiffViewer.vue'

const props = defineProps<{
  history: Array<{ sha: string; author: string; date: string; message: string }>
  skillId: string
}>()

const diffOpen = ref(false)
const diffInitial = ref(0)

const diffCommits = computed(() =>
  props.history.map((c) => ({
    name: c.sha.slice(0, 7),
    message: c.message,
    url: api.skillDefinitionCommitUrl(props.skillId, c.sha),
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
  <div class="skills-section">
    <div class="skills-section-title">History</div>
    <div class="skills-history">
      <button
        v-for="(c, i) in history"
        :key="c.sha"
        class="skills-commit"
        @click="openDiffAt(i)"
      >
        <span class="skills-commit-sha">{{ c.sha.slice(0, 7) }}</span>
        <span class="skills-commit-msg">{{ c.message }}</span>
        <span class="skills-commit-date">{{ shortDate(c.date) }}</span>
      </button>
      <div v-if="!history.length" class="skills-empty">No commits</div>
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
.skills-section { margin-top: 24px; }
.skills-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.skills-history { display: flex; flex-direction: column; gap: 4px; }
.skills-commit {
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
.skills-commit:hover { border-color: var(--color-accent); }
.skills-commit-sha {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-accent);
  font-weight: 600;
  flex-shrink: 0;
}
.skills-commit-msg {
  font-size: 12px;
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.skills-commit-date { font-size: 11px; color: var(--color-text-muted); flex-shrink: 0; }

.skills-empty {
  margin: auto;
  color: var(--color-text-muted);
  font-size: 12px;
}
</style>
