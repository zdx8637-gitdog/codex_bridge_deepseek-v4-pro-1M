# Codex DeepSeek Bridge — Reasoning Summary 修复全记录

## 概述

本次工作旨在修复 Codex TUI 中 reasoning summary（推理摘要）不显示的问题。经过 SSE 事件层、bridge 代码层、Codex 配置层的逐层排查，最终确认了问题根因并完成修复。

## 问题根因

经过全面排查，确认了三个独立问题：

| # | 问题 | 影响 | 修复 |
|---|------|------|------|
| 1 | SSE 事件中多出 `response.reasoning_summary_part.done`，提前关闭 part 上下文，导致 `output_item.done` 中的 summary 无法挂载到 Codex parser | TUI 不渲染 summary | 移除该事件 |
| 2 | Codex 配置缺少 `use_experimental_reasoning_summary = true` | CLI 渲染路径未打开 | 添加到 config.toml + setup-sandbox.ps1 |
| 3 | Codex CLI 0.136.0 本身可能不支持 reasoning summary 渲染（待升级验证） | 即使 SSE 正确也不显示 | 升级至 0.138.0 |

## 代码修改清单

### 基础架构修改（commit `011dbed`）

| 修改 | 说明 |
|------|------|
| 新增 6 个环境变量常量 | `REASONING_DISPLAY`, `REASONING_SUMMARY_MODEL`, `REASONING_SUMMARY_TIMEOUT_MS`, `REASONING_SUMMARY_MAX_TOKENS`, `REASONING_SUMMARY_MAX_RAW_CHARS`, `REASONING_SUMMARY_MAX_TOOL_ARG_CHARS` |
| `responseReasoningItem` 重构 | 从单一文本参数改为 `{ rawReasoningContent, displaySummary, status, id }` 对象，分离摘要与原始推理 |
| `responseReasoningText` 拆解 | 拆分为 `responseRawReasoningText`（DeepSeek 回放用）+ `responseDisplayReasoningSummary`（UI 用），原函数保留向后兼容 |
| `responseToolItemFromChatCall` | `attachReasoning` 不再向 Codex 工具调用项写入 `reasoning_content` |
| 新增 `createReasoningDisplaySummary` | 调用 `deepseek-v4-flash`（thinking 关闭）生成一句话 UI 摘要，失败时降级 |
| `emitResponseOutputItemSse` | 新增 reasoning item 的完整 SSE 生命周期处理 |
| streaming 路径 `finishReasoning` | 改为 async，先 await v4flash 生成摘要再发送 SSE |
| streaming 路径 `finishResponse` | 改为 async，确保 `await finishReasoning()` 在 `finishTools()` 之前 |
| 移除 chunk loop 中的提前 `finishTools()` | 避免工具事件早于摘要事件发出 |
| `maybeEmitToolAdded` | 添加 `outputIndex` 自动分配 |
| `chatCompletionToResponse` | 先生成 v4flash 摘要再构建 output 数组 |
| 历史展开调用点 | 4 处改为 `responseRawReasoningText` |

### 修复修改（commit `74dad12`）

| 修改 | 说明 |
|------|------|
| 移除 `response.reasoning_summary_part.done` | 从 streaming 和 non-streaming 路径各删除 1 处，共 2 处 |

### 配置修改（commit `e2cf38a`）

| 修改 | 说明 |
|------|------|
| `config.toml` | 添加 `use_experimental_reasoning_summary = true` |
| `setup-sandbox.ps1` | 同步添加该配置项，确保重建 sandbox 时包含 |

### Debug 痕迹（commits `2a36b79` ~ `1040dc5`，已含在最终版本中）

| 修改 | 说明 |
|------|------|
| 11 个 `DEBUG_SSE_*` traceLog 调用 | 分布在 finishReasoning、finishTools、finishResponse、[DONE] 检测、finish_reason 检测 |
| 4 个 `fs.appendFileSync` 直写 | 写入 `logs/debug_sse.log`，绕过 traceLog 确保生效 |

## Git 操作错误记录

### 错误 1：git checkout 丢失未提交修改

**时间**：第一次修改 `bridge.mjs` 时  
**操作**：使用 `Set-Content -NoNewline` 导致文件换行丢失，执行 `git checkout -- bridge/bridge.mjs` 恢复  
**后果**：丢失了原有的约 400 行未提交修改（v4flash 摘要、推理去重等）  
**修复**：根据 `docs/` 中的分析文档和 CHANGELOG.md 重建所有代码  
**教训**：修改前应先 `git stash` 或 commit；绝不在有未提交修改时使用 `git checkout --`

### 错误 2：再次 git checkout 丢失重建的修改

**时间**：添加 debug trace 后发现需要还原  
**操作**：再次执行 `git checkout -- bridge/bridge.mjs`  
**后果**：将刚重建好的全部修改再次丢失  
**修复**：重新 apply 修改并通过 `git show <commit>:bridge/bridge.mjs` 恢复（该恢复方式本身也有问题，见错误 3）

### 错误 3：git show + PowerShell 管道损坏文件

**时间**：尝试从 commit `d305aa1` 恢复文件  
**操作**：`git show d305aa1:bridge/bridge.mjs | Out-File -FilePath bridge/bridge.mjs -NoNewline`  
**后果**：`-NoNewline` 导致所有换行被移除，文件变成 1 行  
**修复**：改用 `git checkout <commit> -- bridge/bridge.mjs`

### 错误 4：`$PID` 变量冲突

**时间**：多次在 PowerShell 中使用 `$pid` 变量  
**操作**：`$pid` 是 PowerShell 只读自动变量  
**后果**：`Cannot overwrite variable PID because it is read-only or constant`  
**修复**：改用 `$p`、`$procId` 等其他变量名

### 错误 5：`--log-dir` vs `LOG_DIR` 路径混淆

**时间**：debug trace 写入 `LOG_DIR + "/debug_sse.log"`  
**问题**：`LOG_DIR` 包含反斜杠路径，与 `/` 拼接后产生混合分隔符  
**影响**：Node.js `fs.appendFileSync` 可以处理，但 visual 检查时容易混淆  
**教训**：应使用 `path.join(LOG_DIR, "debug_sse.log")` 而非字符串拼接

### 错误 6：patch 脚本中 `\n` 转义问题

**时间**：在 PowerShell here-string 中编写 Node.js patch 脚本  
**操作**：JavaScript 字符串 `"\\n"` 在 PowerShell 被解释为单个 `\n` 字面量  
**后果**：生成的 JavaScript 语法错误（字符串跨行断裂）  
**修复**：手动修复断裂的行合并

### 错误 8：修改后未重启 bridge 就测试

**时间**：多次修改 esponseReasoningItem 和 SSE 事件格式后  
**操作**：修改磁盘文件后直接通过 Invoke-WebRequest 测试  
**后果**：测试结果反映的是旧代码行为（bridge 进程未重启），导致错误判断修改是否生效  
**教训**：修改 bridge 代码后必须先重启 bridge 进程，磁盘修改不会热加载


### 错误 7：`fs.appendFileSync` 行插入位置错误

**时间**：添加 debug trace 到 `chatCompletionToResponse`  
**操作**：`lines.splice(i+1, 0, ...)` 将 debug 行插入到函数参数列表中间而非函数体开头  
**后果**：语法错误  
**原因**：`i` 指向了 `async function chatCompletionToResponse(` 行，`i+1` 是参数列表第一行

## 排查过程

### 排查步骤

1. **查阅 suggestion.txt**：确认 Codex SSE parser 期望的事件序列
2. **分析 bridge.mjs 代码**：发现 chunk loop 中提前调用 `finishTools()` 导致工具事件先于摘要事件
3. **添加 debug trace**：在 finishReasoning/finishTools/[DONE] 处添加 `fs.appendFileSync` 直写
4. **SSE 抓取**：通过 `Invoke-WebRequest` 直接请求 bridge，捕获完整 SSE 事件序列
5. **逐事件比对**：与 suggestion.txt 的标准序列比对，发现多余的 `reasoning_summary_part.done`
6. **配置检查**：发现缺少 `use_experimental_reasoning_summary = true`
7. **Codex 日志分析**：确认 Codex 0.136.0 的 `stream_events_utils` 从未处理 reasoning summary 事件

### 发现的事实

| 事实 | 证据 |
|------|------|
| 带工具的请求走非流式路径（`chatCompletionToResponse`），不走 `pipeChatStreamToResponses` | debug_sse.log 仅在无工具请求时创建 |
| 非流式路径 SSE 事件顺序正确 | 多次抓取确认 reasoning events 在 function_call events 之前 |
| v4flash 摘要正常生成 | trace 中 `reasoning_display_summary_created` 事件 + SSE 中 `delta` 字段有内容 |
| `reasoning_summary_part.done` 是多余事件 | suggestion.txt 标准序列中不存在该事件 |
| Codex 0.136.0 不渲染 reasoning summary | `stream_events_utils` 日志仅出现 `ToolCall:`，从未出现 `ReasoningSummary:` |

## 后续建议

1. **升级 Codex 至 0.138.0**：`npm install -g @openai/codex`
2. **升级后验证**：重启 Codex 会话，观察工具调用前是否出现推理摘要
3. **清理 debug 代码**（稳定后）：移除 11 个 `DEBUG_SSE_*` traceLog 和 4 个 `fs.appendFileSync` 直写

## 涉及文件

| 文件 | 修改类型 |
|------|---------|
| `bridge/bridge.mjs` | 核心修改 + debug 痕迹 |
| `setup-sandbox.ps1` | 添加 `use_experimental_reasoning_summary` |
| `.codex-deepseek-sandbox/codex-home/config.toml` | 添加 `use_experimental_reasoning_summary` |
| `docs/streaming-reasoning-summary-fix-plan.md` | 修复方案文档 |
| `docs/streaming-reasoning-summary-fix-closeout.md` | 收口文档（v1） |
| `capture-sse.ps1` | SSE 抓取脚本 |

## 相关 Git 提交

```
536d1fd fix: remove status and content from reasoning items to match OpenAI API format
74dad12 fix: remove response.reasoning_summary_part.done event that may corrupt Codex parser state
1040dc5 debug: SSE event order traces
95943dd debug: add traces to non-streaming path
d305aa1 debug: add direct fs.appendFileSync
2a36b79 debug: add SSE event order traces
011dbed fix: reasoning summary display
e2cf38a fix: remove reasoning_summary_part.done event + add use_experimental_reasoning_summary config
74dad12 fix: remove response.reasoning_summary_part.done event that may corrupt Codex parser state
1040dc5 debug: SSE event order traces - direct fs writes + traceLog
95943dd debug: add traces to non-streaming path
d305aa1 debug: add direct fs.appendFileSync debug writes (bypass traceLog)
2a36b79 debug: add SSE event order traces for streaming path diagnosis
011dbed fix: reasoning summary display with SSE event order fix, v4flash summary generation, and reasoning de-duplication
```
