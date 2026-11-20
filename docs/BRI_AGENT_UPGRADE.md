# Bri Agent V2 — upgrade notes

Status (2026-11-20): implemented and tested offline (257 backend tests pass, 58 of them new in
`backend/tests/test_bri_v2.py`). **Not live-verified**: no Gemini credentials were available, so no real
Gemini or Gemini Live round trip has been run.

## Architecture

V2 is a subclass of the V1 `AgentOrchestrator`. V1's loop is reused unchanged: the safety filter,
deterministic shortcuts, Gemini function calling, SSE events and the execution state machine. V2 adds
a layer around that loop and a few hooks inside it.

```
router ──make_orchestrator()──► BriAgentV2 (flag on)  ──fault before any write──► AgentOrchestrator (V1)
                                   │
   LISTEN/UNDERSTAND  followup.classify()   short-reply shape (yes/no/not now/the first one/I finished it…)
   CONTEXTUALIZE      state.load_state()    pending offer/choice/action, active task, rejections
   DECIDE             _resolve_followup()   clear cases → deterministic reply/action (no LLM call)
   PLAN/ACT           V1 Gemini loop + V2 system rules + backend "interpretation" hint
   POLICY             policy.decide/validate_args   tiers, explicit-request gates, budget, dup-write block
   VERIFY             verifier.verify()     fresh DB read; if it fails, the result becomes an error
   FOLLOW UP/ADAPT    _finalize_state()     extracts Bri's new offer/choice/question, records what was declined
```

Files: `backend/services/bri_v2/{config,state,followup,policy,verifier,orchestrator,live}.py`.
Table: `agent_conversation_states` (one JSON row per conversation, scoped to its user, included in privacy export/delete).

## Follow-up system
- `followup.classify` handles these reply shapes: affirm, deny, defer ("not now"), maybe, stop, easier,
  shorter, longer, why, next, continue, done, failed ("still stuck"), different, change, correction
  ("actually I meant…"), and select ("the first one", "the easiest").
- Messages longer than 8 words are never treated as a bare "yes".
- **Resolved without an LLM call:**
  - "yes" or "no" to a pending confirmation
  - "no" or "not now" to an offer
  - "I finished it": marks the real step done and offers the next step
  - "what next?" when a task breakdown is active
  - an ambiguous "the first one" when nothing is pending: Bri asks which one
- **Handled by Gemini with an injected interpretation:**
  - accepting an offer
  - a resolved choice
  - "still stuck": Bri must not repeat the previous plan
  - "make it easier": targets the active breakdown through `update_task_step`
  - "why?", corrections, "something else"
- Declined approaches are kept in the conversation state and shown to the model, so Bri doesn't re-offer them.
- Pending offers and actions expire after 30 minutes. A pending action is dropped once the user moves on to something else.
- A "yes" with nothing to refer to blocks all writes for that turn.

## Tool / action system
| Tier | Tools | Behaviour |
|---|---|---|
| LOW | reads + `write_low` (focus control, grounding, routines, presentation, step edits, `complete_task_step`) | run when requested |
| MODERATE | `create_task_breakdown` | runs directly only when the user explicitly asked ("break down my essay", or "yes" to Bri's offer of it). Otherwise Bri proposes it and asks for confirmation. |
| HIGH | `create_exposure`, `delete_exposure_task`, `complete_erp_session`, any unlisted `write_confirm` | always needs confirmation, whatever the user typed |

- **Arguments:** validated against each tool's schema (types, enums, ranges such as SUDS 0–100 and minutes 1–240, required fields). Unknown keys like `user_id` are dropped.
- **Limits per turn:** at most 8 tool executions, and the same write with the same arguments is blocked from running twice.
- **Verification:** after a write, a verifier re-reads the database (breakdowns and steps, focus session status, routines, grounding, exposures, preferences). If the check fails, the write is reported as an error, the action payload is dropped, and it is logged as `verification_failed`.
- **Typed confirmations:** "yes" typed or spoken in chat goes through the same idempotent `execute_confirmed_tool` as the confirm button.
- **Declining:** `POST /api/agent/tool/decline` clears a proposal on the server.
- **New V2-only tools:**
  - `complete_task_step`
  - `save_user_preference`: whitelisted keys only, and only runs when the user says "remember", "from now on" or "I prefer".
  - Neither tool is declared to V1, and V1 can't run them.

## Memory boundaries
- **Conversation state:** short-term and per conversation. It is deleted with the user's data.
- **Preferences:**
  - Stored in `AgentLearning` and only saved when the user explicitly asks.
  - Only these keys are allowed: response length, step size, support style, presentation, voice replies.
  - No free text, diagnoses or inferred traits. "remember that I have ADHD" is rejected.
- **Context:** still scoped to the modules the message is about. For a short follow-up like "yes", V2 scopes context by the conversation topic instead of loading every module.

## Google AI
- Still uses `google-genai` through the existing adapter; no extra framework was added.
- ADK and Vertex Agent Engine were considered and left out: they would add a second agent framework, and the existing loop already covers the need.
- Structured output stays where it already pays off (task breakdowns).
- Deterministic classification keeps follow-up handling free in tokens and testable.

## Gemini Live — optional, off by default
Findings from Google's docs, which now live at aistudio.google.com/docs/live-api:
- Bidirectional WebSocket. Input is 16 kHz 16-bit PCM; output is 24 kHz.
- Built-in voice activity detection and interruption: barge-in arrives as `serverContent.interrupted`.
- Function calling is synchronous by default.
- An audio-only session lasts about 15 minutes, and a connection about 10 minutes. The server sends `goAway` before ending, and sessions can be resumed with a handle.
- Ephemeral tokens (v1beta, preview) let the browser connect without the API key. `live_connect_constraints` locks the model and config on the server.

Implementation:
- `GET /api/agent/live/config`: whether Live mode is available.
- `POST /api/agent/live/session`:
  - Mints a single-use token with the system prompt, the voice tool allowlist and the conversation state locked into it.
  - Rate-limited.
  - Not available in demo mode.
- `POST /api/agent/live/tool`:
  - Every Live function call is relayed here.
  - It goes through the same V2 policy, confirmation and verification as text chat.
  - OCD exposure and delete tools are not available by voice.
- `POST /api/agent/live/turn`:
  - Saves both sides' transcripts to the same conversation, so text chat continues with full context.
  - Keeps Bri's spoken offers in the follow-up state.
- Frontend:
  - `src/lib/geminiLive.js` handles the socket, AudioWorklet capture, gapless playback, barge-in, the tool relay, one resume attempt, and fallback.
  - `src/hooks/useGeminiLive.js` exposes it to the chat.
  - An extra header button appears in `AgentChat` only when Live is available.

The WebSocket URL (`BidiGenerateContentConstrained`) and model id are configurable, because the docs pages
did not state them exactly. Verify both on first live run.

## Fallback behaviour
- `BRI_AGENT_V2_ENABLED=false`: the router builds V1 exactly as before.
- V2 can't be constructed: V1 is used.
- V2 fails before the turn or inside the loop, before any write lands: the turn re-runs on V1 (`BRI_AGENT_FALLBACK_ENABLED`, default on).
- Saving state fails: the reply is still returned.
- Gemini is down, times out or hits its quota: V1's existing real-action fallbacks still apply. Deterministic follow-ups work even with no key at all.
- Live is disabled, not configured, out of quota, or the socket drops: a notice appears, and the existing chat and voice input (Web Speech API) keep working unchanged.

## Risk assessment (abridged)
| Risk | Mitigation in code |
|---|---|
| Hallucinated or invented action | only tool results count, verifier re-reads the database, failed tools are always flagged in the reply |
| Wrong action from "yes"/"that one" | explicit pending state, clarification when there's no referent, writes blocked on an unanchored yes, 30-minute expiry |
| Destructive or clinical writes | HIGH tier always needs confirmation, enforced on the backend |
| Prompt injection from documents | tool results treated as untrusted (system rule), and HIGH-tier writes can't run without the user, whatever the model was told |
| Agent loops and cost | V1's `AGENT_MAX_STEPS`, V2's 8-call budget, duplicate-write block, deterministic paths with no LLM call, rate limits on Live sessions |
| Privacy | minimal state, whitelisted memory, no transcripts in logs, state covered by export/delete, API key never sent to the browser |
| Emotional dependency | system rules: respond as a person first, encourage real-world support, Bri says it's an AI, no follow-up spam (`defer` closes the topic) |

## Configuration
```
BRI_AGENT_V2_ENABLED=true          # default true
BRI_AGENT_FALLBACK_ENABLED=true    # default true
GEMINI_LIVE_ENABLED=false          # default false; needs GEMINI_API_KEY (Vertex-only setups report unavailable)
GEMINI_LIVE_MODEL=gemini-3.8-live
GEMINI_LIVE_SESSION_MINUTES=10
GEMINI_LIVE_SESSIONS_PER_HOUR=6
# GEMINI_LIVE_WS_URL=wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained
```

## Manual setup and verification still needed
1. Set `GEMINI_API_KEY` and run a real chat: offer → "yes" → breakdown saved.
2. Set `GEMINI_LIVE_ENABLED=true`, open Bri in Chrome, and click the live-voice button. Confirm audio both ways, barge-in, a voice tool call (for example "start a 10 minute focus session"), and that the transcripts show up in chat.
3. If the token or socket is rejected, check the model id and WebSocket URL against the current Live API reference.
