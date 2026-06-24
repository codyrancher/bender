// Parses a pipeline.yaml definition into a typed spec (stages + a resolved
// successor graph, args) and validates it. Also converts the legacy markdown
// pipeline.md format to YAML for the one-time migration.
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { PIPELINES_DIR } from '../config/constants';

export interface PipelineStage {
  name: string;
  skill: string;
  description: string;
  successCriteria: string;
  // Successor stage names from `next:` (parallel fork). Resolved to indices in
  // `next` by resolveGraph(); empty `next` = terminal (an end state).
  nextNames: string[];
  next: number[];
}

export interface PipelineArg { name: string; description: string; required: boolean; default: string; options: string[] }

export interface PipelineSpec {
  name?: string;
  description?: string;
  args: PipelineArg[];
  stages: PipelineStage[];
}

// Parse a pipeline.yaml document into a normalized spec. Tolerant of malformed
// input (returns empty stages/args) so the editor's live preview never throws.
export function parsePipelineSpec(text: string): PipelineSpec {
  let doc: any;
  try { doc = YAML.parse(text); } catch { doc = null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {};

  const stages: PipelineStage[] = (Array.isArray(doc.stages) ? doc.stages : [])
    .map((s: any): PipelineStage => ({
      name: String(s?.name ?? '').trim(),
      skill: String(s?.skill ?? '').trim(),
      description: String(s?.description ?? '').trim(),
      successCriteria: String(s?.successCriteria ?? s?.success_criteria ?? '').trim(),
      nextNames: Array.isArray(s?.next)
        ? s.next.map((n: any) => String(n).trim()).filter(Boolean)
        : (s?.next != null && String(s.next).trim() ? [String(s.next).trim()] : []),
      next: [],
    }))
    .filter((s: PipelineStage) => s.name);
  resolveGraph(stages);

  const args: PipelineArg[] = (Array.isArray(doc.args) ? doc.args : [])
    .map((a: any): PipelineArg => ({
      name: String(a?.name ?? '').trim(),
      description: String(a?.description ?? '').trim(),
      required: !!a?.required,
      default: a?.default != null ? String(a.default) : '',
      options: Array.isArray(a?.options)
        ? a.options.map((o: any) => String(o).trim()).filter(Boolean)
        : [],
    }))
    .filter((a: PipelineArg) => a.name);

  return {
    name: doc.name != null ? String(doc.name) : undefined,
    description: doc.description != null ? String(doc.description) : undefined,
    args,
    stages,
  };
}

// Resolve successor names → indices. If NO stage declares `next`, fall back to a
// linear chain (i → i+1) for backward compatibility.
export function resolveGraph(stages: PipelineStage[]): void {
  const byName = new Map<string, number>();
  stages.forEach((s, i) => byName.set(s.name.toLowerCase(), i));
  const anyEdges = stages.some(s => s.nextNames.length);
  stages.forEach((s, i) => {
    s.next = anyEdges
      ? s.nextNames.map(n => byName.has(n.toLowerCase()) ? byName.get(n.toLowerCase())! : -1).filter(idx => idx >= 0)
      : (i < stages.length - 1 ? [i + 1] : []);
  });
}

export function parsePipelineStages(text: string): PipelineStage[] {
  return parsePipelineSpec(text).stages;
}

export function parsePipelineArgs(text: string): PipelineArg[] {
  return parsePipelineSpec(text).args;
}

export function readPipelineStages(project: string): PipelineStage[] {
  const ymlPath = path.join(PIPELINES_DIR, project, 'pipeline.yaml');
  if (!fs.existsSync(ymlPath)) return [];
  try {
    return parsePipelineStages(fs.readFileSync(ymlPath, 'utf-8'));
  } catch { return []; }
}

// Validate that a pipeline.yaml forms a runnable pipeline and that every
// referenced skill is available (bundled or a global skill-definition). Returns
// a list of human-readable errors ([] = valid).
export function validatePipeline(text: string, availableSkills: string[]): string[] {
  const { stages } = parsePipelineSpec(text);
  const errors: string[] = [];
  if (!stages.length) { errors.push('No stages found. Add a `stages:` list.'); return errors; }

  const byName = new Set(stages.map(s => s.name.toLowerCase()));
  const noSkill = stages.filter(s => !s.skill).map(s => s.name);
  if (noSkill.length) errors.push(`Missing skill on stage(s): ${noSkill.join(', ')}.`);

  for (const s of stages) {
    for (const n of s.nextNames) {
      if (!byName.has(n.toLowerCase())) errors.push(`Stage "${s.name}" references unknown next target "${n}".`);
    }
  }

  const preds = stages.map(() => 0);
  stages.forEach(s => s.next.forEach(j => { preds[j]++; }));
  if (!preds.some(p => p === 0)) errors.push('No entry point — every stage has a predecessor (fully cyclic).');
  if (!stages.some(s => s.next.length === 0)) errors.push('No terminal stage — the pipeline never ends.');

  const avail = new Set(availableSkills.map(x => x.toLowerCase()));
  const missing = [...new Set(stages.filter(s => s.skill && !avail.has(s.skill.toLowerCase())).map(s => s.skill))];
  if (missing.length) errors.push(`Skill(s) not available: ${missing.join(', ')}.`);

  return errors;
}

// ── Legacy markdown → YAML (one-time migration) ──────────────────────────────
// Parse the old pipeline.md format (### N. Stage / **Skill:** / **Success
// Criteria:** / **Next:** / "## Args" bullets) and re-emit it as pipeline.yaml.
export function markdownToYaml(md: string): string {
  const lines = md.split('\n');

  // Title + intro paragraph (before the first "## " section).
  let name: string | undefined;
  const intro: string[] = [];
  for (const line of lines) {
    if (/^##\s+/.test(line) || /^###\s+/.test(line)) break;
    const t = line.match(/^#\s+(.+)/);
    if (t) { name = t[1].trim(); continue; }
    if (line.trim()) intro.push(line.trim());
  }

  // Args: "- **NAME** (required): description. Default: `value`"
  const args: any[] = [];
  let inArgs = false;
  for (const line of lines) {
    if (/^##\s+Args\b/i.test(line)) { inArgs = true; continue; }
    if (inArgs && /^##\s+/.test(line)) break;
    if (!inArgs) continue;
    const m = line.match(/^\s*[-*]\s+\*\*([A-Za-z_][A-Za-z0-9_]*)\*\*\s*(\(required\))?\s*:?\s*(.*)$/);
    if (!m) continue;
    let desc = (m[3] || '').trim();
    let def = '';
    const dm = desc.match(/Default:\s*`([^`]*)`/i);
    if (dm) { def = dm[1]; desc = desc.replace(/\.?\s*Default:\s*`[^`]*`/i, '').trim(); }
    const arg: any = { name: m[1] };
    if (m[2]) arg.required = true;
    if (desc) arg.description = desc;
    if (def) arg.default = def;
    args.push(arg);
  }

  // Stages: "### N. Name" + **Skill:** / **Success Criteria:** / **Next:** + prose
  const stages: any[] = [];
  let cur: any = null;
  let desc: string[] = [];
  const flush = () => { if (cur) { if (desc.length) cur.description = desc.join(' ').trim(); stages.push(cur); } };
  for (const line of lines) {
    const sm = line.match(/^###\s+\d+\.\s+(.+)/);
    if (sm) { flush(); cur = { name: sm[1].trim() }; desc = []; continue; }
    if (!cur) continue;
    let mm: RegExpMatchArray | null;
    if ((mm = line.match(/^\*\*Skill:\*\*\s*(.+)/))) { cur.skill = mm[1].trim(); continue; }
    if ((mm = line.match(/^\*\*Success Criteria:\*\*\s*(.+)/))) { cur.successCriteria = mm[1].trim(); continue; }
    if ((mm = line.match(/^\*\*Next:\*\*\s*(.+)/))) { cur.next = mm[1].split(',').map(s => s.trim()).filter(Boolean); continue; }
    const t = line.trim();
    if (t) desc.push(t);
  }
  flush();

  const spec: any = {};
  if (name) spec.name = name;
  if (intro.length) spec.description = intro.join(' ');
  if (args.length) spec.args = args;
  spec.stages = stages;
  return YAML.stringify(spec, { lineWidth: 0 });
}
