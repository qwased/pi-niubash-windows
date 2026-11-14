# 第三轮审阅计划 — pi-niubash-windows（修复后）

- 计划日期：**2026-11-14**
- 适用对象：`<repo>`（v0.1.0，修复批次 1–5 已落盘、已 `git add`、未提交）
- 执行方式：**在新对话中，由审阅者按本计划逐阶段执行**；只读为主，改动源码前必须获得用户批准
- 产出：`docs/REVIEW-R3.md` + 一份“待批准修复清单”
- 原则：**不继承前两轮的结论**。前两轮的报告（`ACCEPTANCE.md`、`REVIEW-R2.md`）只作为“待验证的主张”，每条都要重新取证

---

## 0. 开始前（新对话的第一条指令）

把下面这段发给新会话：

> 阅读 `<repo>\docs\REVIEW-PLAN.md`，按它执行第三轮审阅。先读 `ACCEPTANCE-METHOD.md`、`DESIGN.md`、`ACCEPTANCE.md`、`REVIEW-R2.md`，再开始。不要改源码，结论先落盘 `docs/REVIEW-R3.md`，修复等我批准。

审阅者必须先跑 §1 的基线，再按 §4 的阶段推进；任何“通过”都要有命令与输出，不能引用旧报告。

---

## 1. 目标与范围

### 1.1 本轮要回答的问题

1. 修复批次 1–5 是否**真的生效**，有没有引入回归？
2. 代码、测试、文档、发布字段**是否互相对得上**（尤其“测试声称覆盖”的部分）？
3. R2 里仍存在的推断/未定问题，有没有能被证伪或定因的？
4. 修复后的**降级路径、平台闸门、错误面**是否自洽？
5. 发布包（`npm pack`）内容与安装路径是否可用？

### 1.2 不做

- 不提交上游 issue、不改 SDK、不做性能基准（除非发现明显退化）。
- 不在真实 `~/.pi/agent` 上做破坏性实验（`pi remove`、改 `defaultTools`）；用隔离 `PI_CODING_AGENT_DIR`。
- 不重新设计功能；只审“是否成立、是否有新问题”。

---

## 2. 输入与环境

### 2.1 必读文件

| 文件 | 用途 |
|---|---|
| `docs/ACCEPTANCE-METHOD.md` | 本轮**必须遵守**的方法（探针、预算、残留、提取脚本护栏） |
| `docs/REVIEW-R2.md` | 上一轮结论（A1–A4、B1–B9、N1–N7、§8/§9）；只作待验证主张 |
| `docs/ACCEPTANCE.md` | 第一轮 13 项 + 复核更正 |
| `docs/DESIGN.md` | 契约、风险表、验收清单（现为 20 项） |
| `src/*.ts`、`test/*.mjs`、`.github/workflows/ci.yml`、`package.json` | 审阅对象 |
| `README.md`、`skill/SKILL.md`、`CHANGELOG.md`、`CONTRIBUTING.md` | 模型/用户可见文本 |

### 2.2 环境基线（记录到 REVIEW-R3 顶部）

```bash
node --version; npm --version; pi --version 2>/dev/null || true
niu --version; git -C /d/workdir/pi-niubash-windows log --oneline -3
git -C /d/workdir/pi-niubash-windows status --porcelain
node -e 'const s=require("%USERPROFILE%/.pi/agent/settings.json");console.log(JSON.stringify({packages:s.packages.filter(p=>String(p).includes("niubash")),defaultTools:s.defaultTools}))'
```

预期：Pi 1.5.2、Node 24、Niubash 1.5.0；`settings.packages` 仍为纯字符串路径；`defaultTools` 含 `niubash`。
若 `git status` 不是“已暂存、无未暂存改动”，先记录差异再继续。

### 2.3 必跑门禁（基线，约 2–3 分钟）

```bash
cd /d/workdir/pi-niubash-windows
npm test
npm install --include=dev --no-package-lock --no-audit --no-fund
npm run typecheck
PI_CODING_AGENT_SDK="%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent" node test/smoke.mjs
npm pack --dry-run
```

当前预期：单测 **18/18**、typecheck 无输出、smoke **15/15**、pack **15 个文件且 docs 只有 DESIGN.md**。
任何数字对不上，先查“是不是测试本身写错”，再查代码（§5 有突变检查法）。

---

## 3. 方法约束（违反则结论作废）

1. 暴露检查只用 `session_start` 探针（§6），**禁止** `pi --print --tools <list>`，**禁止**在工具里再启动 `pi`。
2. 任何“进程已清理”的断言必须有**有界轮询**（`Get-Process -Id`，≤10s），不能拿返回瞬间的计数当同步证明。
3. 探针预算：单条 ≤5s；大输出用单进程 `awk`；禁止逐行 fork。
4. 每条结论标注 **实测 / 推断**，实测要带命令、关键输出、时间点；源码引用给路径 + 行号（行号会漂，用 `rg -n` 重新定位）。
5. 验收前后各做一次残留检查（进程、`%TEMP%` 探针目录、会话目录、`git status`）。
6. 提取会话日志的脚本必须：校验 `argv` 数量、输出路径 ≠ 输入、首行是 `{"type":"session"}`。

---

## 4. 阶段与时间预算（总计约 3.5–4 小时）

### 阶段 0 — 基线（15 min）

- §2.2 + §2.3 全部执行并记录。
- 检查 `npm run typecheck` 是否真的用了本地 tsc：`node -e "console.log(require('typescript').version)"`。
- 检查 CI YAML 是否只做“看起来对”的事：逐行读 `.github/workflows/ci.yml`；无法本地跑 GitHub Actions，标注“静态审阅”。

### 阶段 1 — 静态审阅（60 min）

逐文件读，重点不是“看懂”，而是“找不一致”：

| 文件 | 要核对的点 |
|---|---|
| `src/niu.ts` | `kindOf` 的注入语义（`exists` 被当作 file 是否会让测试“假通过”）；目录/设备/符号链接；`checked` 与 `notFile` 的去重；POSIX 分支是否仍可达 |
| `src/tool.ts` | `withSpawnGuidance` 是否只映射 errno；`bind` 后 `this` 与重入；stub 是否仍带 `outputSchema`；`setTimeout`/abort 错误是否被误包装 |
| `src/index.ts` | 平台闸门是否在**任何注册之前**；`session_start` 通知是否只在 stub 分支；`notFile` 文案 |
| `src/prompt.ts` | DESCRIPTION 长度（≤1400）、事实是否仍准确（2000/50KB、32K、timeout>0、无版本号）；guidelines 是否每条点名工具 |
| `test/unit.test.mjs` | 是否存在“只断言存在、不断言行为”的空洞；`exists`/`isFile` 的测试是否验证了生产默认路径 |
| `test/smoke.mjs` | 1MB 断言是否用了 `+256` 的宽容；超时/取消是否可能“刚好没杀也通过”；`pidAlive` 是否依赖英文输出 |
| `package.json` | `files` 与 `pi` 清单；`peerDependencies`；`engines` |
| `README.md` / `SKILL.md` | 是否还有“进程树被杀”的绝对承诺；codemode 两套 payload 是否讲清；tar 归属；`--ec` 与 32K |

**交叉引用检查**：用 `rg` 找旧说法（`2001–3000`、`每次启动`、`process tree is killed`、`2.56.0`/`15.2.0`、`一次调用 = 一次`），确认每处要么已改、要么是历史引用。

### 阶段 2 — 健康路径运行时（45 min）

在新会话中实际调用（或直接 `definition.execute` + ctx）：

1. `echo 你好; pwd; command -v ls` → CJK、`/d/...`、winuxcmd。
2. `seq 1 3000` → 尾部提示 **1001–3000**、`Full output:` 路径可 `cat`。
3. `exit 3` → `isError` + `exit_code:3`。
4. heredoc + 管道 → `HELLO`。
5. `timeout: 1` + `sleep 5` → 超时文案；`echo "shell=$$"` + 轮询确认消失。
6. 40,000 字符命令 → 新文案（`about 32K characters`），不是裸 `spawn ENAMETOOLONG`。
7. `timeout: 0` / `-1` → Pi 的 `Invalid timeout...`；确认 DESCRIPTION 已写 `> 0`。
8. codemode：1.2MB 输出 → `truncated:true`、`full_output_path`、`[... N bytes omitted ...]`。
9. 截断三边界：2000 行、50KB、单行 60KB（`lastLinePartial` + `[Showing last 50.0KB`）。
10. 引号/verbatim：`echo "a b" 'c d'`、`echo 'x\y'`、CJK 参数。

### 阶段 3 — 降级与平台（30 min）

用 §6 探针，分别：

1. 正常：`niubash` 在 `all`/`active`，description 以 `Run a command in Niubash` 开头，guidelines 无版本号。
2. `PI_NIUBASH_PATH=C:\Windows\System32`：description `Unavailable:`，guidelines 只提 powershell/文件工具，**不含** `before the powershell tool`；`session_start` 有警告。
3. `PI_NIUBASH_PATH` 指向不存在的路径：`notFile` 为空，错误只列路径。
4. 单元层验证非 win32：`resolveNiu({platform:"linux"})` 仍会找 `niu.exe`（记录，不作为缺陷），`isSupportedPlatform("linux")===false`；说明真实非 Windows 端到端**无法在本机验证**（标注推断）。
5. 观察 stub 在 codemode 中被调用时的行为（抛错 vs 结构化错误）——记录，不下结论。

### 阶段 4 — 错误面与边界（30 min）

- `PI_NIUBASH_PATH` 指向一个**存在但不可执行**的文件（可选：0 字节 `.exe` 或 ACL 拒绝；收益低、构造麻烦，可只记录“未测”）→ 记录 errno 映射。
- 不存在的 cwd（`definition.execute` 给 `ctx.cwd = Z:\\nope`）→ 记录 Pi 的 `Working directory does not exist` 是否被包装（不应被映射）。
- 超长 PATH / 空 PATH / 全是目录的 PATH。
- `timeout` 为 `0.5`（小数）→ 是否接受；极大值（`1e9`）→ Pi 的 max 报错。
- 并发两次调用同一命令 → 无串扰；`PI_SESSION_ID` 在子进程里正确（`printf '%s' "$PI_SESSION_ID"`）。

### 阶段 5 — 文档一致性（30 min）

做一张“声称 → 实测”表，至少覆盖：

| 声称（文件） | 验证方式 |
|---|---|
| README：`tar` → System32 bsdtar | `type tar; tar --version` |
| README：`sed` 是 shell 仿真 | `type sed; type -a sed` |
| README：codemode ≈1MB head+tail + 省略标记 | 1.2MB 探针 + 读 `output` |
| README/DESIGN：`timeout > 0` | `timeout:0` 的错误 |
| README/DESIGN：约 32K 命令行 | 40K 探针 |
| README：Windows-only、其他平台不注册 | 代码 + 单测；端到端标注未测 |
| README/DEV：`files` 只发 DESIGN.md | `npm pack --dry-run` |
| DESIGN：§6.2 packages 是纯字符串 | 读 `settings.json` |
| DESIGN：§9 14–20 项 | 逐项对照本轮实测 |
| CHANGELOG：best-effort kill、无版本号 | 文本 + 运行时 |

同时检查文档内部链接（`docs/*.md` 相对路径）是否存在。

### 阶段 6 — 测试可信度（30 min）

目的：证明测试**不是假绿**。把仓库复制到 `%TEMP%\pi-review-mut`（不碰原仓库），做 5 个突变：

1. `src/niu.ts` 的 `defaultKind` 永远返回 `"file"`。**预期：单测全过、smoke 的 `rejects a directory` 失败**——目录型单测注入了 `isFile`，生产默认的 `statSync` 只被“可选运行”的 smoke 覆盖，CI 不跑 smoke。这本身就是一条覆盖漏洞（CI 上看不到），写入 REVIEW-R3，建议补一个“真实临时目录”的单测。
2. `src/tool.ts` 的 stub 改回 `PROMPT_GUIDELINES`。**预期：单测全过、smoke 的 stub 检查失败**——单测只测常量，不测接线。同样记一条覆盖漏洞，建议单测直接调用 `createUnavailableDefinition`（需要 SDK）或至少断言 `tool.ts` 引用了 `UNAVAILABLE_*`。
3. 删掉 `withSpawnGuidance` → smoke 的 40K 断言必须失败。
4. `src/prompt.ts` 加回 `niugit 2.56.0` → 无版本号单测必须失败。
5. `src/niu.ts` 的 `notFile` 改成永远 `[]` → 目录型单测必须失败（它直接断言了 `notFile`）。

每个突变只跑对应测试；记录“失败信息是否指向真正原因”。若某个突变**没有**让测试失败，就是覆盖漏洞，写入 REVIEW-R3。

### 阶段 7 — 回归与残留（15 min）

```bash
git -C /d/workdir/pi-niubash-windows status --porcelain
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'niu|pi-tools-probe|pi-race' } | Select-Object ProcessId,Name,CommandLine"
ls -la "$TEMP" | grep -Ei 'pi-tools-probe|pi-race|sessextract|probe'
ls -la ~/.pi/agent/sessions/--D--workdir--/ | tail -5
```

确认本轮没有留下新会话文件/探针目录；有则记录并清理（会话 JSONL 不删）。

### 阶段 8 — 结论与落盘（30 min）

写 `docs/REVIEW-R3.md`，结构见 §7；结论必须区分：

- **A. 修复是否成立**（逐条：B1/B2/B4/B5/B6 + C9/C12）
- **B. 新发现**（本轮才出现的，编号 C1…；含代码/文档/测试/发布）
- **C. 仍存疑**（无法定因或本机不可测）
- **D. 建议修复**（按批次，等批准）
- **E. 本轮副作用与残留**

---

## 5. 断言清单（可直接当验收表）

| ID | 断言 | 检查方式 | 通过标准 |
|---|---|---|---|
| V1 | 目录型 `PI_NIUBASH_PATH` 被拒绝 | 单测 + 探针 | `found:false`、`notFile` 含该路径、错误含 `not files`；⚠ 单测走注入，生产 `statSync` 默认需额外用例 |
| V2 | stub 不注入冲突规则 | 探针 + 单测（常量）+ smoke（接线） | 无 `before the powershell tool`、无 `as the default shell`；单测只覆盖常量，接线由 smoke 覆盖 |
| V3 | 非 Windows 不注册 | 单测 `isSupportedPlatform` | win32 true，其余 false；端到端标注未测 |
| V4 | 40K 命令给出可操作错误 | smoke/手工 | 文案含 `about 32K characters` |
| V5 | 坏 `niu.exe` 路径给出 `Could not start` | smoke | 文案含 `PI_NIUBASH_PATH must point at niu.exe itself` |
| V6 | DESCRIPTION 不含 `x.y.z` | 单测 + `rg` | 无版本号；长度 ≤1400 |
| V7 | `timeout > 0` 已写进模型可见文本 | 读 DESCRIPTION | 含 `greater than 0` |
| V8 | 文本截断三边界 | 手工 | lines / bytes / lastLinePartial 各一次 |
| V9 | structured 1MB | codemode | `truncated:true` + 省略标记 + `full_output_path` |
| V10 | 超时/取消进程树 | 轮询 | `$$`/`$!` 在 ≤10s 内消失 |
| V11 | 退出码/abort/timeout 不被 errno 包装 | 手工 | 原文案保留 |
| V12 | `tar` 归属文档正确 | 手工 | System32 bsdtar 3.8.9 |
| V13 | README/SKILL 无中文 | `rg` | 0 命中（CJK 内容除外） |
| V14 | pack 内容 | `npm pack --dry-run` | 15 文件、无 ACCEPTANCE/REVIEW |
| V15 | CI typecheck 不是假绿 | 读 YAML + 本机模拟 | 安装 devDeps、断言 typescript、非 `npx tsc` |
| V16 | 测试可被突变杀死 | 阶段 6 | 3/4/5 失败；1/2 的“单测不失败、smoke 失败”本身是两条 CI 覆盖发现 |

---

## 6. 探针（复制即用）

`%TEMP%\pi-expose-probe.ts`：

```ts
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function probe(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    const tool = pi.getAllTools().find((t) => t.name === "niubash");
    writeFileSync(process.env.PI_PROBE_OUT ?? "probe.json", JSON.stringify({
      active: pi.getActiveTools(),
      all: pi.getAllTools().map((t) => t.name),
      niubash: tool && {
        description: tool.description,
        guidelines: tool.promptGuidelines,
        exposure: tool.exposure,
      },
      // 注：getAllTools() 不返回 promptSnippet（第二轮实测），不要再断言它,
    }, null, 1));
    process.exit(0);
  });
}
```

```powershell
$env:PI_PROBE_OUT = "$env:TEMP\probe.json"
pi --no-session -e "$env:TEMP\pi-expose-probe.ts" -p "noop"
Get-Content $env:TEMP\probe.json
```

降级变体：`$env:PI_NIUBASH_PATH = "C:\Windows\System32"` 再跑一次。

> 已知：新建隔离 `agentDir` 首次启动会 `npm install` 约 211 个包（7–22s），不是挂起。

---

## 7. `docs/REVIEW-R3.md` 模板

```markdown
# pi-niubash-windows — 第三轮审阅

- 日期 / 审阅者 / 被测状态（git status、版本）
- 方法：按 REVIEW-PLAN.md，探针 + 实测；未改源码
- 结论一句话（修复是否成立、几个新问题、几个存疑）

## 1. 修复验证
| 项 | 结论 | 证据 |
（B1/B2/B4/B5/B6、C9/C12）

## 2. 新发现（C1…）
| # | 问题 | 证据 | 影响 | 严重度 | 修复方案 |

## 3. 存疑/未测
（平台端到端、上游 bug、无法定因）

## 4. 修复方案（分批，待批准）
| 批次 | 文件 | 改动 | 验证 |

## 5. 本轮副作用与残留
（进程/临时文件/会话/暂存区）

## 6. 复现命令
```

严重度建议：`阻断 / 高 / 中 / 低 / 文档`；每条新发现必须带“期望 vs 实际”。

---

## 8. 交付与退出条件（Definition of Done）

- [ ] §2.3 五项门禁全部有输出记录
- [ ] §5 的 V1–V16 全部有“通过/失败/未测”判定
- [ ] 阶段 6 的 4 个突变都有结果
- [ ] 每个“通过”附命令与关键输出；每个“推断”有标记
- [ ] `docs/REVIEW-R3.md` 落盘
- [ ] 残留检查完成，`git status` 记录在案
- [ ] 修复建议按批次分组，明确“需用户批准才能动源码”

---

## 9. 时间不够时的优先级

1. §2.3 门禁（否则一切结论无意义）
2. V1/V2/V4/V5/V9/V10（本轮修复的核心）
3. 阶段 6 突变（证明测试可信）
4. 阶段 5 文档一致性
5. 其余边界用例

---

## 10. 附：行号会漂，用这些命令定位

```bash
rg -n "isFile|notFile|isSupportedPlatform" src/
rg -n "UNAVAILABLE_|describeSpawnError|withSpawnGuidance" src/
rg -n "greater than 0|32K|niugit" src/prompt.ts
rg -n "truncatedBy|lastLinePartial|full_output_path" test/smoke.mjs
rg -n "include=dev|npx tsc|typescript" .github/workflows/ci.yml CONTRIBUTING.md README.md
rg -n "2001|每次启动|process tree is killed|2\.56\.0|15\.2\.0" README.md docs/ skill/
```

最后一条用于捕捉“旧说法残留”；命中项要么是历史引用（REVIEW-R2/ACCEPTANCE 原表），要么是漏改。