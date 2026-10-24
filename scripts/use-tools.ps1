$projectRoot = Split-Path -Parent $PSScriptRoot
$prerequisites = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prerequisites.json') -Raw | ConvertFrom-Json
$nodeDirectory = Join-Path (Join-Path $projectRoot '.tools') $prerequisites.node.directory
if (-not (Test-Path -LiteralPath (Join-Path $nodeDirectory 'node.exe'))) {
    throw 'Project-local Node.js is missing. Run .\scripts\setup.ps1 first.'
}
$env:PATH = "$nodeDirectory;$env:PATH"
$env:npm_config_cache = Join-Path $projectRoot '.cache/npm'
