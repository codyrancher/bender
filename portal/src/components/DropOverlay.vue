<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { api } from '@/services/api'
import { getPipelineIdFromRoute } from '@/router'

const route = useRoute()
const uiStore = useUiStore()
const dragCounter = ref(0)

const currentPipelineId = computed(() => getPipelineIdFromRoute(route))

async function handleImageDrop(file: File) {
  if (!file.type.startsWith('image/')) {
    uiStore.showToast('Only image files are supported', 'error')
    return
  }

  if (!currentPipelineId.value) {
    uiStore.showToast('No project selected', 'error')
    return
  }

  uiStore.showToast('Uploading image...', 'success')

  try {
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const result = await api.uploadImage(
      currentPipelineId.value,
      base64Data,
      file.name
    )

    uiStore.showToast(`Image saved to ${result.path}`, 'success')
  } catch (err) {
    console.error('Failed to upload image:', err)
    uiStore.showToast(
      'Failed to upload: ' + (err instanceof Error ? err.message : 'Unknown error'),
      'error'
    )
  }
}

function handleDragEnter(e: DragEvent) {
  dragCounter.value++
  if (e.dataTransfer?.types.includes('Files')) {
    uiStore.setDragging(true)
  }
}

function handleDragLeave() {
  dragCounter.value--
  if (dragCounter.value <= 0) {
    dragCounter.value = 0
    uiStore.setDragging(false)
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragCounter.value = 0
  uiStore.setDragging(false)

  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    handleImageDrop(files[0])
  } else {
    const items = e.dataTransfer?.items
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            handleImageDrop(file)
            break
          }
        }
      }
    }
  }
}

function handleWindowDrop(e: DragEvent) {
  e.preventDefault()
  dragCounter.value = 0
  uiStore.setDragging(false)
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) {
        handleImageDrop(file)
      }
      break
    }
  }
}

function handleOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    uiStore.setDragging(false)
  }
}

onMounted(() => {
  window.addEventListener('dragenter', handleDragEnter)
  window.addEventListener('dragleave', handleDragLeave)
  window.addEventListener('dragover', handleDragOver)
  window.addEventListener('drop', handleWindowDrop)
  document.addEventListener('paste', handlePaste)
})

onUnmounted(() => {
  window.removeEventListener('dragenter', handleDragEnter)
  window.removeEventListener('dragleave', handleDragLeave)
  window.removeEventListener('dragover', handleDragOver)
  window.removeEventListener('drop', handleWindowDrop)
  document.removeEventListener('paste', handlePaste)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="uiStore.isDragging"
      class="drop-overlay"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @click="handleOverlayClick"
    >
      <div class="drop-zone">
        <span class="drop-overlay-text">Drop image to upload to project</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drop-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay-drop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.drop-zone {
  border: var(--border-width-md) dashed var(--color-accent);
  border-radius: var(--radius-xl);
  padding: 60px 80px;
  background: var(--color-drop-zone-bg);
}

.drop-overlay-text {
  background: var(--color-bg-secondary);
  color: var(--color-accent);
  padding: var(--spacing-lg) var(--spacing-xxl);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-lg);
  font-weight: 500;
}
</style>
