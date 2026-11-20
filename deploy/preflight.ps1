<#
  Checks everything that must be true BEFORE deploying. Changes nothing. Never prints secret values.
  Usage: .\deploy\preflight.ps1 -ProjectId <your-project-id>
#>
param([Parameter(Mandatory = $true)][string]$ProjectId, [switch]$AllowEphemeralDb)
$fail = 0
function Ok($m) { Write-Host "PASS  $m" -ForegroundColor Green }
function Bad($m, $fix) { Write-Host "FAIL  $m`n      Fix: $fix" -ForegroundColor Red; $script:fail++ }
function Warn($m) { Write-Host "WARN  $m" -ForegroundColor Yellow }

$root = Join-Path $PSScriptRoot ".."
$envFile = Join-Path $root ".env"

if (Get-Command gcloud -ErrorAction SilentlyContinue) { Ok "Google Cloud CLI installed" }
else { Bad "Google Cloud CLI not installed" "Guide step B3" }

if (Get-Command gcloud -ErrorAction SilentlyContinue) {
$acct = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null
if ($acct) { Ok "Signed in to gcloud" } else { Bad "Not signed in to gcloud" "Run: gcloud auth login" }

$proj = gcloud projects describe $ProjectId --format="value(projectId)" 2>$null
if ($proj -eq $ProjectId) { Ok "Project $ProjectId exists and you can access it" }
else { Bad "Project $ProjectId not found or no access" "Check the Project ID (guide step B2)" }

$billingOn = gcloud billing projects describe $ProjectId --format="value(billingEnabled)" 2>$null
if ($billingOn -eq "True") { Ok "Billing is linked" } else { Bad "Billing not linked to $ProjectId" "Guide step B2, part 3" }
}

if (-not (Test-Path $envFile)) { Bad ".env file missing" "Copy .env.example to .env" }
else {
  $names = (Get-Content $envFile | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*\S' } | ForEach-Object { ($_ -split '=')[0].Trim() })
  foreach ($n in "SUPABASE_URL", "SUPABASE_ANON_KEY") {
    if ($names -contains $n) { Ok "$n is set in .env" } else { Bad "$n missing in .env" "Guide step D1" }
  }
  if ($names -contains "DATABASE_URL") { Ok "DATABASE_URL is set (permanent database)" }
  elseif ($AllowEphemeralDb) { Warn "No DATABASE_URL: cloud data will reset on every restart (demo only)" }
  else { Bad "DATABASE_URL missing: Cloud Run would use a temporary database" "Guide step D1" }
}

$tracked = git -C $root ls-files .env 2>$null
if ($tracked) { Bad ".env is tracked by git (secrets would be committed)" "Run: git rm --cached .env" } else { Ok ".env is not committed to git" }

foreach ($scope in "User", "Machine") {
  if ([Environment]::GetEnvironmentVariable("GEMINI_API_KEY", $scope)) {
    Bad "An old GEMINI_API_KEY is saved in Windows ($scope) and overrides .env" "Guide step B1"
  }
}

if ($fail -eq 0) { Write-Host "`nPreflight passed." -ForegroundColor Green; exit 0 }
Write-Host "`n$fail problem(s) found. Nothing was changed." -ForegroundColor Red; exit 1
