// Lifecycle for a pipeline's sidecar containers (browser, rancher, …): start
// (creating with the right network/env/volumes the first time), stop, remove.
import { spawn, spawnSync } from 'child_process';
import { getTemplateMeta, DEFAULT_BROWSER_SIDECAR, SidecarDef } from '../templates';
import { extractPipelineFlags } from '../pipelineFlags';
import { COMPOSE_PROJECT, NETWORK_NAME, KEY_DEFAULTS } from '../config/constants';
import { getContainerStatus } from '../utils/container';
import { readBenderJson } from './benderJson';
import { readSettings, envKeys } from './settings';

export function getSidecarContainerNames(pipeline: string): string[] {
  const meta = readBenderJson(pipeline);
  if (!meta?.sidecars) return [];
  return meta.sidecars.map(suffix => `${COMPOSE_PROJECT}-${pipeline}-${suffix}-1`);
}

export function startSidecars(pipeline: string, sidecars?: SidecarDef[]): void {
  const project = pipeline;
  if (!sidecars) {
    const meta = readBenderJson(pipeline);
    if (!meta) return;
    if (meta.template) {
      const tmpl = getTemplateMeta(meta.template);
      if (!tmpl?.sidecars) return;
      sidecars = tmpl.sidecars;
    } else {
      // Non-template project: use default browser sidecar
      sidecars = meta.sidecars.includes('browser') ? [DEFAULT_BROWSER_SIDECAR] : [];
    }
    if (!sidecars.length) return;
  }

  const settings = readSettings();

  for (const sidecar of sidecars) {
    const containerName = `${COMPOSE_PROJECT}-${project}-${sidecar.suffix}-1`;
    const alias = `${project}-${sidecar.suffix}`;
    const status = getContainerStatus(containerName);

    if (status === 'stopped') {
      spawn('docker', ['start', containerName], { stdio: 'ignore', detached: true }).unref();
    } else if (status === 'not_found') {
      const projectContainer = `${COMPOSE_PROJECT}-${project}-1`;
      const args = [
        'run', '-d',
        '--name', containerName,
        '--restart', 'unless-stopped',
      ];
      if (sidecar.network_container) {
        const netTarget = typeof sidecar.network_container === 'string'
          ? `${COMPOSE_PROJECT}-${project}-${sidecar.network_container}-1`
          : projectContainer;
        args.push('--network', `container:${netTarget}`);
      } else {
        args.push('--network', NETWORK_NAME, '--network-alias', alias);
      }
      if (sidecar.privileged) {
        args.push('--privileged');
      }
      if (sidecar.shm_size) args.push('--shm-size', sidecar.shm_size);
      if (sidecar.cap_add) {
        for (const cap of sidecar.cap_add) {
          args.push('--cap-add', cap);
        }
      }
      if (sidecar.volumes) {
        for (const vol of sidecar.volumes) {
          const v = vol.replace(/\{\{projectName\}\}/g, project);
          args.push('-v', v);
        }
      }
      if (sidecar.entrypoint) args.push('--entrypoint', sidecar.entrypoint);
      if (sidecar.env) {
        const meta = readBenderJson(pipeline);
        const tplKeys = meta?.template ? settings.templateKeys?.[meta.template] : undefined;
        const env = envKeys();
        for (const [k, v] of Object.entries(sidecar.env)) {
          let value = v.replace(/\{\{projectName\}\}/g, project);
          value = value.replace(/\{\{settings\.(\w+)\}\}/g, (_match: string, key: string) => {
            return env[key] || tplKeys?.[key] || settings.keys?.[key] || KEY_DEFAULTS[key] || '';
          });
          value = value.replace(/\{\{harness\.(\w+)\}\}/g, (_match: string, key: string) => {
            return meta?.vars?.[key] || '';
          });
          args.push('-e', `${k}=${value}`);
        }
      }
      // Project-name keyword flags (pr-#, issue-#, prime) are independent —
      // any combination can appear anywhere in the name. See pipelineFlags.ts.
      const flags = extractPipelineFlags(project);
      if (sidecar.suffix === 'browser' && flags.issueNumber) {
        const idx = args.findIndex(a => a.startsWith('CHROME_CLI='));
        if (idx !== -1) {
          args[idx] += ` https://github.com/rancher/dashboard/issues/${flags.issueNumber}`;
        }
      }
      if (sidecar.suffix === 'rancher' && flags.prime) {
        args.push('-e', 'RANCHER_VERSION_TYPE=prime');
        args.push('-e', 'CATTLE_BASE_UI_BRAND=suse');
      }
      // Interpolate {{settings.*}} in image field — per-project vars override template keys override global settings
      const projectMeta = readBenderJson(pipeline);
      const imgTplKeys = projectMeta?.template ? settings.templateKeys?.[projectMeta.template] : undefined;
      const imgEnv = envKeys();
      let image = sidecar.image.replace(/\{\{settings\.(\w+)\}\}/g, (_match: string, key: string) => {
        return projectMeta?.vars?.[key] || imgEnv[key] || imgTplKeys?.[key] || settings.keys?.[key] || KEY_DEFAULTS[key] || '';
      });
      args.push(image);
      if (sidecar.command) {
        args.push(...sidecar.command);
      }
      console.log(`Starting sidecar ${containerName}: docker ${args.join(' ')}`);
      const proc = spawn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.on('exit', (code: number | null) => {
        if (code !== 0) console.error(`Sidecar ${containerName} failed (exit ${code}): ${stderr}`);
      });
      proc.unref();
    }
  }
}

export function stopSidecars(project: string): void {
  for (const name of getSidecarContainerNames(project)) {
    spawnSync('docker', ['stop', name], { encoding: 'utf-8' });
  }
}

export function removeSidecars(project: string): void {
  for (const name of getSidecarContainerNames(project)) {
    spawnSync('docker', ['stop', name], { encoding: 'utf-8' });
    spawnSync('docker', ['rm', name], { encoding: 'utf-8' });
  }
}
