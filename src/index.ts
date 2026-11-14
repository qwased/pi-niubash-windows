/**
 * pi-niubash-windows extension entry.
 *
 * Registers a `niubash` tool (inactive by default) that runs commands through Niubash's
 * `niu -c`. The built-in `powershell` tool is untouched; the two coexist and the prompt
 * guidelines make `niubash` the default shell.
 */

import {
  createBashToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { resolveNiu } from "./niu.ts";
import { INSTALL_HINT, TOOL_NAME } from "./prompt.ts";
import { createNiubashDefinition, createUnavailableDefinition } from "./tool.ts";

export default function piNiubash(pi: ExtensionAPI): void {
  const sdk = { createBashToolDefinition, createLocalBashOperations };
  const cwd = process.cwd();
  const resolution = resolveNiu();

  if (!resolution.found) {
    pi.registerTool(createUnavailableDefinition(sdk, cwd, resolution.checked));

    pi.on("session_start", (_event, ctx) => {
      if (!pi.getActiveTools().includes(TOOL_NAME)) return;
      try {
        ctx.ui.notify(
          `niubash is enabled but Niubash (niu.exe) was not found. ${INSTALL_HINT}, then restart Pi.`,
          "warning",
        );
      } catch {
        // Notifications are best-effort; the failing tool call reports the full list of paths.
      }
    });
    return;
  }

  pi.registerTool(createNiubashDefinition(sdk, cwd, resolution.path));
}