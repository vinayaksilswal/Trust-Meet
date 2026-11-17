param(
    [Parameter(Mandatory)][string] $Address,
    [switch] $SkipEmailVerification
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$ip = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address | Select-Object -First 1
if (!$ip -or $Address -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
    throw 'Choose a private IPv4 address assigned to this computer.'
}

function Test-Listener([int] $Port, [string] $Target = '127.0.0.1') {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($Target, $Port)
        return $task.Wait(400) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Start-LocalProcess([string] $Name, [string] $Executable, [string] $Arguments) {
    Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput ".local/lan/$Name.log" -RedirectStandardError ".local/lan/$Name.error.log"
}

if (Test-Listener 3443 $Address) {
    throw "Port 3443 is already reachable at $Address."
}
foreach ($port in 3310, 8810, 7890) {
    if (Test-Listener $port) { throw "Reserved LAN test port $port is already in use. Stop the previous LAN test first." }
}
foreach ($file in @('.local/lan/site.pem', '.local/lan/site-key.pem', 'apps/web/.next/BUILD_ID')) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing $file. See the LAN testing setup in the README." }
}

$node = (Get-Command node.exe).Source
$python = (Resolve-Path .venv/Scripts/python.exe).Path
$livekit = (Resolve-Path .local/livekit/livekit-server.exe).Path
$redis = Get-ChildItem .local/redis -Recurse -Filter redis-server.exe | Select-Object -First 1
$postgres = (Resolve-Path .local/pg/package/native/bin/postgres.exe).Path
$mail = (Resolve-Path .local/mailpit/mailpit.exe).Path
$processes = [Collections.Generic.List[object]]::new()

try {
    if (!(Test-Listener 55432)) {
        $processes.Add((Start-LocalProcess 'postgres' $postgres '-D .local/pg/data -h 127.0.0.1 -p 55432'))
    }
    if (!(Test-Listener 56379)) {
        $processes.Add((Start-LocalProcess 'redis' $redis.FullName '--bind 127.0.0.1 --port 56379 --dir .local/redis'))
    }
    if (!(Test-Listener 1025)) {
        $processes.Add((Start-LocalProcess 'mail' $mail '--listen 127.0.0.1:8025 --smtp 127.0.0.1:1025'))
    }

    $origin = 'https://' + $Address + ':3443'
    $secretBytes = [byte[]]::new(32)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($secretBytes) } finally { $rng.Dispose() }
    $secret = [Convert]::ToBase64String($secretBytes)
    $env:ENVIRONMENT = 'lan'
    $env:WEB_ORIGIN = $origin
    $env:DATABASE_URL = 'postgresql+psycopg://conviya:conviya@127.0.0.1:55432/conviya'
    $env:REDIS_URL = 'redis://127.0.0.1:56379/0'
    $env:SMTP_HOST = '127.0.0.1'
    $env:SMTP_PORT = '1025'
    $env:SMTP_SENDER = 'no-reply@trustmeet.local'
    $env:ENABLE_DEV_AGE_ASSURANCE = 'true'
    $env:ENABLE_CONVERSATIONS = 'true'
    $env:ENABLE_MATCHMAKING = 'true'
    $env:ENABLE_PRIVATE_ROOMS = 'true'
    $env:LIVEKIT_API_URL = 'http://127.0.0.1:7890'
    $env:LIVEKIT_WS_URL = "wss://${Address}:3443"
    $env:LIVEKIT_API_KEY = 'trust-meet-lan'
    $env:LIVEKIT_API_SECRET = $secret

    $rtc = @"
port: 7890
rtc:
  tcp_port: 0
  udp_port: 7892
  use_external_ip: false
  ips:
    includes:
      - '$Address/32'
keys:
  trust-meet-lan: '$secret'
logging:
  level: warn
"@
    [IO.File]::WriteAllText((Join-Path (Get-Location) '.local/lan/livekit.yaml'), $rtc)
    $processes.Add((Start-LocalProcess 'livekit' $livekit "--config .local/lan/livekit.yaml --bind 127.0.0.1 --node-ip $Address"))
    $processes.Add((Start-LocalProcess 'api' $python '-m uvicorn --app-dir services/api conviya.main:app --loop conviya.event_loop:factory --host 127.0.0.1 --port 8810 --no-access-log'))
    $processes.Add((Start-LocalProcess 'web' $node 'node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3310'))
    $processes.Add((Start-LocalProcess 'gateway' $node "scripts/lan-gateway.mjs $Address $($ip.PrefixLength)"))

    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
        if (@($processes | Where-Object HasExited).Count) { throw 'An app process exited. Check .local/lan/*.error.log.' }
        try {
            $ready = Invoke-RestMethod -Uri 'http://127.0.0.1:8810/ready' -TimeoutSec 2
            if ($ready.status -eq 'ready' -and (Test-Listener 3310) -and (Test-Listener 7890) -and (Test-Listener 3443 $Address)) {
                $processes | Select-Object Id,Name,StartTime | ConvertTo-Json | Set-Content .local/lan/processes.json
                Write-Output "Trust Meet LAN test ready at $origin"
                exit 0
            }
        } catch {}
        Start-Sleep -Milliseconds 350
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The LAN test did not become ready. Check .local/lan/*.error.log.'
} catch {
    $processes | Where-Object { !$_.HasExited } | Stop-Process -ErrorAction SilentlyContinue
    throw
}
