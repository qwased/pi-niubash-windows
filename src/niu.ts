/**
 * Locating `niu.exe`.
 *
 * Kept pure and almost dependency-free (only `node:fs` / `node:path`) so the unit tests can cover
 * the resolution order without a Windows host, a Niubash install, or a Pi SDK.
 */

import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";

export const NIU_EXE = "niu.exe";
export const ENV_OVERRIDE = "PI_NIUBASH_PATH";

export type NiuSource = "PI_NIUBASH_PATH" | "PATH" | "%LOCALAPPDATA%" | "%ProgramFiles%";

/**
 * - `file`: a regular file (or something `statSync` reports as one).
 * - `other`: exists but is a directory, device, or another non-file.
 * - `unverified`: `statSync` failed with an access error but `access(F_OK)` succeeded. Windows Store
 *   aliases behave this way (`nodejs/node#36790`); the only way to learn whether it runs is to let
 *   `spawn` try. This is not the same as "exists, therefore a file".
 * - `missing`: nothing at that path.
 */
export type PathKind = "file" | "other" | "unverified" | "missing";

export interface NiuCandidate {
  path: string;
  source: NiuSource;
  kind: Exclude<PathKind, "missing"> | "missing";
}

export interface NiuLookupFailure {
  checked: readonly NiuCandidate[];
  /** `PI_NIUBASH_PATH` is set, so `PATH` and the install directories were not searched. */
  overrideSet: boolean;
  /** The override still contains an unexpanded `%NAME%`; Pi does not expand Windows variables. */
  unexpandedVariable: boolean;
}

export type NiuResolution =
  | { found: true; path: string; source: NiuSource; verified: boolean }
  | ({ found: false } & NiuLookupFailure);

/** The single test seam. Production uses `defaultKind`. */
export interface ResolveNiuOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  kindOf?: (path: string) => PathKind;
}

/** The tool shells out to `niu.exe`, so only Windows is supported. */
export function isSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

function pathModule(platform: NodeJS.Platform): typeof win32 {
  return platform === "win32" ? win32 : (posix as typeof win32);
}

function pathSeparator(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

/**
 * Production probe. `statSync` is the only way to reject a directory, but it can fail on runnable
 * Windows Store aliases and some ACLs. Only an access error with a successful `access(F_OK)` is
 * retried as `unverified`; an outright missing path stays missing, and a real directory still
 * reports `other` because `statSync` succeeds for it.
 */
function defaultKind(path: string): PathKind {
  try {
    return statSync(path).isFile() ? "file" : "other";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") return "missing";
    try {
      accessSync(path, constants.F_OK);
      return "unverified";
    } catch {
      return "missing";
    }
  }
}

type Env = Record<string, string | undefined>;

/** Trim, unquote, and expand a leading `~` using the process environment. */
function normalizeSpelling(
  value: string | undefined,
  env: Env,
  platform: NodeJS.Platform,
): string | undefined {
  if (!value) return undefined;
  let path = value.trim();
  if (path.length > 1 && path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).trim();
  }
  if (!path) return undefined;

  const home = env.USERPROFILE || env.HOME;
  if (home) {
    if (path === "~") return home;
    if (/^~[\\/]/.test(path)) return pathModule(platform).join(home, path.slice(2));
  }
  return path;
}

/** Whether the raw value still contains a Windows `%NAME%` reference. */
export function hasUnexpandedVariable(value: string | undefined): boolean {
  return typeof value === "string" && /%[^%\s]+%/.test(value);
}

/** `PATH` entries that could contain `niu.exe`, in order, deduplicated by caller. */
export function pathCandidates(env: Env, platform: NodeJS.Platform): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  const join = pathModule(platform).join;
  const candidates: string[] = [];
  for (const entry of raw.split(pathSeparator(platform))) {
    const directory = normalizeSpelling(entry, env, platform);
    if (directory) candidates.push(join(directory, NIU_EXE));
  }
  return candidates;
}

/** Standard Niubash install locations next to their environment variables. */
export function installDirectoryCandidates(
  env: Env,
  platform: NodeJS.Platform = process.platform,
): { path: string; source: NiuSource }[] {
  const join = pathModule(platform).join;
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
 * back), then `PATH`, then the two standard install directories. Every probed path is returned with
 * its source and kind, so a failed lookup can explain what was checked and why each candidate was
 * rejected without blaming the wrong setting.
 */
export function resolveNiu(options: ResolveNiuOptions = {}): NiuResolution {
  const env: Env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const kindOf = options.kindOf ?? defaultKind;

  const rawOverride = env[ENV_OVERRIDE];
  const override = normalizeSpelling(rawOverride, env, platform);
  if (override) {
    const kind = kindOf(override);
    if (kind === "file" || kind === "unverified") {
      return { found: true, path: override, source: "PI_NIUBASH_PATH", verified: kind === "file" };
    }
    return {
      found: false,
      checked: [{ path: override, source: "PI_NIUBASH_PATH", kind }],
      overrideSet: true,
      unexpandedVariable: hasUnexpandedVariable(rawOverride),
    };
  }

  const checked: NiuCandidate[] = [];
  const seen = new Set<string>();
  const consider = (path: string, source: NiuSource) => {
    const key = platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const kind = kindOf(path);
    checked.push({ path, source, kind });
    return kind === "file" || kind === "unverified"
      ? { found: true as const, path, source, verified: kind === "file" }
      : undefined;
  };

  for (const path of pathCandidates(env, platform)) {
    const hit = consider(path, "PATH");
    if (hit) return hit;
  }

  for (const candidate of installDirectoryCandidates(env, platform)) {
    const hit = consider(candidate.path, candidate.source);
    if (hit) return hit;
  }

  return { found: false, checked, overrideSet: false, unexpandedVariable: false };
}