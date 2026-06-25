<script setup lang="ts">
// The global Claude CLI surface: a resizable Drawer hosting one or more terminal
// tabs (each its own tmux/claude session, sharing auth), the CLAUDE.md editor,
// and a sign-in gate. The last-active tab is restored when the drawer reopens.
import { ref, watch, nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'
import Drawer from './Drawer.vue'
import Terminal from './Terminal.vue'
import ClaudeEditorModal from './ClaudeEditorModal.vue'
import ClaudeAuthModal from './ClaudeAuthModal.vue'

const ui = useUiStore()
const showEditor = ref(false)

const TABS_KEY = 'bender.cli.tabs'
const ACTIVE_KEY = 'bender.cli.active'
const newId = () => Math.random().toString(36).slice(2, 8)

// Tab session ids (in order) + the active one, both restored from localStorage.
const tabs = ref<string[]>(loadTabs())
const activeId = ref<string>(loadActive())
const termRefs = new Map<string, { fit: () => void }>()

function loadTabs(): string[] {
  try {
    const t = JSON.parse(localStorage.getItem(TABS_KEY) || '[]')
    if (Array.isArray(t) && t.length) return t.filter((x) => typeof x === 'string')
  } catch { /* ignore */ }
  return [newId()]
}
function loadActive(): string {
  const a = localStorage.getItem(ACTIVE_KEY) || ''
  return tabs.value.includes(a) ? a : tabs.value[0]
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
  tabs.value.push(id)
  setActive(id)
}
async function closeTab(id: string) {
  const idx = tabs.value.indexOf(id)
  if (idx === -1) return
  tabs.value.splice(idx, 1)
  termRefs.delete(id)
  try { await api.closeCliSession(id) } catch { /* ignore */ }
  if (tabs.value.length === 0) { addTab(); return }
  if (activeId.value === id) setActive(tabs.value[Math.min(idx, tabs.value.length - 1)])
  else persist()
}

// --- Sign-in gate (shared auth for every tab + pipeline runs) ---
const needAuth = ref(false)
const authChecked = ref(false)

let opened = false
watch(() => ui.terminalOpen, async (open) => {
  if (!open) return
  if (!opened) {
    opened = true
    // Merge any live server-side sessions (e.g. created in another tab) in.
    try {
      const r = await api.getCliSessions()
      for (const id of r.sessions) if (!tabs.value.includes(id)) tabs.value.push(id)
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
        <button
          v-for="(id, i) in tabs"
          :key="id"
          class="cli-tab"
          :class="{ active: id === activeId }"
          @click="setActive(id)"
        >
          <span>Terminal {{ i + 1 }}</span>
          <span class="cli-tab-close" title="Close" @click.stop="closeTab(id)">&times;</span>
        </button>
        <button class="cli-tab-add" title="New terminal" @click="addTab">+</button>
      </div>

      <div v-if="authChecked && !needAuth" class="cli-terms">
        <Terminal
          v-for="id in tabs"
          v-show="id === activeId"
          :key="id"
          :ref="(el: any) => setTermRef(id, el)"
          :session="id"
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
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-family: inherit;
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
