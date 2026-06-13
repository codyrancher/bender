// Client-side mirror of the backend pipeline.md parser (parsePipelineStages +
// resolveGraph): captures stages, skills, success criteria and Next edges, then
// resolves successor names to indices (linear default when no edges declared).

export interface ParsedStage {
  name: string
  skill: string
  successCriteria: string
  nextNames: string[]
  next: number[]
}

export function parsePipeline(md: string): { stages: ParsedStage[]; unresolved: Array<{ stage: string; target: string }> } {
  const lines = (md || '').split('\n')
  const stages: ParsedStage[] = []
  let cur: ParsedStage | null = null
  let desc: string[] = []
  const flush = () => { if (cur) { stages.push(cur) } }
  for (const line of lines) {
    const m = line.match(/^###\s+\d+\.\s+(.+)/)
    if (m) { flush(); cur = { name: m[1].trim(), skill: '', successCriteria: '', nextNames: [], next: [] }; desc = []; continue }
    if (cur) {
      let mm: RegExpMatchArray | null
      if ((mm = line.match(/^\*\*Skill:\*\*\s*(.+)/))) { cur.skill = mm[1].trim(); continue }
      if ((mm = line.match(/^\*\*Success Criteria:\*\*\s*(.+)/))) { cur.successCriteria = mm[1].trim(); continue }
      if ((mm = line.match(/^\*\*Next:\*\*\s*(.+)/))) { cur.nextNames = mm[1].split(',').map(s => s.trim()).filter(Boolean); continue }
      const t = line.trim(); if (t) desc.push(t)
    }
  }
  flush()
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
