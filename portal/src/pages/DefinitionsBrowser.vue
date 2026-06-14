<script setup lang="ts">
// Definitions browser shell: switches between the Skills and Pipelines tabs and
// keeps the active tab in the URL (/definitions/:tab). Each tab is its own
// self-contained component.
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TabbedPage from '../components/primitives/TabbedPage.vue'
import SkillDefinitionsPanel from '../components/SkillDefinitionsPanel.vue'
import PipelineDefinitionsTab from '../components/PipelineDefinitionsTab.vue'

const route = useRoute()
const router = useRouter()

// The active tab lives in the URL (/definitions/:tab) so a refresh stays put.
const activeTab = ref<string>((route.params.tab as string) || 'pipelines')

watch(() => route.params.tab, (t) => {
  const tab = (t as string) || 'pipelines'
  if (tab !== activeTab.value) activeTab.value = tab
})

watch(activeTab, (tab) => {
  const cur = (route.params.tab as string) || 'pipelines'
  if (tab === cur) return
  router.push(tab === 'pipelines' ? '/definitions/pipelines' : '/definitions/skills')
})
</script>

<template>
  <TabbedPage
    v-model="activeTab"
    title="Definitions"
    :tabs="[{ key: 'pipelines', label: 'Pipelines' }, { key: 'skills', label: 'Skills' }]"
  >
    <!-- Wrapper divs own the show/hide: PipelineDefinitionsTab has multiple root
         nodes (a modal sibling), so v-show on the component itself is a no-op. -->
    <div v-show="activeTab === 'pipelines'" class="def-pane"><PipelineDefinitionsTab /></div>
    <div v-if="activeTab === 'skills'" class="def-pane"><SkillDefinitionsPanel /></div>
  </TabbedPage>
</template>

<style scoped>
/* Each pane fills the panel; its child (.defs/.skills) is flex:1 and takes over. */
.def-pane {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
