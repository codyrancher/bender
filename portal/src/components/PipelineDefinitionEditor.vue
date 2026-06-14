<script setup lang="ts">
// Edits one pipeline definition: a live graph preview, the pipeline.yaml editor
// (parsed + validated, with quick-create for missing skills), the CLAUDE.md
// editor, and the bundled-skills list. Owns the working copies + parse/validation
// (the graph and the editor share them) and emits `saved` after a commit.
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '@/services/api'
import { parsePipeline } from '@/utils/pipelineDefinition'
import PipelineGraphPreview from './PipelineGraphPreview.vue'
import FolderTabs from './primitives/FolderTabs.vue'

interface DefDetail { id: string; name: string; content: string; stages: any[]; skills: Array<{ name: string; content: string }>; claudeMd: string }

const props = defineProps<{ detail: DefDetail }>()
const emit = defineEmits<{ (e: 'saved'): void }>()

// A stage entry in pipeline.yaml: a list item with a `name:` key.
const STAGE_HEADER = /^\s*-\s+name:/

const editMd = ref('')
const mdTextarea = ref<HTMLTextAreaElement | null>(null)
const editorTab = ref<string>('pipeline')
const editClaude = ref('')
const pdefSaving = ref(false)
const pdefError = ref('')
const claudeSaving = ref(false)
const claudeError = ref('')
const globalSkillIds = ref<string[]>([])

// Reset working copies whenever a (different) definition is loaded.
watch(() => props.detail, (d) => {
  editMd.value = d.content
  editClaude.value = d.claudeMd || ''
  pdefError.value = ''
  claudeError.value = ''
}, { immediate: true })

onMounted(loadGlobalSkills)

async function loadGlobalSkills() {
  try {
    const data = await api.getSkillDefinitions()
    globalSkillIds.value = data.skills.map(s => s.id)
  } catch {}
}

// Names of skills that can satisfy a stage reference: bundled in this definition
// OR available as a global skill-definition.
const availableSkillNames = computed(() => {
  const set = new Set<string>()
  for (const id of globalSkillIds.value) set.add(id.toLowerCase())
  for (const s of props.detail.skills || []) set.add(s.name.toLowerCase())
  return set
})

const parsed = computed(() => parsePipeline(editMd.value))

const validation = computed(() => {
  const { stages, unresolved } = parsed.value
  const errors: string[] = []
  let missingSkills: string[] = []
  if (!stages.length) {
    errors.push('No stages found. Add a `stages:` list.')
  } else {
    const noSkill = stages.filter(s => !s.skill).map(s => s.name)
    if (noSkill.length) errors.push(`Missing skill on stage(s): ${noSkill.join(', ')}.`)

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

const dirty = computed(() => editMd.value !== props.detail.content)
const claudeDirty = computed(() => editClaude.value !== (props.detail.claudeMd || ''))

// Last graph that parsed & validated cleanly — what we keep rendering while the
// user is mid-edit and the current text is temporarily invalid.
const lastValidStages = ref<Array<{ name: string; skill: string; next: number[] }>>([])
watch(validation, v => {
  if (v.ok) lastValidStages.value = v.stages.map(s => ({ name: s.name, skill: s.skill, next: s.next }))
}, { immediate: true })

async function saveDefinitionMd() {
  if (pdefSaving.value || !validation.value.ok) return
  pdefSaving.value = true
  pdefError.value = ''
  try {
    const id = props.detail.id
    await api.updateDefinition(id, { pipelineMd: editMd.value, message: `Edit pipeline ${id}` })
    emit('saved')
  } catch (e) {
    pdefError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    pdefSaving.value = false
  }
}

async function saveDefinitionClaude() {
  if (claudeSaving.value || !claudeDirty.value) return
  claudeSaving.value = true
  claudeError.value = ''
  try {
    const id = props.detail.id
    await api.updateDefinition(id, { claudeMd: editClaude.value, message: `Edit CLAUDE.md ${id}` })
    emit('saved')
  } catch (e) {
    claudeError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    claudeSaving.value = false
  }
}

// Clicking a graph node scrolls the editor to that stage's section and selects it.
function jumpToStage(index: number) {
  editorTab.value = 'pipeline'
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
  const lineHeight = ta.scrollHeight / Math.max(1, lines.length)
  ta.scrollTop = Math.max(0, startLine * lineHeight - 40)
}
</script>

<template>
  <div>
    <div class="defs-section">
      <div class="defs-section-title">
        Graph
        <span class="defs-hint">— live preview (last valid){{ dirty && !validation.ok ? ' · current edits invalid' : '' }}</span>
      </div>
      <PipelineGraphPreview :stages="lastValidStages" @jump="jumpToStage" />
    </div>

    <div class="defs-section editor-section">
      <div class="defs-section-title defs-editor-head">
        <FolderTabs
          v-model="editorTab"
          :tabs="[{ key: 'pipeline', label: 'pipeline.yaml', dirty }, { key: 'claude', label: 'CLAUDE.md', dirty: claudeDirty }]"
        />
        <span v-if="editorTab === 'pipeline'" class="defs-hint">— edit the definition; validated on save</span>
        <span v-else class="defs-hint">— the agent's instructions at run time (replaces the template's)</span>
      </div>

      <div class="editor-panel">
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

        <!-- pipeline.yaml editor -->
        <div v-show="editorTab === 'pipeline'">
          <textarea
            ref="mdTextarea"
            v-model="editMd"
            class="pdef-textarea"
            spellcheck="false"
            placeholder="name: My Pipeline&#10;stages:&#10;  - name: Build&#10;    skill: build&#10;    successCriteria: compiles cleanly&#10;    next: [Test, Lint]"
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
    </div>

    <div class="defs-section">
      <div class="defs-section-title">Bundled skills</div>
      <div class="defs-skills">
        <span v-for="sk in detail.skills" :key="sk.name" class="defs-skill-chip">{{ sk.name }}</span>
        <span v-if="!detail.skills.length" class="defs-empty">No skills bundled</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

/* The editor's folder tabs connect into a panel whose surface is the darker
   input color, so set the shared tab surface var to match. */
.editor-section { --folder-tab-surface: var(--color-bg-primary); }

/* editor section header: folder-tab strip + contextual hint, bottom-aligned so
   the active tab sits on the panel's top edge (no gap below). */
.defs-editor-head {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 0;
}
.defs-editor-head .defs-hint { padding-bottom: 9px; }

/* Connected surface the active folder tab merges into (mirrors TabbedPage's
   panel, in the darker editor color). */
.editor-panel {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 0 var(--radius-lg) var(--radius-lg) var(--radius-lg);
  padding: 14px;
}

.defs-skills { display: flex; flex-wrap: wrap; gap: 6px; }

.defs-skill-chip {
  padding: 3px 10px;
  background: var(--color-bg-element);
  border-radius: 12px;
  font-size: 11px;
  color: var(--color-text-hover);
}

.defs-empty { font-size: 12px; color: var(--color-text-muted); }

/* ── pipeline.yaml / CLAUDE.md editor ── */
/* The .editor-panel is the surface + border now, so the textarea is bare. */
.pdef-textarea {
  display: block;
  width: 100%;
  min-height: 280px;
  resize: vertical;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 0;
  outline: none;
  tab-size: 2;
}

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
</style>
