// Reads a pipeline instance's .bender.json metadata and derives docker args from
// user-supplied pipeline args.
import fs from 'fs';
import path from 'path';
import { PIPELINES_DIR } from '../config/constants';

export interface BenderJson {
  template?: string;
  // The pipeline-definition id this instance was created from (if any). Used to
  // link "Edit pipeline" to the right definition (the instance name often differs).
  definitionId?: string;
  // Human-friendly display label, e.g. "Rancher Issue Fix & Demo - k3x9a1".
  // The instance `name` is a slug used for the container/dir/routes.
  label?: string;
  uid?: string;
  sidecars: string[];
  browserPort?: number;
  browserHost?: string;
  vars?: Record<string, string>;
  args?: Record<string, string>;
}

export function readBenderJson(project: string): BenderJson | null {
  const filePath = path.join(PIPELINES_DIR, project, '.bender.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// A pipeline's UID (assigned at creation). Runs are scoped to it so a reused
// name never inherits an old pipeline's runs. null for pre-UID pipelines.
export function pipelineUid(project: string): string | null {
  return readBenderJson(project)?.uid ?? null;
}

// Build `-e NAME=value` docker args from user-supplied pipeline args (declared
// by the definition's "## Args" section). Only valid env-var names are passed.
export function pipelineArgEnvArgs(args: unknown): string[] {
  const out: string[] = [];
  if (args && typeof args === 'object') {
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v) out.push('-e', `${k}=${v}`);
    }
  }
  return out;
}
