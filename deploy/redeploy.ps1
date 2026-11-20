<#
  Ship new backend code after the first setup. Keeps every setting, secret and the service account.
  Usage: .\deploy\redeploy.ps1 -ProjectId <your-project-id> [-Region europe-west2]
  Frontend: npm run build ; firebase deploy --only hosting --project <your-project-id>
#>
param([Parameter(Mandatory = $true)][string]$ProjectId, [string]$Region = "europe-west2", [string]$Service = "neurobridge-api")
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$py = Join-Path $root "backend\venv\Scripts\python.exe"
Write-Host "==> Running backend tests first" -ForegroundColor Cyan
& $py -m pytest (Join-Path $root "backend\tests") -q -p no:cacheprovider
if ($LASTEXITCODE -ne 0) { throw "Tests failed. Not deploying." }
$Image = "$Region-docker.pkg.dev/$ProjectId/neurobridge/${Service}:$(Get-Date -Format yyyyMMdd-HHmmss)"
gcloud builds submit --project $ProjectId --region $Region --tag $Image $root
gcloud run deploy $Service --project $ProjectId --region $Region --image $Image
$Url = gcloud run services describe $Service --project $ProjectId --region $Region --format "value(status.url)"
Invoke-RestMethod "$Url/api/health" | ConvertTo-Json
