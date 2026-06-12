<script setup lang="ts">
// Indeterminate loading spinner. Inherits color via currentColor; size overridable.
defineProps<{ size?: number }>()
</script>

<template>
  <svg
    class="spinner"
    :style="size ? { width: size + 'px', height: size + 'px' } : undefined"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" />
  </svg>
</template>

<style scoped>
.spinner {
  width: 48px;
  height: 48px;
  color: var(--color-accent);
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
