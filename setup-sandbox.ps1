param(
  [Parameter(Mandatory = $true)]
  [string]$WorkDir,
  [int]$BridgePort = 43119,
  [string]$ProxyKey = ""
)

$ErrorActionPreference = "Continue"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-Step { param([string]$M) Write-Host "[setup] $M" }

Write-Step "Initializing sandbox in: $WorkDir"
Write-Step "Bridge port: $BridgePort"

$sandboxRoot = Join-Path $WorkDir ".codex-deepseek-sandbox"
$codexHome = Join-Path $sandboxRoot "codex-home"
$logsDir = Join-Path $sandboxRoot "logs"
$pidFile = Join-Path $sandboxRoot "bridge.pid"
$clientJson = Join-Path $sandboxRoot "client.json"
$configToml = Join-Path $codexHome "config.toml"
$modelCatalogJsonPath = Join-Path $codexHome "model-catalog.json"

try { New-Item -ItemType Directory -Force $codexHome, $logsDir | Out-Null } catch { throw "Failed to create directories: $_" }
Write-Step "Directories created"

function New-BridgeToken {
  param([string]$Prefix = "bridge")
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  return "$Prefix`_$token"
}

function New-BridgeClientId {
  $bytes = New-Object byte[] 8
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return "client_" + ([BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant())
}

function New-BridgeProjectId {
  param([string]$Path)
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($resolved.ToLowerInvariant())
    $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant().Substring(0, 8)
  } finally {
    $sha.Dispose()
  }
  $name = Split-Path $resolved -Leaf
  $safeName = ($name -replace '[^a-zA-Z0-9_.-]', '_')
  if (-not $safeName) { $safeName = "project" }
  return "project_$safeName`_$hash"
}

$projectId = $null
if (Test-Path $clientJson) {
  try {
    $existingClient = Get-Content $clientJson -Raw | ConvertFrom-Json
    if ($existingClient.projectId) { $projectId = [string]$existingClient.projectId }
  } catch {}
}
if (-not $projectId) { $projectId = New-BridgeProjectId -Path $WorkDir }

$clientId = New-BridgeClientId
$instanceId = "instance_" + $clientId.Substring("client_".Length)
if (-not $ProxyKey) { $ProxyKey = New-BridgeToken -Prefix "bridge_proxy" }

$clientConfig = [ordered]@{
  clientId = $clientId
  projectId = $projectId
  instanceId = $instanceId
  proxyKey = $ProxyKey
  workDir = [System.IO.Path]::GetFullPath($WorkDir)
  sandboxRoot = [System.IO.Path]::GetFullPath($sandboxRoot)
  logDir = [System.IO.Path]::GetFullPath($logsDir)
  createdAt = (Get-Date).ToString("o")
}
[System.IO.File]::WriteAllText($clientJson, ($clientConfig | ConvertTo-Json -Depth 5), $utf8NoBom)
Write-Step "Project identity ready: $projectId"
Write-Step "Client identity ready: $clientId"
Write-Step "Instance identity ready: $instanceId"

# Build model catalog directly -- no external process, pure PowerShell, ASCII-safe
Write-Step "Building model catalog (pure PS, no external process)..."

$modelCatalog = [pscustomobject]@{
  models = @(
    [pscustomobject]@{
      slug = "deepseek-v4-pro"
      display_name = "DeepSeek V4 Pro"
      description = "DeepSeek V4 Pro through Codex DeepSeek bridge"
      default_reasoning_level = "medium"
      supported_reasoning_levels = @(
        [pscustomobject]@{ effort = "low"; description = "Fast responses" }
        [pscustomobject]@{ effort = "medium"; description = "Balanced" }
        [pscustomobject]@{ effort = "high"; description = "Deep reasoning" }
        [pscustomobject]@{ effort = "xhigh"; description = "Maximum reasoning" }
      )
      shell_type = "shell_command"
      visibility = "list"
      supported_in_api = $true
      priority = 0
      additional_speed_tiers = @()
      service_tiers = @()
      availability_nux = $null
      upgrade = $null
      base_instructions = "You are Codex, a coding agent. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled."
      model_messages = [pscustomobject]@{
        instructions_template = "You are Codex, a coding agent. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled.`n`n{{ personality }}"
        instructions_variables = [pscustomobject]@{
          personality_default = ""
          personality_friendly = ""
          personality_pragmatic = ""
        }
      }
      supports_reasoning_summaries = $false
      default_reasoning_summary = "none"
      support_verbosity = $true
      default_verbosity = "low"
      apply_patch_tool_type = "freeform"
      web_search_tool_type = "text_and_image"
      truncation_policy = [pscustomobject]@{ mode = "tokens"; limit = 10000 }
      supports_parallel_tool_calls = $true
      supports_image_detail_original = $false
      context_window = 1000000
      max_context_window = 1000000
      effective_context_window_percent = 90
      experimental_supported_tools = @()
      input_modalities = @("text")
      supports_search_tool = $false
    }
  )
} | ConvertTo-Json -Depth 10

[System.IO.File]::WriteAllText($modelCatalogJsonPath, $modelCatalog, $utf8NoBom)
Write-Step "Model catalog written"

# Generate config.toml
Write-Step "Generating config.toml..."
$escapedCatalog = $modelCatalogJsonPath.Replace('\', '\\')
$escapedWorkDir = $WorkDir.Replace('\', '\\').ToLowerInvariant()

$configContent = @"
model = "deepseek-v4-pro"
model_provider = "deepseek_bridge"
model_catalog_json = "$escapedCatalog"
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.deepseek_bridge]
name = "deepseek_bridge"
base_url = "http://127.0.0.1:${BridgePort}/v1"
wire_api = "responses"
env_key = "PHASE1_PROXY_KEY"
requires_openai_auth = false

[projects."$escapedWorkDir"]
trust_level = "trusted"

[windows]
sandbox = "unelevated"
"@
[System.IO.File]::WriteAllText($configToml, $configContent, $utf8NoBom)
Write-Step "Config written"

Write-Step "Sandbox setup complete"
Write-Step "  SandboxRoot: $sandboxRoot"
Write-Step "  CodexHome:   $codexHome"

return @{ SandboxRoot = $sandboxRoot; CodexHome = $codexHome; LogsDir = $logsDir; PidFile = $pidFile; ClientId = $clientId; ProjectId = $projectId; InstanceId = $instanceId; ClientJson = $clientJson }
