<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/services/api'
import { useUiStore } from '@/stores/ui'
import type { PortRange, PortAllocation } from '@/types'
import InsightsPanel from '../components/InsightsPanel.vue'
import ExtensionStatusPanel from '../components/ExtensionStatusPanel.vue'
import PortSettings from '../components/PortSettings.vue'

const uiStore = useUiStore()

const externalIp = ref('')
const portRange = ref<PortRange>({ start: 8200, end: 8299 })
const allocations = ref<PortAllocation[]>([])
const loading = ref(true)

async function fetchSettings() {
  try {
    const data = await api.getSettings()
    portRange.value = data.portRange
    allocations.value = data.allocations
    externalIp.value = data.externalIp
  } catch (err) {
    uiStore.showToast('Failed to load settings', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(fetchSettings)
</script>

<template>
  <div class="settings-page">
    <div class="settings-content">
      <h1>Settings</h1>

      <div v-if="loading" class="loading">Loading settings...</div>

      <template v-else>
        <ExtensionStatusPanel />

        <section class="section">
          <h2>External IP</h2>
          <p class="description">
            The public IP address of this network.
          </p>
          <div class="info-display">
            <span class="info-value">{{ externalIp }}</span>
          </div>
        </section>

        <PortSettings :port-range="portRange" :allocations="allocations" @changed="fetchSettings" />
      </template>
    </div>

    <div class="insights-wrap">
      <h2 class="insights-title">Insights</h2>
      <InsightsPanel />
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  flex: 1;
  overflow-y: auto;
  background: var(--color-bg-primary);
  /* Shared column width — Settings + Insights line up in one centered column. */
  --content-width: 1000px;
}

.insights-wrap {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: var(--spacing-xl) var(--spacing-lg) var(--spacing-xxl);
  border-top: var(--border-width-sm) solid var(--color-border-dark);
}

.insights-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin-bottom: var(--spacing-lg);
}

.settings-content {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: var(--spacing-xl) var(--spacing-lg);
}

h1 {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-xl);
}

.section {
  margin-bottom: var(--spacing-xl);
}

h2 {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-xs);
}

.description {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}

.loading {
  color: var(--color-text-muted);
  padding: var(--spacing-xl);
  text-align: center;
}

.info-display {
  background: var(--color-bg-element);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.info-value {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
}
</style>
