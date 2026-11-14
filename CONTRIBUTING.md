# Contributing

Thanks for taking a look. This is a small package; keep changes focused and verifiable.

## Setup

```bash
git clone <repo> && cd pi-niubash-windows
npm install            # only needed for `npm run typecheck`
npm test               # unit tests (no Niubash, no Pi needed)
```

To exercise the real thing, install Niubash 1.5+, then:

```bash
PI_CODING_AGENT_SDK=/path/to/@earendil-works/pi-coding-agent/dist/index.js npm run test:smoke
```

## Ground rules

- **Do not reimplement the shell pipeline.** The tool is built on
  `createBashToolDefinition(cwd, { operations: createLocalBashOperations({ shellPath }) })`; new
  execution, truncation, or timeout code needs a reason that survives review.
- **Do not register under a built-in tool name.** The extension must never override `bash`,
  `powershell`, or the file tools.
- **Keep the description budget in mind.** `src/prompt.ts` is part of every session's context;
  `test/unit.test.mjs` asserts an upper bound and the presence of the load-bearing facts.
- **Every `promptGuidelines` bullet names the tool.** Bullets are appended flat to Pi's rules.
- **No runtime dependencies.** Only `peerDependencies` for the host SDK.
- TypeScript sources must be erasable (no enums, namespaces, or parameter properties) so Node's
  type stripping can run them in tests.

## Before opening a PR

1. `npm test` is green.
2. `npm run test:smoke` passes on a Windows host with Niubash installed.
3. `CHANGELOG.md` has an entry under `[Unreleased]`.
4. If behavior or the tool contract changed, update `docs/DESIGN.md` and the README tables.