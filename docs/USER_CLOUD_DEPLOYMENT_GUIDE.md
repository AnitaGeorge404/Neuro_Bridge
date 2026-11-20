# NeuroBridge — Your Cloud Deployment Guide (UK)

This guide lists **only the things that need you**: your Google account, your billing, or a decision that is yours to make. Scripts in `deploy\` do everything else.

**Safety rules for every step**
- Never paste keys, passwords or connection strings into Claude, chat, screenshots, Git or docs. Put them only in the `.env` file on your computer.
- When I ask for "the output", I mean output from `preflight.ps1` or `verify.ps1`. Those scripts never print secret values.
- Run every command in **PowerShell**, from the folder `D:\Projects\Neuro_Bridge`.

---

## Your checklist

Tick these off in order. **Your first action is B1.**

### 🔴 BLOCKING (do these first)
- [ ] [B1 — Remove the old Gemini key saved in Windows](#b1) (3 min). **This is currently stopping Gemini from working on your laptop.**
- [ ] [B2 — Create the Google Cloud project and link billing](#b2) (10 min)
- [ ] [B3 — Install the Google Cloud command-line tool and sign in](#b3) (15 min)

### 🟡 REQUIRED FOR DEPLOYMENT
- [ ] [D1 — Get a permanent database ready (Supabase, London)](#d1) (10–20 min)
- [ ] [D2 — Run the setup script, which builds everything in London](#d2) (15 min, mostly waiting)
- [ ] [D3 — Choose how people sign in](#d3) (decision, 2 min)
- [ ] [D4 — Turn on Firebase and Google Sign-In](#d4) (10 min, skip it if D3 = email only)
- [ ] [D5 — Publish the website and check everything](#d5) (10 min)

### 🟠 REQUIRED BEFORE PUBLIC USERS
- [ ] [P1 — Put hard limits on AI usage](#p1)
- [ ] [P2 — Turn on App Check (bot protection)](#p2)
- [ ] [P3 — Gemini API key: paid tier, or keep it out of production](#p3)
- [ ] [P4 — Secure your accounts and the database](#p4)
- [ ] [P5 — Privacy and legal tasks (UK GDPR)](#p5)
- [ ] [P6 — Analytics: keep it off until you have consent](#p6)

### 🟢 OPTIONAL / LATER
- [ ] [L1 — Custom domain](#l1)
- [ ] [L2 — Gemini Live voice](#l2)

**Total: 16 actions.** 3 blocking, 5 for deployment, 6 before public users, 2 optional.

**Check where you are at any time**, and safely share the output with me:
```powershell
.\deploy\verify.ps1
```

---

## What NeuroBridge actually uses (and what it doesn't)

| Need | Service | When |
|---|---|---|
| Backend (FastAPI) | **Cloud Run**, London | REQUIRED NOW |
| Container build + storage | **Cloud Build**, **Artifact Registry**, London | REQUIRED NOW |
| Main database (tasks, Bri chats, OCD journal…) | **Supabase Postgres** (already in the code, via `DATABASE_URL`) | REQUIRED NOW |
| Email sign-in, reading-file storage | **Supabase** (already in use) | REQUIRED NOW |
| AI (Bri, task breakdown, syllabus reading, search) | **Vertex AI Gemini**, London where available | REQUIRED NOW |
| Uploaded syllabi | **Cloud Storage** bucket, London | REQUIRED NOW |
| Secrets | **Secret Manager**, stored in London only | REQUIRED NOW |
| Logs, health | **Cloud Logging** (London bucket), **Cloud Monitoring** | REQUIRED NOW |
| Website hosting + HTTPS | **Firebase Hosting** (free `*.web.app` HTTPS) | REQUIRED NOW |
| Google Sign-In | **Firebase Authentication** | Your choice (D3) |
| Cross-device settings, document list | **Firestore**, London | REQUIRED NOW (small) |
| Usage numbers (no personal data) | **BigQuery**, London | REQUIRED NOW (tiny) |
| Bot protection | **Firebase App Check** + reCAPTCHA | BEFORE PUBLIC LAUNCH |
| App usage analytics | **Google Analytics for Firebase** | OPTIONAL (needs consent) |
| Real-time voice | **Gemini Live** (Gemini Developer API) | OPTIONAL / FUTURE |
| Custom domain | Firebase Hosting custom domain | OPTIONAL |

**Not needed, so the scripts don't enable them:** Document AI (Gemini already reads documents), Vertex AI Vector Search (paid always-on index; our per-user search is free), Cloud Tasks, Pub/Sub, Cloud Scheduler (there is no background job to run), Firebase Storage (we use our own private bucket).

**Voice today:** the microphone button uses the browser's built-in speech recognition. In Chrome that audio is processed by Google's speech service outside NeuroBridge's control. Spoken replies are generated on the device.

---

## Where your users' data lives (UK)

Region used everywhere possible: **`europe-west2` (London)**.

| Data | Where it is stored / processed | Stays in the UK? |
|---|---|---|
| Uploaded syllabi (files) | Cloud Storage bucket, London | ✅ Stored in UK |
| Profile settings, document list | Firestore, London | ✅ Stored in UK |
| Usage counts (no names, ids or text) | BigQuery, London | ✅ Stored in UK |
| Secrets | Secret Manager, London-only replication | ✅ Stored in UK |
| Backend processing | Cloud Run, London | ✅ Processed in UK |
| App logs (no conversation text) | Routed to a London log bucket | ✅ Stored in UK. Google's own admin audit logs stay in a global bucket. |
| Health metrics | Cloud Monitoring | ⚠️ Global, but contains no user content |
| **Main database**: tasks, Bri conversations, OCD/anxiety entries | **Supabase**: wherever your Supabase project was created | ⚠️ **Only UK if your Supabase project is in London.** See D1. |
| Email sign-in accounts, reading files | Supabase (same project) | ⚠️ Same as above |
| What the user types to Bri, and documents sent to Gemini | Vertex AI, London endpoint | ⚠️ UK **only if the model is served in London**. D2 checks this. If you must fall back to `global`, processing can happen outside the UK. |
| **Google Sign-In accounts** (name, email, photo) | Firebase Authentication | ❌ **Processed in the US** (Google states Firebase Auth runs only in US data centres) |
| Website files (no personal data) | Firebase Hosting global CDN | ➖ Global. Requests enter Google's network at the nearest edge. |
| Bot-check signals | App Check / reCAPTCHA | ❌ Not location-controlled |
| Analytics events (if you turn it on) | Google Analytics | ❌ Not UK-resident |
| Gemini Live voice / local development | Gemini Developer API (API key) | ❌ No location control |

**Bottom line:** London deployment keeps the backend, files, Firestore and logs in the UK. It does **not** by itself make NeuroBridge "UK-resident" or "UK GDPR compliant". Google Sign-In (US), browser speech, and possibly AI processing can leave the UK. Section P5 covers what you need to tell users and record. This is technical guidance, not legal advice.

---

<a id="b1"></a>
## B1 — Remove the old Gemini key saved in Windows 🔴

**Why:** your **new** key in `.env` is valid. Google accepted it. But an **old, broken** `GEMINI_API_KEY` is also saved in Windows' own settings, and Windows settings win over `.env`. So the app keeps sending the broken key.

**Steps**
1. Click **Start**, type `PowerShell`, right-click **Windows PowerShell** → **Run as administrator** → **Yes**.
2. Paste this line and press **Enter**:
   ```powershell
   [Environment]::SetEnvironmentVariable('GEMINI_API_KEY', $null, 'User'); [Environment]::SetEnvironmentVariable('GEMINI_API_KEY', $null, 'Machine')
   ```
3. **Fully quit** the Claude app, VS Code and every PowerShell window, then reopen them. They only read Windows settings when they start.

**Don't** change the key in `.env`. It is correct.

**Verify:** `.\deploy\verify.ps1` shows these four lines as **PASS**: Gemini generation, structured output, function calling, embeddings.

**Common problems**
- Still FAIL with "API key not valid" → you didn't fully restart the app. Or the line in `.env` has quotes or spaces around the key; it should look like `GEMINI_API_KEY=` followed directly by the key.
- "Access denied" → you didn't open PowerShell **as administrator**.

**Then tell me:** "B1 done" and paste the verify output.

---

<a id="b2"></a>
## B2 — Create the Google Cloud project and link billing 🔴

**Why:** every Google Cloud service lives inside a "project", and Google requires a billing account to switch them on. The settings I chose cost little or nothing for a demo: the backend scales to zero and nothing runs all the time. Charges are still possible. See [Costs](#costs).

**1. Create the project**
1. Open https://console.cloud.google.com/projectcreate
2. **Project name:** `NeuroBridge`
3. **Project ID:** Google suggests one (for example `neurobridge-471203`). You can click **Edit** and use letters, numbers and dashes. It must be unique worldwide and **can never be changed**.
4. **Organization / Location:** leave as shown (often "No organization").
5. Click **Create**. Wait for the notification, then select the project in the top bar.
6. **Write down the Project ID.** This guide calls it `<PROJECT_ID>`. It is not a secret.

**2. Billing**
1. Open https://console.cloud.google.com/billing/linkedaccount and make sure the top bar shows your project.
2. Click **Link a billing account**, choose your billing account, then **Set account**.
   - No billing account yet? Click **Manage billing accounts** → **Create account** → country **United Kingdom** → currency **GBP** → add a card.
3. The setup script creates a monthly **budget alert** (default 10 in your billing currency). A budget alert only **emails** you. **It does not stop spending.** See [Costs](#costs) for real limits.

**Verify:** the billing page shows "This project is linked to billing account …".

**Common problems:** "billing account not available" → you need the Billing Account Administrator role on that account. Use your own account or ask its owner.

**Then tell me:** "B2 done, Project ID is `<PROJECT_ID>`".

---

<a id="b3"></a>
## B3 — Install the Google Cloud command-line tool and sign in 🔴

**Why:** the setup scripts use it to create everything for you. Signing in this way means **no key files are ever downloaded**. NeuroBridge never needs a service-account JSON key, so don't create one.

**Steps**
1. Open https://cloud.google.com/sdk/docs/install → **Windows** → download and run the **Google Cloud CLI installer**. Keep the default options and let it finish.
2. Close all PowerShell windows and open a new one in `D:\Projects\Neuro_Bridge`.
3. Run these one at a time. Each opens your browser: pick the same Google account, click **Allow**.
   ```powershell
   gcloud auth login
   ```
   ```powershell
   gcloud auth application-default login
   ```
4. Run:
   ```powershell
   gcloud config set project <PROJECT_ID>
   ```

**Verify:**
```powershell
.\deploy\preflight.ps1 -ProjectId <PROJECT_ID>
```
These lines should say PASS: CLI installed, signed in, project exists, billing linked.

**Common problems:** "gcloud is not recognized" → open a **new** PowerShell window after installing.

**Then tell me:** "B3 done" and paste the preflight output.

---

<a id="d1"></a>
## D1 — Get a permanent database ready (Supabase, London) 🟡

**Why:** NeuroBridge stores tasks, Bri conversations, OCD exposure and journal entries in Postgres through `DATABASE_URL`. Without it, Cloud Run uses a temporary file that is **wiped on every restart**. Your app already uses Supabase, so we reuse it. There's no new database and no migration to Firestore.

**1. Check where your Supabase project is**
1. Open https://supabase.com/dashboard and select your NeuroBridge project. Its URL in `.env` starts with `bgtb…`.
2. Go to **Project Settings** → **General** and look at the **Region**.
   - **West EU (London)** → good, continue to step 2.
   - Anything else → your main database is **not in the UK**. Supabase can't move a project between regions. To be UK-only you would create a **new** project in **London** and move the data. **Tell me before doing this** and I'll prepare the migration.

**2. Copy the connection string into `.env`**
1. In Supabase click **Connect** (top of the project page).
2. Choose the **Session pooler** connection string, URI format. It looks like `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`.
3. Replace `[YOUR-PASSWORD]` with your **database password**. Forgot it? **Database** → **Settings** → **Reset database password**.
4. Open `.env` and add one line: `DATABASE_URL=<the full string>`. Save.

**3. Tables:** you don't need to do anything. The backend creates its own tables on first start. The frontend's tables already exist through `supabase/migrations`.

**4. Backups:** **Database** → **Backups** shows what your Supabase plan includes. The free plan has limited or no backups you can restore yourself. Before real users, use a plan with daily backups, or ask me to add a scheduled export.

**Verify:** `.\deploy\preflight.ps1 -ProjectId <PROJECT_ID>` shows `PASS DATABASE_URL is set`.

**Common problems**
- Password contains `@`, `/` or `#` → reset it to letters and numbers only. Those characters break the URL.
- Use the **Session pooler** string, not "Direct connection". Cloud Run needs IPv4, and the direct connection may be IPv6-only.

**Then tell me:** "D1 done, Supabase region is ___".

---

<a id="d2"></a>
## D2 — Run the setup script 🟡

**Why:** this one command builds the London infrastructure and deploys the backend:
- turns on only the services listed above
- creates a backend service account with narrow permissions (never Owner/Editor)
- creates Firestore, the private file bucket, BigQuery, the UK log bucket, Monitoring and the budget alert
- copies your secrets from `.env` into Secret Manager (London only)
- deploys to Cloud Run

It checks everything first with `preflight.ps1` and stops without changing anything if something is missing.

**Run:**
```powershell
.\deploy\gcp-setup.ps1 -ProjectId <PROJECT_ID>
```
It takes 10–15 minutes. Answer **Y** if it asks to enable an API.

**What you'll see:** steps starting with `==>`, then `Backend URL: https://neurobridge-api-….europe-west2.run.app` and a health result with `"status": "healthy"`. It also adds non-secret settings to `.env`: project ID, bucket name, dataset name and backend URL.

**Check the AI runs in London:**
```powershell
.\deploy\verify.ps1
```
The **Vertex AI** line must say PASS.
- If it says FAIL with "not found" or "not supported in this location", the AI model isn't offered in London yet. Tell me. Don't switch to `global` yourself, because that sends AI processing outside the UK. We'll decide together.

**Options (only if I ask you to):**
- `-IncludeGeminiApiKey` copies your Gemini key to the cloud. It's only needed for Gemini Live voice. That API has no UK location guarantee.
- `-BudgetAmount 20` changes the budget alert.

**Common problems**
- `PERMISSION_DENIED` → you're signed in with a different account than the project owner. Run `gcloud auth login` again.
- The budget step prints "skipped" → create it by hand: https://console.cloud.google.com/billing/budgets → **Create budget** → this project → amount → alerts at 50/90/100%.
- If the script stops partway, **just run it again**. It skips anything already created.

**Then tell me:** "D2 done" and paste the verify output.

---

<a id="d3"></a>
## D3 — Choose how people sign in 🟡 (decision)

Both options are already built:

| Option | What users see | Where account data goes |
|---|---|---|
| **A. Email + password (Supabase)** | Current login form | Your Supabase region (London if D1 = London) |
| **B. Add "Continue with Google" (Firebase)** | Extra Google button | **US** (Firebase Authentication) |

For the strictest UK data residency, choose **A**. For the Google BuildTHON demo, **B** shows another Google technology. You can enable it and mention the US processing in your privacy notice (P5).

**Tell me:** "D3: A" or "D3: B". If A, skip D4.

---

<a id="d4"></a>
## D4 — Turn on Firebase and Google Sign-In 🟡

**Why:** Firebase hosts the website with free HTTPS, and, if you chose B, provides Google Sign-In.

**1. Automatic part** (adds Firebase to your project and writes the **public** web settings into `.env`):
```powershell
npm install -g firebase-tools
```
```powershell
firebase login
```
```powershell
.\deploy\firebase-setup.ps1 -ProjectId <PROJECT_ID>
```
It adds `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_APP_ID` and `VITE_FIREBASE_MEASUREMENT_ID` to `.env`. These are **public identifiers, not secrets**. They are designed to be in the website code. Google calls one of them "API key", but it only identifies the project.

**2. Google Sign-In** (only if D3 = B). These 2 clicks can't be scripted:
1. Open https://console.firebase.google.com/ → your project.
2. Left menu **Build** → **Authentication** → **Get started**.
3. **Sign-in method** tab → **Google** → switch **Enable** on → **Project support email**: your email → **Save**.
4. **Settings** tab → **Authorized domains**. `localhost`, `<PROJECT_ID>.firebaseapp.com` and `<PROJECT_ID>.web.app` should be listed. Add any other domain you'll use with **Add domain**.

**Don't** set up Firebase Storage or a new Firestore database here. The script already created Firestore in London, and the file bucket is separate and private.

**Verify (local):** `npm run dev` → open http://localhost:8080/login → **Continue with Google** appears and signs you in.

**Common problems**
- `auth/unauthorized-domain` → add that domain in step 4.
- The button doesn't appear → restart `npm run dev`. It only reads `.env` when it starts.

**Then tell me:** "D4 done".

---

<a id="d5"></a>
## D5 — Publish the website and check everything 🟡

```powershell
npm run build
```
```powershell
firebase deploy --only hosting,firestore:rules --project <PROJECT_ID>
```
**You'll see:** `Hosting URL: https://<PROJECT_ID>.web.app`. HTTPS is automatic. Website requests to `/api/...` go to the London backend.

**Check it works:**
1. Open the Hosting URL → sign in → **ADHD → Task breakdown** → upload a small syllabus PDF → review the plan → **Add these steps to my tasks**.
2. Ask Bri: "What's due for my essay class?"
3. Run `.\deploy\verify.ps1`. Every line should be PASS, except Firebase web config if you chose D3 = A.

**Later updates:** `.\deploy\redeploy.ps1 -ProjectId <PROJECT_ID>` for the backend (it runs the tests first), and the two commands above for the website.

**Then tell me:** "D5 done" and paste the verify output.

---

<a id="p1"></a>
## P1 — Put hard limits on AI usage 🟠

**Why:** budget alerts don't stop spending. **Quotas do**: once reached, requests are refused.

Already built into the code and set by the script:
- per-user hourly limits (Bri 60/h, AI tools 60/h, syllabus uploads 10/h)
- at most 4 AI steps per Bri message
- 10 MB upload limit
- at most 3 backend instances

The hourly limits are counted per instance, so worst case is 3× those numbers.

**Your step:**
1. Open https://console.cloud.google.com/iam-admin/quotas
2. In **Filter**, type `Vertex AI API`, then search for the "generate content requests per minute" quota for your model in region **europe-west2**.
3. Tick it → **Edit quotas** → set **30** → **Submit**. If you use the Gemini key in production, repeat for **Generative Language API**.

**Verify:** the quota page shows your new value.

<a id="p2"></a>
## P2 — Turn on App Check (bot protection) 🟠

1. Open https://console.cloud.google.com/security/recaptcha → **Create key**.
   - Name: `neurobridge-web`
   - Platform: **Website**
   - Domains: `<PROJECT_ID>.web.app`, `<PROJECT_ID>.firebaseapp.com`, `localhost`
   - Click **Create key** and copy the **key ID**. It's public.
2. Add `VITE_FIREBASE_APPCHECK_SITE_KEY=<key ID>` to `.env`.
3. https://console.firebase.google.com/ → project → **Build → App Check** → **Apps** tab → your web app → **reCAPTCHA Enterprise** → paste the key ID → **Save**.
4. Rebuild and deploy (D5 commands).
5. Open `https://<backend URL>/api/google/status`. When `app_check.verified` is above 0, **tell me** and I'll switch the backend from "monitor" to "enforce".

<a id="p3"></a>
## P3 — Gemini API key: paid tier, or keep it out of production 🟠

**Why:** Google's Gemini API terms say apps offered to users in the **UK/EEA/Switzerland** must use **Paid Services**. Unpaid-tier data terms differ. In production NeuroBridge uses **Vertex AI**, which bills through your Cloud project, and does **not** upload the Gemini key unless you ask (D2 `-IncludeGeminiApiKey`).
- Keep the free key for your own local development only, **or**
- link billing to the key's project: https://aistudio.google.com/apikey → your key's project → **Set up billing**.

Read the current terms yourself: https://ai.google.dev/gemini-api/terms

<a id="p4"></a>
## P4 — Secure your accounts and the database 🟠

1. Turn on **2-Step Verification** for your Google account (https://myaccount.google.com/security) and Supabase account (Account → Security).
2. Google Cloud access: https://console.cloud.google.com/iam-admin/iam. Only people who truly need it, with the smallest role. **Never** give anyone **Owner** or **Editor** "just to make it work".
3. Supabase → **Authentication → Policies**: every table holding user data should show **RLS enabled**. If any shows "RLS disabled", tell me the table names. Don't paste data.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` only in `.env` and Secret Manager. If one leaks, reset it in Supabase and re-run D2.

<a id="p5"></a>
## P5 — Privacy and legal tasks (UK GDPR) 🟠

*Not legal advice.* The code gives you the technical pieces:
- in-app data export and full deletion, which also clears Firestore and the file bucket
- no conversation text in logs or analytics
- UK storage where possible

The **organisational** duties below are yours. NeuroBridge handles **health information**, which is **special category data** under UK GDPR, so expect extra obligations.

1. **ICO:** check whether you must pay the data protection fee: https://ico.org.uk/for-organisations/data-protection-fee/
2. **Lawful basis + condition for health data:** usually **explicit consent**. Record which basis you use and why.
3. **DPIA** (Data Protection Impact Assessment): likely required for large-scale health data or new technology like AI. ICO template: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/
4. **Privacy notice** in the app. It must name your processors (Google Cloud, Firebase, Supabase), say what is processed **outside the UK** (see the data-location table: Google Sign-In in the US, possible AI processing, browser speech), list retention periods, and explain how to export or delete data.
5. **International transfers:** for US processing, check what safeguards Google and Supabase rely on (their data processing terms) and record it.
6. **Retention:** decide how long to keep Bri conversations and uploads. Logs are already set to 30 days and BigQuery tables to 1 year. Tell me your periods and I'll automate deletion.
7. **Incident plan:** who to contact, how to revoke keys (Secret Manager / Supabase reset). Personal data breaches may need reporting to the ICO **within 72 hours**.
8. **AI safety:** NeuroBridge isn't a medical device. Show users that Bri isn't a clinician and how to get urgent help. The OCD module already blocks reassurance-style AI output.

<a id="p6"></a>
## P6 — Analytics: keep it off until you have consent 🟠

Analytics is **off by default** in the code. UK rules (PECR) generally need consent before analytics cookies, and Analytics data isn't UK-resident. To turn it on later: add a consent banner (ask me), then set `VITE_FIREBASE_ANALYTICS=true` in `.env` and redeploy the website.

---

<a id="l1"></a>
## L1 — Custom domain 🟢
Firebase console → **Hosting** → **Add custom domain** → follow the DNS records it shows at your domain registrar. HTTPS is issued automatically, which can take up to 24 hours. Add the domain to Authorized domains (D4) and tell me, so I add it to the backend's allowed origins.

<a id="l2"></a>
## L2 — Gemini Live voice 🟢
This is real-time voice through the Gemini Developer API. It has **no UK location guarantee** and needs P3 (paid tier). When you want it, tell me and I'll enable `GEMINI_LIVE_ENABLED` and redeploy with `-IncludeGeminiApiKey`.

---

<a id="costs"></a>
## Costs and safety (student-project settings)

| Service | Can cost money? | What drives cost | Already limited by |
|---|---|---|---|
| Vertex AI Gemini | **Yes, main cost** | Text and documents sent to the AI (a 10 MB PDF is a lot of text) | Hourly per-user limits, 4 steps/message, P1 quota |
| Cloud Run | Yes (free monthly allowance) | Time spent handling requests | Scales to 0, max 3 instances, 120 s timeout |
| Cloud Logging | Yes (free monthly allowance) | Log volume | One short line per request, 30-day retention |
| Artifact Registry | Small | Stored container images | Keeps the 5 newest, deletes after 30 days |
| Cloud Storage / Firestore / BigQuery | Small (free allowances) | Uploads, reads, events | 10 MB uploads, 10 uploads/h, tiny event rows |
| Cloud Build | Small (free allowance) | Build minutes | Only when you deploy |
| Firebase Hosting / Auth / App Check | Usually free at this scale | Traffic / sign-ins | — |
| Secret Manager / Monitoring | Small or free at this scale | Secret reads, uptime checks | — |

**Important truths**
- Budget alerts **only email you**. Google Cloud has no simple "stop at £X" switch. Quotas (P1) and the app's built-in limits are the real brakes. A billing kill-switch can be automated later if you want it.
- Check spending weekly: https://console.cloud.google.com/billing → **Reports**, filtered to your project.
- Unexpected costs usually come from bots hammering the AI endpoints (P2 fixes this), a large upload loop (blocked by rate limits), or leaving `min-instances` above 0 (the script sets 0).
- Prices change. Check https://cloud.google.com/pricing and https://cloud.google.com/vertex-ai/generative-ai/pricing

---

## Reference: every setting NeuroBridge reads

| Variable | Secret? | Where it goes | Who sets it |
|---|---|---|---|
| `GEMINI_API_KEY` | **Secret** (backend only) | `.env`; Secret Manager only with `-IncludeGeminiApiKey` | You (done) |
| `DATABASE_URL` | **Secret** (backend only) | `.env` → Secret Manager | You (D1) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** (backend only, root access) | `.env` → Secret Manager | You (optional: enables full account deletion) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Public by design (protected by RLS) | `.env` → Cloud Run / Secret Manager | Already set |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public (website) | `.env`, built into the website | Already set |
| `VITE_FIREBASE_*` (6 values) | Public (website) | `.env` | `firebase-setup.ps1` |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | Public (website) | `.env` | You (P2) |
| `VITE_FIREBASE_ANALYTICS` | Setting | `.env` | You (P6, leave unset) |
| `GOOGLE_CLOUD_PROJECT`, `FIREBASE_PROJECT_ID`, `GCS_BUCKET`, `BIGQUERY_DATASET`, `VERTEX_AI_LOCATION`, `CLOUD_RUN_URL` | Not secret | `.env` + Cloud Run | `gcp-setup.ps1` |
| `GOOGLE_GENAI_USE_VERTEXAI`, `GCP_SECRET_NAMES`, `CORS_ALLOWED_ORIGINS`, `FIREBASE_APP_CHECK_MODE`, rate limits | Not secret | Cloud Run | `gcp-setup.ps1` |
| Google Cloud credentials | — | **None to download.** Cloud Run runs as the `neurobridge-api` service account; your laptop uses `gcloud auth application-default login`. | — |

*Last checked against the code: 2026-11-20. Region facts were checked against Google's documentation on 2026-11-20; Google changes model availability often, so `verify.ps1` re-checks it live.*
