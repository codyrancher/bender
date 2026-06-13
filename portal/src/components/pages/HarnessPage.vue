<script setup lang="ts">
// Route page for /harness/vscode (the global harness, no pipeline). Composes the
// shared workspace; kept as its own page so it can diverge.
import PipelineWorkspace from '../PipelineWorkspace.vue'
</script>

<template>
  <PipelineWorkspace />
</template>
