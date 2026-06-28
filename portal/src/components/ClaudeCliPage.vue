<script setup lang="ts">
// The global Claude CLI surface: a resizable Drawer hosting one or more terminal
// tabs (each its own tmux/claude session, sharing auth), the CLAUDE.md editor,
// and a sign-in gate. Tabs are nameable (double-click to rename); the tab set +
// names + last-active tab are persisted and restored when the drawer reopens.
import { ref, watch, nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'
import Drawer from './Drawer.vue'
import Terminal from './Terminal.vue'
import ClaudeEditorModal from './ClaudeEditorModal.vue'
import ClaudeAuthModal from './ClaudeAuthModal.vue'

interface Tab { id: string; name: string }

const ui = useUiStore()
const showEditor = ref(false)

const TABS_KEY = 'bender.cli.tabs'
const ACTIVE_KEY = 'bender.cli.active'
const newId = () => Math.random().toString(36).slice(2, 8)

const tabs = ref<Tab[]>(loadTabs())
const activeId = ref<string>(loadActive())
const termRefs = new Map<string, { fit: () => void }>()

function loadTabs(): Tab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) || '[]')
    if (Array.isArray(raw) && raw.length) {
      // Migrate the old `string[]` (ids only) format → named tabs.
      return raw.map((t, i): Tab =>
        typeof t === 'string' ? { id: t, name: `Terminal ${i + 1}` }
          : { id: String(t.id), name: String(t.name || `Terminal ${i + 1}`) })
    }
  } catch { /* ignore */ }
  return [{ id: newId(), name: 'Terminal 1' }]
}
function loadActive(): string {
  const a = localStorage.getItem(ACTIVE_KEY) || ''
  return tabs.value.some((t) => t.id === a) ? a : tabs.value[0].id
}
function persist() {
  localStorage.setItem(TABS_KEY, JSON.stringify(tabs.value))
  localStorage.setItem(ACTIVE_KEY, activeId.value)
}

function setTermRef(id: string, el: any) {
  if (el) termRefs.set(id, el)
  else termRefs.delete(id)
}
function fitActive() {
  nextTick(() => termRefs.get(activeId.value)?.fit())
}

function setActive(id: string) {
  activeId.value = id
  persist()
  fitActive()
}
function addTab() {
  const id = newId()
  tabs.value.push({ id, name: `Terminal ${tabs.value.length + 1}` })
  setActive(id)
}
async function closeTab(id: string) {
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx === -1) return
  tabs.value.splice(idx, 1)
  termRefs.delete(id)
  try { await api.closeCliSession(id) } catch { /* ignore */ }
  if (tabs.value.length === 0) { addTab(); return }
  if (activeId.value === id) setActive(tabs.value[Math.min(idx, tabs.value.length - 1)].id)
  else persist()
}

// --- Inline rename (double-click a tab) ---
const editingId = ref<string | null>(null)
const draft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

function startRename(tab: Tab) {
  editingId.value = tab.id
  draft.value = tab.name
  nextTick(() => renameInput.value?.select())
}
function commitRename(tab: Tab) {
  if (editingId.value !== tab.id) return
  const n = draft.value.trim()
  if (n) tab.name = n
  editingId.value = null
  persist()
}

// --- Sign-in gate (shared auth for every tab + pipeline runs) ---
const needAuth = ref(false)
const authChecked = ref(false)

let opened = false
watch(() => ui.terminalOpen, async (open) => {
  if (!open) return
  if (!opened) {
    opened = true
    // Merge any live server-side sessions (e.g. created elsewhere) in.
    try {
      const r = await api.getCliSessions()
      for (const id of r.sessions) {
        if (!tabs.value.some((t) => t.id === id)) tabs.value.push({ id, name: `Terminal ${tabs.value.length + 1}` })
      }
      persist()
    } catch { /* ignore */ }
    try {
      needAuth.value = !(await api.getCliAuth()).authenticated
    } catch { needAuth.value = false }
    authChecked.value = true
  }
  fitActive()
})
</script>

<template>
  <Drawer :open="ui.terminalOpen">
    <div class="cli">
      <div class="cli-tabs">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="cli-tab"
          :class="{ active: tab.id === activeId }"
          @click="setActive(tab.id)"
          @dblclick="startRename(tab)"
        >
          <input
            v-if="editingId === tab.id"
            ref="renameInput"
            v-model="draft"
            class="cli-tab-input"
            @click.stop
            @blur="commitRename(tab)"
            @keydown.enter.prevent="commitRename(tab)"
            @keydown.esc.prevent="editingId = null"
          />
          <span v-else class="cli-tab-name" title="Double-click to rename">{{ tab.name }}</span>
          <span class="cli-tab-close" title="Close" @click.stop="closeTab(tab.id)">&times;</span>
        </div>
        <button class="cli-tab-add" title="New terminal" @click="addTab">+</button>
      </div>

      <div v-if="authChecked && !needAuth" class="cli-terms">
        <Terminal
          v-for="tab in tabs"
          v-show="tab.id === activeId"
          :key="tab.id"
          :ref="(el: any) => setTermRef(tab.id, el)"
          :session="tab.id"
          @open-editor="showEditor = true"
        />
      </div>
      <div v-else-if="authChecked && needAuth" class="cli-gate">
        Claude isn't signed in.
      </div>
    </div>
  </Drawer>

  <ClaudeEditorModal v-model:open="showEditor" />
  <ClaudeAuthModal
    v-if="needAuth"
    global
    @close="needAuth = false"
    @authenticated="needAuth = false"
  />
</template>

<style scoped>
.cli {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #1a1418;
}

.cli-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 30px;
  flex-shrink: 0;
  padding: 0 var(--spacing-sm);
  background: var(--color-bg-secondary);
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
}

.cli-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color var(--transition-fast), background var(--transition-fast);
}
.cli-tab:hover { color: var(--color-text-hover); background: var(--color-bg-element); }
.cli-tab.active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-accent);
}

.cli-tab-name { user-select: none; white-space: nowrap; }

.cli-tab-input {
  width: 90px;
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-accent);
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  outline: none;
}

.cli-tab-close {
  font-size: 14px;
  line-height: 1;
  opacity: 0.5;
  border-radius: var(--radius-xs);
  padding: 0 3px;
}
.cli-tab-close:hover { opacity: 1; color: var(--color-error); }

.cli-tab-add {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 16px;
  line-height: 1;
  padding: 0 8px;
  cursor: pointer;
}
.cli-tab-add:hover { color: var(--color-text-primary); }

.cli-terms {
  flex: 1;
  min-height: 0;
  display: flex;
}

.cli-terms > * { flex: 1; min-width: 0; }

.cli-gate {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
