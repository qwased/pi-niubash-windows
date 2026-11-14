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
import { createNiubashDefinition } from "../src/tool.ts";

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

const sdk = await loadSdk();
if (!sdk) {
  console.log("SKIP: Pi SDK not resolvable. Set PI_CODING_AGENT_SDK to the pi-coding-agent package or dist/index.js.");
  process.exit(0);
}

const niu = resolveNiu();
if (!niu.found) {
  console.log("SKIP: Niubash (niu.exe) not found. Checked:");
  for (const path of niu.checked) console.log(`  - ${path}`);
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
  assert.equal(result.details.truncation.totalLines, total);
  assert.equal(result.details.truncation.outputLines, MAX_OUTPUT_LINES);
  assert.ok(existsSync(result.details.fullOutputPath), "full output file must exist");
});

await check("enforces timeouts and kills the process tree", async () => {
  await assert.rejects(
    () => run({ command: "echo started; sleep 5", timeout: 1 }),
    /Command timed out after 1 seconds/,
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