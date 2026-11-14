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
import { INSTALL_HINT, TOOL_NAME } from "./prompt.ts";
import { createNiubashDefinition, createUnavailableDefinition } from "./tool.ts";

export default function piNiubash(pi: ExtensionAPI): void {
  if (!isSupportedPlatform()) return;

  const sdk = { createBashToolDefinition, createLocalBashOperations };
  const cwd = process.cwd();
  const resolution = resolveNiu();

  if (!resolution.found) {
    pi.registerTool(createUnavailableDefinition(sdk, cwd, resolution.checked, resolution.notFile));

    pi.on("session_start", (_event, ctx) => {
      if (!pi.getActiveTools().includes(TOOL_NAME)) return;
      try {
        const message = resolution.notFile?.length
          ? `PI_NIUBASH_PATH points at a path that is not a file (${resolution.notFile.join(", ")}). ` +
            `${INSTALL_HINT} to the full path of niu.exe, then restart Pi.`
          : `niubash is enabled but Niubash (niu.exe) was not found. ${INSTALL_HINT}, then restart Pi.`;
        ctx.ui.notify(message, "warning");
      } catch {
        // Notifications are best-effort; the failing tool call reports the full list of paths.
      }
    });
    return;
  }

  pi.registerTool(createNiubashDefinition(sdk, cwd, resolution.path));
}