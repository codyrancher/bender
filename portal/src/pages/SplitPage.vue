<script setup lang="ts">
// Route page for /:pipelineId/split. Composes the shared workspace; kept as its
// own page so it can diverge from the other view modes.
import PipelineWorkspace from '../components/PipelineWorkspace.vue'
</script>

<template>
  <PipelineWorkspace />
</template>
