# pi-niubash-windows

**Niubash as a Pi tool.** Adds a `niubash` tool to the [Pi coding agent](https://pi.dev) that runs
commands through [Niubash](https://unixwin.dev) — a GNU bash–compatible shell implemented natively
for Windows — and keeps Pi's built-in PowerShell tool untouched next to it.

- No WSL, no MSYS/Git Bash, no path-conversion variables.
- Reuses Pi's own shell pipeline: 2000-line / 50KB truncation with full output in a temp file,
  timeouts with a best-effort process-tree kill, streaming updates, `PI_SESSION_ID`-style
  environment, native TUI rendering.
- Registers as `niubash`, never overriding `bash` or `powershell`.

---

## Requirements

| Component | Version |
|---|---|
| Pi | `@earendil-works/pi-coding-agent` ≥ 1.5 |
| Niubash | 1.5.0 or later (`niu.exe`, MIT, <https://unixwin.dev>) |
| OS | Windows 10 / 11 (the extension is inert on other platforms: it registers no tool and adds no prompt rules) |
| Node (tests and local development) | ≥ 22.19 (the Pi SDK requires it) |

`niu.exe` is resolved at extension load. If it is missing, the tool is still registered but every
call returns an actionable error instead of failing silently.

## Install

```bash
# once published
pi install npm:pi-niubash-windows

# from a git clone (the public repository URL is not published yet; substitute the real one)
pi install git:github.com/<owner>/pi-niubash-windows

# local checkout (what this repository is developed as)
pi install ./pi-niubash-windows
```

Then enable the tool in `~/.pi/agent/settings.json` and start a **new** Pi session:

```jsonc
{
  // `defaultTools` is an exact list (replace semantics), not a merge.
  // Append "niubash" to the list you already have; do not drop your other tools.
  "defaultTools": ["read", "powershell", "niubash", "edit", "write", "codemode", "grep", "find", "ls"]
}
```

`pi install` writes the package entry to `settings.packages`. The extension registers `niubash`
as **inactive** (`defaultActive: false`), so a settings opt-in is what turns it on — deleting the
name again is the whole rollback.

### pi-web subagents

pi-web gives a subagent its own tool-selection domain. Its plain `tools:` list only accepts the
built-in names, so `niubash` has to be selected with the extension selector `ext:niubash` — the
basename of the extension entry file (`src/niubash.ts`):

```yaml
# ~/.pi/agent/agents/<profile>.md, keep load_extensions: true
tools: read, bash, edit, write, grep, find, ls, ext:niubash
```

`defaultActive: false` is unchanged: the selector activates the extension's tools for that
subagent only, and the extension never rewrites a profile or calls `setActiveTools`. The Agent
list may not show extension tools; verify in the child session (`resourceSnapshot.tools`,
`toolsAdded`, or a real call), not in the parent's Agent description.

> `ext:` selectors refer to the extension **basename**: `ext:niubash`, not the package name.
> A package whose entry is `src/index.ts` cannot be selected this way; this repository keeps
> `src/niubash.ts` for exactly that reason.

## What the model sees

```jsonc
// tool call
{ "command": "for f in *.md; do wc -l \"$f\"; done", "timeout": 60 }
```

The tool description tells the model that:

- each call is a **new** `niu -c <command>` process in the session working directory, so `cd`,
  `export`, shell functions and other shell state do **not** persist between calls, and
  `~/.niubashrc` / plugins do not load;
- `pwd`/`$PWD` print the POSIX-style `/c/...` spelling, while native children receive `C:\...`;
  compare resolved paths (for example with `test` or `/usr/bin/pwd`) instead of comparing a path
  with the command input string;
- output is truncated to the **last 2000 lines or 50KB**, full output goes to a temp file whose path
  is reported;
- exit codes propagate and a non-zero exit is an error result;
- there is **no default timeout** — pass `timeout` in seconds (it must be greater than 0) when a run
  must be capped;
- a single command is limited by the Windows command line (**about 32K characters**); write longer
  scripts to a file and run that file;
- paths are Windows-native first-class (`C:/…`, `/d/…`, `D:`, `/tmp`, `~`);
- Niubash prepends its own WinuxCmd toolbelt to `PATH` (see [Known differences](#known-differences)).

Two prompt guidelines keep the two shells from competing:

> Use niubash as the default shell on this host: for command-line work (pipes, loops, scripts, Unix
> tooling, git, builds, tests) choose it before the powershell tool.
>
> Use powershell only when the task needs PowerShell itself — .NET/COM objects, registry, services,
> event logs, CIM/WMI, remoting, or PowerShell-only modules. Everything else belongs in niubash.

## Behavior

| Situation | Result |
|---|---|
| exit 0 | combined stdout+stderr; `structuredContent = { output, truncated, exit_code, wall_time_seconds }` |
| non-zero exit | same payload with `isError: true` and `Command exited with code N` |
| timeout | error result with the output captured so far and `Command timed out after N seconds`; the kill is **asynchronous** |
| > 2000 lines | tail kept; `truncatedBy: "lines"`, `lastLinePartial: false`, `[Showing lines X-Y of Z …]` |
| > 50KB across many short lines | whole lines are kept up to the byte cap; `truncatedBy: "bytes"`, `lastLinePartial: false`, `[Showing lines X-Y of Z (50.0KB limit) …]` |
| one line > 50KB | tail of that line; `truncatedBy: "bytes"`, `lastLinePartial: true`, `[Showing last 50.0KB of line N …]` |
| cancelled | `taskkill /F /T` is started but **not awaited**, so the tree dies best-effort; result says `Command aborted` |
| `niu.exe` missing | error result naming every path that was checked once, annotated with what was found there |
| `timeout` ≤ 0 | rejected by Pi (`Invalid timeout: must be a finite number of seconds`); use a positive number |

The **model-facing** result is text truncated to 2000 lines / 50KB. A `codemode` script receives the
`structuredContent` payload instead: `output` is capped at about **1MB**, split into a head and a tail
with a `[... N bytes omitted ...]` marker, and `truncated` refers to that 1MB cap — not to the text
truncation above. `full_output_path` is only present when the structured payload was capped. Scripts
that must see less should slice `output` themselves.

Niubash sets the console code page to UTF-8 (65001) for itself and its children, so the CP936
console on a Chinese Windows install does not garble results (unlike the PowerShell tool, which
needs a `[Console]::OutputEncoding` prefix). Regular text and CJK output are verified. Pi decodes
the captured bytes as UTF-8, so arbitrary invalid raw bytes are replaced with U+FFFD — do not use
the text output channel to move binary data.

The tool is also callable from `codemode` scripts, where it resolves to the structured object (about
1MB of head+tail output, see [Behavior](#behavior)):

```js
const r = await tools.niubash({ command: "git status --porcelain" });
if (r.exit_code !== 0) throw new Error(r.output);
```

## Choosing between niubash and powershell

| Task | Tool |
|---|---|
| bash syntax, pipes, loops, heredocs, shell scripts | `niubash` |
| Unix tooling (`rg`, `sed`, `awk`, `tar`, `xxd`, …) | `niubash` |
| `git`, builds, test runners, language toolchains | `niubash` |
| .NET / COM objects, registry, services, event logs, CIM/WMI, remoting | `powershell` |
| Reading, editing, searching files | Pi's `read` / `edit` / `grep` / `find` / `ls` |
| Interactive fullscreen TUI (`vim`, `ssh -t`, `tmux`) | neither — no PTY emulation |

## Known differences inside the shell

Niubash prepends four `winuxcmd` directories to `PATH` for the processes it spawns. That is by
design (it is how the Unix toolbelt ships) but it means "the command you asked for" is not always
the build you expected. The versions below were read on this review host; they follow the
installed Niubash release and are deliberately not part of the model-facing text:

| Command | Inside `niubash` | Notes |
|---|---|---|
| `git` | **niugit 2.56.0** (`winuxcmd\usr\bin\git.exe`) | shares your global `.gitconfig`; commits are readable by stock Git |
| `rg` | **ripgrep 15.2.0** (`winuxcmd`) | same version and revision as the copy Pi manages |
| `ls`, `find`, `grep`, `awk` | **WinuxCmd 1.2.1** applets | GNU-compatible implementations, not the Windows tools |
| `sed` | WinuxCmd 1.2.1 via a shell emulation | `type sed` reports the emulation, `type -a sed` the `winuxcmd` binary |
| `tar` | **Windows' bsdtar** (`C:\Windows\System32\tar.exe`) | not a WinuxCmd applet; this host ships bsdtar 3.8.9 |

Need the stock binary? Use the full path, e.g. `"/c/Program Files/Git/cmd/git.exe" status`.
Nothing outside the shell changes: Pi's `grep` and `find` tools spawn their own managed
`rg.exe` / `fd.exe` by absolute path, and `ls` / `read` / `edit` / `write` are pure Node `fs`.

Other deliberate limits:

- `niu -c` loads **no** rc and **no** plugins. Use `NIU_ENV=<file>` (or `BASH_ENV`) when a command
  needs an initialization file.
- No PTY emulation; interactive fullscreen programs are out of scope.
- A single command is limited to about **32K characters** by the Windows command line. The
  `--ec`/`--encoded-command` mode removes quoting problems but does **not** lift the argv limit;
  write long scripts to a file and run that file.
- `/tmp` is the real Windows temp directory — the same place Pi writes truncated command output, so
  `cat`-ing `details.fullOutputPath` works from inside the shell.

## Bundled skill

`skill/` ships a Pi-format skill that is installed by the package (`pi.skills`). The tool
description owns the calling contract (one process per call, truncation, exit codes, timeouts,
shell choice); the skill is loaded on demand and routes symptoms into the deep contracts the
description cannot carry:

- path dialect and the `pwd`/native-child mismatch (`references/paths.md`)
- rc / plugin-manifest / generated-loader contract (`references/prompt-plugins.md`)
- installing missing Unix commands with `wpm` (`references/wpm.md`)
- command tables: launcher verbs, builtins, applets (`references/quickref.md`)
- `niu --debug` / `--dap`, base64 verbatim handoff (`--ec`), `niu -C`, `--cwd-state`

The `references/` files are verbatim upstream snapshots for offline verification. Prefer live
checks (`command -v`, `niu doctor`, `help -s '*'`, `wpm installed`) when the host is available;
the snapshot is the fallback. The model loads the skill on demand; `/skill:niubash` forces it.

## Configuration

| Variable | Purpose |
|---|---|
| `PI_NIUBASH_PATH` | absolute path to the **`niu.exe` file**; authoritative when set (a stale value is reported, not silently ignored). A directory or other non-file path is rejected with an explicit "not a file: a directory or another special file" message; a Windows Store alias that `statSync` cannot classify but `access` can reach is handed to `spawn` instead of being rejected |

Resolution order when the variable is unset: `PATH` → `%LOCALAPPDATA%\Programs\Niubash\niu.exe`
→ `%ProgramFiles%\Niubash\niu.exe`. The lookup happens once at extension load; restart Pi after
installing or moving Niubash.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `niubash` does not appear in the tool list | add it to `defaultTools` and start a new session; run `pi list` to confirm the package is installed |
| Need to verify that the tool is exposed | use a `session_start` probe extension that records `getAllTools()` / `getActiveTools()` and exits; **do not** use `pi --print --tools <list>` — the allowlist intermittently resolves to zero tools in Pi 1.5.2, and a nested `pi` can hang after the model reply |
| `Niubash (niu.exe) was not found` | install Niubash, or point `PI_NIUBASH_PATH` at the `niu.exe` file (not its directory), then restart |
| `... which is not a niu.exe file` | fix `PI_NIUBASH_PATH`; it must name `niu.exe` itself |
| `PI_NIUBASH_PATH still contains an unexpanded %NAME% reference` | Pi does not expand `%LOCALAPPDATA%`-style variables; write the literal path (a leading `~` is expanded) |
| Chinese output garbled | should not happen (Niubash sets the console to UTF-8); if it does, capture the command and report it |
| `git` behaves unexpectedly | you are running niugit; call the stock binary by full path |
| Command hangs | no timeout is applied by default — retry with `timeout` (greater than 0) |
| `Command line too long` | split the command, or write the script to a file and run the file |
| Tool ran with the wrong cwd | the working directory comes from the session; check with `pwd` |

## Development

```bash
npm test           # unit tests: path resolution + prompt invariants (no Niubash needed)
npm run test:smoke # end-to-end against the real niu.exe + a Pi SDK
npm install --include=dev   # needed before typechecking; a local `npm config omit=dev` skips tsc
npm run typecheck  # never `npx tsc`: it can fetch the unrelated `tsc` package and exit 0
```

`test:smoke` needs a resolvable Pi SDK; it looks at `PI_CODING_AGENT_SDK`, then a bare import, then
`npm root -g`. An explicitly set `PI_CODING_AGENT_SDK` is authoritative: if it does not resolve,
the run fails instead of silently using another copy. The smoke test skips (exit 0) when Niubash is
absent; `SMOKE_REQUIRED=1` turns that skip into a failure, and `SMOKE_SUBSET=stub` runs only the
checks that need no Niubash install (the CI job).

Layout:

```text
src/niubash.ts       extension entry: resolve niu, register the tool or the unavailable stub
src/niubash.ts      extension entry: platform gate + resolve + register
src/tool.ts         wraps Pi's shell pipeline into the `niubash` definition
src/niu.ts          pure niu.exe resolution (env → PATH → known install dirs)
src/prompt.ts       tool name, description, prompt snippet/guidelines, error texts
skill/              Pi skill + bundled references
docs/DESIGN.md      design notes, verified host facts, acceptance checklist
docs/ACCEPTANCE-METHOD.md  how to verify a Pi package (probes, budgets, residue checks)
test/               unit tests and the opt-in smoke test
```

## Uninstall

```bash
pi remove pi-niubash-windows   # or ./pi-niubash-windows
```

…and delete `"niubash"` from `defaultTools`. Nothing else is written: no `~/.niubashrc` changes,
no `shellPath` override, no copies into `~/.pi/agent/extensions`.

## License & attribution

MIT — see [LICENSE](LICENSE).

The bundled `skill/references/` documents are shipped verbatim from the Niubash skill bundle
(MIT, Copyright (c) 2026 unixwin team). The upstream license text is reproduced in
[skill/references/LICENSE](skill/references/LICENSE); source URL, capture date, per-file SHA256
and the unknown upstream commit are recorded in
[skill/references/ATTRIBUTION.md](skill/references/ATTRIBUTION.md).