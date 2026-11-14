# pi-niubash-windows

**Niubash as a Pi tool.** Adds a `niubash` tool to the [Pi coding agent](https://pi.dev) that runs
commands through [Niubash](https://unixwin.dev) — a GNU bash–compatible shell implemented natively
for Windows — and keeps Pi's built-in PowerShell tool untouched next to it.

- No WSL, no MSYS/Git Bash, no path-conversion variables.
- Reuses Pi's own shell pipeline: 2000-line / 50KB truncation with full output in a temp file,
  timeouts with process-tree kill, streaming updates, `PI_SESSION_ID`-style environment, native TUI
  rendering.
- Registers as `niubash`, never overriding `bash` or `powershell`.

---

## Requirements

| Component | Version |
|---|---|
| Pi | `@earendil-works/pi-coding-agent` ≥ 1.5 |
| Niubash | 1.5.0 or later (`niu.exe`, MIT, <https://unixwin.dev>) |
| OS | Windows 10 / 11 (the tool is Windows-only; the extension itself loads anywhere) |
| Node (dev only) | ≥ 22.18 for running the TypeScript sources directly in tests |

`niu.exe` is resolved at extension load. If it is missing, the tool is still registered but every
call returns an actionable error instead of failing silently.

## Install

```bash
# once published
pi install npm:pi-niubash-windows

# from a git clone
pi install git:github.com/<you>/pi-niubash-windows

# local checkout (what this repository is developed as)
pi install ./pi-niubash-windows
```

Then enable the tool in `~/.pi/agent/settings.json` and start a **new** Pi session:

```jsonc
{
  "defaultTools": ["read", "powershell", "niubash", "edit", "write", "codemode", "grep", "find", "ls"]
}
```

`pi install` writes the package entry to `settings.packages`. The extension registers `niubash`
as **inactive** (`defaultActive: false`), so a settings opt-in is what turns it on — deleting the
name again is the whole rollback.

## What the model sees

```jsonc
// tool call
{ "command": "for f in *.md; do wc -l \"$f\"; done", "timeout": 60 }
```

The tool description tells the model that:

- each call is one `niu -c <command>` in the session working directory, so `~/.niubashrc` and
  plugins do not load;
- output is truncated to the **last 2000 lines or 50KB**, full output goes to a temp file whose path
  is reported;
- exit codes propagate and a non-zero exit is an error result;
- there is **no default timeout** — pass `timeout` in seconds when a run must be capped;
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
| timeout | error result with the output captured so far and `Command timed out after N seconds` |
| > 2000 lines or > 50KB | tail is kept, `details.truncation` / `details.fullOutputPath` are set |
| cancelled | process tree is killed (`taskkill /F /T`), result says `Command aborted` |
| `niu.exe` missing | error result naming every path that was checked |

Output is always UTF-8: Niubash sets the code page to 65001 for itself and its children, so the
CP936 console on a Chinese Windows install does not garble results (unlike the PowerShell tool,
which needs a `[Console]::OutputEncoding` prefix).

The tool is also callable from `codemode` scripts, where it resolves to the structured object:

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
the build you expected:

| Command | Inside `niubash` | Notes |
|---|---|---|
| `git` | **niugit 2.56.0** (`winuxcmd\usr\bin\git.exe`) | shares your global `.gitconfig`; commits are readable by stock Git |
| `rg` | **ripgrep 15.2.0** (`winuxcmd`) | same version and revision as the copy Pi manages |
| `ls`, `find`, `grep`, `sed`, `awk`, `tar` | **WinuxCmd 1.2.1** applets | GNU-compatible implementations, not the Windows tools |

Need the stock binary? Use the full path, e.g. `"/c/Program Files/Git/cmd/git.exe" status`.
Nothing outside the shell changes: Pi's `grep` and `find` tools spawn their own managed
`rg.exe` / `fd.exe` by absolute path, and `ls` / `read` / `edit` / `write` are pure Node `fs`.

Other deliberate limits:

- `niu -c` loads **no** rc and **no** plugins. Use `NIU_ENV=<file>` (or `BASH_ENV`) when a command
  needs an initialization file.
- No PTY emulation; interactive fullscreen programs are out of scope.
- `/tmp` is the real Windows temp directory — the same place Pi writes truncated command output, so
  `cat`-ing `details.fullOutputPath` works from inside the shell.

## Bundled skill

`skill/` ships a Pi-format skill that is installed by the package (`pi.skills`). It deliberately
omits everything the tool description already covers (call syntax, truncation, exit codes, shell
selection) and keeps the deep contract instead:

- path-dialect rules and the MSYS contrast (`references/paths.md`)
- rc / plugin-manifest / generated-loader contract (`references/prompt-plugins.md`)
- installing missing Unix commands with `wpm` (`references/wpm.md`)
- command tables: launcher verbs, builtins, applets (`references/quickref.md`)
- `niu --debug` / `--dap`, base64 verbatim handoff (`--ec`), `niu -C`, `--cwd-state`

The model loads it on demand; `/skill:niubash` forces it.

## Configuration

| Variable | Purpose |
|---|---|
| `PI_NIUBASH_PATH` | absolute path to `niu.exe`; authoritative when set (a stale value is reported, not silently ignored) |

Resolution order when the variable is unset: `PATH` → `%LOCALAPPDATA%\Programs\Niubash\niu.exe`
→ `%ProgramFiles%\Niubash\niu.exe`. The lookup happens once at extension load; restart Pi after
installing or moving Niubash.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `niubash` does not appear in the tool list | add it to `defaultTools` and start a new session; run `pi list` to confirm the package is installed |
| `Niubash (niu.exe) was not found` | install Niubash, or point `PI_NIUBASH_PATH` at `niu.exe`, then restart |
| Chinese output garbled | should not happen (Niubash forces UTF-8); if it does, capture the command and report it |
| `git` behaves unexpectedly | you are running niugit; call the stock binary by full path |
| Command hangs | no timeout is applied by default — retry with `timeout` |
| Tool ran with the wrong cwd | the working directory comes from the session; check with `pwd` |

## Development

```bash
npm test           # unit tests: path resolution + prompt invariants (no Niubash needed)
npm run test:smoke # end-to-end against the real niu.exe + a Pi SDK
npm run typecheck  # after `npm install`
```

`test:smoke` needs a resolvable Pi SDK; it looks at `PI_CODING_AGENT_SDK`, then a bare import, then
`npm root -g`. It skips (exit 0) when neither Niubash nor the SDK is available.

Layout:

```text
src/index.ts        extension entry: resolve niu, register the tool or the unavailable stub
src/tool.ts         wraps Pi's shell pipeline into the `niubash` definition
src/niu.ts          pure niu.exe resolution (env → PATH → known install dirs)
src/prompt.ts       tool name, description, prompt snippet/guidelines, error texts
skill/              Pi skill + bundled references
docs/DESIGN.md      design notes, verified host facts, acceptance checklist
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

The bundled `skill/references/` documents are shipped verbatim from the Niubash 1.5.0 skill bundle
(MIT, Copyright (c) 2026 unixwin team); see [skill/references/ATTRIBUTION.md](skill/references/ATTRIBUTION.md).