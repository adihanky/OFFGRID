$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'use-tools.ps1')
Push-Location $projectRoot
try {
    & npm.cmd @args
    $npmExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $npmExitCode
