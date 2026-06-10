<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/api'
import DiffViewer from './DiffViewer.vue'
import PipelineGraph from './PipelineGraph.vue'

defineEmits<{ (e: 'close'): void }>()

interface DefSummary { id: string; name: string; stages: any[]; skills: string[] }
interface DefDetail { id: string; name: string; content: string; stages: any[]; skills: Array<{ name: string; content: string }> }

const definitions = ref<DefSummary[]>([])
const selectedId = ref<string | null>(null)
const detail = ref<DefDetail | null>(null)
const history = ref<Array<{ sha: string; author: string; date: string; message: string }>>([])
const loading = ref(false)

// commit history reused by DiffViewer (it fetches each commit's diff url)
const diffOpen = ref(false)
const diffCommits = computed(() =>
  history.value.map(c => ({
    name: c.sha.slice(0, 7),
    message: c.message,
    url: selectedId.value ? api.definitionCommitUrl(selectedId.value, c.sha) : '',
  })),
)
const diffInitial = ref(0)

const creating = ref(false)
const newId = ref('')

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

function openDiffAt(index: number) {
  diffInitial.value = index
  diffOpen.value = true
}

async function createDefinition() {
  const id = newId.value.trim()
  if (!id) return
  creating.value = true
  try {
    await api.createDefinition(id)
    newId.value = ''
    await load()
    await select(id)
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

function shortDate(iso: string): string {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

// ── Stage editor ──────────────────────────────────────────────
const STAGE_HEADER = /^###\s+\d+\.\s+/

// Split pipeline.md into the leading head block + one text block per stage
function splitSections(md: string): { head: string; sections: string[] } {
  const lines = (md || '').split('\n')
  const idxs: number[] = []
  lines.forEach((l, i) => { if (STAGE_HEADER.test(l)) idxs.push(i) })
  if (!idxs.length) return { head: md || '', sections: [] }
  const head = lines.slice(0, idxs[0]).join('\n')
  const sections: string[] = []
  for (let k = 0; k < idxs.length; k++) {
    const end = k + 1 < idxs.length ? idxs[k + 1] : lines.length
    sections.push(lines.slice(idxs[k], end).join('\n'))
  }
  return { head, sections }
}

const stageEditorOpen = ref(false)
const editingStageIndex = ref(-1)
const stageText = ref('')
const skillName = ref('')
const skillText = ref('')
const stageSaving = ref(false)
const stageError = ref('')

const editingStageName = computed(() =>
  detail.value?.stages[editingStageIndex.value]?.name || 'Stage',
)

function openStage(index: number) {
  if (!detail.value) return
  const { sections } = splitSections(detail.value.content)
  stageText.value = sections[index] ?? ''
  editingStageIndex.value = index
  const sk = detail.value.stages[index]?.skill || ''
  skillName.value = sk
  skillText.value = detail.value.skills.find(s => s.name === sk)?.content ?? ''
  stageError.value = ''
  stageEditorOpen.value = true
}

async function saveStage() {
  if (!detail.value || stageSaving.value) return
  stageSaving.value = true
  stageError.value = ''
  try {
    const id = detail.value.id
    const { head, sections } = splitSections(detail.value.content)
    sections[editingStageIndex.value] = stageText.value.replace(/\s+$/, '') + '\n'
    const parts = head ? [head, ...sections] : [...sections]
    const pipelineMd = parts.join('\n')

    // merge the edited skill into the full skills set
    const skills = detail.value.skills.map(s => ({ ...s }))
    const name = skillName.value.trim()
    if (name) {
      const idx = skills.findIndex(s => s.name === name)
      if (skillText.value.trim()) {
        if (idx >= 0) skills[idx].content = skillText.value
        else skills.push({ name, content: skillText.value })
      } else if (idx >= 0) {
        skills.splice(idx, 1)
      }
    }

    await api.updateDefinition(id, { pipelineMd, skills, message: `Edit stage: ${editingStageName.value}` })
    stageEditorOpen.value = false
    await select(id)
  } catch (e) {
    stageError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    stageSaving.value = false
  }
}
</script>

<template>
  <div class="defs-page">
    <div class="page-header">
      <h1>Pipeline Definitions</h1>
    </div>
    <div class="defs">
      <!-- left: definition list + create -->
      <div class="defs-list">
        <div class="defs-list-header">{{ definitions.length }} definitions</div>
        <button
          v-for="d in definitions"
          :key="d.id"
          class="defs-item"
          :class="{ active: selectedId === d.id }"
          @click="select(d.id)"
        >
          <span class="defs-item-name">{{ d.name }}</span>
          <span class="defs-item-meta">{{ d.stages.length }} stages · {{ d.skills.length }} skills</span>
        </button>
        <div class="defs-create">
          <input v-model="newId" placeholder="new-definition-id" @keydown.enter="createDefinition" />
          <button class="defs-create-btn" :disabled="creating || !newId.trim()" @click="createDefinition">+ Create</button>
        </div>
      </div>

      <!-- right: detail -->
      <div class="defs-detail">
        <div v-if="loading" class="defs-state">Loading…</div>
        <template v-else-if="detail">
          <div class="defs-detail-head">
            <div>
              <h2>{{ detail.name }}</h2>
              <span class="defs-id">{{ detail.id }}</span>
            </div>
            <button class="defs-del" title="Delete definition" @click="removeDefinition(detail.id)">Delete</button>
          </div>

          <div class="defs-section">
            <div class="defs-section-title">Graph <span class="defs-hint">— click a stage to edit</span></div>
            <PipelineGraph v-if="detail.stages.length" :stages="detail.stages">
              <template #node="{ stage, index }">
                <button type="button" class="defs-gnode" @click="openStage(index)">
                  <span class="defs-gnode-name">{{ stage.name }}</span>
                  <span class="defs-gnode-skill">{{ stage.skill }}</span>
                </button>
              </template>
            </PipelineGraph>
            <div v-else class="defs-empty">No stages</div>
          </div>

          <div class="defs-section">
            <div class="defs-section-title">Bundled skills</div>
            <div class="defs-skills">
              <span v-for="sk in detail.skills" :key="sk.name" class="defs-skill-chip">{{ sk.name }}</span>
              <span v-if="!detail.skills.length" class="defs-empty">No skills bundled</span>
            </div>
          </div>

          <div class="defs-section">
            <div class="defs-section-title">History</div>
            <div class="defs-history">
              <button
                v-for="(c, i) in history"
                :key="c.sha"
                class="defs-commit"
                @click="openDiffAt(i)"
              >
                <span class="defs-commit-sha">{{ c.sha.slice(0, 7) }}</span>
                <span class="defs-commit-msg">{{ c.message }}</span>
                <span class="defs-commit-date">{{ shortDate(c.date) }}</span>
              </button>
              <div v-if="!history.length" class="defs-empty">No commits</div>
            </div>
          </div>
        </template>
        <div v-else class="defs-state">Select a definition</div>
      </div>
    </div>
  </div>

  <DiffViewer
    v-if="diffOpen && diffCommits.length"
    :commits="diffCommits"
    :initial-index="diffInitial"
    @close="diffOpen = false"
  />

  <!-- Stage editor -->
  <Teleport to="body">
    <div v-if="stageEditorOpen" class="modal-overlay" @mousedown.self="stageEditorOpen = false">
      <div class="stage-editor">
        <div class="se-header">
          <div class="se-title">
            <h3>Edit stage: {{ editingStageName }}</h3>
            <span class="se-sub">{{ detail?.name }} · {{ detail?.id }}</span>
          </div>
          <button class="se-close" @click="stageEditorOpen = false">✕</button>
        </div>

        <div class="se-body">
          <div class="se-field">
            <label class="se-label">Stage definition <span class="se-label-hint">(pipeline.md section)</span></label>
            <textarea
              v-model="stageText"
              class="se-textarea stage"
              spellcheck="false"
              placeholder="### 1. Stage Name&#10;**Skill:** my-skill&#10;**Success Criteria:** …&#10;**Next:** …"
            ></textarea>
          </div>

          <div class="se-field">
            <label class="se-label">
              Related skill
              <input v-model="skillName" class="se-skill-name" placeholder="skill-name" spellcheck="false" />
              <span class="se-label-hint">SKILL.md</span>
            </label>
            <textarea
              v-model="skillText"
              class="se-textarea skill"
              spellcheck="false"
              :disabled="!skillName.trim()"
              :placeholder="skillName.trim() ? 'Skill instructions…' : 'Set a skill name above to add a skill'"
            ></textarea>
          </div>
        </div>

        <div v-if="stageError" class="se-error">{{ stageError }}</div>

        <div class="se-footer">
          <button class="modal-btn cancel" :disabled="stageSaving" @click="stageEditorOpen = false">Cancel</button>
          <button class="modal-btn create" :disabled="stageSaving" @click="saveStage">
            {{ stageSaving ? 'Saving…' : 'Save & commit' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
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

.ph-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.page-header h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.back-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border-medium);
  background: transparent;
  color: var(--color-text-muted);
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.back-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.defs {
  flex: 1;
  display: flex;
  min-height: 0;
}

.defs-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-dark);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
}

.defs-list-header {
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border-dark);
}

.defs-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.defs-item:hover { background: var(--color-bg-tertiary); }
.defs-item.active { background: var(--color-bg-element); border-left-color: var(--color-accent); }

.defs-item-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.defs-item-meta { font-size: 10px; color: var(--color-text-muted); }

.defs-create {
  margin-top: auto;
  padding: 12px;
  border-top: 1px solid var(--color-border-dark);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.defs-create input {
  padding: 7px 10px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.defs-create input:focus { border-color: var(--color-accent); }

.defs-create-btn {
  padding: 7px;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.defs-create-btn:hover:not(:disabled) { background: var(--color-accent); color: var(--color-text-bright); }
.defs-create-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.defs-detail {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.defs-state {
  color: var(--color-text-muted);
  font-size: 13px;
  padding: 40px 0;
  text-align: center;
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

.defs-section { margin-bottom: 22px; }

.defs-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.defs-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--color-text-muted); opacity: 0.7; }

/* clickable graph node */
.defs-gnode {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  text-align: left;
  gap: 2px;
  padding: 8px 12px;
  background: var(--color-bg-element);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
}

.defs-gnode:hover { border-color: var(--color-accent); background: var(--color-bg-element-hover); }

.defs-gnode-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.defs-gnode-skill { font-size: 11px; color: var(--color-text-muted); }

.defs-skills { display: flex; flex-wrap: wrap; gap: 6px; }

.defs-skill-chip {
  padding: 3px 10px;
  background: var(--color-bg-element);
  border-radius: 12px;
  font-size: 11px;
  color: var(--color-text-hover);
}

.defs-history { display: flex; flex-direction: column; gap: 4px; }

.defs-commit {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.15s;
}

.defs-commit:hover { border-color: var(--color-accent); }

.defs-commit-sha {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-accent);
  font-weight: 600;
  flex-shrink: 0;
}

.defs-commit-msg {
  font-size: 12px;
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.defs-commit-date { font-size: 11px; color: var(--color-text-muted); flex-shrink: 0; }

.defs-empty { font-size: 12px; color: var(--color-text-muted); }

/* ── Stage editor modal ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.stage-editor {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 10px;
  width: 50vw;
  min-width: 520px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px var(--color-shadow-dark);
}

.se-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}

.se-title { display: flex; flex-direction: column; gap: 2px; }
.se-header h3 { font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin: 0; }
.se-sub { font-size: 11px; color: var(--color-text-muted); font-family: 'SF Mono', Menlo, Consolas, monospace; }

.se-close {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  border-radius: 4px;
}
.se-close:hover { background: var(--color-bg-element); color: var(--color-text-hover); }

.se-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.se-field { display: flex; flex-direction: column; gap: 6px; }

.se-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.se-label-hint { font-weight: 400; color: var(--color-text-muted); font-size: 11px; }

.se-skill-name {
  padding: 3px 8px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 5px;
  color: var(--color-accent);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  outline: none;
}
.se-skill-name:focus { border-color: var(--color-accent); }

.se-textarea {
  width: 100%;
  resize: vertical;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 10px 12px;
  outline: none;
  tab-size: 2;
}
.se-textarea:focus { border-color: var(--color-accent); }
.se-textarea:disabled { opacity: 0.5; cursor: not-allowed; }
.se-textarea.stage { min-height: 150px; }
.se-textarea.skill { min-height: 220px; }

.se-error {
  padding: 8px 20px;
  color: var(--color-error);
  font-size: 12px;
  background: rgba(232, 88, 88, 0.08);
}

.se-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border-dark);
  flex-shrink: 0;
}

.modal-btn {
  padding: 8px 18px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  transition: background 0.15s, opacity 0.15s;
}
.modal-btn.cancel { background: var(--color-bg-element); color: var(--color-text-muted); }
.modal-btn.cancel:hover { background: var(--color-bg-element-hover); color: var(--color-text-hover); }
.modal-btn.create { background: var(--color-accent); color: var(--color-text-bright); }
.modal-btn.create:hover { background: var(--color-accent-hover); }
.modal-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
