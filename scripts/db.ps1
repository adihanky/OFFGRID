[CmdletBinding()]
param([ValidateSet('start', 'stop', 'verify')][string]$Action = 'start')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'use-tools.ps1')
Push-Location $projectRoot
try {
    if ($Action -eq 'stop') {
        & node scripts/db-stop.mjs
    } elseif ($Action -eq 'verify') {
        & node scripts/db-verify.mjs
    } else {
        $mongoTool = $prerequisites.mongodb
        $mongodPath = Join-Path (Join-Path (Join-Path $projectRoot '.tools') $mongoTool.directory) $mongoTool.executable
        if (-not (Test-Path -LiteralPath $mongodPath)) { throw 'Run scripts/setup.ps1 first.' }
        $listener = Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue
        if (-not $listener) {
            $dataPath = Join-Path $projectRoot '.local/mongodb/data'
            $logPath = Join-Path $projectRoot '.local/mongodb/mongod.log'
            New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
            $mongoArguments = @('--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', '27017', '--dbpath', "`"$dataPath`"", '--logpath', "`"$logPath`"", '--logappend', '--wiredTigerCacheSizeGB', '0.25')
            Start-Process -FilePath $mongodPath -ArgumentList $mongoArguments -WindowStyle Hidden | Out-Null
        }
        & node scripts/db-init.mjs
    }
    if ($LASTEXITCODE -ne 0) { throw "Database action '$Action' failed. Check .local/mongodb/mongod.log." }
} finally {
    Pop-Location
}
