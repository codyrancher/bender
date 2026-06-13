<script setup lang="ts">
// Route page for /:pipelineId/browser. Composes the shared workspace; kept as its
// own page so it can diverge from the other view modes.
import PipelineWorkspace from '../PipelineWorkspace.vue'
</script>

<template>
  <PipelineWorkspace />
</template>
