import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, posix, win32 } from "node:path";

import {
  ENV_OVERRIDE,
  NIU_EXE,
  hasUnexpandedVariable,
  installDirectoryCandidates,
  isSupportedPlatform,
  pathCandidates,
  resolveNiu,
} from "../src/niu.ts";
import {
  DESCRIPTION,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_LINES,
  PROMPT_GUIDELINES,
  PROMPT_SNIPPET,
  TOOL_LABEL,
  TOOL_NAME,
  UNAVAILABLE_DESCRIPTION,
  UNAVAILABLE_GUIDELINES,
  UNAVAILABLE_SNIPPET,
  unavailableMessage,
  unavailableNotice,
} from "../src/prompt.ts";
import {
  createNiubashDefinition,
  createUnavailableDefinition,
  describeStartupError,
} from "../src/tool.ts";

/** Fake `kindOf` backed by a fixed set of paths, compared case-insensitively. */
function kindIn(...paths) {
  const wanted = new Set(paths.map((path) => path.toLowerCase()));
  return (path) => (wanted.has(path.toLowerCase()) ? "file" : "missing");
}

/** Fake `kindOf` that reports every path with the same kind. */
function allKind(kind) {
  return () => kind;
}

/** A fake Pi SDK that records wiring without loading the real shell pipeline. */
const OUTPUT_SCHEMA = { type: "object", marker: "outputSchema" };
const PARAMETERS = { type: "object", marker: "parameters" };
const RENDER_CALL = function renderCall() {
  return "call";
};
const RENDER_RESULT = function renderResult() {
  return "result";
};

function createFakeSdk({ exec, afterExecError } = {}) {
  const calls = { definitions: [], operations: [] };
  const operations = { exec: exec ?? (async () => ({ exitCode: 0 })) };
  const sdk = {
    createLocalBashOperations(options) {
      calls.operations.push(options);
      return operations;
    },
    createBashToolDefinition(cwd, options) {
      calls.definitions.push({ cwd, options });
      return {
        name: "bash",
        label: "bash",
        description: "bash description",
        parameters: PARAMETERS,
        outputSchema: OUTPUT_SCHEMA,
        renderCall: RENDER_CALL,
        renderResult: RENDER_RESULT,
        defaultActive: true,
        execute: async () => {
          // Models the real SDK: run the shell, then raise any post-exec error verbatim.
          await options.operations.exec("echo hi", cwd, {});
          if (afterExecError) throw afterExecError;
          return { content: [] };
        },
      };
    },
  };
  return { sdk, calls, operations };
}

/** The diagnostic object the resolver returns when nothing usable was found. */
function failure({ checked = [], overrideSet = false, unexpandedVariable = false } = {}) {
  return { checked, overrideSet, unexpandedVariable };
}

// --- platform path handling -------------------------------------------------

test("PATH is split with the target platform's separator, not the host's", () => {
  assert.deepEqual(pathCandidates({ PATH: `C:\\one;;C:\\two;` }, "win32"), [
    win32.join("C:\\one", NIU_EXE),
    win32.join("C:\\two", NIU_EXE),
  ]);
  assert.deepEqual(pathCandidates({ PATH: `/one::/two:` }, "posix"), [
    posix.join("/one", NIU_EXE),
    posix.join("/two", NIU_EXE),
  ]);
});

test("PATH candidates skip blank and whitespace-only entries on both flavors", () => {
  assert.deepEqual(pathCandidates({ PATH: ";   ;; ; " }, "win32"), []);
  assert.deepEqual(pathCandidates({ PATH: ":   :: : " }, "posix"), []);
  assert.deepEqual(pathCandidates({ PATH: "" }, "win32"), []);
});

test("install directories use the target platform's join flavor", () => {
  const candidates = installDirectoryCandidates(
    { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", ProgramFiles: "C:\\Program Files" },
    "win32",
  );
  assert.deepEqual(candidates, [
    {
      path: win32.join("C:\\Users\\me\\AppData\\Local", "Programs", "Niubash", NIU_EXE),
      source: "%LOCALAPPDATA%",
    },
    { path: win32.join("C:\\Program Files", "Niubash", NIU_EXE), source: "%ProgramFiles%" },
  ]);
  assert.ok(candidates.every((candidate) => candidate.path.includes("\\")));
});

test("a Windows-style resolver run is independent of the host path flavor", () => {
  const resolution = resolveNiu({
    env: { PATH: "C:\\toolbox", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    platform: "win32",
    kindOf: kindIn(win32.join("C:\\toolbox", NIU_EXE)),
  });
  assert.deepEqual(resolution, {
    found: true,
    path: win32.join("C:\\toolbox", NIU_EXE),
    source: "PATH",
    verified: true,
  });
});

// --- resolution order -------------------------------------------------------

test("PI_NIUBASH_PATH is checked first and wins over PATH", () => {
  const override = join("opt", "niubash", NIU_EXE);
  const onPath = join("toolbox", NIU_EXE);
  const resolution = resolveNiu({
    env: { [ENV_OVERRIDE]: override, PATH: join("toolbox") },
    kindOf: kindIn(override, onPath),
  });
  assert.deepEqual(resolution, {
    found: true,
    path: override,
    source: "PI_NIUBASH_PATH",
    verified: true,
  });
});

test("a stale PI_NIUBASH_PATH is reported instead of silently falling back", () => {
  const stale = join("gone", NIU_EXE);
  const resolution = resolveNiu({
    env: { [ENV_OVERRIDE]: stale, PATH: join("toolbox") },
    kindOf: kindIn(join("toolbox", NIU_EXE)),
  });
  assert.deepEqual(resolution, {
    found: false,
    checked: [{ path: stale, source: "PI_NIUBASH_PATH", kind: "missing" }],
    overrideSet: true,
    unexpandedVariable: false,
  });
});

test("PI_NIUBASH_PATH accepts quotes and a leading ~", () => {
  const home = join("home", "me");
  const expected = join(home, NIU_EXE);
  const quoted = resolveNiu({
    env: { [ENV_OVERRIDE]: `  "${expected}"  ` },
    kindOf: kindIn(expected),
  });
  assert.equal(quoted.found, true);
  assert.equal(quoted.path, expected);

  const homeRelative = resolveNiu({
    env: { [ENV_OVERRIDE]: "~/niu.exe", USERPROFILE: home },
    kindOf: kindIn(expected),
  });
  assert.equal(homeRelative.found, true);
  assert.equal(homeRelative.path, expected);
});

test("PATH is scanned in order", () => {
  const first = join("first");
  const second = join("second");
  const resolution = resolveNiu({
    env: { PATH: [join("empty"), `"${second}"`, "", first].join(delimiter) },
    kindOf: kindIn(join(second, NIU_EXE)),
  });
  assert.equal(resolution.found, true);
  assert.equal(resolution.path, join(second, NIU_EXE));
  assert.equal(resolution.source, "PATH");
});

test("duplicate PATH entries are checked once", () => {
  const resolution = resolveNiu({
    env: { PATH: "C:\\dup;C:\\DUP" },
    platform: "win32",
    kindOf: () => "missing",
  });
  assert.equal(resolution.found, false);
  const duplicates = resolution.checked.filter((candidate) => candidate.path.toLowerCase().startsWith("c:\\dup"));
  assert.equal(duplicates.length, 1);
});

test("standard install directories are used after PATH", () => {
  const localAppData = join("LA");
  const programFiles = join("PF");
  const candidates = installDirectoryCandidates({ LOCALAPPDATA: localAppData, ProgramFiles: programFiles });
  assert.deepEqual(candidates, [
    { path: join(localAppData, "Programs", "Niubash", NIU_EXE), source: "%LOCALAPPDATA%" },
    { path: join(programFiles, "Niubash", NIU_EXE), source: "%ProgramFiles%" },
  ]);

  const resolution = resolveNiu({
    env: { PATH: "", LOCALAPPDATA: localAppData, ProgramFiles: programFiles },
    kindOf: kindIn(join(programFiles, "Niubash", NIU_EXE)),
  });
  assert.equal(resolution.found, true);
  assert.equal(resolution.path, join(programFiles, "Niubash", NIU_EXE));
  assert.equal(resolution.source, "%ProgramFiles%");

  const missing = resolveNiu({
    env: { PATH: "", LOCALAPPDATA: localAppData, ProgramFiles: programFiles },
    kindOf: () => "missing",
  });
  assert.equal(missing.found, false);
  assert.deepEqual(
    missing.checked.map((candidate) => candidate.path),
    candidates.map((candidate) => candidate.path),
  );
  assert.ok(missing.checked.every((candidate) => candidate.kind === "missing"));
  assert.equal(missing.overrideSet, false);
});

test("PI_NIUBASH_PATH pointing at a directory is reported as not a file", () => {
  const directory = join("windows");
  const resolution = resolveNiu({
    env: { [ENV_OVERRIDE]: directory },
    kindOf: allKind("other"),
  });
  assert.equal(resolution.found, false);
  assert.deepEqual(resolution.checked, [{ path: directory, source: "PI_NIUBASH_PATH", kind: "other" }]);
  assert.equal(resolution.overrideSet, true);

  const message = unavailableMessage(resolution);
  assert.match(message, /not a file: a directory or another special file/);
  assert.match(message, /PI_NIUBASH_PATH must point at the niu\.exe file itself/);
  assert.match(message, /PI_NIUBASH_PATH is set, so PATH and the standard install directories were not searched/);
  assert.equal(message.split(directory).length - 1, 1, "the same path must be listed exactly once");
  assert.doesNotMatch(message, /not installed/);
});

test("a directory on PATH is skipped instead of being registered as niu.exe", () => {
  const directory = join("bin");
  const toolbox = join("toolbox");
  const resolution = resolveNiu({
    env: { PATH: [directory, toolbox].join(delimiter) },
    platform: "win32",
    kindOf: (path) =>
      path === win32.join(toolbox, NIU_EXE) ? "file" : path === win32.join(directory, NIU_EXE) ? "other" : "missing",
  });
  assert.equal(resolution.found, true);
  assert.equal(resolution.path, win32.join(toolbox, NIU_EXE));
});

test("a PATH-derived non-file is not blamed on PI_NIUBASH_PATH", () => {
  const localAppData = join("LA");
  const notFile = join("bin", NIU_EXE);
  const resolution = resolveNiu({
    env: { PATH: join("bin"), LOCALAPPDATA: localAppData },
    kindOf: (path) => (path === notFile ? "other" : "missing"),
  });
  assert.equal(resolution.found, false);
  assert.equal(resolution.overrideSet, false);

  const message = unavailableMessage(resolution);
  assert.equal(message.split(notFile).length - 1, 1);
  assert.match(message, /No usable niu\.exe was found; the candidates marked above are not files/);
  assert.doesNotMatch(message, /PI_NIUBASH_PATH is set/);
  assert.doesNotMatch(message, /not installed/);

  // The notification keeps the source, so it cannot send the user to the wrong setting either.
  const notice = unavailableNotice(resolution);
  assert.doesNotMatch(notice, /PI_NIUBASH_PATH points at/);
  assert.match(notice, /some candidates are not files/);
});

test("an unverified candidate (Windows Store alias / ACL) is handed to spawn", () => {
  const alias = join("WindowsApps", NIU_EXE);
  const resolution = resolveNiu({
    env: { [ENV_OVERRIDE]: alias },
    kindOf: allKind("unverified"),
  });
  assert.deepEqual(resolution, {
    found: true,
    path: alias,
    source: "PI_NIUBASH_PATH",
    verified: false,
  });
});

test("an unexpanded %NAME% in the override gets a specific hint", () => {
  const raw = "%LOCALAPPDATA%/Programs/Niubash/niu.exe";
  assert.equal(hasUnexpandedVariable(raw), true);
  assert.equal(hasUnexpandedVariable("C:/Tools/niu.exe"), false);

  const resolution = resolveNiu({
    env: { [ENV_OVERRIDE]: raw },
    kindOf: () => "missing",
  });
  assert.equal(resolution.found, false);
  assert.equal(resolution.unexpandedVariable, true);

  const message = unavailableMessage(resolution);
  assert.match(message, /unexpanded %NAME% reference/);
  assert.equal(message.split(raw).length - 1, 1, "the literal value must be shown once");

  const notice = unavailableNotice(resolution);
  assert.match(notice, /unexpanded %NAME%/);
});

test("the notification names the source of the failure", () => {
  assert.match(
    unavailableNotice(failure({ checked: [{ path: "C:\\gone\\niu.exe", source: "PI_NIUBASH_PATH", kind: "missing" }], overrideSet: true })),
    /PI_NIUBASH_PATH points at C:\\gone\\niu\.exe/,
  );
  assert.match(
    unavailableNotice(failure({ checked: [{ path: "C:\\dir", source: "PI_NIUBASH_PATH", kind: "other" }], overrideSet: true })),
    /which is not a niu\.exe file/,
  );
  assert.match(
    unavailableNotice(failure({ checked: [{ path: "C:\\bin\\niu.exe", source: "PATH", kind: "missing" }] })),
    /Install it or set PI_NIUBASH_PATH/,
  );
});

// --- the production stat probe, on real files and directories --------------

const tempRoot = mkdtempSync(join(tmpdir(), "pi-niubash-unit-"));
after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

test("the production probe accepts a real niu.exe file", () => {
  const directory = join(tempRoot, "real-file");
  mkdirSync(directory, { recursive: true });
  const exe = join(directory, NIU_EXE);
  writeFileSync(exe, "MZ");

  const resolution = resolveNiu({ env: { [ENV_OVERRIDE]: exe } });
  assert.equal(resolution.found, true);
  assert.equal(resolution.path, exe);
  assert.equal(resolution.source, "PI_NIUBASH_PATH");
  assert.equal(resolution.verified, true);
});

test("the production probe rejects a real directory named niu.exe", () => {
  const directory = join(tempRoot, "real-directory");
  const exeLookalike = join(directory, NIU_EXE);
  mkdirSync(exeLookalike, { recursive: true });

  const resolution = resolveNiu({ env: { [ENV_OVERRIDE]: exeLookalike } });
  assert.equal(resolution.found, false);
  assert.deepEqual(resolution.checked, [{ path: exeLookalike, source: "PI_NIUBASH_PATH", kind: "other" }]);
});

test("the production probe skips a directory on PATH but finds a real file", () => {
  const bin = join(tempRoot, "bin");
  const toolbox = join(tempRoot, "toolbox");
  mkdirSync(join(bin, NIU_EXE), { recursive: true });
  mkdirSync(toolbox, { recursive: true });
  const exe = join(toolbox, NIU_EXE);
  writeFileSync(exe, "MZ");

  const resolution = resolveNiu({
    env: { PATH: [bin, toolbox].join(delimiter) },
  });
  assert.equal(resolution.found, true);
  assert.equal(resolution.path, exe);
  assert.equal(resolution.source, "PATH");
});

// --- platform gate ---------------------------------------------------------

test("only Windows is supported", () => {
  assert.equal(isSupportedPlatform("win32"), true);
  for (const platform of ["linux", "darwin", "freebsd", "aix"]) {
    assert.equal(isSupportedPlatform(platform), false, platform);
  }
});

test("nothing found yields an empty or useful checked list", () => {
  const resolution = resolveNiu({ env: { PATH: "" }, kindOf: () => "missing" });
  assert.equal(resolution.found, false);
  assert.deepEqual(resolution.checked, []);
  assert.match(unavailableMessage(resolution), /no candidate paths/);
});

// --- definition wiring -----------------------------------------------------

test("the healthy definition wires the normal metadata exactly", async () => {
  const { sdk, calls, operations: baseOperations } = createFakeSdk();
  const definition = createNiubashDefinition(sdk, "D:/work", "C:/niu/niu.exe");

  assert.deepEqual(calls.operations, [{ shellPath: "C:/niu/niu.exe" }]);
  assert.equal(calls.definitions.length, 1);
  assert.equal(calls.definitions[0].cwd, "D:/work");
  assert.notEqual(
    calls.definitions[0].options.operations,
    baseOperations,
    "the definition must wrap the operations boundary instead of wrapping execute",
  );
  await definition.execute("unit", { command: "echo hi" }, undefined, undefined, { cwd: "D:/work" });

  assert.equal(definition.name, TOOL_NAME);
  assert.equal(definition.label, TOOL_LABEL);
  assert.equal(definition.description, DESCRIPTION);
  assert.equal(definition.promptSnippet, PROMPT_SNIPPET);
  assert.deepEqual(definition.promptGuidelines, [...PROMPT_GUIDELINES]);
  assert.equal(definition.defaultActive, false, "the tool must stay opt-in");
  assert.equal(definition.parameters, PARAMETERS);
  assert.equal(definition.outputSchema, OUTPUT_SCHEMA);
  assert.equal(definition.renderCall, RENDER_CALL);
  assert.equal(definition.renderResult, RENDER_RESULT);
});

test("the unavailable stub wires the degraded metadata exactly", async () => {
  const { sdk, calls } = createFakeSdk();
  const diagnostic = failure({
    checked: [
      { path: "C:\\missing\\niu.exe", source: "PATH", kind: "missing" },
      { path: "C:\\other\\niu.exe", source: "%ProgramFiles%", kind: "other" },
    ],
  });
  const definition = createUnavailableDefinition(sdk, "D:/work", diagnostic);

  assert.equal(calls.definitions.length, 1, "the stub reuses the built-in schema");
  assert.equal(calls.operations.length, 0);
  assert.equal(definition.name, TOOL_NAME);
  assert.equal(definition.label, TOOL_LABEL);
  assert.equal(definition.description, UNAVAILABLE_DESCRIPTION);
  assert.equal(definition.promptSnippet, UNAVAILABLE_SNIPPET);
  assert.deepEqual(definition.promptGuidelines, [...UNAVAILABLE_GUIDELINES]);
  assert.equal(definition.defaultActive, false, "the stub must stay opt-in too");
  assert.equal(definition.parameters, PARAMETERS);
  assert.equal(definition.outputSchema, OUTPUT_SCHEMA);
  assert.equal(definition.renderCall, RENDER_CALL);
  assert.equal(definition.renderResult, RENDER_RESULT);

  await assert.rejects(
    () => definition.execute("unit", { command: "echo hi" }, undefined, undefined, { cwd: "D:/work" }),
    (error) => {
      assert.equal(error.message, unavailableMessage(diagnostic));
      for (const candidate of diagnostic.checked) {
        assert.ok(error.message.includes(candidate.path), `missing ${candidate.path}`);
      }
      return true;
    },
  );
});

// --- startup error boundary -------------------------------------------------

const STARTUP_GUIDANCE = /Could not start niu\.exe at C:\/niu\/niu\.exe: the file does not exist or cannot be executed/;

function startupError(code, syscall = "spawn", message = `spawn ${code}`) {
  return Object.assign(new Error(message), { code, syscall });
}

for (const [label, error] of [
  ["a missing file after load", Object.assign(new Error("Custom shell path not found: C:/niu/niu.exe"), {})],
  ["a directory (ENOENT on spawn)", startupError("ENOENT", "spawn C:/niu/niu.exe")],
  ["a zero-byte executable (EFTYPE)", startupError("EFTYPE", "spawn")],
  ["an unloadable image (UNKNOWN)", startupError("UNKNOWN", "spawn")],
]) {
  test(`startup guidance covers ${label}`, () => {
    const mapped = describeStartupError(error, "C:/niu/niu.exe");
    assert.notEqual(mapped, error);
    assert.match(mapped.message, STARTUP_GUIDANCE);
    assert.equal(mapped.cause, error, "the original error must be preserved as cause");
    if (error.code) assert.equal(mapped.code, error.code, "the errno code must be preserved");
  });
}

test("startup guidance keeps the command-line limit actionable", () => {
  const mapped = describeStartupError(startupError("ENAMETOOLONG"), "C:/niu/niu.exe");
  assert.match(mapped.message, /Command line too long: Windows limits a single command to about 32K characters/);
  assert.equal(mapped.code, "ENAMETOOLONG");
});

for (const [label, error] of [
  ["a timeout", new Error("timeout:2")],
  ["an abort", new Error("aborted")],
  ["a missing working directory", new Error("Working directory does not exist: D:/gone\nCannot execute bash commands.")],
  ["an invalid timeout", new Error("Invalid timeout: must be a finite number of seconds")],
  ["an output temp-file open (ENOENT/open)", Object.assign(new Error("ENOENT: open 'pi-bash-x.log'"), { code: "ENOENT", syscall: "open", path: "pi-bash-x.log" })],
  ["an output temp-file read (EACCES/read)", Object.assign(new Error("EACCES: read 'pi-bash-x.log'"), { code: "EACCES", syscall: "read", path: "pi-bash-x.log" })],
]) {
  test(`startup guidance leaves ${label} untouched`, () => {
    assert.equal(describeStartupError(error, "C:/niu/niu.exe"), error);
  });
}

test("the definition only wraps the operations boundary", async () => {
  const openError = Object.assign(new Error("ENOENT: no such file or directory, open 'pi-bash-x.log'"), {
    code: "ENOENT",
    syscall: "open",
    path: "pi-bash-x.log",
  });
  const { sdk } = createFakeSdk({ afterExecError: openError });
  const definition = createNiubashDefinition(sdk, "D:/work", "C:/niu/niu.exe");
  await assert.rejects(
    () => definition.execute("unit", { command: "echo hi" }, undefined, undefined, { cwd: "D:/work" }),
    (error) => {
      assert.equal(error, openError, "post-exec file errors must not be rewritten as spawn guidance");
      return true;
    },
  );
});

test("the operations boundary wraps a real spawn failure", async () => {
  const spawnError = startupError("EFTYPE", "spawn");
  const { sdk, calls } = createFakeSdk({ exec: async () => { throw spawnError; } });
  const definition = createNiubashDefinition(sdk, "D:/work", "C:/niu/niu.exe");
  await assert.rejects(
    () => definition.execute("unit", { command: "echo hi" }, undefined, undefined, { cwd: "D:/work" }),
    (error) => {
      assert.match(error.message, STARTUP_GUIDANCE);
      assert.equal(error.cause, spawnError);
      assert.equal(error.code, "EFTYPE");
      return true;
    },
  );
  assert.equal(calls.operations[0].shellPath, "C:/niu/niu.exe");
});

// --- model-facing text -----------------------------------------------------

test("tool identity is stable and does not shadow built-ins", () => {
  assert.equal(TOOL_NAME, "niubash");
  assert.equal(TOOL_LABEL, "Niubash");
  assert.ok(PROMPT_SNIPPET.includes("Niubash"));
  assert.ok(PROMPT_SNIPPET.length <= 120, "prompt snippet must stay short");
});

test("description states the load-bearing contract and fits the context budget", () => {
  assert.ok(DESCRIPTION.length <= 1400, `description is ${DESCRIPTION.length} characters`);
  for (const fact of [
    "Niubash",
    "niu -c",
    `${MAX_OUTPUT_LINES} lines`,
    `${MAX_OUTPUT_BYTES / 1024}KB`,
    "timeout",
    "niugit",
    "USERPROFILE",
    "PTY",
  ]) {
    assert.ok(DESCRIPTION.includes(fact), `description must mention ${JSON.stringify(fact)}`);
  }
});

test("every guideline names the tool and the shell split is explicit", () => {
  assert.ok(PROMPT_GUIDELINES.length >= 3);
  for (const guideline of PROMPT_GUIDELINES) {
    assert.match(guideline, /niubash/i, `guideline must name the tool: ${guideline}`);
  }
  assert.match(PROMPT_GUIDELINES[0], /powershell/);
  assert.match(PROMPT_GUIDELINES[1], /powershell/);
});

test("the unavailable stub is actionable", () => {
  assert.ok(UNAVAILABLE_DESCRIPTION.length <= 400);
  assert.match(UNAVAILABLE_DESCRIPTION, /powershell/);
  assert.match(UNAVAILABLE_SNIPPET, /unavailable/i);
  assert.doesNotMatch(UNAVAILABLE_SNIPPET, /Run bash-syntax commands/);

  const message = unavailableMessage(
    failure({
      checked: [
        { path: "C:\\a\\niu.exe", source: "PATH", kind: "missing" },
        { path: "C:\\b\\niu.exe", source: "%ProgramFiles%", kind: "missing" },
      ],
    }),
  );
  assert.ok(message.includes(ENV_OVERRIDE));
  assert.ok(message.includes("https://unixwin.dev"));
  assert.match(message, /C:\\a\\niu\.exe/);
  assert.match(message, /C:\\b\\niu\.exe/);
});

test("the unavailable stub does not inject conflicting shell-selection rules", () => {
  const rules = UNAVAILABLE_GUIDELINES.join(" ");
  assert.match(rules, /powershell/);
  assert.doesNotMatch(rules, /before the powershell tool/);
  assert.doesNotMatch(rules, /as the default shell/);
  for (const guideline of UNAVAILABLE_GUIDELINES) {
    assert.match(guideline, /niubash/i, `guideline must name the tool: ${guideline}`);
  }
});

test("model-facing text does not pin bundled tool versions", () => {
  const modelText = [DESCRIPTION, ...PROMPT_GUIDELINES, ...UNAVAILABLE_GUIDELINES, UNAVAILABLE_DESCRIPTION].join("\n");
  assert.doesNotMatch(modelText, /\b\d+\.\d+\.\d+\b/);
  assert.match(DESCRIPTION, /greater than 0/);
  assert.match(DESCRIPTION, /32K/);
});

test("output limits mirror Pi's shell pipeline", () => {
  assert.equal(MAX_OUTPUT_LINES, 2000);
  assert.equal(MAX_OUTPUT_BYTES, 50 * 1024);
});