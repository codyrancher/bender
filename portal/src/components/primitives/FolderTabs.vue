<script setup lang="ts">
// Folder-style tab strip: rounded tabs whose active item merges into the surface
// directly below it (a -1px overlap hides that surface's top border, so the
// content reads as "part of" the tab). Shared by the page shell (TabbedPage) and
// in-page editors so tabs look identical everywhere. v-model binds the active
// key. The connected surface color is themeable via the --folder-tab-surface
// custom property (defaults to the raised panel color) so it can sit on the page
// panel or on a darker editor surface.
interface TabItem {
  key: string
  label: string
  dirty?: boolean
}

defineProps<{ modelValue: string; tabs: TabItem[] }>()
defineEmits<{ (e: 'update:modelValue', key: string): void }>()
</script>

<template>
  <div class="folder-tabs" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.key"
      type="button"
      role="tab"
      class="folder-tab"
      :class="{ active: modelValue === t.key }"
      :aria-selected="modelValue === t.key"
      @click="$emit('update:modelValue', t.key)"
    >
      {{ t.label }}<span v-if="t.dirty" class="folder-tab-dot">●</span>
    </button>
  </div>
</template>

<style scoped>
.folder-tabs {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-xs);
}

.folder-tab {
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 8px 18px;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.folder-tab:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-tertiary);
}

/* Active tab merges into the surface below: matching fill, top/side borders,
   and a 1px overlap that hides that surface's top border beneath it. */
.folder-tab.active {
  color: var(--color-text-primary);
  background: var(--folder-tab-surface, var(--color-bg-secondary));
  border-color: var(--color-border-medium);
  margin-bottom: -1px;
  padding-bottom: 9px;
}

.folder-tab-dot {
  margin-left: 6px;
  font-size: 10px;
  color: var(--color-warning);
}
</style>
