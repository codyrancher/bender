<script setup lang="ts">
// Definitions browser shell: switches between the Skills and Pipelines tabs and
// keeps the active tab in the URL (/definitions/:tab). Each tab is its own
// self-contained component.
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Tabs from '../components/primitives/Tabs.vue'
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
  <div class="defs-page">
    <div class="page-header">
      <h1>Definitions</h1>
      <Tabs
        v-model="activeTab"
        :tabs="[{ key: 'pipelines', label: 'Pipelines' }, { key: 'skills', label: 'Skills' }]"
      />
    </div>

    <SkillDefinitionsPanel v-if="activeTab === 'skills'" />
    <PipelineDefinitionsTab v-show="activeTab === 'pipelines'" />
  </div>
</template>

<style scoped>
.defs-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-primary);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}

.page-header h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
</style>
