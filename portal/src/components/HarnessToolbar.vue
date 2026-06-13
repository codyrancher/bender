<script setup lang="ts">
// The toolbar shown for the harness dev environment: a single "Harness Dev" tab
// and its lifecycle actions (start / rebuild / promote / abandon). Fully
// store-driven — no props.
import { computed } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import SpinnerIcon from '@/assets/icons/spinner.svg?component'

const pipelinesStore = usePipelinesStore()

const devRunning = computed(() => pipelinesStore.harnessStatus.devRunning)
const operationActive = computed(() => pipelinesStore.harnessOperationActive)

async function start() {
  await pipelinesStore.harnessAction('start')
}

async function rebuild() {
  await pipelinesStore.harnessAction('rebuild')
}

async function promote() {
  if (!confirm('Promote dev changes to production? This will rebuild the production API and portal, then remove the dev environment.')) return
  await pipelinesStore.harnessAction('promote')
}

async function abandon() {
  if (!confirm('Abandon dev environment? All uncommitted changes will be lost.')) return
  await pipelinesStore.harnessAction('abandon')
}
</script>

<template>
  <div class="tabs">
    <div class="tab-wrapper active">
      <span class="tab-label">Harness Dev</span>
    </div>
  </div>
  <div class="toolbar-buttons">
    <template v-if="!devRunning && !operationActive">
      <button class="toolbar-btn text-btn accent" @click="start">
        Start Dev
      </button>
    </template>
    <template v-else-if="operationActive">
      <button class="toolbar-btn text-btn" disabled>
        <SpinnerIcon class="spinner" />
        Working...
      </button>
    </template>
    <template v-else>
      <button class="toolbar-btn text-btn" title="Rebuild dev API from current source" @click="rebuild">
        Rebuild
      </button>
      <button class="toolbar-btn text-btn accent" title="Promote dev changes to production" @click="promote">
        Promote
      </button>
      <button class="toolbar-btn text-btn danger" title="Discard dev environment" @click="abandon">
        Abandon
      </button>
    </template>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--spacing-xs);
  height: 100%;
  align-items: flex-end;
}

.tab-wrapper {
  display: flex;
  align-items: center;
  background: var(--color-bg-element);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

.tab-wrapper.active {
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-bottom-color: var(--color-bg-primary);
  margin-bottom: calc(-1 * var(--border-width-sm));
}

.tab-label {
  color: var(--color-text-primary);
  padding: var(--spacing-sm) var(--spacing-lg);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.toolbar-buttons {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  height: 100%;
}

.toolbar-btn {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
  border: none;
  height: 28px;
  padding: 0 var(--spacing-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: inherit;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.toolbar-btn:hover {
  background: var(--color-bg-element-hover);
  color: var(--color-text-hover);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn.text-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 0 var(--spacing-lg);
  font-weight: 500;
}

.toolbar-btn.text-btn.accent {
  color: var(--color-accent);
}

.toolbar-btn.text-btn.accent:hover {
  color: var(--color-accent-hover);
}

.toolbar-btn.text-btn.danger {
  color: var(--color-warning);
}

.toolbar-btn.text-btn.danger:hover {
  color: var(--color-warning-hover);
}

.toolbar-btn .spinner {
  width: 14px;
  height: 14px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
