export type PipelineStatus = 'running' | 'stopped' | 'not_found'

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
  browserPort?: number
  browserHost?: string
  stages?: PipelineStage[]
}

export type PipelineGroup = 'harness' | 'blank' | 'vue3' | 'rancher'

export interface HarnessStatus {
  devRunning: boolean
  devContainerStatus: string
  devApiStatus: string
  sourceExists: boolean
}

export type ViewMode = 'vscode' | 'browser' | 'split'

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

export interface UploadResponse {
  status: string
  path: string
  filename: string
  error?: string
}

export interface TemplateKeyDef {
  id: string
  label: string
  description: string
  isText?: boolean
  placeholder?: string
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
  hasIcon: boolean
  files: string[]
  path: string
  keys?: TemplateKeyDef[]
}

export interface TemplatesResponse {
  templates: TemplateInfo[]
}

export interface PortRange {
  start: number
  end: number
}

export interface PortAllocation {
  port: number
  pipeline: string
  service: string
}

export interface SettingsResponse {
  portRange: PortRange
  allocations: PortAllocation[]
  externalIp: string
  keys: Record<string, string>
}

