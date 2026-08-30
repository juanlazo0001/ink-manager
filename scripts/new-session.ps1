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
  worktree on its own branch cut from origin/main, copies every local
  .env* file (gitignored, so a bare worktree has none -- no DATABASE_URL,
  nothing works) from the primary checkout into the same relative path,
  runs a full npm ci in it, and prints the worktree path plus a free
  dev-port pair so the new session never has to guess or collide with
  whatever the primary checkout (or another worktree) already has
  running.

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

# --- Running native tools under $ErrorActionPreference = 'Stop' ----------
# Windows PowerShell 5.1 wraps ANY stderr output from a native executable
# in an ErrorRecord, and 'Stop' promotes that to a TERMINATING error. That
# is not a failure signal: `git fetch` writes its ordinary "From <url>"
# progress line to stderr on every successful fetch, and `npm ci` writes
# deprecation warnings there. Both killed this script mid-run -- the fetch
# before anything was created, the npm ci AFTER the worktree existed and
# its .env files had been copied, leaving a half-built worktree that had
# to be finished by hand. Twice, on 2026-08-30.
#
# Native tools report failure through their EXIT CODE, which is what this
# checks (and what every call site here already checked). Preference is
# restored in `finally` so cmdlet errors keep stopping the script.
function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Command,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Command
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

if (-not $Name) {
  $Name = Get-Date -Format 'yyyyMMdd-HHmmss'
}
# Keep this safe as both a directory name and a git branch name.
$Name = ($Name -replace '[^a-zA-Z0-9._-]', '-').Trim('-')
if (-not $Name) {
  throw 'Name sanitized to an empty string -- pick something with at least one letter or digit.'
}

# Not Invoke-Native: a non-repo is a legitimate answer here, not a
# failure to report, so this swallows both the stderr and the exit code
# and lets the emptiness of $repoRoot do the talking.
$ErrorActionPreference = 'Continue'
$repoRoot = (git rev-parse --show-toplevel 2>$null)
$ErrorActionPreference = 'Stop'
if (-not $repoRoot) {
  throw 'Not inside a git repository. Run this from within the ink-manager repo.'
}
$repoRoot = $repoRoot -replace '/', '\'
Set-Location $repoRoot

# The PRIMARY checkout's path, not wherever this script happens to be
# invoked from -- `git rev-parse --show-toplevel` returns whichever
# worktree you're standing in, including an already-linked one. Running
# this script from inside an existing worktree (rather than the original
# clone) would otherwise silently source .env files from that worktree's
# own (possibly incomplete) copy instead of the canonical primary
# checkout. `git worktree list --porcelain`'s first `worktree` line is
# always the original checkout, never a linked one.
# NOT Invoke-Native, and not an exit-code check of any kind: `Select-Object
# -First 1` terminates the pipeline as soon as it has its one match, which
# stops git mid-write and leaves $LASTEXITCODE = -1 on a completely
# SUCCESSFUL read. Exit codes are meaningless for an early-terminated
# pipeline. The emptiness check below is the real test, and it already has
# a fallback.
$ErrorActionPreference = 'Continue'
$primaryWorktreeLine =
  (git worktree list --porcelain | Select-String '^worktree ' | Select-Object -First 1).Line
$ErrorActionPreference = 'Stop'
$envSourceRoot = ($primaryWorktreeLine -replace '^worktree ', '') -replace '/', '\'
if (-not $envSourceRoot -or -not (Test-Path $envSourceRoot)) {
  Write-Warning "Could not resolve the primary checkout's path -- falling back to $repoRoot for .env sourcing."
  $envSourceRoot = $repoRoot
}

$parentDir = Split-Path -Parent $repoRoot
$worktreeDirName = "ink-manager-w-$Name"
$worktreePath = Join-Path $parentDir $worktreeDirName

if (Test-Path $worktreePath) {
  throw "Worktree path already exists: $worktreePath -- pick a different -Name."
}

Write-Host "Fetching latest main from origin..."
Invoke-Native -FailureMessage 'git fetch origin main failed.' -Command {
  git fetch origin main
}

$branchName = "session/$Name"

Write-Host "Creating worktree at $worktreePath on new branch '$branchName' (from origin/main)..."
Invoke-Native -FailureMessage 'git worktree add failed -- see output above.' -Command {
  git worktree add -b $branchName $worktreePath origin/main
}

# --- Copy local .env files ------------------------------------------
# A git worktree only ever contains TRACKED files -- every .env* file in
# this repo (apps/api/.env, apps/api/.env.production, apps/web/.env) is
# gitignored, so a brand new worktree has no DATABASE_URL at all: prisma
# commands, npm run dev, and the test suite all fail outright until
# something puts one there (hit this the hard way building Part 2 of the
# multi-language-public-forms epic). Mirrors every real .env* file found
# in the primary checkout into the same relative path in the new
# worktree, skipping .env.example (already tracked, already present).
Write-Host "Copying local .env files from the primary checkout ($envSourceRoot) into the new worktree..."
Get-ChildItem -Path $envSourceRoot -Recurse -Filter '.env*' -File -Force |
  Where-Object { $_.Name -ne '.env.example' -and $_.FullName -notmatch '\\node_modules\\' } |
  ForEach-Object {
    $relativePath = $_.FullName.Substring($envSourceRoot.Length + 1)
    $destPath = Join-Path $worktreePath $relativePath
    $destDir = Split-Path -Parent $destPath
    if (-not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }
    Copy-Item -Path $_.FullName -Destination $destPath -Force
    Write-Host "  Copied $relativePath"
  }

# --- Verify Playwright MCP browser isolation -------------------------
# A git worktree isolates the REPO, not the Playwright MCP server's
# browser profile -- that persists at one fixed, machine-wide path by
# default, so two concurrent sessions' browser tool calls collide
# ("Browser is already in use") no matter how well the worktrees
# themselves are separated. The fix lives in .mcp.json (--isolated on
# the playwright server, tracked and inherited by every worktree
# automatically) -- this is just a sanity check that it's actually
# there, so a reverted/edited .mcp.json doesn't silently reintroduce the
# collision for whoever launches next.
$worktreeMcpConfigPath = Join-Path $worktreePath '.mcp.json'
$playwrightIsolated = $false
if (Test-Path $worktreeMcpConfigPath) {
  try {
    $mcpConfig = Get-Content $worktreeMcpConfigPath -Raw | ConvertFrom-Json
    $playwrightArgs = $mcpConfig.mcpServers.playwright.args
    if ($playwrightArgs -and ($playwrightArgs -contains '--isolated')) {
      $playwrightIsolated = $true
    }
  } catch {
    Write-Warning "Could not parse $worktreeMcpConfigPath to verify Playwright MCP isolation."
  }
}
if (-not $playwrightIsolated) {
  Write-Warning "Playwright MCP server in this worktree's .mcp.json is missing --isolated -- a second concurrent session's browser tool calls will collide with this one's. See CLAUDE.md's Concurrent sessions section."
}

Write-Host "Running npm ci in the new worktree (repo root, full monorepo install)..."
Push-Location $worktreePath
try {
  # Past this point the worktree and its .env files already exist, so a
  # failure here leaves something real on disk. Say what it is and how to
  # finish or undo it, rather than leaving a half-built worktree the next
  # person has to diagnose.
  Invoke-Native -FailureMessage (
    "npm ci failed in the new worktree -- see output above.`n" +
    "  The worktree at $worktreePath EXISTS and its .env files are copied.`n" +
    "  Finish it with:  cd '$worktreePath'; npm ci`n" +
    "  Or discard it:   git worktree remove '$worktreePath'; git branch -D $branchName"
  ) -Command {
    npm ci
  }
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
if ($playwrightIsolated) {
  Write-Host "  Playwright MCP: --isolated confirmed -- safe to run browser tool calls alongside other sessions."
} else {
  Write-Host "  Playwright MCP: --isolated NOT found -- see warning above before using browser tool calls."
}
if ($apiPort -and $webPort) {
  Write-Host "  Free dev ports -- API: $apiPort   WEB: $webPort"
  Write-Host "  e.g. (from the worktree's apps/api):  `$env:PORT=$apiPort; npm run dev"
  Write-Host "       (from the worktree's apps/web):   npx vite --port $webPort"
} else {
  Write-Warning 'Could not find a free port in the scanned range -- check manually before starting a dev server.'
}
Write-Host '=================================================='
