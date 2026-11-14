/**
 * Prompt-facing constants for the `niubash` tool.
 *
 * This module has no runtime imports on purpose: the unit tests load it directly with
 * Node's type stripping, without a Pi SDK or a Niubash installation present.
 */

export const TOOL_NAME = "niubash";
export const TOOL_LABEL = "Niubash";

/**
 * Output limits of the shell pipeline this tool is built on. They mirror Pi's
 * `DEFAULT_MAX_LINES` / `DEFAULT_MAX_BYTES`; the smoke test asserts they still match, and the
 * description below quotes them, so keep all three in sync.
 */
export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024;

export const PROMPT_SNIPPET = "Run bash-syntax commands on Windows (Niubash: no WSL/MSYS)";

export const DESCRIPTION =
  "Run a command in Niubash, a GNU bash-compatible shell implemented natively for Windows " +
  "(bash 5.3 dialect; no WSL, MSYS, Cygwin, POSIX fork/signals, or PTY). Each call runs " +
  "`niu -c <command>` in the session working directory, so `~/.niubashrc` and plugins do not load. " +
  `Returns stdout and stderr combined, truncated to the last ${MAX_OUTPUT_LINES} lines or ` +
  `${MAX_OUTPUT_BYTES / 1024}KB (whichever hits first); when truncated, the full output is saved to a ` +
  "temp file and its path is reported. Exit codes propagate and a non-zero exit is an error result. " +
  "No default timeout - pass `timeout` in seconds to cap a run. Paths are Windows-native " +
  "first-class: `C:/...` always works, `/d/...` and bare `D:` reach drive roots, `/tmp` is the real " +
  "Windows temp directory, and `~` is `USERPROFILE`; MSYS path-conversion variables do not exist " +
  "here. Niubash prepends its WinuxCmd toolbelt to PATH, so `git` is niugit 2.56.0 (shares your " +
  "global gitconfig) and `rg` is ripgrep 15.2.0. No PTY: interactive fullscreen TUI programs are " +
  "not supported.";

/**
 * Appended flat to the system prompt's rules section, so every bullet names the tool.
 * The first two are the shell-selection contract: niubash by default, powershell only when the
 * task needs PowerShell itself.
 */
export const PROMPT_GUIDELINES = [
  "Use niubash as the default shell on this Windows host: for command-line work (pipes, loops, scripts, Unix tooling, git, builds, tests) choose it before the powershell tool.",
  "Use powershell only when the task needs PowerShell itself - .NET/COM objects, registry, services, event logs, CIM/WMI, remoting, or PowerShell-only modules. Everything else belongs in niubash.",
  "Inside niubash, git and the Unix toolbelt resolve to Niubash's Windows-native builds (niugit 2.56.0, ripgrep 15.2.0, WinuxCmd applets); call the full executable path when the stock Windows tool is required.",
  "Use niubash for pipelines and scripts, not for reading or editing files that the read, grep, find, ls and edit tools handle directly.",
] as const;

/** Shown when `niu.exe` cannot be located, so the model does not guess at alternatives. */
export const UNAVAILABLE_DESCRIPTION =
  "Unavailable: Niubash (niu.exe) is not installed on this machine, so this tool cannot run " +
  "commands. Every call fails with the list of paths that were checked and how to install or " +
  "point Pi at Niubash. Use the powershell tool until Niubash is installed and Pi is restarted.";

export const INSTALL_HINT = "Install Niubash from https://unixwin.dev, or set PI_NIUBASH_PATH";

export function unavailableMessage(checked: readonly string[]): string {
  const lines = checked.length > 0
    ? checked.map((path) => `  - ${path}`).join("\n")
    : "  (no candidate paths - PATH is empty and no install directory is known)";
  return [
    "Niubash (niu.exe) was not found, so the niubash tool cannot run commands.",
    "Checked:",
    lines,
    `${INSTALL_HINT} to the full path of niu.exe, then restart Pi.`,
  ].join("\n");
}