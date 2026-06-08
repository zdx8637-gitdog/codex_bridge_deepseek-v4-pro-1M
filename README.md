# Codex DeepSeek Bridge

Codex DeepSeek Bridge is a Windows launcher and local protocol bridge that lets OpenAI Codex run through a DeepSeek-compatible Chat Completions endpoint.

It keeps Codex pointed at a local OpenAI-compatible `/v1/responses` endpoint, then translates Codex Responses API traffic into upstream `/v1/chat/completions` requests. The upstream response is translated back into the Responses shape Codex expects, including reasoning items, messages, tool calls, and compacted history.

## What We Built

- A one-click Windows launcher for starting Codex with an isolated `CODEX_HOME`.
- A local bridge server bound to `127.0.0.1`.
- Responses API to Chat Completions translation for DeepSeek-compatible providers.
- Streaming and non-streaming response conversion back into Codex-compatible Responses events.
- Tool-call translation, including function calls, custom tools, and tool-search proxying.
- Reasoning compatibility for DeepSeek thinking mode, including `reasoning_content`, inline `<think>...</think>`, and reasoning replay across `previous_response_id`.
- Bounded response, tool-call, reasoning, and compaction state stores scoped by local client ID.
- Multi-Codex client isolation so several Codex terminals can share one bridge without mixing response history.
- Bridge-side compaction support for long sessions and `/responses/compact`.
- Structured logs, trace logs, reasoning audit logs, compact audit logs, and `/health` diagnostics.

## Why It Is Useful

Codex expects the OpenAI Responses wire protocol. Many DeepSeek-compatible endpoints expose Chat Completions instead. This project keeps Codex unchanged while making the provider swap happen locally.

The important design choice is that the bridge owns protocol compatibility:

- Codex continues to use `wire_api = "responses"`.
- Codex sends requests to local `/v1/responses`.
- The bridge converts requests to upstream `/v1/chat/completions`.
- The bridge converts upstream output back to Codex-readable Responses objects and SSE events.

This keeps provider adaptation in one place and avoids patching Codex itself.

## Advantages

- **No Codex patching**: Codex is launched normally and talks to a local Responses-compatible endpoint.
- **DeepSeek thinking support**: reasoning output is preserved and replayed so later tool-call history remains compatible with DeepSeek thinking mode.
- **Tool-call compatibility**: upstream tool calls are mapped back to Codex `function_call` and custom tool-call items.
- **Long-session support**: bounded caches plus bridge compaction reduce the risk of broken `previous_response_id` chains.
- **Multi-client isolation**: each launcher session gets a local proxy client identity, so shared bridge state is partitioned.
- **Operational visibility**: `/health`, bridge logs, reasoning audit logs, compact audit logs, and trace JSONL help explain why a turn ended as a tool call, message, error, or compacted response.
- **Local security boundary**: the bridge listens only on localhost, and the DeepSeek API key is kept in the bridge process environment instead of Codex config.
- **Provider compatibility repairs**: malformed upstream tool arguments, missing tool-call reasoning, upstream errors, invalid JSON, and incomplete streams are surfaced or repaired where possible.

## Requirements

- Windows 10 or later
- Node.js 18 or later
- Codex CLI
- A DeepSeek API key or compatible provider key

## Quick Start

Double-click:

```text
launcher.bat
```

Or start from PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher.ps1
```

In the launcher:

1. Select the workspace where Codex should operate.
2. Enter the DeepSeek-compatible Base URL.
3. Enter the API key.
4. Keep the default local bridge port `43119`, or choose another port.
5. Click `Launch Codex`.

The launcher creates an isolated sandbox under the selected workspace:

```text
{workspace}\.codex-deepseek-sandbox\
```

Codex is then started in a new PowerShell window with:

```text
CODEX_HOME={workspace}\.codex-deepseek-sandbox\codex-home
Bridge=http://127.0.0.1:43119/v1
```

## Runtime Behavior

| Action | Behavior |
| --- | --- |
| Launch Codex | Starts or reuses a compatible local bridge, then opens a Codex terminal |
| Close Codex terminal | The bridge keeps running for reuse |
| Launch another Codex terminal | Reuses the compatible shared bridge |
| Close launcher GUI | Stops the bridge only if this launcher started it |

## Logs And Diagnostics

The bridge writes logs under:

```text
{workspace}\.codex-deepseek-sandbox\logs\
```

Useful files include:

```text
bridge.log
reasoning-audit.log
reasoning-audit.jsonl
compact-audit.log
compact-audit.jsonl
traces\bridge-trace.jsonl
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:43119/health
```

Useful health fields:

- `clients`: registered local bridge clients
- `completion.last`: latest response terminal kind, finish reason, output types, and message/tool-call summary
- `reasoning_audit`: thinking-mode policy and repair counters
- `compact`: compaction usage and trigger information

## Security Notes

- The DeepSeek API key is stored only in the bridge process environment.
- The key is not written to Codex `config.toml`.
- Local proxy keys authenticate only to the localhost bridge.
- The bridge binds to `127.0.0.1`.
- Logs redact authorization headers and common API-key patterns.
- Sandbox files, logs, sqlite databases, clients, and environment files are ignored by git.

## Files

```text
bridge\bridge.mjs        Local Responses-to-Chat bridge
launcher.ps1             Windows GUI launcher
launcher.bat             Double-click entrypoint
launch-codex.ps1         Starts Codex with isolated environment
setup-sandbox.ps1        Creates isolated Codex config and client identity
start-bridge.ps1         Starts the bridge directly
stop-bridge.ps1          Stops a bridge started by the launcher
show-reasoning-audit.ps1 Reads reasoning audit summaries
CHANGELOG.md             Project change history
```

## Limitations

- This is a local compatibility bridge, not an official OpenAI or DeepSeek product.
- Provider behavior can still vary, especially around tool-call formatting and reasoning metadata.
- Extremely long upstream stalls require a finite `UPSTREAM_TIMEOUT_MS` setting if you do not want Codex to wait indefinitely.
