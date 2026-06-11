param(
  [switch]$SmokeTest
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Continue"
$scriptDir = $PSScriptRoot
$launcherDataDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "codex-deepseek-bridge-launcher"
$prefsFile = Join-Path $launcherDataDir "desktop-prefs.json"
$bridgeScript = Join-Path $scriptDir "launch-desktop-bridge.ps1"

if (-not (Test-Path $bridgeScript)) {
  throw "Missing bridge launcher script: $bridgeScript"
}

$prefs = @{}
if (Test-Path $prefsFile) {
  try {
    $tmp = Get-Content -LiteralPath $prefsFile -Raw | ConvertFrom-Json
    if ($tmp) { $prefs = $tmp }
  } catch {}
}

$defaultBaseUrl = if ($prefs.BaseUrl) { $prefs.BaseUrl } else { "https://api.deepseek.com/v1" }
$defaultPort = if ($prefs.Port) { [int]$prefs.Port } else { 43119 }

$nodeOk = $false
try { $null = node --version 2>$null; $nodeOk = $true } catch {}
$codexOk = $false
try { $null = codex.cmd --version 2>$null; $codexOk = $true } catch {}

if ($SmokeTest) {
  Write-Host "[desktop-bridge-ui] smoke ok"
  return
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Codex Desktop DeepSeek Bridge"
$form.Size = New-Object System.Drawing.Size(620, 360)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$fontBold = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)

[int]$y = 14
[int]$padY = 30
[int]$labelW = 130
[int]$inputX = 150
[int]$inputW = 420

function Add-Label {
  param([string]$Text, [int]$Top)
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point(14, $Top)
  $label.Size = New-Object System.Drawing.Size($labelW, 22)
  $form.Controls.Add($label)
  return $label
}

$info = New-Object System.Windows.Forms.Label
$info.Text = "Codex Desktop chooses projects inside the app. This launcher only prepares bridge mode."
$info.Location = New-Object System.Drawing.Point(14, $y)
$info.Size = New-Object System.Drawing.Size(570, 22)
$form.Controls.Add($info)

$y += $padY
Add-Label "DeepSeek Base URL:" $y | Out-Null
$txtBaseUrl = New-Object System.Windows.Forms.TextBox
$txtBaseUrl.Text = $defaultBaseUrl
$txtBaseUrl.Location = New-Object System.Drawing.Point($inputX, $y)
$txtBaseUrl.Size = New-Object System.Drawing.Size($inputW, 22)
$form.Controls.Add($txtBaseUrl)

$y += $padY
Add-Label "DeepSeek API Key:" $y | Out-Null
$txtApiKey = New-Object System.Windows.Forms.MaskedTextBox
$txtApiKey.PasswordChar = '*'
$txtApiKey.Location = New-Object System.Drawing.Point($inputX, $y)
$txtApiKey.Size = New-Object System.Drawing.Size($inputW, 22)
$form.Controls.Add($txtApiKey)

$y += $padY
Add-Label "Bridge Port:" $y | Out-Null
$numPort = New-Object System.Windows.Forms.NumericUpDown
$numPort.Minimum = 1024
$numPort.Maximum = 65535
$numPort.Value = $defaultPort
$numPort.Location = New-Object System.Drawing.Point($inputX, $y)
$numPort.Size = New-Object System.Drawing.Size(90, 22)
$form.Controls.Add($numPort)

$chkDryRun = New-Object System.Windows.Forms.CheckBox
$chkDryRun.Text = "Dry run"
$chkDryRun.Location = New-Object System.Drawing.Point(($inputX + 110), ($y + 1))
$chkDryRun.Size = New-Object System.Drawing.Size(90, 22)
$form.Controls.Add($chkDryRun)

$chkAllowExisting = New-Object System.Windows.Forms.CheckBox
$chkAllowExisting.Text = "Allow existing Desktop"
$chkAllowExisting.Location = New-Object System.Drawing.Point(($inputX + 210), ($y + 1))
$chkAllowExisting.Size = New-Object System.Drawing.Size(170, 22)
$form.Controls.Add($chkAllowExisting)

$y += $padY + 8
$status = New-Object System.Windows.Forms.Label
if ($nodeOk -and $codexOk) {
  $status.Text = "Ready. Close Codex Desktop before launching bridge mode."
  $status.ForeColor = "DarkGreen"
} elseif (-not $nodeOk) {
  $status.Text = "WARNING: Node.js was not found in PATH."
  $status.ForeColor = "Red"
} else {
  $status.Text = "WARNING: Codex CLI was not found in PATH."
  $status.ForeColor = "Red"
}
$status.Location = New-Object System.Drawing.Point(14, $y)
$status.Size = New-Object System.Drawing.Size(570, 20)
$form.Controls.Add($status)

$y += 24
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = "Vertical"
$logBox.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$logBox.ForeColor = [System.Drawing.Color]::LightGray
$logBox.Font = New-Object System.Drawing.Font("Consolas", 8)
$logBox.Location = New-Object System.Drawing.Point(14, $y)
$logBox.Size = New-Object System.Drawing.Size(570, 100)
$form.Controls.Add($logBox)

function Append-Log {
  param([string]$Text)
  $logBox.AppendText("$Text`r`n")
  $logBox.ScrollToCaret()
  $form.Refresh()
}

function Save-Prefs {
  param([string]$BaseUrl, [int]$Port)
  New-Item -ItemType Directory -Force $launcherDataDir | Out-Null
  $prefsOut = [ordered]@{
    BaseUrl = $BaseUrl
    Port = $Port
    UpdatedAt = (Get-Date).ToString("o")
  }
  [System.IO.File]::WriteAllText($prefsFile, ($prefsOut | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
}

$btnLaunch = New-Object System.Windows.Forms.Button
$btnLaunch.Text = "Launch Desktop"
$btnLaunch.Font = $fontBold
$btnLaunch.Location = New-Object System.Drawing.Point(360, 284)
$btnLaunch.Size = New-Object System.Drawing.Size(112, 30)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "Close"
$btnClose.Location = New-Object System.Drawing.Point(486, 284)
$btnClose.Size = New-Object System.Drawing.Size(98, 30)
$btnClose.Add_Click({ $form.Close() })

$btnLaunch.Add_Click({
  $btnLaunch.Enabled = $false
  $btnClose.Enabled = $false
  $status.Text = "Starting..."
  $status.ForeColor = "Black"
  $logBox.Clear()

  try {
    $baseUrl = $txtBaseUrl.Text.Trim()
    $apiKey = $txtApiKey.Text.Trim()
    $port = [int]$numPort.Value

    if (-not $baseUrl -or $baseUrl -notmatch '^https?://') { throw "Please enter a valid DeepSeek Base URL." }
    if (-not $apiKey) { throw "Please enter the DeepSeek API key." }
    if (-not $nodeOk) { throw "Node.js was not found in PATH." }
    if (-not $codexOk) { throw "Codex CLI was not found in PATH." }

    Save-Prefs -BaseUrl $baseUrl -Port $port

    Append-Log "Base URL: $baseUrl"
    Append-Log "Bridge port: $port"
    Append-Log "API key: provided, not saved"
    Append-Log "Workspace: choose or open projects in Codex Desktop"
    Append-Log "Starting bridge launcher..."

    $bridgeParams = @{
      DeepSeekBaseUrl = $baseUrl
      DeepSeekApiKey = $apiKey
      BridgePort = $port
    }
    if ($chkDryRun.Checked) { $bridgeParams.DryRun = $true }
    if ($chkAllowExisting.Checked) { $bridgeParams.AllowExistingDesktop = $true }

    $output = & $bridgeScript @bridgeParams *>&1
    foreach ($line in $output) {
      Append-Log ([string]$line)
    }

    $status.Text = if ($chkDryRun.Checked) { "Dry run complete." } else { "Launch requested. Use restore-desktop-bridge.bat to switch back." }
    $status.ForeColor = "DarkGreen"
  } catch {
    Append-Log "ERROR: $($_.Exception.Message)"
    $status.Text = "Failed."
    $status.ForeColor = "Red"
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Desktop bridge launch failed", "OK", "Error") | Out-Null
  } finally {
    $btnLaunch.Enabled = $true
    $btnClose.Enabled = $true
  }
})

$form.Controls.Add($btnLaunch)
$form.Controls.Add($btnClose)
$form.AcceptButton = $btnLaunch
$form.CancelButton = $btnClose

[void]$form.ShowDialog()
