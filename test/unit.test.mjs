import { test } from "node:test";
import assert from "node:assert/strict";
import { delimiter, join } from "node:path";

import {
  ENV_OVERRIDE,
  NIU_EXE,
  installDirectoryCandidates,
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
  unavailableMessage,
} from "../src/prompt.ts";

/** Fake `exists` backed by a fixed set of paths, compared case-insensitively. */
function existsIn(...paths) {
  const wanted = new Set(paths.map((path) => path.toLowerCase()));
  return (path) => wanted.has(path.toLowerCase());
}

test("PI_NIUBASH_PATH is checked first and wins over PATH", () => {
  const override = join("opt", "niubash", NIU_EXE);
  const onPath = join("toolbox", NIU_EXE);
  const resolution = resolveNiu({
    env: { [ENV_OVERRIDE]: override, PATH: join("toolbox") },
    exists: existsIn(override, onPath),
  });
  assert.deepEqual(resolution, { found: true, path: override, source: "PI_NIUBASH_PATH" });
});

test("a stale PI_NIUBASH_PATH is reported instead of silently falling back", () => {
  const stale = join("gone", NIU_EXE);
  const onPath = join("toolbox", NIU_EXE);
  const resolution = resolveNiu({
    env: { [ENV_OVERRIDE]: stale, PATH: join("toolbox") },
    exists: existsIn(onPath),
  });
  assert.equal(resolution.found, false);
  assert.deepEqual(resolution.checked, [stale]);
});

test("PI_NIUBASH_PATH accepts quotes and a leading ~", () => {
  const home = join("home", "me");
  const expected = join(home, NIU_EXE);
  const quoted = resolveNiu({
    env: { [ENV_OVERRIDE]: `  "${expected}"  ` },
    exists: existsIn(expected),
  });
  assert.equal(quoted.found, true);
  assert.equal(quoted.path, expected);

  const homeRelative = resolveNiu({
    env: { [ENV_OVERRIDE]: "~/niu.exe", USERPROFILE: home },
    exists: existsIn(expected),
  });
  assert.equal(homeRelative.found, true);
  assert.equal(homeRelative.path, expected);
});

test("PATH is scanned in order", () => {
  const first = join("first");
  const second = join("second");
  const resolution = resolveNiu({
    env: { PATH: [join("empty"), `"${second}"`, "", first].join(delimiter) },
    exists: existsIn(join(second, NIU_EXE)),
  });
  assert.equal(resolution.found, true);
  assert.equal(resolution.path, join(second, NIU_EXE));
  assert.equal(resolution.source, "PATH");
});

test("PATH candidates skip blank and whitespace-only entries", () => {
  const candidates = pathCandidates({ PATH: `; ${delimiter} ;;` }, process.platform);
  assert.deepEqual(candidates, []);
});

test("duplicate PATH entries are checked once", () => {
  const resolution = resolveNiu({
    env: { PATH: "C:\\dup;C:\\DUP" },
    platform: "win32",
    exists: () => false,
  });
  assert.equal(resolution.found, false);
  const duplicates = resolution.checked.filter((path) => path.toLowerCase().startsWith("c:\\dup"));
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
    exists: existsIn(join(programFiles, "Niubash", NIU_EXE)),
  });
  assert.equal(resolution.found, true);
  assert.equal(resolution.path, join(programFiles, "Niubash", NIU_EXE));
  assert.equal(resolution.source, "%ProgramFiles%");

  const missing = resolveNiu({
    env: { PATH: "", LOCALAPPDATA: localAppData, ProgramFiles: programFiles },
    exists: () => false,
  });
  assert.equal(missing.found, false);
  assert.deepEqual(missing.checked, candidates.map((candidate) => candidate.path));
});

test("nothing found yields an empty or useful checked list", () => {
  const resolution = resolveNiu({ env: { PATH: "" }, exists: () => false });
  assert.equal(resolution.found, false);
  assert.deepEqual(resolution.checked, []);
  assert.match(unavailableMessage(resolution.checked), /no candidate paths/);
});

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

  const message = unavailableMessage(["C:\\a\\niu.exe", "C:\\b\\niu.exe"]);
  assert.ok(message.includes(ENV_OVERRIDE));
  assert.ok(message.includes("https://unixwin.dev"));
  assert.match(message, /C:\\a\\niu\.exe/);
  assert.match(message, /C:\\b\\niu\.exe/);
});

test("output limits mirror Pi's shell pipeline", () => {
  assert.equal(MAX_OUTPUT_LINES, 2000);
  assert.equal(MAX_OUTPUT_BYTES, 50 * 1024);
});