<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { getPipelineIdFromRoute, isHarnessRoute, isTemplateEditorRoute } from '@/router'
import TabBar from '@/components/TabBar.vue'
import Toolbar from '@/components/Toolbar.vue'
import IFrameContainer from '@/components/IFrameContainer.vue'
import SettingsPage from '@/components/SettingsPage.vue'
import Toast from '@/components/Toast.vue'
import DropOverlay from '@/components/DropOverlay.vue'
import NewPipelineModal from '@/components/NewPipelineModal.vue'
import DeletePipelineModal from '@/components/DeletePipelineModal.vue'
import InsightsPage from '@/components/InsightsPage.vue'
import TerminalDrawer from '@/components/TerminalDrawer.vue'
import TemplateEditorToolbar from '@/components/TemplateEditorToolbar.vue'
import PipelinesPage from '@/components/PipelinesPage.vue'
import DefinitionsBrowser from '@/components/DefinitionsBrowser.vue'

const route = useRoute()
const router = useRouter()
const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const isHome = computed(() => route.name === 'home')
const isSettings = computed(() => route.name === 'settings')
const isTemplateEditor = computed(() => isTemplateEditorRoute(route))
const isInsights = computed(() => route.name === 'insights')
const isDefinitions = computed(() => route.name === 'definitions')

watch(
  () => getPipelineIdFromRoute(route),
  async (pipelineId) => {
    if (pipelineId) {
      await pipelinesStore.loadPipeline(pipelineId)
    }
  }
)

onMounted(async () => {
  await pipelinesStore.fetchPipelines()
  pipelinesStore.connectEvents()
  pipelinesStore.fetchPortForwards()

  const pipelineId = getPipelineIdFromRoute(route)

  if (isHarnessRoute(route)) {
    uiStore.hideLoading()
  } else if (pipelineId) {
    await pipelinesStore.loadPipeline(pipelineId)
  } else if (route.name === 'settings' || route.name === 'template-editor' || route.name === 'insights' || route.name === 'definitions') {
    uiStore.hideLoading()
  } else {
    uiStore.hideLoading()
  }
})
</script>

<template>
  <div class="main-content">
    <PipelinesPage v-if="isHome" />
    <div v-show="!isHome && !isSettings && !isInsights && !isDefinitions" class="iframe-pane">
      <TemplateEditorToolbar v-if="isTemplateEditor" />
      <Toolbar v-else />
      <IFrameContainer />
    </div>
    <SettingsPage v-if="isSettings" />
    <InsightsPage v-if="isInsights" />
    <DefinitionsBrowser v-if="isDefinitions" @close="router.push('/')" />
  </div>
  <TerminalDrawer />
  <TabBar />
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

.iframe-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
