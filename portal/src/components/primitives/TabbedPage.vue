<script setup lang="ts">
// Page-level shell: a title with folder-style tabs beside it, above an inset
// content panel that the active tab visually connects into (the active tab
// shares the panel's surface and overlaps its top border, so the content reads
// as "part of" the tab). v-model binds the active tab's `key`.
//
//   <TabbedPage v-model="tab" title="Definitions" :tabs="[…]">
//     <template #actions> <Button/> </template>   <!-- optional, header right -->
//     <MyPanelA v-show="tab === 'a'" />
//     <MyPanelB v-if="tab === 'b'" />
//   </TabbedPage>
//
// The default slot is rendered inside the panel and receives { active } so a
// consumer can switch on it inline. Panel children that are `flex:1` fill it.
// The folder-tab strip is the shared FolderTabs primitive (also used by in-page
// editors) so tabs look the same everywhere.
import FolderTabs from './FolderTabs.vue'

interface TabItem {
  key: string
  label: string
  dirty?: boolean
}

defineProps<{
  modelValue: string
  tabs: TabItem[]
  title?: string
}>()

defineEmits<{ (e: 'update:modelValue', key: string): void }>()
</script>

<template>
  <div class="tabbed-page">
    <header class="tp-header">
      <h1 v-if="title" class="tp-title">{{ title }}</h1>

      <FolderTabs
        :model-value="modelValue"
        :tabs="tabs"
        @update:model-value="$emit('update:modelValue', $event)"
      />

      <div class="tp-actions"><slot name="actions" /></div>
    </header>

    <section class="tp-panel">
      <slot :active="modelValue" />
    </section>
  </div>
</template>

<style scoped>
.tabbed-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-primary);
}

/* Title + tabs share a row, bottom-aligned so the folder tabs sit on the
   panel's top edge. Bottom padding is 0 so the active tab can meet the panel. */
.tp-header {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-xl);
  padding: var(--spacing-lg) var(--spacing-xxl) 0;
  flex-shrink: 0;
}

.tp-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  /* nudge the baseline up so it bottom-aligns with the tab labels */
  padding-bottom: 7px;
}

.tp-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding-bottom: 4px;
}

/* The inset content surface. Children that are flex:1 fill it; overflow is
   clipped to the rounded corners so panel content stays inside the card. */
.tp-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 0 var(--spacing-xxl) var(--spacing-xxl);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-medium);
  border-radius: 0 var(--radius-lg) var(--radius-lg) var(--radius-lg);
  overflow: hidden;
}
</style>
