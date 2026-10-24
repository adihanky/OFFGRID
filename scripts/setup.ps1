[CmdletBinding()]
param([switch]$ToolsOnly)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'This bootstrap supports Windows x64. Use Node.js 24 and the Docker setup on other platforms.'
}
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prerequisites.json') -Raw | ConvertFrom-Json
$toolsPath = Join-Path $projectRoot '.tools'
$downloadPath = Join-Path $toolsPath 'downloads'
New-Item -ItemType Directory -Path $downloadPath -Force | Out-Null

foreach ($toolName in @('node', 'mongodb')) {
    $tool = $manifest.$toolName
    $toolExecutable = Join-Path (Join-Path $toolsPath $tool.directory) $tool.executable
    if (Test-Path -LiteralPath $toolExecutable) {
        Write-Host "$toolName $($tool.version) already available."
        continue
    }
    $archivePath = Join-Path $downloadPath ([IO.Path]::GetFileName($tool.url))
    if (-not (Test-Path -LiteralPath $archivePath)) {
        Write-Host "Downloading $toolName $($tool.version) from the official distribution..."
        Invoke-WebRequest -UseBasicParsing -Uri $tool.url -OutFile $archivePath -TimeoutSec 300
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $tool.sha256) {
        throw "Checksum mismatch for $archivePath. Remove this archive and rerun setup."
    }
    Write-Host "Verified SHA-256; extracting $toolName..."
    Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsPath -Force
    if (-not (Test-Path -LiteralPath $toolExecutable)) {
        throw "Expected executable missing after extraction: $toolExecutable"
    }
}

$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination $envPath
}
. (Join-Path $PSScriptRoot 'use-tools.ps1')
if ($ToolsOnly) {
    Write-Host 'Project-local Node.js and MongoDB are ready.'
    return
}
Push-Location $projectRoot
try {
    if (Test-Path -LiteralPath 'package-lock.json') { & npm.cmd ci } else { & npm.cmd install }
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Project build failed.' }
} finally {
    Pop-Location
}
Write-Host 'Setup complete. Run .\scripts\db.ps1 start, then .\scripts\npm.ps1 run dev.'
