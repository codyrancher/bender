<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import FileTextIcon from '@/assets/icons/file-text.svg?component'

const props = defineProps<{ session: string }>()
const emit = defineEmits<{ (e: 'open-editor'): void }>()

const termEl = ref<HTMLDivElement | null>(null)
const status = ref<'connecting' | 'open' | 'closed'>('connecting')
const uploading = ref(false)
const uploadedFiles = new Set<string>()
const imagePopover = ref<{ name: string; src: string; style: { left: string; top: string } } | null>(null)
const UPLOAD_PREFIX = '/data/cli/workspace/uploads/'
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i

let term: XTerm | null = null
let fit: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObs: ResizeObserver | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function connect() {
  if (!term) return
  status.value = 'connecting'
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/api/cli?session=${encodeURIComponent(props.session)}`)

  ws.onopen = () => {
    status.value = 'open'
    sendResize()
  }
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      term!.write(ev.data.split(UPLOAD_PREFIX).join(''))
    } else if (ev.data instanceof Blob) {
      ev.data.text().then((t) => term!.write(t.split(UPLOAD_PREFIX).join('')))
    }
  }
  ws.onclose = () => {
    status.value = 'closed'
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 1500)
  }
  ws.onerror = () => { try { ws?.close() } catch { /* ignore */ } }
}

function sendResize() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !term) return
  ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
}

function doFit() {
  try {
    fit?.fit()
    sendResize()
  } catch { /* ignore */ }
}

async function uploadFile(file: File | Blob, name?: string): Promise<string | null> {
  const fileName = name || (file instanceof File ? file.name : `screenshot.${(file.type || 'application/octet-stream').split('/')[1] || 'bin'}`)
  try {
    uploading.value = true
    const resp = await fetch('/api/cli/upload', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': fileName,
      },
      body: file,
    })
    if (!resp.ok) throw new Error(await resp.text())
    const data = await resp.json()
    const fullPath = data.path as string
    const fname = fullPath.split('/').pop() || ''
    if (fname) uploadedFiles.add(fname)
    return fullPath
  } catch (err) {
    term?.write(`\r\n\x1b[31m[upload failed: ${err instanceof Error ? err.message : String(err)}]\x1b[0m\r\n`)
    return null
  } finally {
    uploading.value = false
  }
}

function showImagePopover(filename: string, event: MouseEvent) {
  imagePopover.value = {
    name: filename,
    src: `/api/cli/uploads/${encodeURIComponent(filename)}`,
    style: {
      left: `${Math.min(event.clientX, window.innerWidth - 420)}px`,
      top: `${Math.min(event.clientY + 10, window.innerHeight - 350)}px`,
    },
  }
}

function sendInput(text: string) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: text }))
  }
}

async function handleClipboardPaste() {
  try {
    const items = await (navigator.clipboard as any).read()
    for (const item of items) {
      const imageType = item.types.find((t: string) => t.startsWith('image/'))
      if (imageType) {
        const blob = await item.getType(imageType)
        const filePath = await uploadFile(blob)
        if (filePath) sendInput(filePath)
        return
      }
    }
  } catch { /* clipboard.read not supported or permission denied */ }
  try {
    const text = await navigator.clipboard.readText()
    if (text) sendInput(text)
  } catch { /* ignore */ }
}

onMounted(() => {
  if (!termEl.value) return

  term = new XTerm({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 10_000,
    theme: {
      background: '#1a1418',
      foreground: '#ece4e8',
      cursor: '#b068a0',
      selectionBackground: '#3a2e4880',
      black: '#1a1216',
      red: '#e85858',
      green: '#5ba8a0',
      yellow: '#e88060',
      blue: '#7088a8',
      magenta: '#b068a0',
      cyan: '#5ba8a0',
      white: '#ece4e8',
      brightBlack: '#4a3e48',
      brightRed: '#f09878',
      brightGreen: '#78c0b8',
      brightYellow: '#f0a080',
      brightBlue: '#90a8c8',
      brightMagenta: '#c880b8',
      brightCyan: '#78c0b8',
      brightWhite: '#ffffff',
    },
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termEl.value)
  doFit()

  term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type === 'keydown' && event.key === 'v' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      handleClipboardPaste()
      return false
    }
    return true
  })

  const UPLOAD_RE = /\w[\w-]*-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.(png|jpe?g|gif|webp|svg|bmp)/gi
  term.registerLinkProvider({
    provideLinks(y: number, callback: (links: any[] | undefined) => void) {
      const line = term!.buffer.active.getLine(y - 1)
      if (!line) { callback(undefined); return }
      const text = line.translateToString()
      const links: any[] = []
      let m: RegExpExecArray | null
      UPLOAD_RE.lastIndex = 0
      while ((m = UPLOAD_RE.exec(text)) !== null) {
        const name = m[0]
        links.push({
          range: { start: { x: m.index + 1, y }, end: { x: m.index + name.length, y } },
          text: name,
          decorations: { pointerCursor: true, underline: true },
          activate: (e: MouseEvent, t: string) => showImagePopover(t, e),
        })
      }
      for (const name of uploadedFiles) {
        if (!IMG_EXT.test(name) || text.indexOf(name) === -1) continue
        if (links.some((l: any) => l.text === name)) continue
        let i = 0
        while ((i = text.indexOf(name, i)) !== -1) {
          links.push({
            range: { start: { x: i + 1, y }, end: { x: i + name.length, y } },
            text: name,
            decorations: { pointerCursor: true, underline: true },
            activate: (e: MouseEvent, t: string) => showImagePopover(t, e),
          })
          i++
        }
      }
      callback(links.length ? links : undefined)
    },
  })

  term.onData((data) => {
    // Forward everything (including mouse events) so tmux mouse mode can scroll
    // the wheel through its scrollback.
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }))
    }
  })

  resizeObs = new ResizeObserver(doFit)
  resizeObs.observe(termEl.value)

  connect()
})

onBeforeUnmount(() => {
  resizeObs?.disconnect()
  if (reconnectTimer) clearTimeout(reconnectTimer)
  try { ws?.close() } catch { /* ignore */ }
  try { term?.dispose() } catch { /* ignore */ }
  term = null
  ws = null
})

// Parent calls this when this terminal's tab becomes active — xterm can't
// measure itself while hidden (v-show), so re-fit + focus on show.
defineExpose({
  fit: () => { doFit(); term?.focus() },
})
</script>

<template>
  <div class="terminal">
    <div class="terminal-header">
      <span class="status" :class="status">{{ status }}</span>
      <span v-if="uploading" class="upload-badge">uploading...</span>
      <button class="md-btn" title="Edit CLAUDE.md" @click="emit('open-editor')">
        <FileTextIcon />
        <span>CLAUDE.md</span>
      </button>
    </div>
    <div class="term-wrapper">
      <div ref="termEl" class="term-host"></div>
    </div>

    <Teleport to="body">
      <div v-if="imagePopover" class="img-backdrop" @click="imagePopover = null">
        <div class="img-popover" :style="imagePopover.style" @click.stop>
          <div class="img-popover-header">
            <span class="img-popover-name">{{ imagePopover.name }}</span>
            <button class="img-popover-close" @click="imagePopover = null">&times;</button>
          </div>
          <img :src="imagePopover.src" :alt="imagePopover.name" class="img-popover-img" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.terminal {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1a1418;
  min-height: 0;
  min-width: 0;
}

.terminal-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  height: var(--size-header-height);
  padding: 0 var(--spacing-lg);
  background: var(--color-bg-secondary);
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
  flex-shrink: 0;
}

.title {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.status {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status.connecting {
  background: var(--color-bg-element);
  color: var(--color-text-muted);
}

.status.open {
  background: #2a3a38;
  color: #78c0b8;
}

.status.closed {
  background: #3a2228;
  color: #e85858;
}

.upload-badge {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: var(--color-bg-element);
  color: var(--color-accent);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.term-wrapper {
  flex: 1;
  min-height: 0;
  min-width: 0;
  position: relative;
}

.term-host {
  height: 100%;
  width: 100%;
  padding: 4px 0 0 4px;
  overflow: hidden;
}

.term-host :deep(.xterm) {
  height: 100%;
  width: 100%;
}

.term-host :deep(.xterm-viewport) {
  background: transparent !important;
}

.term-host :deep(.xterm-viewport::-webkit-scrollbar) {
  width: 8px;
}

.term-host :deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}

.term-host :deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background: var(--color-bg-element);
  border-radius: 4px;
}

.term-host :deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background: var(--color-bg-element-hover);
}

.img-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.img-popover {
  position: fixed;
  background: var(--color-bg-secondary);
  border: var(--border-width-sm) solid var(--color-border-dark);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px var(--color-shadow-dark);
  overflow: hidden;
  max-width: 400px;
}

.img-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: var(--border-width-sm) solid var(--color-border-dark);
}

.img-popover-name {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.img-popover-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.img-popover-close:hover {
  color: var(--color-text-hover);
}

.img-popover-img {
  display: block;
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
}

.md-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  height: 26px;
  padding: 0 var(--spacing-sm);
  background: var(--color-bg-element);
  color: var(--color-text-muted);
  border: none;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.md-btn svg {
  width: 13px;
  height: 13px;
}

.md-btn:hover {
  background: var(--color-bg-element-hover);
  color: var(--color-text-hover);
}
</style>
