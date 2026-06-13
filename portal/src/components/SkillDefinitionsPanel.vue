<script setup lang="ts">
// Orchestrates the skill-definitions UI: loads the skill list, owns which skill
// is selected (the :id slice of the URL), and loads its detail + history. The
// sidebar, file editor, and history are split into child components.
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import StatePanel from './primitives/StatePanel.vue'
import SkillList from './SkillList.vue'
import SkillFileEditor from './SkillFileEditor.vue'
import SkillHistoryPanel from './SkillHistoryPanel.vue'

interface SkillFile { path: string; content: string; binary: boolean }
interface SkillDetail { id: string; name: string; description: string; files: SkillFile[] }

const skills = ref<Array<{ id: string; name: string; description: string; fileCount: number }>>([])
const selectedId = ref<string | null>(null)
const detail = ref<SkillDetail | null>(null)
const history = ref<Array<{ sha: string; author: string; date: string; message: string }>>([])
const loading = ref(false)
const creating = ref(false)

const route = useRoute()
const router = useRouter()

function skillUrl(id: string): string {
  return `/definitions/skills/${id}`
}

onMounted(load)

async function load() {
  try {
    const data = await api.getSkillDefinitions()
    skills.value = data.skills
    if (skills.value.length && !selectedId.value) select(skills.value[0].id)
  } catch {}
}

async function select(id: string) {
  selectedId.value = id
  loading.value = true
  try {
    const [d, h] = await Promise.all([api.getSkillDefinition(id), api.getSkillDefinitionHistory(id)])
    detail.value = d
    history.value = h.commits
  } catch {
    detail.value = null
    history.value = []
  } finally {
    loading.value = false
  }
}

// route → selected skill (keeps refresh/back on the same skill)
watch(() => route.params.id, async (id) => {
  if (route.params.tab !== 'skills') return
  const sid = id as string
  if (sid && sid !== selectedId.value) await select(sid)
}, { immediate: true })

async function createSkill(id: string) {
  creating.value = true
  try {
    await api.createSkillDefinition(id)
    await load()
    router.push(skillUrl(id))
  } catch {
  } finally {
    creating.value = false
  }
}

async function removeSkill(id: string) {
  try {
    await api.deleteSkillDefinition(id)
    if (selectedId.value === id) { selectedId.value = null; detail.value = null; history.value = [] }
    await load()
  } catch {}
}

// A save committed new content — reload the skill's detail/history and the list.
async function onSaved() {
  if (!detail.value) return
  await select(detail.value.id)
  await load()
}
</script>

<template>
  <div class="skills">
    <SkillList
      :skills="skills"
      :selected-id="selectedId"
      :creating="creating"
      @select="router.push(skillUrl($event))"
      @create="createSkill"
    />

    <div class="skills-detail">
      <StatePanel v-if="loading" spinner>Loading…</StatePanel>
      <template v-else-if="detail">
        <div class="skills-detail-head">
          <div>
            <h2>{{ detail.name }}</h2>
            <span class="skills-id">{{ detail.id }}</span>
            <p v-if="detail.description" class="skills-desc">{{ detail.description }}</p>
          </div>
          <button class="skills-del" title="Delete skill" @click="removeSkill(detail.id)">Delete</button>
        </div>

        <SkillFileEditor :detail="detail" @saved="onSaved" />
        <SkillHistoryPanel :history="history" :skill-id="detail.id" />
      </template>
      <StatePanel v-else>Select a skill</StatePanel>
    </div>
  </div>
</template>

<style scoped>
.skills {
  flex: 1;
  display: flex;
  min-height: 0;
}

.skills-detail {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.skills-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.skills-detail-head h2 { margin: 0; font-size: 18px; color: var(--color-text-primary); }
.skills-id { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; color: var(--color-text-muted); }
.skills-desc { margin: 6px 0 0; font-size: 12px; color: var(--color-text-hover); max-width: 720px; }

.skills-del {
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
.skills-del:hover { color: var(--color-error); border-color: var(--color-error); }
</style>
