<script setup lang="ts">
// The bottom bar's page-navigation buttons (pipelines / definitions / settings).
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GridIcon from '@/assets/icons/grid.svg?component'
import BookIcon from '@/assets/icons/book.svg?component'
import SettingsIcon from '@/assets/icons/settings.svg?component'

const route = useRoute()
const router = useRouter()

const isHome = computed(() => route.name === 'home')
const isDefinitions = computed(() => route.name === 'definitions')
const isSettings = computed(() => route.name === 'settings')
</script>

<template>
  <div class="bottom-actions">
    <button
      class="bottom-icon-btn"
      :class="{ active: isHome }"
      title="Pipelines"
      @click="router.push('/')"
    >
      <GridIcon />
    </button>
    <button
      class="bottom-icon-btn"
      :class="{ active: isDefinitions }"
      title="Pipeline Definitions"
      @click="router.push('/definitions')"
    >
      <BookIcon />
    </button>
    <button
      class="bottom-icon-btn"
      :class="{ active: isSettings }"
      title="Settings"
      @click="router.push('/settings')"
    >
      <SettingsIcon />
    </button>
  </div>
</template>

<style scoped>
.bottom-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
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
