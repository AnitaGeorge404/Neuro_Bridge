import json
import os
import queue
import threading

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db, SessionLocal
from ..auth import get_current_user, CurrentUser
from ..models import agent_models
from ..schemas import agent_schemas
from ..services.agent_service import AgentOrchestrator  # noqa: F401 (V1, still the fallback)
from ..services.bri_v2 import make_orchestrator
from ..services.rate_limiter import SlidingWindowRateLimiter

router = APIRouter()

# Demo mode has no real credential behind it (see auth.py) — 20/hour there guards
# against reading the token format out of the public bundle and burning the
# GEMINI_API_KEY's quota for free. Real accounts are authenticated, but the cost
# exposure is identical per message, so they get a generous, configurable limit too.
_DEMO_RATE_LIMIT_MAX_MESSAGES = 20
_DEMO_RATE_LIMIT_WINDOW_SECONDS = 3600
_REAL_RATE_LIMIT_MAX_MESSAGES = int(os.getenv("AGENT_REAL_RATE_LIMIT_PER_HOUR", "60"))
_REAL_RATE_LIMIT_WINDOW_SECONDS = 3600
_demo_limiter = SlidingWindowRateLimiter(
    _DEMO_RATE_LIMIT_MAX_MESSAGES,
    _DEMO_RATE_LIMIT_WINDOW_SECONDS,
    "Demo mode is limited to a small number of messages per hour. Sign in with a real account for unlimited use, or try again later.",
)
_real_limiter = SlidingWindowRateLimiter(
    _REAL_RATE_LIMIT_MAX_MESSAGES,
    _REAL_RATE_LIMIT_WINDOW_SECONDS,
    "You've sent a lot of messages in a short time — please wait a bit before sending more.",
)
# Back-compat handles for existing tests, which reach into these directly.
_demo_chat_timestamps = _demo_limiter._buckets
_real_chat_timestamps = _real_limiter._buckets


def _enforce_rate_limit(user: CurrentUser) -> None:
    limiter = _demo_limiter if user.is_demo else _real_limiter
    limiter.max_events = _DEMO_RATE_LIMIT_MAX_MESSAGES if user.is_demo else _REAL_RATE_LIMIT_MAX_MESSAGES
    limiter.check(user.id)


def _owned_conversation(db: Session, user: CurrentUser, conversation_id: Optional[int]) -> agent_models.AgentConversation:
    """Strict ownership lookup (never creates) — 404 for missing or someone else's."""
    conversation = db.query(agent_models.AgentConversation).filter(
        agent_models.AgentConversation.id == conversation_id,
        agent_models.AgentConversation.user_id == user.id,
    ).first() if conversation_id else None
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip() or None


def _get_or_create_conversation(db: Session, user: CurrentUser, conversation_id: Optional[int]) -> agent_models.AgentConversation:
    if conversation_id:
        conversation = db.query(agent_models.AgentConversation).filter(
            agent_models.AgentConversation.id == conversation_id,
            agent_models.AgentConversation.user_id == user.id
        ).first()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conversation
    conversation = agent_models.AgentConversation(user_id=user.id)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


_HISTORY_TURNS = 12


def _recent_history(db: Session, conversation_id: int) -> list[dict]:
    """The MOST RECENT turns (excluding the just-saved user message), oldest first.
    Previously this took the *oldest* 10 messages, so in any conversation longer
    than that Gemini never saw what Bri had just said — follow-ups like "yes"
    lost their referent."""
    latest = db.query(agent_models.AgentMessage).filter(
        agent_models.AgentMessage.conversation_id == conversation_id
    ).order_by(agent_models.AgentMessage.created_at.desc(), agent_models.AgentMessage.id.desc()).limit(_HISTORY_TURNS + 1).all()
    latest = list(reversed(latest))
    return [{"role": msg.role, "content": msg.content} for msg in latest[:-1]]


@router.post("/chat", response_model=agent_schemas.AgentChatResponse)
def chat_with_agent(
    request: agent_schemas.ChatRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    authorization: Optional[str] = Header(default=None),
):
    _enforce_rate_limit(user)

    conversation = _get_or_create_conversation(db, user, request.conversation_id)

    user_msg = agent_models.AgentMessage(conversation_id=conversation.id, role="user", content=request.message)
    db.add(user_msg)
    db.commit()

    history_payload = _recent_history(db, conversation.id)

    orchestrator = make_orchestrator(db, user, user_token=_extract_bearer_token(authorization))
    client_context = request.client_context.model_dump(exclude_none=True) if request.client_context else None
    result = orchestrator.process_message(request.message, history_payload, client_context, conversation_id=conversation.id)

    agent_msg = agent_models.AgentMessage(
        conversation_id=conversation.id, role="model", content=result["response"], action_payload=result["action"]
    )
    db.add(agent_msg)
    db.commit()
    db.refresh(agent_msg)

    return agent_schemas.AgentChatResponse(
        id=agent_msg.id, conversation_id=agent_msg.conversation_id, role=agent_msg.role, content=agent_msg.content,
        action_payload=agent_msg.action_payload, created_at=agent_msg.created_at,
        execution_id=result.get("execution_id"), state=result.get("state"),
    )


@router.post("/chat/stream")
def chat_with_agent_stream(
    request: agent_schemas.ChatRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    authorization: Optional[str] = Header(default=None),
):
    """Server-Sent Events variant of /chat: emits real backend state transitions
    (execution_started, state_changed, tool_started, tool_completed,
    confirmation_required, execution_completed/failed) as they actually happen,
    instead of making the UI wait silently for the whole execution to finish.

    Runs the orchestrator on its own DB session in a background thread — the
    request's injected `db` session is only used here, synchronously, to look up/
    create the conversation and save the final message, never concurrently with
    the background thread's session.
    """
    _enforce_rate_limit(user)
    conversation = _get_or_create_conversation(db, user, request.conversation_id)
    user_msg = agent_models.AgentMessage(conversation_id=conversation.id, role="user", content=request.message)
    db.add(user_msg)
    db.commit()
    history_payload = _recent_history(db, conversation.id)
    client_context = request.client_context.model_dump(exclude_none=True) if request.client_context else None
    user_token = _extract_bearer_token(authorization)
    conversation_id = conversation.id

    event_queue: "queue.Queue" = queue.Queue()

    def on_event(event: dict) -> None:
        # Every event carries conversation_id — without it, the frontend could
        # never learn a newly-created conversation's id from the stream alone,
        # and would start a fresh conversation on every subsequent message.
        event_queue.put({**event, "conversation_id": conversation_id})

    def run() -> None:
        thread_db = SessionLocal()
        try:
            orchestrator = make_orchestrator(thread_db, user, user_token=user_token)
            result = orchestrator.process_message(
                request.message, history_payload, client_context, conversation_id=conversation_id, on_event=on_event
            )
            agent_msg = agent_models.AgentMessage(
                conversation_id=conversation_id, role="model", content=result["response"], action_payload=result["action"]
            )
            thread_db.add(agent_msg)
            thread_db.commit()
            final_state = result.get("state")
            event_type = {
                "COMPLETED": "execution_completed",
                "CONFIRMATION_REQUIRED": "confirmation_required",
            }.get(final_state, "execution_failed")
            event_queue.put({
                "type": event_type, "conversation_id": conversation_id,
                "execution_id": result.get("execution_id"), "state": final_state,
                "content": result["response"], "action_payload": result["action"],
            })
        except Exception as e:
            event_queue.put({"type": "execution_failed", "conversation_id": conversation_id, "error": "internal_error"})
            print(f"[agent] stream execution failed: {e}")
        finally:
            thread_db.close()
            event_queue.put(None)

    threading.Thread(target=run, daemon=True).start()

    def event_stream():
        while True:
            item = event_queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/tool/execute", response_model=agent_schemas.ToolExecuteResponse)
def execute_tool(
    request: agent_schemas.ToolExecuteRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    authorization: Optional[str] = Header(default=None),
):
    """Confirms and runs a tool the agent proposed but did not execute
    (risk_level == write_confirm). Re-validates auth/ownership/schema itself —
    never trusts that the frontend correctly gated the click."""
    conversation = db.query(agent_models.AgentConversation).filter(
        agent_models.AgentConversation.id == request.conversation_id,
        agent_models.AgentConversation.user_id == user.id
    ).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    orchestrator = make_orchestrator(db, user, user_token=_extract_bearer_token(authorization))
    outcome = orchestrator.execute_confirmed_tool(request.tool_name, request.tool_args, conversation_id=request.conversation_id)

    is_replay = outcome.get("idempotent_replay", False)
    if outcome["status"] == "executed":
        message = "This was already completed." if is_replay else (outcome.get("message") or "Done.")
    elif outcome["status"] == "denied":
        message = outcome.get("error") or "That action isn't available."
    else:
        message = outcome.get("error") or "That action couldn't be completed."

    if not is_replay:
        agent_msg = agent_models.AgentMessage(
            conversation_id=conversation.id, role="model", content=message, action_payload=outcome.get("action"),
        )
        db.add(agent_msg)
        db.commit()

    return agent_schemas.ToolExecuteResponse(
        status=outcome["status"], tool_name=request.tool_name, result=outcome.get("result"), message=message,
        idempotent_replay=is_replay, action=outcome.get("action"),
    )


@router.get("/conversations", response_model=List[agent_schemas.AgentConversationResponse])
def get_conversations(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    return db.query(agent_models.AgentConversation).filter(
        agent_models.AgentConversation.user_id == user.id
    ).order_by(agent_models.AgentConversation.updated_at.desc()).all()

@router.get("/conversations/{conversation_id}", response_model=agent_schemas.AgentConversationResponse)
def get_conversation_history(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    conv = db.query(agent_models.AgentConversation).filter(
        agent_models.AgentConversation.id == conversation_id,
        agent_models.AgentConversation.user_id == user.id
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


# ---------------------------------------------------------------------------
# Gemini Live (optional real-time voice). Every endpoint degrades to a
# structured "unavailable" answer; the frontend then keeps the existing
# chat + voice-input experience. See services/bri_v2/live.py.
# ---------------------------------------------------------------------------

from pydantic import BaseModel, Field  # noqa: E402

from ..services.bri_v2 import config as bri_config, live as bri_live  # noqa: E402
from ..services.bri_v2.orchestrator import BriAgentV2  # noqa: E402
from ..services.bri_v2.state import load_state  # noqa: E402

_live_limiter = SlidingWindowRateLimiter(
    bri_config.live_sessions_per_hour(), 3600,
    "You've started several voice sessions recently — text chat is still available.",
)


class LiveSessionRequest(BaseModel):
    conversation_id: Optional[int] = None


class LiveToolRequest(BaseModel):
    conversation_id: int
    name: str = Field(..., max_length=64)
    args: dict = Field(default_factory=dict)
    transcript: str = Field(default="", max_length=2000)


class LiveTurnRequest(BaseModel):
    conversation_id: int
    role: str = Field(..., pattern="^(user|model)$")
    content: str = Field(..., min_length=1, max_length=4000)


@router.get("/live/config")
def live_config(user: CurrentUser = Depends(get_current_user)):
    ok, reason = bri_live.availability()
    return {"available": ok and not user.is_demo, "reason": "demo_mode" if (ok and user.is_demo) else reason,
            "model": bri_config.live_model() if ok else None}


@router.post("/live/session")
def live_session(request: LiveSessionRequest, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    if user.is_demo:
        return {"available": False, "reason": "demo_mode"}
    ok, reason = bri_live.availability()
    if not ok:
        return {"available": False, "reason": reason}
    _live_limiter.check(user.id)
    conversation = _get_or_create_conversation(db, user, request.conversation_id)
    state, _ = load_state(db, user.id, conversation.id)
    session = bri_live.mint_session(state.to_prompt())
    session["conversation_id"] = conversation.id
    return session


@router.post("/live/tool")
def live_tool(request: LiveToolRequest, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user),
              authorization: Optional[str] = Header(default=None)):
    if not bri_config.live_enabled():
        raise HTTPException(status_code=404, detail="Live mode is not enabled")
    _owned_conversation(db, user, request.conversation_id)
    _enforce_rate_limit(user)
    agent = BriAgentV2(db, user, user_token=_extract_bearer_token(authorization))
    outcome = agent.execute_live_tool(request.name, request.args, request.transcript, request.conversation_id)
    return {k: outcome.get(k) for k in ("status", "result", "error", "action", "message")}


@router.post("/live/turn")
def live_turn(request: LiveTurnRequest, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """Persists voice transcripts into the same conversation, so switching back
    to text chat (or falling back mid-conversation) keeps full continuity."""
    conversation = _owned_conversation(db, user, request.conversation_id)
    db.add(agent_models.AgentMessage(conversation_id=conversation.id, role=request.role, content=request.content))
    db.commit()
    if request.role == "model":
        # Keep follow-up state in sync with what Bri *said* aloud ("Want me to...?").
        from ..services.bri_v2 import followup
        from ..services.bri_v2.state import now, save_state
        state, row = load_state(db, user.id, conversation.id)
        offer = followup.extract_offer(request.content)
        options = followup.extract_choice(request.content)
        state.pending_offer = {"text": offer, "at": now()} if offer else None
        state.pending_choice = {"options": options, "question": followup.extract_question(request.content), "at": now()} if options else None
        save_state(db, user.id, conversation.id, state, row)
    return {"ok": True}


class ToolDeclineRequest(BaseModel):
    conversation_id: int


@router.post("/tool/decline")
def decline_tool(request: ToolDeclineRequest, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """The user said no to a proposed action (button or voice). Clears Bri's
    server-side pending action and records the rejection, so a later "yes"
    can never execute it and Bri doesn't re-push the same thing."""
    from ..services.bri_v2.state import save_state
    _owned_conversation(db, user, request.conversation_id)
    state, row = load_state(db, user.id, request.conversation_id)
    if state.pending_action:
        state.add_rejected(state.pending_action["tool_name"])
        db.add(agent_models.InterventionOutcome(user_id=user.id, module="general",
                                                tool_name=state.pending_action["tool_name"], outcome_type="dismissed"))
        state.pending_action = None
        save_state(db, user.id, request.conversation_id, state, row)
    return {"ok": True}
