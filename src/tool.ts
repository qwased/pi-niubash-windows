/**
 * Builds the `niubash` tool definition.
 *
 * The tool itself is Pi's built-in shell pipeline: `createBashToolDefinition` already provides
 * streaming updates, tail truncation with a full-output temp file, timeouts with process-tree
 * kill, the `PI_*` session environment, and the `$`-style TUI renderers. Niubash is injected as
 * the shell through explicit `operations`, because `createBashToolDefinition` ignores the
 * `shellPath` option (it fills in its own operations first).
 */

import type { NiuLookupFailure } from "./niu.ts";
import {
  DESCRIPTION,
  PROMPT_GUIDELINES,
  PROMPT_SNIPPET,
  TOOL_LABEL,
  TOOL_NAME,
  UNAVAILABLE_DESCRIPTION,
  UNAVAILABLE_GUIDELINES,
  UNAVAILABLE_SNIPPET,
  unavailableMessage,
} from "./prompt.ts";

/**
 * The two SDK entry points this extension uses, declared structurally so this module can be
 * imported by `test/smoke.mjs` without a runtime dependency on the Pi package.
 */
export type ShellPipelineSdk = {
  createBashToolDefinition: typeof import("@earendil-works/pi-coding-agent").createBashToolDefinition;
  createLocalBashOperations: typeof import("@earendil-works/pi-coding-agent").createLocalBashOperations;
};

export type NiubashToolDefinition = ReturnType<ShellPipelineSdk["createBashToolDefinition"]>;

const TOO_LONG_GUIDANCE =
  "Command line too long: Windows limits a single command to about 32K characters. " +
  "Write the script to a file and run that file, or split the command into smaller calls.";

const NOT_STARTED_GUIDANCE = (niuPath: string) =>
  `Could not start niu.exe at ${niuPath}: the file does not exist or cannot be executed. ` +
  "PI_NIUBASH_PATH must point at niu.exe itself; reinstall Niubash or fix the path, then restart Pi.";

const PERMISSION_GUIDANCE = (niuPath: string) =>
  `Could not start niu.exe at ${niuPath}: permission denied. ` +
  "Check the file's permissions and PI_NIUBASH_PATH, then restart Pi.";

/** Errno codes Windows reports when the shell executable itself cannot be started. */
const NOT_STARTED_CODES = new Set(["ENOENT", "EACCES", "EPERM", "EFTYPE", "EINVAL", "UNKNOWN"]);

/**
 * Turn a shell **startup** failure into guidance.
 *
 * This runs at the `operations.exec` boundary, so it only sees failures raised while resolving or
 * spawning the shell: an invalid timeout, an abort, a missing working directory and every error
 * raised after the shell ran (output temp-file `open`/`read`, exit handling) keep their original
 * wording. The errno `code` and the original error as `cause` are preserved on the replacement.
 */
export function describeStartupError(error: unknown, niuPath: string): unknown {
  const err = error as (NodeJS.ErrnoException & { message?: string }) | undefined;
  const message = typeof err?.message === "string" ? err.message : "";
  const code = err?.code;
  const syscall = err?.syscall;

  let guidance: string | undefined;
  if (message.startsWith("Custom shell path not found:")) {
    // Raised by the SDK's own access(F_OK) check before spawn, with no errno code.
    guidance = NOT_STARTED_GUIDANCE(niuPath);
  } else if (code === "ENAMETOOLONG" || code === "E2BIG") {
    guidance = TOO_LONG_GUIDANCE;
  } else if (
    code &&
    NOT_STARTED_CODES.has(code) &&
    (syscall === undefined || syscall === "spawn" || String(syscall).startsWith("spawn "))
  ) {
    guidance = code === "EACCES" || code === "EPERM" ? PERMISSION_GUIDANCE(niuPath) : NOT_STARTED_GUIDANCE(niuPath);
  }

  if (!guidance) return error;
  const replacement = new Error(guidance, { cause: error });
  if (code) (replacement as NodeJS.ErrnoException).code = code;
  return replacement;
}

type BashOperations = ReturnType<ShellPipelineSdk["createLocalBashOperations"]>;

/** Wrap only the operations boundary, never the whole `definition.execute`. */
function createGuidedOperations(sdk: ShellPipelineSdk, niuPath: string): BashOperations {
  const base = sdk.createLocalBashOperations({ shellPath: niuPath });
  return {
    ...base,
    exec: async (command, cwd, options) => {
      try {
        return await base.exec(command, cwd, options);
      } catch (error) {
        throw describeStartupError(error, niuPath);
      }
    },
  };
}

export function createNiubashDefinition(
  sdk: ShellPipelineSdk,
  cwd: string,
  niuPath: string,
): NiubashToolDefinition {
  return {
    ...sdk.createBashToolDefinition(cwd, { operations: createGuidedOperations(sdk, niuPath) }),
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description: DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: [...PROMPT_GUIDELINES],
    defaultActive: false,
  };
}

/**
 * A same-schema stub for machines without a usable Niubash. It reuses the built-in schema and
 * renderers, so resumed sessions and callers see the familiar shape, and every call fails with the
 * paths that were checked. It deliberately does not reuse the normal prompt metadata: those
 * guidelines tell the model to prefer `niubash` over `powershell`, which is impossible when this
 * stub is active.
 */
export function createUnavailableDefinition(
  sdk: ShellPipelineSdk,
  cwd: string,
  failure: NiuLookupFailure,
): NiubashToolDefinition {
  const base = sdk.createBashToolDefinition(cwd);

  return {
    ...base,
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description: UNAVAILABLE_DESCRIPTION,
    promptSnippet: UNAVAILABLE_SNIPPET,
    promptGuidelines: [...UNAVAILABLE_GUIDELINES],
    defaultActive: false,
    async execute() {
      throw new Error(unavailableMessage(failure));
    },
  };
}
