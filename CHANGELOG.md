# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-22

Documentation-only release: no `src/`, `test/`, prompt-text or schema change, so 0.1.0 and 0.1.1
behave identically on the same host. The trigger was a Niubash 1.5.1 self-check that invalidated two
claims the docs still made.

### Changed

- Niubash **1.5.1** is now the verified host (engine `rubash git 649b3be`, WinuxCmd **1.2.2**).
  The requirements table asks for 1.5.1 or later and says 1.5.0 still works but carries the
  pipeline argv defect.
- The rubash#3511 section became "fixed in Niubash 1.5.1" instead of a live workaround. Re-probed
  byte-by-byte on 2026-11-22: backtick substitution, `$( )` substitution and both in one word all
  deliver `it's now` to a piped native child, in `-c` and in `--ec`. The "assign to a variable
  first" workaround is now scoped to 1.5.0 hosts only, and `niu --version` is named as the way to
  tell which engine is installed. `skill/SKILL.md` and `docs/DESIGN.md` carry the same correction.
- `git` is no longer documented as unconditionally niugit. Niubash 1.5.1 keeps a directory your own
  `PATH` already has ahead of the toolbelt, so on a host whose `PATH` starts with
  `C:\Program Files\Git\cmd`, `git` is Git for Windows 2.56.0 and niugit must be called by full
  path. `rg`, `ls`, `find`, `grep`, `awk` and `sed` still resolve to `winuxcmd`.
- `sed` is no longer described as reached "via a shell emulation": on WinuxCmd 1.2.2 both
  `type sed` and `type -a sed` name the `winuxcmd` binary.
- `skill/references/ATTRIBUTION.md` records that the four snapshots are byte-identical to the
  bundle embedded in Niubash 1.5.1 (same SHA256), so no reference needed re-capture; the only
  upstream growth is the reference `SKILL.md`, which this package deliberately does not bundle.
- `docs/DESIGN.md` host facts, command-layer table and acceptance item 6 now match 1.5.1, and the
  rubash#3511 risk row records the fix instead of a pending pin bump.

### Not changed

- `src/`, `test/`, the tool description, guidelines and schema are identical to 0.1.0. The smoke
  argv probe already took its strict branch (`["it's now"]`) on 1.5.1; retiring its remaining
  U+0017 known-issue branch is a code change, left for a later patch so this release stays
  documentation-only.

## [0.1.0] - 2026-11-14

### Added

- `niubash` tool for Pi, backed by Niubash's `niu -c` and Pi's built-in shell pipeline
  (truncation to the last 2000 lines / 50KB with a full-output temp file, timeouts with a
  best-effort process-tree kill, streaming updates, TUI rendering).
- Prompt metadata that makes `niubash` the default shell and reserves `powershell` for
  PowerShell-native tasks.
- `niu.exe` resolution through `PI_NIUBASH_PATH`, `PATH`, and the two standard install
  directories, with an actionable error tool when nothing is found.
- Pi-format skill bundled via the package manifest: path contract, MSYS contrast, rc/plugin
  loading, `wpm`, and the `niu` debugger, with the upstream references included.
- Unit tests for path resolution and prompt invariants, plus an opt-in end-to-end smoke test that
  also covers byte truncation, the 1MB structured cap, timeout/abort process cleanup and the
  command-line limit.
- CI job `smoke (stub subset)` runs the checks that need no Niubash install on a clean Windows
  runner (`SMOKE_SUBSET=stub`); the full smoke test still skips without Niubash, and
  `SMOKE_REQUIRED=1` turns that skip into a failure.
- The upstream MIT license text is bundled as `skill/references/LICENSE`; `ATTRIBUTION.md` records
  the source URL, capture date and per-file SHA256, and states that the upstream commit/tag is
  unknown because the bundle carries no git metadata.
- README section on pi-web subagents: `ext:niubash` selects the extension (entry file
  `src/niubash.ts`), while `defaultActive` stays `false`.

### Fixed

- `PI_NIUBASH_PATH` pointing at a directory (or any non-file) is now reported as not found, with
  an explicit per-candidate type, instead of registering a tool that fails with a raw
  `spawn ENOENT` on every call.
- Startup guidance is applied at the `operations.exec` boundary only. A missing shell after load
  (`Custom shell path not found`), a directory, a zero-byte/`EFTYPE` image and the ~32K command
  limit now get an actionable message; timeout, abort, invalid timeout, missing cwd and output
  temp-file `open`/`read` errors keep their original wording. Replacement errors preserve the
  errno `code` and the original `cause`.
- The unavailable stub no longer reuses the normal prompt metadata, and no longer asserts "not
  installed" when a PATH-derived candidate merely is not a file. Notifications and the tool error
  name the actual source and list each checked path exactly once.
- `statSync` failing with `EACCES`/`EPERM` while `access(F_OK)` succeeds (Windows Store aliases,
  some ACLs) is now an unverified candidate handed to `spawn`, instead of a false "missing"; real
  directories are still rejected.
- An unexpanded `%NAME%` in `PI_NIUBASH_PATH` gets a specific hint instead of a bare "not found".
- Unit tests are host-independent: PATH splitting and joining use `node:path.win32`/`posix` for the
  target platform, so the Ubuntu and Windows matrix runs the same assertions.
- Test reliability: exact metadata wiring for both definitions (description, snippet, guidelines,
  `defaultActive:false`, schema and renderers), real temporary file/directory probes for the
  production `statSync` path, and smoke checks that poll both `$$` and `$!` with a PID probe that
  fails loudly. An explicitly wrong `PI_CODING_AGENT_SDK` now fails instead of silently falling
  back; abort-stage rejections are attached immediately; a multi-line byte-truncation case
  distinguishes `lines`, multi-line `bytes` and `lastLinePartial`. A failing smoke run sets
  `process.exitCode` and lets the loop drain, because `process.exit(1)` during ESM evaluation
  aborts with a libuv assertion (0xC0000409) on Windows instead of exiting 1.
- The extension is inert on non-Windows platforms instead of registering a permanent stub and its
  Windows-only shell rules.
- The quote-fidelity smoke check now goes through a native child's argv instead of the `printf`
  builtin, and a new probe records the Niubash 1.5.0 pipeline argv-carrier defect (rubash#3511:
  `'` becomes U+0017). The probe turns into a strict assertion once the pinned engine carries
  `0ef814fb`.
- The win32 PATH fixture builds its entries with `win32.join` and `win32.delimiter` instead of the
  host's, so the Ubuntu unit job runs the same assertion as Windows; the first CI run caught the
  host-dependent mix (`false !== true`).

### Changed

- The extension entry is `src/niubash.ts` (was `src/index.ts`), giving pi-web a stable extension
  basename for `ext:niubash`. Registration, `defaultActive:false`, the opt-in/rollback contract and
  the platform gate are unchanged; the extension never calls `setActiveTools` or edits a profile.
- The model-facing description now states that every call is a new `niu -c` process (`cd`,
  `export`, functions and other shell state do not persist), explains the `pwd`/`$PWD` `/c/...`
  dialect versus `C:\...` for native children, and is version-free (including the former
  two-part `bash 5.3`). The toolbelt sentence now names `tar` as Windows' bsdtar.
- README no longer claims "output is always UTF-8": Niubash sets the console code page and regular
  text/CJK is verified, but Pi replaces invalid raw bytes with U+FFFD when decoding.
- README and DESIGN describe the three truncation shapes (lines, multi-line bytes, partial single
  line) instead of implying the 50KB path always says "Showing last ... of line N".
- README marks `defaultTools` as replace semantics and tells users to append `niubash` rather than
  overwrite their other tools. Node engines now match the SDK (`>=22.19.0`); the Pi peer range is
  `"*"` per `docs/packages.md`, with the tested API floor recorded in DESIGN instead of encoded in
  an install-suppressed peer range.
- `skill/SKILL.md` was rewritten around symptom routing and the contracts the description cannot
  carry (state reset, path dialect, interactive boundaries, codemode payloads). It is English-only,
  about 5KB, and points at the references as an offline fallback rather than repeating the
  description.
- README no longer claims the skill "omits everything the description covers"; it describes the
  actual boundary.
- README states that only Windows 11 was tested on the maintainer's machine; Windows 10 and other
  builds are untested and must be verified on the target host.
- `skill/SKILL.md` no longer claims `SHELL` and `NIU_SHELL` hold byte-identical values: `SHELL`
  uses the `C:/...` spelling, `NIU_SHELL` the `C:\...` spelling.
- `skill/references/LICENSE` is committed with LF line endings, matching the published tarball,
  and its SHA256 is recorded in `ATTRIBUTION.md`.
- README, SKILL and DESIGN document the Niubash 1.5.0 pipeline argv defect (rubash#3511) and its
  workaround (assign the substitution to a variable before the pipeline); `niu --ec` does not
  avoid it.
