<script setup lang="ts">
// Ad-hoc SQL runner for the insights DB. Emits `ran` after a successful query so
// the surrounding panel can refresh anything a write may have changed (tables).
import { ref } from 'vue'
import { api } from '@/services/api'

const emit = defineEmits<{ (e: 'ran'): void }>()

const queryText = ref('')
const queryResult = ref<{ rows?: Record<string, unknown>[]; columns?: string[]; changes?: number; error?: string } | null>(null)
const queryError = ref('')

async function runQuery() {
  queryError.value = ''
  queryResult.value = null
  if (!queryText.value.trim()) return
  try {
    const result = await api.runInsightsQuery(queryText.value)
    queryResult.value = result
    emit('ran')
  } catch (err: any) {
    queryError.value = err.message || 'Query failed'
  }
}
</script>

<template>
  <div class="query-section">
    <div class="query-header">SQL Query</div>
    <div class="query-input-row">
      <textarea
        v-model="queryText"
        class="query-input"
        placeholder="SELECT * FROM missing_tools LIMIT 10"
        rows="3"
        @keydown.ctrl.enter="runQuery"
        @keydown.meta.enter="runQuery"
      />
      <button class="run-btn" @click="runQuery">Run</button>
    </div>
    <div v-if="queryError" class="query-error">{{ queryError }}</div>
    <div v-if="queryResult?.rows" class="query-results">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="col in queryResult.columns" :key="col">{{ col }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in queryResult.rows" :key="i">
            <td v-for="col in queryResult.columns" :key="col">{{ row[col] }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!queryResult.rows.length" class="empty-state">No results</div>
    </div>
    <div v-if="queryResult?.changes !== undefined" class="query-changes">
      {{ queryResult.changes }} row(s) affected
    </div>
  </div>
</template>

<style scoped>
.query-section {
  flex-shrink: 0;
}

.query-header {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: var(--spacing-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.query-input-row {
  display: flex;
  gap: var(--spacing-sm);
  align-items: flex-start;
}

.query-input {
  flex: 1;
  background: var(--color-bg-element);
  color: var(--color-text-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  font-family: monospace;
  font-size: var(--font-size-sm);
  resize: vertical;
}

.query-input::placeholder {
  color: var(--color-text-muted);
}

.run-btn {
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-lg);
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-weight: 500;
  height: fit-content;
}

.run-btn:hover {
  opacity: 0.9;
}

.query-error {
  color: var(--color-warning);
  font-size: var(--font-size-sm);
  margin-top: var(--spacing-sm);
  font-family: monospace;
}

.query-results,
.query-changes {
  margin-top: var(--spacing-sm);
  max-height: 300px;
  overflow: auto;
}

.query-changes {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.data-table th,
.data-table td {
  text-align: left;
  padding: var(--spacing-xs) var(--spacing-md);
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
  white-space: nowrap;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.data-table th {
  background: var(--color-bg-secondary);
  color: var(--color-text-muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.data-table td {
  color: var(--color-text-primary);
  font-family: monospace;
}

.data-table tbody tr:hover {
  background: var(--color-bg-element);
}

.empty-state {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  padding: var(--spacing-xl);
  text-align: center;
}
</style>
