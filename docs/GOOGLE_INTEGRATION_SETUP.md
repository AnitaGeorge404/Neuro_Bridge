# NEUROBRIDGE — GOOGLE CLOUD INTEGRATION SETUP GUIDE

> **Authoritative Deployment & Setup Guide**  
> **Target Region:** `europe-west2` (London, UK) by default  
> **Compliance:** UK GDPR / Data Protection Act 2018 Data Minimization

---

## 1. Quick Start (Automated One-Click Script)

NeuroBridge includes an automated PowerShell script in `deploy/gcp-setup.ps1` that idempotently provisions and configures all Google Cloud resources required by the application.

### Prerequisites
1. Install [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install).
2. Authenticate locally:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```
3. Set your active Google Cloud Project ID:
   ```powershell
   .\deploy\gcp-setup.ps1 -ProjectId "<YOUR_GCP_PROJECT_ID>"
   ```

The script will automatically:
- Enable all required APIs (Cloud Run, Secret Manager, Firestore, Storage, BigQuery, Logging, Monitoring).
- Create a dedicated least-privilege service account (`neurobridge-api@...`).
- Provision Firestore in Native mode (`europe-west2`).
- Create a private Cloud Storage bucket with uniform access control.
- Create a BigQuery partitioned analytics dataset (`neurobridge_analytics.product_events`).
- Upload environment secrets (`DATABASE_URL`, `SUPABASE_ANON_KEY`) into Secret Manager.
- Configure Cloud Logging retention and log-based metrics.
- Deploy the containerized backend to Cloud Run.

---

## 2. Manual Setup Reference (Service-by-Service)

### 01. Gemini API (Bri Intelligence)
- **Local Dev:** Provide your API key in `.env`:
  ```env
  GEMINI_API_KEY=your_key_here
  GEMINI_MODEL_NAME=gemini-3.5-flash-lite
  GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.8-flash
  ```
- **Verification:** Run `backend\venv\Scripts\python.exe -m backend.scripts.verify_google`.

### 02. Firebase Authentication
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project -> **Authentication** -> **Sign-in method** -> Enable **Google**.
3. Under Project Settings -> General -> **Your apps**, register a Web App.
4. Copy the web config keys to your frontend `.env`:
   ```env
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_APP_ID=...
   ```
5. On the backend, set:
   ```env
   FIREBASE_PROJECT_ID=your_project_id
   ```

### 03. Cloud Firestore
1. In Firebase Console or GCP Console, open **Firestore Database**.
2. Select **Create database** -> Choose **Native mode**.
3. Set location to **europe-west2 (London)**.
4. Rules are preconfigured in `firestore.rules`.

### 04. Firebase App Check
1. In Firebase Console, go to **App Check**.
2. Register your web app using **reCAPTCHA Enterprise**.
3. Copy the site key to `.env`:
   ```env
   VITE_FIREBASE_APPCHECK_SITE_KEY=...
   ```
4. Set backend enforcement mode in `.env`:
   ```env
   FIREBASE_APP_CHECK_MODE=monitor   # options: off, monitor, enforce
   ```

### 05. Firebase Analytics
1. In Firebase Console, enable **Google Analytics**.
2. Add your measurement ID to `.env`:
   ```env
   VITE_FIREBASE_MEASUREMENT_ID=G-...
   VITE_FIREBASE_ANALYTICS=true      # Consent flag
   ```

### 06. Google Cloud Storage
1. Create a private bucket in London:
   ```bash
   gcloud storage buckets create gs://<PROJECT_ID>-neurobridge-docs --location=europe-west2 --uniform-bucket-level-access --public-access-prevention
   ```
2. Add the bucket name to `.env`:
   ```env
   GCS_BUCKET=<PROJECT_ID>-neurobridge-docs
   ```

### 07. Vertex AI (Gemini on Vertex)
1. On Cloud Run, enable Vertex AI by setting:
   ```env
   GOOGLE_GENAI_USE_VERTEXAI=true
   VERTEX_AI_PROJECT=<YOUR_PROJECT_ID>
   VERTEX_AI_LOCATION=europe-west2
   ```
2. The Cloud Run service account authenticates automatically without an API key.

### 08. Vertex AI Embeddings
- Operates automatically through the central AI service using `gemini-embedding-001`.
- Configurable via:
  ```env
  GEMINI_EMBEDDING_MODEL=gemini-embedding-001
  ```

### 09. Vertex AI Vector Search
- **Default Mode:** `LocalExactVectorSearch` is enabled by default. It runs zero-cost, exact cosine scans bounded to the user's database records.
- **Enterprise Cloud Mode (Optional):**
  1. Create a Matching Engine Index:
     ```bash
     gcloud ai indexes create --display-name="neurobridge-index" --metadata-file=index_metadata.json --location=europe-west2
     ```
  2. Deploy to an Index Endpoint:
     ```bash
     gcloud ai index-endpoints create --display-name="neurobridge-endpoint" --location=europe-west2
     ```
  3. Set environment variables:
     ```env
     VERTEX_VECTOR_SEARCH_ENABLED=true
     VERTEX_VECTOR_SEARCH_INDEX_ID=your_index_id
     VERTEX_VECTOR_SEARCH_ENDPOINT_ID=your_endpoint_id
     ```

### 10. Cloud Run
Deploy the container with conservative resources:
```bash
gcloud run deploy neurobridge-api \
  --image europe-west2-docker.pkg.dev/<PROJECT_ID>/neurobridge/neurobridge-api:latest \
  --region europe-west2 \
  --platform managed \
  --allow-unauthenticated \
  --service-account neurobridge-api@<PROJECT_ID>.iam.gserviceaccount.com \
  --min-instances 0 \
  --max-instances 3 \
  --concurrency 40 \
  --cpu 1 \
  --memory 512Mi
```

### 11. Secret Manager
Store sensitive database connections and tokens:
```bash
gcloud secrets create DATABASE_URL --replication-policy=user-managed --locations=europe-west2
echo -n "your_database_url" | gcloud secrets versions add DATABASE_URL --data-file=-
```
Specify secret names in `.env`:
```env
GCP_SECRET_NAMES=DATABASE_URL,SUPABASE_ANON_KEY
```

### 12. Cloud Logging
Structured JSON logging is enabled automatically when running in Cloud Run or with:
```env
LOG_FORMAT=json
LOG_LEVEL=INFO
```

### 13. Cloud Monitoring
Log-based metrics and uptime checks are configured automatically by `deploy/gcp-setup.ps1`.
Check health at `/api/health`.

### 14. BigQuery
Create dataset and partitioned table:
```bash
bq --location=europe-west2 mk --dataset --default_table_expiration 31536000 <PROJECT_ID>:neurobridge_analytics
bq mk --table --time_partitioning_field event_ts --time_partitioning_type DAY \
  <PROJECT_ID>:neurobridge_analytics.product_events \
  "event_name:STRING,event_ts:TIMESTAMP,module:STRING,status:STRING,latency_ms:INTEGER,tool:STRING,model:STRING,count:INTEGER,source:STRING"
```
Configure in `.env`:
```env
BIGQUERY_DATASET=neurobridge_analytics
BIGQUERY_EVENTS_TABLE=product_events
```

---

## 3. Cost & Safety Controls

| Service | Free Tier Allowance | NeuroBridge Configuration | Estimated Cost |
|---|---|---|---|
| **Cloud Run** | 2M requests/mo | Min 0, Max 3 instances | **$0.00 / month** (within free tier) |
| **Firestore** | 50K reads, 20K writes/day | Only adaptive profile sync | **$0.00 / month** |
| **Cloud Storage** | 5 GB storage | PDFs / Syllabi only | **$0.00 / month** |
| **BigQuery** | 10 GB storage, 1 TB queries/mo | 365-day partitioned event table | **$0.00 / month** |
| **Secret Manager** | 6 active secret versions | 3-4 secrets stored | **$0.00 / month** |
| **Cloud Logging** | 50 GB log ingestion/mo | 30-day retention UK bucket | **$0.00 / month** |
| **Gemini API** | Free tier on AI Studio | Rate-limited + cached clients | **$0.00 / month** |
| **Vector Search** | N/A (Endpoint is paid) | Default: LocalExact (zero-cost) | **$0.00 / month** |
