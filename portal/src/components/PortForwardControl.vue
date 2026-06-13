<script setup lang="ts">
// The port-forwarding control: a toolbar button that opens a dropdown listing
// the pipeline's active forwards and a form to add a new one. Self-contained —
// fetches its own port options and drives the pipelines store.
import { ref, computed } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'
import GlobeIcon from '@/assets/icons/globe.svg?component'
import CloseIcon from '@/assets/icons/close.svg?component'

const props = defineProps<{ pipelineId: string }>()

const pipelinesStore = usePipelinesStore()
const uiStore = useUiStore()

const showForm = ref(false)
const fwdPublicPort = ref('')
const fwdLocalPort = ref('')
const availablePorts = ref<number[]>([])
const listeningPorts = ref<number[]>([])
const loadingOptions = ref(false)

const forwards = computed(() =>
  pipelinesStore.portForwards.filter((f) => f.pipeline === props.pipelineId)
)
const hasForwards = computed(() => forwards.value.length > 0)

async function toggleForm() {
  showForm.value = !showForm.value
  if (showForm.value) {
    fwdPublicPort.value = ''
    fwdLocalPort.value = ''
    loadingOptions.value = true
    try {
      const opts = await api.getForwardOptions(props.pipelineId)
      availablePorts.value = opts.availablePorts
      listeningPorts.value = opts.listeningPorts
    } catch { /* ignore */ }
    loadingOptions.value = false
  }
}

async function submitForward() {
  const pub = parseInt(fwdPublicPort.value, 10)
  const local = parseInt(fwdLocalPort.value, 10)
  if (isNaN(pub) || isNaN(local) || pub < 1 || local < 1) {
    uiStore.showToast('Enter valid port numbers', 'error')
    return
  }
  await pipelinesStore.startPortForward(props.pipelineId, pub, local)
  showForm.value = false
}
</script>

<template>
  <div class="forward-wrap">
    <button
      class="toolbar-btn icon-btn"
      :class="{ active: hasForwards || showForm }"
      title="Port forwarding"
      @click="toggleForm"
    >
      <GlobeIcon />
    </button>
    <div v-if="showForm" class="forward-dropdown">
      <div v-for="fwd in forwards" :key="fwd.publicPort" class="forward-row">
        <span class="forward-label">:{{ fwd.publicPort }} → :{{ fwd.localPort }}</span>
        <button class="btn-icon" title="Stop" @click="pipelinesStore.stopPortForward(fwd.publicPort)">
          <CloseIcon />
        </button>
      </div>
      <div v-if="loadingOptions" class="forward-loading">Loading ports...</div>
      <div v-else class="forward-new">
        <select v-model="fwdPublicPort" class="fwd-select">
          <option value="" disabled>Public port</option>
          <option v-for="p in availablePorts" :key="p" :value="String(p)">{{ p }}</option>
        </select>
        <span class="fwd-arrow">→</span>
        <select v-model="fwdLocalPort" class="fwd-select">
          <option value="" disabled>Local port</option>
          <option v-for="p in listeningPorts" :key="p" :value="String(p)">{{ p }}</option>
        </select>
        <button class="btn btn-primary btn-sm" :disabled="!fwdPublicPort || !fwdLocalPort" @click="submitForward">Add</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar-btn {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
  border: none;
  height: 28px;
  padding: 0 var(--spacing-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: inherit;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.toolbar-btn:hover {
  background: var(--color-bg-element-hover);
  color: var(--color-text-hover);
}

.toolbar-btn.icon-btn {
  width: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn.icon-btn svg {
  width: 14px;
  height: 14px;
}

.toolbar-btn.icon-btn:not(.active) {
  color: var(--color-accent);
}

.toolbar-btn.icon-btn:not(.active):hover {
  color: var(--color-accent-hover);
}

.toolbar-btn.icon-btn.active {
  color: var(--color-accent);
  background: var(--color-bg-primary);
}

.forward-wrap {
  position: relative;
}

.forward-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--spacing-xs);
  background: var(--color-bg-element);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm);
  min-width: 260px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.forward-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-xxs) 0;
}

.forward-label {
  font-size: var(--font-size-xs);
  font-family: monospace;
  color: var(--color-text-primary);
}

.forward-new {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding-top: var(--spacing-xs);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
}

.fwd-select {
  flex: 1;
  padding: var(--spacing-xxs) var(--spacing-xs);
  background: var(--color-bg-primary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  font-family: monospace;
  cursor: pointer;
}

.fwd-select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.forward-loading {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: var(--spacing-xs) 0;
  text-align: center;
}

.fwd-arrow {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
