<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import DiffViewer from './primitives/DiffViewer.vue'

interface SkillSummary { id: string; name: string; description: string; fileCount: number }
interface SkillFile { path: string; content: string; binary: boolean }
interface SkillDetail { id: string; name: string; description: string; files: SkillFile[] }

const skills = ref<SkillSummary[]>([])
const selectedId = ref<string | null>(null)
const detail = ref<SkillDetail | null>(null)
const history = ref<Array<{ sha: string; author: string; date: string; message: string }>>([])
const loading = ref(false)

// working copy of the selected skill's files (edited in-place, saved on demand)
const editFiles = ref<SkillFile[]>([])
const selectedFile = ref<string>('SKILL.md')
const saving = ref(false)
const error = ref('')

const route = useRoute()
const router = useRouter()
// Build the URL for a skill (+ optional file) so refresh/back keep the selection.
function skillUrl(id: string, file?: string): string {
  const base = `/definitions/skills/${id}`
  return file && file !== 'SKILL.md' ? `${base}/${encodeURIComponent(file)}` : base
}

const creating = ref(false)
const newId = ref('')

const addingFile = ref(false)
const newFilePath = ref('')

const diffOpen = ref(false)
const diffInitial = ref(0)
const diffCommits = computed(() =>
  history.value.map(c => ({
    name: c.sha.slice(0, 7),
    message: c.message,
    url: selectedId.value ? api.skillDefinitionCommitUrl(selectedId.value, c.sha) : '',
  })),
)

const activeFile = computed<SkillFile | null>(
  () => editFiles.value.find(f => f.path === selectedFile.value) || null,
)

const dirty = computed(() => {
  if (!detail.value) return false
  return JSON.stringify(editFiles.value) !== JSON.stringify(detail.value.files)
})

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
  error.value = ''
  try {
    const [d, h] = await Promise.all([api.getSkillDefinition(id), api.getSkillDefinitionHistory(id)])
    detail.value = d
    history.value = h.commits
    editFiles.value = d.files.map(f => ({ ...f }))
    // Honor the file in the URL if it exists; otherwise default to SKILL.md.
    const wanted = (route.params.file as string) || ''
    selectedFile.value = (wanted && d.files.some(f => f.path === wanted) ? wanted : null)
      || d.files.find(f => f.path === 'SKILL.md')?.path || d.files[0]?.path || 'SKILL.md'
  } catch {
    detail.value = null
    history.value = []
    editFiles.value = []
  } finally {
    loading.value = false
  }
}

// route → selected skill + file (keeps refresh/back on the same file)
watch(() => [route.params.id, route.params.file] as const, async ([id, file]) => {
  if (route.params.tab !== 'skills') return
  const sid = id as string
  if (sid && sid !== selectedId.value) await select(sid)
  const f = (file as string) || ''
  if (f && editFiles.value.some(x => x.path === f)) selectedFile.value = f
}, { immediate: true })

function updateActiveContent(value: string) {
  const f = editFiles.value.find(x => x.path === selectedFile.value)
  if (f) f.content = value
}

function startAddFile() {
  addingFile.value = true
  newFilePath.value = ''
}

function confirmAddFile() {
  const p = newFilePath.value.trim()
  if (!p) return
  if (!editFiles.value.some(f => f.path === p)) {
    editFiles.value.push({ path: p, content: '', binary: false })
  }
  selectedFile.value = p
  if (selectedId.value) router.push(skillUrl(selectedId.value, p))
  addingFile.value = false
  newFilePath.value = ''
}

function removeFile(path: string) {
  if (path === 'SKILL.md') return
  editFiles.value = editFiles.value.filter(f => f.path !== path)
  if (selectedFile.value === path) {
    selectedFile.value = 'SKILL.md'
    if (selectedId.value) router.push(skillUrl(selectedId.value))
  }
}

async function save() {
  if (!detail.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const id = detail.value.id
    const files = editFiles.value
      .filter(f => !f.binary)
      .map(f => ({ path: f.path, content: f.content }))
    await api.updateSkillDefinition(id, files, `Edit skill ${id}`)
    await select(id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function createSkill() {
  const id = newId.value.trim()
  if (!id) return
  creating.value = true
  try {
    await api.createSkillDefinition(id)
    newId.value = ''
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
    if (selectedId.value === id) { selectedId.value = null; detail.value = null; history.value = []; editFiles.value = [] }
    await load()
  } catch {}
}

function openDiffAt(index: number) {
  diffInitial.value = index
  diffOpen.value = true
}

function shortDate(iso: string): string {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
</script>

<template>
  <div class="skills">
    <!-- left: skill list + create -->
    <div class="skills-list">
      <div class="skills-list-header">{{ skills.length }} skills</div>
      <button
        v-for="s in skills"
        :key="s.id"
        class="skills-item"
        :class="{ active: selectedId === s.id }"
        @click="router.push(skillUrl(s.id))"
      >
        <span class="skills-item-name">{{ s.name }}</span>
        <span class="skills-item-meta">{{ s.id }} · {{ s.fileCount }} file{{ s.fileCount === 1 ? '' : 's' }}</span>
      </button>
      <div class="skills-create">
        <input v-model="newId" placeholder="new-skill-id" @keydown.enter="createSkill" />
        <button class="skills-create-btn" :disabled="creating || !newId.trim()" @click="createSkill">+ Create</button>
      </div>
    </div>

    <!-- right: detail -->
    <div class="skills-detail">
      <div v-if="loading" class="skills-state">Loading…</div>
      <template v-else-if="detail">
        <div class="skills-detail-head">
          <div>
            <h2>{{ detail.name }}</h2>
            <span class="skills-id">{{ detail.id }}</span>
            <p v-if="detail.description" class="skills-desc">{{ detail.description }}</p>
          </div>
          <button class="skills-del" title="Delete skill" @click="removeSkill(detail.id)">Delete</button>
        </div>

        <!-- file editor: file list + editor -->
        <div class="skill-editor">
          <div class="skill-files">
            <div class="skill-files-head">Files</div>
            <button
              v-for="f in editFiles"
              :key="f.path"
              class="skill-file"
              :class="{ active: selectedFile === f.path }"
              @click="selectedId && router.push(skillUrl(selectedId, f.path))"
            >
              <span class="skill-file-name">{{ f.path }}</span>
              <span
                v-if="f.path !== 'SKILL.md'"
                class="skill-file-del"
                title="Remove file"
                @click.stop="removeFile(f.path)"
              >✕</span>
            </button>

            <div v-if="addingFile" class="skill-addfile">
              <input
                v-model="newFilePath"
                placeholder="scripts/run.mjs"
                spellcheck="false"
                @keydown.enter="confirmAddFile"
                @keydown.escape="addingFile = false"
              />
              <button class="skill-addfile-ok" :disabled="!newFilePath.trim()" @click="confirmAddFile">Add</button>
            </div>
            <button v-else class="skill-addfile-btn" @click="startAddFile">+ Add file</button>
          </div>

          <div class="skill-edit-pane">
            <div v-if="activeFile?.binary" class="skill-binary">Binary file — not editable here.</div>
            <textarea
              v-else-if="activeFile"
              class="skill-textarea"
              :value="activeFile.content"
              spellcheck="false"
              placeholder="File contents…"
              @input="updateActiveContent(($event.target as HTMLTextAreaElement).value)"
            ></textarea>
            <div v-else class="skills-empty">Select a file</div>
          </div>
        </div>

        <div v-if="error" class="skill-error">{{ error }}</div>
        <div class="skill-actions">
          <span v-if="dirty" class="skill-dirty">● Unsaved changes</span>
          <button class="skill-save" :disabled="saving || !dirty" @click="save">
            {{ saving ? 'Saving…' : 'Save & commit' }}
          </button>
        </div>

        <!-- history -->
        <div class="skills-section">
          <div class="skills-section-title">History</div>
          <div class="skills-history">
            <button
              v-for="(c, i) in history"
              :key="c.sha"
              class="skills-commit"
              @click="openDiffAt(i)"
            >
              <span class="skills-commit-sha">{{ c.sha.slice(0, 7) }}</span>
              <span class="skills-commit-msg">{{ c.message }}</span>
              <span class="skills-commit-date">{{ shortDate(c.date) }}</span>
            </button>
            <div v-if="!history.length" class="skills-empty">No commits</div>
          </div>
        </div>
      </template>
      <div v-else class="skills-state">Select a skill</div>
    </div>
  </div>

  <DiffViewer
    v-if="diffOpen && diffCommits.length"
    :commits="diffCommits"
    :initial-index="diffInitial"
    @close="diffOpen = false"
  />
</template>

<style scoped>
.skills {
  flex: 1;
  display: flex;
  min-height: 0;
}

.skills-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-dark);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-primary);
}

.skills-list-header {
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border-dark);
}

.skills-item {
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

.skills-item:hover { background: var(--color-bg-tertiary); }
.skills-item.active { background: var(--color-bg-element); border-left-color: var(--color-accent); }
.skills-item-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.skills-item-meta { font-size: 10px; color: var(--color-text-muted); }

.skills-create {
  margin-top: auto;
  padding: 12px;
  border-top: 1px solid var(--color-border-dark);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skills-create input {
  padding: 7px 10px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.skills-create input:focus { border-color: var(--color-accent); }

.skills-create-btn {
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
.skills-create-btn:hover:not(:disabled) { background: var(--color-accent); color: var(--color-text-bright); }
.skills-create-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.skills-detail {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.skills-state {
  color: var(--color-text-muted);
  font-size: 13px;
  padding: 40px 0;
  text-align: center;
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

/* file editor */
.skill-editor {
  display: flex;
  border: 1px solid var(--color-border-dark);
  border-radius: 8px;
  overflow: hidden;
  min-height: 320px;
  height: 50vh;
}

.skill-files {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-dark);
  background: var(--color-bg-secondary);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.skill-files-head {
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border-dark);
}

.skill-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-text-hover);
  transition: background 0.1s;
}
.skill-file:hover { background: var(--color-bg-tertiary); }
.skill-file.active { background: var(--color-bg-element); border-left-color: var(--color-accent); color: var(--color-text-primary); }
.skill-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-file-del { color: var(--color-text-muted); flex-shrink: 0; font-size: 11px; }
.skill-file-del:hover { color: var(--color-error); }

.skill-addfile-btn {
  margin: 8px 10px;
  padding: 6px;
  border: 1px dashed var(--color-border-medium);
  background: transparent;
  color: var(--color-text-muted);
  border-radius: 6px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.skill-addfile-btn:hover { color: var(--color-accent); border-color: var(--color-accent); }

.skill-addfile { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.skill-addfile input {
  padding: 6px 8px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 5px;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  outline: none;
}
.skill-addfile input:focus { border-color: var(--color-accent); }
.skill-addfile-ok {
  padding: 5px;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.skill-addfile-ok:disabled { opacity: 0.4; cursor: not-allowed; }

.skill-edit-pane { flex: 1; display: flex; min-width: 0; }

.skill-textarea {
  flex: 1;
  width: 100%;
  resize: none;
  background: var(--color-bg-primary);
  border: none;
  color: var(--color-text-primary);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px 14px;
  outline: none;
  tab-size: 2;
}

.skill-binary, .skills-empty {
  margin: auto;
  color: var(--color-text-muted);
  font-size: 12px;
}

.skill-error {
  margin-top: 10px;
  padding: 8px 12px;
  color: var(--color-error);
  font-size: 12px;
  background: rgba(232, 88, 88, 0.08);
  border-radius: 6px;
}

.skill-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}
.skill-dirty { font-size: 11px; color: var(--color-warning); margin-right: auto; }

.skill-save {
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
.skill-save:hover:not(:disabled) { background: var(--color-accent-hover); }
.skill-save:disabled { opacity: 0.4; cursor: not-allowed; }

.skills-section { margin-top: 24px; }
.skills-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.skills-history { display: flex; flex-direction: column; gap: 4px; }
.skills-commit {
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
.skills-commit:hover { border-color: var(--color-accent); }
.skills-commit-sha {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-accent);
  font-weight: 600;
  flex-shrink: 0;
}
.skills-commit-msg {
  font-size: 12px;
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.skills-commit-date { font-size: 11px; color: var(--color-text-muted); flex-shrink: 0; }
</style>
