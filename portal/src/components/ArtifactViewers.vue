<script setup lang="ts">
// The full-viewport artifact overlays (diff / file / video / image). Owns their
// open state; the page calls the exposed open* methods (e.g. from a stage modal
// emit) and this renders the right overlay on top of everything.
import { ref } from 'vue'
import type { Artifact } from '@/types'
import DiffViewer from './primitives/DiffViewer.vue'
import FileViewer from './primitives/FileViewer.vue'
import ViewportOverlay from './primitives/ViewportOverlay.vue'

const diff = ref<{ commits: Artifact[]; index: number } | null>(null)
const file = ref<{ url: string; name: string; subtitle?: string } | null>(null)
const video = ref<{ url: string; name: string } | null>(null)
const image = ref<{ url: string; name: string } | null>(null)

defineExpose({
  openDiff: (payload: { commits: Artifact[]; index: number }) => { diff.value = payload },
  openFile: (payload: { url: string; name: string; subtitle?: string }) => { file.value = payload },
  openVideo: (payload: { url: string; name: string }) => { video.value = payload },
  openImage: (payload: { url: string; name: string }) => { image.value = payload },
})
</script>

<template>
  <!-- local diff viewer (GitHub-PR style) -->
  <DiffViewer
    v-if="diff"
    :commits="diff.commits"
    :initial-index="diff.index"
    @close="diff = null"
  />

  <!-- file viewer (syntax-highlighted, full viewport) -->
  <FileViewer
    v-if="file"
    :url="file.url"
    :name="file.name"
    :subtitle="file.subtitle"
    @close="file = null"
  />

  <!-- video filling the browser viewport -->
  <ViewportOverlay v-if="video" :title="video.name" @close="video = null">
    <video class="vp-video" :src="video.url" controls autoplay></video>
  </ViewportOverlay>

  <!-- screenshot / photo filling the browser viewport -->
  <ViewportOverlay v-if="image" :title="image.name" @close="image = null">
    <template #actions>
      <a class="vp-raw" :href="image.url" target="_blank" rel="noopener">Open raw ↗</a>
    </template>
    <div class="vp-image-wrap">
      <img class="vp-image" :src="image.url" :alt="image.name" />
    </div>
  </ViewportOverlay>
</template>

<style scoped>
.vp-video {
  flex: 1;
  min-height: 0;
  width: 100%;
  object-fit: contain;
  background: #000;
}

.vp-image-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}

.vp-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.vp-raw {
  font-size: 12px;
  color: var(--color-text-muted);
  text-decoration: none;
}

.vp-raw:hover {
  color: var(--color-accent);
}
</style>
