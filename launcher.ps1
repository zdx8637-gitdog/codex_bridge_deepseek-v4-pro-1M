# Codex DeepSeek Bridge Launcher v0.1.2
# Double-click launcher.bat to start.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Continue"
$scriptDir = $PSScriptRoot
$launcherDataDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "codex-deepseek-bridge-launcher"
$prefsFile = Join-Path $launcherDataDir "prefs.json"
$clientRegistryFile = Join-Path $launcherDataDir "clients.json"

$prefs = @{}
if (Test-Path $prefsFile) {
  try { $tmp = Get-Content $prefsFile -Raw | ConvertFrom-Json; if ($tmp) { $prefs = $tmp } } catch {}
}
$defaultWorkDir = if ($prefs.WorkDir -and (Test-Path $prefs.WorkDir)) { $prefs.WorkDir } else { [Environment]::GetFolderPath("UserProfile") }
$defaultBaseUrl = if ($prefs.BaseUrl) { $prefs.BaseUrl } else { "https://api.deepseek.com/v1" }
$defaultPort   = if ($prefs.Port) { [int]$prefs.Port } else { 43119 }

$nodeOk = $false; try { $null = node --version 2>$null; $nodeOk = $true } catch {}
$codexOk = $false; try { $null = codex.cmd --version 2>$null; $codexOk = $true } catch {}

# ---- Build Form ----
$form = New-Object System.Windows.Forms.Form
$form.Text = "Codex DeepSeek Bridge Launcher v0.1.2"
$form.Size = New-Object System.Drawing.Size(540, 400)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$fontBold = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)

[int]$y = 12
[int]$padY = 28
[int]$labelW = 110
[int]$inputX = 130
[int]$inputW = 280
[int]$btnW = 80
[int]$fullInputW = $inputW + $btnW + 6
[int]$browseX = $inputX + $inputW + 6
[int]$browseY = $y - 1

# ---- Work Directory ----
$lblWorkDir = New-Object System.Windows.Forms.Label
$lblWorkDir.Text = "Working Directory:"
$lblWorkDir.Location = New-Object System.Drawing.Point(12, $y)
$lblWorkDir.Size = New-Object System.Drawing.Size($labelW, 20)
$form.Controls.Add($lblWorkDir)

$txtWorkDir = New-Object System.Windows.Forms.TextBox
$txtWorkDir.Text = $defaultWorkDir
$txtWorkDir.Location = New-Object System.Drawing.Point($inputX, $y)
$txtWorkDir.Size = New-Object System.Drawing.Size($inputW, 20)
$form.Controls.Add($txtWorkDir)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.Location = New-Object System.Drawing.Point($browseX, $browseY)
$btnBrowse.Size = New-Object System.Drawing.Size($btnW, 22)
$btnBrowse.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Select working directory for Codex"
  if ($txtWorkDir.Text -and (Test-Path $txtWorkDir.Text)) { $dialog.SelectedPath = $txtWorkDir.Text }
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $txtWorkDir.Text = $dialog.SelectedPath }
})
$form.Controls.Add($btnBrowse)

$y += $padY

# ---- Base URL ----
$lblBaseUrl = New-Object System.Windows.Forms.Label
$lblBaseUrl.Text = "DeepSeek Base URL:"
$lblBaseUrl.Location = New-Object System.Drawing.Point(12, $y)
$lblBaseUrl.Size = New-Object System.Drawing.Size($labelW, 20)
$form.Controls.Add($lblBaseUrl)

$txtBaseUrl = New-Object System.Windows.Forms.TextBox
$txtBaseUrl.Text = $defaultBaseUrl
$txtBaseUrl.Location = New-Object System.Drawing.Point($inputX, $y)
$txtBaseUrl.Size = New-Object System.Drawing.Size($fullInputW, 20)
$form.Controls.Add($txtBaseUrl)

$y += $padY

# ---- API Key ----
$lblApiKey = New-Object System.Windows.Forms.Label
$lblApiKey.Text = "DeepSeek API Key:"
$lblApiKey.Location = New-Object System.Drawing.Point(12, $y)
$lblApiKey.Size = New-Object System.Drawing.Size($labelW, 20)
$form.Controls.Add($lblApiKey)

$txtApiKey = New-Object System.Windows.Forms.MaskedTextBox
$txtApiKey.PasswordChar = '*'
$txtApiKey.Location = New-Object System.Drawing.Point($inputX, $y)
$txtApiKey.Size = New-Object System.Drawing.Size($fullInputW, 20)
$form.Controls.Add($txtApiKey)

$y += $padY

# ---- Port ----
$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Text = "Bridge Port:"
$lblPort.Location = New-Object System.Drawing.Point(12, $y)
$lblPort.Size = New-Object System.Drawing.Size($labelW, 20)
$form.Controls.Add($lblPort)

$txtPort = New-Object System.Windows.Forms.NumericUpDown
$txtPort.Minimum = 1024
$txtPort.Maximum = 65535
$txtPort.Value = $defaultPort
$txtPort.Location = New-Object System.Drawing.Point($inputX, $y)
$txtPort.Size = New-Object System.Drawing.Size(80, 20)
$form.Controls.Add($txtPort)

# ---- Log box ----
$y += $padY + 6
$statusBar = New-Object System.Windows.Forms.Label
if ($nodeOk -and $codexOk) { $statusBar.Text = "Ready."; $statusBar.ForeColor = "DarkGreen" }
elseif (-not $nodeOk)     { $statusBar.Text = "WARNING: Node.js not found."; $statusBar.ForeColor = "Red" }
else                      { $statusBar.Text = "WARNING: Codex CLI not found."; $statusBar.ForeColor = "Red" }
$statusBar.Location = New-Object System.Drawing.Point(12, $y)
$statusBar.Size = New-Object System.Drawing.Size(500, 16)
$form.Controls.Add($statusBar)

$y += 20
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = "Vertical"
$logBox.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$logBox.ForeColor = [System.Drawing.Color]::LightGray
$logBox.Font = New-Object System.Drawing.Font("Consolas", 8)
$logBox.Location = New-Object System.Drawing.Point(12, $y)
$logBox.Size = New-Object System.Drawing.Size(500, 72)
$form.Controls.Add($logBox)

# ---- Buttons ----
[int]$yBtn = $form.ClientSize.Height - 38
[int]$launchX = $inputX + $inputW + $btnW - 180
[int]$cancelX = $inputX + $inputW + $btnW - 64

function Append-Log {
  param([string]$Text)
  $logBox.AppendText("$Text`r`n")
  $logBox.ScrollToCaret()
  $form.Refresh()
}

function Read-BridgeClientConfig {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "Client config not found: $Path"
  }
  $client = Get-Content $Path -Raw | ConvertFrom-Json
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
    [string]$WorkDir
  )

  $registryDir = Split-Path $RegistryPath
  New-Item -ItemType Directory -Force $registryDir | Out-Null

  $registry = [ordered]@{ clients = @() }
  if (Test-Path $RegistryPath) {
    try {
      $loaded = Get-Content $RegistryPath -Raw | ConvertFrom-Json
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
    workDir = $WorkDir
    updatedAt = (Get-Date).ToString("o")
  }
  $registry.clients = $updated
  [System.IO.File]::WriteAllText($RegistryPath, ($registry | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
}

$btnLaunch = New-Object System.Windows.Forms.Button
$btnLaunch.Text = "Launch Codex"
$btnLaunch.Location = New-Object System.Drawing.Point($launchX, $yBtn)
$btnLaunch.Size = New-Object System.Drawing.Size(110, 28)
$btnLaunch.Font = $fontBold
$btnLaunch.Add_Click({
  $btnLaunch.Enabled = $false
  $btnCancel.Enabled = $false
  $statusBar.Text = "Starting..."
  $statusBar.ForeColor = "Black"
  $logBox.Clear()
  Append-Log "=== Codex DeepSeek Bridge Launcher v0.1.2 ==="

  try {
    $workDir = $txtWorkDir.Text.Trim()
    if (-not $workDir -or -not (Test-Path $workDir)) { throw "Please select a valid working directory." }
    $baseUrl = $txtBaseUrl.Text.Trim()
    if (-not $baseUrl) { throw "Please enter a DeepSeek Base URL." }
    $apiKey = $txtApiKey.Text.Trim()
    if (-not $apiKey) { throw "Please enter a DeepSeek API Key." }
    $port = [int]$txtPort.Value
    if (-not $nodeOk) { throw "Node.js is not installed or not in PATH." }
    if (-not $codexOk) { throw "Codex CLI is not installed or not in PATH." }

    Append-Log "WorkDir: $workDir"
    Append-Log "BaseURL: $baseUrl"
    Append-Log "Port: $port"

    # Save preferences
    $prefs = @{ WorkDir = $workDir; BaseUrl = $baseUrl; Port = $port }
    $prefsDir = Split-Path $prefsFile
    New-Item -ItemType Directory -Force $prefsDir | Out-Null
    [System.IO.File]::WriteAllText($prefsFile, ($prefs | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))

    # Sandbox paths (computed here, not from script return value)
    $sandboxRoot = Join-Path $workDir ".codex-deepseek-sandbox"
    $codexHome = Join-Path $sandboxRoot "codex-home"
    $clientConfigPath = Join-Path $sandboxRoot "client.json"

    $setupScript = Join-Path $scriptDir "setup-sandbox.ps1"
    $launchCodexScript = Join-Path $scriptDir "launch-codex.ps1"

    # Phase 1: Setup sandbox
    $statusBar.Text = "Step 1/3: Setting up sandbox..."
    Append-Log "--- sandbox setup ---"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setupScript -WorkDir $workDir -BridgePort $port 2>&1 | ForEach-Object { Append-Log $_.ToString() }
    if ($LASTEXITCODE -ne 0) { throw "Sandbox setup failed (exit code $LASTEXITCODE)." }
    if (-not (Test-Path (Join-Path $codexHome "config.toml"))) { throw "Sandbox setup failed - config.toml not created." }
    $clientConfig = Read-BridgeClientConfig -Path $clientConfigPath
    $proxyKey = [string]$clientConfig.proxyKey
    $clientId = [string]$clientConfig.clientId
    Register-BridgeClient -RegistryPath $clientRegistryFile -ClientId $clientId -ProxyKey $proxyKey -WorkDir $workDir
    Append-Log "Client registered: $clientId"

    # Phase 2: Start bridge (non-blocking - do it directly in the GUI)
    $statusBar.Text = "Step 2/3: Starting bridge..."
    Append-Log "--- bridge start ---"

    $bridgePid = $null
    $bridgeStartedByThisLauncher = $false

    # Reuse an existing multi-client bridge on the same port when compatible.
    $oldListener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($oldListener) {
      try {
        $h = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2
        if ($h.status -eq "ok" -and $h.registry_enabled -eq $true) {
          if ($h.upstream_base_url -and ($h.upstream_base_url.TrimEnd("/") -ne $baseUrl.TrimEnd("/"))) {
            throw "Bridge on port $port is already running with upstream $($h.upstream_base_url). Use the same Base URL, stop the bridge, or choose another port."
          }
          Append-Log "Reusing existing multi-client bridge on port $port (PID $($oldListener.OwningProcess))"
          Append-Log "Registered clients visible to bridge: $($h.auth_clients)"
          $bridgePid = [int]$oldListener.OwningProcess
        } else {
          Append-Log "Replacing old single-client bridge on port $port (PID $($oldListener.OwningProcess))"
          Stop-Process -Id $oldListener.OwningProcess -Force -ErrorAction SilentlyContinue
          Start-Sleep -Milliseconds 500
        }
      } catch {
        if ($_.Exception.Message -match "already running with upstream") { throw }
        throw "Port $port is in use by PID $($oldListener.OwningProcess), but it is not a reusable Codex DeepSeek bridge."
      }
    }

    $logsDir = Join-Path $sandboxRoot "logs"
    $pidFile = Join-Path $sandboxRoot "bridge.pid"
    $bridgeScript = Join-Path $scriptDir "bridge\bridge.mjs"
    if (-not (Test-Path $bridgeScript)) {
      $bridgeScript = Join-Path $scriptDir "..\..\src\phase1\bridge.mjs"
    }

    Append-Log "Bridge script: $bridgeScript"
    Append-Log "Logs dir: $logsDir"
    New-Item -ItemType Directory -Force $logsDir | Out-Null

    $env:DEEPSEEK_BASE_URL = $baseUrl
    $env:DEEPSEEK_API_KEY = $apiKey
    $env:BRIDGE_PORT = [string]$port
    $env:UPSTREAM_MODE = "deepseek"
    $env:PHASE1_PROXY_KEY = $proxyKey
    $env:CODEX_BRIDGE_PROXY_KEYS_FILE = $clientRegistryFile
    $env:PHASE_LOG_DIR = $logsDir

    if (-not $bridgePid) {
      $bridgeProc = Start-Process -FilePath "node" `
        -ArgumentList "`"$bridgeScript`" --port=$port --log-dir=`"$logsDir`" --proxy-key=$proxyKey --proxy-keys-file=`"$clientRegistryFile`"" `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (Join-Path $logsDir "bridge-stdout.log") `
        -RedirectStandardError (Join-Path $logsDir "bridge-stderr.log")

      if (-not $bridgeProc) { throw "Failed to start Node.js. Is Node.js installed?" }
      $bridgePid = $bridgeProc.Id
      $bridgeStartedByThisLauncher = $true
      [System.IO.File]::WriteAllText($pidFile, [string]$bridgePid, [System.Text.UTF8Encoding]::new($false))
      Append-Log "Node.js PID: $bridgePid"
    } else {
      [System.IO.File]::WriteAllText($pidFile, [string]$bridgePid, [System.Text.UTF8Encoding]::new($false))
    }

    # Poll for health (with DoEvents to keep GUI responsive)
    Append-Log "Waiting for bridge health..."
    $deadline = (Get-Date).AddSeconds(20)
    $bridgeReady = $false
    while ((Get-Date) -lt $deadline) {
      [System.Windows.Forms.Application]::DoEvents()
      try {
        $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2
        if ($health.status -eq "ok") {
          Append-Log "Bridge healthy! Uptime: $($health.uptime_sec)s"
          Append-Log "Bridge clients: active=$($health.active_clients), registered=$($health.auth_clients)"
          $bridgeReady = $true
          break
        }
      } catch {}
      Start-Sleep -Milliseconds 500
    }

    if (-not $bridgeReady) {
      Append-Log "--- bridge stderr (last 20 lines) ---"
      $stderrLog = Join-Path $logsDir "bridge-stderr.log"
      if (Test-Path $stderrLog) {
        Get-Content $stderrLog -Tail 20 | ForEach-Object { Append-Log $_ }
      }
      Append-Log "--- end stderr ---"
      throw "Bridge failed to start within 20s. See logs at $logsDir"
    }

    $global:BridgeInfo = @{ SandboxRoot = $sandboxRoot; Port = $port; Pid = $bridgePid; StartedByThisLauncher = $bridgeStartedByThisLauncher }

    # Phase 3: Launch Codex
    $statusBar.Text = "Step 3/3: Launching Codex terminal..."
    Append-Log "--- launching Codex ---"
    Append-Log "CODEX_HOME=$codexHome"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launchCodexScript -WorkDir $workDir -CodexHome $codexHome -BridgePort $port -ClientConfigPath $clientConfigPath 2>&1 |
      ForEach-Object { Append-Log $_.ToString() }

    $statusBar.Text = "Bridge running (PID $bridgePid). Codex terminal opened."
    $statusBar.ForeColor = "DarkGreen"
    Append-Log "=== All done. Bridge PID $bridgePid ==="
    $btnLaunch.Enabled = $true
    $btnCancel.Enabled = $true

  } catch {
    $msg = $_.Exception.Message
    $statusBar.Text = "FAILED: $msg"
    $statusBar.ForeColor = "Red"
    Append-Log "=== FAILED: $msg ==="
    $btnLaunch.Enabled = $true
    $btnCancel.Enabled = $true
    [System.Windows.Forms.MessageBox]::Show($msg, "Launch Failed", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
  }
})
$form.Controls.Add($btnLaunch)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Cancel"
$btnCancel.Location = New-Object System.Drawing.Point($cancelX, $yBtn)
$btnCancel.Size = New-Object System.Drawing.Size(80, 28)
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

$form.AcceptButton = $btnLaunch

# FormClosing: stop bridge
$form.Add_FormClosing({
  param($sender, $e)
  if ($global:BridgeInfo) {
    if (-not $global:BridgeInfo.StartedByThisLauncher) {
      Append-Log "Leaving shared bridge running."
      return
    }
    Append-Log "Stopping bridge..."
    $stopScript = Join-Path $scriptDir "stop-bridge.ps1"
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -SandboxRoot $global:BridgeInfo.SandboxRoot -BridgePort $global:BridgeInfo.Port 2>&1 |
        ForEach-Object { Append-Log $_.ToString() }
    } catch {
      Append-Log "WARNING: $_"
    }
  }
})

[void] $form.ShowDialog()
