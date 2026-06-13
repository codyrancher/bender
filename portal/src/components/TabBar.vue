<script setup lang="ts">
import { ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import TabBarNav from './TabBarNav.vue'
import SystemStatsBar from './SystemStatsBar.vue'
import PruneModal from './PruneModal.vue'
import TerminalIcon from '@/assets/icons/terminal.svg?component'

const ui = useUiStore()
const showPrune = ref(false)
const statsBar = ref<InstanceType<typeof SystemStatsBar> | null>(null)
</script>

<template>
  <div class="bottom-bar">
    <TabBarNav />

    <!-- Centered terminal toggle: opens the global terminal as a bottom drawer
         so it's reachable on any page without losing the session. -->
    <button
      class="bottom-icon-btn term-toggle"
      :class="{ active: ui.terminalOpen }"
      title="Terminal (global Claude CLI)"
      @click="ui.toggleTerminal()"
    >
      <TerminalIcon />
    </button>

    <SystemStatsBar ref="statsBar" @open-prune="showPrune = true" />
  </div>

  <PruneModal v-model:open="showPrune" @pruned="statsBar?.refresh()" />
</template>

<style scoped>
.bottom-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 100%;
  background: var(--color-bg-secondary);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
  padding: var(--spacing-sm) var(--spacing-md);
  gap: var(--spacing-md);
}

/* Terminal toggle: centered in the bar, independent of the side groups. */
.term-toggle {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.bottom-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.bottom-icon-btn svg {
  width: 16px;
  height: 16px;
}

.bottom-icon-btn:hover {
  background: var(--color-bg-element);
  color: var(--color-text-hover);
}

.bottom-icon-btn.active {
  color: var(--color-accent);
  background: var(--color-bg-element);
}
</style>
