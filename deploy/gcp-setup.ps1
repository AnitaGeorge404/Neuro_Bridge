<#
  NeuroBridge — one-shot Google Cloud provisioning + Cloud Run deploy (idempotent; safe to re-run).

  Prereqs: Google Cloud SDK (gcloud + bq) installed, `gcloud auth login`, a project with billing enabled.
  Usage:   .\deploy\gcp-setup.ps1 -ProjectId my-project [-Region us-central1] [-AllowedOrigins https://my-project.web.app]

  Creates (all low/zero idle cost): APIs, a least-privilege service account, Firestore (native),
  a private Cloud Storage bucket, a BigQuery dataset/table, Secret Manager secrets (from .env),
  an Artifact Registry repo, the Cloud Run service, Cloud Logging log-based metrics and a
  Cloud Monitoring uptime check. No Vertex AI Vector Search index (paid, always-on) is created.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "us-central1",
  [string]$Service = "neurobridge-api",
  [string]$AllowedOrigins = "",
  [ValidateSet("off", "monitor", "enforce")][string]$AppCheckMode = "monitor"
)
$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Try-Run([scriptblock]$b) { try { & $b } catch { Write-Host "    (skipped: $($_.Exception.Message.Split("`n")[0]))" -ForegroundColor DarkGray } }

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw "gcloud not found. Install https://cloud.google.com/sdk/docs/install then run: gcloud auth login" }
if (-not $AllowedOrigins) { $AllowedOrigins = "https://$ProjectId.web.app,https://$ProjectId.firebaseapp.com" }

$Sa = "$Service@$ProjectId.iam.gserviceaccount.com"
$Bucket = "$ProjectId-neurobridge-docs"
$Dataset = "neurobridge_analytics"
$Repo = "neurobridge"
$Image = "$Region-docker.pkg.dev/$ProjectId/$Repo/${Service}:latest"

Step "Project + APIs"
gcloud config set project $ProjectId | Out-Null
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com `
  secretmanager.googleapis.com aiplatform.googleapis.com firestore.googleapis.com storage.googleapis.com `
  bigquery.googleapis.com logging.googleapis.com monitoring.googleapis.com iamcredentials.googleapis.com `
  firebase.googleapis.com identitytoolkit.googleapis.com firebaseappcheck.googleapis.com

Step "Service account (least privilege)"
Try-Run { gcloud iam service-accounts create $Service --display-name "NeuroBridge API (Cloud Run)" 2>$null }
foreach ($role in "roles/aiplatform.user", "roles/datastore.user", "roles/secretmanager.secretAccessor",
                  "roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/bigquery.jobUser") {
  gcloud projects add-iam-policy-binding $ProjectId --member "serviceAccount:$Sa" --role $role --condition=None | Out-Null
}
# Lets the service sign V4 download URLs for its own bucket objects via IAM Credentials.
gcloud iam service-accounts add-iam-policy-binding $Sa --member "serviceAccount:$Sa" --role roles/iam.serviceAccountTokenCreator | Out-Null

Step "Firestore (native mode)"
Try-Run { gcloud firestore databases create --location=$Region --type=firestore-native 2>$null }

Step "Cloud Storage bucket (private, user-scoped prefixes)"
Try-Run { gcloud storage buckets create "gs://$Bucket" --location=$Region --uniform-bucket-level-access --public-access-prevention 2>$null }
gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member "serviceAccount:$Sa" --role roles/storage.objectAdmin | Out-Null

Step "BigQuery dataset + events table (no user identifiers)"
Try-Run { bq --location=US mk --dataset "${ProjectId}:$Dataset" 2>$null }
Try-Run { bq mk --table --time_partitioning_field event_ts --time_partitioning_type DAY "${ProjectId}:$Dataset.product_events" `
  "event_name:STRING,event_ts:TIMESTAMP,module:STRING,status:STRING,latency_ms:INTEGER,tool:STRING,model:STRING,count:INTEGER,source:STRING" 2>$null }
Try-Run { bq add-iam-policy-binding --member="serviceAccount:$Sa" --role="roles/bigquery.dataEditor" "${ProjectId}:$Dataset" | Out-Null }

Step "Secret Manager (values read from .env; never printed)"
$envFile = Join-Path $PSScriptRoot "..\.env"
$secretNames = @()
$envVals = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$' } | ForEach-Object {
    $null = $_ -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$'; $envVals[$Matches[1]] = $Matches[2].Trim('"')
  }
}
foreach ($name in "GEMINI_API_KEY", "SUPABASE_ANON_KEY", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") {
  if (-not $envVals[$name]) { continue }
  Try-Run { gcloud secrets create $name --replication-policy=automatic 2>$null }
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp, $envVals[$name])
  gcloud secrets versions add $name --data-file=$tmp | Out-Null
  Remove-Item $tmp
  $secretNames += $name
  Write-Host "    stored $name"
}

Step "Artifact Registry + build image (Cloud Build)"
Try-Run { gcloud artifacts repositories create $Repo --repository-format=docker --location=$Region 2>$null }
gcloud builds submit --tag $Image (Join-Path $PSScriptRoot "..")

Step "Deploy to Cloud Run"
$envVars = @(
  "GOOGLE_CLOUD_PROJECT=$ProjectId", "FIREBASE_PROJECT_ID=$ProjectId",
  "GOOGLE_GENAI_USE_VERTEXAI=true", "VERTEX_AI_LOCATION=$Region",
  "GCS_BUCKET=$Bucket", "BIGQUERY_DATASET=$Dataset",
  "FIREBASE_APP_CHECK_MODE=$AppCheckMode", "SUPABASE_URL=$($envVals['SUPABASE_URL'])"
) -join "@@"
$envVars += "@@GCP_SECRET_NAMES=" + ($secretNames -join ",") + "@@CORS_ALLOWED_ORIGINS=$AllowedOrigins"
gcloud run deploy $Service --image $Image --region $Region --service-account $Sa `
  --allow-unauthenticated --min-instances 0 --max-instances 3 --memory 1Gi --cpu 1 --timeout 120 `
  --set-env-vars "^@@^$envVars"
$Url = gcloud run services describe $Service --region $Region --format "value(status.url)"

Step "Cloud Monitoring: log-based metrics + uptime check"
$metricCfg = New-TemporaryFile
@"
filter: resource.type="cloud_run_revision" AND jsonPayload.nb_event="ai_call"
description: Latency of Gemini / Vertex AI calls (ms)
valueExtractor: EXTRACT(jsonPayload.latency_ms)
metricDescriptor: {metricKind: DELTA, valueType: DISTRIBUTION, unit: ms, labels: [{key: status}, {key: tool}]}
labelExtractors: {status: EXTRACT(jsonPayload.status), tool: EXTRACT(jsonPayload.tool)}
bucketOptions: {exponentialBuckets: {numFiniteBuckets: 32, growthFactor: 1.4, scale: 10}}
"@ | Set-Content -Encoding utf8 $metricCfg
Try-Run { gcloud logging metrics create nb_ai_call_latency --config-from-file=$metricCfg 2>$null }
Remove-Item $metricCfg
Try-Run { gcloud logging metrics create nb_ai_call_errors --description "Failed Gemini/Vertex calls" `
  --log-filter 'resource.type="cloud_run_revision" AND jsonPayload.nb_event="ai_call" AND jsonPayload.status!="ok"' 2>$null }
Try-Run { gcloud logging metrics create nb_documents_analyzed --description "Syllabi analyzed" `
  --log-filter 'resource.type="cloud_run_revision" AND jsonPayload.nb_event="document_analyzed"' 2>$null }
Try-Run { gcloud monitoring uptime create neurobridge-health --resource-type=uptime-url `
  --resource-labels="host=$(([Uri]$Url).Host),project_id=$ProjectId" --path=/api/health --protocol=https --period=5 2>$null }

Step "Write non-secret Google config into .env (for local dev + verifier)"
$cfg = [ordered]@{ GOOGLE_CLOUD_PROJECT = $ProjectId; FIREBASE_PROJECT_ID = $ProjectId; GCS_BUCKET = $Bucket;
                   BIGQUERY_DATASET = $Dataset; VERTEX_AI_LOCATION = $Region; CLOUD_RUN_URL = $Url }
$existing = if (Test-Path $envFile) { Get-Content $envFile } else { @() }
foreach ($k in $cfg.Keys) {
  if (-not ($existing | Where-Object { $_ -match "^\s*$k\s*=" })) { Add-Content $envFile "$k=$($cfg[$k])"; Write-Host "    added $k" }
}

Step "Verify"
Invoke-RestMethod "$Url/api/health" | ConvertTo-Json -Depth 4
Invoke-RestMethod "$Url/api/google/status" | ConvertTo-Json -Depth 5
Write-Host "`nCloud Run URL: $Url" -ForegroundColor Green
Write-Host "Next: firebase deploy --only hosting,firestore:rules,storage --project $ProjectId  (after npm run build)"
