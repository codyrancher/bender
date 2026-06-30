export type PipelineStatus = 'running' | 'stopped' | 'not_found' | 'deleting'

export interface PipelineStage {
  name: string
  skill: string
  description: string
  successCriteria: string
  // Successor stage indices (parallel fork). Empty = terminal/end state.
  next?: number[]
}

// An input a pipeline definition accepts (declared via its "## Args" section);
// rendered as a form at creation and passed to the run as an env var.
export interface PipelineArg {
  name: string
  description: string
  required: boolean
  default: string
  /** When non-empty, the arg renders as a taggable dropdown of these values
   *  (a custom value can still be typed). */
  options?: string[]
}

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type ArtifactType = 'screenshot' | 'video' | 'commit' | 'link' | 'file'

export interface Artifact {
  type: ArtifactType
  name: string
  url?: string
  poster?: string
  size?: number
  message?: string
  additions?: number
  deletions?: number
}

export interface PipelineStageRecord {
  id: number
  run_id: number
  stage_index: number
  stage_name: string
  skill: string
  status: StageStatus
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  error: string | null
  success_criteria: string | null
  success_criteria_met: number
  logs: string | null
  artifacts: string | null
}

export interface PipelineRun {
  id: number
  // Per-pipeline run ordinal for display (#1, #2, …); `id` stays global for API calls.
  run_number?: number
  pipeline: string
  status: RunStatus
  started_at: string | null
  completed_at: string | null
  created_at: string
  stages: PipelineStageRecord[]
}

export interface Pipeline {
  name: string
  container: string
  status: PipelineStatus
  template?: string
  // The definition id this instance was created from (often ≠ the instance name).
  definition?: string
  // Human-friendly display label, e.g. "Rancher Issue Fix & Demo - k3x9a1".
  label?: string
  // The args this instance was created with (shown muted on the list card).
  args?: Record<string, string>
  browserPort?: number
  browserHost?: string
  stages?: PipelineStage[]
  // Set when another pipeline's stage agent spawned this one (spawn-pipeline tool).
  createdBy?: { pipeline: string; runId?: number; stage?: string }
}

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
  action?: { label: string; href: string; target?: string }
  copyText?: { label: string; text: string }
  durationMs?: number
}

export interface PipelinesResponse {
  pipelines: Pipeline[]
}

export interface StatusResponse {
  pipeline: string
  status: PipelineStatus
}

export interface CreatePipelineResponse {
  status: string
  pipeline: string
  container: string
  error?: string
}

// One distinct version of a stage's SKILL.md, spanning the consecutive runs that
// shared the same text (see GET /pipelines/:name/stages/:stageName/skill-history).
export interface SkillVersion {
  skillMd: string
  firstRunId: number
  firstRunNumber: number
  lastRunNumber: number
  runCount: number
  started_at: string | null
}


