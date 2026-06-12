<script setup lang="ts">
// Indeterminate loading spinner. Inherits color via currentColor; size overridable.
import SpinnerSvg from '@/assets/icons/spinner.svg?component'
defineProps<{ size?: number }>()
</script>

<template>
  <SpinnerSvg
    class="spinner"
    :style="size ? { width: size + 'px', height: size + 'px' } : undefined"
  />
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
