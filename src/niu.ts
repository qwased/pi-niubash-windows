/**
 * Locating `niu.exe`.
 *
 * Kept pure and dependency-free (only `node:fs` / `node:path`) so the unit tests can cover the
 * resolution order without a Windows host, a Niubash install, or a Pi SDK.
 */

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export const NIU_EXE = "niu.exe";
export const ENV_OVERRIDE = "PI_NIUBASH_PATH";

export type NiuSource = "PI_NIUBASH_PATH" | "PATH" | "%LOCALAPPDATA%" | "%ProgramFiles%";

export type NiuResolution =
  | { found: true; path: string; source: NiuSource }
  | { found: false; checked: string[] };

export interface ResolveNiuOptions {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
}

type Env = Record<string, string | undefined>;

/** Trim, unquote, and expand a leading `~` using the process environment. */
function normalizeSpelling(value: string | undefined, env: Env): string | undefined {
  if (!value) return undefined;
  let path = value.trim();
  if (path.length > 1 && path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).trim();
  }
  if (!path) return undefined;

  const home = env.USERPROFILE || env.HOME;
  if (home) {
    if (path === "~") return home;
    if (/^~[\\/]/.test(path)) return join(home, path.slice(2));
  }
  return path;
}

/** `PATH` entries that could contain `niu.exe`, in order, deduplicated by caller. */
export function pathCandidates(env: Env, platform: NodeJS.Platform): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  const separator = platform === "win32" ? ";" : delimiter;
  const candidates: string[] = [];
  for (const entry of raw.split(separator)) {
    const directory = normalizeSpelling(entry, env);
    if (directory) candidates.push(join(directory, NIU_EXE));
  }
  return candidates;
}

/** Standard Niubash install locations next to their environment variables. */
export function installDirectoryCandidates(env: Env): { path: string; source: NiuSource }[] {
  const candidates: { path: string; source: NiuSource }[] = [];
  if (env.LOCALAPPDATA) {
    candidates.push({ path: join(env.LOCALAPPDATA, "Programs", "Niubash", NIU_EXE), source: "%LOCALAPPDATA%" });
  }
  if (env.ProgramFiles) {
    candidates.push({ path: join(env.ProgramFiles, "Niubash", NIU_EXE), source: "%ProgramFiles%" });
  }
  return candidates;
}

/**
 * Resolve `niu.exe`.
 *
 * Order: `PI_NIUBASH_PATH` (authoritative - a stale value is reported instead of silently falling
 * back), then `PATH`, then the two standard install directories. The returned `checked` list is
 * what the unavailable tool shows, so a failed lookup is actionable.
 */
export function resolveNiu(options: ResolveNiuOptions = {}): NiuResolution {
  const env: Env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const platform = options.platform ?? process.platform;

  const override = normalizeSpelling(env[ENV_OVERRIDE], env);
  if (override) {
    return exists(override)
      ? { found: true, path: override, source: "PI_NIUBASH_PATH" }
      : { found: false, checked: [override] };
  }

  const checked: string[] = [];
  const seen = new Set<string>();
  const consider = (path: string, source: NiuSource): NiuResolution | undefined => {
    const key = platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) return undefined;
    seen.add(key);
    checked.push(path);
    return exists(path) ? { found: true, path, source } : undefined;
  };

  for (const path of pathCandidates(env, platform)) {
    const hit = consider(path, "PATH");
    if (hit) return hit;
  }

  for (const candidate of installDirectoryCandidates(env)) {
    const hit = consider(candidate.path, candidate.source);
    if (hit) return hit;
  }

  return { found: false, checked };
}