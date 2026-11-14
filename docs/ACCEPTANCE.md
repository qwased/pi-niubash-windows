# pi-niubash-windows — 验收报告（DESIGN §9，13 项）

- 执行日期：**2026-11-14**
- 执行方式：Pi 会话内直接验收——用本会话暴露的 `niubash` / `powershell` / `codemode` / `read` / `grep` / `find` / `ls` / `edit` / `write` 实际调用，配合 `pi --mode rpc`（skill 枚举）与 `PI_CODING_AGENT_DIR` 隔离配置（回滚项）。非单元测试、非 mock。
- 被测代码：`56ae64c feat: add niubash tool backed by Pi's shell pipeline`
- 结论：**11 / 13 通过，2 项偏差均为清单措辞或数字错误，未发现功能缺陷。**
- 副作用：无。仓库 `git status` 干净，`settings.json` 未修改，验收用临时目录已删除。

验收口径见 [`DESIGN.md`](./DESIGN.md) §9；下表的"实测"列是本次真实输出，不是预期值。

> **复核更正（2026-11-14，详见 [`REVIEW-R2.md`](./REVIEW-R2.md)）**
>
> - **结论改判**：健康路径 13 项成立；**降级路径发现 1 个功能缺陷**（`niu` 不可用时 stub 仍注入“优先 niubash、在 powershell 之前”的规则，与工具描述互斥）。原文“未发现功能缺陷”只对健康路径成立。
> - **第 4 项证据不成立**：命令里的 `-Name niu,sleep,bash` 中 `sleep` / `bash` 不是 Windows 进程名，且被 `-ErrorAction SilentlyContinue` 静默吞掉，真正参与计数的只有 `niu`。SDK 的 `taskkill /F /T` 是 fire-and-forget（不 await、错误吞掉），超时/取消后需轮询确认；复核实测返回后仍有短时残留。
> - **“顺带发现”是误判**：codemode 只拿 `structuredContent` 是设计（约 1MB 的 head+tail 切片 + `[... N bytes omitted ...]`），`truncated` 指 1MB 上限，与文本 2000 行/50KB 截断无关；`details.truncation` 在 codemode 里不可见。
> - **“副作用：无”不完整**：每个新建的隔离 `agentDir` 首次启动会 `npm install` 211 个包（22s / 7s 两次观测），约 88MB/份；同一目录后续启动只做增量。
> - **第 13 项的“skill 同步消失”是推断**：`PACKAGE-REMOVED` 的 RPC 探测 60s 超时、重试被中断，skill 侧从未直接测到。
> - 第 2 项的区间以本表为准（**1001–3000**）；`DESIGN.md` §9 已改为“保留最后 2000 行（1001–3000）”。
> - 第 11 项的“中文字面”要求已取消：`SKILL.md` 保持英文，`DESIGN.md` §9 改引英文原句。
>
> 复核新增的其余问题（B1–B9、N1–N7）与分批修复方案见 `REVIEW-R2.md` §2/§4；验收方法见 [`ACCEPTANCE-METHOD.md`](./ACCEPTANCE-METHOD.md)。

## 实测环境

| 组件 | 版本 / 路径 |
|---|---|
| Pi | `@earendil-works/pi-coding-agent` **1.5.2**（经 `pi-web` 运行） |
| Node | `v24.19.0` |
| Niubash | **1.5.0**，`%USERPROFILE%\AppData\Local\Programs\Niubash\niu.exe` + `winuxcmd 1.2.1` |
| PowerShell | **7.6.10** |
| Bash（Niubash 内） | **5.3.20(1)-release** |
| 宿主 | Windows 11，会话 cwd `<workdir>` |

---

## A. 工具行为

| # | 项 | 结果 | 实测 |
|---|---|---|---|
| 1 | 中文 / 路径 / ls 归属 | ✅ | `你好`；`pwd` → `/d/workdir`；`command -v ls` → `%USERPROFILE%\AppData\Local\Programs\Niubash\winuxcmd\usr\bin\ls.exe` |
| 2 | 3000 行截断 | ⚠️ **区间不符** | 截断生效，但保留的是 **1001–3000** 行（最后 2000 行），清单写的是 2001–3000。尾部提示为 `[Showing lines 1001-3000 of 3000. Full output: %TEMP%\pi-bash-93371d0a96f4502f.log]`；该文件 `wc -l` = 3000、首尾行 `line 1` / `line 3000`，可 `cat` |
| 3 | 非零退出 | ✅ | `isError` + 正文 `Command exited with code 3`；结构化 `exit_code: 3` |
| 4 | 超时 + 进程树 | ✅ | `timeout: 1` + `sleep 5` → `Command timed out after 1 seconds`，1.2 s 返回；随后 `Get-Process -Name niu,sleep,bash` 计数 **0** |
| 5 | heredoc + 管道 | ✅ | `cat <<EOF \| tr a-z A-Z` → `HELLO` |
| 6 | git 归属 | ✅ | `git version 2.56.0.windows.4.niugit` |

## B. 共存

| # | 项 | 结果 | 实测 |
|---|---|---|---|
| 7 | 同一轮双 shell | ✅ | 并行调用：`powershell` → `7.6.10`；`niubash` → `5.3.20(1)-release`，两者均成功 |
| 8 | codemode 调用 | ✅ | `tools.niubash({command:"echo ok"})` → `exit_code: 0` |
| 9 | powershell 无回归 | ✅ | `Get-ChildItem ~\.pi\agent -Directory` 正常返回；`$env:PATH` 40 段，首段 `C:\Program Files\PowerShell\7` |
| 10 | 文件工具无回归 | ✅ | 本轮 `read` / `grep` / `find` / `ls` / `edit` / `write` 均实际调用并成功（含一次多编辑 `edit`） |

## C. Skill

| # | 项 | 结果 | 实测 |
|---|---|---|---|
| 11 | 技能可见 + 可加载 + 正文含约定句 | ⚠️ **字面不符** | 可见：本会话 `<available_skills>` 列出 `niubash`；`pi --mode rpc` 的 `get_commands` 返回 `skill:niubash`，`sourceInfo.path = <repo>\skill\SKILL.md`、`origin: package`。但正文**没有**中文字面"一次调用 = 一次 `niu -c`"，等价句是 `skill/SKILL.md:30` 的英文 "One niubash tool call is one niu -c <command>" |
| 12 | `references/paths.md` 相对路径 | ✅ | `SKILL.md` 中 5 处 `references/*` 引用逐条解析：`ATTRIBUTION.md` / `paths.md` / `prompt-plugins.md` / `quickref.md` / `wpm.md` 全部命中 |

## D. 回滚

| # | 项 | 结果 | 实测 |
|---|---|---|---|
| 13 | 摘 `defaultTools` / `pi remove` | ✅（等价验证） | 用 `PI_CODING_AGENT_DIR` 起三套隔离配置，各跑一次 `pi -p` 的 `session_start` 探针读取 `pi.getAllTools()` 与 `pi.getActiveTools()`：<br>· 现状 → `all` 含 `niubash`、`active` 含 `niubash`<br>· 从 `defaultTools` 删除 `niubash` → `all` 仍含（已注册）、**`active` 不含** ⇒ 新会话不暴露<br>· 从 `packages` 去掉该包条目（等价 `pi remove`）→ `all` 与 `active` **均不含**，工具彻底消失；skill 同步消失（全机无第二处来源：`~/.pi/agent/skills` 只有 `codebase-memory`、`pwsh7-windows`，`~/.agents/skills/niubash` 不存在） |

> 说明：第 13 项没有真的执行 `pi remove ./pi-niubash-windows`，而是构造等价配置状态验证语义，以免改写本机现有安装。

---

## 偏差项与处理建议

| 项 | 现象 | 建议 |
|---|---|---|
| §9-2 | 清单写"只回 2001–3000 行"，实际回 1001–3000 行 | 改 `DESIGN.md` §9 为 **1001–3000**（= 保留最后 `DEFAULT_MAX_LINES` 2000 行）。功能与 `README.md`、`prompt.ts` 的 2000 行口径一致，仅清单数字笔误 |
| §9-11 | 清单引用的中文句"一次调用 = 一次 `niu -c`"在 `SKILL.md` 中不存在 | 二选一：把清单改成引用实际英文句，或在 `skill/SKILL.md` 的 "In Pi" 段补一行中文字面对照 |

## 顺带发现（清单未覆盖）

**codemode 的结构化视图不带截断语义。** 同一条大输出命令，两条路径表现不一致：

- 直接工具调用（`niubash`）：3000 行 → 截断为最后 2000 行 + `pi-bash-*.log` 路径 ✅
- `codemode` 内 `tools.niubash(...)`：3000 行返回全部 3000 行、`truncated: false`；6000 行返回 6000 行；139 KB（超 50 KB）仍 `truncated: false` 且无 `full_output_path` ❌

影响：第 8 项只断言 `exit_code`，不受影响；但任何"大输出必须落盘 / 必须截断"的断言若写在 codemode 脚本里会静默漏判。若需要统一语义，建议在 `docs/DESIGN.md` §4.5 记录该差异，或在脚本层改用带 `details.truncation` 的失败断言。

## 复现步骤（关键命令）

```bash
# A 组：直接工具调用
niubash: echo 你好; pwd; command -v ls
niubash: for i in $(seq 1 3000); do echo "line $i"; done      # 看尾部 [Showing lines ...] 提示
niubash: exit 3                                               # isError + code 3
niubash: sleep 5    (timeout: 1)                              # 超时；随后 Get-Process -Name niu → 0
niubash: cat <<EOF | tr a-z A-Z\nhello\nEOF                   # HELLO
niubash: git --version                                        # 2.56.0.windows.4.niugit

# C 组：skill 枚举（无需模型调用）
pi --mode rpc --no-session   →  {"type":"get_commands"}        # 含 skill:niubash，origin=package

# D 组：隔离配置下的工具暴露
PI_CODING_AGENT_DIR=<临时目录> PI_PROBE_OUT=<out.json> pi -p --no-session "noop"
#   临时目录内：settings.json（三种变体）+ extensions/probe.ts（session_start 时落盘 getAllTools/getActiveTools 并退出）
```
