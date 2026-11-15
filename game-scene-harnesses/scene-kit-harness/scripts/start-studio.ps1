[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot '../.local/studio.json')
)

$ErrorActionPreference = 'Stop'
$sceneKit = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$configFile = (Resolve-Path -LiteralPath $Config).Path
$configRoot = Split-Path -Parent $configFile
$settings = Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json
$required = @('format', 'releaseCommit', 'port', 'projectName', 'projectId', 'kit', 'map',
    'workspace', 'style', 'environmentExchange', 'animationExchange', 'privateWorkspace',
    'codexExecutable', 'codexSha256', 'codeModeHostSha256')
$fields = @($settings.PSObject.Properties.Name)
if ($fields.Count -ne $required.Count -or @($required | Where-Object { $_ -notin $fields }).Count -or
    $settings.format -cne 'ai_scene_studio_local_config_v1' -or
    $settings.releaseCommit -cnotmatch '^[a-f0-9]{40}$' -or
    ($settings.port -isnot [long] -and $settings.port -isnot [int]) -or
    $settings.port -lt 1024 -or $settings.port -gt 65535) {
    throw 'Invalid local Studio configuration.'
}
foreach ($name in @('projectName', 'projectId', 'kit', 'map', 'workspace', 'style',
    'environmentExchange', 'animationExchange', 'privateWorkspace', 'codexExecutable')) {
    if ($settings.$name -isnot [string] -or !$settings.$name -or $settings.$name -match '[\x00-\x1f"]') {
        throw "Invalid local configuration field $name."
    }
}

function Local-Path($Name) {
    return [IO.Path]::GetFullPath([string]$settings.$Name, $configRoot)
}

$kit = Local-Path 'kit'
$map = Local-Path 'map'
$workspace = Local-Path 'workspace'
$style = Local-Path 'style'
$environment = Local-Path 'environmentExchange'
$animation = Local-Path 'animationExchange'
$privateWorkspace = Local-Path 'privateWorkspace'
$codex = Local-Path 'codexExecutable'
$codeModeHost = Join-Path (Split-Path -Parent $codex) 'codex-code-mode-host.exe'
$releaseCommit = $settings.releaseCommit
$origin = "http://127.0.0.1:$($settings.port)"
$node = (Get-Command node.exe).Source
$studioEntry = Join-Path $PSScriptRoot 'studio.mjs'
$environmentEntry = Join-Path $PSScriptRoot 'environment-library-worker.mjs'
$animationEntry = Join-Path $PSScriptRoot 'environment-animation-worker.mjs'
$logRoot = Join-Path $configRoot 'logs'

$actualCommit = git -C $sceneKit rev-parse --verify HEAD
if ($LASTEXITCODE -or $actualCommit -cne $releaseCommit) { throw 'Studio HEAD differs from the configured release commit.' }
$changes = git --no-optional-locks -C $sceneKit status --porcelain=v1 --untracked-files=all -- . '../../game-ui-harnesses/ui-reference-harness/web/adapters'
if ($LASTEXITCODE -or $changes) { throw 'Commit the Scene Kit runtime changes before starting a pinned release.' }
foreach ($file in @($map, $style, $codex, $codeModeHost)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing local startup file $file." }
}
if (!(Test-Path -LiteralPath (Join-Path $kit 'kit.json'))) { throw 'The configured kit is missing.' }
foreach ($item in @(@{ Path = $codex; Hash = $settings.codexSha256 }, @{ Path = $codeModeHost; Hash = $settings.codeModeHostSha256 })) {
    if ($item.Hash -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $item.Path).Hash -ine $item.Hash) {
        throw "Configured tool fingerprint changed. $($item.Path)"
    }
}
$null = New-Item -ItemType Directory -Path $logRoot -Force

function Get-LocalJson($Path) {
    try { return Invoke-RestMethod -NoProxy -Uri ($origin + $Path) -TimeoutSec 5 }
    catch { return $null }
}

function Test-Version($Value) {
    return $Value.releaseCommit -ceq $releaseCommit -and $Value.mode -ceq 'project'
}

$existing = Get-LocalJson '/api/state'
if ($existing -and (!(Test-Version (Get-LocalJson '/api/studio-version')) -or
    $existing.workspace.activeProjectId -cne $settings.projectId)) {
    throw "Port $($settings.port) is serving a different Studio release or project."
}

function Start-LocalProcess($Name, $Entry, $Binding, $Arguments, $Ready) {
    $entryName = Split-Path -Leaf $Entry
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($entryName) -and $_.CommandLine.Contains($Binding)
    })
    if ($running.Count -gt 1) { throw "Multiple $Name processes use the configured workspace." }
    if ($running.Count) {
        if (!$running[0].CommandLine.Contains($Entry)) { throw "$Name already runs from another checkout." }
        return
    }
    $log = Join-Path $logRoot ($Name + '-' + [guid]::NewGuid().ToString('N'))
    $process = Start-Process -FilePath $node -ArgumentList ('"{0}" {1}' -f $Entry, $Arguments) -WorkingDirectory $sceneKit `
        -WindowStyle Hidden -Environment @{ OPENAI_API_KEY = $null } -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err" -PassThru
    for ($attempt = 0; $attempt -lt 75; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw "$Name stopped before startup. See $log.err" }
        if (Select-String -LiteralPath "$log.out" -Pattern $Ready -SimpleMatch -Quiet) { return }
        Start-Sleep -Milliseconds 400
    }
    throw "$Name startup was not verified. See $log.err"
}

Start-LocalProcess 'environment-worker' $environmentEntry $environment `
    ('--exchange "{0}" --private-workspace "{1}" --adapter codex --codex-executable "{2}"' -f $environment, $privateWorkspace, $codex) 'environment-library-worker-ready'
Start-LocalProcess 'animation-worker' $animationEntry $animation `
    ('--exchange "{0}" --codex-executable "{1}"' -f $animation, $codex) 'environment-animation-worker-ready'
Start-LocalProcess 'studio' $studioEntry $workspace `
    ('serve --release-commit {0} --port {1} --kit "{2}" --map "{3}" --projects "{4}" --project-name "{5}" --environment-exchange "{6}" --environment-style "{7}" --animation-exchange "{8}"' -f
        $releaseCommit, $settings.port, $kit, $map, $workspace, $settings.projectName, $environment, $style, $animation) 'local-studio'

for ($attempt = 0; $attempt -lt 12; $attempt++) {
    $version = Get-LocalJson '/api/studio-version'
    $state = Get-LocalJson '/api/state'
    $worker = Get-LocalJson '/api/environment-animation/generation'
    if ((Test-Version $version) -and $state.environmentLibrary -and $state.animationGeneration -and $worker.available) { break }
    Start-Sleep -Milliseconds 500
}
if (!(Test-Version $version) -or $state.workspace.activeProjectId -cne $settings.projectId -or
    !$state.environmentLibrary -or !$state.animationGeneration -or !$worker.available) {
    throw 'Studio project identity, style or animation worker was not verified.'
}
[ordered]@{
    url = "$origin/editor"
    releaseCommit = $version.releaseCommit
    projectId = $state.workspace.activeProjectId
    authorSha256 = $state.scene.source.authorSha256
    environmentStyle = $state.environmentLibrary.styleName
    animationWorker = $worker.available
} | ConvertTo-Json -Compress
