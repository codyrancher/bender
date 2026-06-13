// One-time, idempotent startup migrations. Currently: convert legacy
// pipeline.md (markdown) definitions + instance workspaces to pipeline.yaml.
import fs from 'fs';
import path from 'path';
import { PIPELINES_DIR } from '../config/constants';
import { markdownToYaml } from '../utils/pipelineParser';
import { migrateDefinitionsToYaml } from './definitions';

export function migratePipelineMdToYaml(): void {
  // The git-backed definitions repo (commits the conversion).
  try { migrateDefinitionsToYaml(); }
  catch (err) { console.error('definition pipeline.md→yaml migration failed:', err); }

  // Each pipeline instance's workspace.
  try {
    if (!fs.existsSync(PIPELINES_DIR)) return;
    for (const name of fs.readdirSync(PIPELINES_DIR)) {
      const dir = path.join(PIPELINES_DIR, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const md = path.join(dir, 'pipeline.md');
      const yml = path.join(dir, 'pipeline.yaml');
      if (fs.existsSync(md) && !fs.existsSync(yml)) {
        fs.writeFileSync(yml, markdownToYaml(fs.readFileSync(md, 'utf-8')));
        fs.rmSync(md);
      }
    }
  } catch (err) {
    console.error('instance pipeline.md→yaml migration failed:', err);
  }
}
