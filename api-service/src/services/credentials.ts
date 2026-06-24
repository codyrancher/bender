// Credential plumbing: reads the GitHub token and builds the `-e KEY=value`
// docker args that forward credentials into pipeline containers.
import { CONTAINER_CRED_ENV } from '../config/constants';

// The GitHub token is a PAT supplied via the environment (GITHUB_TOKEN/GH_TOKEN);
// see .env.example for the required scopes.
export function readGithubToken(): string {
  return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
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
