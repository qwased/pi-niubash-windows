/**
 * Builds the `niubash` tool definition.
 *
 * The tool itself is Pi's built-in shell pipeline: `createBashToolDefinition` already provides
 * streaming updates, tail truncation with a full-output temp file, timeouts with process-tree
 * kill, the `PI_*` session environment, and the `$`-style TUI renderers. Niubash is injected as
 * the shell through explicit `operations`, because `createBashToolDefinition` ignores the
 * `shellPath` option (it fills in its own operations first).
 */

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

const SPAWN_GUIDANCE: Record<string, (niuPath: string) => string> = {
  ENAMETOOLONG: () =>
    "Command line too long: Windows limits a single command to about 32K characters. " +
    "Write the script to a file and run that file, or split the command into smaller calls.",
  E2BIG: () =>
    "Command line too long: Windows limits a single command to about 32K characters. " +
    "Write the script to a file and run that file, or split the command into smaller calls.",
  ENOENT: (niuPath) =>
    `Could not start niu.exe at ${niuPath}: the file does not exist or cannot be executed. ` +
    "PI_NIUBASH_PATH must point at niu.exe itself; reinstall Niubash or fix the path, then restart Pi.",
  EACCES: (niuPath) =>
    `Could not start niu.exe at ${niuPath}: permission denied. ` +
    "Check the file's permissions and PI_NIUBASH_PATH, then restart Pi.",
};

/**
 * Turn the raw `spawn ...` errors into guidance. Only a Node errno code is mapped, so timeout,
 * abort and ordinary command failures keep their original wording.
 */
function describeSpawnError(error: unknown, niuPath: string): unknown {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (!code || !Object.hasOwn(SPAWN_GUIDANCE, code)) return error;
  return new Error(SPAWN_GUIDANCE[code](niuPath), { cause: error });
}

function withSpawnGuidance(
  definition: NiubashToolDefinition,
  niuPath: string,
): NiubashToolDefinition {
  const execute = definition.execute.bind(definition);
  definition.execute = async (...args) => {
    try {
      return await execute(...args);
    } catch (error) {
      throw describeSpawnError(error, niuPath);
    }
  };
  return definition;
}

export function createNiubashDefinition(
  sdk: ShellPipelineSdk,
  cwd: string,
  niuPath: string,
): NiubashToolDefinition {
  const base = sdk.createBashToolDefinition(cwd, {
    operations: sdk.createLocalBashOperations({ shellPath: niuPath }),
  });

  return withSpawnGuidance({
    ...base,
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description: DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: [...PROMPT_GUIDELINES],
    defaultActive: false,
  }, niuPath);
}

/**
 * A same-schema stub for machines without Niubash. It reuses the built-in schema and renderers, so
 * resumed sessions and callers see the familiar shape, and every call fails with the paths that
 * were checked. It deliberately does not reuse the normal prompt metadata: those guidelines tell
 * the model to prefer `niubash` over `powershell`, which is impossible when this stub is active.
 */
export function createUnavailableDefinition(
  sdk: ShellPipelineSdk,
  cwd: string,
  checked: readonly string[],
  notFile: readonly string[] = [],
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
      throw new Error(unavailableMessage(checked, notFile));
    },
  };
}