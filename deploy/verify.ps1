<#
  After deploying: live-checks every Google integration (PASS / FAIL / SKIP). Never prints secrets.
  Usage: .\deploy\verify.ps1
#>
$root = Join-Path $PSScriptRoot ".."
Push-Location $root
try { & (Join-Path $root "backend\venv\Scripts\python.exe") -W ignore -m backend.scripts.verify_google }
finally { Pop-Location }
