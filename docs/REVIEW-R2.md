# pi-niubash-windows — 验收复核（第二轮）

- 复核日期：**2026-11-14**
- 复核对象：`docs/ACCEPTANCE.md`（第一轮 13 项验收报告）以及被测代码 `56ae64c`
- 复核方式：逐条读源码（Pi 1.5.2 `dist/core`、`dist/utils`、`dist/extensions/codemode`）+ 真实工具调用实测；**未改动任何源码**
- 状态：**结论已出；修复批次 1–5 已批准并执行（2026-11-14），执行结果见 §8、§9 与 [`ACCEPTANCE-METHOD.md`](./ACCEPTANCE-METHOD.md)**
- 结论：**健康路径的 13 项成立；第一轮“未发现功能缺陷”需改判**——降级路径有 1 个功能缺陷（B2）。报告有 **4 处不严谨** + 复核过程中自纠的 **4 处证据/结论表述**，另有 **9 个未暴露的问题**（2 个真缺陷、4 处模型可见文档与事实不符、3 个工程/发布缺口）

> 本文的"实测"均为本机真实输出；源码引用给出 `dist/...` 的相对路径与行号。
> 复核期间执行过仓库自带门禁：`npm test`（13/13 通过）、`test/smoke.mjs`（全部通过）、`resolveNiu` 单点探针。

---

## 0. 事故记录：第一轮会话日志被覆盖

复核过程中，我用来自动提取会话内容的临时脚本写错了 `process.argv` 索引，把第一轮的会话 JSONL 覆盖成了 368 字节（原文件 125 行 / 313,902 字节）：

```
%USERPROFILE%\.pi\agent\sessions\--D--workdir--\
  2026-11-14T11-33-47-256Z_<session-id>.jsonl
```

- 已排查、均不可用的恢复手段：卷影副本、文件历史、管理员权限、`winfr`、全盘第二份副本；pi-web 索引只存元数据，且该条目已不在索引内。
- 覆盖前生成的低保真摘要已另存：
  `%USERPROFILE%\.pi\agent\recovery\2026-11-14T11-33-47-256Z_<session-id>.acceptance-session.partial-extract.txt`
  （839 行 / 130 KB；含全部消息、工具调用参数、每条结果前 1200 字符、思考摘要；缺 `id`/`parentId`/时间戳）
- 影响：ACCEPTANCE.md 的结论仍可复核（已用源码与实测独立重验），本文的发现不依赖原日志。
- 2026-11-14 20:02 用户提供的导出文件（`<workdir>\2026-11-14T11-33-47-256Z_<session-id>-….jsonl`）经解析后**不是本会话**，而是 11:00 的实施会话；详见 §7。

---

## 1. 第一轮报告自身的问题

| # | 报告说法 | 实际情况 | 证据 |
|---|---|---|---|
| A1 | "codemode 的结构化视图不带截断语义"，并建议"改用带 `details.truncation` 的断言" | **误判**。Pi 的 shell 工具按设计输出两套 payload：文本内容（2000 行 / 50KB）+ `structuredContent`（`readFullOutput(1MB)`）。codemode 只拿后者；那里的 `truncated` 指 **1MB 上限**，`full_output_path` 也只在该上限触发时出现。报告推荐的 `details.truncation` 在 codemode 中根本不可见，建议无法执行 | `dist/core/tools/bash.js:315-325`；`dist/core/tools/output-accumulator.js:115-140`；`dist/extensions/codemode/execute.js:419`（"A tool that declares `outputSchema` resolves to its `structuredContent`"）；实测 1,048,610 B → `truncated:true` + `pi-bash-7f3acc9e9b30ad9f.log`；139,893 B → `false` |
| A2 | 第 4 项"超时 + 进程树清空 ✅"，证据写 `Get-Process -Name niu,sleep,bash` 计数 0 | 命令**确实写了** `-Name niu,sleep,bash`，但 `sleep`/`bash` 不是 Windows 进程名，且被 `-ErrorAction SilentlyContinue` 静默吞掉；真正参与计数的只有 `niu`。SDK 的 `killProcessTree()` 是 **fire-and-forget**（`taskkill` 以 detached 方式 spawn，不 await，错误吞掉），所以"清空"不是同步保证。实测：超时错误返回后 `niu.exe`+`sleep.exe` 仍可存活（一次 +400ms 消失，另一次返回约 1s 时仍在） | `dist/utils/shell.js:188-205`；本轮两次采样 |
| A3 | 第 13 项把"skill 同步消失"写在"实测"列 | 这是**推断**。日志显示 `PACKAGE-REMOVED` 的 RPC 探测 60s 超时，重试被用户中断；skill 侧从未直接测到。且"全机无第二处来源"只查了 `~/.pi/agent/skills` 与 `~/.agents/skills`，未查项目级 `.agents/skills` | 第一轮日志（摘要 #88–#97） |
| A4 | "副作用：无" | 每个**新建**的隔离 `agentDir` **首次**启动会 `npm install` 211 个包（22s / 7s 两次观测，约 88MB/份）；同一目录后续启动只做增量（`added 1 package`）。原文"每次启动"不准确。报告未记录这笔成本，它也大概率是 A3 探测超时的原因 | 摘要 #74/#76 |

---

## 2. 报告未暴露的问题

### 2.1 代码 / 行为（2 项）

#### B1 `PI_NIUBASH_PATH` 指向目录时被当作可用

- 现象：`src/niu.ts:78` 只用 `existsSync`。`PI_NIUBASH_PATH=C:/Windows` → `resolveNiu` 返回 `{found:true}`；随后每次调用抛 `spawn C:/Windows ENOENT`，无任何指引。
- 影响：与"不可用时给出可操作错误"的设计承诺相反；用户手误（指向安装目录而非 `niu.exe`）时得到原始 spawn 错误。
- 实测：

```text
resolveNiu({ PI_NIUBASH_PATH: "C:/Windows" })
  => {"found":true,"path":"C:/Windows","source":"PI_NIUBASH_PATH"}
execute("echo hi")
  => threw: spawn C:/Windows ENOENT
```

#### B2 降级态提示自相矛盾（真实功能缺陷）

- 现象：`src/tool.ts:71` 的不可用 stub 仍复用 `PROMPT_GUIDELINES`，其中 `src/prompt.ts:41` 为
  "Use niubash as the default shell … choose it **before** the powershell tool"，
  而同一工具的 description 说"不可用，改用 powershell"。
- 原因：Pi 只对**激活**工具注入 guidelines（`dist/core/system-prompt.js:61` 只遍历 `selectedTools`；`dist/core/agent-session.js:601` 的 `selectedTools = getActiveToolNames()`）。降级工具若在 `defaultTools` 中即为激活状态，两条互斥指令同时进入 `<rules>`。
- 影响：`niu.exe` 缺失（或路径失效）时，模型会被系统规则要求优先调用一个必然失败的工具。
- 备注：第一轮完全没有覆盖降级路径。

### 2.2 模型可见文档与事实不符（4 项）

#### B3 `tar` 归属写错

- `README.md:121` 把 `tar` 列为 **WinuxCmd 1.2.1** applet。实测：`type tar` → `/c/WINDOWS/system32/tar.exe`，`tar --version` → `bsdtar 3.8.9`；`winuxcmd/usr/bin` 下**没有** `tar.exe`。
- `src/prompt.ts:43` 的 guideline 把"Unix toolbelt"整体说成 WinuxCmd，表述过宽。
- 补充：`sed` 是 Niubash 的 shell 仿真，最终仍解析到 `winuxcmd/usr/bin/sed.exe`（`sed (WinuxCmd) 1.2.1`），该项可保留。

#### B4 超长命令只报 `spawn ENAMETOOLONG`

- 实测 40,000 字符的命令 → `spawn ENAMETOOLONG`，没有说明与 workaround。
- skill 里的 `--ec` 逃生舱对此无效（限制在传给 `niu.exe` 的 argv 长度，约 32K 字符）。

#### B5 模型可见文本硬编码主机版本

- `src/prompt.ts:31,43` 写死 "niugit 2.56.0 / ripgrep 15.2.0"；README 又写 "Niubash 1.5.0 **or later**"。
- 风险：Niubash 升级后 system prompt 会长期说错版本，且与 "or later" 自相矛盾。

#### B6 `timeout: 0` 的报错措辞

- 实测 `timeout: 0` → `Invalid timeout: must be a finite number of seconds`（0 是有限数）。
- 文档未说明 `timeout` 必须大于 0。

### 2.3 工程 / 发布（3 项）

#### B7 CI 与测试门禁缺口

- `.github/workflows/ci.yml` 只跑 `npm test`；`npm run typecheck` 从不执行。本机执行还会因 `npm config omit=dev` 直接失败。
- smoke 的 "enforces timeouts and **kills the process tree**" 只断言 reject，**没有断言进程树**（与 A2 同源）。
- 截断只覆盖 2000 行路径；50KB 字节路径、单行超限 partial、1MB structured 路径均未覆盖。
- 没有降级 stub、ENAMETOOLONG、`PI_NIUBASH_PATH` 端到端测试。

#### B8 发布内容

- `package.json:17-21` 的 `files` 含整个 `docs` → 会把 DESIGN / ACCEPTANCE 等内部记录打进 npm 包。
- `peerDependencies: "*"` 与 README "≥1.5" 不一致；缺 `repository` / `bugs` / `homepage`。

#### B9 DESIGN 与实际不一致

- `§6.2` 说 package 条目是对象形状，实际 `pi install` 写入的是纯字符串。
- `§4.5` 未写两种 payload。
- `§9-4` "进程树清空"应注明异步、best-effort。

---

## 3. 第一轮两处清单偏差（复核确认）

| 项 | 复核结果 |
|---|---|
| `§9-2` | 确认清单数字有误。3000 行输出保留的是 **最后 2000 行 = 1001–3000**，不是 2001–3000；`[Showing lines 1001-3000 of 3000 …]`、全量文件 3000 行可 `cat` |
| `§9-11` | 确认 `SKILL.md` 中没有中文字面 "一次调用 = 一次 `niu -c`"，等价的英文句在 `skill/SKILL.md:30` |

---

## 4. 修复方案（分批，待批准）

### 批次 1：文档事实修正（零代码风险）

| 文件 | 改动 |
|---|---|
| `README.md` | `:121` tar 行改为实测事实（`ls/find/grep/sed/awk` → WinuxCmd；`tar` → Windows bsdtar 3.8.9）；`:85` 行为表补"codemode 拿 structuredContent ≤1MB，`truncated` 与文本截断无关"；`:93` codemode 段说明两套 payload；`:153` 注明 `PI_NIUBASH_PATH` 必须是 `niu.exe` 文件；补 `timeout` 必须 > 0、命令行上限约 32K、超时/取消的 kill 是异步 best-effort |
| `docs/DESIGN.md` | `:265` `2001–3000` → `1001–3000`；`:280` 第 11 项改引英文原句；`§4.4`/`§4.5` 补 50KB 文案变体与两种 payload；`:197 §6.2` 改成实际字符串形状；`§10` 增加 tar 归属、ENAMETOOLONG、版本漂移三条风险 |
| `skill/SKILL.md` | **保持英文**；「In Pi」补 codemode ≤1MB 与文本截断的区别、`tar` 归属、32K 上限（注明 `--ec` 不解决 argv 长度）。`DESIGN.md` §9-11 改引英文原句（原计划的中文字面对照已取消） |
| `docs/ACCEPTANCE.md` | 顶部加"更正（复核）"小节，修正 A1–A3 的措辞与证据，追加本轮新增发现 |

### 批次 2：代码（2 个真缺陷 + 提示面）

1. `src/niu.ts`：`exists` → `isFile`（保持可注入），目录/不可执行路径按"未找到"处理，错误里说明"存在但不是文件"。
2. `src/tool.ts`：包一层 `execute`，捕获 `ENAMETOOLONG / ENOENT / EACCES` 转成可操作错误（"命令行过长（约 32K 上限）：把脚本写到文件再执行"等）；不改 timeout/abort/非零退出语义。
3. `src/prompt.ts` + `src/tool.ts`：新增 `UNAVAILABLE_GUIDELINES` / `UNAVAILABLE_SNIPPET`（明确"用 powershell，直到安装 Niubash"），stub 不再推荐自己。
4. `src/prompt.ts`：DESCRIPTION/guideline 去掉硬编码版本号，改为定性描述；精确版本只留在 README/DESIGN 的"验证于"段落。**DESCRIPTION 同时补两条模型可见限制**：`timeout` 必须 > 0（B6），单条命令约 32K 字符上限（B4）。

### 批次 3：测试与 CI

1. `test/unit.test.mjs`：目录型 `PI_NIUBASH_PATH`；stub 指南不冲突；DESCRIPTION 不含硬版本；错误文案含 "not a file"。
2. `test/smoke.mjs`：字节截断（断言 `truncatedBy === "bytes"`）；单行超限（`lastLinePartial`）；structured 1MB（`truncated:true` + `full_output_path` + 省略标记）；**超时与取消两条路径**都从错误文本里取 `$$` / `$!` PID，再用 `Get-Process -Id` **有界轮询**（≤10s）确认消失；超长命令的新错误文案。注：`tasklist` 输出会本地化，且工具不暴露子进程 PID，不能用 `tasklist /FI` 直接等一个未知 PID。
3. `.github/workflows/ci.yml`：新增 typecheck job（`npm install --include=dev` → `npm run typecheck`；仓库无 lockfile，暂不用 `npm ci`）。
4. 本机全量门禁：`npm test`、`PI_CODING_AGENT_SDK=… npm run test:smoke`、`npm install --include=dev && npm run typecheck`。

### 批次 4：发布元数据（建议单独批）

- `files` 收窄为 `["src","skill","docs/DESIGN.md","README.md","CHANGELOG.md","LICENSE"]`
- `peerDependencies: ">=1.5.0"`
- 补 `repository` / `bugs` / `homepage`（需要真实仓库 URL）

### 修完后的验收

重跑 13 项 + 新增 6 项断言，结果写回 `docs/ACCEPTANCE.md` 的"复核"节。

---

## 5. 批准与执行状态（2026-11-14）

用户批准 **1–5**（文档 → 代码 → 测试/CI → 发布元数据与卫生），另加一条：**README 与 skill 中的中文全部改为英文**。

| 事项 | 状态 |
|---|---|
| R2 自纠（A2/A4/N1/N6/§7.1/§6 复现/批次 3 断言） | ✅ 已改入本文 |
| 文档事实修正（README / DESIGN / CHANGELOG / SKILL / ACCEPTANCE） | ✅ |
| 代码（B1/B2/B4/B5/B6 + 平台闸门 + stub 三件套） | ✅ |
| 测试与 CI（18 项单测 / 13 项 smoke / typecheck job） | ✅ 全绿 |
| 发布元数据（`files` / `peerDependencies`） | ✅；`repository`/`bugs`/`homepage` 仍缺仓库 URL |
| 上游 issue（`--tools` 偶发 0 工具等） | ⏸ 未获批准，仅记录在 §9 |

---

## 6. 复现要点（本轮实测命令）

```bash
# B1：目录型 PI_NIUBASH_PATH
node -e 'import("file:///<repo>/src/niu.ts").then(m=>console.log(m.resolveNiu({env:{PI_NIUBASH_PATH:"C:/Windows"}})))'
# 直接调 execute 时务必给 ToolContext（否则先抛 getSessionId 的 TypeError）：
#   const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "probe" } };
#   await def.execute({ command: "echo hi" }, ctx)  →  spawn C:/Windows ENOENT

# B3：tar 归属
type tar; tar --version | head -1
ls "$(dirname "$(command -v niu)")/winuxcmd/usr/bin" | grep -i '^tar' || echo "no tar in winuxcmd"

# B4：超长命令
node -e 'import("file:///<repo>/src/tool.ts")'   # 或经工具调用 40,000 字符命令 → spawn ENAMETOOLONG

# A1：两种 payload
# 139KB 输出 → structuredContent.truncated=false
# 1.05MB 输出 → structuredContent.truncated=true + full_output_path

# 仓库门禁
npm test
PI_CODING_AGENT_SDK="%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent" node test/smoke.mjs
```

---

## 7. 导出会话复核（`<workdir>\2026-11-14T11-33-47-256Z_<session-id>-….jsonl`）

### 7.1 文件不是验收会话

| 项 | 实际 |
|---|---|
| 文件名中的 id | `<session-id>`（第一轮**验收**会话） |
| 内容中的 id | `<session-id>` |
| 时间范围 | 2026-11-14T11:00:31 → 11:31:22 |
| 规模 | **149 行 / 150 个 JSON 事件** / 800,754 B（文件无结尾换行，`wc -l` 少数一行） |
| 实质 | 第一轮**实施**会话：建仓、写 `src/`、`npm test`、smoke、`pi install`、改 `defaultTools` |

验收会话（`<session-id>`）仍未恢复，需要用户从其它渠道重新导出。

### 7.2 新发现的问题

#### N1 “启动检查”是空转的

实施会话 #142 执行：

```powershell
pi --print --tools niubash,read "Reply with the single word READY and nothing else."
```

该命令创建了嵌套会话 `<session-id>`（11:28:43 → 11:28:46），其 system prompt 为 `<tools>(none)</tools>` —— **零工具**。也就是说，这次检查从未验证 `niubash` 是否会暴露。

复现记录（同一现象，两套证据）：

- 11:28 的嵌套会话、12:09 的独立 `--session-dir` 运行各出现一次 `(none)`；
- 同一命令在 12:09:45–52 连续 4 次、20:10 经 `niubash` 工具连跑 3 次均正常；
- 第二轮另测到 **连续 10 次 `[]`**，随后 **13 次全部正常**（同一命令、同一目录形状）；20:11:01/04 又出现两次空结果。

结论（已修正）：

1. **`pi --print --tools <plain list>` 不能作为暴露门禁**：它会偶发解析为 0 工具，连内置 `read` 都不在，原因未定（像是允许列表在扩展注册完成前整体失败）。这与“是否嵌套”无关。
2. **嵌套 `pi` 另有问题**：它不是“0 工具”的原因，但会在模型返回后挂住外层管道（见 N2），同样禁用。
3. 当时的定因实验（6-run race probe）在会话结束时**没有返回结果**，所以不得把窗口化现象写成定论。

应改用 `session_start` 就退出的探针扩展（第一轮 §13 用的就是后者），见 [`ACCEPTANCE-METHOD.md`](./ACCEPTANCE-METHOD.md)。

#### N2 对挂起的诊断是错的

嵌套会话的时间线：user 11:28:44.138 → assistant `READY` 11:28:46.007（`durationMs: 1843`、`stopReason: stop`）。

因此实施会话 #150 的“它在模型那一层一直没返回”**不成立**：模型 1.8s 就返回了，挂起发生在模型返回之后的 shell/管道层（`| Out-String` 未收到 EOF 或进程未退出）。本轮用同一命令（加 `--no-session`）复测：1.8–2.0s 正常返回，无法复现。

#### N3 遗留被锁定的空目录

`<workdir>\niubash\pi` 从 19:28 起删除时报 `being used by another process`，#150 仅记为“无影响”。该目录一直存在到 20:07 才被本轮删除；锁定持有者未查明（最可能是 pi-web / Next 的文件监听）。验收清单应增加“环境残留检查”。

#### N4 `tar` 误判的源头

#85 回答用户“会不会冲突”时称“系统目录里根本没有这些 GNU 实现，属于纯增益”。这句未验证的概括随后进入 `README.md:121`（把 `tar` 列为 WinuxCmd applet）。实测 System32 有 **bsdtar 3.8.9**，见 B3。

#### N5 单元测试曾有一次假失败

#122 出现 `✖ standard install directories are used after PATH`；#123 通过修改**测试断言**（`checked` 只能在“未找到”时断言）修复，代码未动。当前 13/13 通过，但说明首版测试的 `checked` 语义写错了，第一轮报告未记录。

#### N6 `docs/DESIGN.md` 状态过期

`：3` 仍写“P4 安装待执行”，§8 P5 仍是 ⏳；而该会话在 19:28 已完成 `pi install ./pi-niubash-windows` 并修改 `defaultTools`。注意阶段编号也写错了：§8 里 **P4 = `src/*` + `test/*`（✅）**、**P5 = 安装 + 验收**；状态行却把“安装”挂到 P4。

- `pi list` 可见 `<repo>`
- `settings.json` 中该条目是**纯字符串**（印证 B9）
- 备份 `settings.json.bak-pi-niubash-20261114-192818` 存在
- `defaultTools` 现为 `read, powershell, niubash, edit, write, codemode, grep, find, ls`

第一轮报告未指出这处文档与事实不符。

#### N7 实施会话没有跑 typecheck

#150 只列出 `npm test`（13/13）与 smoke（8/8），确认从未执行 `npm run typecheck`，与 B7 相互印证。

### 7.3 该会话确认无误的部分

- `pi install ./pi-niubash-windows` → `pi list` 可见；`settings.packages` 写入纯字符串条目；`defaultTools` 追加成功；备份文件存在。
- `npm test` 13/13；smoke 8/8（`PI_CODING_AGENT_SDK` 指向全局 SDK）。
- heredoc/管道、UTF-8 中文、`command -v ls` 指向 winuxcmd、`exit 3`、3000 行截断 + 临时文件、1s 超时。

### 7.4 对验收方法的修订建议

1. 禁止用“工具内再启动一个 Pi”做验收；它会在模型返回后挂住外层管道（N2）。统一用 `session_start` 探针扩展（不产生模型调用）。
2. 禁止用 `pi --tools <list>` 判断暴露：允许列表会偶发解析为 0 工具（N1），且无法定因。
3. 任何“工具是否暴露”的断言必须读探针落盘的 `getAllTools()`/`getActiveTools()`，不读模型自述。
4. 验收前后各做一次环境残留检查：`niubash\pi` 之类空目录、`niu.exe`/`sleep.exe` 子进程、`%TEMP%` 大目录。
5. 验收记录要区分“实测”“推断”，并注明采样的时间点（A2 的教训）。
6. 探针要有预算：单条命令 ≤5s、单进程生成大输出、禁逐行 fork（§8）。
7. 提取脚本必须有护栏：`argv` 长度检查、输出路径 ≠ 输入路径、首行必须是 `{"type":"session"}`（§8）。

以上规则已固化到 [`ACCEPTANCE-METHOD.md`](./ACCEPTANCE-METHOD.md)。

---

## 8. 复核过程自身的副作用与未完成项

### 8.1 一次 8 分钟挂起（用户中断）

复核时用 codemode 跑一个“每行 fork 一次 `awk`/`printf`”的探针，生成 1.2MB 花了 **485.4s**，脚本被中断，用户回复“卡住了”。当时 `niu.exe`（PID 19668）仍在跑，随后自行消失。

- 根因：探针写法（逐行 fork），不是插件缺陷。codemode 没有 timeout 参数，所以整个会话被阻塞。
- 对策：探针预算写入方法（单进程生成、≤5s）；大输出一律 `awk 'BEGIN{...}'`。
- 同源证据：中断/超时后的 `taskkill` 都是 fire-and-forget，必须轮询确认（C8）。

### 8.2 临时产物与清理

复核期间创建/遗留：

- `%TEMP%` 下 19 个 `pi-bash-*.log`（含 1.2MB 全量）、`pi-codemode-*.txt`（130KB / 43KB）；
- `sessextract3.cjs`、`sess-<session-id>.index/full.txt`、`dirniu2.mjs`；
- `pi-tools-probe*` / `pi-race-*` / `pi-rep-*` 探针会话目录；
- 会话目录里的 368 B 事故残骸与嵌套会话 `<session-id>`。

本次处理：删除探针目录与提取脚本；保留 `%USERPROFILE%\.pi\agent\recovery\` 下的 839 行低保真提取件（证据），保留 368 B 残骸与 `<session-id>`（会话记录，未获准删除）。`pi-bash-*.log` 由 Pi 管理，未手工清理。

### 8.3 未完成/未执行

- **定因实验**：6-run race probe 在会话结束时没有返回结果（`--tools` 为何偶发 0 工具）。
- **真删 `pi remove`**：第一轮只做了等价配置验证；本轮也未改写本机安装。
- **验收会话恢复**：`<session-id>` 仍只有 368 B 残骸 + recovery 提取件，无法补测。
- **上游 issue**：未获批准，未提交。

### 8.4 本次执行结果（批准后）

| 门禁 | 结果 |
|---|---|
| `npm test` | **18/18 通过**（新增目录型 override、平台闸门、stub 一致性、无硬版本号） |
| `npm run typecheck` | 通过（`npm install --include=dev` 后） |
| `test/smoke.mjs`（真实 niu + SDK 1.5.2） | **15/15 通过**（含字节截断、1MB structured、超时/取消进程树轮询、32K 错误文案、stub、目录型路径） |
| CI | 新增 typecheck job（`--include=dev` + 本地 typescript 断言，不用 `npx tsc`） |

---

## 9. 未定问题（留给上游/后续）

1. **`--tools` 偶发 0 工具**（Pi 1.5.2）：同一命令会在窗口内全部解析失败（连 `read` 都没有），另一窗口全部正常。未定因；建议向上游报 issue 并附最小复现（`pi --print --tools read,niubash` ×N + 读 system prompt）。**未获准提交**。
2. **嵌套 `pi` 返回后挂起**：模型 1.8s 返回，外层 PowerShell 管道数分钟不结束。未复现，已禁用。
3. **`taskkill` fire-and-forget**：超时/取消后进程树异步消失。已在文档与 smoke 中处理（轮询），未改 SDK。
4. **`timeout: 0` 的错误文案**：“must be a finite number of seconds”（0 是有限数）。属上游措辞 bug，本仓已在 DESCRIPTION/README 写明 `timeout > 0`。
5. **单行截断的尺寸提示**：实测尾部提示为 `[Showing last 50.0KB of line 1 (line is 0B). …]`，`getLastLineBytes()` 在收尾后返回 0。属上游显示 bug，不影响截断本身。
6. **中文触发词移除后的 skill 召回**：SKILL 的 description 改为英文描述“Also triggered by Chinese-language requests…”，是否还能稳定命中中文提问，需在真实使用中观察；若下降，应向上游确认 skill 匹配是否支持多语言标签，而不是把中文塞回正文。