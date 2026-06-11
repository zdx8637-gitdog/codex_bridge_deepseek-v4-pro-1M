@echo off
setlocal EnableExtensions

rem ============================================================
rem Restore Codex Desktop config after DeepSeek bridge mode
rem
rem Layer 1: hash-checked restore through launch-desktop-bridge.ps1.
rem Layer 2: if the post-restore check still fails, force-copy the backup.
rem ============================================================

cd /d "%~dp0"

set "CONFIG_FILE=%USERPROFILE%\.codex\config.toml"
set "OVERLAY_STATE=%LOCALAPPDATA%\codex-deepseek-bridge-launcher\desktop-config-overlay.json"

echo [restore] Layer 1: hash-checked restore...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-desktop-bridge.ps1" -RestoreConfig
set "LAYER1_RC=%ERRORLEVEL%"

call :check_restored
if "%RESTORE_CHECK%"=="OK" (
  echo [restore] Restore check passed after layer 1.
  pause
  exit /b 0
)

echo [restore] Layer 1 did not pass the restore check.
echo [restore] Exit code: %LAYER1_RC%
echo [restore] Layer 2: force restore from backup...

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-desktop-bridge.ps1" -ForceRestoreConfig
set "LAYER2_RC=%ERRORLEVEL%"

call :check_restored
if "%RESTORE_CHECK%"=="OK" (
  echo [restore] Restore check passed after layer 2.
  pause
  exit /b 0
)

echo [restore] Restore check still failed after layer 2.
echo [restore] Exit code: %LAYER2_RC%
echo [restore] Inspect backups under:
echo [restore]   %LOCALAPPDATA%\codex-deepseek-bridge-launcher
pause
exit /b 1

:check_restored
set "RESTORE_CHECK=OK"

if exist "%OVERLAY_STATE%" (
  echo [restore-check] Overlay state still exists: %OVERLAY_STATE%
  set "RESTORE_CHECK=FAIL"
)

if not exist "%CONFIG_FILE%" (
  echo [restore-check] Config file does not exist: %CONFIG_FILE%
  set "RESTORE_CHECK=FAIL"
  exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$text = Get-Content -LiteralPath $env:CONFIG_FILE -Raw; if ($text -match 'model_provider\s*=\s*.deepseek_bridge.' -or $text -match 'model\s*=\s*.deepseek-v4-pro.' -or $text -match '\[model_providers\.deepseek_bridge\]' -or $text -match 'experimental_bearer_token\s*=') { exit 1 }"

if errorlevel 1 (
  echo [restore-check] Bridge overlay markers still exist in config.
  set "RESTORE_CHECK=FAIL"
)

exit /b 0
