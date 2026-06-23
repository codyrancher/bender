// Persisted settings (port range + key overrides) and environment-sourced keys.
import fs from 'fs';
import path from 'path';
import { SETTINGS_PATH, ENV_KEY_MAP } from '../config/constants';

export interface PortRange {
  start: number;
  end: number;
}

export interface Settings {
  portRange: PortRange;
  keys?: Record<string, string>;
  templateKeys?: Record<string, Record<string, string>>;
  // Remote for the shared definitions repo (push/pull). Non-secret: the URL +
  // branch only; auth uses the mounted GitHub token at request time.
  definitionsRemote?: { url: string; branch: string };
}

export function readSettings(): Settings {
  const defaults: Settings = { portRange: { start: 8200, end: 8299 } };
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      return { ...defaults, ...data };
    }
  } catch { /* use defaults */ }
  return defaults;
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

let cachedExternalIp: string | null = null;
let ipCacheTime = 0;
const IP_CACHE_TTL = 300_000; // 5 minutes

export async function getExternalIp(): Promise<string> {
  if (cachedExternalIp && Date.now() - ipCacheTime < IP_CACHE_TTL) {
    return cachedExternalIp;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://api.ipify.org', { signal: controller.signal });
    clearTimeout(timeout);
    cachedExternalIp = (await resp.text()).trim();
    ipCacheTime = Date.now();
    return cachedExternalIp;
  } catch {
    return cachedExternalIp || 'unavailable';
  }
}
