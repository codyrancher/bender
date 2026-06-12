<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'
import ViewportOverlay from './ViewportOverlay.vue'

const props = defineProps<{
  name: string
  url: string
  subtitle?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const raw = ref('')
const loading = ref(false)
const error = ref('')

const language = computed(() => {
  const n = props.name.toLowerCase()
  if (n.endsWith('.json') || n.endsWith('.sarif')) return 'json'
  if (n.endsWith('.md')) return 'markdown'
  if (n.endsWith('.xml') || n.endsWith('.svg') || n.endsWith('.html')) return 'xml'
  if (n.endsWith('.yaml') || n.endsWith('.yml')) return 'yaml'
  return 'plaintext'
})

const highlighted = computed(() => {
  if (!raw.value) return ''
  try {
    return hljs.highlight(raw.value, { language: language.value, ignoreIllegals: true }).value
  } catch {
    return hljs.highlightAuto(raw.value).value
  }
})

const lineCount = computed(() => (raw.value ? raw.value.replace(/\n$/, '').split('\n').length : 0))

watch(() => props.url, load, { immediate: true })

async function load() {
  raw.value = ''
  error.value = ''
  loading.value = true
  try {
    const resp = await fetch(props.url)
    raw.value = await resp.text()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load file'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <ViewportOverlay @close="emit('close')">
    <template #title>
      <span class="file-name">{{ name }}</span>
      <span class="file-lang">{{ language }}</span>
      <span v-if="subtitle" class="file-subtitle">{{ subtitle }}</span>
      <span v-else-if="lineCount" class="file-lines">{{ lineCount }} lines</span>
    </template>
    <template #actions>
      <a class="file-raw" :href="url" target="_blank" rel="noopener">Open raw ↗</a>
    </template>

    <div class="file-body">
      <div v-if="loading" class="file-state">Loading…</div>
      <div v-else-if="error" class="file-state error">{{ error }}</div>
      <div v-else class="code-scroll">
        <div class="gutter">
          <div v-for="n in lineCount" :key="n" class="gln">{{ n }}</div>
        </div>
        <pre class="code"><code class="hljs" v-html="highlighted"></code></pre>
      </div>
    </div>
  </ViewportOverlay>
</template>

<style scoped>
.file-name {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.file-lang {
  font-size: 11px;
  color: var(--color-accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.file-lines,
.file-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
}

.file-raw {
  font-size: 12px;
  color: var(--color-text-muted);
  text-decoration: none;
}

.file-raw:hover {
  color: var(--color-accent);
}

.file-body {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.file-state {
  margin: auto;
  color: var(--color-text-muted);
  font-size: 14px;
}

.file-state.error { color: var(--color-error); }

.code-scroll {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
}

.gutter {
  flex-shrink: 0;
  padding: 16px 0;
  text-align: right;
  user-select: none;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border-dark);
  position: sticky;
  left: 0;
}

.gln {
  padding: 0 14px;
  color: var(--color-text-muted);
  opacity: 0.5;
}

.code {
  margin: 0;
  padding: 16px 0;
  flex: 1;
}

.code :deep(code.hljs) {
  display: block;
  padding: 0 20px;
  background: transparent;
  white-space: pre;
}
</style>
