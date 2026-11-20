<#
  Adds Firebase to your Google Cloud project, creates the NeuroBridge web app,
  and writes its PUBLIC web config (VITE_FIREBASE_*) into .env. No secrets involved.

  Prereq: npm install -g firebase-tools ; firebase login
  Usage:  .\deploy\firebase-setup.ps1 -ProjectId my-project
#>
param([Parameter(Mandatory = $true)][string]$ProjectId)
$ErrorActionPreference = "Stop"
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) { throw "Run: npm install -g firebase-tools ; firebase login" }

Write-Host "==> Adding Firebase to $ProjectId (ok if already added)" -ForegroundColor Cyan
try { firebase projects:addfirebase $ProjectId 2>$null | Out-Null } catch {}

Write-Host "==> Web app" -ForegroundColor Cyan
$apps = firebase apps:list WEB --project $ProjectId --json | ConvertFrom-Json
$app = $apps.result | Where-Object { $_.displayName -eq "NeuroBridge Web" } | Select-Object -First 1
if (-not $app) {
  firebase apps:create WEB "NeuroBridge Web" --project $ProjectId | Out-Null
  $apps = firebase apps:list WEB --project $ProjectId --json | ConvertFrom-Json
  $app = $apps.result | Where-Object { $_.displayName -eq "NeuroBridge Web" } | Select-Object -First 1
}
$sdk = (firebase apps:sdkconfig WEB $app.appId --project $ProjectId --json | ConvertFrom-Json).result.sdkConfig

$envFile = Join-Path $PSScriptRoot "..\.env"
$values = [ordered]@{
  VITE_FIREBASE_API_KEY = $sdk.apiKey; VITE_FIREBASE_AUTH_DOMAIN = $sdk.authDomain
  VITE_FIREBASE_PROJECT_ID = $sdk.projectId; VITE_FIREBASE_STORAGE_BUCKET = $sdk.storageBucket
  VITE_FIREBASE_APP_ID = $sdk.appId; VITE_FIREBASE_MEASUREMENT_ID = $sdk.measurementId
}
$existing = if (Test-Path $envFile) { Get-Content $envFile } else { @() }
foreach ($k in $values.Keys) {
  if (-not $values[$k]) { continue }
  if ($existing | Where-Object { $_ -match "^\s*$k\s*=" }) { Write-Host "    $k already set (left unchanged)"; continue }
  Add-Content $envFile "$k=$($values[$k])"; Write-Host "    added $k"
}
Write-Host "`nDone. Now enable the Google sign-in provider (see docs/USER_ACTION_REQUIRED.md, step 4)." -ForegroundColor Green
