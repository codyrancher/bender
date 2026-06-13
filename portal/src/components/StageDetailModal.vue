<script setup lang="ts">
// Stage detail modal: skill/description/criteria, status, live-browser stream,
// timing, logs, and artifacts for a selected stage. Artifact "open" actions are
// emitted as payloads — the page renders the full-viewport viewers.
import { ref, computed, watch, nextTick } from 'vue'
import { usePipelinesStore } from '@/stores/pipelines'
import { getBrowserUrl } from '@/services/urls'
import type { PipelineStage, PipelineStageRecord, PipelineRun, Artifact } from '@/types'
import Modal from './primitives/Modal.vue'
import MaximizeIcon from '@/assets/icons/maximize.svg?component'
import EyeIcon from '@/assets/icons/eye.svg?component'
import PencilIcon from '@/assets/icons/pencil.svg?component'
import {
  formatSize, formatDateTime, stageStatusColor, stageStatusIcon, liveStageDuration, runNo,
} from '@/utils/pipelineFormat'

interface StageDetailData {
  pipeline: string
  stageIndex: number
  defStage?: PipelineStage
  record: PipelineStageRecord | null
  run: PipelineRun | null
}

const props = defineProps<{ detail: StageDetailData; now: number }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit-skill', skill: string): void
  (e: 'open-file', payload: { url: string; name: string; subtitle?: string }): void
  (e: 'open-image', payload: { url: string; name: string }): void
  (e: 'open-video', payload: { url: string; name: string }): void
  (e: 'open-diff', payload: { commits: Artifact[]; index: number }): void
}>()

const pipelinesStore = usePipelinesStore()

const artifacts = computed<Artifact[]>(() => {
  const raw = props.detail.record?.artifacts
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})

// Live browser view: the agent drives the project's browser sidecar over CDP,
// and that same browser streams its screen — embedding it shows the agent live.
const showLiveBrowser = ref(false)
const liveBrowserUrl = computed(() => {
  const name = props.detail.pipeline
  const port = pipelinesStore.getPipelineBrowserPort(name)
  if (!port) return ''
  return getBrowserUrl(name, port, pipelinesStore.getPipelineBrowserHost(name))
})
const canWatchLiveBrowser = computed(() =>
  !!liveBrowserUrl.value && props.detail.record?.status === 'running',
)

// Reset the live-browser toggle only when the *selected stage* changes — not on
// every data refresh from polling (which re-creates the detail object).
watch(() => [props.detail.pipeline, props.detail.stageIndex], () => {
  showLiveBrowser.value = false
})

function viewSkillSnapshot() {
  const d = props.detail
  if (!d.run) return
  emit('open-file', {
    name: 'SKILL.md',
    url: `/api/pipelines/${d.pipeline}/runs/${d.run.id}/stages/${d.stageIndex}/skill-md`,
    subtitle: `${d.defStage?.skill || d.record?.skill} · run #${runNo(d.run)} · read-only snapshot`,
  })
}

function openFile(art: Artifact) {
  if (art.url) emit('open-file', { url: art.url, name: art.name })
}

function openImage(art: Artifact) {
  if (art.url) emit('open-image', { url: art.url, name: art.name })
}

function openDiff(art: Artifact) {
  const commits = artifacts.value.filter(a => a.type === 'commit')
  const index = Math.max(0, commits.findIndex(c => c.url === art.url))
  emit('open-diff', { commits, index })
}

// Keep the log view pinned to the newest line as logs stream in.
const logsEl = ref<HTMLElement | null>(null)
watch(() => props.detail.record?.logs, () => {
  nextTick(() => {
    if (logsEl.value) logsEl.value.scrollTop = logsEl.value.scrollHeight
  })
})
</script>

<template>
  <Modal @close="emit('close')">
    <template #title>
      <h3 class="detail-title-h">{{ detail.defStage?.name || detail.record?.stage_name }}</h3>
      <span class="detail-pipeline">{{ detail.pipeline }}<template v-if="detail.run"> · run #{{ runNo(detail.run) }}</template></span>
    </template>

    <div class="detail-body">
      <div class="detail-section">
        <div class="detail-label">Skill</div>
        <div class="detail-skill-row">
          <span class="detail-value">{{ detail.defStage?.skill || detail.record?.skill }}</span>
          <div class="detail-skill-actions">
            <button
              v-if="detail.run"
              class="btn-edit-skill"
              title="View SKILL.md as it was for this run"
              @click="viewSkillSnapshot"
            >
              <EyeIcon width="12" height="12" />
              View at run time
            </button>
            <button
              class="btn-edit-skill"
              title="Edit this skill in the definitions editor"
              @click="emit('edit-skill', (detail.defStage?.skill || detail.record?.skill) as string)"
            >
              <PencilIcon width="12" height="12" />
              Edit skill
            </button>
          </div>
        </div>
      </div>

      <div class="detail-section" v-if="detail.defStage?.description">
        <div class="detail-label">Description</div>
        <div class="detail-value description">{{ detail.defStage.description }}</div>
      </div>

      <div class="detail-section" v-if="detail.defStage?.successCriteria || detail.record?.success_criteria">
        <div class="detail-label">Success Criteria</div>
        <div class="detail-value criteria" :class="{
          met: detail.record?.success_criteria_met,
          unmet: !detail.record?.success_criteria_met && (detail.record?.status === 'completed' || detail.record?.status === 'failed')
        }">
          <span class="criteria-icon" v-if="detail.record?.status === 'completed' || detail.record?.status === 'failed'">
            {{ detail.record.success_criteria_met ? '✓' : '✕' }}
          </span>
          {{ detail.defStage?.successCriteria || detail.record?.success_criteria }}
        </div>
      </div>

      <template v-if="detail.record">
        <div class="detail-section">
          <div class="detail-label">Status</div>
          <div class="detail-value">
            <span class="detail-status" :style="{ color: stageStatusColor(detail.record.status) }">
              {{ stageStatusIcon(detail.record.status) }} {{ detail.record.status }}
            </span>
          </div>
        </div>

        <div class="detail-section" v-if="canWatchLiveBrowser">
          <div class="detail-label">Live Browser</div>
          <button v-if="!showLiveBrowser" class="btn-live-browser" @click="showLiveBrowser = true">
            ▶ Watch the agent drive the browser
          </button>
          <div v-else class="live-browser">
            <div class="live-browser-bar">
              <span class="live-dot"></span> Live
              <a class="live-browser-open" :href="liveBrowserUrl" target="_blank" rel="noopener" title="Open in a new tab">↗</a>
              <button class="live-browser-hide" @click="showLiveBrowser = false">Hide</button>
            </div>
            <iframe
              :src="liveBrowserUrl"
              class="live-browser-frame"
              allow="autoplay; clipboard-read; clipboard-write"
            ></iframe>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Timing</div>
          <div class="detail-timing">
            <div class="timing-row">
              <span class="timing-label">Started</span>
              <span class="timing-value">{{ formatDateTime(detail.record.started_at) }}</span>
            </div>
            <div class="timing-row">
              <span class="timing-label">Completed</span>
              <span class="timing-value">{{ formatDateTime(detail.record.completed_at) }}</span>
            </div>
            <div class="timing-row">
              <span class="timing-label">Duration</span>
              <span class="timing-value highlight">{{ liveStageDuration(detail.record, now) }}</span>
            </div>
          </div>
        </div>

        <div class="detail-section" v-if="detail.record.error">
          <div class="detail-label">Error</div>
          <div class="detail-value error-block">{{ detail.record.error }}</div>
        </div>

        <div class="detail-section">
          <div class="detail-label">
            Logs
            <span v-if="detail.record.status === 'running'" class="log-live">● live</span>
          </div>
          <div ref="logsEl" class="detail-logs">
            <pre v-if="detail.record.logs" class="logs-text">{{ detail.record.logs }}</pre>
            <div class="logs-placeholder" v-else-if="detail.record.status === 'pending'">
              Stage has not started yet
            </div>
            <div class="logs-placeholder" v-else>
              No logs captured for this run
            </div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Artifacts</div>
          <div v-if="artifacts.length" class="artifact-grid">
            <template v-for="(art, ai) in artifacts" :key="ai">
              <!-- screenshot -->
              <div v-if="art.type === 'screenshot'" class="artifact artifact-media">
                <button class="media-thumb" title="Fill browser viewport" @click="openImage(art)">
                  <img :src="art.url" :alt="art.name" loading="lazy" />
                  <span class="media-expand">
                    <MaximizeIcon width="15" height="15" />
                  </span>
                </button>
                <div class="artifact-caption">
                  <span class="artifact-icon">🖼</span>
                  <button class="artifact-name link" @click="openImage(art)">{{ art.name }}</button>
                  <span class="artifact-size">{{ formatSize(art.size) }}</span>
                </div>
              </div>
              <!-- video -->
              <div v-else-if="art.type === 'video'" class="artifact artifact-media">
                <div class="video-wrap">
                  <video class="artifact-video-player" :src="art.url" controls preload="metadata" :poster="art.poster"></video>
                  <button
                    class="video-expand"
                    title="Fill browser viewport"
                    @click="emit('open-video', { url: art.url!, name: art.name })"
                  >
                    <MaximizeIcon width="15" height="15" />
                  </button>
                </div>
                <div class="artifact-caption">
                  <span class="artifact-icon">🎬</span>
                  <a class="artifact-name link" :href="art.url" target="_blank" rel="noopener">{{ art.name }}</a>
                  <span class="artifact-size">{{ formatSize(art.size) }}</span>
                </div>
              </div>
              <!-- commit -->
              <button v-else-if="art.type === 'commit'" class="artifact artifact-row commit-btn" @click="openDiff(art)">
                <span class="artifact-icon">⎇</span>
                <div class="artifact-commit-info">
                  <span class="commit-sha">{{ art.name }}</span>
                  <span class="commit-msg">{{ art.message }}</span>
                </div>
                <span class="commit-stat add">+{{ art.additions }}</span>
                <span class="commit-stat del">−{{ art.deletions }}</span>
              </button>
              <!-- link -->
              <a v-else-if="art.type === 'link'" class="artifact artifact-row" :href="art.url" target="_blank" rel="noopener">
                <span class="artifact-icon">🔗</span>
                <span class="artifact-name">{{ art.name }}</span>
                <span class="artifact-ext">↗</span>
              </a>
              <!-- file -->
              <button v-else class="artifact artifact-row file-btn" @click="openFile(art)">
                <span class="artifact-icon">📄</span>
                <span class="artifact-name">{{ art.name }}</span>
                <span class="artifact-size">{{ formatSize(art.size) }}</span>
                <span class="artifact-view">View</span>
              </button>
            </template>
          </div>
          <div v-else class="detail-artifacts">
            <div class="artifacts-placeholder">No artifacts produced</div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="detail-section">
          <div class="detail-label">Status</div>
          <div class="detail-value muted">No run data — start a run to see execution details</div>
        </div>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.detail-title-h {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.detail-pipeline {
  font-size: 11px;
  color: var(--color-text-muted);
}

.detail-section {
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border-dark);
}

.detail-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.detail-value {
  font-size: 13px;
  color: var(--color-text-primary);
  line-height: 1.5;
}

.detail-value.description {
  font-size: 12px;
  color: var(--color-text-hover);
}

.detail-skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.detail-skill-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.btn-edit-skill {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid var(--color-border-medium);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.btn-edit-skill:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.detail-value.criteria {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--color-bg-primary);
}

.detail-value.criteria.met {
  color: var(--color-status-running);
  border-left: 3px solid var(--color-status-running);
}

.detail-value.criteria.unmet {
  color: var(--color-error);
  border-left: 3px solid var(--color-error);
}

.criteria-icon {
  font-weight: 700;
  margin-right: 4px;
}

.detail-value.muted {
  color: var(--color-text-muted);
  font-size: 12px;
  font-style: italic;
}

.detail-status {
  font-weight: 600;
  text-transform: capitalize;
}

/* Live browser stream */
.btn-live-browser {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.btn-live-browser:hover { background: var(--color-accent); color: var(--color-text-bright); }

.live-browser {
  border: 1px solid var(--color-border-dark);
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}
.live-browser-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border-dark);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-running);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.live-browser-open {
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 13px;
}
.live-browser-open:hover { color: var(--color-accent); }
.live-browser-hide {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.live-browser-hide:hover { color: var(--color-text-primary); }
.live-browser-frame {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: none;
  background: #000;
}

.detail-timing {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timing-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.timing-label {
  color: var(--color-text-muted);
}

.timing-value {
  color: var(--color-text-primary);
}

.timing-value.highlight {
  color: var(--color-status-running);
  font-weight: 600;
}

.error-block {
  font-size: 12px;
  color: var(--color-error);
  background: rgba(232, 88, 88, 0.08);
  padding: 8px 10px;
  border-radius: 4px;
  border-left: 3px solid var(--color-error);
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-logs {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-dark);
  border-radius: 4px;
  min-height: 80px;
  max-height: 220px;
  overflow-y: auto;
  padding: 8px 10px;
}

.logs-text {
  margin: 0;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  color: var(--color-text-hover);
  white-space: pre-wrap;
  word-break: break-word;
}

.logs-placeholder {
  color: var(--color-text-muted);
  font-size: 12px;
}

.log-live {
  color: var(--color-status-running);
  font-size: 9px;
  margin-left: 6px;
  animation: pulse 1.5s ease-in-out infinite;
}

.detail-artifacts {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-dark);
  border-radius: 4px;
  padding: 8px 10px;
}

.artifacts-placeholder {
  color: var(--color-text-muted);
  font-size: 12px;
}

/* Artifacts */
.artifact-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.artifact {
  text-decoration: none;
  color: inherit;
}

.artifact-media {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-bg-primary);
  transition: border-color 0.15s;
}

.artifact-media:hover {
  border-color: var(--color-accent);
}

.artifact-media img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
  background: var(--color-bg-tertiary);
}

.video-wrap {
  position: relative;
}

.artifact-video-player {
  width: 100%;
  max-height: 200px;
  display: block;
  background: #000;
}

.media-thumb {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: var(--color-bg-tertiary);
  cursor: pointer;
}

.media-thumb img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
}

.video-expand,
.media-expand {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.video-wrap:hover .video-expand,
.media-thumb:hover .media-expand {
  opacity: 1;
}

.video-expand:hover {
  background: rgba(0, 0, 0, 0.8);
}

.artifact-name.link {
  text-decoration: none;
}

button.artifact-name.link {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font: inherit;
}

.artifact-name.link:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.artifact-caption {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
}

.artifact-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-dark);
  border-radius: 6px;
  background: var(--color-bg-primary);
  font-size: 12px;
  transition: border-color 0.15s;
}

a.artifact-row:hover,
.commit-btn:hover {
  border-color: var(--color-accent);
}

.commit-btn,
.file-btn {
  width: 100%;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.file-btn:hover {
  border-color: var(--color-accent);
}

.artifact-view {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-accent);
  margin-left: auto;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.file-btn .artifact-size {
  margin-left: 0;
}

.artifact-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.artifact-name {
  color: var(--color-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artifact-size {
  color: var(--color-text-muted);
  font-size: 10px;
  margin-left: auto;
  flex-shrink: 0;
}

.artifact-ext {
  color: var(--color-text-muted);
  margin-left: auto;
  flex-shrink: 0;
}

.artifact-commit-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.commit-sha {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--color-accent);
  font-weight: 600;
}

.commit-msg {
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-stat {
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.commit-stat.add { color: var(--color-status-running); }
.commit-stat.del { color: var(--color-status-stopped); }
.commit-stat.add { margin-left: auto; }
</style>
