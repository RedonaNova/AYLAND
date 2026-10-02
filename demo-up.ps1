# Starts the live demo on this PC as detached processes that outlive the terminal:
#   MCP travel-data :8501, MCP merchant :8502, Booking Agent :8401, Interpreter Agent :8402
#     <-  orchestrator API :8100  <-  web :3100 (proxies /api)  <-  Cloudflare quick tunnel
# Ports differ from development (3000, 8000, 8201-8202, 8301-8302) so both can run at once.
# From a tool that waits for child processes, launch it detached: Start-Process powershell -ArgumentList ...
#
#   powershell -ExecutionPolicy Bypass -File demo-up.ps1 -Build      # first time, or after pulling
#   powershell -ExecutionPolicy Bypass -File demo-up.ps1 -KeepTunnel  # restart app, keep the same URL
#   powershell -ExecutionPolicy Bypass -File demo-up.ps1 -Stop
param([switch]$Build, [switch]$KeepTunnel, [switch]$Stop)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$logs = Join-Path $env:LOCALAPPDATA "ayland\demo-logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$webPort = 3100
$apiPort = 8100
$services = @(
    @{ Name = "travel"; Module = "ayland.mcp_servers.travel_data.server"; Port = 8501; Env = "MCP_TRAVEL_DATA_URL"; Path = "/mcp" },
    @{ Name = "merchant"; Module = "ayland.mcp_servers.merchant.server"; Port = 8502; Env = "MCP_MERCHANT_URL"; Path = "/mcp" },
    @{ Name = "booking"; Module = "ayland.a2a_agents.booking.server"; Port = 8401; Env = "A2A_BOOKING_URL"; Path = "" },
    @{ Name = "interpreter"; Module = "ayland.a2a_agents.interpreter.server"; Port = 8402; Env = "A2A_INTERPRETER_URL"; Path = "" }
)

function Stop-Matching([string]$pattern) {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like $pattern } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

Stop-Matching "*uvicorn*ayland.orchestrator.app*--port $apiPort*"
foreach ($s in $services) { Stop-Matching "*uvicorn*$($s.Module)*--port $($s.Port)*" }
Stop-Matching "*next*start*-p*$webPort*"
if (-not $KeepTunnel) { Stop-Matching "*cloudflared*--url*localhost:$webPort*" }
if ($Stop) { "Demo stopped."; return }

if (-not (Test-Path (Join-Path $root ".env"))) { Write-Warning "No .env in $root - copy it from your main checkout first." }

if ($Build) {
    uv --directory (Join-Path $root "backend") sync
    $env:AYLAND_API_ORIGIN = "http://localhost:$apiPort"
    npm --prefix (Join-Path $root "frontend") ci --no-audit --no-fund
    npm --prefix (Join-Path $root "frontend") run build
}

# Child processes inherit these, so each Agent Card, the MCP config and the orchestrator agree on the demo ports.
foreach ($s in $services) { Set-Item "env:$($s.Env)" "http://localhost:$($s.Port)$($s.Path)" }
foreach ($s in $services) {
    Start-Process -FilePath "uv" -WindowStyle Hidden -WorkingDirectory (Join-Path $root "backend") `
        -ArgumentList "run", "uvicorn", "$($s.Module):app", "--port", "$($s.Port)" `
        -RedirectStandardOutput "$logs\$($s.Name).log" -RedirectStandardError "$logs\$($s.Name).err.log" | Out-Null
}
Start-Process -FilePath "uv" -WindowStyle Hidden -WorkingDirectory (Join-Path $root "backend") `
    -ArgumentList "run", "uvicorn", "ayland.orchestrator.app:app", "--port", "$apiPort", "--timeout-graceful-shutdown", "3" `
    -RedirectStandardOutput "$logs\api.log" -RedirectStandardError "$logs\api.err.log" | Out-Null
Start-Process -FilePath "node" -WindowStyle Hidden -WorkingDirectory (Join-Path $root "frontend") `
    -ArgumentList "node_modules\next\dist\bin\next", "start", "-p", "$webPort" `
    -RedirectStandardOutput "$logs\web.log" -RedirectStandardError "$logs\web.err.log" | Out-Null

$tunnelRunning = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*cloudflared*--url*localhost:$webPort*" }
if (-not $tunnelRunning) {
    $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cloudflared) { $cloudflared = Join-Path $env:LOCALAPPDATA "cloudflared\cloudflared.exe" }
    Remove-Item "$logs\tunnel.err.log" -ErrorAction SilentlyContinue
    Start-Process -FilePath $cloudflared -WindowStyle Hidden -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://localhost:$webPort" `
        -RedirectStandardOutput "$logs\tunnel.log" -RedirectStandardError "$logs\tunnel.err.log" | Out-Null
}

$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
    Start-Sleep -Milliseconds 750
    $hit = Select-String -Path "$logs\tunnel.err.log" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -Last 1
    if ($hit) { $url = $hit.Matches[0].Value }
}
$ports = ($services | ForEach-Object { "$($_.Name) :$($_.Port)" }) -join "  "
"Web  http://localhost:$webPort   API  http://localhost:$apiPort   $ports   logs  $logs"
if ($url) { "Public URL: $url" } else { "Tunnel URL not found yet; see $logs\tunnel.err.log" }
