<script setup lang="ts">
// A card inside a history drawer: a header row (filled via the `head` slot,
// optionally clickable) plus freeform body content (default slot). Used for run
// records (run history) and the runs list / skill-version entries (stage history)
// so both drawers share one card look.
defineProps<{ clickable?: boolean }>()
const emit = defineEmits<{ (e: 'head-click'): void }>()
</script>

<template>
  <div class="history-card">
    <div
      v-if="$slots.head"
      class="history-card-head"
      :class="{ clickable }"
      @click="clickable && emit('head-click')"
    >
      <slot name="head" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.history-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  margin-bottom: 8px;
  overflow: hidden;
}
.history-card:last-child { margin-bottom: 0; }

.history-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
}
.history-card-head.clickable { cursor: pointer; }
.history-card-head.clickable:hover { background: var(--color-bg-element); }
</style>
