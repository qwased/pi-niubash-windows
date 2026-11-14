/**
 * pi-niubash-windows extension entry.
 *
 * Registers a `niubash` tool (inactive by default) that runs commands through Niubash's
 * `niu -c`. The built-in `powershell` tool is untouched; the two coexist and the prompt
 * guidelines make `niubash` the default shell.
 *
 * Outside Windows the extension stays inert: Niubash ships `niu.exe` only for Windows, and a stub
 * that injects "prefer niubash over powershell" rules would be wrong on every other platform.
 */

import {
  createBashToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { isSupportedPlatform, resolveNiu } from "./niu.ts";
import { TOOL_NAME, unavailableNotice } from "./prompt.ts";
import { createNiubashDefinition, createUnavailableDefinition } from "./tool.ts";

export default function piNiubash(pi: ExtensionAPI): void {
  if (!isSupportedPlatform()) return;

  const sdk = { createBashToolDefinition, createLocalBashOperations };
  const cwd = process.cwd();
  const resolution = resolveNiu();

  if (!resolution.found) {
    pi.registerTool(createUnavailableDefinition(sdk, cwd, resolution));

    pi.on("session_start", (_event, ctx) => {
      if (!pi.getActiveTools().includes(TOOL_NAME)) return;
      try {
        ctx.ui.notify(unavailableNotice(resolution), "warning");
      } catch {
        // Notifications are best-effort; the failing tool call reports the full list of paths.
      }
    });
    return;
  }

  pi.registerTool(createNiubashDefinition(sdk, cwd, resolution.path));
}
