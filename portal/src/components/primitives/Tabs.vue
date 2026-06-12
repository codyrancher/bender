<script setup lang="ts">
// Reusable tab strip. Two visual variants:
//   segmented - a joined pill group (best for a small fixed set of views)
//   pills     - separate bordered chips that wrap (best for a dynamic list)
// Use with v-model bound to the active tab's `key`.
interface TabItem {
  key: string
  label: string
  dirty?: boolean
}

withDefaults(
  defineProps<{
    modelValue: string
    tabs: TabItem[]
    variant?: 'segmented' | 'pills'
  }>(),
  { variant: 'segmented' },
)

defineEmits<{ (e: 'update:modelValue', key: string): void }>()
</script>

<template>
  <div class="tabs-root" :class="variant">
    <button
      v-for="t in tabs"
      :key="t.key"
      type="button"
      class="tabs-btn"
      :class="{ active: modelValue === t.key }"
      @click="$emit('update:modelValue', t.key)"
    >
      {{ t.label }}<span v-if="t.dirty" class="tabs-dot">●</span>
    </button>
  </div>
</template>

<style scoped>
.tabs-root {
  display: inline-flex;
}

.tabs-btn {
  font-family: inherit;
  text-transform: none;
  letter-spacing: normal;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.tabs-dot {
  margin-left: 6px;
  font-size: 10px;
  color: var(--color-warning);
}

/* segmented: joined pill group */
.tabs-root.segmented {
  border: 1px solid var(--color-border-medium);
  border-radius: 7px;
  overflow: hidden;
}

.segmented .tabs-btn {
  padding: 6px 16px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.segmented .tabs-btn + .tabs-btn {
  border-left: 1px solid var(--color-border-medium);
}

.segmented .tabs-btn:hover {
  color: var(--color-text-primary);
}

.segmented .tabs-btn.active {
  background: var(--color-accent);
  color: var(--color-text-bright);
}

.segmented .tabs-btn.active .tabs-dot {
  color: var(--color-text-bright);
}

/* pills: separate bordered chips that wrap */
.tabs-root.pills {
  flex-wrap: wrap;
  gap: var(--spacing-xs, 6px);
}

.pills .tabs-btn {
  padding: 6px 12px;
  background: var(--color-bg-element);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-dark);
  border-radius: var(--radius-sm, 5px);
  font-size: 12px;
}

.pills .tabs-btn:hover {
  color: var(--color-text-hover);
}

.pills .tabs-btn.active {
  background: var(--color-bg-primary);
  color: var(--color-accent);
  border-color: var(--color-accent);
}
</style>
