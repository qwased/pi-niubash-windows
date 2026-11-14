# pi-niubash-windows — 第三轮审阅

- 审阅时间：**2026-11-14 20:49–21:50（UTC+8）**
- 审阅对象：HEAD `56ae64c` + 修复批次 1–5 的已暂存工作树；基线为 17 个已暂存路径、无未暂存/未跟踪文件
- 环境：Windows 11；Node `v24.19.0`；npm `12.2.2`；Pi / SDK `1.5.2`；pi-web `0.16.0`；Niubash `1.5.0`；TypeScript `5.9.3`
- 方法：按 `REVIEW-PLAN.md` 与 `ACCEPTANCE-METHOD.md` 重新取证；真实 `definition.execute`、真实 `codemode`、`session_start` 暴露探针、隔离安装、临时副本突变、SDK/pi-web 源码核对；并独立阅读 `<workdir>\niubash` 的原始 Skill、references 与 agent 配置
- 约束：**未修改源码、测试、配置或本机 subagent profile**；唯一仓库内新增文件是本报告。所有突变均位于 `%TEMP%` 副本
- 证据标记：“实测”均来自本轮命令；“静态”来自当前源码；“推断/未测”不当作通过

> **结论一句话：** R2 的主会话健康路径修复基本成立，核心健康行为已复现；但没有发现“可以收尾”的依据——Ubuntu CI 有两条静态可确定的失败，pi-web subagent 实际拿不到 `niubash`，健康定义接线突变可 18/18 + 15/15 全绿，spawn 错误包装还存在误包与漏包，V3/V5 等边界仍有未测或失败。主 Skill 应保留“按需深水契约”的机制，但正文需要重写，而不是继续修补摘要。

---

## 0. 基线与门禁

### 0.1 安装与版本

实测 `settings.json`：

```json
{
  "packages": ["<repo>"],
  "defaultTools": ["read", "powershell", "niubash", "edit", "write", "codemode", "grep", "find", "ls"]
}
```

`packages` 是纯字符串；`defaultTools` 含 `niubash`。基线 `git status --porcelain` 的 17 项均只在第一列显示 `M/A`，即已暂存、无未暂存改动。

### 0.2 五项必跑门禁

| 门禁 | 结果 | 本轮关键输出 |
|---|---|---|
| `npm test` | ✅ Windows 实测 | **18 tests / 18 pass / 0 fail**，`duration_ms 124.8015` |
| `npm install --include=dev --no-package-lock --no-audit --no-fund` | ✅ | `up to date in 639ms`；未生成 lockfile |
| 本地编译器 + `npm run typecheck` | ✅ | `typescript=5.9.3`，解析到仓库 `node_modules/typescript/lib/typescript.js`；`tsc -p tsconfig.json` 无错误 |
| 真实 SDK + `node test/smoke.mjs` | ✅ 本机运行完成 | Niubash 来自 PATH、SDK `1.5.2`；**15 个 `ok`，all smoke checks passed** |
| `npm pack --dry-run` | ✅ | **15 files**；`docs/` 仅 `DESIGN.md`；tarball 35.8kB / unpacked 87.7kB |

补充：CI YAML 为**静态审阅**，本轮没有运行 GitHub Actions。`typecheck` job 确实安装 devDependencies、断言本地 TypeScript、没有使用 `npx tsc`；但 Ubuntu unit 存在 C1。

### 0.3 真实发布内容安装

1. `npm pack --pack-destination <r3-temp>` 生成 15 文件 tarball。
2. 直接 `pi install <file.tgz>` 后，Pi 把 `.tgz` 当单文件扩展并拒绝 `Unknown file extension ".tgz"`。Pi `docs/packages.md:9-15,35-44` 只承诺 npm/git/本地路径，本地“文件”指扩展源文件；**这不是本包承诺的安装路径，不计缺陷**。
3. 将同一 tarball 解到临时目录，再用隔离 `PI_CODING_AGENT_DIR` 执行 `pi install <extracted/package>`：成功。
4. `session_start` 探针实测：`all` 与 `active` 均含 `niubash`，`skills` 含 `skill:niubash`，其路径指向解包后的 `skill/SKILL.md`。

结论：发布文件的**有效本地目录安装路径可用**；真实 registry 的 `pi install npm:...` 因包未发布而未测。

---

## 1. R2 修复是否成立

| 项 | 结论 | 本轮独立证据 |
|---|---|---|
| B1 目录/非文件被拒绝 | ✅ 行为成立；⚠️ CI 覆盖不足 | 生产默认 `statSync` 对真实 `System32`、真实临时 `niu.exe/` 目录均返回 `found:false` 且 `notFile` 含路径；暴露探针显示 stub。突变 1 证明单测未覆盖生产默认 `defaultKind`，见 C6 |
| B2 stub 不再注入冲突规则 | ✅ | `PI_NIUBASH_PATH=C:\Windows\System32` 探针：description 以 `Unavailable:` 开头，guidelines 不含 `before the powershell tool` / `as the default shell`；通知回调 mock 收到 `warning`。无头探针终端未显示通知，真实 UI 呈现未目测 |
| B4 40K 命令有可操作错误 | ✅ | 40,000 字符命令：`Command line too long ... about 32K characters ... Write the script to a file ...`，`cause.code=ENAMETOOLONG`；但包装边界有 C2/C3 |
| B5 模型文本不写死三段式工具版本 | ✅ 按原验收口径 | `DESCRIPTION` 长 **1174**，无 `x.y.z`；正常探针无 niugit/ripgrep 版本。`bash 5.3` 两段式版本仍在，见 C15 |
| B6 `timeout > 0` 进入模型文本 | ✅ | DESCRIPTION 含 `must be greater than 0`；`0/-1` 保留上游 `Invalid timeout...`，`0.5` 可运行并在 0.5s 超时，`1e9` 报最大值 `2147483.647` |
| CI / typecheck 修复 | ⚠️ 本机通过，矩阵不成立 | 本地 tsc 真实执行且 CI job 静态正确；C1 的两条 POSIX 断言使 `ubuntu-latest` 单测不能按当前代码通过 |
| 发布字段修复 | ⚠️ 文件白名单成立 | pack 15 文件、验收记录未入包、解包目录可安装；死链、Node 范围与 Pi peer 约定见 C16/C17 |
| `C9/C12` | ⚠️ 编号无法原样闭环 | `C9/C12` 只在 REVIEW-PLAN 出现，R2/DESIGN 未定义。已替代核对 CI、发布及 DESIGN §9-9/12：PowerShell/文件工具本轮可用，Skill 引用文件存在；计划本身应修正编号 |

---

## 2. V1–V16 判定

| ID | 判定 | 类型与证据 |
|---|---|---|
| V1 目录 override 被拒绝 | ✅ | 实测：真实目录 `found:false`、`notFile` 含路径、stub 文案含 `not files`；生产默认路径由手工探针与 smoke 验证，CI 缺口见 C6 |
| V2 stub 无冲突规则 | ✅ | 实测：正常/目录/不存在路径三份 `session_start` JSON；降级 guidelines 仅指向 PowerShell/文件工具；通知用 mock 验证 |
| V3 非 Windows 不注册 | ⚠️ 静态成立，端到端未测 | 单测 `win32=true`，其他 false；`src/index.ts:22` 在任何注册前 return。`resolveNiu({platform:"linux"})` 仍能找到 `niu.exe`，与解耦设计一致。WSL Node 无 TypeScript 支持，未跑非 Windows 扩展 |
| V4 40K 错误 | ✅ | 实测含 `about 32K characters`，不是裸 `spawn ENAMETOOLONG` |
| V5 坏 `niu.exe` 路径有指引 | ⚠️ 部分 | 目录路径得到预期 `Could not start ... PI_NIUBASH_PATH ...`；加载后不存在路径为裸 `Custom shell path not found`，0 字节 `.exe` 为裸 `spawn EFTYPE`，见 C3 |
| V6 DESCRIPTION 不含 `x.y.z` 且 ≤1400 | ✅ | 实测长度 1174；单测与探针一致；两段式版本问题另记 |
| V7 `timeout > 0` | ✅ | DESCRIPTION、README 均明确；0/-1 实测拒绝 |
| V8 三种文本截断 | ✅ | 3000 行保留 **1001–3000**；多行 244000B 为 `truncatedBy:bytes,lastLinePartial:false`；单行 60001B 为 partial。单行仍显示上游 `line is 0B` |
| V9 codemode 1MB | ✅ | 真实 `tools.niubash`：1,220,000B 文件，`truncated:true`、`output.length=1048610`、`[... 171424 bytes omitted ...]`、`full_output_path` 存在 |
| V10 超时/取消进程树 | ✅ 手工强验证；⚠️ smoke 较弱 | `sleep 30 & child=$!; ...; wait` 同时提取 `$$` 与 `$!`，首次等待 200ms 后有界轮询：timeout 两 PID 634ms 内消失，abort 两 PID 606ms 内消失；smoke 只查 `$$`，见 C7 |
| V11 退出码/abort/timeout/cwd 不被 errno 包装 | ✅ 指定路径 | `exit 3` 为 `isError:true,exit_code:3`；timeout/abort 原文保留；不存在 cwd 保留 `Working directory does not exist ... Cannot execute bash commands`。其他文件系统 ENOENT 误包见 C2 |
| V12 `tar` / `sed` 归属 | ✅ | `tar` → `/c/WINDOWS/system32/tar.exe`, `bsdtar 3.8.9`；`type sed` 为 shell emulation，`type -a sed` 另列 WinuxCmd binary |
| V13 README / Skill 无中文正文 | ✅ | `rg` Unicode Han 检查均 0 命中；本报告与历史中文验收文档不在该要求内 |
| V14 pack 内容 | ✅ | dry-run 15 文件；隔离安装解包目录成功，工具与 Skill 可见 |
| V15 CI typecheck 非假绿 | ✅ 本机 + 静态 | 本地 TypeScript 5.9.3 真实运行；CI 安装 devDeps 并断言 compiler；未使用 `npx tsc`。GitHub Actions 未实际运行 |
| V16 测试可被突变杀死 | ⚠️ 计划内成立，新增突变暴露空洞 | 突变 1/2：单测全过、smoke 对应失败；3/4/5 按预期失败；额外突变 6（健康元数据换成 UNAVAILABLE）单测与 smoke **全部通过**，见 C5 |

---

## 3. 新发现

> 严重度：“高”表示 CI/关键集成失效或测试可严重假绿；“中”表示条件触发下的错误行为/诊断或核心覆盖缺口；“低/文档”不表示可以无证据忽略。

| # | 问题与期望 vs 实际 | 证据 | 影响 / 严重度 | 建议 |
|---|---|---|---|---|
| C1 | **Ubuntu 单测两条按宿主分隔符写错。** 期望 `npm test` 在 ubuntu/windows 都绿；实际 POSIX 下 blank PATH 得到 2 个候选，目录型 win32 用例得到 `found:false` | 静态确定：`unit.test.mjs:84-87` 在 Linux 将 `"; : ;;"` 按 `:` 切成两个非空项；`:141-152` 用 `:` 拼 PATH 却指定 `platform:"win32"`（按 `;` 切）。CI `ci.yml:18,25` 确实跑 ubuntu | **高**；矩阵声称与实际不符。GitHub Actions 未运行，标“静态判定”而非 CI 实测 | 测试按目标平台选分隔符；`niu.ts` 的 `platform` 注入同时使用 `win32/posix` 的 delimiter/join，避免 POSIX 宿主模拟 win32 仍混入宿主 flavor |
| C2 | **spawn 指引误包执行后的文件错误。** 期望只包装 niu 启动失败；实际任何带 `ENOENT/EACCES` 的输出临时文件 `open` 错误也变成“Could not start niu.exe” | 实测假 SDK：`{code:"ENOENT",syscall:"open",path:"pi-bash-x.log"}` 被改写；timeout 对象原样透传。`tool.ts:53-72` 包住整个 `definition.execute`；SDK 在 execute 后段还会 `open/read` 全量输出 | **中**；错误归因到 `PI_NIUBASH_PATH`，且新 Error 不保留顶层 `code` | 把包装移到 `operations.exec` 边界，只覆盖 getShellConfig/spawn；必要时再校验 `syscall/path`，保留原 `code` 与 `cause` |
| C3 | **常见启动失败仍漏指引。** 期望不存在/不可执行路径均可操作；实际加载后丢失文件为 `Custom shell path not found`，0 字节文件为 `spawn EFTYPE` | 实测 `spawn-error-probe.mjs`；SDK `utils/shell.js:79-82` 在 spawn 前抛普通 Error；当前映射仅 ENOENT/EACCES/ENAMETOOLONG/E2BIG | **中**；V5 只对目录成立 | 在同一 exec 边界处理 SDK 的 custom-path 错误与 `EFTYPE`；为三类分别加回归，保持 timeout/abort/cwd 原文 |
| C4 | **pi-web subagent 已注册但未实际暴露 niubash。** 期望子代理可调用；实际 resource snapshot 有名字，`toolsAdded` 没有 | 安全提取本轮子会话 `<session-id>...`：`snapshotHasNiubash:true`、`allExtensionTools:true`、`toolsAddedHasNiubash:false`。当前 profile `~/.pi/agent/agents/<review-profile>.md` 为 `tools: read, bash, ...`、`load_extensions:true`；插件 `defaultActive:false` | **高（用户指定集成）**；主会话 `defaultTools` 不会自动变成子代理可调用 allowlist | 采用 §4 的 `src/niubash.ts` + `ext:niubash` 方案；不要改成 `defaultActive:true`，不要由扩展偷改 profile 或调用 `setActiveTools` |
| C5 | **健康定义接线完全可假绿。** 期望健康/降级元数据、`defaultActive`、`outputSchema` 都有行为断言；实际健康定义换成 UNAVAILABLE 三件套仍全绿 | **突变 6 实测：18/18 + 15/15 + exit 0**。`smoke.mjs:126-131` 仅查 `description.includes("Niubash")` 和 guidelines 是数组；单测只查常量。删 `defaultActive:false` / `outputSchema` 也无现有断言；codemode 只有在 schema 存在时才返回 structuredContent | **高**；B2 的反向回归、默认激活回滚和 codemode 契约均可静默破坏 | 用假 SDK 在无 SDK 单测中断言两个 definition 的精确元数据、`defaultActive:false`、schema/renderers 保留；补真实 codemode 契约 |
| C6 | **生产 defaultKind 与 stub 接线不在 CI 可见范围。** 期望关键修复在 CI 可被杀；实际两个突变单测都过，仅本机 smoke 失败 | 突变 1（defaultKind 恒 file）：18/18，smoke 目录用例失败；突变 2（stub 接回正常 guidelines）：18/18，smoke 首项失败。CI 只跑 unit，smoke 还是 opt-in；多数 resolver 单测注入 `exists`，该 seam 会把“存在”直接当 file | **中**；R2 两项核心修复可在 PR 中回归而 CI 全绿 | 加真实临时文件/目录的默认 `statSync` 单测；把 `exists/isFile` 双 seam 改为单一 `kindOf/stat` 注入；CI 运行无需 Niubash 的 stub/目录 smoke 子集 |
| C7 | **smoke 的“进程树”只检查 shell，且探测失败等于进程不存在。** 期望同时证明 `$$` 与 `$!` 消失；实际只查 `$$` | `smoke.mjs:194-201,209-229`；`pidAlive` 在 PowerShell spawn 失败/空输出时返回 false。手工强探针已证明本轮真实两 PID 都能清理，因此这是**测试缺口，不是本轮观察到的功能失败** | **中**；`taskkill /T` 失败或 PowerShell 缺失时可假绿 | timeout/abort 都后台启动 sleep、记录 child PID、`wait`，有界轮询两个 PID；`pidAlive(process.pid)` 自检，探测错误必须 fail，不得当 false |
| C8 | **smoke 可跳过/回退成成功，早期 reject 还可使套件崩溃。** 期望显式 SDK 必须权威、required 模式缺依赖失败；实际错误 SDK 路径仍 15/15 | 实测 `PI_CODING_AGENT_SDK=<definitely-missing>` 回退到本地 SDK 并打印 all passed；`smoke.mjs:23-49,72-76,106-110` 吞 import 错误并 SKIP 0。突变 1 时 abort 阶段在 await 前发生 unhandled rejection，堆栈退出，未形成干净 FAIL | **中**；发布门禁无法区分“执行”与“没执行”，失败定位也被截断 | 显式 SDK 失败立即非零；加 `SMOKE_REQUIRED=1`；创建 pending 后立即附着拒绝处理，再等待输出/取消 |
| C9 | **`statSync` 把可运行 Store alias/ACL 特例当 missing。** 期望可执行候选交给 spawn 判定；实际 stat EACCES 即 `found:false`，`notFile` 也没有 | 实测 `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`：`stat=EACCES`、`access(F_OK)=true`、`existsSync=false`，resolver 返回 not found。SDK 特意用 access 避免该问题（`utils/shell.js:20-26`）。Niubash 是否以 alias 分发未验证 | **中（条件性）**；当前普通 Niubash 文件不受影响 | stat 失败与 access 成功时保留“可执行候选/未知类型”，由 spawn 裁决；增加注入测试。不要简单把目录重新当 file |
| C10 | **降级通知无条件怪到 override，且同一路径重复。** 期望按来源说明“未找到/非文件/配置错误”；实际 PATH 派生目录也通知 `PI_NIUBASH_PATH points ...`，stub 还断言“not installed” | 实测 unset override、PATH 指向目录型 `niu.exe` 时仍收到上述通知；`index.ts:34-37`、`prompt.ts:50-76`。`unavailableMessage` 把 notFile 同时列在 Checked 与 notFile 小节 | **低中**；用户可能被引导重装或改错变量 | 保留 `NiuSource/overrideSet` 信息，文案中性化；同一路径只列一次并标注类型 |
| C11 | **Skill 缺少两条高频契约，同时大量重复。** 期望按需文档补 description 没有的差异；实际状态重置与 `pwd` 输出方言都缺，却复述调用/截断/32K/工具分工 | 连续两次真实工具调用：`cd /tmp` 后下一次回 `/d/workdir`；`cd C:/Users` 后 `pwd=/c/Users`、`/usr/bin/pwd=C:\Users`。`SKILL.md:24-50` 自称不重复后，多数 bullet 与 `prompt.ts` 重合；README:153 与 DESIGN §7.1 也说已省略 | **中（文档/高频使用）**；脚本易错误依赖 cwd/env 或比较路径字符串 | 工具 description 用替换句补“每次新进程，cd/export/functions 不保留”；Skill 重写时补 `pwd/$PWD` 方言与比较方法，见 §5 |
| C12 | **Skill 的调试/嵌套指引边界不安全或丢失。** 期望符合无 PTY 工具与上游原生语义；实际把交互 `--debug` 列为可用，且一律禁止 `cmd /c`/WSL | `SKILL.md:31-32,125-145`；上游说明 debugger 命令来自 controlling terminal，工具无 PTY。上游决策表允许 cmd batch 与 Linux-only WSL。`SHELL` 实测与 `NIU_SHELL` 斜杠形态不同，不是相同字符串；`-C (rc+plugins)` 未验证 | **中（文档）**；可能挂起到 timeout，或排除合法原生任务。debug 挂起为**高置信推断，未运行** | 明确“不要在本工具内启动交互 debug；用真实 niu TTY 或 DAP 客户端”；改为“不要为回到 bash 而嵌套，cmd/WSL 仅用于各自语义”；修正小措辞 |
| C13 | **“输出总是 UTF-8”被原始字节证伪。** 期望文档不绝对承诺任意子进程输出；实际非法字节被 Pi 解码为 U+FFFD | 真实工具 `printf '\377'` → text `�`，codepoint `fffd`。`README.md:99`、`DESIGN.md:34` 写“always/恒” | **中（文档）**；二进制/任意 Windows 子进程不能靠 CP65001 保证 UTF-8 | 改为“Niubash 将控制台配置为 UTF-8；已验证常规文本/CJK。任意原始字节由 Pi 按 UTF-8 解码，非法序列会替换” |
| C14 | **多行 50KB 文案写错且未单独测。** 期望区分 lines / bytes 多行 / partial 单行；实际 DESIGN 把 50KB 都写成 `Showing last ... of line N` | 实测 4000×61B：`truncatedBy:bytes,lastLinePartial:false`，提示 `[Showing lines 3162-4000 of 4000 (50.0KB limit)...]`；`DESIGN.md:113` 不符；smoke:171 仅单行 partial | **低（文档 + 覆盖）** | DESIGN 写三分支；smoke 增加多行 byte 用例并断言 `lastLinePartial:false` 与 `(50.0KB limit)` |
| C15 | **“version-free”与 toolbelt 表述仍不严谨。** 期望模型文本不随版本漂移、不过度概括；实际 DESCRIPTION 含 `bash 5.3`，测试只挡三段式；guideline 3 仍把整个 Unix toolbelt 归为 bundled builds，未点名 tar 例外 | `prompt.ts:23,36-45`、`unit.test.mjs:223-228`；实测 tar 是 System32 bsdtar | **低（模型文本）** | 决定是保留“引擎方言版本”还是彻底 version-free，并同步测试/文档；guideline 加 `(tar is Windows' bsdtar)` 或收窄主语 |
| C16 | **仓库与发布包均有文档断链，归因不可复核。** 期望链接有效、第三方 MIT 与快照来源完整；实际 `skill/LICENSE` 不存在，发布 DESIGN 又链接未发布文件 | 自动链接检查：仓库 1 个缺失 `skill/references/ATTRIBUTION.md -> ../LICENSE`；发布包另有 `DESIGN.md -> REVIEW-R2.md` 与 `ACCEPTANCE-METHOD.md`。ATTRIBUTION 还写本机绝对路径，无 tag/commit/哈希 | **低（发布/许可卫生）** | 链接改为正确目标；建议在 `skill/references/LICENSE` 随附上游 MIT 正文；记录上游 URL + commit/tag + 日期 + SHA256。DESIGN 改纯文本/仓库 URL，或调整发布内容 |
| C17 | **安装/发布元数据仍有误导。** 期望用户合并工具清单、Node 与宿主一致；实际 README 给完整 replace 数组且未警示，Node 写 dev-only 22.18，SDK 要 22.19；git URL 仍是 `<you>` | `README.md:22,34,44`；`package.json:33-38`；SDK package engines 为 `>=22.19.0`；Pi packages 文档建议宿主 peer 用 `"*"`，本包为 `>=1.5.0`，需要明确决策而非来回漂移 | **低（文档/发布）** | README 明示“向现有 defaultTools 追加，勿覆盖其他工具”；engines 对齐宿主并删除 dev-only 暗示；peer 按 Pi 约定与真实 API 下限统一决策；repository/bugs/homepage 等需真实 URL，不能编造 |
| C18 | **路径配置归一化不对称。** 期望 Windows 用户常见 `%LOCALAPPDATA%` 写法要么可用、要么明确拒绝原因；实际只展开 `~`，`%VAR%` 原样进入 checked | 实测 `resolveNiu` 对 `%LOCALAPPDATA%/Programs/Niubash/niu.exe` 返回 `found:false`，checked 保留未展开原文；`niu.ts:47-61`，README 仅写 absolute path | **低（可选改进，非本轮回归）** | 选择实现大小写不敏感 `%NAME%` 展开，或检测残留 `%...%` 给专门提示；不纳入核心修复也可，但应记录契约 |

---

## 4. pi-web subagent 专项：定因与待批准方案

### 4.1 已证实的事实

安全提取脚本遵守了 argv 数量、输入≠输出、首行 `{"type":"session"}` 三项护栏。本子会话证据：

```json
{
  "snapshotHasNiubash": true,
  "allExtensionTools": true,
  "toolsAddedHasNiubash": false
}
```

所以不能只看 `resourceSnapshot.tools`，也不能只看父会话 Agent 描述。真正需要检查的是子会话 `toolsAdded` / active tools 与一次真实调用。

pi-web 0.16.0 的相关逻辑（本机 `.next/server/chunks/5582.js`、`6429.js`；同 tag 上游 `lib/subagents.ts`）：

1. 普通 `tools:` 只接受内置 `read/bash/edit/write/grep/find/ls`；普通写 `niubash` 会被过滤。
2. 没有 `ext:` selector 且 `load_extensions:true` 时走 `allExtensionTools`。本轮该路径得到“snapshot 有 niubash、toolsAdded 无 niubash”，与 `defaultActive:false` 组合后不会强制激活。
3. `ext:<extension>[/tool]` 会形成明确选择。extension alias 可来自入口文件 basename；本地路径 package 的 `sourceInfo.source` 不保证提供简单 npm 包名，因此直接写 `ext:pi-niubash-windows` 在当前 `src/index.ts` 布局下不可靠。

### 4.2 推荐的长期方案（未实施）

**A. 插件侧（仓库改动，需批准）**

- 将入口 `src/index.ts` 改名为 `src/niubash.ts`，并更新 `package.json -> pi.extensions`、文档与相关测试。
- 目的不是美化文件名，而是给 pi-web 一个稳定、可移植的 extension basename：`niubash`。
- 保持 `defaultActive:false`、主会话 opt-in、执行器与平台闸门不变。

**B. 子代理 profile（仓库外用户配置，需单独批准与备份）**

在 `%USERPROFILE%\.pi\agent\agents\<review-profile>.md` 的 `tools:` 中**追加**：

```yaml
tools: read, bash, edit, write, grep, find, ls, ext:niubash
```

- 不要把 `niubash` 写成普通内置名；不要额外添加 `powershell` 来替代这条 selector。
- 不必为了本方案把 `defaultActive` 改成 true。
- 插件加载时不得自动重写该 profile；这是用户授权边界。

**C. 文档**

README 增加“pi-web subagent 是独立工具选择域”的小节，给出上述配置，并说明 Agent 列表可能不显示 extensionTools，验收必须看子会话。

### 4.3 为什么不选其他方案

| 方案 | 不选原因 |
|---|---|
| `defaultActive:true` | 破坏主会话显式 opt-in 与“删 defaultTools 即回滚”的契约，影响面远超子代理 |
| 插件 `session_start` 中 `setActiveTools` | 覆盖宿主/用户选择，且无法可靠识别所有 subagent 形态；违背当前零环境副作用设计 |
| 普通 `tools: ..., niubash` | pi-web 普通内置集合会过滤它 |
| 本机完整路径 `ext:D:\...` | 对本地/相对/ npm 安装不可移植；只是临时 workaround |
| 插件自动修改 `~/.pi/agent/agents/*.md` | 未授权写用户配置，卸载/多版本/多 profile 时无法安全维护 |
| 改 pi-web / SDK | 本轮范围不允许，也非必要 |

### 4.4 批准后的验收

1. 新子会话 `resourceSnapshot.tools` 含 `niubash`，且不再走 `allExtensionTools:true` 的无 selector 分支。
2. 同一子会话 `toolsAdded` / active tools **实际含 `niubash`**。
3. 子代理真实调用 `echo 你好; command -v ls` 或 codemode `tools.niubash`，返回 `exit_code:0` 与 WinuxCmd 路径。
4. 降级安装中，子代理得到的是 UNAVAILABLE stub，且没有“优先 niubash”冲突规则。
5. 主会话正常暴露、`defaultTools` 删除后的回滚、pack 安装均重跑；确认入口改名没有破坏加载。
6. 两个并发子代理无工具串扰；真实 UI 中 Agent 描述是否显示 selector 只作外观检查，不作通过依据。

> 当前状态：**定因有实测，修复路径有 pi-web 源码依据；`ext:niubash` + 入口改名尚未实施，因此不能提前写“已修复”。**

---

## 5. Skill 是否多余、是否应重写

### 5.1 判断

- **机制不多余。** 工具 description 应承担高频调用契约；路径深水区、rc/plugin、wpm、DAP 等低频细节适合按需加载。
- **当前正文需要重写。** `SKILL.md:24-27` 说调用约定“deliberately not repeated”，但 `:31-50` 又重复多数 description/guidelines；README 与 DESIGN 对“已省略”的描述也随之失真。
- **不建议简单删掉全部 references。** 它们只在被读取时产生上下文成本，且提供离线、可复核的上游契约。应优先“现场查询 + 主文档路由 + 快照兜底”，而不是为了减少约 22KB 包体就丢掉权威资料。
- 四篇 references 与上游当前文件逐字一致（本轮 `cmp` 全部 `IDENTICAL`），所以问题是**摘要层级、已知上游局限与 provenance**，不是本地复制漂移。

### 5.2 建议的新职责边界

| 渠道 | 应负责 | 当前需要改变 |
|---|---|---|
| DESCRIPTION / guidelines（常驻） | 每次新 `niu -c` 进程、cwd/env/functions 不持久、no-rc、截断/退出/timeout/32K、路径高频要点、无 PTY、工具选择 | 用替换句加入状态不持久与 `pwd` 方言，保持 ≤1400；不要继续堆低频细节 |
| SKILL.md（按需，建议约 3.5–5KB） | 症状路由、description 放不下的差异、调试/安装/路径深水区、codemode 两套 payload、现场验证命令 | 删除复述表与版本考古；frontmatter 用英文症状触发，不再把同组主题用英文和“Chinese-language requests”重复两遍；保持全英文 |
| references（按需再读） | 完整路径契约、插件协议、launcher/builtin/applet 快照、wpm 细节 | 保留为离线 fallback；先引导 `command -v`、`niu doctor`、`help -s '*'`、`wpm installed/list` 获取现场事实 |
| shell 自身（现取） | 版本、命令归属、builtin/applet、安装健康 | 避免把可执行输出当成永远不变的静态事实 |

### 5.3 建议正文结构

1. **When to load**：路径看着不对、`pwd` 显示 `/c/...`、命令缺失或版本不符、prompt/alias 不生效、rc/plugin、wpm、DAP/verbatim handoff。
2. **Pi invocation differences**：每次新进程；不要为 bash 语义嵌套；`--ec` 本工具不需要且不解决 32K；codemode 1MB 与文本截断不同。
3. **Paths that surprise scripts**：`pwd/$PWD` 是 `/c/...` 方言，native child 收 `C:\...`；不要按输入字符串等值比较，给出 `/usr/bin/pwd` / `test` 等办法。
4. **Interactive boundaries**：无 PTY，不在工具中启动 `--debug`；用真实 niu TTY 或 DAP client。
5. **Symptom → verify → reference**：每行一个症状，先给现场命令，再指向 paths/prompt-plugins/quickref/wpm。
6. **Provenance/update**：URL + commit/tag + 抓取日期 + 每篇 SHA256 + 已知 errata 流程。

### 5.4 references 的具体处理

| 文件 | 建议 |
|---|---|
| `paths.md` | 保留逐字快照；主 Skill 补 `pwd` 输出方言，不把整张路径表复制第三遍 |
| `prompt-plugins.md` | 保留；本机无 rc 时加载概率低，但低频不等于无价值 |
| `quickref.md` | 可保留作离线快照，但 launcher/builtin/applet 以现场 `niu --help`、`help -s '*'`、`niu doctor` 为准；是否裁剪另开低优先级整理，不与核心修复捆绑 |
| `wpm.md` | 保留或压缩均可；主 Skill 只列 discovery/install/link repair/index 的路由，避免第三份命令长表 |
| `ATTRIBUTION.md` | 必须修断链与本机路径；建议随附上游 `LICENSE` 全文，并记录可复核基线。上游安装树 LICENSE 已核实为 `Copyright (c) 2026 unixwin team` |

补充边界：上游原始 `SKILL.md` 的能力快照含 `tar` 示例，但该上游主文件并未随包发布；插件 `quickref.md` 的 applet 表实际没有 `tar`，因此**不把“插件 references 写错 tar”列为缺陷**。真正残留的是 `prompt.ts` guideline 的过度概括（C15）。

---

## 6. 文档“声称 → 实测”对照

| 声称 | 结果 | 本轮证据 |
|---|---|---|
| `tar` 为 System32 bsdtar | ✅ | `/c/WINDOWS/system32/tar.exe`；`bsdtar 3.8.9` |
| `sed` 为 shell emulation + WinuxCmd binary | ✅ | `type` / `type -a` 两种输出均符合 |
| codemode 约 1MB head+tail | ✅ | 1048610 字符、171424B omitted、full path 1220000B |
| `timeout > 0` | ✅ | 0/-1 拒绝，0.5 接受，1e9 超最大值 |
| 命令约 32K | ✅ | 40K 得到新指引 |
| Windows-only，其他平台不注册 | ⚠️ 静态 | 闸门源码与单测成立；真实非 Windows 未测 |
| pack 只发 DESIGN，不含验收报告 | ✅ | 15 文件；但 DESIGN 有发布内死链 |
| 超时/取消 best-effort kill | ✅ 指定进程树 | 两个 PID 均在 1s 内有界轮询消失；仍不是同步保证 |
| 输出总是 UTF-8 | ❌ | 非法 `0xff` → U+FFFD，见 C13 |
| 多行 50KB 提示为 `Showing last ... of line N` | ❌ | 实际为 `Showing lines ... (50.0KB limit)`，见 C14 |
| Skill 不重复 description | ❌ | 主文档多处重复，见 §5 |
| Ubuntu + Windows 单测矩阵 | ❌ 静态判定 | C1 两条 POSIX 断言错误；Actions 未运行 |
| 发布 Skill 引用完整且链接可用 | ❌ | references 文件存在，但 ATTRIBUTION 与发布 DESIGN 有断链 |

---

## 7. 突变测试可信度

所有副本均在 `%TEMP%\pi-review-r3-20261114-2049\mut*`，原仓库未改。

| 突变 | 预期 | 实测 | 结论 |
|---|---|---|---|
| 1 `defaultKind` 恒 `file` | 单测过，smoke 目录用例失败 | **18/18**；smoke 目录用例失败，随后 abort 阶段 unhandled rejection 退出 | 揭示 CI 覆盖缺口 + smoke 早期拒绝处理缺口 |
| 2 stub 接回 `PROMPT_GUIDELINES` | 单测过，smoke stub 失败 | **18/18**；smoke 首项失败、其余健康项通过，exit 1 | 揭示 CI 覆盖缺口 |
| 3 不再 `describeSpawnError` | 40K 断言失败 | smoke 40K 与坏目录两项均失败，exit 1 | 能有效杀死 |
| 4 DESCRIPTION 加 `niugit 2.56.0` | 无版本号单测失败 | **17/18**，目标断言失败 | 能有效杀死三段式版本 |
| 5 `notFile` 恒空 | 目录型单测失败 | **17/18**，目标断言得到 `[]` | 能有效杀死 |
| 6 健康定义换成 UNAVAILABLE 三件套（新增） | 理想上应有接线测试失败 | **18/18 + 15/15，exit 0** | **存活突变，证明 C5 假绿** |

---

## 8. 存疑 / 未测 / 上游边界

1. **非 Windows 端到端未测。** 静态闸门成立；尝试本机 WSL 仅作 POSIX 观察时，Node `v22.22.1` 报 `ERR_NO_TYPESCRIPT`，未继续转译或把 WSL 当支持平台。GitHub Actions 未运行。
2. **符号链接未实测。** 创建 file symlink 返回 `EPERM`；静态 `statSync` 会跟随链接，但“链接到文件接受、到目录拒绝、broken link 为 missing”仅作推断。
3. **Store alias 的 Niubash 适用性未知。** C9 已实测同类 Windows alias 机制，但未发现 Niubash 当前以该形式分发的证据。
4. **ACL 拒绝执行未测。** 0 字节 `.exe` 已实测为 `EFTYPE`；真实 ACL/EACCES 分支未构造。
5. **`--debug` 在工具中挂起是高置信推断。** 为避免制造挂起进程，本轮未运行；依据为 controlling terminal + 无 PTY。
6. **`niu -C` 的 rc/plugins 语义未重新验证。** 不为审阅而创建用户 rc；主 Skill 应回到上游较中性的“REPL startup semantics”。
7. **后台/detached 进程在 shell 已提前退出后的清理未纳入 V10。** 本轮验证的是 shell `wait` 子进程的明确进程树；不要外推为任意守护进程保证。
8. **stub 在 codemode 中的行为：观察。** stub 保留 `outputSchema`，但 execute 抛 Error；按 SDK `toScriptValue`，脚本会 reject，而不是获得带 `exit_code` 的结构化对象。本轮不判缺陷。
9. **上游 `--tools` 偶发零工具、嵌套 Pi 挂起、单行 `line is 0B`、timeout 0 文案**仍属上游/历史线索；本轮遵守方法，没有用它们做门禁。
10. **registry/npm/git 安装未测。** 只验证 pack 内容与解包目录安装；真实仓库 URL 也仍未知。
11. **真实 UI 警告未目测。** `session_start` 通知用 mock 回调验证，headless probe 不显示 UI notification。

---

## 9. 待批准修复清单

> **以下全部是方案，不是已执行改动。需用户批准后才能动源码；本机 subagent profile 的修改还需单独授权与备份。**

| 批次 | 文件 | 建议改动 | 验证 / 退出条件 |
|---|---|---|---|
| 1 测试与 CI（优先） | `test/unit.test.mjs`、`test/smoke.mjs`、`.github/workflows/ci.yml` | 修 POSIX 两条断言；加假 SDK 健康/stub 精确契约、`defaultActive`、schema；真实临时目录生产 stat；timeout/abort 双 PID + pidAlive 自检；多行 50KB；显式 SDK 失败与 `SMOKE_REQUIRED`；早期 reject 处理；CI 跑无需 Niubash 的 smoke 子集 | Ubuntu/Windows unit 均绿；突变 1/2/6 在 CI 可见；错误 SDK 不再全绿；`$$/$!` 均有界轮询 |
| 2 启动错误边界 | `src/tool.ts`、对应测试 | 将指引包装移到 `operations.exec`；处理 custom-path 与 EFTYPE；保留 timeout/abort/cwd/open 错误及原 code/cause | open ENOENT 原文保留；missing/directory/empty/40K 均有正确指引；现有 15 项 smoke 不回归 |
| 3A subagent 插件入口 | `package.json`、`src/index.ts → src/niubash.ts`、文档/测试 | 用稳定 basename 支持 `ext:niubash`，不改 `defaultActive` | §4.4 全项；主会话与 pack 安装回归 |
| 3B subagent 用户配置（独立批准） | `%USERPROFILE%\.pi\agent\agents\<review-profile>.md` | 备份后仅追加 `ext:niubash`；不由插件自动写 | 新子会话 toolsAdded 含 niubash + 真实调用；回滚配置可恢复 |
| 4 resolver 与降级文案 | `src/niu.ts`、`src/index.ts`、`src/prompt.ts` | stat/access 的 alias 特例；统一测试 seam；保留来源、去重、去除无条件 override/未安装归因；决定 `%VAR%` 支持或专门提示 | alias 注入用例、真实目录、PATH 派生 notFile 通知、重复路径计数、现有路径顺序不回归 |
| 5 模型文档与主 Skill | `src/prompt.ts`、`README.md`、`docs/DESIGN.md`、`skill/SKILL.md` | 补状态重置与 `pwd` 方言；修 UTF-8/50KB/tar/版本措辞；明确 debug 与 cmd/WSL 边界；按 §5 重写主 Skill 与英文触发 description | 文本事实逐项实测；description ≤1400；README/DESIGN 不再声称“无重复”；Han 检查仍为 0 |
| 6 发布与归因 | `skill/references/ATTRIBUTION.md`、新增上游 LICENSE、`docs/DESIGN.md`、`package.json`、`README.md` | 修断链、补 commit/hash 与 MIT；处理 DESIGN 包内链接/本机路径；Node engines 对齐；peer 范围按 Pi 约定决策；README 合并式工具清单；真实仓库元数据另行提供 | 仓库与解包链接检查均 0 缺失；pack 15±预期文件且可安装；不使用虚构 repository URL |

不建议把“删除所有 references”、大规模重写执行器、默认激活工具或自动修改用户配置混入上述批次。

---

## 10. 本轮副作用与残留

- 基线前已存在 `%TEMP%\pi-tools-probe*`、`pi-race-*`、`sessextract*` 等历史残留；本轮未删除这些非本人产物。
- 本轮临时目录 `%TEMP%\pi-review-r3-20261114-2049`（探针、6 个突变副本、两个隔离 agentDir、打包解包目录与提取证据）已在校验绝对路径与 reparse point 后删除；最终 `Test-Path=False`，`$TEMP/pi-review-r3*` 无匹配。
- 临时图项目 `pi-niubash-windows-r3` 已删除；未启用持久化 `.codebase-memory` 文件。
- 最终进程检查：`niu.exe`、`sleep.exe`、`pi-review-r3`、`pi-tools-probe`、`pi-race` 均为 **no matching residual processes**。
- 本轮产生当前主会话与两个只读 subagent 会话 JSONL；按验收方法保留，不删除。
- 多次 smoke/手工大输出产生 `pi-bash-*.log` 与 codemode 临时文件；由 Pi 管理，未按时间批量误删其他会话日志。
- 未改真实 `~/.pi/agent/settings.json`、未改 subagent profile、未执行 `pi remove`、未提交 upstream issue。
- 最终 `git status --porcelain`：原有 17 个已暂存修复路径保持不变，新增且仅新增未跟踪 `?? docs/REVIEW-R3.md`；没有未暂存源码/测试改动。

---

## 11. 复现命令（核心）

### 11.1 基线

```bash
cd /d/workdir/pi-niubash-windows
node --version; npm --version; pi --version; niu --version
npm test
npm install --include=dev --no-package-lock --no-audit --no-fund
node -e "console.log(require('typescript').version); console.log(require.resolve('typescript'))"
npm run typecheck
PI_CODING_AGENT_SDK="%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent" node test/smoke.mjs
npm pack --dry-run
```

### 11.2 关键运行时探针

```bash
# 通过 niubash 工具分别执行（不是要求插件支持 WSL）
echo 你好; pwd; command -v ls
seq 1 3000
exit 3
cat <<EOF | tr a-z A-Z
hello
EOF
printf '\377'
cd /tmp && pwd
# 另一次工具调用
pwd
cd C:/Users && pwd; /usr/bin/pwd

# 超时/取消进程树：命令中同时记录 shell/child，随后 Get-Process -Id 有界轮询
echo "shell=$$"; sleep 30 & child=$!; echo "child=$child"; wait $child

# 文档事实
type tar; tar --version | head -1
type sed; type -a sed
```

codemode 1MB：

```js
// goal: 实测 codemode 调用 niubash 时 1.2MB 输出的结构化截断语义
const r = await tools.niubash({ command: "awk 'BEGIN{for(i=0;i<20000;i++) printf \"%060d\\n\", i}'" });
text(JSON.stringify({
  truncated: r.truncated,
  outputLength: r.output.length,
  marker: r.output.match(/\[\.\.\. \d+ bytes omitted \.\.\.\]/)?.[0],
  full_output_path: r.full_output_path,
  exit_code: r.exit_code,
}));
```

### 11.3 错误面与测试可靠性

```bash
# 显式错误 SDK 仍回退并全绿（本轮实测）
PI_CODING_AGENT_SDK="$TEMP/definitely-missing-sdk" node test/smoke.mjs

# 加载后不存在的路径与 0 字节 .exe：用 createNiubashDefinition 分别构造并 execute
# 本轮结果分别为 Custom shell path not found / spawn EFTYPE。

# 假 SDK 对整个 execute 抛 open ENOENT：本轮被误改写为 Could not start niu.exe。
# 突变：在 TEMP 副本分别改 defaultKind、stub guidelines、错误包装、版本号、notFile、健康元数据；
# 每个副本运行 npm test 与同一 SDK smoke，结果见 §7。
```

### 11.4 subagent 证据

读取本轮子会话的 custom `pi-web:subagent` resource snapshot 与 system message `toolsAdded`；提取脚本必须先校验参数数量、输出不同于输入、首行 type=session。不要只看父会话 Agent 的静态工具描述。
