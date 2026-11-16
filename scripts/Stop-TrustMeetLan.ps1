$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$manifest = '.local/lan/processes.json'
if (!(Test-Path -LiteralPath $manifest)) { return }
foreach ($entry in (Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json)) {
    $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq $entry.Name -and $process.StartTime -eq [datetime]$entry.StartTime) {
        Stop-Process -InputObject $process
    }
}
Remove-Item -LiteralPath $manifest
