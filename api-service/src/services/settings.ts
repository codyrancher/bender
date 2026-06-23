// Persisted settings (key overrides + definitions remote) and env-sourced keys.
import fs from 'fs';
import path from 'path';
import { SETTINGS_PATH, ENV_KEY_MAP } from '../config/constants';

export interface Settings {
  keys?: Record<string, string>;
  templateKeys?: Record<string, Record<string, string>>;
  // Remote for the shared definitions repo (push/pull). Non-secret: the URL +
  // branch only; auth uses the mounted GitHub token at request time.
  definitionsRemote?: { url: string; branch: string };
}

export function readSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as Settings;
    }
  } catch { /* use defaults */ }
  return {};
}

export function writeSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Configurable keys sourced from environment variables (RANCHER_TAG, etc.).
export function envKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [keyId, envName] of Object.entries(ENV_KEY_MAP)) {
    const v = process.env[envName];
    if (v) out[keyId] = v;
  }
  return out;
}
