# Codex DeepSeek Bridge Launcher v0.1.2

A one-click Windows launcher that runs Codex through a local DeepSeek bridge in an isolated environment.

## What It Does

1. You pick a working directory.
2. You enter your DeepSeek Base URL and API key.
3. You click "Launch Codex".
4. A new PowerShell terminal opens with Codex running through DeepSeek.

The bridge runs locally on `127.0.0.1`, converting Codex Responses API calls to DeepSeek Chat Completions. Your DeepSeek API key never touches the Codex config files.

Multiple Codex terminals can share the same local bridge when they use the same DeepSeek Base URL and bridge port. Bridge response history and tool-call state are partitioned by local client ID to avoid cross-client pollution.

## Requirements

- Windows 10 or later
- Node.js 18+
- Codex CLI

## Installation

1. Download or clone this repository.
2. Open the repository folder.
3. Double-click `launcher.bat`.

If PowerShell policy blocks scripts, run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

You can also start it from a terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher.ps1
```

## Usage

1. Select the working directory where Codex should operate.
2. Keep the default DeepSeek Base URL, or enter a custom compatible endpoint.
3. Enter your DeepSeek API key.
4. Keep the default bridge port `43119`, or choose another local port.
5. Click "Launch Codex".

A new PowerShell terminal window opens. Codex is now running through the local bridge:

```text
Codex DeepSeek Bridge
  CODEX_HOME: {working-dir}\.codex-deepseek-sandbox\codex-home
  Workspace:  {working-dir}
  Bridge:     http://127.0.0.1:43119/v1
```

## Lifecycle

| Action | Bridge behavior |
|--------|-----------------|
| Click "Launch Codex" | Starts or reuses a compatible shared bridge, then opens a Codex terminal |
| Close Codex terminal | Bridge keeps running so another terminal can reuse it |
| Click "Launch Codex" again | Opens a new terminal and reuses the running bridge |
| Close launcher GUI | Stops the bridge only if this launcher started it |

## Isolation

- Codex uses a separate `CODEX_HOME` at `{working-dir}\.codex-deepseek-sandbox\codex-home`.
- Your default `~\.codex` is not read or modified.
- The DeepSeek API key is stored only in the bridge process environment.
- Each sandbox has a local proxy client in `{working-dir}\.codex-deepseek-sandbox\client.json`.
- Shared clients are registered in `%LOCALAPPDATA%\codex-deepseek-bridge-launcher\clients.json`.
- Bridge response history and reasoning/tool-call cache are partitioned by client ID.
- Proxy environment variables are cleared for the Codex session.

## Multi-Client Debug

Run the mock isolation test without calling DeepSeek:

```powershell
cd <launcher-folder>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\test-multi-client-isolation.ps1
```

Expected result includes:

```json
{"result":"CODEX_DEEPSEEK_MULTI_CLIENT_ISOLATION_OK"}
```

For a running bridge:

```powershell
Invoke-RestMethod http://127.0.0.1:43119/health
```

Check `registry_enabled`, `auth_clients`, and `active_clients`.

## Troubleshooting

**Node.js not found**

Install Node.js 18 or later.

**Codex CLI not found**

Install the Codex CLI.

**Bridge port in use**

The launcher reuses a compatible shared Codex DeepSeek bridge. If the existing bridge uses a different DeepSeek Base URL, stop it or change the port.

**Bridge health check failed**

Check logs at `{working-dir}\.codex-deepseek-sandbox\logs\bridge-stderr.log`.

## Security

- DeepSeek API key is stored only in the bridge process environment, never in `config.toml`, logs, or repo files.
- Local proxy keys are stored on disk, but they only authenticate to the localhost bridge and are not DeepSeek keys.
- Bridge listens on `127.0.0.1` only.
- Bridge logs redact authorization headers and API keys.
- Isolated `CODEX_HOME` avoids pollution of your default Codex environment.

## Files

```text
codex-deepseek-bridge-launcher/
- launcher.ps1
- launcher.bat
- setup-sandbox.ps1
- start-bridge.ps1
- stop-bridge.ps1
- launch-codex.ps1
- test-multi-client-isolation.ps1
- bridge/
  - bridge.mjs
- README.md
- CHANGELOG.md
```
