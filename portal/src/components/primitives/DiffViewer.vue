<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'
import ViewportOverlay from './ViewportOverlay.vue'

interface CommitArtifact {
  name: string
  message?: string
  url?: string
  additions?: number
  deletions?: number
}
interface DiffLine {
  type: 'hunk' | 'add' | 'del' | 'ctx'
  oldNum?: number
  newNum?: number
  content: string
}
interface DiffFile {
  path: string
  additions: number
  deletions: number
  lines: DiffLine[]
}

const props = defineProps<{
  commits: CommitArtifact[]
  initialIndex?: number
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const commitIndex = ref(props.initialIndex ?? 0)
const files = ref<DiffFile[]>([])
const selectedFile = ref(0)
const loading = ref(false)
const error = ref('')
type ViewMode = 'inline' | 'split' | 'file'
const viewMode = ref<ViewMode>(
  (localStorage.getItem('diff-view-mode') as ViewMode) || 'inline',
)

function setViewMode(m: ViewMode) {
  viewMode.value = m
  try { localStorage.setItem('diff-view-mode', m) } catch {}
}

interface SplitCell { num?: number; content: string; change: boolean }
interface SplitRow {
  kind: 'hunk' | 'pair'
  content?: string
  left?: SplitCell | null
  right?: SplitCell | null
}

const splitRows = computed<SplitRow[]>(() => {
  const f = activeFile.value
  if (!f) return []
  const rows: SplitRow[] = []
  const lines = f.lines
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'hunk') {
      rows.push({ kind: 'hunk', content: line.content })
      i++
      continue
    }
    if (line.type === 'ctx') {
      rows.push({
        kind: 'pair',
        left: { num: line.oldNum, content: line.content, change: false },
        right: { num: line.newNum, content: line.content, change: false },
      })
      i++
      continue
    }
    // gather a run of consecutive deletions then additions and pair them up
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
    const max = Math.max(dels.length, adds.length)
    for (let k = 0; k < max; k++) {
      const d = dels[k], a = adds[k]
      rows.push({
        kind: 'pair',
        left: d ? { num: d.oldNum, content: d.content, change: true } : null,
        right: a ? { num: a.newNum, content: a.content, change: true } : null,
      })
    }
  }
  return rows
})

const currentCommit = computed(() => props.commits[commitIndex.value])

const totals = computed(() => {
  let add = 0, del = 0
  for (const f of files.value) { add += f.additions; del += f.deletions }
  return { add, del }
})

const activeFile = computed<DiffFile | null>(() => files.value[selectedFile.value] || null)

// reconstruct the resulting ("new") file content from the diff: context + added lines
const fileContent = computed(() => {
  const f = activeFile.value
  if (!f) return ''
  return f.lines
    .filter(l => l.type === 'ctx' || l.type === 'add')
    .map(l => l.content)
    .join('\n')
})

const fileLanguage = computed(() => {
  const n = (activeFile.value?.path || '').toLowerCase()
  if (n.endsWith('.json') || n.endsWith('.sarif')) return 'json'
  if (n.endsWith('.md')) return 'markdown'
  if (n.endsWith('.xml') || n.endsWith('.svg') || n.endsWith('.html')) return 'xml'
  if (n.endsWith('.yaml') || n.endsWith('.yml')) return 'yaml'
  if (n.endsWith('.ts') || n.endsWith('.tsx')) return 'typescript'
  if (n.endsWith('.js') || n.endsWith('.jsx') || n.endsWith('.mjs')) return 'javascript'
  if (n.endsWith('.py')) return 'python'
  if (n.endsWith('.sh') || n.endsWith('.bash')) return 'bash'
  if (n.endsWith('.css')) return 'css'
  return 'plaintext'
})

const fileHighlighted = computed(() => {
  const text = fileContent.value
  if (!text) return ''
  try {
    return hljs.highlight(text, { language: fileLanguage.value, ignoreIllegals: true }).value
  } catch {
    return hljs.highlightAuto(text).value
  }
})

const fileLineCount = computed(() =>
  fileContent.value ? fileContent.value.replace(/\n$/, '').split('\n').length : 0,
)

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}
function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i + 1) : ''
}

watch(commitIndex, loadDiff, { immediate: true })

async function loadDiff() {
  const commit = currentCommit.value
  files.value = []
  selectedFile.value = 0
  error.value = ''
  if (!commit?.url) return
  loading.value = true
  try {
    const resp = await fetch(commit.url)
    const text = await resp.text()
    files.value = parseDiff(text)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load diff'
  } finally {
    loading.value = false
  }
}

function parseDiff(text: string): DiffFile[] {
  const out: DiffFile[] = []
  let current: DiffFile | null = null
  let oldLn = 0, newLn = 0

  for (const raw of (text || '').split('\n')) {
    if (raw.startsWith('diff --git')) {
      const m = raw.match(/ a\/(.+) b\/(.+)$/)
      current = { path: m ? m[2] : raw.replace('diff --git ', ''), additions: 0, deletions: 0, lines: [] }
      out.push(current)
    } else if (raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('new file') || raw.startsWith('deleted file')) {
      continue
    } else if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldLn = m ? parseInt(m[1]) : 0
      newLn = m ? parseInt(m[2]) : 0
      current?.lines.push({ type: 'hunk', content: raw })
    } else if (current) {
      if (raw.startsWith('+')) {
        current.additions++
        current.lines.push({ type: 'add', newNum: newLn++, content: raw.slice(1) })
      } else if (raw.startsWith('-')) {
        current.deletions++
        current.lines.push({ type: 'del', oldNum: oldLn++, content: raw.slice(1) })
      } else {
        current.lines.push({ type: 'ctx', oldNum: oldLn++, newNum: newLn++, content: raw.startsWith(' ') ? raw.slice(1) : raw })
      }
    }
  }
  return out
}
</script>

<template>
  <ViewportOverlay @close="emit('close')">
    <template #title>
      <div class="commit-select-wrap" v-if="commits.length">
        <select v-if="commits.length > 1" v-model="commitIndex" class="commit-select">
          <option v-for="(c, i) in commits" :key="i" :value="i">
            {{ c.name }} — {{ c.message }}
          </option>
        </select>
        <div class="diff-title">
          <span class="diff-sha">{{ currentCommit?.name }}</span>
          <span v-if="currentCommit?.message" class="diff-subtitle">{{ currentCommit.message }}</span>
        </div>
      </div>
    </template>
    <template #actions>
      <div class="view-toggle">
        <button :class="{ active: viewMode === 'inline' }" @click="setViewMode('inline')">Inline</button>
        <button :class="{ active: viewMode === 'split' }" @click="setViewMode('split')">Split</button>
        <button :class="{ active: viewMode === 'file' }" @click="setViewMode('file')">File</button>
      </div>
      <div class="diff-totals">
        <span class="t-add">+{{ totals.add }}</span>
        <span class="t-del">−{{ totals.del }}</span>
      </div>
    </template>

    <div class="diff-content">
      <!-- File explorer -->
      <div class="file-explorer">
            <div class="explorer-header">{{ files.length }} {{ files.length === 1 ? 'file' : 'files' }} changed</div>
            <button
              v-for="(file, fi) in files"
              :key="fi"
              class="explorer-item"
              :class="{ active: selectedFile === fi }"
              @click="selectedFile = fi"
            >
              <span class="explorer-file">
                <span class="explorer-name">{{ basename(file.path) }}</span>
                <span v-if="dirname(file.path)" class="explorer-dir">{{ dirname(file.path) }}</span>
              </span>
              <span class="explorer-stats">
                <span class="t-add">+{{ file.additions }}</span>
                <span class="t-del">−{{ file.deletions }}</span>
              </span>
            </button>
          </div>

          <!-- Diff body -->
          <div class="diff-body">
            <div v-if="loading" class="diff-state">Loading diff…</div>
            <div v-else-if="error" class="diff-state error">{{ error }}</div>
            <div v-else-if="!files.length" class="diff-state">No changes to display</div>
            <template v-else-if="activeFile">
              <div class="diff-file-header">
                <span class="file-path">{{ activeFile.path }}</span>
                <span class="file-stats">
                  <span class="t-add">+{{ activeFile.additions }}</span>
                  <span class="t-del">−{{ activeFile.deletions }}</span>
                </span>
              </div>

              <!-- inline (unified) diff -->
              <table v-if="viewMode === 'inline'" class="diff-table">
                <tbody>
                  <tr v-for="(line, li) in activeFile.lines" :key="li" class="diff-line" :class="line.type">
                    <td class="ln ln-old">{{ line.type === 'hunk' ? '' : (line.oldNum ?? '') }}</td>
                    <td class="ln ln-new">{{ line.type === 'hunk' ? '' : (line.newNum ?? '') }}</td>
                    <td class="ln-sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : '' }}</td>
                    <td class="ln-content">{{ line.content }}</td>
                  </tr>
                </tbody>
              </table>

              <!-- split (side-by-side) diff -->
              <table v-else-if="viewMode === 'split'" class="diff-table split">
                <tbody>
                  <template v-for="(row, ri) in splitRows" :key="ri">
                    <tr v-if="row.kind === 'hunk'" class="diff-line hunk">
                      <td class="ln"></td>
                      <td class="ln-content split-hunk" colspan="3">{{ row.content }}</td>
                    </tr>
                    <tr v-else class="diff-line split-row">
                      <td class="ln ln-old" :class="{ del: row.left?.change }">{{ row.left?.num ?? '' }}</td>
                      <td
                        class="ln-content split-side"
                        :class="{ del: row.left?.change, empty: !row.left }"
                      >{{ row.left?.content ?? '' }}</td>
                      <td class="ln ln-new" :class="{ add: row.right?.change }">{{ row.right?.num ?? '' }}</td>
                      <td
                        class="ln-content split-side"
                        :class="{ add: row.right?.change, empty: !row.right }"
                      >{{ row.right?.content ?? '' }}</td>
                    </tr>
                  </template>
                </tbody>
              </table>

              <!-- full file (reconstructed result) -->
              <div v-else class="file-view code-scroll">
                <div class="gutter">
                  <div v-for="n in fileLineCount" :key="n" class="gln">{{ n }}</div>
                </div>
                <pre class="code"><code class="hljs" v-html="fileHighlighted"></code></pre>
              </div>
            </template>
          </div>
        </div>
  </ViewportOverlay>
</template>

<style scoped>
.commit-select-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.commit-select {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 12px;
  padding: 5px 10px;
  outline: none;
  max-width: 520px;
}

.commit-select:focus { border-color: var(--color-accent); }

.diff-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.diff-sha {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-accent);
}

.diff-subtitle {
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.view-toggle {
  display: flex;
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  overflow: hidden;
}

.view-toggle button {
  padding: 4px 11px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.view-toggle button + button { border-left: 1px solid var(--color-border-medium); }
.view-toggle button:hover { color: var(--color-text-primary); }
.view-toggle button.active { background: var(--color-accent); color: var(--color-text-bright); }

.diff-totals {
  display: flex;
  gap: 8px;
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
}

.t-add { color: var(--color-status-running); }
.t-del { color: var(--color-status-stopped); }

.diff-content {
  flex: 1;
  display: flex;
  min-width: 0;
}

/* File explorer */
.file-explorer {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border-dark);
  overflow-y: auto;
  background: var(--color-bg-primary);
}

.explorer-header {
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border-dark);
  position: sticky;
  top: 0;
  background: var(--color-bg-primary);
}

.explorer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.1s;
}

.explorer-item:hover {
  background: var(--color-bg-tertiary);
}

.explorer-item.active {
  background: var(--color-bg-element);
  border-left-color: var(--color-accent);
}

.explorer-file {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.explorer-name {
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.explorer-dir {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.explorer-stats {
  display: flex;
  gap: 6px;
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

/* Diff body */
.diff-body {
  flex: 1;
  overflow: auto;
  min-width: 0;
}

.diff-state {
  padding: 40px 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

.diff-state.error { color: var(--color-error); }

.diff-file-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-bg-tertiary);
  border-bottom: 1px solid var(--color-border-dark);
  position: sticky;
  top: 0;
  z-index: 1;
}

.file-path {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: 500;
}

.file-stats {
  display: flex;
  gap: 8px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  background: var(--color-bg-primary);
}

.diff-line td { padding: 0; vertical-align: top; }

.ln {
  width: 1%;
  min-width: 40px;
  padding: 0 8px;
  text-align: right;
  color: var(--color-text-muted);
  user-select: none;
  white-space: nowrap;
  opacity: 0.6;
}

.ln-sign {
  width: 14px;
  text-align: center;
  user-select: none;
  color: var(--color-text-muted);
}

.ln-content {
  width: 100%;
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-hover);
}

.diff-line.add { background: rgba(91, 168, 160, 0.10); }
.diff-line.add .ln-sign { color: var(--color-status-running); }
.diff-line.add .ln-content { color: var(--color-text-primary); }

.diff-line.del { background: rgba(232, 88, 88, 0.10); }
.diff-line.del .ln-sign { color: var(--color-error); }
.diff-line.del .ln-content { color: var(--color-text-primary); }

.diff-line.hunk { background: var(--color-bg-tertiary); }
.diff-line.hunk .ln-content {
  color: var(--color-text-muted);
  font-style: italic;
}

/* split (side-by-side) */
.diff-table.split { table-layout: fixed; }
.diff-table.split .split-side {
  width: 50%;
  border-left: 1px solid var(--color-border-dark);
}
.diff-table.split .split-side.empty { background: var(--color-bg-secondary); opacity: 0.5; }
.diff-table.split .split-side.del { background: rgba(232, 88, 88, 0.10); color: var(--color-text-primary); }
.diff-table.split .split-side.add { background: rgba(91, 168, 160, 0.10); color: var(--color-text-primary); }
.diff-table.split .ln.del { background: rgba(232, 88, 88, 0.10); }
.diff-table.split .ln.add { background: rgba(91, 168, 160, 0.10); }
.diff-table.split .split-hunk { font-style: italic; color: var(--color-text-muted); }

/* full file view */
.file-view {
  flex: 1;
  display: flex;
  align-items: flex-start;
  overflow: auto;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  background: var(--color-bg-primary);
}

.file-view .gutter {
  flex-shrink: 0;
  padding: 10px 0;
  text-align: right;
  user-select: none;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border-dark);
  position: sticky;
  left: 0;
}

.file-view .gln {
  padding: 0 12px;
  color: var(--color-text-muted);
  opacity: 0.5;
}

.file-view .code {
  margin: 0;
  padding: 10px 0;
  flex: 1;
}

.file-view .code :deep(code.hljs) {
  display: block;
  padding: 0 16px;
  background: transparent;
  white-space: pre;
}
</style>
