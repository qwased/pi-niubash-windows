#!/usr/bin/env node
/**
 * End-to-end smoke test: real `niu.exe`, real Pi shell pipeline, real command output.
 *
 * Skips with exit code 0 when either Niubash or the Pi SDK is unavailable, so it can be wired into
 * a platform matrix without failing on machines that cannot run it.
 *
 * Usage:
 *   npm run test:smoke
 *   PI_CODING_AGENT_SDK=/path/to/@earendil-works/pi-coding-agent npm run test:smoke
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveNiu } from "../src/niu.ts";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES, TOOL_NAME } from "../src/prompt.ts";
import { createNiubashDefinition, createUnavailableDefinition } from "../src/tool.ts";

async function importIfPossible(specifier) {
  try {
    const resolved = existsSync(specifier)
      ? pathToFileURL(existsSync(join(specifier, "dist", "index.js")) ? join(specifier, "dist", "index.js") : specifier).href
      : specifier;
    return await import(resolved);
  } catch {
    return undefined;
  }
}

async function loadSdk() {
  const attempts = [];
  if (process.env.PI_CODING_AGENT_SDK) attempts.push(process.env.PI_CODING_AGENT_SDK);
  attempts.push("@earendil-works/pi-coding-agent");

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

/** Locale-independent: `tasklist` output is translated, `Get-Process` existence is not. */
function pidAlive(pid) {
  const script = `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { "1" } else { "0" }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  return (result.stdout || "").trim() === "1";
}

const sdk = await loadSdk();
if (!sdk) {
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

// The stub needs no Niubash install, so it runs before the skip below.
await check("registers an unavailable stub without conflicting prompt rules", async () => {
  const stub = createUnavailableDefinition(sdk, process.cwd(), ["C:\\missing\\niu.exe"], []);
  assert.equal(stub.name, TOOL_NAME);
  assert.match(stub.description, /Unavailable/);
  assert.match(stub.promptSnippet, /Unavailable/);
  assert.doesNotMatch(stub.promptGuidelines.join(" "), /before the powershell tool/);
  await assert.rejects(() => stub.execute("smoke", { command: "echo hi" }), /was not found/);
});

await check("rejects a directory in PI_NIUBASH_PATH", () => {
  const directory = join(process.env.SystemRoot || "C:\\Windows", "System32");
  const resolution = resolveNiu({ env: { PI_NIUBASH_PATH: directory, PATH: "" } });
  assert.equal(resolution.found, false);
  assert.deepEqual(resolution.notFile, [directory]);
});

const niu = resolveNiu();
if (!niu.found) {
  console.log("SKIP: Niubash (niu.exe) not found. Checked:");
  for (const path of niu.checked) console.log(`  - ${path}`);
  process.exit(failures.length > 0 ? 1 : 0);
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

await check("definition replaces the tool identity", () => {
  assert.equal(definition.name, TOOL_NAME);
  assert.equal(definition.label, "Niubash");
  assert.ok(definition.description.includes("Niubash"));
  assert.ok(Array.isArray(definition.promptGuidelines));
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

await check("keeps the tail and persists full output when truncated", async () => {
  const total = MAX_OUTPUT_LINES + 1000;
  const result = await run({ command: `for i in $(seq 1 ${total}); do echo "line $i"; done` });
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.details.truncation.truncated, true);
  assert.equal(result.details.truncation.truncatedBy, "lines");
  assert.equal(result.details.truncation.totalLines, total);
  assert.equal(result.details.truncation.outputLines, MAX_OUTPUT_LINES);
  assert.ok(existsSync(result.details.fullOutputPath), "full output file must exist");
});

await check("truncates by bytes and flags a partial last line", async () => {
  const result = await run({ command: "awk 'BEGIN{for(i=0;i<60000;i++) printf \"x\"; print \"\"}'" });
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.details.truncation.truncated, true);
  assert.equal(result.details.truncation.truncatedBy, "bytes");
  assert.equal(result.details.truncation.lastLinePartial, true);
  assert.match(result.content[0].text, /\[Showing last 50\.0KB/);
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

await check("enforces timeouts and removes the process tree", async () => {
  let message = "";
  try {
    await run({ command: "echo \"shell=$$\"; sleep 37", timeout: 2 });
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /Command timed out after 2 seconds/);
  const pid = Number((message.match(/shell=(\d+)/) || [])[1]);
  assert.ok(pid > 0, "the timeout error must preserve the captured output");
  assert.equal(await waitFor(() => !pidAlive(pid), 10000), true, `process ${pid} still alive after timeout`);
});

await check("aborts and removes the process tree", async () => {
  const controller = new AbortController();
  let seen = "";
  const pending = definition.execute(
    "smoke",
    { command: "echo \"shell=$$\"; sleep 30" },
    controller.signal,
    (update) => {
      const text = update?.content?.[0]?.text ?? "";
      if (text.includes("shell=")) seen = text;
    },
    ctx,
  );
  await waitFor(() => seen.includes("shell="), 5000);
  controller.abort();

  let message = "";
  try {
    await pending;
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /Command aborted/);
  const pid = Number((message.match(/shell=(\d+)/) || [])[1]);
  assert.ok(pid > 0, "abort must preserve the captured output");
  assert.equal(await waitFor(() => !pidAlive(pid), 10000), true, `process ${pid} still alive after abort`);
});

await check("explains the Windows command-line limit", async () => {
  await assert.rejects(
    () => run({ command: "echo " + "x".repeat(40000) }),
    /Command line too long: Windows limits a single command to about 32K characters/,
  );
});

await check("explains a bad niu.exe path", async () => {
  const directory = join(process.env.SystemRoot || "C:\\Windows", "System32");
  const broken = createNiubashDefinition(sdk, process.cwd(), directory);
  await assert.rejects(
    () => broken.execute("smoke", { command: "echo hi" }, undefined, undefined, ctx),
    /Could not start niu\.exe at .*System32: the file does not exist or cannot be executed/,
  );
});

await check("supports heredocs and pipes", async () => {
  const result = await run({ command: "cat <<EOF | tr a-z A-Z\nhello\nworld\nEOF" });
  assert.match(result.content[0].text, /HELLO\nWORLD/);
});

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("\nall smoke checks passed");