<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '@/services/api'
import Tabs from './primitives/Tabs.vue'

const tables = ref<string[]>([])
const selectedTable = ref<string | null>(null)
const columns = ref<Array<{ name: string; type: string; notnull: number; pk: number }>>([])
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const page = ref(0)
const pageSize = 50

const queryText = ref('')
const queryResult = ref<{ rows?: Record<string, unknown>[]; columns?: string[]; changes?: number; error?: string } | null>(null)
const queryError = ref('')

// Bulk selection
const selectedRowIds = ref<Set<number>>(new Set())
const deleting = ref(false)

const allSelected = computed(() => {
  if (!rows.value.length) return false
  return rows.value.every(r => selectedRowIds.value.has(r.__rowid as number))
})

function toggleAll() {
  if (allSelected.value) {
    selectedRowIds.value.clear()
  } else {
    for (const r of rows.value) {
      selectedRowIds.value.add(r.__rowid as number)
    }
  }
}

function toggleRow(rowid: number) {
  if (selectedRowIds.value.has(rowid)) {
    selectedRowIds.value.delete(rowid)
  } else {
    selectedRowIds.value.add(rowid)
  }
}

async function deleteSelected() {
  if (!selectedTable.value || !selectedRowIds.value.size) return
  deleting.value = true
  try {
    await api.deleteTableRows(selectedTable.value, [...selectedRowIds.value])
    selectedRowIds.value.clear()
    await loadTable(selectedTable.value)
  } catch {}
  deleting.value = false
}

// Table browser
async function loadTables() {
  try {
    const result = await api.getInsightsTables()
    tables.value = result.tables
    if (result.tables.length && !selectedTable.value) {
      selectedTable.value = result.tables[0]
    }
  } catch {}
}

async function loadTable(table: string) {
  try {
    const [schema, data] = await Promise.all([
      api.getTableSchema(table),
      api.getTableRows(table, pageSize, page.value * pageSize),
    ])
    columns.value = schema.columns
    rows.value = data.rows
    total.value = data.total
  } catch {}
}

async function runQuery() {
  queryError.value = ''
  queryResult.value = null
  if (!queryText.value.trim()) return
  try {
    const result = await api.runInsightsQuery(queryText.value)
    queryResult.value = result
    loadTables()
  } catch (err: any) {
    queryError.value = err.message || 'Query failed'
  }
}

watch(selectedTable, (table) => {
  if (table) {
    page.value = 0
    selectedRowIds.value.clear()
    loadTable(table)
  }
})

watch(page, () => {
  selectedRowIds.value.clear()
  if (selectedTable.value) loadTable(selectedTable.value)
})

onMounted(() => {
  loadTables()
})
</script>

<template>
  <div class="insights-panel">
      <div class="top-half">
      <!-- SQL Query -->
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

      <!-- Table Browser -->
      <div class="table-section">
        <Tabs
          class="table-tabs"
          variant="pills"
          :model-value="selectedTable ?? ''"
          :tabs="tables.map(t => ({ key: t, label: t }))"
          @update:model-value="selectedTable = $event"
        />

        <div v-if="selectedTable && columns.length" class="table-view">
          <div class="table-info">
            {{ total }} rows
            <span v-if="total > pageSize">
              &middot; Page {{ page + 1 }} of {{ Math.ceil(total / pageSize) }}
              <button class="page-btn" :disabled="page === 0" @click="page--">&larr;</button>
              <button class="page-btn" :disabled="(page + 1) * pageSize >= total" @click="page++">&rarr;</button>
            </span>
            <button
              v-if="selectedRowIds.size"
              class="delete-btn"
              :disabled="deleting"
              @click="deleteSelected"
            >
              Delete {{ selectedRowIds.size }} row{{ selectedRowIds.size > 1 ? 's' : '' }}
            </button>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="checkbox-col">
                    <input type="checkbox" :checked="allSelected" @change="toggleAll" />
                  </th>
                  <th v-for="col in columns" :key="col.name">
                    {{ col.name }}
                    <span class="col-type">{{ col.type }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, i) in rows"
                  :key="i"
                  :class="{ 'row-selected': selectedRowIds.has(row.__rowid as number) }"
                >
                  <td class="checkbox-col">
                    <input
                      type="checkbox"
                      :checked="selectedRowIds.has(row.__rowid as number)"
                      @change="toggleRow(row.__rowid as number)"
                    />
                  </td>
                  <td v-for="col in columns" :key="col.name">{{ row[col.name] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!rows.length" class="empty-state">No data</div>
        </div>
        <div v-else-if="!tables.length" class="empty-state">No tables yet. Data will appear as projects report insights.</div>
      </div>

      </div>
  </div>
</template>

<style scoped>
.insights-panel {
  display: flex;
  flex-direction: column;
}

.top-half {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

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

.table-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.table-tabs {
  display: flex;
  flex-shrink: 0;
  margin-bottom: var(--spacing-sm);
}

.table-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-info {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: var(--spacing-sm);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.page-btn {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
  border: none;
  border-radius: var(--radius-xs);
  padding: 1px 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.delete-btn {
  background: #c53030;
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: 2px 10px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: inherit;
  font-weight: 500;
  margin-left: auto;
}

.delete-btn:hover {
  background: #e53e3e;
}

.delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.table-scroll {
  max-height: 420px;
  overflow: auto;
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

.col-type {
  font-weight: 400;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  opacity: 0.6;
  margin-left: var(--spacing-xs);
}

.data-table td {
  color: var(--color-text-primary);
  font-family: monospace;
}

.data-table tbody tr:hover {
  background: var(--color-bg-element);
}

.data-table tbody tr.row-selected {
  background: rgba(66, 153, 225, 0.08);
}

.checkbox-col {
  width: 32px;
  min-width: 32px;
  max-width: 32px;
  text-align: center !important;
  padding: var(--spacing-xs) var(--spacing-xs) !important;
}

.checkbox-col input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--color-accent);
}

.empty-state {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  padding: var(--spacing-xl);
  text-align: center;
}

</style>
