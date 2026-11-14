# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `PI_NIUBASH_PATH` pointing at a directory (or any non-file) is now reported as not found, with
  an explicit "exists but is not a file" message, instead of registering a tool that fails with a
  raw `spawn ENOENT` on every call.
- The unavailable stub no longer reuses the normal prompt metadata. It used to inject "prefer
  `niubash` over `powershell`" rules next to a description that says the tool cannot run.
- Spawn failures are explained: a command over the Windows limit (about 32K characters) now says
  so and points at writing the script to a file; `ENOENT` / `EACCES` name `PI_NIUBASH_PATH`.
- The extension is inert on non-Windows platforms instead of registering a permanent stub and its
  Windows-only shell rules.

### Changed

- The model-facing description no longer pins niugit / ripgrep versions (they drift with the
  installed Niubash release) and documents `timeout > 0` plus the command-line limit.
- README / SKILL: `tar` is Windows' bsdtar, not a WinuxCmd applet; codemode's ~1MB structured
  payload is documented separately from the 2000-line / 50KB text truncation; the skill is fully
  English.
- Package `files` no longer ships the whole `docs/` tree; `peerDependencies` is `>=1.5.0`.

## [0.1.0] - unreleased

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