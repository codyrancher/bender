// Credential plumbing: reads the GitHub token and builds the `-e KEY=value`
// docker args that forward credentials into pipeline containers.
import fs from 'fs';
import { CONTAINER_CRED_ENV } from '../config/constants';

// The GitHub token comes from the env if set, otherwise the mounted gh config.
export function readGithubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const hostsYml = fs.readFileSync('/data/gh-config/hosts.yml', 'utf-8');
    const m = hostsYml.match(/oauth_token:\s*(\S+)/);
    if (m) return m[1].trim();
  } catch { /* gh config not available */ }
  return '';
}

// Build `-e KEY=value` docker args for every credential present in the env.
export function credentialEnvArgs(): string[] {
  const args: string[] = [];
  for (const name of CONTAINER_CRED_ENV) {
    const v = process.env[name];
    if (v) args.push('-e', `${name}=${v}`);
  }
  const ghToken = readGithubToken();
  if (ghToken) {
    args.push('-e', `GITHUB_TOKEN=${ghToken}`);
    args.push('-e', `GH_TOKEN=${ghToken}`);
  }
  return args;
}
