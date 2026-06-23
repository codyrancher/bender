<script setup lang="ts">
import InsightsPanel from '../components/InsightsPanel.vue'
</script>

<template>
  <div class="settings-page">
    <div class="settings-content">
      <h1>Settings</h1>
      <p class="description">No configurable settings yet.</p>
    </div>

    <div class="insights-wrap">
      <h2 class="insights-title">Insights</h2>
      <InsightsPanel />
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  flex: 1;
  overflow-y: auto;
  background: var(--color-bg-primary);
  /* Shared column width — Settings + Insights line up in one centered column. */
  --content-width: 1000px;
}

.settings-content {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: var(--spacing-xl) var(--spacing-lg);
}

h1 {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-md);
}

.description {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.insights-wrap {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: var(--spacing-xl) var(--spacing-lg) var(--spacing-xxl);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
}

.insights-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin-bottom: var(--spacing-lg);
}
</style>
