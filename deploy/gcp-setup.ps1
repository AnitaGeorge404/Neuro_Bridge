<#
  NeuroBridge — one-shot Google Cloud setup + first Cloud Run deploy (UK / London by default).
  Idempotent: safe to re-run. Runs deploy\preflight.ps1 first and stops if anything is missing.

  Usage:
    .\deploy\gcp-setup.ps1 -ProjectId <your-project-id>
  Options:
    -Region europe-west2           Where data is stored and the backend runs (London).
    -VertexLocation europe-west2   Where Gemini runs on Vertex AI. Use "global" only if the
                                   model isn't offered in London (data may then leave the UK).
    -IncludeGeminiApiKey           Also upload GEMINI_API_KEY (needed only for Gemini Live voice;
                                   that API has no UK processing guarantee). Off by default.
    -BudgetAmount 10               Monthly budget alert in your billing account's currency.
    -AllowEphemeralDb              Deploy without DATABASE_URL (demo only: data resets on restart).

  Creates only what NeuroBridge uses: APIs, a least-privilege service account, Firestore,
  a private Cloud Storage bucket, a BigQuery dataset, Secret Manager secrets (UK-replicated),
  a UK log bucket, Artifact Registry, the Cloud Run service, log-based metrics, an uptime check
  and a budget alert. No Vector Search, Document AI, Pub/Sub, Cloud Tasks or Scheduler.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "europe-west2",
  [string]$VertexLocation = "europe-west2",
  [string]$Service = "neurobridge-api",
  [string]$AllowedOrigins = "",
  [ValidateSet("off", "monitor", "enforce")][string]$AppCheckMode = "monitor",
  [switch]$IncludeGeminiApiKey,
  [double]$BudgetAmount = 10,
  [switch]$AllowEphemeralDb
)
$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Try-Run([scriptblock]$b) { try { & $b } catch { Write-Host "    (skipped: $($_.Exception.Message.Split("`n")[0]))" -ForegroundColor DarkGray } }

& (Join-Path $PSScriptRoot "preflight.ps1") -ProjectId $ProjectId -AllowEphemeralDb:$AllowEphemeralDb
if ($LASTEXITCODE -ne 0) { throw "Preflight failed. Fix the items marked FAIL above, then re-run." }

if (-not $AllowedOrigins) { $AllowedOrigins = "https://$ProjectId.web.app,https://$ProjectId.firebaseapp.com" }
$Sa = "$Service@$ProjectId.iam.gserviceaccount.com"
$Bucket = "$ProjectId-neurobridge-docs"
$Dataset = "neurobridge_analytics"
$Repo = "neurobridge"
$Image = "$Region-docker.pkg.dev/$ProjectId/$Repo/${Service}:latest"
$envFile = Join-Path $PSScriptRoot "..\.env"

Step "Project + APIs (only the ones NeuroBridge uses)"
gcloud config set project $ProjectId | Out-Null
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com `
  secretmanager.googleapis.com aiplatform.googleapis.com firestore.googleapis.com storage.googleapis.com `
  bigquery.googleapis.com logging.googleapis.com monitoring.googleapis.com iamcredentials.googleapis.com `
  firebase.googleapis.com identitytoolkit.googleapis.com firebaseappcheck.googleapis.com billingbudgets.googleapis.com

Step "Service account for the backend (narrow roles, never Owner/Editor)"
Try-Run { gcloud iam service-accounts create $Service --display-name "NeuroBridge API (Cloud Run)" 2>$null }
# aiplatform.user: call Gemini on Vertex | datastore.user: Firestore read/write | secretAccessor: read secrets
# logWriter/metricWriter: logs + metrics | bigquery.jobUser: run inserts (dataset write granted on the dataset only)
foreach ($role in "roles/aiplatform.user", "roles/datastore.user", "roles/secretmanager.secretAccessor",
                  "roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/bigquery.jobUser") {
  gcloud projects add-iam-policy-binding $ProjectId --member "serviceAccount:$Sa" --role $role --condition=None | Out-Null
}
# Lets the service sign short-lived download links for its own bucket (it can only sign as itself).
gcloud iam service-accounts add-iam-policy-binding $Sa --member "serviceAccount:$Sa" --role roles/iam.serviceAccountTokenCreator | Out-Null

Step "Firestore in $Region (location is permanent)"
Try-Run { gcloud firestore databases create --location=$Region --type=firestore-native 2>$null }

Step "Private Cloud Storage bucket in $Region"
Try-Run { gcloud storage buckets create "gs://$Bucket" --location=$Region --uniform-bucket-level-access --public-access-prevention 2>$null }
gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member "serviceAccount:$Sa" --role roles/storage.objectAdmin | Out-Null

Step "BigQuery dataset in $Region (events only: no user ids, no text)"
Try-Run { bq --location=$Region mk --dataset --default_table_expiration 31536000 "${ProjectId}:$Dataset" 2>$null }
Try-Run { bq mk --table --time_partitioning_field event_ts --time_partitioning_type DAY "${ProjectId}:$Dataset.product_events" `
  "event_name:STRING,event_ts:TIMESTAMP,module:STRING,status:STRING,latency_ms:INTEGER,tool:STRING,model:STRING,count:INTEGER,source:STRING" 2>$null }
Try-Run { bq add-iam-policy-binding --member="serviceAccount:$Sa" --role="roles/bigquery.dataEditor" "${ProjectId}:$Dataset" | Out-Null }

Step "Secret Manager (values read from .env, stored only in $Region, never printed)"
$envVals = @{}
Get-Content $envFile | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$' } | ForEach-Object {
  $null = $_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$'; $envVals[$Matches[1]] = $Matches[2].Trim('"')
}
$secretList = @("SUPABASE_ANON_KEY", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
if ($IncludeGeminiApiKey) { $secretList += "GEMINI_API_KEY" }
$secretNames = @()
foreach ($name in $secretList) {
  if (-not $envVals[$name]) { continue }
  Try-Run { gcloud secrets create $name --replication-policy=user-managed --locations=$Region 2>$null }
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp, $envVals[$name])
  gcloud secrets versions add $name --data-file=$tmp | Out-Null
  Remove-Item $tmp
  $secretNames += $name
  Write-Host "    stored $name"
}

Step "Keep application logs in $Region (30-day retention)"
Try-Run { gcloud logging buckets create neurobridge-uk --location=$Region --retention-days=30 2>$null }
Try-Run { gcloud logging sinks update _Default "logging.googleapis.com/projects/$ProjectId/locations/$Region/buckets/neurobridge-uk" --quiet | Out-Null }

Step "Build the container in $Region"
Try-Run { gcloud artifacts repositories create $Repo --repository-format=docker --location=$Region 2>$null }
# Keep the 5 newest images, delete anything older than 30 days (stops storage costs creeping up).
$policy = New-TemporaryFile
'[{"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":5}},{"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"30d"}}]' | Set-Content -Encoding ascii $policy
Try-Run { gcloud artifacts repositories set-cleanup-policies $Repo --location=$Region --policy=$policy --no-dry-run | Out-Null }
Remove-Item $policy
gcloud builds submit --region $Region --tag $Image (Join-Path $PSScriptRoot "..")

Step "Deploy to Cloud Run in $Region"
$vars = @(
  "GOOGLE_CLOUD_PROJECT=$ProjectId", "FIREBASE_PROJECT_ID=$ProjectId",
  "GOOGLE_GENAI_USE_VERTEXAI=true", "VERTEX_AI_LOCATION=$VertexLocation",
  "GCS_BUCKET=$Bucket", "BIGQUERY_DATASET=$Dataset", "FIREBASE_APP_CHECK_MODE=$AppCheckMode",
  "SUPABASE_URL=$($envVals['SUPABASE_URL'])", "GCP_SECRET_NAMES=$($secretNames -join ',')",
  "CORS_ALLOWED_ORIGINS=$AllowedOrigins",
  "AGENT_REAL_RATE_LIMIT_PER_HOUR=60", "AI_PROXY_RATE_LIMIT_PER_HOUR=60", "DOCUMENT_AI_RATE_LIMIT_PER_HOUR=10",
  "AGENT_MAX_STEPS=4"
) -join "@@"
# max-instances caps runaway scaling cost; min 0 = no charge when idle.
gcloud run deploy $Service --image $Image --region $Region --service-account $Sa `
  --allow-unauthenticated --min-instances 0 --max-instances 3 --concurrency 40 --memory 1Gi --cpu 1 --timeout 120 `
  --set-env-vars "^@@^$vars"
$Url = gcloud run services describe $Service --region $Region --format "value(status.url)"

Step "Monitoring: metrics from logs + uptime check"
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

Step "Budget alert (an ALERT, not a spending cap)"
$billing = (gcloud billing projects describe $ProjectId --format "value(billingAccountName)") -replace "billingAccounts/", ""
Try-Run { gcloud billing budgets create --billing-account=$billing --display-name="NeuroBridge monthly" `
  --budget-amount=$BudgetAmount --filter-projects="projects/$ProjectId" `
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 | Out-Null; Write-Host "    budget created" }

Step "Save non-secret settings into .env (for local dev + the verifier)"
$cfg = [ordered]@{ GOOGLE_CLOUD_PROJECT = $ProjectId; FIREBASE_PROJECT_ID = $ProjectId; GCS_BUCKET = $Bucket;
                   BIGQUERY_DATASET = $Dataset; VERTEX_AI_LOCATION = $VertexLocation; CLOUD_RUN_URL = $Url }
$existing = Get-Content $envFile
foreach ($k in $cfg.Keys) {
  if (-not ($existing | Where-Object { $_ -match "^\s*$k\s*=" })) { Add-Content $envFile "$k=$($cfg[$k])"; Write-Host "    added $k" }
}

Step "Verify"
Invoke-RestMethod "$Url/api/health" | ConvertTo-Json -Depth 4
Write-Host "`nBackend URL: $Url" -ForegroundColor Green
Write-Host "Next: guide step D4 (Firebase), then:  .\deploy\verify.ps1" -ForegroundColor Green
