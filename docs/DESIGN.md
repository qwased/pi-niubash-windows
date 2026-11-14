# pi-niubash-windows — 设计文档

- 状态：**实施中**（P1 脚手架、文档、skill 已落地；P2 代码与测试随之完成，P4 安装待执行）
- 仓库：`<repo>`
- 目标宿主：Pi coding agent `@earendil-works/pi-coding-agent` **1.5.2**（本机经 `pi-web` 0.16.0 运行）
- 目标 shell：Niubash **1.5.0**，`%USERPROFILE%\AppData\Local\Programs\Niubash\niu.exe`
- 上游资料：`<workdir>\niubash\`（SKILL.md 原始版 + `references/`，本仓库 `skill/` 为其 Pi 语境重写版）

面向使用者的安装/用法说明见 [`README.md`](../README.md)；本文记录**为什么这样做**、已验证的宿主事实、冲突分析与验收口径。

---

## 1. 决策（已确认）

| 项 | 决定 |
|---|---|
| 工具名 | `niubash`（不覆盖内置 `bash`，不遮蔽将来的 Git Bash / WSL bash） |
| 安装方式 | **C**：本地 Pi 包 + `pi install ./pi-niubash-windows`，写入 `settings.packages` |
| Skill | 按 Pi 语境**重写**并在同一包内声明（`pi.skills`），与工具描述重合的内容删除 |
| `!` / `!!`（`user_bash`） | **不接管** |
| 默认超时 | **无**（与内置 `bash` / `powershell` 一致），仅按参数 `timeout` 生效 |
| 工具定位 | 默认 shell：**优先 `niubash`**，只有必须用 PowerShell 时才用 `powershell` |
| 公开标准 | MIT、README/CHANGELOG/CONTRIBUTING/LICENSE、CI、类型检查配置、可发布 `files` 白名单 |

非目标：不修改 Pi 内置工具、不改 `shellPath` 设置、不接管内置 `bash` 工具、不做 PTY/交互式全屏支持。

---

## 2. 已验证的宿主机事实（实测，非推断）

| 事实 | 证据 |
|---|---|
| `niu -c` 从 Node `spawn` 逐字传 argv | 引号 `a"b`、结尾反斜杠 `C:\dir\`、多行、heredoc、CJK 全部逐字正确 |
| 输出恒为 UTF-8 | 父控制台 CP 为 936 或 65001 时，niu 内 `chcp` 均报 `65001`，CJK 输出字节均为合法 UTF-8 |
| 退出码透传 | `exit 3`→3、`false`→1、命令未找到→127 |
| 流式输出 | `echo a; sleep 0.4; echo b` 两段分别到达，可驱动 `onUpdate` |
| 单次开销 | 65–100 ms |
| Pi 管道可复用 | `createLocalBashOperations({ shellPath })` + `createBashToolDefinition` 注入后，截断（2000 行/50KB + 临时文件）、超时 + `taskkill /F /T`、`ctx.cwd`、`PI_*` 环境、TUI 渲染器全部生效 |
| 管道陷阱 | `createBashToolDefinition(cwd,{shellPath})` 会忽略 `shellPath`（内部先填了默认 `operations`）→ 必须显式传 `operations` |
| 临时文件前缀 | 内置管道写死为 `pi-bash-*`（`createShellToolDefinition` 未导出，不 fork 内部实现） |
| 编码 | 不需要 PowerShell 工具的 `[Console]::OutputEncoding` 前缀，Niubash 自己处理 |
| 命令解析 | `git`→niugit 2.56.0（与系统 git 共用 gitconfig，提交哈希互通）、`rg`→winuxcmd ripgrep 15.2.0（与 Pi 托管 rg 同版本同 rev `e89fff89ac`、同 `+pcre2`）、`ls`→WinuxCmd 1.2.1 |

---

## 3. 架构

```
模型 ──tool call──▶ niubash(command, timeout?)
                      │
                      ├─ 复用 Pi 内置 shell 管道（OutputAccumulator / 截断 / 超时 / 进程树 / 渲染）
                      └─ spawn niu.exe -c <command>  (cwd = ctx.cwd, env = getShellEnv() + PI_*)

模型 ──tool call──▶ powershell(...)   ← 原生内置，未改动，两者互不影响
```

要点：

1. **不重写执行器。** `createBashToolDefinition(process.cwd(), { operations: createLocalBashOperations({ shellPath: niu }) })` 拿到完整定义，再 `{...def, name: "niubash", ...}` 改名注册 —— `renderCall` / `renderResult` / `outputSchema` 随对象展开保留。
2. **`defaultActive: false`**：注册为未激活，由 `settings.json` 的 `defaultTools` 显式开启，删一项即回滚。
3. **降级**：加载期只做一次 `existsSync` 探测（不启动后台资源、不跑 `niu doctor`）。
   - 找到 → 正常注册。
   - 未找到 → 仍注册 `niubash`（同一 schema），`execute` 抛可操作错误并列出所有探测路径；会话启动时若该工具已启用，`ui.notify` 一次。
   - 解析顺序：`PI_NIUBASH_PATH`（权威，指向不存在则报错而非静默回退）→ `PATH` → `%LOCALAPPDATA%\Programs\Niubash\niu.exe` → `%ProgramFiles%\Niubash\niu.exe`。
4. **零环境副作用**：不调 `pi.setActiveTools`、不改进程 env、不动 `getShellEnv()`；`powershell` 工具与 `codemode` 行为不变。

模块划分（便于无 SDK 单测）：

| 文件 | 职责 | 运行时依赖 |
|---|---|---|
| `src/niu.ts` | 纯路径解析（可注入 `env` / `exists` / `platform`） | `node:fs`、`node:path` |
| `src/prompt.ts` | 工具名、description、snippet、guidelines、错误文案、截断常量 | 无 |
| `src/tool.ts` | 把 SDK 的 shell 管道包装成 `niubash` 定义；不可用时的 stub | 仅 `import type` |
| `src/index.ts` | 扩展入口：解析 → 注册 → 提示 | SDK + 上述模块 |

---

## 4. 工具契约

### 4.1 参数

```jsonc
{ "command": "string", "timeout": "number (seconds, optional)" }
```

沿用内置 shell 的 schema（`command` / `timeout`），不新增字段；不可用 stub 复用同一 schema，保证旧会话的 tool call 仍能通过校验。

### 4.2 `description`（实际正文见 `src/prompt.ts`）

必须包含：Niubash 身份（bash 5.3 方言、无 WSL/MSYS/Cygwin/POSIX/PTY）、`niu -c` 语义（不加载 rc/插件）、2000 行/50KB 截断与临时文件、退出码、无默认超时、路径契约要点、winuxcmd 前置、无 PTY。

### 4.3 `promptSnippet` / `promptGuidelines`

- snippet：`Run bash-syntax commands on Windows (Niubash: no WSL/MSYS)`
- guidelines（扁平追加到 `<rules>`，每条必须点名工具）：
  1. 默认 shell：命令行工作优先于 `powershell`
  2. `powershell` 只用于 PowerShell 原生能力
  3. niugit / winuxcmd 前置说明 + 需要系统工具时用全路径
  4. 不用 shell 替代 `read` / `grep` / `find` / `ls` / `edit`

> 第 4 条刻意不与 Pi 自带规则（`Use read to examine files instead of cat or sed.`）冲突：niubash 抢的是 "shell 命令"，不是 "文件工具"。

### 4.4 结果语义

| 场景 | 结果 |
|---|---|
| 正常退出 0 | `content` 文本；`structuredContent = { output, truncated, exit_code, wall_time_seconds }` |
| 非 0 退出 | 同上 + `isError: true`，尾部 `Command exited with code N` |
| 超时 | 抛错，含已捕获输出 + `Command timed out after N seconds` |
| 超 2000 行 / 50KB | 保留尾部 + `[Showing lines X-Y of Z … Full output: <temp>]`，`details.truncation` / `details.fullOutputPath` |
| `niu` 缺失 | `isError: true`，列出探测路径 + 安装指引 |
| 取消（signal） | 进程树 `taskkill /F /T`，返回 `Command aborted` |

### 4.5 codemode

`exposure` 保持默认 `direct`：模型直调；脚本可 `await tools.niubash({ command })` 直接拿带 `exit_code` 的对象。

---

## 5. 与 Pi 内置工具的关系：`git` / `rg` / `ls` / `find` 会冲突吗？

**结论：不会冲突。**

### 5.1 工具层——无重叠

`niubash` 是新增的第 9 个工具名，不覆盖 `read` / `write` / `edit` / `grep` / `find` / `ls` / `powershell`。

### 5.2 进程层——Pi 自己调用的二进制不受影响

| 内置工具 | 实际调用 | 走 PATH？ |
|---|---|---|
| `grep` | `ensureTool("rg")` → 绝对路径 `~/.pi/agent/bin/rg.exe` | 否 |
| `find` | `ensureTool("fd")` → 绝对路径 `~/.pi/agent/bin/fd.exe` | 否 |
| `ls` / `read` / `write` / `edit` | 纯 Node `fs`，无外部进程 | 否 |
| `powershell` | `where pwsh.exe` → `C:\Program Files\PowerShell\7\pwsh.exe` | 解析一次 |

Niubash 只给**自己 spawn 的子进程**前置 `winuxcmd\{usr/local/bin, usr/bin, bin,}`；Pi 进程的 `PATH` 与 `getShellEnv()` 不变。

### 5.3 命令层——"换实现"，不冲突

| 命令 | Pi 外部（pwsh/系统） | niubash 内部 |
|---|---|---|
| `git` | `C:\Program Files\Git\cmd\git.exe` | niugit 2.56.0 |
| `rg` | `.pi\agent\bin\rg.exe` 15.2.0 | winuxcmd ripgrep 15.2.0 |
| `ls` `find` `grep` `sed` `awk` `tar` | 系统/自备 | WinuxCmd 1.2.1 applet |

实测：niugit 与系统 git 共用同一份全局 gitconfig；niugit 提交 `b6292df` 可被系统 git 读到；两者 rg 同版本同 rev。真实影响仅为"模型以为在跑系统工具"。对策：description、guideline 3、skill 的路径契约与全路径逃生舱。

### 5.4 两个"看起来像冲突"但不是的点

- **Pi 内置 `bash` 工具**（当前未启用）：Windows 上解析到 `WindowsApps\bash.exe`（WSL 启动器）。我们不注册 `bash` 名字，也不改变它的语义。
- **`/tmp`**：niubash 的 `/tmp` 就是真实 Windows 临时目录，也正是 Pi 存 `pi-bash-*.log` 全量输出的位置 —— shell 里可以直接 `cat`，是协同。

---

## 6. 交付物与安装

### 6.1 仓库结构（公开标准）

```
pi-niubash-windows/
├─ .github/workflows/ci.yml     # ubuntu + windows，node 24，npm test
├─ .editorconfig .gitattributes .gitignore
├─ LICENSE                      # MIT
├─ README.md                    # 使用者文档
├─ CHANGELOG.md                 # Keep a Changelog
├─ CONTRIBUTING.md
├─ package.json                 # pi.extensions / pi.skills / files / peerDependencies
├─ tsconfig.json                # noEmit + erasableSyntaxOnly（配合 Node 类型剥离）
├─ src/
│  ├─ index.ts                  # 扩展入口
│  ├─ tool.ts                   # shell 管道包装
│  ├─ niu.ts                    # 纯路径解析
│  └─ prompt.ts                 # 名称/描述/guidelines/文案
├─ skill/
│  ├─ SKILL.md                  # Pi 语境重写版
│  └─ references/               # 4 篇上游文档 + ATTRIBUTION.md
├─ docs/DESIGN.md               # 本文
└─ test/
   ├─ unit.test.mjs             # node:test，无需 Niubash/Pi
   └─ smoke.mjs                 # 需真实 niu + SDK，可跳过
```

`package.json` 关键字段：

```json
{
  "type": "module",
  "pi": { "extensions": ["./src/index.ts"], "skills": ["./skill"] },
  "files": ["src", "skill", "docs", "README.md", "CHANGELOG.md", "LICENSE"],
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*" }
}
```

> 选包内 `skills` 而非复制到 `~/.pi/agent/skills/`：单一源码位置，`pi install` 一次即同时交付工具与 skill。原始 `<workdir>\niubash\SKILL.md` 保留不动，便于与上游 diff。

### 6.2 settings 变更（共两处，先备份）

```jsonc
{
  "packages": [ ..., { "source": "<repo>", "extensions": [], "skills": [], "prompts": [], "themes": [] } ],
  "defaultTools": [ "read", "powershell", "niubash", "edit", "write", "codemode", "grep", "find", "ls" ]
}
```

- `packages` 由 `pi install ./pi-niubash-windows` 写入；条目形状与现有本地包一致。
- `defaultTools` 手工追加 `niubash`（现有列表是 replace 语义的全量清单，因此写纯名字）。

### 6.3 生效

`pi install` → 备份并改 `settings.json` → **新开会话**（`/reload` 若可用则先用）。pi-web 是否热重载不作依赖。

---

## 7. Skill 重写（已完成）

原则：**工具描述负责"怎么调用、什么时候用、输出/超时/截断语义"；`SKILL.md` 只负责"深水区契约"**。

### 7.1 删除（与工具描述重合）

- 输出截断 / 退出码 / 超时 / 无默认超时
- `niu` vs `cmd` vs `powershell` 选择表
- "当前会话就是 Niubash，直接跑命令"式前置说明
- 能力快照与内置命令长表（压缩为一句 + 指向 `references/quickref.md`）

### 7.2 保留（工具描述放不下）

- 身份与边界：无 POSIX 层、无 `cygwin1.dll`/`msys-2.0.dll`、无 fork/POSIX 信号、无 PTY
- 路径契约细表与 MSYS 对照（`/c/…`、`/mnt/c/…`、`/usr/bin`、`/tmp`、`D:`、`~`），数据形 token 与裸 `/` 不翻译
- 启动流：`~/.niubash/generated/plugins.niu` 先于 `~/.niubashrc`；`-c`/脚本不加载 rc 与插件；`NIU_ENV` / `BASH_ENV`
- `NIU_SHELL` / `SHELL` 语义
- `wpm` 安装缺失命令、`niu doctor`、`wpm links list`
- 调试器：`niu --debug`（`(niu-dbg)`）、`niu --dap`、`editors/vscode/`
- 逐字 handoff：`--encoded-command` / `--ec`（`v1:` 前缀）、`niu -C`、`--cwd-state`
- 引擎已知行为（负缓存失效、`unset` 真删除、CJK 重绘、私有区字符）

### 7.3 新增（Pi 语境）

- 一次工具调用 = 一次 `niu -c`；不要嵌套 `niu`/`bash`
- `-c` 不加载 rc/插件 → 需要时显式 `source` 或 `NIU_ENV`
- 读文件/搜索优先用内置 `read`/`grep`/`find`/`ls`
- 大输出的 `pi-bash-*.log` 在 `/tmp`，可直接 `cat`
- codemode 里 `tools.niubash(...)` 拿结构化结果
- PowerShell 原生能力用 `powershell` 工具，不在 niubash 里绕 `powershell -Command`

---

## 8. 实施阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | 仓库骨架：LICENSE/.gitignore/.gitattributes/.editorconfig/package.json/tsconfig/CI | ✅ |
| P2 | 文档：README / CHANGELOG / CONTRIBUTING / 本文 | ✅ |
| P3 | `skill/SKILL.md` 重写 + `references/` 与 ATTRIBUTION 落地 | ✅ |
| P4 | `src/*` 实现 + `test/*`（单测 + smoke） | ✅ |
| P5 | `pi install ./pi-niubash-windows` + `settings.json` 两处变更 + 新会话验收 | ⏳ |

---

## 9. 验收清单

**A. 工具行为**

1. `echo 你好; pwd; command -v ls` → 中文正确、路径 `/d/...`、ls 指向 winuxcmd
2. `for i in $(seq 1 3000); do echo "line $i"; done` → 只回 2001–3000 行 + `Full output:` 路径，且该文件可 `cat`
3. `exit 3` → `isError`，`Command exited with code 3`
4. `sleep 5` + `timeout: 1` → 超时错误、进程树清空
5. heredoc + 管道：`cat <<EOF | tr a-z A-Z` → `HELLO`
6. `git --version` → `2.56.0.windows.4.niugit`

**B. 共存**

7. 同一轮同时调用 `powershell`（`$PSVersionTable.PSVersion` → 7.6.10）与 `niubash`（`echo $BASH_VERSION`）→ 两者成功
8. `codemode` 内 `tools.niubash({command:"echo ok"})` → `exit_code: 0`
9. `powershell` 无回归（`Get-ChildItem`、`$env:PATH`）
10. `read`/`grep`/`find`/`ls`/`edit`/`write` 无回归

**C. Skill**

11. 技能列表可见 `niubash`；`/skill:niubash` 可加载；正文含"一次调用 = 一次 `niu -c`"
12. `references/paths.md` 相对路径可解析

**D. 回滚**

13. 删 `defaultTools` 中 `niubash` → 新会话不再暴露该工具；`pi remove` → 工具与 skill 同时消失

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| niugit/winuxcmd 抢占 `git`/`rg` | 模型误判工具版本 | description + guideline 3 + skill；全路径逃生舱；实测同 config、同 rg 版本 |
| `createBashToolDefinition` 忽略 `shellPath` | 静默退回 Git Bash | 强制走 `operations: createLocalBashOperations({shellPath})`；smoke 断言 `command -v ls` 指向 winuxcmd |
| 临时文件前缀固定 `pi-bash-` | 仅外观 | README 说明，不 fork 内部实现 |
| `-c` 极端引号破例（未观测到） | 命令被错误解析 | 逃生舱：`--ec <base64>`（已实测可用） |
| niu 未安装/被卸载 | 工具不可用 | 降级 stub + 安装指引；`PI_NIUBASH_PATH` 可覆盖 |
| pi-web 不支持热重载 | 改动后不生效 | 以新开会话为准 |
| 无 PTY | `ssh -t`/`vim`/`tmux` 失效 | description 明示，交给 pwsh/WSL |
| 与 `powershell` 误用 | 模型选错 shell | guidelines 1/2 明确分工 |

---

## 11. 回滚

1. `settings.json` 删除 `defaultTools` 中的 `niubash`；
2. `pi remove ./pi-niubash-windows`（或删 `packages` 条目）；
3. 新开会话。源码目录可保留，无其他足迹（不改 `~/.pi/agent/extensions`、不改 `shellPath`、不写 `~/.niubashrc`）。

---

## 12. 后续（本次不做）

- 接管 `!` / `!!`（`user_bash` → niu）
- 发布 `npm:pi-niubash-windows` 供其他机器安装
- 用 `exposure: "codemode"` 让 `codemode` 默认经脚本调用（当前保持 `direct`）
- 可选 `PI_NIUBASH_ENCODED=1`：命令统一走 `niu --ec`（base64）以避免任何引号争议