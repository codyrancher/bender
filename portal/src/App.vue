<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import TabBar from '@/components/TabBar.vue'
import Toast from '@/components/Toast.vue'
import DeletePipelineModal from '@/components/DeletePipelineModal.vue'
import ClaudeCliPage from '@/components/ClaudeCliPage.vue'

const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()
const route = useRoute()
// Standalone "bare" pages (e.g. the schema doc) render without the app chrome.

// Ctrl+` toggles the terminal drawer. Capture phase so it fires even when the
// xterm textarea has focus.
function onKeydown(e: KeyboardEvent) {
  if (e.key === '`' && e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    e.stopPropagation()
    uiStore.toggleTerminal()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown, true)
  await pipelinesStore.fetchPipelines()
  pipelinesStore.connectEvents()
  uiStore.hideLoading()
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="main-content">
    <router-view />
  </div>
  <ClaudeCliPage v-if="!route.meta.bare" />
  <TabBar v-if="!route.meta.bare" />
  <Toast />
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
  overflow: hidden;
}
</style>
