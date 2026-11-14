# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - unreleased

### Added

- `niubash` tool for Pi, backed by Niubash's `niu -c` and Pi's built-in shell pipeline
  (truncation to the last 2000 lines / 50KB with a full-output temp file, timeouts with
  process-tree kill, streaming updates, TUI rendering).
- Prompt metadata that makes `niubash` the default shell and reserves `powershell` for
  PowerShell-native tasks.
- `niu.exe` resolution through `PI_NIUBASH_PATH`, `PATH`, and the two standard install
  directories, with an actionable error tool when nothing is found.
- Pi-format skill bundled via the package manifest: path contract, MSYS contrast, rc/plugin
  loading, `wpm`, and the `niu` debugger, with the upstream references included.
- Unit tests for path resolution and prompt invariants, plus an opt-in end-to-end smoke test.