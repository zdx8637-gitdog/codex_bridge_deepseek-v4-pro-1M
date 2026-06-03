# Changelog

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
- Added `test-multi-client-isolation.ps1` mock validation

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
