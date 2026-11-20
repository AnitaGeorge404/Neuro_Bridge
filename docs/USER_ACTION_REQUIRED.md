# What You Need To Do (and nothing more)

Everything else is already coded. These steps need your Google account, so only you can do them.
**Never paste keys into Claude chat.** Keys go into the `.env` file on your computer only.

**How to check your progress at any time** (safe to share the output, it never shows secrets):
```powershell
backend\venv\Scripts\python.exe -m backend.scripts.verify_google
```
Today: `0/12 live checks passed` (4 FAIL because of the bad Gemini key, 8 SKIP waiting on setup).

| # | Action | Priority | Time | Status |
|---|---|---|---|---|
| 1 | Get a working Gemini API key | 🔴 DO NOW | 5 min | ⬜ To do |
| 2 | Create a Google Cloud project + billing | 🟡 NEXT | 10 min | ⬜ To do |
| 3 | Install Google Cloud tools + log in, run one setup script | 🟡 NEXT | 20 min | ⬜ To do |
| 4 | Turn on Firebase + Google Sign-In | 🟡 NEXT | 10 min | ⬜ To do |
| 5 | Put the website online (Firebase Hosting) | 🟡 NEXT | 5 min | ⬜ To do |
| 6 | Turn on App Check (bot protection) | 🟢 LATER | 10 min | ⬜ To do |
| 7 | Retry `npm install` if it fails on network | 🟢 LATER | 5 min | ⬜ To do |

---

## 🔴 1. Get a working Gemini API key — START HERE

- **Why:** the key in `.env` is rejected by Google (`API key not valid`). Without it, Bri's AI, syllabus reading, task breakdowns and smart search all fall back to canned answers. Fixing it unlocks **4 integrations at once**, on your own laptop, with no project or billing.
- **Link:** https://aistudio.google.com/apikey
- **Steps:**
  1. Open the link and sign in with your Google account.
  2. Click **Create API key**.
  3. If it asks for a project, pick **Create API key in new project**.
  4. Click the **copy** icon next to the new key.
  5. In VS Code, open `D:\Projects\Neuro_Bridge\.env`.
  6. Find the line `GEMINI_API_KEY=...` and replace everything after `=` with your key. Save.
- **Variable:** `GEMINI_API_KEY`
- **Success looks like:** run the check command above. The 4 Gemini lines say **PASS**.
- **Tell me:** "Step 1 done" plus the check output.

---

## 🟡 2. Create a Google Cloud project + turn on billing

- **Why:** Cloud Run, Firestore, Storage, BigQuery, Vertex AI, Secret Manager and Monitoring all live inside a project, and Google requires a billing account to turn them on. With the settings I chose (scale-to-zero, no always-on services), a demo should cost close to $0. New accounts usually also get free trial credit.
- **Links:** https://console.cloud.google.com/projectcreate then https://console.cloud.google.com/billing
- **Steps:**
  1. Open the first link. Project name: `neurobridge` (any name works). Click **Create**.
  2. Write down the **Project ID** shown under the name (for example `neurobridge-123456`). You'll use it below as `<PROJECT_ID>`.
  3. Open the billing link. Click **Link a billing account**, or **Create account** and add a card, then link it to the project.
  4. Optional but recommended: Billing → **Budgets & alerts** → **Create budget** → $10, so you get an email if anything costs money.
- **Success looks like:** the billing page shows your project as **Linked**.
- **Tell me:** "Step 2 done, project ID is `<PROJECT_ID>`". The project ID is not a secret.

## 🟡 3. Install Google Cloud tools and run the setup script (does ~90% of the setup)

- **Why:** one script creates and connects everything: the services, the database, file storage, analytics table, secrets vault, monitoring, and deploys the backend to Cloud Run. It also writes the non-secret settings into `.env` for you.
- **Link:** https://cloud.google.com/sdk/docs/install (Windows: download **Google Cloud CLI installer**)
- **Steps:**
  1. Run the installer and keep the defaults. When it finishes, close PowerShell and open a new one.
  2. Run these commands, one at a time. Each `login` opens a browser, so pick your account and click **Allow**:
     ```powershell
     gcloud auth login
     ```
     ```powershell
     gcloud auth application-default login
     ```
  3. Optional, so your data survives restarts: Supabase dashboard → your project → **Connect** (or Project Settings → Database) → copy the **URI** connection string → add `DATABASE_URL=<that string>` to `.env`. If you skip this, the cloud backend uses a temporary database that resets.
  4. From `D:\Projects\Neuro_Bridge`, run:
     ```powershell
     .\deploy\gcp-setup.ps1 -ProjectId <PROJECT_ID>
     ```
     It takes about 10 minutes. Your keys go from `.env` straight into Google Secret Manager and are never printed.
- **Variables set for you:** `GOOGLE_CLOUD_PROJECT`, `FIREBASE_PROJECT_ID`, `GCS_BUCKET`, `BIGQUERY_DATASET`, `VERTEX_AI_LOCATION`, `CLOUD_RUN_URL`
- **Success looks like:** the script ends with `Cloud Run URL: https://...` and prints `"status": "healthy"`. The check command shows Vertex AI, Firestore, Cloud Storage, Secret Manager, BigQuery and Cloud Run as **PASS**.
- **If it stops with an error:** copy only the red error line to me. It contains no secrets.
- **Tell me:** "Step 3 done" plus the check output.

## 🟡 4. Turn on Firebase + Google Sign-In

- **Why:** this adds the **Continue with Google** button and app usage analytics.
- **Part A, automatic** (adds Firebase and writes the web settings into `.env`):
  ```powershell
  npm install -g firebase-tools
  ```
  ```powershell
  firebase login
  ```
  ```powershell
  .\deploy\firebase-setup.ps1 -ProjectId <PROJECT_ID>
  ```
- **Part B, 2 clicks Google doesn't allow scripting:**
  1. Open https://console.firebase.google.com/ → your project → **Build → Authentication** → **Get started**.
  2. **Sign-in method** tab → **Google** → turn **Enable** on → choose your support email → **Save**.
  3. **Settings** tab → **Authorized domains**. `localhost` and `<PROJECT_ID>.web.app` should already be listed. If you use another domain (for example Vercel), click **Add domain** and enter it.
- **Variables set for you:** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`. These are public identifiers, not secrets.
- **Success looks like:** `npm run dev` → open http://localhost:8080/login → **Continue with Google** appears and signs you in.
- **Tell me:** "Step 4 done".

## 🟡 5. Put the website online

```powershell
npm run build
```
```powershell
firebase deploy --only hosting,firestore:rules,storage --project <PROJECT_ID>
```
- **Success looks like:** it prints `Hosting URL: https://<PROJECT_ID>.web.app`, and signing in plus uploading a syllabus works there.
- **Tell me:** "Step 5 done".

---

## 🟢 6. App Check (bot protection). Later, before sharing the link publicly.

1. https://console.cloud.google.com/security/recaptcha → **Create key** → type **Website** → domains `<PROJECT_ID>.web.app` and `localhost` → **Create**. Copy the **key ID**.
2. Add `VITE_FIREBASE_APPCHECK_SITE_KEY=<key ID>` to `.env`.
3. Firebase console → **Build → App Check** → **Apps** → your web app → **reCAPTCHA Enterprise** → paste the same key ID → **Save**.
4. Repeat step 5 (build + deploy). Once `https://<CLOUD_RUN_URL>/api/google/status` shows `app_check.verified` above 0, tell me and I'll switch enforcement on.

## 🟢 7. `npm install` network failure

Your last frontend install stopped with `ECONNRESET`, a network drop. If `node_modules` is still missing, run `npm install` again on a stable connection.

---
*I update this file whenever I find a new blocker. Tell me which step you finished and I'll mark it ✅ and verify it.*
