// Pure formatters / status helpers shared by the pipeline card and stage detail
// modal. Functions that need "now" take it as a parameter (the page owns the
// ticking clock) so these stay side-effect free.
import type { PipelineRun } from '@/types'

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB'
  return bytes + ' B'
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  return `${mins}m ${remainSecs}s`
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function statusColor(status: string): string {
  if (status === 'running') return 'var(--color-status-running)'
  if (status === 'stopped' || status === 'failed') return 'var(--color-status-stopped)'
  if (status === 'completed') return 'var(--color-status-running)'
  if (status === 'cancelled') return 'var(--color-warning)'
  return 'var(--color-status-default)'
}

export function stageStatusColor(status: string): string {
  if (status === 'running') return 'var(--color-status-running)'
  if (status === 'completed') return 'var(--color-status-running)'
  if (status === 'failed') return 'var(--color-error)'
  if (status === 'cancelled') return 'var(--color-warning)'
  if (status === 'skipped') return 'var(--color-text-muted)'
  return 'var(--color-status-default)'
}

export function stageStatusIcon(status: string): string {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✕'
  if (status === 'running') return '●'
  if (status === 'skipped') return '–'
  if (status === 'cancelled') return '⊘'
  return '○'
}

// Per-pipeline run ordinal for display; falls back to the global id.
export function runNo(run: { run_number?: number; id: number }): number {
  return run.run_number ?? run.id
}

export function runDuration(run: PipelineRun, now: number): string {
  if (!run.started_at) return '—'
  const start = new Date(run.started_at).getTime()
  const end = run.completed_at ? new Date(run.completed_at).getTime() : now
  return formatDuration(end - start)
}

// Live elapsed time for a stage: final duration once recorded, otherwise ticks
// from start — but ONLY while actually running. A terminal stage (cancelled,
// failed, etc.) must not keep ticking even if its duration was never recorded.
export function liveStageDuration(
  record: { status?: string; started_at: string | null; completed_at: string | null; duration_ms: number | null },
  now: number,
): string {
  if (record.duration_ms !== null) return formatDuration(record.duration_ms)
  if (!record.started_at) return '—'
  if (record.status === 'running') return formatDuration(now - new Date(record.started_at).getTime())
  if (record.completed_at) return formatDuration(new Date(record.completed_at).getTime() - new Date(record.started_at).getTime())
  // Terminal but no recorded end (orphaned by a restart) — don't tick.
  return '—'
}
