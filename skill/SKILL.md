---
name: niubash
description: >-
  Troubleshooting and deep contract for the Niubash shell behind Pi's `niubash` tool on Windows.
  Load when paths look wrong (`pwd` prints `/c/...`, a native child receives `C:\...`), a command
  is missing or resolves to a surprising build, a prompt/alias/plugin does not load, `wpm` install
  or link repair is needed, the `niu` debugger / DAP / base64 handoff is involved, or documented
  engine behaviour differs from bash. Do not load for ordinary command execution: the tool
  description owns calling conventions, truncation, exit codes, timeouts and the shell choice.
license: MIT
metadata:
  upstream: https://unixwin.dev
---

# Niubash — deep contract

## State resets between calls

- One `niubash` tool call is one `niu -c <command>` process. `cd`, `export`, shell functions,
  aliases and variables do not survive into the next call. Re-establish them, or put the whole
  sequence in one command.
- No rc and no plugins load under `-c`. Point `NIU_ENV=<file>` (or `BASH_ENV`) at an init file, or
  `source` it explicitly at the start of the command.
- Do not nest a shell to "get bash semantics": the outer tool is already the shell. `cmd /c` and
  `wsl` are fine only when the task needs their own native semantics (batch built-ins, a Linux
  distribution), not as a workaround for bash behaviour.
- `--ec` / `--encoded-command` fixes quoting for hosts that cannot pass argv safely; this tool
  passes argv verbatim and does not need it, and it never lifts the ~32K command-line limit.

## Paths that surprise scripts

The internal form is Windows-native; `/c/...`, `/mnt/c/...` and the install tree `/usr/...` are
deterministic input dialects. The outputs that break naive comparisons:

| Observation | Meaning | Verify |
|---|---|---|
| `pwd` / `$PWD` prints `/c/Users/...` | POSIX-style spelling inside the shell | `pwd; /usr/bin/pwd` |
| a native child receives `C:\Users\...` | translation happens at the process boundary | `python -c "import os; print(os.getcwd())"` |
| `printf '%s\n' /tmp/x` prints `/tmp/x` | literal data is never rewritten | `test -d /tmp && echo real-tmp` |
| `ssh`/`wsl` receive the spelling verbatim | namespace bridges opt out | `command -v ssh` |

Never compare a path to the command input string; resolve both sides (`test -f C:/...`, `realpath`,
or compare `pwd` after `cd`). A path that misbehaves against the contract is a bug, not a missing
variable: there is no `MSYS_NO_PATHCONV`-equivalent. Full table: `references/paths.md`.

## Interactive boundaries

- There is no PTY: interactive fullscreen programs (`vim`, `tmux`, `ssh -t`, `script`) are out of
  scope.
- Do **not** launch `niu --debug` from inside this tool. The debugger reads commands from the
  controlling terminal and this tool has none, so it can wait until the call times out. Use a real
  `niu` TTY, or a DAP client against `niu --dap <script>`.

## codemode: two different payloads

- Model-facing call: text truncated to the last 2000 lines / 50KB, `details.truncation` and
  `details.fullOutputPath` describe that text truncation.
- `await tools.niubash({ command })` inside a `codemode` script: the structured object
  (`output`, `truncated`, `exit_code`, `wall_time_seconds`). `output` is a head+tail slice of about
  1MB with a `[... N bytes omitted ...]` marker; `truncated` means that 1MB cap, not the text
  truncation. `full_output_path` appears only when the structured payload was capped.

Slice `output` in the script when only a summary is needed; `truncated` does not reflect the
2000-line / 50KB rule.

## Symptom → verify → reference

Run the live check first; use the bundled files when the host cannot answer.

| Symptom | Live check | Deep reference |
|---|---|---|
| command missing, old, or a surprising build | `command -v <tool>; type -a <tool>` | `references/quickref.md` |
| install or links look broken | `niu doctor; wpm links list` | `references/wpm.md` |
| prompt or alias missing | `echo "$PS1"; type -a <alias>` | `references/prompt-plugins.md` |
| plugin manifest / generated loader | `ls ~/.niubash/generated; niu plugin --help` | `references/prompt-plugins.md` |
| path/resolution question | `pwd; /usr/bin/pwd; command -v <tool>` | `references/paths.md` |
| missing Unix command | `wpm installed; wpm search NAME` | `references/wpm.md` |

Useful facts: `NIU_SHELL` carries the `niu.exe` path to every child; `SHELL` is filled with the same
value only when the host left it unset, so build scripts on `NIU_SHELL`. A command installed during
the session is runnable immediately (the resolver's negative cache invalidates), so `hash -r` is
unnecessary. `unset NAME` on an inherited variable removes it for later children.

## Provenance and updates

`references/` holds verbatim upstream snapshots plus `ATTRIBUTION.md` with the source URL, capture
date, per-file SHA256 and the upstream MIT license. When updating Niubash, diff the new bundle
against `references/` and refresh both. If a snapshot disagrees with the live host, the host wins
for this session; record the divergence instead of carrying a local workaround.