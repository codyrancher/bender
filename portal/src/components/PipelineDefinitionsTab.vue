<script setup lang="ts">
// The "Pipelines" tab of the definitions browser: the sidebar list, the selected
// definition's detail (editor + history), and the import flow. Owns which
// definition is selected (the :id slice of the URL) and the load/create/delete.
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import StatePanel from './primitives/StatePanel.vue'
import PipelineDefinitionsList from './PipelineDefinitionsList.vue'
import PipelineDefinitionEditor from './PipelineDefinitionEditor.vue'
import PipelineHistorySection from './PipelineHistorySection.vue'
import PipelineImportModal from './PipelineImportModal.vue'

interface DefDetail { id: string; name: string; content: string; stages: any[]; skills: Array<{ name: string; content: string }>; claudeMd: string }

const route = useRoute()
const router = useRouter()

const definitions = ref<Array<{ id: string; name: string; stages: any[]; skills: string[] }>>([])
const selectedId = ref<string | null>(null)
const detail = ref<DefDetail | null>(null)
const history = ref<Array<{ sha: string; author: string; date: string; message: string }>>([])
const loading = ref(false)
const creating = ref(false)
const showImport = ref(false)

onMounted(load)

async function load() {
  try {
    const data = await api.getDefinitions()
    definitions.value = data.definitions
    if (definitions.value.length && !selectedId.value) select(definitions.value[0].id)
  } catch {}
}

async function select(id: string) {
  selectedId.value = id
  loading.value = true
  try {
    const [d, h] = await Promise.all([api.getDefinition(id), api.getDefinitionHistory(id)])
    detail.value = d
    history.value = h.commits
  } catch {
    detail.value = null
    history.value = []
  } finally {
    loading.value = false
  }
}

// route → selected definition (keeps refresh/back on the same definition)
watch(() => route.params.id, (id) => {
  if (route.params.tab === 'skills') return
  const rid = id as string
  if (rid && rid !== selectedId.value) select(rid)
}, { immediate: true })

async function createDefinition(id: string) {
  creating.value = true
  try {
    await api.createDefinition(id)
    await load()
    router.push('/definitions/pipelines/' + id)
  } catch {
  } finally {
    creating.value = false
  }
}

async function removeDefinition(id: string) {
  try {
    await api.deleteDefinition(id)
    if (selectedId.value === id) { selectedId.value = null; detail.value = null; history.value = [] }
    await load()
  } catch {}
}

// A save committed new content — reload the definition's detail/history and the list.
async function onSaved() {
  if (!detail.value) return
  await select(detail.value.id)
  await load()
}

async function onImported(id: string) {
  await load()
  router.push('/definitions/pipelines/' + id)
}
</script>

<template>
  <div class="defs">
    <PipelineDefinitionsList
      :definitions="definitions"
      :selected-id="selectedId"
      :creating="creating"
      @select="router.push('/definitions/pipelines/' + $event)"
      @create="createDefinition"
      @import="showImport = true"
    />

    <div class="defs-detail">
      <StatePanel v-if="loading" spinner>Loading…</StatePanel>
      <template v-else-if="detail">
        <div class="defs-detail-head">
          <div>
            <h2>{{ detail.name }}</h2>
            <span class="defs-id">{{ detail.id }}</span>
          </div>
          <button class="defs-del" title="Delete definition" @click="removeDefinition(detail.id)">Delete</button>
        </div>

        <PipelineDefinitionEditor :detail="detail" @saved="onSaved" />
        <PipelineHistorySection :history="history" :definition-id="detail.id" />
      </template>
      <StatePanel v-else>Select a definition</StatePanel>
    </div>
  </div>

  <PipelineImportModal v-model:open="showImport" @imported="onImported" />
</template>

<style scoped>
.defs {
  flex: 1;
  display: flex;
  min-height: 0;
}

.defs-detail {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.defs-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}

.defs-detail-head h2 {
  margin: 0;
  font-size: 18px;
  color: var(--color-text-primary);
}

.defs-id {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--color-text-muted);
}

.defs-del {
  padding: 5px 12px;
  border: 1px solid var(--color-border-medium);
  background: transparent;
  color: var(--color-text-muted);
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.defs-del:hover { color: var(--color-error); border-color: var(--color-error); }
</style>
