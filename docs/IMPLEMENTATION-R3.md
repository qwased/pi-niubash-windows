# pi-niubash-windows — R3 修复实施记录

- 实施时间：**2026-11-14 22:00–23:40（UTC+8）**
- 实施对象：`<repo>`（HEAD `081d80b` + 本轮未暂存改动）
- 批准依据：`docs/REVIEW-R3.md` §9 全部批次（1、2、3A、3B、4、5、6）
- 约束：未 commit、未 `git add`、未发布 npm、未修改 SDK/pi-web、未提交上游 issue（实施期间如此；随后按用户要求分批提交，见 §11）
- 证据标记：**实测**为本轮命令输出；**静态**为源码/配置检查；**未测**不当通过

---

## 0. 实施前基线与漂移

R3 报告记录“17 个已暂存修复路径 + 未跟踪 REVIEW-R3.md”。实施前实际：

```text
$ git status --porcelain
(empty)
$ git log --oneline -5
081d80b docs: record the acceptance method and review rounds R2/R3
eeca779 chore: publish only DESIGN.md and require Pi >= 1.5.0
cc3967a ci: typecheck with the local compiler
751e203 test: cover the resolver, stub and spawn-error boundaries
b6ee808 fix: reject non-file niu.exe paths, explain spawn errors, keep the stub honest
```

即 R3 基线中的修复已在 HEAD 及其父提交中提交，工作树干净；没有既有暂存内容需要保留。这是与报告的**唯一基线漂移**，不影响实施范围。

实施前门禁（实测）：`npm test` **18/18 pass**；`npm run typecheck` 使用本地 TypeScript **5.9.3**；真实 SDK smoke **15 个 ok / all passed**。

---

## 1. 批次 1：测试与 CI

### 1.1 实际修改

| 文件 | 改动 |
|---|---|
| `src/niu.ts` | `pathCandidates`/`installDirectoryCandidates`/`normalizeSpelling` 按**目标平台**选择 `win32`/`posix` 的 join 与分隔符，不再混用宿主 flavor |
| `test/unit.test.mjs` | 重写为 43 项：POSIX/win32 双 flavor、真实临时文件/目录覆盖生产 `statSync`、假 SDK 精确接线（description/snippet/guidelines/`defaultActive:false`/`outputSchema`/renderers 同一性）、启动错误边界、来源化降级文案、alias 注入、`%VAR%` |
| `test/smoke.mjs` | 严格 SDK、`SMOKE_REQUIRED`/`SMOKE_SUBSET`、stub 精确元数据、真实临时目录、`$$`+`$!` 双 PID 有界轮询、PID 探测失败即失败、多行 50KB、显式 SDK 失败、早期 rejection 立即附着、并发与 `PI_SESSION_ID`、0.5/1e9 timeout、引号/反斜杠 |
| `.github/workflows/ci.yml` | 新增 `smoke (stub subset)`（windows-latest，`SMOKE_SUBSET=stub`），不把 SKIP 当完整通过 |

### 1.2 关键实现点

- `pathCandidates({ PATH: ";" }, "win32")` 与 `pathCandidates({ PATH: ":" }, "posix")` 均为空；win32 期望值用 `node:path.win32.join`，posix 用 `posix.join`，在任意宿主上同义。
- `createFakeSdk` 记录 `createLocalBashOperations({shellPath})` 与 `createBashToolDefinition(cwd, {operations})`；健康定义断言 `description === DESCRIPTION`、`promptSnippet === PROMPT_SNIPPET`、guidelines 深等、`defaultActive === false`、`parameters`/`outputSchema`/`renderCall`/`renderResult` 引用相等。stub 用 `UNAVAILABLE_*` 做同样的精确断言。
- 真实临时目录测试不注入任何 seam，直接走生产 `defaultKind`：真实 `niu.exe` 文件 → found；同名目录 → `kind:"other"`；PATH 上目录 + 真实文件 → 取文件。
- smoke 的 timeout/abort 命令：`echo "shell=$$"; sleep 37 & child=$!; echo "child=$child"; wait $child`，首次采样前 `sleep 200ms`，随后 ≤10s、200ms 间隔轮询两个 PID。
- `pidAlive` 在 PowerShell spawn 失败、stderr、或输出不是 `0/1` 时**抛错**，由 `check` 记为 FAIL；另用 `pidAlive(process.pid) === true` 自检。
- 显式 `PI_CODING_AGENT_SDK` 不 resolve 时直接 exit 1，不再回退；失败路径改为设置 `process.exitCode` 并抛出哨兵后自然退出（`process.exit(1)` 在 ESM 尚未结束时会在 Windows 触发 libuv 断言 0xC0000409）。`SMOKE_REQUIRED=1` 时“无 Niubash/无 SDK”均失败。`SMOKE_SUBSET=stub` 只跑不依赖 Niubash 的两项并明确打印 skipped。
- abort 检查在 `definition.execute(...)` 返回后立即 `settle()` 附着 then/catch，再等待更新流和 abort，消除了早期 rejection 导致的进程退出。
- 新增多行字节截断：1000 行 × 61B = 61000B，断言 `truncatedBy:"bytes"`、`lastLinePartial:false`、`totalLines:1000`、提示含 `(50.0KB limit)` 且不含 `line is`；单行 60000B 单独断言 partial。

### 1.3 验证（实测）

```text
$ npm test
tests 43 / pass 43 / fail 0 / duration_ms ~145

$ SMOKE_SUBSET=stub node test/smoke.mjs
ok   registers an unavailable stub with the exact degraded metadata
ok   rejects a real directory in PI_NIUBASH_PATH
subset complete: stub/directory checks passed; Niubash-dependent checks were skipped
exit=0
```

严格模式实测：

```text
$ PI_CODING_AGENT_SDK="$TEMP/definitely-missing-sdk" node test/smoke.mjs
FAIL PI_CODING_AGENT_SDK=... does not resolve to the Pi SDK. ...
exit=1

$ PI_NIUBASH_PATH="C:/definitely/missing/niu.exe" SMOKE_REQUIRED=1 node test/smoke.mjs
FAIL Niubash (niu.exe) not found. Checked:
  - C:/definitely/missing/niu.exe
exit=1
```

CI：YAML 用 Python `yaml.safe_load` 解析成功；`smoke-subset` job 结构正确。**GitHub Actions 未实际运行**，只能标“静态检查”。

### 1.4 突变复验（实测，全部在 `%TEMP%` 副本）

| 突变 | 结果 | 杀死者 |
|---|---|---|
| 1 `defaultKind` 恒返回 `file` | unit exit=1 | `the production probe rejects a real directory named niu.exe`、`... skips a directory on PATH ...` |
| 2 stub guidelines 换成 `PROMPT_GUIDELINES` | unit exit=1 | `the unavailable stub wires the degraded metadata exactly` |
| 6 健康定义元数据换成 `UNAVAILABLE_*` 三件套 | unit exit=1 | `the healthy definition wires the normal metadata exactly` |

`npm test` 在 CI 的 ubuntu/windows 两个矩阵都会执行这些断言，因此突变 1/2/6 在 CI 可见。副本与脚本已删除。

---

## 2. 批次 2：启动错误边界

### 2.1 实际修改（`src/tool.ts`）

- 删除包住整个 `definition.execute` 的 `withSpawnGuidance`。
- 新增 `createGuidedOperations`：只包装 `sdk.createLocalBashOperations({shellPath})` 返回的 `exec`。
- `describeStartupError` 只映射：
  - SDK 预检错误 `Custom shell path not found: ...`（无 errno）；
  - `ENAMETOOLONG` / `E2BIG` → 32K 指引；
  - `ENOENT` / `EACCES` / `EPERM` / `EFTYPE` / `EINVAL` / `UNKNOWN`，且 `syscall` 缺失或为 `spawn`/`spawn ...` → 启动指引（EACCES/EPERM 用权限文案）。
- 其他错误原样返回；替换错误带 `{ cause: error }` 并复制 `code`。
- timeout、abort、`Invalid timeout`、缺失 cwd、输出临时文件 `open`/`read` 的 `ENOENT/EACCES` 均不在 `exec` 成功后的路径上，且有防御性 `syscall` 过滤。

### 2.2 真实错误形状（实测，临时探针）

```json
missing-after-resolution {"message":"Custom shell path not found: ...\\niu.exe","name":"Error"}
directory               {"code":"ENOENT","syscall":"spawn ...\\a-directory"}
empty-exe               {"code":"EFTYPE","syscall":"spawn"}
empty-bat               {"code":"EINVAL","syscall":"spawn"}
text-exe                {"code":"UNKNOWN","syscall":"spawn"}
too-long                {"code":"ENAMETOOLONG","syscall":"spawn"}
missing-cwd             "Working directory does not exist: ...\nCannot execute bash commands."
timeout-0               "Invalid timeout: must be a finite number of seconds"
```

覆盖结果（smoke 实测）：

- 目录、加载后消失、0 字节 `.exe` → `Could not start niu.exe at ...`，0 字节用例同时断言不再以 `spawn EFTYPE` 开头、`error.code === "EFTYPE"`；
- 40K → `Command line too long ... about 32K characters`；
- 缺失 cwd、`timeout:0` 原文逐字保留；
- unit 假 SDK 回归：`exec` 成功后抛 `{code:"ENOENT", syscall:"open"}`，`definition.execute` 必须抛出**同一对象**（引用相等），证明 `execute` 边界不再包装。

---

## 3. 批次 3A：pi-web subagent 插件入口

### 3.1 实际修改

```text
$ git mv src/index.ts src/niubash.ts
package.json: "pi": { "extensions": ["./src/niubash.ts"] }
README.md / docs/DESIGN.md: 入口路径、目录树、package.json 示例同步
```

- `defaultActive:false`、主会话 opt-in、平台闸门、执行器、`setActiveTools` 零调用均未改变。
- `src/niubash.ts` 增加 `unavailableNotice` 接线；模块内容其余与旧入口一致。

### 3.2 验证（实测）

- 仓库目录 + 隔离 agentDir 的 `session_start` 探针：`all` 与 `active` 均含 `niubash`，`skills` 含 `skill:niubash`，路径指向包内 `skill/SKILL.md`。
- 发布包解包目录安装同样通过（见 §7）。
- 子代理实测走 `ext:niubash` 选择器，`allExtensionTools` 不再出现（见 §6）。

---

## 4. 批次 3B：本机 subagent profile

### 4.1 备份与改动

```text
备份：%USERPROFILE%\.pi\agent\agents\<review-profile>.md.bak-20261114-221316
文件：%USERPROFILE%\.pi\agent\agents\<review-profile>.md
唯一改动：
  tools: read, bash, edit, write, grep, find, ls, ext:niubash
```

其他字段（`load_skills`、`load_extensions`、`codemode`、`mcp`、`model`、`thinking` 等）未改；未改主 `settings.json`；插件不会自动重写 profile。

### 4.2 真实子代理证据

安全提取脚本先校验 argv 数量、输入≠输出、首行 `type=session`；会话 JSONL 保留未删。

子会话 A：`<session-id>`
（`~/.pi/agent/sessions/--D--workdir-pi-niubash-windows--/2026-11-14T14-13-51-078Z_...jsonl`）

```json
{
  "snapshot.tools": ["read","powershell","edit","write","grep","find","ls","niubash","codemode"],
  "allExtensionTools": false,
  "system.message.toolsAdded": ["read","powershell","edit","write","grep","find","ls","niubash","codemode"],
  "system.sections.tools": "...\n- niubash: Run bash-syntax commands on Windows (Niubash: no WSL/MSYS)\n- codemode: ...",
  "toolCall": {"name":"niubash","arguments":{"command":"echo subagent-niubash-ok; command -v ls; pwd"}},
  "toolResult": {"isError":false,"text":"subagent-niubash-ok\n/c/Users/user/AppData/Local/Programs/Niubash/winuxcmd/usr/bin/ls.exe\n/d/workdir/pi-niubash-windows"}
}
```

子会话 B（最终代码回归）：`<session-id>`

```json
{
  "snapshot.tools": ["read","powershell","edit","write","grep","find","ls","niubash","codemode"],
  "allExtensionTools": false,
  "toolsAddedHasNiubash": true,
  "toolsBlockHasNiubash": true,
  "toolCalls": ["niubash","codemode"],
  "codemode structured": {"truncated":true,"outputLength":1048610,"marker":"[... 171424 bytes omitted ...]","full_output_path":"%TEMP%\\pi-bash-2ff958f2c7c482d7.log","exit_code":0},
  "niubash result": "你好\n/c/Users/user/.../winuxcmd/usr/bin/ls.exe\na\"b"
}
```

结论：四条批准后验收条件均满足。说明：Pi 持久化的 system 消息 `content` 为空，工具清单在 `message.toolsAdded` 与 `message.sections.tools`；本记录直接读取这两个字段。未使用父会话 Agent 描述，也未用 `pi --print --tools` 做门禁。

---

## 5. 批次 4：resolver 与降级诊断

### 5.1 实际修改（`src/niu.ts`、`src/prompt.ts`、`src/niubash.ts`、`src/tool.ts`）

- 单一测试 seam：`ResolveNiuOptions.kindOf(path) -> "file" | "other" | "unverified" | "missing"`；删除“`exists` 即 file”的旧 seam。
- 生产 `defaultKind`：`statSync().isFile()`；`statSync` 抛 `EACCES/EPERM` 时再试 `access(F_OK)`，成功返回 `unverified`（交给 spawn 裁决），失败才 `missing`；其他 stat 错误 → `missing`。真实目录仍由成功的 `statSync` 判为 `other`。
- `NiuResolution.found:false` 带 `checked: [{path, source, kind}]`、`overrideSet`、`unexpandedVariable`；`found:true` 带 `verified`（`unverified` 候选为 false）。
- 保持顺序：`PI_NIUBASH_PATH` → `PATH` → `%LOCALAPPDATA%` → `%ProgramFiles%`。
- `unavailableNotice`/`unavailableMessage` 按来源解释；每个路径只出现一次并标注 `(not found)` 或 `(not a file: a directory or another special file)`。PATH 派生 notFile 不再出现 “PI_NIUBASH_PATH points ...”，也不断言 “not installed”。
- `%VAR%` 不展开；override 残留 `%NAME%` 时给专门提示。

### 5.2 验证（实测）

```text
$ node ... resolveNiu({ env: { PI_NIUBASH_PATH: "%LOCALAPPDATA%/Programs/Niubash/niu.exe" } })
找不到，checked 中保留未展开原文；message/notice 含 "unexpanded %NAME%"。

真实 Store alias：%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\winget.exe
  statSync -> EACCES, access(F_OK) -> true, existsSync -> false
  resolveNiu -> { found:true, path:..., source:"PI_NIUBASH_PATH", verified:false }
```

unit/smoke 覆盖：

- 真实目录 → `kind:"other"`，消息中该路径出现次数恰为 1；
- PATH 上目录 + 真实文件 → 取文件；PATH 目录 alone → `overrideSet:false`，通知不指向 `PI_NIUBASH_PATH`；
- alias 注入 `kind:"unverified"` → found、`verified:false`；
- 未展开 `%NAME%` → 专门提示且原文只出现一次；
- 四种通知来源（override 缺失 / override 非文件 / PATH notFile / PATH 无候选）文案分别断言。

---

## 6. 批次 5：模型文档与 Skill

### 6.1 实际修改

- `src/prompt.ts`
  - `DESCRIPTION` 从 1174 字符改为 **1378**（≤1400），增加“每次调用都是新 `niu -c` 进程，`cd`/`export`/函数不跨调用保留”，增加 `pwd`/`$PWD` 的 `/c/...` 与 native child `C:\...` 的差异；
  - 删除两段式 `bash 5.3`，模型常驻文本完全 version-free；
  - toolbelt 句改为 `git`(niugit)/`rg` 为 bundled builds，`ls`/`find`/`grep`/`awk`/`sed` 为 WinuxCmd，`tar` 为 Windows' bsdtar。
- `README.md`
  - `defaultTools` 明确 replace 语义并提示“追加，不要覆盖”；
  - UTF-8 改为“设置代码页 65001；常规文本/CJK 已验证；非法原始字节被 U+FFFD 替换”；
  - 截断表拆成 lines / 多行 bytes / 单行 partial 三行；
  - 版本表注明“本机复核时读取，随 Niubash 发布漂移”；
  - 新增 pi-web subagent 小节（`ext:niubash`、`load_extensions:true`、`defaultActive:false`、验收看子会话）；
  - Skill 小节改为实际职责边界，不再声称“省略 description 的全部内容”。
- `docs/DESIGN.md`
  - §2 编码事实、§4.2 description 要求、§4.4 三种截断、§7 Skill 章节重写、§9 验收项 14/20、§10 风险表同步；
  - 新增 §3 的启动错误边界与 subagent 入口说明。
- `skill/SKILL.md`：**重写**，5116 字节（约 5.0KB），全英文、Han=0。结构：
  1. State resets between calls（进程隔离、rc、不要为 bash 语义嵌套、cmd/WSL 仅用于原生语义、`--ec` 不解决 32K）
  2. Paths that surprise scripts（`pwd`/`$PWD` `/c/...` vs native `C:\...`、比较方法、无 `MSYS_NO_PATHCONV`）
  3. Interactive boundaries（无 PTY；不在工具内启 `niu --debug`，用真实 TTY 或 DAP client）
  4. codemode: two different payloads（2000 行/50KB 文本 vs ~1MB structured）
  5. Symptom → verify → reference（现场命令优先，references 为离线 fallback）
  6. Provenance and updates（指向 ATTRIBUTION）
  保留 `One niubash tool call is one niu -c <command>` 句，DESIGN 验收项 11 仍可核对。

### 6.2 验证（实测）

```text
DESCRIPTION length 1378
triple versions false; two-part versions null
UNAVAILABLE_DESCRIPTION length 274
skill/SKILL.md 5116 bytes; Han chars 0
```

`README`/`DESIGN` 不再出现 “always/恒 UTF-8”“Skill 不重复 description”“Showing last ... of line N 概括 50KB” 等旧断言（`rg` 检查）。

---

## 7. 批次 6：发布与归因

### 7.1 实际修改

- 新增 `skill/references/LICENSE`：上游 MIT 正文（`Copyright (c) 2026 unixwin team`），1090 字节。
- `skill/references/ATTRIBUTION.md` 重写：
  - 来源 `https://github.com/unixwin/niubash`（URL 与 MIT 由已安装 1.5.0 树的 `README.md`/`LICENSE` 核实）；
  - 每篇字节数与 SHA256；
  - **commit/tag 明确写 unknown**：bundle 无 git 元数据，版本号不是 commit；
  - 删除本机绝对路径；断链 `../LICENSE` 改为同目录 `LICENSE`（仓库与包内都可解析），包根 LICENSE 用纯文本说明。
- `docs/DESIGN.md` 发布版链接：`REVIEW-R2.md`/`ACCEPTANCE-METHOD.md` 改为纯文本“仓库内、不随 npm 包发布”，避免包内死链；同时移除发布版中的本机绝对路径（仓库路径、`%USERPROFILE%\...\niu.exe`、本地上游目录），改为可移植描述或 `./pi-niubash-windows` 占位。
- `package.json`：`engines.node: ">=22.19.0"`（对齐当前 SDK）；`peerDependencies` 改为 `"*"`。
  - 理由（已写入 DESIGN）: Pi `docs/packages.md:112` 要求 host-provided packages 用 `"*"` 且不捆绑；Pi 对托管包抑制自动 peer 安装，写死范围不改变安装行为。真实 API 下限由 devDependency `^1.5.2` 与 smoke 表达，不编码进被抑制的 peer 范围。
- `repository`/`bugs`/`homepage` **未添加**：没有可核实的仓库 URL；README 的 git 安装示例标注“URL 未发布，替换为真实地址”。不编造。

### 7.2 验证（实测）

```text
$ npm pack --dry-run
total files: 16
package size: 39.4 kB / unpacked: 97.9 kB
shasum: 1664bd9f901f80c45810b2b7b5ee6b1ca52377ba
```

包内容：`CHANGELOG.md`、`LICENSE`、`README.md`、`docs/DESIGN.md`、`package.json`、`skill/SKILL.md`、`skill/references/{ATTRIBUTION,LICENSE,paths,prompt-plugins,quickref,wpm}.md`、`src/{niu,niubash,prompt,tool}.ts`。

相对链接检查（自写脚本，跳过 `http`/锚点）：

```text
仓库: markdownFiles 16, missing []
解包: markdownFiles 9,  missing []
```

隔离安装（全新 `PI_CODING_AGENT_DIR`，安装解包目录）：

```text
pi install C:/Users/.../pi-r3pack/package  -> Installed
healthy probe: active 含 niubash; description 以 "Run a command in Niubash..." 开头
stub probe (PI_NIUBASH_PATH=C:\Windows\System32):
  active 含 niubash; description 以 "Unavailable: no usable Niubash..." 开头;
  guidelines 不含 "before the powershell tool"/"as the default shell"
skill: skill:niubash -> <解包目录>\package\skill\SKILL.md (origin=package)
```

注：`getAllTools()` 的投影不返回 `outputSchema`/renderers/`defaultActive`（探针显示 false/null），因此这三项由 unit + smoke 对**注册前的 definition 对象**断言，而不是由探针断言。最终 tarball 重新解包后又跑了一次同样的 healthy/stub/skill 探针，结果一致。

---

## 8. 最终门禁与 R3 行为重跑

| 项 | 结果 | 证据 |
|---|---|---|
| `npm test` | ✅ 43/43 | Windows，duration ≈145ms |
| `npm run typecheck` | ✅ | 本地 `typescript 5.9.3`，`tsc -p tsconfig.json` 无输出 |
| 真实 SDK smoke | ✅ 25 个 ok / 0 FAIL | SDK 1.5.2，`all smoke checks passed` |
| `SMOKE_SUBSET=stub` | ✅ 2/2 + 明确 skipped 文案 | exit 0 |
| 显式坏 SDK | ✅ exit 1 | 不再回退 |
| `SMOKE_REQUIRED=1` 无 Niubash | ✅ exit 1 | 不再把 SKIP 当通过 |
| `npm pack --dry-run` | ✅ 16 files | 见 §7.2 |
| 解包链接 | ✅ 0 missing | 仓库 16 个 md / 包 9 个 md |
| 解包隔离安装 + 探针 | ✅ | healthy/stub/skill 三项 |
| R3 突变 1/2/6 | ✅ 全部被 unit 杀死 | 见 §1.4 |
| 子代理 toolsAdded + 真实调用 | ✅ | 见 §4.2 |

R3 关键行为逐项（新代码，真实 SDK）：

- CJK/引号/尾反斜杠：`你好 世界`、`a"b`、`C:\dir\` 逐字正确（smoke）。
- heredoc + 管道：`cat <<EOF | tr a-z A-Z` → `HELLO/WORLD`（smoke）。
- `exit 3` → `isError:true`、`exit_code:3`、`Command exited with code 3`（smoke）。
- 三种截断（smoke）：
  - 3000 行 → `truncatedBy:"lines"`、`lastLinePartial:false`、`[Showing lines 1001-3000 of 3000.]`；
  - 1000×61B → `truncatedBy:"bytes"`、`lastLinePartial:false`、`(50.0KB limit)`；
  - 单行 60000B → `truncatedBy:"bytes"`、`lastLinePartial:true`、`[Showing last 50.0KB of line 1 (line is ...)]`。
- codemode 1MB：子代理真实调用得到 `outputLength:1048610`、`[... 171424 bytes omitted ...]`、`full_output_path` 存在、`exit_code:0`（§4.2）。
- 40K：新指引（smoke）。
- timeout 0 / 0.5 / 1e9（smoke）：分别保留 `Invalid timeout: must be a finite number of seconds`、`Command timed out after 0.5 seconds`、`Invalid timeout: maximum is 2147483.647 seconds`。
- 不存在 cwd：`Working directory does not exist: ...\nCannot execute bash commands.` 原文（smoke）。
- 并发：慢调用与快调用并发均返回各自输出（smoke）。
- `PI_SESSION_ID`：`printf '%s' "$PI_SESSION_ID"` → `pi-niubash-smoke`（smoke）。
- 超时/取消进程树：`$$` 与 `$!` 两个 PID 均在有界轮询内消失；PID 探测失败会使测试失败（smoke）。

---

## 9. 未测 / 剩余问题

### 9.1 未测（明确不声称通过）

1. **GitHub Actions 未实际运行。** 只做了 YAML 静态解析与结构检查；Ubuntu 实机单测未执行。已用宿主无关的 `win32`/`posix` 断言消除 R3 C1 的静态错误，但“Actions 已绿”不成立。
2. **非 Windows 端到端未测。** 平台闸门与单测成立；未在 Linux/macOS 上启动真实 Pi 扩展。
3. **真实 ACL EACCES（非 Store alias）未构造。** 已用注入 seam 覆盖 `unverified` 行为，并用真实 `winget.exe` alias 实测 resolution；未验证该 alias 形态下 `spawn` 必然成功。
4. **registry / git 安装未测。** 无发布的 npm 包与真实仓库 URL；只验证 pack 内容与解包目录安装。
5. **交互式 `niu --debug` 未运行**（无 PTY，运行会挂起）；文档只给出边界，不当作行为证据。
6. **真实 UI 通知未目测。** 通知文案由 unit 与 stub 探针的元数据覆盖；headless 探针不渲染 UI。
7. **符号链接语义未重测**（R3 已列，本轮未扩大范围）。

### 9.2 剩余问题（需用户提供/后续决定）

1. **真实仓库 URL 缺失**：`repository`、`bugs`、`homepage` 与 README 的 `pi install git:...` 仍是占位。需要用户提供 owner/repo 后再补，不阻塞其他批次。
2. **上游 commit/tag 未知**：`skill/references/ATTRIBUTION.md` 已明确写 unknown；若需要可复核基线，需要上游提供 tag/commit 或带 git 元数据的 bundle。
3. **peerDependencies 采用 `"*"`**：这是按 Pi 文档的决策；如果维护者希望表达最低 API 版本，应在文档而非 peer 范围表达（当前写在 DESIGN §6.1）。
4. `NiuCandidate.kind` 的类型写法 `Exclude<PathKind,"missing"> | "missing"` 等价于 `PathKind`，属于可读性小瑕疵，未改动行为。
5. 入口改名在实施期间只以 `git mv` 暂存；自检后已随 `b21aa03` 提交（见 §11），该暂存状态不再存在。

---

## 10. 副作用与清理

本轮创建的临时对象均已清理：

- `%TEMP%\pi-r3pack`（打包、解包、两个隔离 agentDir、四份探针 JSON）
- `%TEMP%\pi-r3probe`（仓库目录探针）
- `%TEMP%\pi-r3mut-*`（突变副本，脚本运行后自删）
- `%TEMP%\pi-r3batch2-probe.mjs`、`pi-r3mut-run.mjs`、`pi-r3extract-subagent.mjs`、`pi-r3check-links.mjs`、`pi-r3probe-probe*.ts`
- 子会话提取的中间 JSON（关键字段已抄录到本文件）

保留：两个子代理会话 JSONL（见 §4.2）、Pi 管理的历史 `pi-bash-*.log`、`docs/REVIEW-R3.md` 原文、profile 备份 `<review-profile>.md.bak-20261114-221316`。

残留检查（实测）：`niu.exe`、`sleep.exe` 无匹配进程；`%TEMP%\pi-r3*` 无匹配目录/文件。未删除任何非本轮产物。

---

## 11. 变更文件清单与提交记录

R3 实施完成时工作树未提交；本轮自检修正后按批次提交（`docs/REVIEW-R3.md` 原样保留，未改写历史）：

| commit | 提交内容 |
|---|---|
| `adef28a` | `fix:` resolver / 启动错误边界 / 降级诊断 + `DESCRIPTION` 1378；`test/unit.test.mjs`、`test/smoke.mjs`（含失败路径 `exitCode` 修正）、CI stub subset |
| `b21aa03` | `refactor:` `src/index.ts -> src/niubash.ts`、`package.json`（extensions/engines/peer） |
| `03300b1` | `docs:` `README.md`、`docs/DESIGN.md`、`CHANGELOG.md` |
| `da8db4e` | `docs(skill):` `skill/SKILL.md`、`skill/references/{ATTRIBUTION,LICENSE}` |
| 本文件 | `docs: record the R3 implementation and evidence` |

提交后工作树干净；未推送、未发布 npm。

---

## 12. 复现命令（本轮实际使用）

```bash
cd /d/workdir/pi-niubash-windows

npm test
npm run typecheck
node -e "console.log(require('typescript').version); console.log(require.resolve('typescript'))"

PI_CODING_AGENT_SDK="%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent" \
  node test/smoke.mjs

SMOKE_SUBSET=stub node test/smoke.mjs
PI_CODING_AGENT_SDK="$TEMP/definitely-missing-sdk" node test/smoke.mjs

npm pack --dry-run
npm pack --pack-destination "$TEMP/pi-r3pack"
tar -xzf "$TEMP/pi-r3pack/pi-niubash-windows-0.1.0.tgz" -C "$TEMP/pi-r3pack"

# 隔离安装 + session_start 探针
PI_CODING_AGENT_DIR="$TEMP/pi-r3probe/agent" pi install "<repo>"
PI_CODING_AGENT_DIR="$TEMP/pi-r3probe/agent" PI_PROBE_OUT="C:/.../out.json" pi -p --no-session "noop"

# 子会话证据（保留输入）
node extract-subagent.mjs "<session>.jsonl" "<evidence>.json"
```

（本轮用于临时目录/探针的脚本与隔离目录已删除，命令保留供复现。）