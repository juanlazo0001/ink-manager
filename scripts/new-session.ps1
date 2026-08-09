<#
.SYNOPSIS
  Sets up an isolated git worktree for a new concurrent session.

.DESCRIPTION
  Every concurrent session (a second Claude Code session, a second
  engineer, anything working in this repo at the same time as something
  else) MUST get its own worktree -- two sessions sharing one working
  tree means one session's uncommitted edits are silently visible to,
  and clobberable by, the other. This script is the single entry point
  that guarantees that: it fetches the latest main, creates a fresh
  worktree on its own branch cut from origin/main, runs a full npm ci
  in it, and prints the worktree path plus a free dev-port pair so the
  new session never has to guess or collide with whatever the primary
  checkout (or another worktree) already has running.

.PARAMETER Name
  Optional label for the worktree directory and branch. Defaults to a
  timestamp if omitted. Sanitized to safe path/branch characters.

.EXAMPLE
  .\scripts\new-session.ps1 -Name embedded-payments
  Creates ../ink-manager-w-embedded-payments on branch session/embedded-payments.

.EXAMPLE
  .\scripts\new-session.ps1
  Creates ../ink-manager-w-<timestamp> on branch session/<timestamp>.
#>
param(
  [string]$Name
)

$ErrorActionPreference = 'Stop'

if (-not $Name) {
  $Name = Get-Date -Format 'yyyyMMdd-HHmmss'
}
# Keep this safe as both a directory name and a git branch name.
$Name = ($Name -replace '[^a-zA-Z0-9._-]', '-').Trim('-')
if (-not $Name) {
  throw 'Name sanitized to an empty string -- pick something with at least one letter or digit.'
}

$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
  throw 'Not inside a git repository. Run this from within the ink-manager repo.'
}
$repoRoot = $repoRoot -replace '/', '\'
Set-Location $repoRoot

$parentDir = Split-Path -Parent $repoRoot
$worktreeDirName = "ink-manager-w-$Name"
$worktreePath = Join-Path $parentDir $worktreeDirName

if (Test-Path $worktreePath) {
  throw "Worktree path already exists: $worktreePath -- pick a different -Name."
}

Write-Host "Fetching latest main from origin..."
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main failed.' }

$branchName = "session/$Name"

Write-Host "Creating worktree at $worktreePath on new branch '$branchName' (from origin/main)..."
git worktree add -b $branchName $worktreePath origin/main
if ($LASTEXITCODE -ne 0) { throw 'git worktree add failed -- see output above.' }

Write-Host "Running npm ci in the new worktree (repo root, full monorepo install)..."
Push-Location $worktreePath
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in the new worktree -- see output above.' }
} finally {
  Pop-Location
}

# --- Find a free dev-port pair --------------------------------------
# apps/api defaults to PORT=4000, apps/web's vite defaults to 5173 --
# scanning starts just above each so a fresh session never guesses its
# way into whatever the primary checkout (or another worktree) already
# has bound, rather than colliding and finding out from a cryptic
# EADDRINUSE.
function Find-FreePort {
  param(
    [int]$Start,
    [int]$Count = 50
  )
  for ($port = $Start; $port -lt ($Start + $Count); $port++) {
    $inUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $inUse) { return $port }
  }
  return $null
}

$apiPort = Find-FreePort -Start 4001
$webPort = Find-FreePort -Start 5174

Write-Host ''
Write-Host '=================================================='
Write-Host 'Worktree ready.'
Write-Host "  Path:   $worktreePath"
Write-Host "  Branch: $branchName (cut from latest origin/main)"
if ($apiPort -and $webPort) {
  Write-Host "  Free dev ports -- API: $apiPort   WEB: $webPort"
  Write-Host "  e.g. (from the worktree's apps/api):  `$env:PORT=$apiPort; npm run dev"
  Write-Host "       (from the worktree's apps/web):   npx vite --port $webPort"
} else {
  Write-Warning 'Could not find a free port in the scanned range -- check manually before starting a dev server.'
}
Write-Host '=================================================='
