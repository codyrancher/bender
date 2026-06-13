// Parses a pipeline.md into stages + a successor graph. Mirrors the client-side
// parser used by the definitions editor.
import fs from 'fs';
import path from 'path';
import { PIPELINES_DIR } from '../config/constants';

export interface PipelineStage {
  name: string;
  skill: string;
  description: string;
  successCriteria: string;
  // Names of successor stages from "**Next:**" (parallel fork). Resolved to
  // indices in `next` by resolveGraph(). Empty `next` = terminal (an end state).
  nextNames: string[];
  next: number[];
}

export function parsePipelineStages(markdown: string): PipelineStage[] {
  const stages: PipelineStage[] = [];
  const lines = markdown.split('\n');
  let current: Partial<PipelineStage> | null = null;
  let descLines: string[] = [];

  const flush = () => {
    if (current?.name && current?.skill) {
      stages.push({
        name: current.name,
        skill: current.skill,
        description: descLines.join(' ').trim(),
        successCriteria: current.successCriteria || '',
        nextNames: current.nextNames || [],
        next: [],
      });
    }
  };

  for (const line of lines) {
    const stageMatch = line.match(/^###\s+\d+\.\s+(.+)/);
    if (stageMatch) {
      flush();
      current = { name: stageMatch[1].trim(), nextNames: [] };
      descLines = [];
      continue;
    }
    if (current) {
      const skillMatch = line.match(/^\*\*Skill:\*\*\s*(.+)/);
      if (skillMatch) {
        current.skill = skillMatch[1].trim();
        continue;
      }
      const criteriaMatch = line.match(/^\*\*Success Criteria:\*\*\s*(.+)/);
      if (criteriaMatch) {
        current.successCriteria = criteriaMatch[1].trim();
        continue;
      }
      // "**Next:**" declares one or more successor stages (comma-separated = parallel fork)
      const nextMatch = line.match(/^\*\*Next:\*\*\s*(.+)/);
      if (nextMatch) {
        current.nextNames = nextMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        continue;
      }
      const trimmed = line.trim();
      if (trimmed) descLines.push(trimmed);
    }
  }
  flush();
  resolveGraph(stages);
  return stages;
}

// Resolve successor names → indices. If NO stage declares "**Next:**", fall back
// to a linear chain (i → i+1) for backward compatibility.
export function resolveGraph(stages: PipelineStage[]): void {
  const byName = new Map<string, number>();
  stages.forEach((s, i) => byName.set(s.name.toLowerCase(), i));
  const anyEdges = stages.some(s => s.nextNames.length);

  stages.forEach((s, i) => {
    if (anyEdges) {
      s.next = s.nextNames
        .map(n => byName.has(n.toLowerCase()) ? byName.get(n.toLowerCase())! : -1)
        .filter(idx => idx >= 0);
    } else {
      // linear default
      s.next = i < stages.length - 1 ? [i + 1] : [];
    }
  });
}

export function readPipelineStages(project: string): PipelineStage[] {
  const mdPath = path.join(PIPELINES_DIR, project, 'pipeline.md');
  if (!fs.existsSync(mdPath)) return [];
  try {
    return parsePipelineStages(fs.readFileSync(mdPath, 'utf-8'));
  } catch { return []; }
}
