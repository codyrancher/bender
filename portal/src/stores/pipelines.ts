import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Pipeline, PipelineGroup, HarnessStatus } from '@/types'
import { api } from '@/services/api'
import { useUiStore } from './ui'

const OVERRIDES_KEY = 'pipeline-group-overrides'
const COLLAPSED_KEY = 'pipeline-groups-collapsed'

const GROUP_DEFS: { id: PipelineGroup; label: string }[] = [
  { id: 'harness', label: 'Harness' },
  { id: 'blank', label: 'Blank' },
  { id: 'vue3', label: 'Vue 3' },
  { id: 'rancher', label: 'Rancher' },
]

export const usePipelinesStore = defineStore('pipelines', () => {
  const pipelines = ref<Pipeline[]>([])
  const loadedIframes = ref<Set<string>>(new Set())
  const startingPipelines = ref<Set<string>>(new Set())
  const stoppingPipelines = ref<Set<string>>(new Set())

  const groupOverrides = ref<Record<string, PipelineGroup>>(
    JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'),
  )
  const collapsedGroups = ref<Record<string, boolean>>(
    JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}'),
  )
  const isDraggingPipeline = ref(false)

  const harnessStatus = ref<HarnessStatus>({
    devRunning: false,
    devContainerStatus: 'not_found',
    devApiStatus: 'not_found',
    sourceExists: false,
  })
  const harnessOperationActive = ref(false)
  const harnessLogs = ref<string[]>([])

  const portForwards = ref<Array<{ publicPort: number; localPort: number; pipeline: string }>>([])

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connectEvents() {
    if (ws) return
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/api/events`)

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'pipelines-changed') {
          fetchPipelines()
        }
      } catch {}
    }

    ws.onclose = () => {
      ws = null
      reconnectTimer = setTimeout(connectEvents, 3000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function disconnectEvents() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
  }

  watch(groupOverrides, (val) => {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(val))
  }, { deep: true })

  watch(collapsedGroups, (val) => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(val))
  }, { deep: true })

  function getPipelineGroup(pipeline: Pipeline): PipelineGroup {
    if (groupOverrides.value[pipeline.name]) {
      return groupOverrides.value[pipeline.name]
    }
    switch (pipeline.template) {
      case 'rancher-dashboard': return 'rancher'
      case 'vue3-hello-world': return 'vue3'
      default: return 'blank'
    }
  }

  const groupedPipelines = computed(() => {
    return GROUP_DEFS.map((def) => ({
      ...def,
      pipelines: pipelines.value
        .filter((p) => getPipelineGroup(p) === def.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
  })

  function isGroupCollapsed(group: PipelineGroup): boolean {
    return collapsedGroups.value[group] ?? false
  }

  function toggleGroupCollapsed(group: PipelineGroup) {
    collapsedGroups.value = {
      ...collapsedGroups.value,
      [group]: !isGroupCollapsed(group),
    }
  }

  function setPipelineGroupOverride(pipelineName: string, group: PipelineGroup) {
    const pl = pipelines.value.find((p) => p.name === pipelineName)
    if (!pl || pl.template) return
    groupOverrides.value = { ...groupOverrides.value, [pipelineName]: group }
  }

  function isPipelineDraggable(pipeline: Pipeline): boolean {
    return !pipeline.template
  }

  function cleanupOverrides() {
    const pipelineNames = new Set(pipelines.value.map((p) => p.name))
    const cleaned = Object.fromEntries(
      Object.entries(groupOverrides.value).filter(([name]) => pipelineNames.has(name)),
    )
    if (Object.keys(cleaned).length !== Object.keys(groupOverrides.value).length) {
      groupOverrides.value = cleaned
    }
  }

  const currentPipeline = computed(() => (pipelineName: string | null) =>
    pipelineName ? pipelines.value.find((p) => p.name === pipelineName) || null : null,
  )

  async function fetchPipelines() {
    try {
      const data = await api.getPipelines()
      pipelines.value = data.pipelines || []
      cleanupOverrides()
    } catch (err) {
      console.error('Failed to fetch pipelines:', err)
      pipelines.value = []
    }
  }

  async function loadPipeline(pipelineName: string) {
    const ui = useUiStore()
    const pl = pipelines.value.find((p) => p.name === pipelineName)
    if (!pl) return false

    loadedIframes.value.add(pipelineName)
    ui.hideLoading()
    return true
  }

  function isPipelineStarting(pipelineName: string) {
    return startingPipelines.value.has(pipelineName)
  }

  function isPipelineStopping(pipelineName: string) {
    return stoppingPipelines.value.has(pipelineName)
  }

  function isPipelineRunning(pipelineName: string) {
    const pl = pipelines.value.find((p) => p.name === pipelineName)
    return pl?.status === 'running'
  }

  function getPipelineBrowserPort(pipelineName: string): number | undefined {
    const pl = pipelines.value.find((p) => p.name === pipelineName)
    return pl?.browserPort
  }

  function getPipelineBrowserHost(pipelineName: string): string | undefined {
    const pl = pipelines.value.find((p) => p.name === pipelineName)
    return pl?.browserHost
  }

  async function startPipeline(pipelineName: string) {
    const ui = useUiStore()
    try {
      startingPipelines.value.add(pipelineName)
      await api.startPipeline(pipelineName)
      await new Promise((resolve) => setTimeout(resolve, 5000))
      await refreshPipelineStatus(pipelineName)
    } catch (err) {
      console.error('Failed to start pipeline:', err)
      ui.showToast('Failed to start pipeline', 'error')
    } finally {
      startingPipelines.value.delete(pipelineName)
    }
  }

  async function stopPipeline(pipelineName: string) {
    const ui = useUiStore()
    try {
      stoppingPipelines.value.add(pipelineName)
      await api.stopPipeline(pipelineName)
      await refreshPipelineStatus(pipelineName)
      loadedIframes.value.delete(pipelineName)
    } catch (err) {
      console.error('Failed to stop pipeline:', err)
      ui.showToast('Failed to stop pipeline', 'error')
    } finally {
      stoppingPipelines.value.delete(pipelineName)
    }
  }

  async function restartPipeline(pipelineName: string) {
    const ui = useUiStore()
    try {
      await api.restartPipeline(pipelineName)
      await new Promise((resolve) => setTimeout(resolve, 5000))
      loadedIframes.value.delete(pipelineName)
      loadedIframes.value.add(pipelineName)
    } catch (err) {
      console.error('Failed to restart pipeline:', err)
      ui.showToast('Failed to restart pipeline', 'error')
    }
  }

  async function reprovisionPipeline(pipelineName: string) {
    const ui = useUiStore()
    try {
      await api.reprovisionPipeline(pipelineName)
      ui.showToast('Sidecars reprovisioned', 'success')
    } catch (err) {
      console.error('Failed to reprovision pipeline:', err)
      ui.showToast('Failed to reprovision sidecars', 'error')
    }
  }

  async function refreshPipelineStatus(pipelineName: string) {
    try {
      const data = await api.getStatus(pipelineName)
      const pl = pipelines.value.find((p) => p.name === pipelineName)
      if (pl) {
        pl.status = data.status
      }
    } catch (err) {
      console.error('Failed to refresh status:', err)
    }
  }

  async function createPipeline(pipelineName: string, opts?: { pipelineMd?: string; definitionId?: string; template?: string; vars?: Record<string, string> }) {
    const ui = useUiStore()
    try {
      startingPipelines.value.add(pipelineName)
      await api.createPipeline(pipelineName, opts)
      await fetchPipelines()
      waitForPipelineReady(pipelineName)
      return true
    } catch (err) {
      startingPipelines.value.delete(pipelineName)
      const message = err instanceof Error ? err.message : 'Failed to create pipeline'
      ui.showToast(message, 'error')
      throw err
    }
  }

  async function waitForPipelineReady(pipelineName: string) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      await refreshPipelineStatus(pipelineName)
    } finally {
      startingPipelines.value.delete(pipelineName)
    }
  }

  async function deletePipeline(pipelineName: string, onLog?: (message: string) => void) {
    const ui = useUiStore()
    try {
      if (onLog) {
        await api.deletePipelineStream(pipelineName, onLog)
      } else {
        await api.deletePipeline(pipelineName)
      }
      loadedIframes.value.delete(pipelineName)
      startingPipelines.value.delete(pipelineName)
      stoppingPipelines.value.delete(pipelineName)
      await fetchPipelines()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete pipeline'
      ui.showToast(message, 'error')
      throw err
    }
  }

  function isIframeLoaded(pipelineName: string) {
    return loadedIframes.value.has(pipelineName)
  }

  async function fetchHarnessStatus() {
    try {
      harnessStatus.value = await api.getHarnessStatus()
    } catch (err) {
      console.error('Failed to fetch harness status:', err)
    }
  }

  async function harnessAction(action: 'start' | 'rebuild' | 'promote' | 'abandon') {
    const ui = useUiStore()
    harnessOperationActive.value = true
    harnessLogs.value = []
    try {
      await api.harnessStream(action, (msg) => {
        harnessLogs.value.push(msg)
      })
      await fetchHarnessStatus()
      if (action === 'start') {
        loadedIframes.value.add('bender-dev')
      } else if (action === 'promote' || action === 'abandon') {
        loadedIframes.value.delete('bender-dev')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `Harness ${action} failed`
      ui.showToast(message, 'error')
    } finally {
      harnessOperationActive.value = false
    }
  }

  async function fetchPortForwards() {
    try {
      const data = await api.getForwards()
      portForwards.value = data.forwards
    } catch (err) {
      console.error('Failed to fetch port forwards:', err)
    }
  }

  async function startPortForward(pipelineName: string, publicPort: number, localPort: number) {
    const ui = useUiStore()
    try {
      await api.startForward(pipelineName, publicPort, localPort)
      await fetchPortForwards()
      ui.showToast(`Forwarding :${publicPort} → ${pipelineName}:${localPort}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Port forward failed'
      ui.showToast(message, 'error')
    }
  }

  async function stopPortForward(publicPort: number) {
    const ui = useUiStore()
    try {
      await api.stopForward(publicPort)
      await fetchPortForwards()
      ui.showToast(`Stopped forward on :${publicPort}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop forward'
      ui.showToast(message, 'error')
    }
  }

  return {
    pipelines,
    currentPipeline,
    fetchPipelines,
    loadPipeline,
    startPipeline,
    stopPipeline,
    restartPipeline,
    reprovisionPipeline,
    refreshPipelineStatus,
    createPipeline,
    deletePipeline,
    isIframeLoaded,
    isPipelineStarting,
    isPipelineStopping,
    isPipelineRunning,
    getPipelineBrowserPort,
    getPipelineBrowserHost,
    groupedPipelines,
    isGroupCollapsed,
    toggleGroupCollapsed,
    setPipelineGroupOverride,
    isPipelineDraggable,
    isDraggingPipeline,
    harnessStatus,
    harnessOperationActive,
    harnessLogs,
    fetchHarnessStatus,
    harnessAction,
    portForwards,
    fetchPortForwards,
    startPortForward,
    stopPortForward,
    connectEvents,
    disconnectEvents,
  }
})
