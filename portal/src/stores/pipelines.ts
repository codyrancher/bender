import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Pipeline } from '@/types'
import { api } from '@/services/api'
import { useUiStore } from './ui'

export const usePipelinesStore = defineStore('pipelines', () => {
  const pipelines = ref<Pipeline[]>([])
  const startingPipelines = ref<Set<string>>(new Set())
  const stoppingPipelines = ref<Set<string>>(new Set())

  const isDraggingPipeline = ref(false)

  let ws: WebSocket | null = null

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
      setTimeout(connectEvents, 3000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function isPipelineDraggable(pipeline: Pipeline): boolean {
    return !pipeline.template
  }

  const currentPipeline = computed(() => (pipelineName: string | null) =>
    pipelineName ? pipelines.value.find((p) => p.name === pipelineName) || null : null,
  )

  async function fetchPipelines() {
    try {
      const data = await api.getPipelines()
      pipelines.value = data.pipelines || []
    } catch (err) {
      console.error('Failed to fetch pipelines:', err)
      pipelines.value = []
    }
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

  async function createPipeline(pipelineName: string, opts?: { pipelineMd?: string; definitionId?: string; template?: string; label?: string; vars?: Record<string, string>; args?: Record<string, string> }) {
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
      // The delete endpoint streams SSE progress; always consume it as a stream
      // (api.deletePipeline's response.json() would choke on the "data:" lines).
      await api.deletePipelineStream(pipelineName, onLog ?? (() => {}))
      startingPipelines.value.delete(pipelineName)
      stoppingPipelines.value.delete(pipelineName)
      await fetchPipelines()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete pipeline'
      ui.showToast(message, 'error')
      throw err
    }
  }

  return {
    pipelines,
    currentPipeline,
    fetchPipelines,
    startPipeline,
    stopPipeline,
    restartPipeline,
    reprovisionPipeline,
    refreshPipelineStatus,
    createPipeline,
    deletePipeline,
    isPipelineStarting,
    isPipelineStopping,
    isPipelineRunning,
    getPipelineBrowserPort,
    getPipelineBrowserHost,
    isPipelineDraggable,
    isDraggingPipeline,
    connectEvents,
  }
})
