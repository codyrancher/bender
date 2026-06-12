import type {
  PipelinesResponse,
  StatusResponse,
  CreatePipelineResponse,
  UploadResponse,
  SettingsResponse,
  PortRange,
  HarnessStatus,
  PipelineRun,
  PipelineStage,
  PipelineArg,
} from '@/types'

export interface GithubAuthStatus {
  authenticated: boolean
  login?: string
  updatedAt?: number
  count?: number
  reason?: string
}

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const DEV_API_BASE = '/dev/api'

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`)
  }
  return data
}

export const api = {
  async getPipelines(): Promise<PipelinesResponse> {
    return fetchJSON<PipelinesResponse>(`${API_BASE}/pipelines`)
  },

  async createPipeline(
    name: string,
    opts?: { pipelineMd?: string; definitionId?: string; template?: string; vars?: Record<string, string>; args?: Record<string, string> },
  ): Promise<CreatePipelineResponse> {
    return fetchJSON<CreatePipelineResponse>(`${API_BASE}/pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...opts }),
    })
  },

  async getStatus(pipeline: string): Promise<StatusResponse> {
    return fetchJSON<StatusResponse>(`${API_BASE}/status/${pipeline}`)
  },

  async startPipeline(pipeline: string): Promise<{ status: string; pipeline: string }> {
    return fetchJSON(`${API_BASE}/start/${pipeline}`, { method: 'POST' })
  },

  async stopPipeline(pipeline: string): Promise<{ status: string; pipeline: string }> {
    return fetchJSON(`${API_BASE}/stop/${pipeline}`, { method: 'POST' })
  },

  async restartPipeline(pipeline: string): Promise<{ status: string; pipeline: string }> {
    return fetchJSON(`${API_BASE}/restart/${pipeline}`, { method: 'POST' })
  },

  async reprovisionPipeline(pipeline: string): Promise<{ status: string }> {
    return fetchJSON(`${API_BASE}/reprovision/${pipeline}`, { method: 'POST' })
  },

  // Note: the DELETE endpoint streams SSE progress — use deletePipelineStream
  // (response.json() would choke on the "data:" lines).
  async deletePipelineStream(
    pipeline: string,
    onLog: (message: string) => void,
  ): Promise<void> {
    const response = await fetch(`${API_BASE}/pipelines/${pipeline}`, { method: 'DELETE' })
    if (!response.ok && !response.body) {
      throw new Error(`Delete failed with status ${response.status}`)
    }
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'log') {
            onLog(event.message)
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
        }
      }
    }
  },

  async getSystemStats(): Promise<{ memTotal: number; memUsed: number; diskTotal: number; diskUsed: number }> {
    return fetchJSON(`${API_BASE}/system/stats`)
  },

  async systemPrune(onLog: (message: string) => void): Promise<void> {
    const response = await fetch(`${API_BASE}/system/prune`, { method: 'POST' })
    if (!response.body) {
      throw new Error(`Prune failed with status ${response.status}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'log') {
            onLog(event.message)
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
        }
      }
    }
  },

  async getSettings(): Promise<SettingsResponse> {
    return fetchJSON<SettingsResponse>(`${API_BASE}/settings`)
  },

  async updatePortRange(portRange: PortRange): Promise<{ status: string; portRange: PortRange }> {
    return fetchJSON(`${API_BASE}/settings/port-range`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(portRange),
    })
  },

  async getForwardOptions(pipeline: string): Promise<{ availablePorts: number[]; listeningPorts: number[] }> {
    return fetchJSON(`${API_BASE}/forwards/options/${pipeline}`)
  },

  async getForwards(): Promise<{ forwards: Array<{ publicPort: number; localPort: number; pipeline: string }> }> {
    return fetchJSON(`${API_BASE}/forwards`)
  },

  async startForward(pipeline: string, publicPort: number, localPort: number): Promise<{ status: string }> {
    return fetchJSON(`${API_BASE}/forwards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline, publicPort, localPort }),
    })
  },

  async stopForward(publicPort: number): Promise<{ status: string }> {
    return fetchJSON(`${API_BASE}/forwards/${publicPort}`, { method: 'DELETE' })
  },

  // Git-backed global definitions (bundle pipeline.md + skills)
  async getDefinitions(): Promise<{ definitions: Array<{ id: string; name: string; stages: PipelineStage[]; skills: string[]; args?: PipelineArg[] }> }> {
    return fetchJSON(`${API_BASE}/definitions`)
  },

  async getDefinition(id: string): Promise<{ id: string; name: string; content: string; stages: PipelineStage[]; skills: Array<{ name: string; content: string }>; claudeMd: string; args?: PipelineArg[] }> {
    return fetchJSON(`${API_BASE}/definitions/${id}`)
  },

  async createDefinition(id: string, pipelineMd?: string): Promise<{ id: string; sha: string }> {
    return fetchJSON(`${API_BASE}/definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pipelineMd }),
    })
  },

  async updateDefinition(
    id: string,
    updates: { pipelineMd?: string; skills?: Array<{ name: string; content: string }>; claudeMd?: string; message?: string },
  ): Promise<{ id: string; sha: string }> {
    return fetchJSON(`${API_BASE}/definitions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  },

  async deleteDefinition(id: string): Promise<{ status: string }> {
    return fetchJSON(`${API_BASE}/definitions/${id}`, { method: 'DELETE' })
  },

  async getDefinitionHistory(id: string): Promise<{ commits: Array<{ sha: string; author: string; date: string; message: string }> }> {
    return fetchJSON(`${API_BASE}/definitions/${id}/history`)
  },

  definitionCommitUrl(id: string, sha: string): string {
    return `${API_BASE}/definitions/${id}/commit/${sha}`
  },

  async pushPipelineDefinition(pipeline: string, definitionId: string, message: string): Promise<{ id: string; sha: string; skillCount: number }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/push-definition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId, message }),
    })
  },

  // Git-backed global skill definitions (a folder with SKILL.md + reference files)
  async getSkillDefinitions(): Promise<{ skills: Array<{ id: string; name: string; description: string; fileCount: number }> }> {
    return fetchJSON(`${API_BASE}/skill-definitions`)
  },

  async getSkillDefinition(id: string): Promise<{ id: string; name: string; description: string; files: Array<{ path: string; content: string; binary: boolean }> }> {
    return fetchJSON(`${API_BASE}/skill-definitions/${id}`)
  },

  async createSkillDefinition(id: string): Promise<{ id: string; sha: string }> {
    return fetchJSON(`${API_BASE}/skill-definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  },

  async updateSkillDefinition(
    id: string,
    files: Array<{ path: string; content: string }>,
    message?: string,
  ): Promise<{ id: string; sha: string }> {
    return fetchJSON(`${API_BASE}/skill-definitions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, message }),
    })
  },

  async deleteSkillDefinition(id: string): Promise<{ status: string }> {
    return fetchJSON(`${API_BASE}/skill-definitions/${id}`, { method: 'DELETE' })
  },

  async getSkillDefinitionHistory(id: string): Promise<{ commits: Array<{ sha: string; author: string; date: string; message: string }> }> {
    return fetchJSON(`${API_BASE}/skill-definitions/${id}/history`)
  },

  skillDefinitionCommitUrl(id: string, sha: string): string {
    return `${API_BASE}/skill-definitions/${id}/commit/${sha}`
  },

  // Harness dev environment
  async getHarnessStatus(): Promise<HarnessStatus> {
    return fetchJSON<HarnessStatus>(`${API_BASE}/harness/status`)
  },

  async harnessStream(
    action: 'start' | 'rebuild' | 'promote' | 'abandon',
    onLog: (message: string) => void,
  ): Promise<void> {
    const base = action === 'start' ? API_BASE : DEV_API_BASE
    const response = await fetch(`${base}/harness/${action}`, { method: 'POST' })
    if (!response.body) {
      throw new Error(`Harness ${action} failed with status ${response.status}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'log') {
            onLog(event.message)
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
        }
      }
    }
  },

  // Insights
  async getInsightsTables(): Promise<{ tables: string[] }> {
    return fetchJSON(`${API_BASE}/insights/tables`)
  },

  async getTableSchema(table: string): Promise<{ columns: Array<{ name: string; type: string; notnull: number; pk: number }> }> {
    return fetchJSON(`${API_BASE}/insights/tables/${table}/schema`)
  },

  async getTableRows(table: string, limit = 100, offset = 0): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    return fetchJSON(`${API_BASE}/insights/tables/${table}/rows?limit=${limit}&offset=${offset}`)
  },

  async runInsightsQuery(sql: string): Promise<{ rows?: Record<string, unknown>[]; columns?: string[]; changes?: number; error?: string }> {
    return fetchJSON(`${API_BASE}/insights/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    })
  },

  async deleteTableRows(table: string, rowids: number[]): Promise<{ deleted: number }> {
    return fetchJSON(`${API_BASE}/insights/tables/${table}/delete-rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowids }),
    })
  },


  async uploadImage(pipeline: string, base64Data: string, filename: string): Promise<UploadResponse> {
    return fetchJSON(`${API_BASE}/upload/${pipeline}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64Data, filename }),
    })
  },

  async removePortMapping(pipeline: string, service: string): Promise<{ status: string }> {
    return fetchJSON(`${API_BASE}/settings/port-mappings/${pipeline}/${service}`, { method: 'DELETE' })
  },

  async getPipelineRuns(pipeline: string, limit = 20, offset = 0): Promise<{ runs: PipelineRun[]; total: number }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/runs?limit=${limit}&offset=${offset}`)
  },

  async createPipelineRun(pipeline: string): Promise<{ run: PipelineRun }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/runs`, { method: 'POST' })
  },

  // Rerun starting at a stage as a brand-new run: preceding stages are copied
  // from the source run, execution begins at this stage against its restored
  // workspace snapshot. Leaves the source run intact as history.
  async rerunStageAsNewRun(pipeline: string, runId: number, stageIndex: number): Promise<{ run: PipelineRun }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/runs/${runId}/stages/${stageIndex}/rerun-new`, {
      method: 'POST',
    })
  },

  async cancelPipelineRun(pipeline: string, runId: number): Promise<{ run: PipelineRun }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/runs/${runId}/cancel`, { method: 'POST' })
  },

  // Claude auth (gates a run on the stage-executor CLI being signed in)
  async getClaudeAuth(pipeline: string): Promise<{ authenticated: boolean; method: string; loggedIn: boolean }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/claude-auth`)
  },

  async startClaudeLogin(pipeline: string): Promise<{ sessionId: string; url: string }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/claude-auth/login`, { method: 'POST' })
  },

  async completeClaudeLogin(pipeline: string, sessionId: string, code: string): Promise<{ completed: boolean; authenticated: boolean; method: string }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/claude-auth/login/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  },

  // GitHub browser session (used by the agent to upload screenshots/videos to a
  // PR/issue — that goes through a logged-in browser session, not a token).
  async getGithubAuth(pipeline: string): Promise<GithubAuthStatus> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/github-auth`)
  },

  // Capture the session from the project's running sidecar browser (after a
  // manual sign-in there) and persist it as the snapshot future runs inject.
  async captureGithubSession(pipeline: string): Promise<GithubAuthStatus & { error?: string }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/github-auth/capture`, { method: 'POST' })
  },

  async getPipelineArgs(pipeline: string): Promise<{ args: Array<{ name: string; description: string; required: boolean; default: string; value: string }> }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/args`)
  },

  async savePipelineArgs(pipeline: string, values: Record<string, string>): Promise<{ status: string }> {
    return fetchJSON(`${API_BASE}/pipelines/${pipeline}/args`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    })
  },
}
