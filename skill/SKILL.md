---
name: niubash
description: >-
  Deep contract for the Niubash shell when driving it through Pi's `niubash` tool on Windows.
  Use for the path-dialect rules and the MSYS contrast, the rc/plugin loading contract, installing
  missing Unix commands with wpm, the niu debugger and base64 verbatim handoff, and documented
  engine behaviour. 中文触发：路径契约与 MSYS 对照、niubashrc 与插件清单、wpm 安装缺失命令、
  niu 调试器 / 逐字 handoff、Niubash 引擎已知行为。Do not load this for ordinary command
  execution — the `niubash` tool description already covers calling semantics, truncation,
  exit codes, timeouts and the niubash-vs-powershell split.
compatibility: >-
  Written for Niubash 1.5.0 with pi-niubash-windows 0.1.x. Path and plugin rules were checked
  against the bundled references/ snapshot; re-verify host facts with `niu doctor` before trusting
  install-specific details.
license: MIT
metadata:
  upstream: https://unixwin.dev
  niubash-version: 1.5.0
---

# Niubash — deep contract

Use this when the command itself is not the problem: paths resolve "wrong", a prompt or alias is
missing, a package is absent, the shell semantics diverge, or you need the debugger. Calling
conventions (one call = one command, truncation, exit codes, timeouts, shell choice) belong to the
`niubash` tool description and are deliberately not repeated here.

## In Pi

- One `niubash` tool call is one `niu -c <command>`. Do not nest `niu`, `bash`, `cmd /c`, `wsl` or
  `powershell -Command` inside the command; the outer tool already runs the shell.
- Because it is `-c`, **no rc and no plugins load**. If a command needs an initialization file, use
  `NIU_ENV=<file>` (or `BASH_ENV`), or `source` it explicitly at the start of the command.
- Prefer Pi's `read` / `grep` / `find` / `ls` tools for file inspection and `edit` / `write` for
  mutation. Reach for the shell for pipelines, scripts, builds, tests and Unix tooling.
- Large command output is written to a `pi-bash-*.log` file under the real Windows temp directory
  (`/tmp`), and the result reports that path. `cat` it from inside the shell when you need the part
  that was truncated.
- From a `codemode` script, `await tools.niubash({ command })` returns the structured result
  (`output`, `exit_code`, `wall_time_seconds`) instead of text.
- PowerShell-native work (.NET/COM, registry, services, CIM/WMI, remoting) goes to the `powershell`
  tool, not to a wrapped `powershell -Command`.

## Identity and boundaries

Niubash is bash implemented natively in Rust for Windows (engine: `rubash`). It is a **bash dialect**,
not a POSIX machine:

- No POSIX emulation layer: no `cygwin1.dll` / `msys-2.0.dll`, no fork, no POSIX signal delivery.
- No PTY emulation. Job control and terminal handling ride on Win32/ConPTY; pty-only programs
  (`script`, `ssh -t`) and POSIX fullscreen TUIs are the known rough edge.
- No MSYS path rules: the Windows-native path is the first-class representation. There is no
  `MSYS_NO_PATHCONV`-equivalent because there is no heuristic converter — see the path contract.
- Verbatim argv at the boundary: the bundled `bash.exe` / `sh.exe` are hardlinks to `niu.exe`.

`NIU_SHELL` carries the `niu.exe` path into every child; `SHELL` is filled with the same value only
when the host left it unset. Build scripts on `NIU_SHELL`, never on a pre-rename bridge name.

## Path contract

The rule in one line: **Windows-native paths are the internal form; POSIX/WSL spellings are input
dialects** translated deterministically at the process boundary.

| Input | Meaning | Resolves to |
|---|---|---|
| `C:/Users/me`, `C:\Users\me` | native | itself — always safe |
| `/c/Users/me` | POSIX dialect | `C:\Users\me` |
| `/mnt/c/Users/me` | WSL dialect | `C:\Users\me` |
| `/usr/bin`, `/bin`, `/etc/…`, `/var/…` | install tree | real dirs under the WinuxCmd root |
| `/tmp/x`, `/var/tmp/x` | per-user temp | real Windows temp (`TMPDIR`, else `%TEMP%`); `/var/tmp` → `<temp>/var/tmp` |
| `/home/me` | users | `C:\Users` |
| `/dev/null` | null device | `NUL` |
| `~` | home | `USERPROFILE` |
| `D:` (bare) | drive switch | the drive root — identical in `-c`, groups, subshells, piped `-i` |

Classified path spellings are translated for **native children**; everything else goes verbatim:
literal data (even path-shaped data), the bare `/`, drive-root forms `/d` and `/d/`, attached
values (`--opt=/d/x`, `FOO=/d/x`), and namespace bridges (`ssh`, `wsl`). Bundled WinuxCmd applets
are the second child class: they receive shell spellings verbatim and resolve them internally.

Consequences worth remembering:

- `> /tmp/f` and `cat /tmp/f` hit the same real directory; the install tree ships no `tmp/` at all.
- `printf '%s\n' /tmp/x` prints `/tmp/x` (GNU bash behaviour) — data is never rewritten.
- `/d/repo` arrives at `python.exe` as `D:\repo`.
- `D:rel\path` is not a dialect; write `D:/rel/path` or `/d/rel/path`.

Full contract and the MSYS contrast table: `references/paths.md`.

## Startup, rc, and plugins

- Interactive start sources `~/.niubash/generated/plugins.niu` (host-owned, derived from
  `~/.niubash/plugins.json`) **before** `~/.niubashrc`, so user `PS1`/alias/function overrides win.
- The loader stays off while the rc carries a superseded managed block (a one-time hint names
  `niu plugin migrate-rc`, a read-only review) or when `NIU_PLUGIN_LOADER=off`.
- No verb writes `~/.niubashrc`; removing a managed block is always the user's own edit.
- `niu -c` and script runs load **no** rc and **no** plugins by design.
- Non-interactive init: `NIU_ENV=<file>` (or the bash-compatible `BASH_ENV`, lower precedence) is
  sourced once before the command.
- There is no built-in theme engine: the prompt belongs to whatever claims `PS1` — a hand-set line,
  `starship init bash`, or an external framework (oh-my-bash, bash-it, bpkg) installed through
  `niu plugin`. `NIU_THEME` / `NIU_PLUGINS` lines in an old rc are inert.

Manifest, loader, and external-source contract: `references/prompt-plugins.md`.

## Launcher verbs and verbatim handoff

`niu` accepts launcher verbs (`setup`, `font`, `doctor`, `config`, `plugin`, `skill`,
`--self-update`) plus these run modes:

| Invocation | Purpose |
|---|---|
| `niu -c <cmd>` | quiet, deterministic one-shot; exit code propagates exactly |
| `niu -C <cmd>` | one command with REPL startup semantics (rc + plugins) |
| `niu --ec <b64>` / `--encoded-command` / `-EncodedCommand` | base64 payload with zero quoting; optional `v1:` prefix guards MSYS-family rewriting in transit |
| `niu --cwd-state <file>` | restore and re-record the session directory for a relaunching host |
| `niu --debug <script>` | interactive debugger, prompt `(niu-dbg)` |
| `niu --dap <script>` | same session over the Debug Adapter Protocol on stdio |

Use `--ec` when a host cannot safely quote a command line (this Pi tool passes argv directly and
does not need it, but the mode is available for scripts and wrappers).

Verb and plugin tables: `references/quickref.md`.

## Debugging scripts

Shipped in Niubash 1.5.0 (not in 1.4.4):

- `niu --debug script.sh [args…]` stops at the entry stop. Command set: `break`, `continue`,
  `next`/`step`, `where`, `frame`, `list`, `print`/`eval`, `set var`, `info …`, `quit`/`kill`.
  Debugger commands come from the controlling terminal, never the debuggee's stdin.
- `niu --dap script.sh` serves the session over DAP on stdio; `niu --dap` alone is a pure server and
  the client's `launch` request names the program.
- `--debug` combined with `-c`, `-s` or `-i` keeps the legacy extdebug-arming behaviour (no
  debugger frontend); `--debugger` remains the GNU bashdb starter path.
- The zero-JS VS Code extension lives in `editors/vscode/` (type `niubash`, program `niu`).

## Missing commands: wpm

`wpm` is the WinuxCmd package manager (not the shell). Discover before assuming:

```bash
winuxcmd --version
wpm installed
command -v <tool>
```

Install a missing command, then use it in the same session — the resolver's negative cache
invalidates when the file appears, so no `hash -r` is needed:

```bash
wpm search NAME
wpm info NAME
wpm install NAME
wpm links list
wpm links rebuild --force   # package present, links missing
wpm index update            # stale or empty index before searching
```

`niu --self-update` updates Niubash itself; `niu doctor` is the one-shot health check (links, core,
rc, generated loader). Details: `references/wpm.md`.

## Engine behaviour an agent can rely on

- A command installed during the session is runnable immediately (negative-cache invalidation).
- `unset NAME` on an inherited environment variable removes it for real for later children.
- Interactive multi-line input cannot wedge on a stray `)`; inside an open group it ends the gather
  with one GNU-style diagnostic and exit 2.
- `${…}` expansions containing quotes or command substitutions parse to the real closing brace;
  redirect diagnostics name the failing fd; negated groups (`! { …; }`) parse.
- Literal private-use-area characters in a `-c` operand pass through verbatim.
- The line editor redraws multibyte/CJK prompts correctly.

## Validation and troubleshooting

- Verify in-shell before editing rc files: run the snippet, then confirm with `command -v`, `alias`,
  or `test -f C:/path`.
- `rg --version`, `wpm links list`, `niu doctor` are the quick install checks.
- On a bash-semantics divergence: fall back to a simpler POSIX form, record the case, and report it
  upstream to `unixwin/rubash` (shell) or `unixwin/winuxcmd` (command). Do not carry host-side
  workarounds.
- If a path misbehaves against the contract above, treat it as a bug, not a missing env variable.

## References

| File | Contents |
|---|---|
| `references/paths.md` | full path contract and MSYS contrast |
| `references/prompt-plugins.md` | rc contract, prompt ownership, plugin manifest and loader |
| `references/quickref.md` | launcher verbs, plugin verbs, builtin table, applet inventory |
| `references/wpm.md` | package discovery, link repair, index flows |
| `references/ATTRIBUTION.md` | provenance and license of the bundled documents |