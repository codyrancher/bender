<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import DiffViewer from '../components/primitives/DiffViewer.vue'
import PipelineGraph from '../components/PipelineGraph.vue'
import Tabs from '../components/primitives/Tabs.vue'
import Modal from '../components/primitives/Modal.vue'
import Button from '../components/primitives/Button.vue'
import FormField from '../components/primitives/FormField.vue'
import StatePanel from '../components/primitives/StatePanel.vue'
import SkillDefinitionsPanel from '../components/SkillDefinitionsPanel.vue'

const route = useRoute()
const router = useRouter()

// The active tab lives in the URL (/definitions/:tab) so a refresh stays put.
const activeTab = ref<string>((route.params.tab as string) || 'pipelines')

interface DefSummary { id: string; name: string; stages: any[]; skills: string[] }
interface DefDetail { id: string; name: string; content: string; stages: any[]; skills: Array<{ name: string; content: string }>; claudeMd: string }

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

// Import a definition from a running pipeline instance — pushes that pipeline's
// current pipeline.md + referenced skills into the definitions repo. (Relocated
// here from the pipeline card's old "push to definitions" button.)
const importModal = ref<{ instances: string[]; pipeline: string; definitionId: string; message: string; saving: boolean; error: string } | null>(null)

async function openImport() {
  importModal.value = { instances: [], pipeline: '', definitionId: '', message: '', saving: false, error: '' }
  try {
    const r = await api.getPipelines()
    const instances = r.pipelines.map(p => p.name)
    const first = instances[0] || ''
    importModal.value = { instances, pipeline: first, definitionId: first, message: first ? `Update ${first} definition` : '', saving: false, error: '' }
  } catch (e) {
    if (importModal.value) importModal.value.error = e instanceof Error ? e.message : 'Failed to load pipelines'
  }
}

function onPickImportPipeline() {
  const m = importModal.value
  if (!m) return
  m.definitionId = m.pipeline
  m.message = `Update ${m.pipeline} definition`
}

async function confirmImport() {
  const m = importModal.value
  if (!m || m.saving || !m.pipeline || !m.definitionId.trim()) return
  m.saving = true; m.error = ''
  try {
    await api.pushPipelineDefinition(m.pipeline, m.definitionId.trim(), m.message.trim())
    await load()
    importModal.value = null
    router.push('/definitions/pipelines/' + m.definitionId.trim())
  } catch (err) {
    m.error = err instanceof Error ? err.message : 'Import failed'
  } finally {
    if (importModal.value) importModal.value.saving = false
  }
}

// pipeline.md editor working copy + global skill availability
const editMd = ref('')
const mdTextarea = ref<HTMLTextAreaElement | null>(null)
const globalSkillIds = ref<string[]>([])
const pdefSaving = ref(false)
const pdefError = ref('')

// CLAUDE.md editor: the definition's CLAUDE.md is the agent's instructions at run
// time (it replaces the template's). Edited independently of pipeline.md.
const editorTab = ref<string>('pipeline')
const editClaude = ref('')
const claudeSaving = ref(false)
const claudeError = ref('')

onMounted(() => { load(); loadGlobalSkills() })

async function loadGlobalSkills() {
  try {
    const data = await api.getSkillDefinitions()
    globalSkillIds.value = data.skills.map(s => s.id)
  } catch {}
}

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
    editMd.value = d.content
    editClaude.value = d.claudeMd || ''
    pdefError.value = ''
    claudeError.value = ''
  } catch {
    detail.value = null
    history.value = []
  } finally {
    loading.value = false
  }
}

// ── URL ↔ selection sync (so a refresh stays on the same tab/definition) ──
// route → tab
watch(() => route.params.tab, (t) => {
  const tab = (t as string) || 'pipelines'
  if (tab !== activeTab.value) activeTab.value = tab
})
// tab → route (preserve the selected pipeline id when on the pipelines tab)
watch(activeTab, (tab) => {
  const cur = (route.params.tab as string) || 'pipelines'
  if (tab === cur) return
  if (tab === 'pipelines') router.push(`/definitions/pipelines${selectedId.value ? '/' + selectedId.value : ''}`)
  else router.push('/definitions/skills')
})
// route → selected pipeline definition (only meaningful on the pipelines tab)
watch(() => [activeTab.value, route.params.id] as const, ([tab, id]) => {
  const rid = id as string
  if (tab === 'pipelines' && rid && rid !== selectedId.value) select(rid)
}, { immediate: true })

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

// ── pipeline.md parsing + validation ──────────────────────────
const STAGE_HEADER = /^###\s+\d+\.\s+/

interface ParsedStage { name: string; skill: string; successCriteria: string; nextNames: string[]; next: number[] }

// Client-side mirror of the backend pipeline.md parser (parsePipelineStages +
// resolveGraph): captures stages, skills, success criteria and Next edges, then
// resolves successor names to indices (linear default when no edges declared).
function parsePipeline(md: string): { stages: ParsedStage[]; unresolved: Array<{ stage: string; target: string }> } {
  const lines = (md || '').split('\n')
  const stages: ParsedStage[] = []
  let cur: ParsedStage | null = null
  let desc: string[] = []
  const flush = () => { if (cur) { stages.push(cur) } }
  for (const line of lines) {
    const m = line.match(/^###\s+\d+\.\s+(.+)/)
    if (m) { flush(); cur = { name: m[1].trim(), skill: '', successCriteria: '', nextNames: [], next: [] }; desc = []; continue }
    if (cur) {
      let mm: RegExpMatchArray | null
      if ((mm = line.match(/^\*\*Skill:\*\*\s*(.+)/))) { cur.skill = mm[1].trim(); continue }
      if ((mm = line.match(/^\*\*Success Criteria:\*\*\s*(.+)/))) { cur.successCriteria = mm[1].trim(); continue }
      if ((mm = line.match(/^\*\*Next:\*\*\s*(.+)/))) { cur.nextNames = mm[1].split(',').map(s => s.trim()).filter(Boolean); continue }
      const t = line.trim(); if (t) desc.push(t)
    }
  }
  flush()
  const byName = new Map<string, number>()
  stages.forEach((s, i) => byName.set(s.name.toLowerCase(), i))
  const anyEdges = stages.some(s => s.nextNames.length)
  const unresolved: Array<{ stage: string; target: string }> = []
  stages.forEach((s, i) => {
    if (anyEdges) {
      s.next = s.nextNames.map(n => {
        const j = byName.has(n.toLowerCase()) ? byName.get(n.toLowerCase())! : -1
        if (j < 0) unresolved.push({ stage: s.name, target: n })
        return j
      }).filter(x => x >= 0)
    } else {
      s.next = i < stages.length - 1 ? [i + 1] : []
    }
  })
  return { stages, unresolved }
}

// Names of skills that can satisfy a stage reference: bundled in this definition
// OR available as a global skill-definition.
const availableSkillNames = computed(() => {
  const set = new Set<string>()
  for (const id of globalSkillIds.value) set.add(id.toLowerCase())
  for (const s of detail.value?.skills || []) set.add(s.name.toLowerCase())
  return set
})

const parsed = computed(() => parsePipeline(editMd.value))

const validation = computed(() => {
  const { stages, unresolved } = parsed.value
  const errors: string[] = []
  let missingSkills: string[] = []
  if (!stages.length) {
    errors.push('No stages found. Add one with "### 1. Stage Name".')
  } else {
    const noSkill = stages.filter(s => !s.skill).map(s => s.name)
    if (noSkill.length) errors.push(`Missing **Skill:** on stage(s): ${noSkill.join(', ')}.`)

    for (const u of unresolved) errors.push(`Stage "${u.stage}" → unknown **Next:** target "${u.target}".`)

    // graph must be able to start and end
    const preds = stages.map(() => 0)
    stages.forEach(s => s.next.forEach(j => { preds[j]++ }))
    if (!preds.some(p => p === 0)) errors.push('No entry point — every stage has a predecessor (the graph is fully cyclic).')
    if (!stages.some(s => s.next.length === 0)) errors.push('No terminal stage — the pipeline never reaches an end.')

    missingSkills = [...new Set(
      stages.filter(s => s.skill && !availableSkillNames.value.has(s.skill.toLowerCase())).map(s => s.skill),
    )]
    if (missingSkills.length) errors.push(`Skill(s) not available: ${missingSkills.join(', ')}. Create them in the Skills tab.`)
  }
  return { ok: errors.length === 0, errors, stages, missingSkills }
})

// Skill ids are kebab/snake alphanumerics; only those can be auto-created.
const creatableMissingSkills = computed(() =>
  validation.value.missingSkills.filter(n => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(n)),
)

const quickCreating = ref(false)
async function quickCreateMissingSkills() {
  const names = creatableMissingSkills.value
  if (!names.length || quickCreating.value) return
  quickCreating.value = true
  try {
    for (const name of names) {
      try { await api.createSkillDefinition(name) } catch { /* ignore conflicts/invalid */ }
    }
    await loadGlobalSkills() // refresh availability → validation re-evaluates
  } finally {
    quickCreating.value = false
  }
}

const dirty = computed(() => !!detail.value && editMd.value !== detail.value.content)
const claudeDirty = computed(() => !!detail.value && editClaude.value !== (detail.value.claudeMd || ''))

// Last graph that parsed & validated cleanly — what we keep rendering while the
// user is mid-edit and the current text is temporarily invalid.
const lastValidStages = ref<Array<{ name: string; skill: string; next: number[] }>>([])
watch(validation, v => {
  if (v.ok) lastValidStages.value = v.stages.map(s => ({ name: s.name, skill: s.skill, next: s.next }))
}, { immediate: true })

async function saveDefinitionMd() {
  if (!detail.value || pdefSaving.value || !validation.value.ok) return
  pdefSaving.value = true
  pdefError.value = ''
  try {
    const id = detail.value.id
    await api.updateDefinition(id, { pipelineMd: editMd.value, message: `Edit pipeline ${id}` })
    await select(id)
    await load()
  } catch (e) {
    pdefError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    pdefSaving.value = false
  }
}

async function saveDefinitionClaude() {
  if (!detail.value || claudeSaving.value || !claudeDirty.value) return
  claudeSaving.value = true
  claudeError.value = ''
  try {
    const id = detail.value.id
    await api.updateDefinition(id, { claudeMd: editClaude.value, message: `Edit CLAUDE.md ${id}` })
    await select(id)
  } catch (e) {
    claudeError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    claudeSaving.value = false
  }
}

// Clicking a graph node scrolls the editor to that stage's section and selects it.
function jumpToStage(index: number) {
  const lines = editMd.value.split('\n')
  const headerIdxs: number[] = []
  lines.forEach((l, i) => { if (STAGE_HEADER.test(l)) headerIdxs.push(i) })
  const startLine = headerIdxs[index]
  if (startLine == null) return
  const endLine = headerIdxs[index + 1] ?? lines.length
  const startChar = lines.slice(0, startLine).join('\n').length + (startLine ? 1 : 0)
  const endChar = lines.slice(0, endLine).join('\n').length
  const ta = mdTextarea.value
  if (!ta) return
  ta.focus()
  ta.setSelectionRange(startChar, endChar)
  // approximate scroll to the section
  const lineHeight = ta.scrollHeight / Math.max(1, lines.length)
  ta.scrollTop = Math.max(0, startLine * lineHeight - 40)
}
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

    <div v-show="activeTab === 'pipelines'" class="defs">
      <!-- left: definition list + create -->
      <div class="defs-list">
        <div class="defs-list-header">{{ definitions.length }} definitions</div>
        <button
          v-for="d in definitions"
          :key="d.id"
          class="defs-item"
          :class="{ active: selectedId === d.id }"
          @click="router.push('/definitions/pipelines/' + d.id)"
        >
          <span class="defs-item-name">{{ d.name }}</span>
          <span class="defs-item-meta">{{ d.stages.length }} stages · {{ d.skills.length }} skills</span>
        </button>
        <div class="defs-create">
          <input v-model="newId" placeholder="new-definition-id" @keydown.enter="createDefinition" />
          <button class="defs-create-btn" :disabled="creating || !newId.trim()" @click="createDefinition">+ Create</button>
          <button class="defs-create-btn alt" title="Import a running pipeline's pipeline.md + skills as a definition" @click="openImport">↑ From pipeline</button>
        </div>
      </div>

      <!-- right: detail -->
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

          <div class="defs-section">
            <div class="defs-section-title">
              Graph
              <span class="defs-hint">— live preview (last valid){{ dirty && !validation.ok ? ' · current edits invalid' : '' }}</span>
            </div>
            <PipelineGraph v-if="lastValidStages.length" :stages="lastValidStages">
              <template #node="{ stage, index }">
                <button type="button" class="defs-gnode" title="Jump to this stage in the editor" @click="jumpToStage(index)">
                  <span class="defs-gnode-name">{{ stage.name }}</span>
                  <span class="defs-gnode-skill">{{ stage.skill }}</span>
                </button>
              </template>
            </PipelineGraph>
            <div v-else class="defs-empty">No valid graph yet — add stages below</div>
          </div>

          <div class="defs-section">
            <div class="defs-section-title defs-editor-head">
              <Tabs
                v-model="editorTab"
                :tabs="[{ key: 'pipeline', label: 'pipeline.md', dirty }, { key: 'claude', label: 'CLAUDE.md', dirty: claudeDirty }]"
              />
              <span v-if="editorTab === 'pipeline'" class="defs-hint">— edit the definition; validated on save</span>
              <span v-else class="defs-hint">— the agent's instructions at run time (replaces the template's)</span>
            </div>

            <!-- CLAUDE.md editor -->
            <div v-show="editorTab === 'claude'">
              <textarea
                v-model="editClaude"
                class="pdef-textarea"
                spellcheck="false"
                placeholder="# Project instructions for the agent…"
              ></textarea>
              <div v-if="claudeError" class="pdef-save-error">{{ claudeError }}</div>
              <div class="pdef-actions">
                <span v-if="claudeDirty" class="pdef-dirty">● Unsaved changes</span>
                <button
                  class="pdef-save"
                  :disabled="claudeSaving || !claudeDirty"
                  @click="saveDefinitionClaude"
                >
                  {{ claudeSaving ? 'Saving…' : 'Save & commit' }}
                </button>
              </div>
            </div>

            <!-- pipeline.md editor -->
            <div v-show="editorTab === 'pipeline'">
            <textarea
              ref="mdTextarea"
              v-model="editMd"
              class="pdef-textarea"
              spellcheck="false"
              placeholder="# Pipeline Name&#10;&#10;## Stages&#10;&#10;### 1. Build&#10;**Skill:** build&#10;**Success Criteria:** compiles cleanly&#10;**Next:** Test, Lint"
            ></textarea>

            <div class="pdef-validation" :class="validation.ok ? 'ok' : 'bad'">
              <template v-if="validation.ok">✓ Valid — forms a pipeline and all skills are available.</template>
              <template v-else>
                <div class="pdef-verr">
                  <div class="pdef-verr-text">
                    <div class="pdef-verr-title">⚠ {{ validation.errors.length }} issue{{ validation.errors.length === 1 ? '' : 's' }}</div>
                    <ul><li v-for="(e, i) in validation.errors" :key="i">{{ e }}</li></ul>
                  </div>
                  <button
                    v-if="creatableMissingSkills.length"
                    class="pdef-quickfix"
                    :disabled="quickCreating"
                    @click="quickCreateMissingSkills"
                  >
                    {{ quickCreating
                      ? 'Creating…'
                      : `+ Quick-create ${creatableMissingSkills.length} missing skill${creatableMissingSkills.length === 1 ? '' : 's'}` }}
                  </button>
                </div>
              </template>
            </div>

            <div v-if="pdefError" class="pdef-save-error">{{ pdefError }}</div>

            <div class="pdef-actions">
              <span v-if="dirty" class="pdef-dirty">● Unsaved changes</span>
              <button
                class="pdef-save"
                :disabled="pdefSaving || !dirty || !validation.ok"
                :title="!validation.ok ? 'Fix validation issues before saving' : ''"
                @click="saveDefinitionMd"
              >
                {{ pdefSaving ? 'Saving…' : 'Save & commit' }}
              </button>
            </div>
            </div>
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
        <StatePanel v-else>Select a definition</StatePanel>
      </div>
    </div>
  </div>

  <DiffViewer
    v-if="diffOpen && diffCommits.length"
    :commits="diffCommits"
    :initial-index="diffInitial"
    @close="diffOpen = false"
  />

  <!-- Import a definition from a running pipeline instance -->
  <Modal
    v-if="importModal"
    title="Import from pipeline"
    subtitle="Push a pipeline's current pipeline.md + skills into a definition"
    @close="!importModal.saving && (importModal = null)"
  >
    <div class="imp-pad">
      <p v-if="!importModal.instances.length && !importModal.error" class="imp-empty">No pipelines available to import from.</p>
      <template v-else>
        <FormField label="Pipeline">
          <select v-model="importModal.pipeline" @change="onPickImportPipeline">
            <option v-for="i in importModal.instances" :key="i" :value="i">{{ i }}</option>
          </select>
        </FormField>
        <FormField label="Definition id">
          <input v-model="importModal.definitionId" type="text" placeholder="my-definition" spellcheck="false" />
        </FormField>
        <FormField label="Commit message">
          <input v-model="importModal.message" type="text" @keydown.enter="confirmImport" />
        </FormField>
      </template>
      <div v-if="importModal.error" class="imp-error">{{ importModal.error }}</div>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="importModal.saving" @click="importModal = null">Cancel</Button>
      <Button
        v-if="importModal.instances.length"
        variant="primary"
        :disabled="importModal.saving || !importModal.definitionId.trim()"
        @click="confirmImport"
      >
        {{ importModal.saving ? 'Importing…' : 'Import' }}
      </Button>
    </template>
  </Modal>
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

.defs-create-btn.alt { border-color: var(--color-border-medium); color: var(--color-text-muted); }
.defs-create-btn.alt:hover:not(:disabled) { background: var(--color-bg-element); color: var(--color-text-hover); border-color: var(--color-text-muted); }

/* import-from-pipeline modal content */
.imp-pad { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.imp-empty { font-size: 13px; color: var(--color-text-muted); margin: 0; }
.imp-pad input, .imp-pad select {
  padding: 8px 11px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.imp-pad input:focus, .imp-pad select:focus { border-color: var(--color-accent); }
.imp-error { padding: 8px 12px; color: var(--color-error); font-size: 12px; background: rgba(232, 88, 88, 0.08); border-radius: 6px; }

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

/* editor section header: tab strip + contextual hint on one line */
.defs-editor-head { display: flex; align-items: center; gap: 10px; }

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

/* ── pipeline.md editor ── */
.pdef-textarea {
  width: 100%;
  min-height: 280px;
  resize: vertical;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px 14px;
  outline: none;
  tab-size: 2;
}
.pdef-textarea:focus { border-color: var(--color-accent); }

.pdef-validation {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.pdef-validation.ok {
  color: var(--color-status-running);
  background: rgba(91, 168, 160, 0.10);
}
.pdef-validation.bad {
  color: var(--color-error);
  background: rgba(232, 88, 88, 0.08);
}
.pdef-verr { display: flex; align-items: center; gap: 12px; }
.pdef-verr-text { flex: 1; min-width: 0; }
.pdef-verr-title { font-weight: 600; margin-bottom: 4px; }
.pdef-validation ul { margin: 0; padding-left: 18px; }
.pdef-validation li { margin: 2px 0; }

.pdef-quickfix {
  flex-shrink: 0;
  padding: 5px 12px;
  border: 1px solid var(--color-error);
  background: transparent;
  color: var(--color-error);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.pdef-quickfix:hover:not(:disabled) { background: var(--color-error); color: var(--color-text-bright); }
.pdef-quickfix:disabled { opacity: 0.5; cursor: not-allowed; }

.pdef-save-error {
  margin-top: 8px;
  padding: 8px 12px;
  color: var(--color-error);
  font-size: 12px;
  background: rgba(232, 88, 88, 0.08);
  border-radius: 6px;
}

.pdef-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}
.pdef-dirty { font-size: 11px; color: var(--color-warning); margin-right: auto; }

.pdef-save {
  padding: 8px 18px;
  border: none;
  border-radius: 6px;
  background: var(--color-accent);
  color: var(--color-text-bright);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
.pdef-save:hover:not(:disabled) { background: var(--color-accent-hover); }
.pdef-save:disabled { opacity: 0.4; cursor: not-allowed; }

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

</style>
