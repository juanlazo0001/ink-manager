<#
.SYNOPSIS
  Posts a Twilio-shaped inbound-SMS payload at the REAL /webhooks/twilio/sms
  handler, for the A2P 10DLC opt-in/opt-out walkthrough.

.DESCRIPTION
  This drives the untouched production webhook: the request carries a genuine
  X-Twilio-Signature computed from the studio's own auth token, so signature
  validation runs for real. No test-only bypass exists in the handler, and
  none is needed.

  STRUCTURAL GUARD -- this script is incapable of aiming at production. The
  target base URL must resolve to a loopback host (localhost / 127.0.0.1 /
  ::1 / *.localhost) or a hostname containing "staging". Anything else is
  refused loudly, before any request is built. The same check is repeated
  independently inside the Node half (apps/api/src/scripts/
  simulateTwilioInbound.ts), so bypassing this wrapper does not bypass the
  guard.

  Why the guard matters: these payloads mutate real consent state
  (Client.smsOptedOutAt) and write real audit rows. Aimed at production they
  would fabricate opt-in/opt-out events against real customer records.

.EXAMPLE
  .\scripts\simulate-twilio-inbound.ps1 -Body "STOP" -OptOutType "STOP"

.EXAMPLE
  .\scripts\simulate-twilio-inbound.ps1 -Body "Hi, is Saturday still open?"
#>
[CmdletBinding()]
param(
  # Where the dev/staging API is listening. Guarded -- see above.
  [string]$BaseUrl = "http://localhost:4000",

  # The simulated customer's number (the "From" on a real inbound SMS).
  [string]$From = "+19105550147",

  # The studio's Twilio number (the "To"). Must match a CONNECTED SMS
  # integration in the target database or the handler 403s on "Unknown number".
  [string]$To = "+18508804483",

  [Parameter(Mandatory = $true)]
  [string]$Body,

  # Only set this for keywords Twilio's Advanced Opt-Out actually intercepts
  # (STOP / START / HELP families). Leave empty for an ordinary message.
  [ValidateSet("", "STOP", "START", "HELP")]
  [string]$OptOutType = ""
)

$ErrorActionPreference = "Stop"

function Assert-NonProductionTarget {
  param([string]$Url)

  try {
    $parsed = [System.Uri]$Url
  } catch {
    throw "Refusing to run: '$Url' is not a valid URL."
  }

  $targetHost = $parsed.Host.ToLowerInvariant()

  $isLoopback = @("localhost", "127.0.0.1", "::1") -contains $targetHost -or $targetHost.EndsWith(".localhost")
  $isStaging = $targetHost.Contains("staging")

  if (-not ($isLoopback -or $isStaging)) {
    Write-Host ""
    Write-Host "  ############################################################" -ForegroundColor Red
    Write-Host "  #  REFUSING TO RUN -- NON-STAGING TARGET                   #" -ForegroundColor Red
    Write-Host "  ############################################################" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Target host : $targetHost" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  This simulator may only target localhost or a host whose"
    Write-Host "  name contains 'staging'."
    Write-Host ""
    Write-Host "  It POSTs synthetic Twilio payloads that mutate real consent"
    Write-Host "  state and write real audit rows. Pointed at production it"
    Write-Host "  would fabricate opt-in/opt-out events against real customer"
    Write-Host "  records."
    Write-Host ""
    throw "Blocked by structural guard: '$targetHost' is not a permitted target."
  }
}

Assert-NonProductionTarget -Url $BaseUrl

$payload = @{
  baseUrl = $BaseUrl
  from    = $From
  to      = $To
  body    = $Body
}
if ($OptOutType -ne "") { $payload.optOutType = $OptOutType }

# Handed to the Node half as a temp FILE rather than an inline argv string:
# quoting JSON through PowerShell -> npx -> node on Windows mangles the inner
# double quotes. Removed in the finally block below.
$payloadFile = Join-Path ([System.IO.Path]::GetTempPath()) "twilio-sim-$([guid]::NewGuid().ToString('N')).json"
$payload | ConvertTo-Json -Compress | Set-Content -Path $payloadFile -Encoding utf8 -NoNewline

$apiDir = Join-Path $PSScriptRoot "..\apps\api"

Write-Host ""
Write-Host "  -> POST $BaseUrl/webhooks/twilio/sms" -ForegroundColor Cyan
Write-Host "     From : $From"
Write-Host "     To   : $To"
Write-Host "     Body : $Body"
if ($OptOutType -ne "") { Write-Host "     OptOutType: $OptOutType" }
Write-Host ""

Push-Location $apiDir
try {
  & npx tsx "src/scripts/simulateTwilioInbound.ts" $payloadFile
  if ($LASTEXITCODE -ne 0) { throw "Simulator exited with code $LASTEXITCODE" }
} finally {
  Pop-Location
  Remove-Item -Path $payloadFile -Force -ErrorAction SilentlyContinue
}
