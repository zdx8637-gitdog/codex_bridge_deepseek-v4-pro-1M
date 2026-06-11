# Changelog

## Unreleased

### Diagnostics

- Added completion diagnostics for `finishReason`, terminal output kind, message-only endings, and message length in traces, bridge logs, and `/health`.
- Added `launch-desktop-bridge.ps1` for Codex Desktop bridge mode.
- Switched Desktop bridge mode to a reversible global `config.toml` overlay after source and log checks showed `codex app -c ...` does not pass provider overrides into Desktop.
- Added `-RestoreConfig` for hash-checked restoration of the original Codex Desktop config.
- Desktop bridge mode now uses `experimental_bearer_token` for the local bridge proxy key, avoiding dependence on Desktop inheriting shell environment variables.
- Limited the Desktop config overlay to model/provider keys and the bridge provider table; existing `[projects.*]` blocks are left untouched.
- Added `launch-desktop-bridge.bat` plus a small Windows Forms UI for entering Base URL, API key, and port without saving the API key. Desktop mode no longer asks for WorkDir by default because Codex Desktop chooses projects inside the app.
- Added `restore-desktop-bridge.bat` with checked restore first and forced backup replacement as a second layer.
- Added `-ForceRestoreConfig` to recover from failed Desktop overlay checks by preserving the current config and copying back the stored bridge backup.

### Reasoning Policy

- Force DeepSeek thinking requests to `reasoning_effort: max` regardless of the Codex reasoning level.
- Return DeepSeek `reasoning_content` to Codex as Responses `reasoning` output items in streaming and non-streaming responses.
- Replay returned reasoning items when expanding `previous_response_id` so assistant tool calls carry `reasoning_content`.
- Disable DeepSeek thinking defensively when assistant tool calls are missing replayable reasoning content.
- Added standalone reasoning audit logs at `logs/reasoning-audit.jsonl` and `logs/reasoning-summary.json`.
- Added a human-readable reasoning audit log at `logs/reasoning-audit.log`.
- Exposed reasoning audit counters and last downgrade details through `/health`.
- Added `show-reasoning-audit.ps1` for reading thinking status, downgrade counts, and downgrade samples from a work directory.
- Return a visible bridge warning when a request must disable DeepSeek thinking, including a recommendation to start a new Codex session.
- Added mock coverage during development for max reasoning, reasoning replay, streaming reasoning output, and missing-reasoning fallback.
- Split raw DeepSeek reasoning from Codex-facing reasoning summaries so `summary` is UI-only and `content` remains raw replay material.
- Removed new Codex-facing `reasoning_content` fields from tool-call items while keeping legacy history replay compatibility.
- Added bridge-side `deepseek-v4-flash` summary generation with configurable thinking, bounded input, short timeout, and non-fatal fallback.
- Added regression coverage proving generated UI summaries are not replayed into DeepSeek `reasoning_content` and raw reasoning is replayed exactly once.
- Delayed streaming tool-call UI events until after reasoning summary events so Codex can render the summary before tool execution.
- Improved v4flash UI summaries to use Simplified Chinese, task-focused `**title**` plus logic bullets, with summary-model thinking enabled by default and configurable effort/token limits.
- Skip v4flash display-summary generation for final answer turns that do not emit tool calls.
- Defaulted `CODEX_DEEPSEEK_TOOL_SUMMARY_SURFACE` to `commentary`, so tool-prep summaries are emitted as UI-only assistant commentary before tool calls and Codex can render native tool-round separators. The older `reasoning.summary` display path remains available with `CODEX_DEEPSEEK_TOOL_SUMMARY_SURFACE=reasoning`.

## v0.1.2 - 2026-06-03

### Naming Scope

- Removed unrelated project branding from the launcher release.
- Clarified that this project is a local Codex-to-DeepSeek bridge, not a third-party manager implementation.
- Renamed the default sandbox and launcher registry paths to Codex DeepSeek bridge names.

## v0.1.1 - 2026-06-03

### Shared Bridge Isolation

- Added per-sandbox local proxy client generation in `.codex-deepseek-sandbox/client.json`
- Added shared launcher client registry at `%LOCALAPPDATA%\codex-deepseek-bridge-launcher\clients.json`
- Bridge can now serve multiple Codex clients on one compatible local port
- Partitioned response history and reasoning/tool-call cache by client ID
- Added registry reload support through `--proxy-keys-file` / `CODEX_BRIDGE_PROXY_KEYS_FILE`
- `/health` now reports `registry_enabled`, `auth_clients`, and `active_clients`
- Launcher reuses compatible shared bridges and refuses incompatible upstream Base URLs
- Added mock validation for multi-client isolation

## v0.1.0 - 2026-06-02

### Initial Test Release

- GUI launcher with folder picker, DeepSeek URL and API key fields, port selector
- One-click launch: sets up isolated sandbox, starts bridge, opens Codex terminal
- Fully isolated environment - `CODEX_HOME` pointed to `.codex-deepseek-sandbox/codex-home` within working directory
- Bridge lifecycle: stays running when Codex terminal closes; stops when launcher GUI closes
- Supports CLI arguments on bridge.mjs: `--port`, `--log-dir`, `--proxy-key`
- `/health` endpoint reports uptime
- Graceful shutdown via SIGTERM/SIGINT
- Preference persistence for last used directory, URL, and port
- Dependency detection for Node.js and Codex CLI
- Secret hygiene: API key never written to disk; logs redact authorization headers
- Bridge listens on `127.0.0.1` only
