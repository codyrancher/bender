<script setup lang="ts">
import { ref } from 'vue'

const loading = ref(false)
const configured = ref(false)

function openInNewTab() {
  // Future: open emulator URL in new tab
}
</script>

<template>
  <div class="android-page">
    <div class="toolbar">
      <div class="tabs">
        <div class="tab-wrapper active">
          <span class="tab-label">Android</span>
          <button class="tab-external" title="Open in new tab" @click="openInNewTab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">Connecting to emulator...</div>
    <div v-else-if="!configured" class="loading">Android emulator not yet configured</div>
  </div>
</template>

<style scoped>
.android-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  height: var(--size-header-height);
  padding: 0 var(--spacing-md) 0 0;
  background: var(--color-bg-secondary);
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
  flex-shrink: 0;
}

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
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-lg);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.tab-external {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: var(--spacing-xs);
  margin-right: var(--spacing-xs);
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-muted);
  opacity: 0.5;
  transition: opacity var(--transition-fast), color var(--transition-fast);
}

.tab-external svg {
  width: 12px;
  height: 12px;
}

.tab-wrapper:hover .tab-external {
  opacity: 0.8;
}

.tab-external:hover {
  opacity: 1;
  color: var(--color-text-primary);
}

.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
