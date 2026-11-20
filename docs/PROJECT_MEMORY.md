# NEUROBRIDGE — PROJECT MEMORY

> **Status:** Authoritative Long-Term Memory  
> **Last Updated:** 2026-11-20  
> **Repository:** `d:\Projects\Neuro_Bridge`  
> **Foundational Philosophy:** "Technology that adapts to people, not people adapting to technology."

---

## 1. Executive Summary & Vision

NeuroBridge is an **AI-powered adaptive support ecosystem for neurodivergent individuals** (supporting ADHD, Autism Spectrum Condition/ASD, Dyslexia, OCD, Anxiety, Depression, Dyscalculia, APD, and Dyspraxia).

Unlike conventional neurodivergent apps that offer static, disorder-specific silos (e.g. static ADHD to-do lists, rigid reminders), NeuroBridge reads live user context — cognitive load, energy levels, stress/anxiety, interaction signals, and past outcomes — to dynamically reconfigure and deliver the minimal effective intervention.

### Core Value Proposition
- **Not 6 disconnected tools; ONE coherent ecosystem** connected by a shared intelligence layer.
- **State-adaptive rather than diagnosis-adaptive**: Diagnosis initializes baseline tools, but real-time state dictates interface complexity and interventions.
- **Agentic Execution**: Natural language moves through `UNDERSTAND → PLAN → SELECT TOOL → EXECUTE`, directly driving application actions rather than just generating chat text.
- **Closed Learning Loop**: `CONTEXT → OBSERVE → LEARN → ADAPT`, safely recording what works to personalize future support without compromising privacy.

---

## 2. Target Audience & Business Strategy

- **Primary Users:** Neurodivergent students, young adults (18+), and working professionals experiencing task paralysis, sensory overload, executive dysfunction, or cognitive fatigue.
- **Secondary Roles:**
  - **Guardians:** Care-circle coordination, unobtrusive check-ins, consented task support.
  - **Support Specialists/Clinicians:** Oversight and progress monitoring without invasive surveillance.
- **Go-To-Market / BuildTHON Potential:**
  - Pilot cohort in higher education (universities and colleges) and accessibility support centers.
  - Flywheel: `Land Campus Pilot → Measure Intervention Completion → Institutional Subscription`.

---

## 3. Technology Stack & Current Architecture

### Frontend
- **Framework:** React 18.3.1 (Vite 5.4, SWC)
- **Styling:** Tailwind CSS 3.4 + CSS Custom Properties + Framer Motion
- **Component Library:** Radix UI primitives + shadcn/ui + Lucide React
- **State Management:** React Context (`AuthContext`, `ContextProvider`), Zustand stores (`agentStore`, `focusSessionControlStore`), TanStack React Query 5.83, LocalStorage (local-first)
- **Voice/Audio:** Web Speech API (`useAgentVoice.js`) for speech-to-text input and agent voice output.

### Backend
- **Framework:** FastAPI (Python 3.12, Uvicorn) — *Note: Legacy docs stated Flask, but backend is FastAPI*.
- **Database/ORM:** SQLAlchemy 2.0 with SQLite (`sql_app.db`) for local dev, PostgreSQL for production.
- **Authentication:** Supabase Auth JWT verification via `backend/auth.py` + isolated demo persona pseudo-tokens (`demo:nb-user-042:<session>`).
- **AI Engine:** Google Gemini via `backend/services/agent_service.py`, `backend/services/ai_service.py`, and `backend/routers/ai_proxy_router.py`.

---

## 4. Current Development State (Audit Findings)

### What Works & Is Tested
1. **Backend Test Suite:** 184/184 tests pass (`pytest backend/tests`).
2. **Deterministic Agent Safety & Navigation:** Crisis pre-filter, fast-path navigation, confirmation policy (`READ`, `WRITE_LOW`, `WRITE_CONFIRM`), idempotency ledger.
3. **Clinical Safety Constraints:** OCD reassurance filter (`containsReassurance`) prevents pathological reassurance-seeking.
4. **Privacy & Data Minimization:** User data export and deletion endpoints (`/api/privacy/export`, `/api/privacy/data`), user isolation, private storage buckets.
5. **Multi-Domain Support Modules:**
   - **ADHD:** Task Breakdown, Visual Timeline, Focus Sessions (with pause/resume/stop state machine), Body Doubling, Emotion Coach.
   - **OCD:** Exposure Hierarchy Builder, ERP Session Timer, SUDS Monitor, ERP Progress Tracker.
   - **Anxiety:** Grounding Toolkit, Reframing Guides, Mood Check-ins.
   - **ASD:** Social Stories, Emotion Decoder, Social Scenarios, Routine Steps.
   - **Dyslexia:** Dyslexia Reader with OpenDyslexic font, syllable highlighting, TTS, document upload.
   - **Depression:** MVH Protocol, Anxiety Dissolver, Cognitive Reframer, Evidence Folder.

### What Is Broken, Simulated, or Incomplete
1. **Gemini API Key:** The key currently in `.env` returns `400 API_KEY_INVALID` from Google. Real LLM generation fails and falls back to deterministic mocks.
2. **Google SDK Version:** Backend uses legacy `google-generativeai` which displays deprecation warnings. Target: modern `google-genai` SDK.
3. **Startup Scripts Discrepancy:** `start-dev.ps1` and `start-dev.sh` reference `python app.py` (Flask) and port 5173, whereas the backend is FastAPI (`backend/main.py`) on port 5000 and Vite runs on 8080.
4. **JITAI Sensors:** Physiological signals (HRV, EDA, IMU) in the JITAI engine are simulated.
5. **Frontend Node Dependencies:** `node_modules` was absent from repo; network timeout during `npm install` requires local resolution.

---

## 5. Architectural Guardrails (Rules We Never Break)
1. **No Disconnected Tools:** All modules must feed and read from the central context/agent.
2. **Never Diagnose or Prescribe:** Support technology assists; it does not replace clinicians.
3. **Zero Hallucinated Tool Executions:** Agent must never claim an action was taken unless application state / DB was genuinely updated.
4. **Anti-Reassurance for OCD:** Never reassure OCD users that "everything is fine/safe".
5. **Privacy First:** Never send user identity, email, or ABHA ID to Gemini. Secrets stay strictly server-side.

## Google platform (2026-11-20)
See `docs/GOOGLE_ARCHITECTURE.md` and `docs/GOOGLE_INTEGRATION_SCORECARD.md`. AI goes through `backend/services/google_ai_service.py` only. The legacy `google.generativeai` import is gone; agent/OCD code uses `genai_compat`. Backend dev port is **8000**. No live Google verification yet: credentials are pending (see `NEXT_ACTIONS.md`).
