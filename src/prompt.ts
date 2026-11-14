/**
 * Prompt-facing constants for the `niubash` tool.
 *
 * This module has no runtime imports on purpose: the unit tests load it directly with
 * Node's type stripping, without a Pi SDK or a Niubash installation present.
 */

import type { NiuLookupFailure } from "./niu.ts";

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
  "(no WSL, MSYS, Cygwin, POSIX fork/signals, or PTY). Each call is a new `niu -c <command>` " +
  "process in the session working directory: `cd`, `export`, and shell functions do not persist " +
  "between calls, and `~/.niubashrc`/plugins do not load. Returns stdout and stderr combined, " +
  `truncated to the last ${MAX_OUTPUT_LINES} lines or ${MAX_OUTPUT_BYTES / 1024}KB (whichever hits first); ` +
  "when truncated, the full output is saved to a temp file and its path is reported. Exit codes " +
  "propagate and a non-zero exit is an error result. No default timeout - pass `timeout` in " +
  "seconds (must be greater than 0) to cap a run. A single command is limited by the Windows " +
  "command line (about 32K characters), so write longer scripts to a file and run that file. " +
  "Paths are Windows-native first-class: `C:/...` always works, `/d/...` and bare `D:` reach " +
  "drive roots, `/tmp` is the real Windows temp directory, and `~` is `USERPROFILE`; `pwd`/`$PWD` " +
  "print the `/c/...` dialect while native children receive `C:\\...`, so do not compare path " +
  "strings with the command input. Niubash prepends its WinuxCmd toolbelt to PATH: `git` " +
  "(niugit) and `rg` are its bundled builds, `ls`/`find`/`grep`/`awk`/`sed` are WinuxCmd, and " +
  "`tar` is Windows' bsdtar; call the full executable path for the stock tool. No PTY: interactive " +
  "fullscreen TUI programs are not supported.";

/**
 * Appended flat to the system prompt's rules section, so every bullet names the tool.
 * The first two are the shell-selection contract: niubash by default, powershell only when the
 * task needs PowerShell itself. Versions of the bundled tools are deliberately not pinned here:
 * they drift with the installed Niubash release.
 */
export const PROMPT_GUIDELINES = [
  "Use niubash as the default shell on this Windows host: for command-line work (pipes, loops, scripts, Unix tooling, git, builds, tests) choose it before the powershell tool.",
  "Use powershell only when the task needs PowerShell itself - .NET/COM objects, registry, services, event logs, CIM/WMI, remoting, or PowerShell-only modules. Everything else belongs in niubash.",
  "Inside niubash, git and the Unix toolbelt resolve to Niubash's bundled niugit, ripgrep and WinuxCmd builds (tar is Windows' bsdtar); call the full executable path when the stock Windows tool is required.",
  "Use niubash for pipelines and scripts, not for reading or editing files that the read, grep, find, ls and edit tools handle directly.",
] as const;

/** Shown when `niu.exe` cannot be located, so the model does not guess at alternatives. */
export const UNAVAILABLE_DESCRIPTION =
  "Unavailable: no usable Niubash (niu.exe) was found on this machine, so this tool cannot run " +
  "commands. Every call fails with the list of paths that were checked and how to install or " +
  "point Pi at Niubash. Use the powershell tool until Niubash is available and Pi is restarted.";

/**
 * The unavailable stub must not advertise the tool it replaces. The normal snippet and guidelines
 * say "use niubash before powershell"; injecting them for a tool that cannot run would put two
 * mutually exclusive rules into the same system prompt.
 */
export const UNAVAILABLE_SNIPPET = "Unavailable: no usable Niubash (niu.exe) was found";

export const UNAVAILABLE_GUIDELINES = [
  "niubash is unavailable on this machine because Niubash (niu.exe) was not found: do not call it; use the powershell tool for shell work until Niubash is installed and Pi is restarted.",
  "Do not use niubash for file work either: use the read, grep, find, ls, edit and write tools.",
] as const;

export const INSTALL_HINT = "Install Niubash from https://unixwin.dev, or set PI_NIUBASH_PATH";

/** A short warning for `session_start`; the tool call itself reports the full list. */
export function unavailableNotice(failure: NiuLookupFailure): string {
  if (failure.overrideSet) {
    if (failure.unexpandedVariable) {
      return "PI_NIUBASH_PATH still contains an unexpanded %NAME% reference; Pi does not expand " +
        "Windows variables. Set the literal path to niu.exe, then restart Pi.";
    }
    const notFile = failure.checked.find((candidate) => candidate.kind === "other");
    if (notFile) {
      return `PI_NIUBASH_PATH points at ${notFile.path}, which is not a niu.exe file. ` +
        "Fix the path, then restart Pi.";
    }
    const missing = failure.checked[0]?.path ?? "(unknown path)";
    return `PI_NIUBASH_PATH points at ${missing}, but no niu.exe exists there. ` +
      "Fix the path or install Niubash, then restart Pi.";
  }
  const notFile = failure.checked.some((candidate) => candidate.kind === "other");
  return notFile
    ? "niubash is enabled, but no usable niu.exe was found in PATH or the standard install " +
        "directories (some candidates are not files). Call the tool once to see every checked path."
    : "niubash is enabled but Niubash (niu.exe) was not found. Install it or set " +
        "PI_NIUBASH_PATH, then restart Pi.";
}

/**
 * The full unavailable-tool message. Each checked path appears exactly once, annotated with what
 * was found there; the explanation is chosen from the recorded source instead of always blaming
 * `PI_NIUBASH_PATH`.
 */
export function unavailableMessage(failure: NiuLookupFailure): string {
  const lines = ["Niubash (niu.exe) was not found, so the niubash tool cannot run commands."];

  if (failure.checked.length === 0) {
    lines.push("Checked: (no candidate paths - PATH is empty and no install directory is known)");
  } else {
    lines.push("Checked:");
    for (const candidate of failure.checked) {
      const suffix =
        candidate.kind === "other"
          ? " (not a file: a directory or another special file)"
          : candidate.kind === "missing"
            ? " (not found)"
            : "";
      lines.push(`  - ${candidate.path}${suffix}`);
    }
  }

  if (failure.overrideSet) {
    lines.push("PI_NIUBASH_PATH is set, so PATH and the standard install directories were not searched.");
    if (failure.unexpandedVariable) {
      lines.push(
        "PI_NIUBASH_PATH still contains an unexpanded %NAME% reference; Pi does not expand Windows " +
          "variables. Use the literal path (a leading ~ is expanded).",
      );
    }
    if (failure.checked.some((candidate) => candidate.kind === "other")) {
      lines.push("PI_NIUBASH_PATH must point at the niu.exe file itself, not a directory or another special file.");
    }
  } else if (failure.checked.some((candidate) => candidate.kind === "other")) {
    lines.push("No usable niu.exe was found; the candidates marked above are not files.");
  }

  lines.push(`${INSTALL_HINT} to the full path of niu.exe, then restart Pi.`);
  return lines.join("\n");
}