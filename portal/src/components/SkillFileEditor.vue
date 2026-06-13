<script setup lang="ts">
// Edits a skill definition's files: file list (add/remove), a textarea editor,
// and save-on-demand with a dirty indicator. Owns its working copy of the files
// and the file-selection slice of the URL (/definitions/skills/:id/:file), so a
// refresh/back keeps the same file open. Emits `saved` so the parent can reload.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'

interface SkillFile { path: string; content: string; binary: boolean }
interface SkillDetail { id: string; name: string; description: string; files: SkillFile[] }

const props = defineProps<{ detail: SkillDetail }>()
const emit = defineEmits<{ (e: 'saved'): void }>()

const route = useRoute()
const router = useRouter()

// working copy of the files (edited in-place, saved on demand)
const editFiles = ref<SkillFile[]>([])
const selectedFile = ref<string>('SKILL.md')
const saving = ref(false)
const error = ref('')
const addingFile = ref(false)
const newFilePath = ref('')

// Build the URL for a file so refresh/back keep the selection.
function skillUrl(file?: string): string {
  const base = `/definitions/skills/${props.detail.id}`
  return file && file !== 'SKILL.md' ? `${base}/${encodeURIComponent(file)}` : base
}

// Reset the working copy whenever a (different) skill is loaded, honoring the
// file in the URL if it exists; otherwise default to SKILL.md.
watch(() => props.detail, (detail) => {
  editFiles.value = detail.files.map((f) => ({ ...f }))
  const wanted = (route.params.file as string) || ''
  selectedFile.value = (wanted && detail.files.some((f) => f.path === wanted) ? wanted : null)
    || detail.files.find((f) => f.path === 'SKILL.md')?.path || detail.files[0]?.path || 'SKILL.md'
}, { immediate: true })

// file in the URL → selected file
watch(() => route.params.file, (file) => {
  const f = (file as string) || ''
  if (f && editFiles.value.some((x) => x.path === f)) selectedFile.value = f
})

const activeFile = computed<SkillFile | null>(
  () => editFiles.value.find((f) => f.path === selectedFile.value) || null,
)

const dirty = computed(() => JSON.stringify(editFiles.value) !== JSON.stringify(props.detail.files))

function updateActiveContent(value: string) {
  const f = editFiles.value.find((x) => x.path === selectedFile.value)
  if (f) f.content = value
}

function startAddFile() {
  addingFile.value = true
  newFilePath.value = ''
}

function confirmAddFile() {
  const p = newFilePath.value.trim()
  if (!p) return
  if (!editFiles.value.some((f) => f.path === p)) {
    editFiles.value.push({ path: p, content: '', binary: false })
  }
  selectedFile.value = p
  router.push(skillUrl(p))
  addingFile.value = false
  newFilePath.value = ''
}

function removeFile(path: string) {
  if (path === 'SKILL.md') return
  editFiles.value = editFiles.value.filter((f) => f.path !== path)
  if (selectedFile.value === path) {
    selectedFile.value = 'SKILL.md'
    router.push(skillUrl())
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const id = props.detail.id
    const files = editFiles.value
      .filter((f) => !f.binary)
      .map((f) => ({ path: f.path, content: f.content }))
    await api.updateSkillDefinition(id, files, `Edit skill ${id}`)
    emit('saved')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="skill-editor">
      <div class="skill-files">
        <div class="skill-files-head">Files</div>
        <button
          v-for="f in editFiles"
          :key="f.path"
          class="skill-file"
          :class="{ active: selectedFile === f.path }"
          @click="router.push(skillUrl(f.path))"
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
  </div>
</template>

<style scoped>
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
</style>
