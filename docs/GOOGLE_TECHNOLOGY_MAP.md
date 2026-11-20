# NEUROBRIDGE — GOOGLE TECHNOLOGY MAP

> **Authoritative Technical Catalog for Google Startup BuildTHON**  
> **Last Updated:** 2026-11-20  
> **Ecosystem Scope:** Google Cloud Platform, Google AI Studio, Vertex AI, Firebase Ecosystem, Google Workspace/Speech APIs.

---

## 1. Google Gemini & AI Platform

| Technology | Canonical Service / API | Supported Models / Endpoints | NeuroBridge Specific Purpose | Priority |
|---|---|---|---|---|
| **Gemini 2.5 Flash** | `google-genai` / Vertex AI | `gemini-2.5-flash` | **Bri Real-Time Agent Core:** Native function-calling, rapid multi-turn reasoning, adaptive UI action planning, contextual commands. Ultra-low latency (<600ms). | **P0 (Critical)** |
| **Gemini 2.5 Pro** | `google-genai` / Vertex AI | `gemini-2.5-pro` | **Deep Workload & Academic Syllabus Decomposition:** High-capacity reasoning (1M token window) for multi-week assignment schedules, course outlines, and intricate learning difficulty profiling. | **P1 (High)** |
| **Gemini Multimodal Vision** | `google-genai` / Vertex AI | `gemini-2.5-flash` (multimodal) | **Document & Assignment Visual Parsing:** Direct image/PDF ingestion of handwritten notes, worksheets, and syllabi for dyslexia simplification and task chunking. | **P0 (Critical)** |
| **Modern Google GenAI SDK** | `google-genai` (v1.0+) | `from google import genai` | Replaces deprecated `google-generativeai`. Unified client interface supporting both Gemini Developer API (Google AI Studio) and Vertex AI via single SDK flag (`vertexai=True`). | **P0 (Critical)** |
| **Vertex AI Model Garden & Evaluation** | Vertex AI SDK (`google-cloud-aiplatform`) | Model Evaluation & Guardrails | Automated safety, faithfulness, and clinical boundary benchmarking for ERP and ASD scenarios. | **P2 (Medium)** |
| **Vertex AI Text Embeddings** | Vertex AI Embeddings API | `text-embedding-005` | Vector embedding of user-approved past coping strategies and reflection outcomes for semantic memory retrieval. | **P1 (High)** |

---

## 2. Firebase Ecosystem

| Technology | Component / Library | NeuroBridge Specific Purpose | Priority |
|---|---|---|---|
| **Firebase Authentication** | `firebase/auth` + `firebase-admin` | **Universal Sign-In & Care-Circle Identity:** Real Google Sign-In, Email/Password, and cryptographically verified JWT tokens sent to FastAPI backend. Bridges existing Supabase auth with zero data loss. | **P0 (Critical)** |
| **Cloud Firestore** | `@google-cloud/firestore` / `firebase/firestore` | **Persistent Context & Adaptive Profiles:** Real-time synchronization of user cognitive state, active focus timers, user-approved task plans, and reflection memory. | **P1 (High)** |
| **Firebase / Cloud Storage** | `firebase/storage` / `@google-cloud/storage` | **Secure Academic Material Repository:** Encrypted per-user buckets for uploaded syllabi, PDFs, and reading worksheets with signed access URLs. | **P1 (High)** |
| **Firebase App Check** | `firebase/app-check` | **API Protection & Anti-Abuse:** Attestation tokens (reCAPTCHA Enterprise / Play Integrity) guarding backend Gemini proxies from quota abuse. | **P2 (Medium)** |
| **Firebase Analytics** | `firebase/analytics` | **Privacy-Preserving Product Metrics:** Anonymous tracking of task initiation rate, focus session completion, and overwhelm-reduction effectiveness. | **P2 (Medium)** |

---

## 3. Google Cloud Platform (GCP) Infrastructure

| Technology | Service | NeuroBridge Specific Purpose | Priority |
|---|---|---|---|
| **Google Cloud Run** | Fully managed serverless containers | **Production Microservices Deployment:** Highly scalable, zero-cold-start hosting of FastAPI backend and Vite frontend with automatic HTTPS and custom domain support. | **P0 (Critical)** |
| **Google Cloud Secret Manager** | GCP Secret Manager API | **Zero-Leak Credential Vault:** Production storage of `GEMINI_API_KEY`, Firebase Service Account keys, and database credentials outside code/env files. | **P1 (High)** |
| **Google Cloud Logging & Cloud Monitoring** | GCP Operations Suite | **Structured Observability:** Real-time latency tracking, tool execution failure alerting, and audit tracing of agent actions. | **P1 (High)** |
| **Google Cloud Tasks / Pub/Sub** | Asynchronous Task Queues | **Background Document Ingestion:** Decoupled asynchronous extraction of large 40-page PDF course syllabi without blocking web requests. | **P2 (Medium)** |
| **Google BigQuery** | Serverless Data Warehouse | **Cohort Analytics:** Aggregated, anonymized institutional metrics for university pilot evaluations (e.g. academic retention vs. intervention adherence). | **P3 (Future)** |

---

## 4. Accessibility & Multimodal Interaction

| Technology | API / Web Standard | NeuroBridge Specific Purpose | Priority |
|---|---|---|---|
| **Google Cloud Text-to-Speech (Neural2 / Journey)** | Google Cloud TTS API | **Hyper-Natural Accessible Voice:** Soothing, natural auditory narration for Dyslexia Reader and Guided ERP meditation. | **P1 (High)** |
| **Web Speech API + Gemini Multimodal Voice** | Browser SpeechRecognition + Gemini Audio Ingestion | **Voice-First Neurodivergent Navigation:** Hands-free command and emotional venting interface via Bri agent. | **P0 (Critical)** |
