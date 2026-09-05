# Windows x64 project-local Node/npm. Example: .\scripts\dev-env.ps1 run dev
# Quote npm's separator in PowerShell: .\scripts\dev-env.ps1 run dev '--' --smoke
# Download and SHA256: https://nodejs.org/en/blog/release/v22.23.2
$ErrorActionPreference = 'Stop'
# Preserve native exit codes even when the caller enables PowerShell 7's opt-in.
$PSNativeCommandUseErrorActionPreference = $false
$taskNpmArguments = @($args)
if ($taskNpmArguments.Count -eq 0) { $taskNpmArguments = @('run', 'doctor') }

if ($env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'This launcher supports Windows x64. Use the documented Node 22 environment on other systems.'
}

$taskRoot = Split-Path -Parent $PSScriptRoot
$taskTools = Join-Path $taskRoot '.tools'
$taskNodeVersion = '22.23.2'
$taskDistribution = "node-v$taskNodeVersion-win-x64"
$taskRuntime = Join-Path $taskTools $taskDistribution
$taskNode = Join-Path $taskRuntime 'node.exe'
$taskNpm = Join-Path $taskRuntime 'node_modules/npm/bin/npm-cli.js'
$taskExpectedHash = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'

foreach ($taskDirectory in @($taskTools, $taskRuntime)) {
    if ((Test-Path -LiteralPath $taskDirectory) -and
        ((Get-Item -LiteralPath $taskDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing a linked runtime directory: $taskDirectory"
    }
}

if (-not (Test-Path -LiteralPath $taskNode -PathType Leaf)) {
    if (Test-Path -LiteralPath $taskRuntime) {
        throw "The local runtime is incomplete. Inspect this directory before reinstalling: $taskRuntime"
    }
    New-Item -ItemType Directory -Path $taskTools -Force | Out-Null
    $taskArchive = Join-Path $taskTools ("download-" + [Guid]::NewGuid().ToString('N') + '.zip')
    try {
        Write-Host "[dev-env] Downloading official Node $taskNodeVersion (Windows x64)..."
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$taskNodeVersion/$taskDistribution.zip" -OutFile $taskArchive
        if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpectedHash) {
            throw 'Node archive SHA256 mismatch; nothing was extracted or executed.'
        }
        Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskTools
        Write-Host "[dev-env] SHA256 verified; installed to $taskRuntime"
    } finally {
        if (Test-Path -LiteralPath $taskArchive) { Remove-Item -LiteralPath $taskArchive }
    }
}

if (-not (Test-Path -LiteralPath $taskNpm -PathType Leaf)) {
    throw "The bundled npm entry point is missing: $taskNpm"
}
$taskActualVersion = & $taskNode --version
if ($LASTEXITCODE -ne 0 -or $taskActualVersion -ne "v$taskNodeVersion") {
    throw "The local runtime did not report the expected Node v$taskNodeVersion."
}

$taskPreviousPath = $env:PATH
$taskPreviousPrefix = $env:npm_config_prefix
$taskExitCode = 1
Push-Location -LiteralPath $taskRoot
try {
    # Scope both Node and npm selection to this command, including nested npm.cmd.
    $env:PATH = "$taskRuntime;$taskPreviousPath"
    $env:npm_config_prefix = $taskRuntime
    & $taskNode $taskNpm @taskNpmArguments
    $taskExitCode = $LASTEXITCODE
} finally {
    $env:PATH = $taskPreviousPath
    if ($null -eq $taskPreviousPrefix) { Remove-Item Env:npm_config_prefix -ErrorAction SilentlyContinue }
    else { $env:npm_config_prefix = $taskPreviousPrefix }
    Pop-Location
}
exit $taskExitCode
