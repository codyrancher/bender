// Client-side parser for a pipeline.yaml definition: stages + a resolved
// successor graph. Mirrors the backend parser (utils/pipelineParser.ts).
import { parse as parseYaml } from 'yaml'

export interface ParsedStage {
  name: string
  skill: string
  successCriteria: string
  nextNames: string[]
  next: number[]
}

export function parsePipeline(text: string): { stages: ParsedStage[]; unresolved: Array<{ stage: string; target: string }> } {
  let doc: any
  try { doc = parseYaml(text) } catch { doc = null }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {}

  const stages: ParsedStage[] = (Array.isArray(doc.stages) ? doc.stages : [])
    .map((s: any): ParsedStage => ({
      name: String(s?.name ?? '').trim(),
      skill: String(s?.skill ?? '').trim(),
      successCriteria: String(s?.successCriteria ?? s?.success_criteria ?? '').trim(),
      nextNames: Array.isArray(s?.next)
        ? s.next.map((n: any) => String(n).trim()).filter(Boolean)
        : (s?.next != null && String(s.next).trim() ? [String(s.next).trim()] : []),
      next: [],
    }))
    .filter((s: ParsedStage) => s.name)

  // resolve successor names → indices; default to linear when none declared
  const byName = new Map<string, number>()
  stages.forEach((s, i) => byName.set(s.name.toLowerCase(), i))
  const anyEdges = stages.some(s => s.nextNames.length)
  const unresolved: Array<{ stage: string; target: string }> = []
  stages.forEach((s, i) => {
    if (anyEdges) {
      s.next = s.nextNames.map(n => {
        const j = byName.has(n.toLowerCase()) ? byName.get(n.toLowerCase())! : -1
        if (j < 0) unresolved.push({ stage: s.name, target: n })
        return j
      }).filter(x => x >= 0)
    } else {
      s.next = i < stages.length - 1 ? [i + 1] : []
    }
  })

  return { stages, unresolved }
}
