<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { usePipelineId } from '@/composables/route'
import TabBar from '@/components/TabBar.vue'
import Toast from '@/components/Toast.vue'
import DropOverlay from '@/components/DropOverlay.vue'
import NewPipelineModal from '@/components/NewPipelineModal.vue'
import DeletePipelineModal from '@/components/DeletePipelineModal.vue'
import ClaudeCliPage from '@/components/ClaudeCliPage.vue'

const pipelineId = usePipelineId()
const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()
const route = useRoute()
// Standalone "bare" pages (e.g. the schema doc) render without the app chrome.

watch(pipelineId, async (id) => {
  if (id) {
    await pipelinesStore.loadPipeline(id)
  }
})

onMounted(async () => {
  await pipelinesStore.fetchPipelines()
  pipelinesStore.connectEvents()
  pipelinesStore.fetchPortForwards()

  // The pipeline routes load their pipeline (which clears the loading overlay);
  // every other route has nothing to load, so drop the overlay immediately.
  if (pipelineId.value) {
    await pipelinesStore.loadPipeline(pipelineId.value)
  } else {
    uiStore.hideLoading()
  }
})
</script>

<template>
  <div class="main-content">
    <router-view />
  </div>
  <ClaudeCliPage v-if="!route.meta.bare" />
  <TabBar v-if="!route.meta.bare" />
  <Toast />
  <DropOverlay />
  <NewPipelineModal />
  <DeletePipelineModal />
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Cohesive, app-wide scrollbars. Firefox uses scrollbar-color/width; Chromium
   (what the app runs in) uses the ::-webkit-scrollbar pseudo-elements. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-medium) transparent;
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background: var(--color-border-medium);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
  background-clip: padding-box;
}

*::-webkit-scrollbar-corner {
  background: transparent;
}

html, body {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-family);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

#app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>

<style scoped>
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
</style>
