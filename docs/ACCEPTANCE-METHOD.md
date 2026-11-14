# 验收方法（可复用）

本文件固定“怎么验收 Pi 扩展”的方法，避免重复第一轮/第二轮踩过的坑。验收对象可以是本插件，也可以是任何注册工具或 skill 的 Pi 包。

## 1. 六条硬规则

1. **工具是否暴露，只读探针落盘的结果。** 用 `session_start` 就写文件并退出的探针扩展，读取 `getAllTools()` / `getActiveTools()`；不读模型自述，不开模型调用。
2. **禁止在工具里再启动一个 `pi` 做门禁。** 嵌套 `pi --print` 曾在模型 1.8s 返回后继续挂住外层 shell，且 `--tools` 允许列表会偶发解析为 0 工具（见 §2）。
3. **禁止用 `pi --tools <list>` 判断暴露。** Pi 1.5.2 实测量到“同一命令连续 10 次 0 工具、随后 14 次正常”的窗口化现象，原因未定；它不能作为通过/失败依据。
4. **探针必须有预算。** 单条命令 ≤5s；生成大输出用单进程（`awk`/`seq`），禁止逐行 fork（一次逐行 `awk` 探针把会话拖了 485s，用户被迫中断）。
5. **实测与推断分列。** 每条结论写明“实测/推断”、采样时间点与命令；证据不足就写“未测”。
6. **前后各做一次残留检查。** 空目录、`niu.exe`/`sleep.exe`、探针临时文件、`%TEMP%` 大文件；验收结束清理自己创建的产物。

## 2. 已知不可靠的两种做法

### 2.1 嵌套 `pi --print`

现象：外层工具调用在 11:28:43 启动 `pi --print --tools niubash,read "…"`；嵌套会话在 11:28:46 写出 `READY`（`durationMs: 1843`，`stopReason: stop`），但外层 PowerShell 管道数分钟没有返回，最终被中断。

结论：即使模型已经返回，`| Out-String` 也可能等不到 EOF。无法复现，也无法排除子进程继承 stdout 句柄。**不要用**。

### 2.2 `--tools` 允许列表

现象：`pi --print --tools niubash,read` 的嵌套会话 system prompt 为 `<tools>(none)</tools>`。同一命令在 20:09:45–52 连续 4 次正常、20:11:01/04 连续 2 次为空；本机另测到连续 10 次为空、随后 14 次正常。空结果里连内置 `read` 都不在，像是允许列表在扩展注册完成前整体解析失败。

结论：**只能记录为上游缺陷线索**，不能当门禁；需要暴露检查时走 §3。

## 3. 标准探针

`extensions/probe.ts`（放进隔离的 `PI_CODING_AGENT_DIR`，`session_start` 落盘后退出，不产生任何模型请求）：

```ts
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function probe(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    const out = process.env.PI_PROBE_OUT ?? "probe.json";
    writeFileSync(out, JSON.stringify({
      all: pi.getAllTools().map((tool) => tool.name),
      active: pi.getActiveTools(),
      skills: pi.getCommands?.("skill") ?? [],
    }, null, 1));
    process.exit(0);
  });
}
```

运行（三种配置变体：现状 / 摘 `defaultTools` / 摘 `packages`）：

```bash
PI_CODING_AGENT_DIR=<temp dir> PI_PROBE_OUT=<out.json> pi -p --no-session "noop"
```

注意：新建隔离 `agentDir` 的首次启动会 `npm install` 包依赖（约 211 个包 / 88MB / 7–22s），这是验收的已知成本，不是挂起。

## 4. 有预算的探针写法

```bash
# 好：单进程生成 1.2MB
awk 'BEGIN{for(i=0;i<20000;i++) printf "%060d\n", i}'

# 好：单行 60KB，用于测 lastLinePartial
awk 'BEGIN{for(i=0;i<60000;i++) printf "x"; print ""}'

# 坏：每行 fork 一次，600 行就跑了 8 分钟
awk 'BEGIN{for(i=0;i<600;i++){printf "%0600d\n", i}}' | while read l; do echo "$l"; done
```

超时/取消的进程树检查必须轮询（`taskkill` 是 fire-and-forget）：

```bash
# 命令里打印 PID，从超时错误文本里取回
niubash: echo "shell=$$"; sleep 37        # timeout: 2
# 然后在 PowerShell 里有界轮询
for ($i=0; $i -lt 50; $i++) { Get-Process -Id <pid> -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 200 }
```

## 5. 提取会话日志的硬规则

任何写文件的脚本必须先自检，再读输入：

```js
if (process.argv.length < 4) process.exit(2);
const input = process.argv[2];
const output = process.argv[3];
if (output.toLowerCase() === input.toLowerCase()) process.exit(2); // 绝不覆盖输入
// 输入首行必须是 {"type":"session"}
```

事故先例：脚本把 `process.argv[1]`（自身 `.cjs`）当输入、`process.argv[2]`（会话 JSONL）当输出，27 行脚本覆盖了 125 行会话。

## 6. 残留检查与清理

```bash
# 进程
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'niu|pi-tools-probe|pi-race' } | Select-Object ProcessId,Name,CommandLine"

# 探针临时文件（只删自己创建的）
ls -la "$TEMP" | grep -Ei 'pi-tools-probe|pi-race|sessextract|pi-rep|dirniu'

# 会话目录残骸
ls -la ~/.pi/agent/sessions/--*/
```

清理原则：探针目录/脚本/日志可以删；会话 JSONL 与 recovery 提取件是证据，先问再删。

## 7. 记录模板

| 列 | 内容 |
|---|---|
| 项 | 断言（一句话，可判真假） |
| 结果 | ✅ / ⚠️ / ❌ / 未测 |
| 类型 | 实测 / 推断 |
| 证据 | 命令 + 关键输出（含时间点）；源码引用给路径与行号 |
| 备注 | 已知上游缺陷、环境噪声、采样窗口 |

结论段必须区分“健康路径”和“降级路径”；一条路径通过不能代表另一条。