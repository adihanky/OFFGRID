[CmdletBinding()]
param([ValidateSet('start', 'stop', 'verify')][string]$Action = 'start')

$ErrorActionPreference = 'Stop'
$Action = $Action.ToLowerInvariant()
. (Join-Path $PSScriptRoot 'use-tools.ps1')
Push-Location $projectRoot
try {
    $testDataPath = Join-Path $projectRoot '.local/mongodb-tests/data'
    $testLogPath = Join-Path $projectRoot '.local/mongodb-tests/mongod.log'
    $listener = Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
        $ownedDataArgument = '--dbpath\s+"?' + [regex]::Escape($testDataPath) + '"?(?:\s|$)'
        if ($owner.Name -ne 'mongod.exe' -or $owner.CommandLine -notmatch $ownedDataArgument -or $owner.CommandLine -notmatch '--port\s+27018(?:\s|$)') {
            throw 'Port 27018 belongs to another process; refusing to manage it.'
        }
    } elseif ($Action -eq 'start') {
        $mongoTool = $prerequisites.mongodb
        $mongodPath = Join-Path (Join-Path (Join-Path $projectRoot '.tools') $mongoTool.directory) $mongoTool.executable
        if (-not (Test-Path -LiteralPath $mongodPath)) { throw 'Run scripts/setup.ps1 first.' }
        New-Item -ItemType Directory -Path $testDataPath -Force | Out-Null
        $mongoArguments = @('--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', '27018', '--dbpath', "`"$testDataPath`"", '--logpath', "`"$testLogPath`"", '--logappend', '--wiredTigerCacheSizeGB', '0.25', '--oplogSize', '128', '--setParameter', 'diagnosticDataCollectionEnabled=false')
        Start-Process -FilePath $mongodPath -ArgumentList $mongoArguments -WindowStyle Hidden | Out-Null
    } elseif ($Action -eq 'stop') {
        Write-Output 'Isolated test MongoDB is already stopped.'
        return
    } else {
        throw 'Isolated test MongoDB is not running. Run scripts/test-db.ps1 start.'
    }
    & node scripts/test-db.mjs $Action
    if ($LASTEXITCODE -ne 0) { throw "Test database action '$Action' failed. Check .local/mongodb-tests/mongod.log." }
} finally {
    Pop-Location
}
