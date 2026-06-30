<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'
import MarkdownIt from 'markdown-it'
import ViewportOverlay from './ViewportOverlay.vue'
import { copyText } from '@/utils/clipboard'

const props = defineProps<{
  name: string
  url: string
  subtitle?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const raw = ref('')
const loading = ref(false)
const error = ref('')

// html:false escapes any raw HTML in the source, so agent-produced markdown
// can't inject scripts. Fenced code reuses highlight.js.
const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch { /* fall through */ }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  },
})

// Wrap code blocks and blockquotes so each gets a hover "Copy" button. The
// button copies the block's text (handled by onMdClick via event delegation).
const COPY_BTN = '<button class="md-copy" type="button" title="Copy" aria-label="Copy">Copy</button>'
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) =>
  `<div class="md-block">${COPY_BTN}${defaultFence(tokens, idx, options, env, self)}</div>`
const defaultCodeBlock = md.renderer.rules.code_block!
md.renderer.rules.code_block = (tokens, idx, options, env, self) =>
  `<div class="md-block">${COPY_BTN}${defaultCodeBlock(tokens, idx, options, env, self)}</div>`
md.renderer.rules.blockquote_open = () => `<div class="md-block">${COPY_BTN}<blockquote>`
md.renderer.rules.blockquote_close = () => '</blockquote></div>'

function onMdClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.md-copy') as HTMLElement | null
  if (!btn) return
  const src = btn.closest('.md-block')?.querySelector('blockquote, pre') as HTMLElement | null
  if (!src) return
  copyText((src.innerText || src.textContent || '').trim()).then((ok) => {
    if (!ok) return
    const prev = btn.textContent
    btn.textContent = 'Copied'
    btn.classList.add('copied')
    setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied') }, 1400)
  })
}

const isMarkdown = computed(() => /\.(md|markdown)$/i.test(props.name))
// Markdown defaults to the rendered view; toggle to see the raw source.
const mode = ref<'rendered' | 'raw'>('rendered')
const showRendered = computed(() => isMarkdown.value && mode.value === 'rendered')
const renderedHtml = computed(() => (showRendered.value ? md.render(raw.value || '') : ''))

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
      <div v-if="isMarkdown" class="fv-toggle">
        <button :class="{ active: mode === 'rendered' }" @click="mode = 'rendered'">Rendered</button>
        <button :class="{ active: mode === 'raw' }" @click="mode = 'raw'">Raw</button>
      </div>
      <a class="file-raw" :href="url" target="_blank" rel="noopener">Open raw ↗</a>
    </template>

    <div class="file-body">
      <div v-if="loading" class="file-state">Loading…</div>
      <div v-else-if="error" class="file-state error">{{ error }}</div>
      <div v-else-if="showRendered" class="md-scroll">
        <div class="markdown-body" v-html="renderedHtml" @click="onMdClick"></div>
      </div>
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

/* Rendered/Raw toggle (markdown only) */
.fv-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  overflow: hidden;
}
.fv-toggle button {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: 11px;
  padding: 3px 10px;
  cursor: pointer;
}
.fv-toggle button.active {
  background: var(--color-accent);
  color: var(--color-text-bright);
}

/* Rendered markdown */
.md-scroll {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
}
.markdown-body {
  width: 100%;
  max-width: 860px;
  padding: 28px 32px 60px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--color-text-primary);
}
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) { font-weight: 600; line-height: 1.3; margin: 1.4em 0 0.6em; }
.markdown-body :deep(h1) { font-size: 1.7em; border-bottom: 1px solid var(--color-border-dark); padding-bottom: 0.3em; }
.markdown-body :deep(h2) { font-size: 1.4em; border-bottom: 1px solid var(--color-border-dark); padding-bottom: 0.25em; }
.markdown-body :deep(h3) { font-size: 1.2em; }
.markdown-body :deep(h4) { font-size: 1.05em; }
.markdown-body :deep(p) { margin: 0.7em 0; }
.markdown-body :deep(a) { color: var(--color-accent); text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }
.markdown-body :deep(ul),
.markdown-body :deep(ol) { margin: 0.7em 0; padding-left: 1.6em; }
.markdown-body :deep(li) { margin: 0.25em 0; }
.markdown-body :deep(code) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: var(--color-bg-element);
  border-radius: 4px;
  padding: 0.15em 0.4em;
}
.markdown-body :deep(pre) {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  padding: 14px 16px;
  overflow: auto;
  margin: 0.9em 0;
}
.markdown-body :deep(pre code) { background: transparent; padding: 0; font-size: 13px; }
.markdown-body :deep(blockquote) {
  margin: 0.9em 0;
  padding: 0.2em 1em;
  border-left: 3px solid var(--color-border-medium);
  color: var(--color-text-muted);
}
.markdown-body :deep(table) { border-collapse: collapse; margin: 0.9em 0; display: block; overflow: auto; }
.markdown-body :deep(th),
.markdown-body :deep(td) { border: 1px solid var(--color-border-dark); padding: 6px 12px; }
.markdown-body :deep(th) { background: var(--color-bg-secondary); font-weight: 600; }
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--color-border-dark); margin: 1.5em 0; }
.markdown-body :deep(img) { max-width: 100%; border-radius: 6px; }
.markdown-body :deep(:first-child) { margin-top: 0; }

/* Copy buttons on code blocks + blockquotes */
.markdown-body :deep(.md-block) { position: relative; }
.markdown-body :deep(.md-block > blockquote),
.markdown-body :deep(.md-block > pre) { margin: 0.9em 0; }
.markdown-body :deep(.md-copy) {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border-medium);
  background: var(--color-bg-element);
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, color 0.12s, border-color 0.12s;
}
.markdown-body :deep(.md-block:hover) .md-copy { opacity: 1; }
.markdown-body :deep(.md-copy:hover) { color: var(--color-text-primary); border-color: var(--color-accent); }
.markdown-body :deep(.md-copy.copied) {
  opacity: 1;
  color: var(--color-status-success);
  border-color: var(--color-status-success);
}
</style>
