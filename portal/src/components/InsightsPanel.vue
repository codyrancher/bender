<script setup lang="ts">
// Insights DB panel: an ad-hoc SQL editor over a browsable/editable table view.
// Running a query may change the schema, so refresh the table list afterward.
import { ref } from 'vue'
import QueryEditor from './QueryEditor.vue'
import TableBrowser from './TableBrowser.vue'

const tableBrowser = ref<InstanceType<typeof TableBrowser> | null>(null)
</script>

<template>
  <div class="insights-panel">
    <div class="top-half">
      <QueryEditor @ran="tableBrowser?.refresh()" />
      <TableBrowser ref="tableBrowser" />
    </div>
  </div>
</template>

<style scoped>
.insights-panel {
  display: flex;
  flex-direction: column;
}

.top-half {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}
</style>
