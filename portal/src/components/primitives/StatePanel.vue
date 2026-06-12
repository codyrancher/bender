<script setup lang="ts">
// Centered empty/loading state — optional spinner above a message (default slot).
// Drop it inside a positioned container (overlay/pane) for full-area states.
import Spinner from './Spinner.vue'
defineProps<{ spinner?: boolean }>()
</script>

<template>
  <div class="state-panel">
    <Spinner v-if="spinner" />
    <div class="state-text"><slot /></div>
  </div>
</template>

<style scoped>
.state-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--color-text-muted);
  font-size: 13px;
}
.state-text { text-align: center; }
</style>
