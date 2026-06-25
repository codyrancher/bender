import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Toast } from '@/types'

let toastId = 0

export const useUiStore = defineStore('ui', () => {
  const deletePipelineName = ref<string | null>(null)
  const isLoading = ref(true)
  const loadingMessage = ref('Loading pipelines...')
  const toasts = ref<Toast[]>([])
  const sidebarCollapsed = ref(false)
  // Global terminal drawer (slides up from the bottom, persists across pages).
  const terminalOpen = ref(false)

  function showLoading(message: string) {
    loadingMessage.value = message
    isLoading.value = true
  }

  function hideLoading() {
    isLoading.value = false
  }

  function showToast(
    message: string,
    type: 'success' | 'error' | 'info' = 'success',
    options: {
      action?: { label: string; href: string; target?: string }
      copyText?: { label: string; text: string }
      durationMs?: number
    } = {},
  ) {
    const id = ++toastId
    const duration = options.durationMs ?? (options.action || options.copyText ? 10000 : 3000)
    toasts.value.push({ id, message, type, action: options.action, copyText: options.copyText, durationMs: duration })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, duration)
  }

  function openDeletePipelineModal(pipelineName: string) {
    deletePipelineName.value = pipelineName
  }

  function closeDeletePipelineModal() {
    deletePipelineName.value = null
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function toggleTerminal() {
    terminalOpen.value = !terminalOpen.value
  }

  return {
    terminalOpen,
    toggleTerminal,
    deletePipelineName,
    isLoading,
    loadingMessage,
    toasts,
    sidebarCollapsed,
    showLoading,
    hideLoading,
    showToast,
    openDeletePipelineModal,
    closeDeletePipelineModal,
    toggleSidebar,
  }
})
