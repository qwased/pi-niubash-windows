#!/usr/bin/env node
/**
 * End-to-end smoke test: real `niu.exe`, real Pi shell pipeline, real command output.
 *
 * Three modes:
 *   - default: full run. Skips with exit code 0 when Niubash is absent, so it can be wired into a
 *     platform matrix without failing on machines that cannot run it.
 *   - `SMOKE_REQUIRED=1`: a skip is a failure. Use it for release gates.
 *   - `SMOKE_SUBSET=stub`: run only the checks that need no Niubash install (stub wiring and the
 *     production directory probe). This is the CI gate that runs on a clean Windows runner; it
 *     prints that Niubash-dependent checks were skipped instead of reporting a full pass.
 *
 * An explicit `PI_CODING_AGENT_SDK` is authoritative: if it does not resolve to the Pi SDK, the
 * run fails instead of silently falling back to the locally installed copy.
 *
 * Usage:
 *   npm run test:smoke
 *   PI_CODING_AGENT_SDK=/path/to/@earendil-works/pi-coding-agent npm run test:smoke
 *   SMOKE_REQUIRED=1 npm run test:smoke
 *   SMOKE_SUBSET=stub node test/smoke.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveNiu } from "../src/niu.ts";
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
} from "../src/prompt.ts";
import { createNiubashDefinition, createUnavailableDefinition } from "../src/tool.ts";

const REQUIRED = process.env.SMOKE_REQUIRED === "1";
const SUBSET = process.env.SMOKE_SUBSET ?? "";
const SUBSET_STUB = SUBSET === "stub";

async function importIfPossible(specifier) {
  try {
    let target = specifier;
    if (existsSync(specifier)) {
      const dist = join(specifier, "dist", "index.js");
      target = pathToFileURL(existsSync(dist) ? dist : specifier).href;
    }
    return await import(target);
  } catch {
    return undefined;
  }
}

/**
 * Thrown by `fail` to unwind the run without calling `process.exit`.
 *
 * On Windows, `process.exit(1)` while ESM evaluation is still unwinding trips a libuv assertion
 * (`uv_async_send` on a closing handle) and aborts with 0xC0000409 instead of exiting 1. Setting
 * `exitCode` and letting the loop drain keeps the documented exit status.
 */
class SmokeAbort extends Error {}

process.on("uncaughtException", (error) => {
  if (error instanceof SmokeAbort) return;
  console.error("UNEXPECTED", error);
  process.exitCode = 1;
});

/** End the run with exit status 1. */
function abort() {
  process.exitCode = 1;
  throw new SmokeAbort("smoke run aborted");
}

function fail(message) {
  console.error(`FAIL ${message}`);
  abort();
}

async function loadSdk() {
  const explicit = process.env.PI_CODING_AGENT_SDK;
  if (explicit) {
    const sdk = await importIfPossible(explicit);
    if (!sdk?.createBashToolDefinition || !sdk?.createLocalBashOperations) {
      fail(
        `PI_CODING_AGENT_SDK=${explicit} does not resolve to the Pi SDK. ` +
          "An explicit SDK path is authoritative; fix it instead of relying on a fallback.",
      );
    }
    return sdk;
  }

  const attempts = ["@earendil-works/pi-coding-agent"];
  const npmRoot = spawnSync("npm root -g", { encoding: "utf8", shell: true });
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
    attempts.push(join(npmRoot.stdout.trim(), "@earendil-works", "pi-coding-agent"));
  }

  for (const attempt of attempts) {
    const sdk = await importIfPossible(attempt);
    if (sdk?.createBashToolDefinition && sdk?.createLocalBashOperations) return sdk;
  }
  return undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Probe a PID. Locale-independent (`tasklist` output is translated, `Get-Process` existence is
 * not). A probe failure throws: it must never be read as "the process is gone".
 */
function pidAlive(pid) {
  const script = `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { "1" } else { "0" }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`PID probe failed for ${pid}: ${result.error.message}`);
  }
  const output = (result.stdout || "").trim();
  if (output === "1") return true;
  if (output === "0") return false;
  throw new Error(
    `PID probe for ${pid} returned unexpected output ${JSON.stringify(output)} ` +
      `(status ${result.status}, stderr ${JSON.stringify((result.stderr || "").trim())})`,
  );
}

/** Wait until a PID disappears, polling for at most `timeoutMs` after an initial settle delay. */
async function waitUntilGone(pid, timeoutMs = 10000) {
  await sleep(200);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(200);
  }
  return false;
}

const sdk = await loadSdk();
if (!sdk) {
  if (REQUIRED || SUBSET_STUB) {
    fail("Pi SDK not resolvable. Set PI_CODING_AGENT_SDK to the pi-coding-agent package or dist/index.js.");
  }
  console.log("SKIP: Pi SDK not resolvable. Set PI_CODING_AGENT_SDK to the pi-coding-agent package or dist/index.js.");
  process.exit(0);
}

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

// --- checks that need no Niubash install ---------------------------------------------------

await check("registers an unavailable stub with the exact degraded metadata", async () => {
  const diagnostic = {
    checked: [
      { path: "C:\\missing\\niu.exe", source: "PATH", kind: "missing" },
      { path: "C:\\other\\niu.exe", source: "%ProgramFiles%", kind: "other" },
    ],
    overrideSet: false,
    unexpandedVariable: false,
  };
  const stub = createUnavailableDefinition(sdk, process.cwd(), diagnostic);
  assert.equal(stub.name, TOOL_NAME);
  assert.equal(stub.label, TOOL_LABEL);
  assert.equal(stub.description, UNAVAILABLE_DESCRIPTION);
  assert.equal(stub.promptSnippet, UNAVAILABLE_SNIPPET);
  assert.deepEqual(stub.promptGuidelines, [...UNAVAILABLE_GUIDELINES]);
  assert.equal(stub.defaultActive, false);
  assert.ok(stub.parameters, "the stub must keep the command schema");
  assert.ok(stub.outputSchema, "the stub must keep the structured output schema");
  assert.equal(typeof stub.renderCall, "function");
  assert.equal(typeof stub.renderResult, "function");
  await assert.rejects(
    () => stub.execute("smoke", { command: "echo hi" }, undefined, undefined, { cwd: process.cwd() }),
    (error) => {
      assert.equal(error.message, unavailableMessage(diagnostic));
      return true;
    },
  );
});

await check("rejects a real directory in PI_NIUBASH_PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-niubash-smoke-"));
  try {
    const directory = join(root, "niu.exe");
    mkdirSync(directory);
    const resolution = resolveNiu({ env: { PI_NIUBASH_PATH: directory, PATH: "" } });
    assert.equal(resolution.found, false);
    assert.deepEqual(resolution.checked, [{ path: directory, source: "PI_NIUBASH_PATH", kind: "other" }]);
    assert.equal(resolution.overrideSet, true);
    const message = unavailableMessage(resolution);
    assert.equal(message.split(directory).length - 1, 1, "the path must be listed exactly once");
    assert.match(message, /not a file: a directory or another special file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

if (SUBSET_STUB) {
  if (failures.length > 0) {
    console.log(`\n${failures.length} stub subset check(s) failed: ${failures.join(", ")}`);
    abort();
  }
  console.log("\nsubset complete: stub/directory checks passed; Niubash-dependent checks were skipped");
  process.exit(0);
}

const niu = resolveNiu();
if (!niu.found) {
  const message = "Niubash (niu.exe) not found. Checked:\n" + niu.checked.map((candidate) => `  - ${candidate.path} (${candidate.kind})`).join("\n");
  if (REQUIRED) fail(message);
  console.log(`SKIP: ${message}`);
  if (failures.length > 0) abort();
  process.exit(0);
}

console.log(`niubash: ${niu.path} (${niu.source})`);
console.log(`sdk:     ${sdk.VERSION ?? "pi-coding-agent"}`);

const definition = createNiubashDefinition(sdk, process.cwd(), niu.path);
const ctx = {
  cwd: process.cwd(),
  sessionManager: { getSessionId: () => "pi-niubash-smoke", getSessionFile: () => undefined },
  model: { provider: "smoke", id: "smoke" },
  thinkingLevel: "off",
};

const run = (params) => definition.execute("smoke", params, undefined, undefined, ctx);

/** Attach handlers immediately so a rejection can never become an unhandled rejection. */
function settle(promise) {
  return promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
}

await check("definition replace the tool identity and keep the healthy metadata", () => {
  assert.equal(definition.name, TOOL_NAME);
  assert.equal(definition.label, TOOL_LABEL);
  assert.equal(definition.description, DESCRIPTION);
  assert.equal(definition.promptSnippet, PROMPT_SNIPPET);
  assert.deepEqual(definition.promptGuidelines, [...PROMPT_GUIDELINES]);
  assert.equal(definition.defaultActive, false);
  assert.ok(definition.outputSchema);
  assert.equal(typeof definition.renderCall, "function");
  assert.equal(typeof definition.renderResult, "function");
});

await check("output limits still match the pipeline constants", () => {
  assert.equal(sdk.DEFAULT_MAX_LINES, MAX_OUTPUT_LINES);
  assert.equal(sdk.DEFAULT_MAX_BYTES, MAX_OUTPUT_BYTES);
});

await check("runs bash syntax with UTF-8 output", async () => {
  const result = await run({ command: "echo hi; printf '%s\\n' '你好 世界'; pwd" });
  assert.equal(result.structuredContent.exit_code, 0);
  const text = result.content[0].text;
  assert.match(text, /^hi$/m);
  assert.ok(text.includes("你好 世界"), "CJK output must be intact UTF-8");
  assert.ok(text.includes(process.cwd().split(/[\\/]/).pop()), "pwd must be the session working directory");
});

await check("passes quotes and a trailing backslash through a native child's argv", async () => {
  // `printf` is a Niubash builtin: it proves the parser, not the spawn boundary. A native
  // child's argv is the boundary a pipeline can corrupt (rubash#3511), so use node here.
  const result = await run({
    command: `node -e "process.stdout.write(process.argv.slice(1).join('|'))" 'a"b' 'C:\\dir\\'`,
  });
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.content[0].text.trim(), 'a"b|C:\\dir\\');
});

await check("keeps apostrophes in a piped native-child arg (known upstream rubash#3511)", async () => {
  // Niubash 1.5.0 ships a rubash before 0ef814fb: a double-quoted word that mixes a live
  // command substitution with an apostrophe reaches the pipeline child with U+0017 instead
  // of `'`. The upstream fix is merged; this probe becomes a strict assertion once the
  // pinned engine carries it (next Niubash release after 1.5.0).
  const result = await run({
    command: `node -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" "it's \`echo now\`" | cat`,
  });
  assert.equal(result.structuredContent.exit_code, 0);
  const text = result.content[0].text.trim();
  if (text === `["it's now"]`) return;
  if (text === '["it\\u0017s now"]') {
    console.log(
      "     known upstream defect (rubash#3511): apostrophe degraded to U+0017; " +
        "fix merged, pending the Niubash pin bump",
    );
    return;
  }
  assert.fail(`unexpected piped argv: ${text}`);
});

await check("isolates concurrent calls and exposes the Pi session id", async () => {
  const [slow, fast] = await Promise.all([
    run({ command: "sleep 0.3; printf '%s' one" }),
    run({ command: "printf '%s' \"$PI_SESSION_ID\"" }),
  ]);
  assert.equal(slow.content[0].text.trim(), "one");
  assert.equal(fast.content[0].text.trim(), "pi-niubash-smoke");
});

await check("executes through Niubash, not Git Bash or WSL", async () => {
  const result = await run({ command: "command -v ls; echo \"$NIU_SHELL\"" });
  assert.match(result.content[0].text, /winuxcmd/i);
  assert.match(result.content[0].text, /niu\.exe/i);
});

await check("propagates non-zero exit codes", async () => {
  const result = await run({ command: "exit 3" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.exit_code, 3);
  assert.match(result.content[0].text, /Command exited with code 3/);
});

await check("keeps the tail and persists full output when truncated by lines", async () => {
  const total = MAX_OUTPUT_LINES + 1000;
  const result = await run({ command: `for i in $(seq 1 ${total}); do echo "line $i"; done` });
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.details.truncation.truncated, true);
  assert.equal(result.details.truncation.truncatedBy, "lines");
  assert.equal(result.details.truncation.totalLines, total);
  assert.equal(result.details.truncation.outputLines, MAX_OUTPUT_LINES);
  assert.equal(result.details.truncation.lastLinePartial, false);
  assert.match(result.content[0].text, /\[Showing lines 1001-3000 of 3000\./);
  assert.ok(existsSync(result.details.fullOutputPath), "full output file must exist");
});

await check("truncates many short lines by bytes and keeps whole lines", async () => {
  // 1000 lines * 61 bytes = 61000 bytes: over the 50KB byte cap, well under 2000 lines.
  const result = await run({ command: "awk 'BEGIN{for(i=0;i<1000;i++) printf \"%060d\\n\", i}'" });
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.details.truncation.truncated, true);
  assert.equal(result.details.truncation.truncatedBy, "bytes");
  assert.equal(result.details.truncation.totalLines, 1000);
  assert.equal(result.details.truncation.lastLinePartial, false);
  assert.match(result.content[0].text, /\(50\.0KB limit\)/);
  assert.doesNotMatch(result.content[0].text, /line is /);
});

await check("truncates a single over-long line and flags a partial line", async () => {
  const result = await run({ command: "awk 'BEGIN{for(i=0;i<60000;i++) printf \"x\"; print \"\"}'" });
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.details.truncation.truncated, true);
  assert.equal(result.details.truncation.truncatedBy, "bytes");
  assert.equal(result.details.truncation.lastLinePartial, true);
  assert.match(result.content[0].text, /\[Showing last 50\.0KB of line 1 \(line is /);
});

await check("caps the structured payload at 1MB and reports the temp file", async () => {
  const result = await run({ command: "awk 'BEGIN{for(i=0;i<20000;i++) printf \"%060d\\n\", i}'" });
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.structuredContent.truncated, true);
  // Head + tail plus the omission marker: the marker itself is the only overshoot.
  assert.ok(result.structuredContent.output.length <= 1024 * 1024 + 256);
  assert.ok(result.structuredContent.output.length > 1000 * 1000);
  assert.match(result.structuredContent.output, /\[\.\.\. \d+ bytes omitted \.\.\.\]/);
  assert.ok(existsSync(result.structuredContent.full_output_path), "full_output_path must exist");
});

await check("PID probe can see a live process", () => {
  assert.equal(pidAlive(process.pid), true, "the probe must not confuse a probe failure with a dead PID");
});

await check("enforces timeouts and removes the shell and its child", async () => {
  const settled = settle(run({ command: "echo \"shell=$$\"; sleep 37 & child=$!; echo \"child=$child\"; wait $child", timeout: 2 }));
  const { error } = await settled;
  assert.ok(error, "the command must time out");
  assert.match(error.message, /Command timed out after 2 seconds/);
  const shellPid = Number((error.message.match(/shell=(\d+)/) || [])[1]);
  const childPid = Number((error.message.match(/child=(\d+)/) || [])[1]);
  assert.ok(shellPid > 0, "the timeout error must preserve the shell PID");
  assert.ok(childPid > 0, "the timeout error must preserve the child PID");
  assert.equal(await waitUntilGone(shellPid), true, `shell ${shellPid} still alive after timeout`);
  assert.equal(await waitUntilGone(childPid), true, `child ${childPid} still alive after timeout`);
});

await check("aborts and removes the shell and its child", async () => {
  const controller = new AbortController();
  let seen = "";
  const settled = settle(
    definition.execute(
      "smoke",
      { command: "echo \"shell=$$\"; sleep 30 & child=$!; echo \"child=$child\"; wait $child" },
      controller.signal,
      (update) => {
        const text = update?.content?.[0]?.text ?? "";
        if (text.includes("child=")) seen = text;
      },
      ctx,
    ),
  );
  const sawOutput = await waitFor(() => seen.includes("child="), 5000);
  controller.abort();

  const { error } = await settled;
  assert.ok(error, "the command must abort");
  assert.match(error.message, /Command aborted/);
  assert.ok(sawOutput, "abort must leave the captured output available on the update stream");
  const shellPid = Number((error.message.match(/shell=(\d+)/) || [])[1]);
  const childPid = Number((error.message.match(/child=(\d+)/) || [])[1]);
  assert.ok(shellPid > 0, "abort must preserve the shell PID");
  assert.ok(childPid > 0, "abort must preserve the child PID");
  assert.equal(await waitUntilGone(shellPid), true, `shell ${shellPid} still alive after abort`);
  assert.equal(await waitUntilGone(childPid), true, `child ${childPid} still alive after abort`);
});

await check("explains the Windows command-line limit", async () => {
  await assert.rejects(
    () => run({ command: "echo " + "x".repeat(40000) }),
    /Command line too long: Windows limits a single command to about 32K characters/,
  );
});

await check("explains a directory standing in for niu.exe", async () => {
  const directory = join(process.env.SystemRoot || "C:\\Windows", "System32");
  const broken = createNiubashDefinition(sdk, process.cwd(), directory);
  await assert.rejects(
    () => broken.execute("smoke", { command: "echo hi" }, undefined, undefined, ctx),
    /Could not start niu\.exe at .*System32/,
  );
});

await check("explains a niu.exe that disappeared after resolution", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-niubash-gone-"));
  try {
    const gone = join(root, "niu.exe");
    const broken = createNiubashDefinition(sdk, process.cwd(), gone);
    await assert.rejects(
      () => broken.execute("smoke", { command: "echo hi" }, undefined, undefined, ctx),
      /Could not start niu\.exe at .*niu\.exe: the file does not exist or cannot be executed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("explains a zero-byte (EFTYPE) niu.exe", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-niubash-empty-"));
  try {
    const empty = join(root, "niu.exe");
    writeFileSync(empty, "");
    const broken = createNiubashDefinition(sdk, process.cwd(), empty);
    await assert.rejects(
      () => broken.execute("smoke", { command: "echo hi" }, undefined, undefined, ctx),
      (error) => {
        assert.match(error.message, /Could not start niu\.exe at .*niu\.exe: the file does not exist or cannot be executed/);
        assert.doesNotMatch(error.message, /^spawn EFTYPE/);
        assert.equal(error.code, "EFTYPE");
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("keeps the missing-working-directory error verbatim", async () => {
  await assert.rejects(
    () => definition.execute("smoke", { command: "echo hi" }, undefined, undefined, {
      ...ctx,
      cwd: join(tmpdir(), `pi-niubash-no-cwd-${Date.now()}`),
    }),
    (error) => {
      assert.match(error.message, /^Working directory does not exist: .*\nCannot execute bash commands\.$/);
      return true;
    },
  );
});

await check("keeps the invalid-timeout error verbatim", async () => {
  await assert.rejects(
    () => run({ command: "echo hi", timeout: 0 }),
    (error) => {
      assert.equal(error.message, "Invalid timeout: must be a finite number of seconds");
      return true;
    },
  );
});

await check("honours a fractional timeout", async () => {
  await assert.rejects(
    () => run({ command: "sleep 5", timeout: 0.5 }),
    (error) => {
      assert.match(error.message, /^Command timed out after 0\.5 seconds/);
      return true;
    },
  );
});

await check("rejects a timeout above the maximum", async () => {
  await assert.rejects(
    () => run({ command: "echo hi", timeout: 1e9 }),
    (error) => {
      assert.equal(error.message, "Invalid timeout: maximum is 2147483.647 seconds");
      return true;
    },
  );
});

await check("supports heredocs and pipes", async () => {
  const result = await run({ command: "cat <<EOF | tr a-z A-Z\nhello\nworld\nEOF" });
  assert.match(result.content[0].text, /HELLO\nWORLD/);
});

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  abort();
}

console.log("\nall smoke checks passed");