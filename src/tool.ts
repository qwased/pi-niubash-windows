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

export function createNiubashDefinition(
  sdk: ShellPipelineSdk,
  cwd: string,
  niuPath: string,
): NiubashToolDefinition {
  const base = sdk.createBashToolDefinition(cwd, {
    operations: sdk.createLocalBashOperations({ shellPath: niuPath }),
  });

  return {
    ...base,
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description: DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: [...PROMPT_GUIDELINES],
    defaultActive: false,
  };
}

/**
 * A same-schema stub for machines without Niubash. It reuses the built-in schema and renderers, so
 * resumed sessions and callers see the familiar shape, and every call fails with the paths that
 * were checked. `createBashToolDefinition` resolves the shell lazily, so building this on a host
 * with no shell at all is safe.
 */
export function createUnavailableDefinition(
  sdk: ShellPipelineSdk,
  cwd: string,
  checked: readonly string[],
): NiubashToolDefinition {
  const base = sdk.createBashToolDefinition(cwd);

  return {
    ...base,
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description: UNAVAILABLE_DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: [...PROMPT_GUIDELINES],
    defaultActive: false,
    async execute() {
      throw new Error(unavailableMessage(checked));
    },
  };
}