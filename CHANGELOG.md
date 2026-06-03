# Changelog

## v0.1.1 - 2026-06-03

### Shared Bridge Isolation

- Added per-sandbox local proxy client generation in `.paseo-sandbox/client.json`
- Added shared launcher client registry at `%LOCALAPPDATA%\paseo-launcher\clients.json`
- Bridge can now serve multiple Codex clients on one compatible local port
- Partitioned response history and reasoning/tool-call cache by client ID
- Added registry reload support through `--proxy-keys-file` / `PASEO_PROXY_KEYS_FILE`
- `/health` now reports `registry_enabled`, `auth_clients`, and `active_clients`
- Launcher reuses compatible shared bridges and refuses incompatible upstream Base URLs
- Added `test-multi-client-isolation.ps1` mock validation

## v0.1.0 - 2026-06-02

### Initial Test Release

- GUI launcher with folder picker, DeepSeek URL and API key fields, port selector
- One-click launch: sets up isolated sandbox, starts bridge, opens Codex terminal
- Fully isolated environment - `CODEX_HOME` pointed to `.paseo-sandbox/codex-home` within working directory
- Bridge lifecycle: stays running when Codex terminal closes; stops when launcher GUI closes
- Supports CLI arguments on bridge.mjs: `--port`, `--log-dir`, `--proxy-key`
- `/health` endpoint reports uptime
- Graceful shutdown via SIGTERM/SIGINT
- Preference persistence (last used directory, URL, port)
- Dependency detection (Node.js, Codex CLI) with warnings
- Secret hygiene: API key never written to disk; logs redact Authorization headers
- Bridge listens on `127.0.0.1` only
