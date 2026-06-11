param(
  [string]$WorkDir = "",
  [string]$DeepSeekBaseUrl = "",
  [string]$DeepSeekApiKey = "",
  [string]$DeepSeekConfigPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "deepseek_claude.txt"),
  [int]$BridgePort = 43119,
  [string]$CodexConfigPath = "",
  [switch]$AllowExistingDesktop,
  [switch]$NoLaunch,
  [switch]$RestoreConfig,
  [switch]$ForceRestoreConfig,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$scriptDir = $PSScriptRoot
$launcherDataDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "codex-deepseek-bridge-launcher"
$clientRegistryFile = Join-Path $launcherDataDir "clients.json"
$desktopOverlayStateFile = Join-Path $launcherDataDir "desktop-config-overlay.json"

function Write-Step {
  param([string]$Message)
  Write-Host "[desktop-bridge] $Message"
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name not found in PATH."
  }
}

function Get-SecretValue {
  param([string]$Path)
  if ($DeepSeekApiKey) { return $DeepSeekApiKey }
  if ($env:DEEPSEEK_API_KEY) { return $env:DEEPSEEK_API_KEY }
  if (-not (Test-Path $Path)) {
    throw "DeepSeek API key not found. Provide -DeepSeekApiKey, set DEEPSEEK_API_KEY, or create $Path."
  }
  $text = Get-Content -LiteralPath $Path -Raw
  $patterns = @(
    '(?im)^\s*(?:DEEPSEEK_API_KEY|DEEPSEEK_KEY|OPENAI_API_KEY|ANTHROPIC_AUTH_TOKEN|API_KEY|AUTH_TOKEN)\s*[:=]\s*["'']?([^"''\s]+)',
    '(sk-[A-Za-z0-9._-]{20,})',
    '(?i)Bearer\s+([A-Za-z0-9._~+\/=-]{20,})'
  )
  foreach ($pattern in $patterns) {
    $m = [regex]::Match($text, $pattern)
    if ($m.Success) { return $m.Groups[$m.Groups.Count - 1].Value }
  }
  throw "Could not parse DeepSeek API key from $Path."
}

function Get-BaseUrl {
  param([string]$Path)
  if ($DeepSeekBaseUrl) { return $DeepSeekBaseUrl.TrimEnd("/") }
  if ($env:DEEPSEEK_BASE_URL) { return $env:DEEPSEEK_BASE_URL.TrimEnd("/") }
  if (Test-Path $Path) {
    $text = Get-Content -LiteralPath $Path -Raw
    $m = [regex]::Match($text, '(?im)^\s*(?:DEEPSEEK_BASE_URL|OPENAI_BASE_URL|ANTHROPIC_BASE_URL|BASE_URL)\s*[:=]\s*["'']?([^"''\s]+)')
    if ($m.Success -and $m.Groups[1].Value -match '^https?://') {
      return $m.Groups[1].Value.TrimEnd("/")
    }
  }
  return "https://api.deepseek.com/v1"
}

function Read-BridgeClientConfig {
  param([string]$Path)
  if (-not (Test-Path $Path)) { throw "Client config not found: $Path" }
  $client = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if (-not $client.clientId -or -not $client.proxyKey) {
    throw "Client config is invalid: $Path"
  }
  return $client
}

function Register-BridgeClient {
  param(
    [string]$RegistryPath,
    [string]$ClientId,
    [string]$ProxyKey,
    [string]$WorkDir,
    [string]$ProjectId = "",
    [string]$InstanceId = "",
    [string]$SandboxRoot = "",
    [string]$LogDir = ""
  )

  $registryDir = Split-Path $RegistryPath
  New-Item -ItemType Directory -Force $registryDir | Out-Null

  $registry = [ordered]@{ clients = @() }
  if (Test-Path $RegistryPath) {
    try {
      $loaded = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
      if ($loaded.clients) { $registry.clients = @($loaded.clients) }
    } catch {}
  }

  $updated = @()
  foreach ($entry in $registry.clients) {
    if ($entry.id -ne $ClientId) { $updated += $entry }
  }
  $updated += [pscustomobject]@{
    id = $ClientId
    key = $ProxyKey
    projectId = $ProjectId
    instanceId = $InstanceId
    projectName = Split-Path $WorkDir -Leaf
    workDir = $WorkDir
    sandboxRoot = $SandboxRoot
    logDir = $LogDir
    updatedAt = (Get-Date).ToString("o")
  }
  $registry.clients = $updated
  [System.IO.File]::WriteAllText($RegistryPath, ($registry | ConvertTo-Json -Depth 10), $utf8NoBom)
}

function Get-CodexDesktopProcesses {
  $codexRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "OpenAI\Codex"
  return @(
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object {
        ($_.ProcessName -like "Codex*") -or
        ($_.Path -and $_.Path.StartsWith($codexRoot, [System.StringComparison]::OrdinalIgnoreCase))
      } |
      Where-Object { $_.ProcessName -ne "codex-command-runner" }
  )
}

function ConvertTo-CommandLine {
  param([string[]]$ArgumentList)
  return ($ArgumentList | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join " "
}

function Get-Sha256Hex {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return "" }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Escape-TomlString {
  param([string]$Value)
  return ($Value -replace '\\', '\\' -replace '"', '\"')
}

function Split-TomlPreamble {
  param([string]$Text)
  $match = [regex]::Match($Text, '(?m)^\s*\[')
  if (-not $match.Success) {
    return [pscustomobject]@{ Preamble = $Text; Rest = "" }
  }
  return [pscustomobject]@{
    Preamble = $Text.Substring(0, $match.Index)
    Rest = $Text.Substring($match.Index)
  }
}

function Set-TopLevelTomlKey {
  param(
    [string]$Text,
    [string]$Key,
    [string]$LiteralValue
  )
  $parts = Split-TomlPreamble -Text $Text
  $line = "$Key = $LiteralValue"
  $pattern = "(?m)^\s*$([regex]::Escape($Key))\s*=.*$"
  if ([regex]::IsMatch($parts.Preamble, $pattern)) {
    $parts.Preamble = [regex]::Replace($parts.Preamble, $pattern, $line, 1)
  } else {
    if ($parts.Preamble.Length -gt 0 -and -not $parts.Preamble.EndsWith("`n")) {
      $parts.Preamble += "`r`n"
    }
    $parts.Preamble += "$line`r`n"
  }
  return $parts.Preamble + $parts.Rest
}

function Remove-TomlTableBlock {
  param(
    [string]$Text,
    [string]$Header
  )
  $pattern = "(?ms)^\s*\[$([regex]::Escape($Header))\]\s*\r?\n.*?(?=^\s*\[|\z)"
  return [regex]::Replace($Text, $pattern, "")
}

function Add-TomlTableBlock {
  param(
    [string]$Text,
    [string]$Block
  )
  $trimmed = $Text.TrimEnd()
  if ($trimmed.Length -eq 0) { return $Block.TrimStart() + "`r`n" }
  return $trimmed + "`r`n`r`n" + $Block.Trim() + "`r`n"
}

function Get-GlobalCodexConfigPath {
  if ($CodexConfigPath) { return [System.IO.Path]::GetFullPath($CodexConfigPath) }
  return Join-Path $env:USERPROFILE ".codex\config.toml"
}

function Restore-DesktopConfigOverlay {
  param(
    [switch]$WhatIf,
    [switch]$Force
  )
  if (-not (Test-Path $desktopOverlayStateFile)) {
    if ($Force) {
      $fallbackBackup = Get-ChildItem -LiteralPath $launcherDataDir -Filter "config.toml.desktop-bridge.*.bak" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if (-not $fallbackBackup) {
        Write-Step "No desktop config overlay state or fallback backup found."
        return
      }
      $configPath = Get-GlobalCodexConfigPath
      Write-Step "No overlay state found. Force restoring latest backup: $($fallbackBackup.FullName)"
      if ($WhatIf) {
        Write-Step "Dry run: force restore would replace $configPath"
        return
      }
      if (Test-Path $configPath) {
        $safetyBackup = Join-Path $launcherDataDir ("config.toml.before-force-restore." + (Get-Date -Format "yyyyMMddHHmmss") + ".bak")
        Copy-Item -LiteralPath $configPath -Destination $safetyBackup -Force
        Write-Step "Force restore safety backup: $safetyBackup"
      }
      Copy-Item -LiteralPath $fallbackBackup.FullName -Destination $configPath -Force
      Write-Step "Codex config force restored from latest backup."
      return
    }
    Write-Step "No desktop config overlay state found."
    return
  }
  $state = Get-Content -LiteralPath $desktopOverlayStateFile -Raw | ConvertFrom-Json
  $configPath = [string]$state.configPath
  $backupPath = [string]$state.backupPath
  $patchedHash = [string]$state.patchedHash
  if (-not (Test-Path $backupPath)) {
    throw "Cannot restore Codex config. Backup file is missing: $backupPath"
  }
  $currentHash = Get-Sha256Hex -Path $configPath
  if (-not $Force -and $patchedHash -and $currentHash -and ($currentHash -ne $patchedHash.ToLowerInvariant())) {
    throw "Refusing to restore because $configPath changed after bridge overlay was applied. Backup remains at $backupPath."
  }
  Write-Step "Restoring Codex config from $backupPath"
  if ($WhatIf) {
    Write-Step "Dry run: restore would replace $configPath"
    return
  }
  if ($Force -and (Test-Path $configPath)) {
    $safetyBackup = Join-Path $launcherDataDir ("config.toml.before-force-restore." + (Get-Date -Format "yyyyMMddHHmmss") + ".bak")
    Copy-Item -LiteralPath $configPath -Destination $safetyBackup -Force
    Write-Step "Force restore safety backup: $safetyBackup"
  }
  Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
  Remove-Item -LiteralPath $desktopOverlayStateFile -Force -ErrorAction SilentlyContinue
  Write-Step "Codex config restored."
}

function Apply-DesktopConfigOverlay {
  param(
    [string]$ConfigPath,
    [string]$ModelCatalogPath,
    [string]$LogsDir,
    [string]$WorkDir,
    [string]$ProxyKey,
    [int]$BridgePort,
    [switch]$WhatIf
  )

  New-Item -ItemType Directory -Force (Split-Path $ConfigPath) | Out-Null
  New-Item -ItemType Directory -Force $launcherDataDir | Out-Null
  if (-not (Test-Path $ConfigPath)) {
    if (-not $WhatIf) { [System.IO.File]::WriteAllText($ConfigPath, "", $utf8NoBom) }
  }

  $existingState = $null
  if (Test-Path $desktopOverlayStateFile) {
    $existingState = Get-Content -LiteralPath $desktopOverlayStateFile -Raw | ConvertFrom-Json
    $existingConfigPath = [string]$existingState.configPath
    $existingPatchedHash = [string]$existingState.patchedHash
    if ($existingConfigPath -and ($existingConfigPath -ne $ConfigPath)) {
      throw "A desktop config overlay is already active for $existingConfigPath. Restore it first with -RestoreConfig."
    }
    $currentHash = Get-Sha256Hex -Path $ConfigPath
    if ($existingPatchedHash -and $currentHash -and ($currentHash -ne $existingPatchedHash.ToLowerInvariant())) {
      throw "Existing desktop config overlay state does not match current config. Restore or inspect $desktopOverlayStateFile before applying a new overlay."
    }
  }

  $originalText = if (Test-Path $ConfigPath) { Get-Content -LiteralPath $ConfigPath -Raw } else { "" }
  $originalHash = if ($existingState -and $existingState.originalHash) { [string]$existingState.originalHash } else { Get-Sha256Hex -Path $ConfigPath }
  $backupPath = if ($existingState -and $existingState.backupPath) {
    [string]$existingState.backupPath
  } else {
    Join-Path $launcherDataDir ("config.toml.desktop-bridge." + (Get-Date -Format "yyyyMMddHHmmss") + ".bak")
  }

  $catalog = Escape-TomlString -Value $ModelCatalogPath
  $logs = Escape-TomlString -Value $LogsDir
  $proxy = Escape-TomlString -Value $ProxyKey

  $text = $originalText
  $text = Set-TopLevelTomlKey -Text $text -Key "model" -LiteralValue '"deepseek-v4-pro"'
  $text = Set-TopLevelTomlKey -Text $text -Key "model_provider" -LiteralValue '"deepseek_bridge"'
  $text = Set-TopLevelTomlKey -Text $text -Key "model_catalog_json" -LiteralValue "`"$catalog`""
  $text = Set-TopLevelTomlKey -Text $text -Key "log_dir" -LiteralValue "`"$logs`""
  $text = Set-TopLevelTomlKey -Text $text -Key "model_context_window" -LiteralValue "1000000"
  $text = Set-TopLevelTomlKey -Text $text -Key "model_auto_compact_token_limit" -LiteralValue "900000"
  $text = Set-TopLevelTomlKey -Text $text -Key "model_reasoning_summary" -LiteralValue '"auto"'
  $text = Set-TopLevelTomlKey -Text $text -Key "model_supports_reasoning_summaries" -LiteralValue "true"
  $text = Set-TopLevelTomlKey -Text $text -Key "hide_agent_reasoning" -LiteralValue "false"
  $text = Set-TopLevelTomlKey -Text $text -Key "use_experimental_reasoning_summary" -LiteralValue "true"
  $text = Set-TopLevelTomlKey -Text $text -Key "show_raw_agent_reasoning" -LiteralValue "false"

  $text = Remove-TomlTableBlock -Text $text -Header "model_providers.deepseek_bridge"

  $providerBlock = @"
[model_providers.deepseek_bridge]
name = "deepseek_bridge"
base_url = "http://127.0.0.1:$BridgePort/v1"
wire_api = "responses"
experimental_bearer_token = "$proxy"
requires_openai_auth = false
"@

  $text = Add-TomlTableBlock -Text $text -Block $providerBlock

  if ($WhatIf) {
    Write-Step "Dry run: global config overlay would update $ConfigPath"
    Write-Step "Dry run: backup would be written under $launcherDataDir"
    return
  }

  if (-not $existingState) {
    Copy-Item -LiteralPath $ConfigPath -Destination $backupPath -Force
  }
  [System.IO.File]::WriteAllText($ConfigPath, $text, $utf8NoBom)
  $patchedHash = Get-Sha256Hex -Path $ConfigPath
  $state = [ordered]@{
    configPath = $ConfigPath
    backupPath = $backupPath
    originalHash = $originalHash
    patchedHash = $patchedHash
    workDir = $WorkDir
    bridgePort = $BridgePort
    createdAt = (Get-Date).ToString("o")
  }
  [System.IO.File]::WriteAllText($desktopOverlayStateFile, ($state | ConvertTo-Json -Depth 5), $utf8NoBom)
  Write-Step "Global Codex config overlay applied."
  Write-Step "Backup: $backupPath"
  Write-Step "Restore: powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -RestoreConfig"
}

if ($RestoreConfig -or $ForceRestoreConfig) {
  Restore-DesktopConfigOverlay -WhatIf:$DryRun -Force:$ForceRestoreConfig
  return
}

$launchWorkspacePath = $null
if ([string]::IsNullOrWhiteSpace($WorkDir)) {
  $resolvedWorkDir = [System.IO.Path]::GetFullPath((Join-Path $launcherDataDir "desktop-runtime"))
  New-Item -ItemType Directory -Force $resolvedWorkDir | Out-Null
} else {
  $resolvedWorkDir = [System.IO.Path]::GetFullPath($WorkDir)
  if (-not (Test-Path $resolvedWorkDir)) { throw "WorkDir not found: $resolvedWorkDir" }
  $launchWorkspacePath = $resolvedWorkDir
}

Assert-Command "node"
Assert-Command "codex.cmd"

$desktopProcesses = Get-CodexDesktopProcesses
if ($desktopProcesses.Count -gt 0 -and -not $AllowExistingDesktop) {
  Write-Warning "Codex Desktop/app runtime appears to be running. Close Codex Desktop before launching bridge mode."
  $desktopProcesses | Select-Object Id, ProcessName, Path | Format-Table -AutoSize | Out-String | Write-Host
  if (-not $DryRun) {
    throw "Refusing to launch bridge Desktop mode while an existing Codex app process is running. Re-run with -AllowExistingDesktop only if you intentionally want to reuse the existing app."
  }
}

$sandboxRoot = Join-Path $resolvedWorkDir ".codex-deepseek-sandbox"
$codexHome = Join-Path $sandboxRoot "codex-home"
$logsDir = Join-Path $sandboxRoot "logs"
$clientConfigPath = Join-Path $sandboxRoot "client.json"
$modelCatalogPath = Join-Path $codexHome "model-catalog.json"
$effectiveClientRegistryFile = if ($DryRun) { Join-Path $sandboxRoot "dryrun-clients.json" } else { $clientRegistryFile }
$setupScript = Join-Path $scriptDir "setup-sandbox.ps1"
$bridgeScript = Join-Path $scriptDir "bridge\bridge.mjs"

if (-not (Test-Path $setupScript)) { throw "Missing setup script: $setupScript" }
if (-not (Test-Path $bridgeScript)) { throw "Missing bridge script: $bridgeScript" }

Write-Step "Runtime dir: $resolvedWorkDir"
if ($launchWorkspacePath) {
  Write-Step "Desktop workspace path: $launchWorkspacePath"
} else {
  Write-Step "Desktop workspace path: not specified; choose or open a project in Codex Desktop."
}
Write-Step "Bridge port: $BridgePort"
Write-Step "Setting up desktop bridge identity..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setupScript -WorkDir $resolvedWorkDir -BridgePort $BridgePort | Out-Host
if (-not (Test-Path $clientConfigPath)) { throw "Sandbox setup did not create $clientConfigPath" }

$clientConfig = Read-BridgeClientConfig -Path $clientConfigPath
$proxyKey = [string]$clientConfig.proxyKey
$clientId = [string]$clientConfig.clientId
$projectId = [string]$clientConfig.projectId
$instanceId = [string]$clientConfig.instanceId
Register-BridgeClient `
  -RegistryPath $effectiveClientRegistryFile `
  -ClientId $clientId `
  -ProxyKey $proxyKey `
  -WorkDir $resolvedWorkDir `
  -ProjectId $projectId `
  -InstanceId $instanceId `
  -SandboxRoot $sandboxRoot `
  -LogDir $logsDir

$baseUrl = Get-BaseUrl -Path $DeepSeekConfigPath
$apiKey = Get-SecretValue -Path $DeepSeekConfigPath
Write-Step "Base URL: $baseUrl"
Write-Step "Client:   $clientId"
Write-Step "Registry: $effectiveClientRegistryFile"

$bridgePid = $null
$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$BridgePort/health" -TimeoutSec 2
    if ($health.status -eq "ok" -and $health.registry_enabled -eq $true) {
      if ($health.upstream_base_url -and ($health.upstream_base_url.TrimEnd("/") -ne $baseUrl.TrimEnd("/"))) {
        throw "Bridge on port $BridgePort uses upstream $($health.upstream_base_url), not $baseUrl."
      }
      $bridgePid = [int]$listener.OwningProcess
      Write-Step "Reusing bridge PID $bridgePid"
    } else {
      throw "Port $BridgePort is occupied by a non-reusable bridge or another process."
    }
  } catch {
    throw "Cannot reuse port $BridgePort. $($_.Exception.Message)"
  }
}

if (-not $bridgePid) {
  if ($DryRun) {
    Write-Step "Dry run: bridge would be started."
  } else {
    New-Item -ItemType Directory -Force $logsDir | Out-Null
    $env:DEEPSEEK_BASE_URL = $baseUrl
    $env:DEEPSEEK_API_KEY = $apiKey
    $env:BRIDGE_PORT = [string]$BridgePort
    $env:UPSTREAM_MODE = "deepseek"
    $env:PHASE1_PROXY_KEY = $proxyKey
    $env:CODEX_BRIDGE_PROXY_KEYS_FILE = $effectiveClientRegistryFile
    $env:PHASE_LOG_DIR = $logsDir

    $bridgeArgs = "`"$bridgeScript`" --port=$BridgePort --log-dir=`"$logsDir`" --proxy-key=$proxyKey --proxy-keys-file=`"$effectiveClientRegistryFile`""
    $bridgeProc = Start-Process -FilePath "node" `
      -ArgumentList $bridgeArgs `
      -WindowStyle Hidden `
      -PassThru `
      -RedirectStandardOutput (Join-Path $logsDir "bridge-stdout.log") `
      -RedirectStandardError (Join-Path $logsDir "bridge-stderr.log")
    if (-not $bridgeProc) { throw "Failed to start Node.js bridge." }
    $bridgePid = $bridgeProc.Id
    [System.IO.File]::WriteAllText((Join-Path $sandboxRoot "bridge.pid"), [string]$bridgePid, $utf8NoBom)

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      try {
        $health = Invoke-RestMethod "http://127.0.0.1:$BridgePort/health" -TimeoutSec 2
        if ($health.status -eq "ok") { break }
      } catch {}
      Start-Sleep -Milliseconds 500
    }
    if (-not $health -or $health.status -ne "ok") { throw "Bridge health check failed on port $BridgePort." }
    Write-Step "Started bridge PID $bridgePid"
  }
}

$env:NO_PROXY = "127.0.0.1,localhost"
$env:no_proxy = "127.0.0.1,localhost"
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

if ($launchWorkspacePath) {
  $appArgs = @("app", $launchWorkspacePath)
  $launchDescription = "codex.cmd $(ConvertTo-CommandLine -ArgumentList $appArgs)"
} else {
  $appArgs = @()
  $launchDescription = "Start-Process codex://"
}

Apply-DesktopConfigOverlay `
  -ConfigPath (Get-GlobalCodexConfigPath) `
  -ModelCatalogPath $modelCatalogPath `
  -LogsDir $logsDir `
  -WorkDir $resolvedWorkDir `
  -ProxyKey $proxyKey `
  -BridgePort $BridgePort `
  -WhatIf:$DryRun

Write-Step "Desktop mode uses a reversible global config overlay. auth.json is not edited."
Write-Step "Command: $launchDescription"
if ($DryRun) {
  Write-Step "Dry run complete. No Codex Desktop process was launched."
  return
}
if ($NoLaunch) {
  Write-Step "NoLaunch set. Bridge and config overlay are ready; Codex Desktop was not launched."
  return
}

if ($launchWorkspacePath) {
  Start-Process -FilePath "codex.cmd" -ArgumentList $appArgs -WorkingDirectory $launchWorkspacePath | Out-Null
} else {
  Start-Process -FilePath "codex://" | Out-Null
}
Write-Step "Codex Desktop launch requested."
