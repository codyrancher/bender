<script setup lang="ts">
// External port-range editor + allocations table. These share the range/usage
// stats, so they live together. Parent owns the fetched data and passes it in;
// this emits `changed` after a save/remove so the parent can re-fetch.
import { ref, computed } from 'vue'
import { api } from '@/services/api'
import { useUiStore } from '@/stores/ui'
import type { PortRange, PortAllocation } from '@/types'
import CloseIcon from '@/assets/icons/close.svg?component'

const props = defineProps<{
  portRange: PortRange
  allocations: PortAllocation[]
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const uiStore = useUiStore()

const editStart = ref(props.portRange.start)
const editEnd = ref(props.portRange.end)
const isEditing = ref(false)

const totalPorts = computed(() => props.portRange.end - props.portRange.start + 1)
const usedPorts = computed(() => props.allocations.length)
const availablePorts = computed(() => totalPorts.value - usedPorts.value)

function startEditing() {
  editStart.value = props.portRange.start
  editEnd.value = props.portRange.end
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
}

async function savePortRange() {
  try {
    await api.updatePortRange({ start: editStart.value, end: editEnd.value })
    isEditing.value = false
    uiStore.showToast('Port range updated')
    emit('changed')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update'
    uiStore.showToast(message, 'error')
  }
}

async function removeMapping(pipeline: string, service: string) {
  try {
    await api.removePortMapping(pipeline, service)
    uiStore.showToast('Port mapping removed')
    emit('changed')
  } catch (err) {
    uiStore.showToast('Failed to remove mapping', 'error')
  }
}
</script>

<template>
  <div>
    <section class="section">
      <h2>External Port Range</h2>
      <p class="description">
        Ports available to expose pipeline services publicly.
      </p>

      <div v-if="!isEditing" class="port-range-display">
        <div class="range-info">
          <span class="range-value">{{ portRange.start }} - {{ portRange.end }}</span>
          <span class="range-meta">{{ totalPorts }} ports total, {{ usedPorts }} used, {{ availablePorts }} available</span>
        </div>
        <button class="btn btn-secondary" @click="startEditing">Edit</button>
      </div>

      <div v-else class="port-range-edit">
        <div class="input-row">
          <label>
            Start
            <input v-model.number="editStart" type="number" min="1024" max="65535" />
          </label>
          <span class="range-dash">-</span>
          <label>
            End
            <input v-model.number="editEnd" type="number" min="1024" max="65535" />
          </label>
        </div>
        <div class="edit-actions">
          <button class="btn btn-primary" @click="savePortRange">Save</button>
          <button class="btn btn-secondary" @click="cancelEditing">Cancel</button>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Port Allocations</h2>

      <div v-if="allocations.length === 0" class="empty-state">
        No ports are currently allocated.
      </div>

      <table v-else class="allocations-table">
        <thead>
          <tr>
            <th>Port</th>
            <th>Project</th>
            <th>Service</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alloc in allocations" :key="`${alloc.pipeline}-${alloc.service}`">
            <td class="port-cell">{{ alloc.port }}</td>
            <td>{{ alloc.pipeline }}</td>
            <td>{{ alloc.service }}</td>
            <td class="action-cell">
              <button class="btn-icon" title="Remove mapping" @click="removeMapping(alloc.pipeline, alloc.service)">
                <CloseIcon />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.section {
  margin-bottom: var(--spacing-xl);
}

h2 {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-xs);
}

.description {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}

.port-range-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-bg-element);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
}

.range-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.range-value {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.range-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.port-range-edit {
  background: var(--color-bg-element);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.input-row label {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.input-row input {
  width: 120px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}

.input-row input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.range-dash {
  color: var(--color-text-muted);
  padding-bottom: var(--spacing-sm);
}

.edit-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-family: inherit;
  font-weight: 500;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-bg-primary);
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--color-bg-element-hover);
  color: var(--color-text-primary);
}

.btn-secondary:hover {
  background: var(--color-border-dark);
}

.empty-state {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  padding: var(--spacing-lg);
  text-align: center;
  background: var(--color-bg-element);
  border-radius: var(--radius-md);
}

.allocations-table {
  width: 100%;
  border-collapse: collapse;
}

.allocations-table th {
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
}

.allocations-table td {
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  border-bottom: var(--border-width-sm) solid var(--color-bg-element);
}

.port-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.action-cell {
  width: 40px;
  text-align: right;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-muted);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.btn-icon:hover {
  color: var(--color-warning);
  background: var(--color-bg-element);
}

.btn-icon svg {
  width: 14px;
  height: 14px;
}
</style>
