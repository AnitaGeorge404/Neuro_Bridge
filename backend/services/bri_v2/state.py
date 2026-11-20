"""
Lightweight, persisted conversational state for Bri V2.

One JSON blob per conversation (agent_conversation_states). Small by design:
only what's needed to resolve follow-ups and avoid repeating rejected help.
Everything is user-scoped (conversation ownership is checked by the router,
and every load filters on user_id too).
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...models import agent_models

# Pending offers/actions older than this are stale — a "yes" an hour later
# shouldn't silently execute something proposed long ago.
PENDING_TTL_S = 30 * 60
MAX_REJECTED = 5


@dataclass
class ConversationState:
    topic: Optional[str] = None  # short description of the current problem/goal (user's own words)
    mode: str = "conversation"  # emotional_support | action | planning | information | thinking | conversation
    pending_offer: Optional[dict] = None  # {"text", "at"} — a prose offer Bri made ("Want me to ...?")
    pending_choice: Optional[dict] = None  # {"options": [...], "question", "at"}
    pending_question: Optional[dict] = None  # {"text", "at"} — last open question Bri asked
    pending_action: Optional[dict] = None  # {"tool_name", "tool_args", "at"} — structured, awaiting confirmation
    active_breakdown_id: Optional[int] = None
    active_focus: bool = False
    last_action: Optional[dict] = None  # {"tool", "summary", "at"}
    rejected: list[str] = field(default_factory=list)  # approaches the user declined this conversation
    stuck_count: int = 0
    response_length: Optional[str] = None  # per-conversation "shorter"/"more detail"
    turn: int = 0

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _fresh(entry: Optional[dict]) -> Optional[dict]:
        if not entry:
            return None
        return entry if time.time() - entry.get("at", 0) <= PENDING_TTL_S else None

    def expire_stale(self) -> None:
        self.pending_offer = self._fresh(self.pending_offer)
        self.pending_choice = self._fresh(self.pending_choice)
        self.pending_question = self._fresh(self.pending_question)
        self.pending_action = self._fresh(self.pending_action)

    def clear_pending(self) -> None:
        self.pending_offer = self.pending_choice = self.pending_question = self.pending_action = None

    def add_rejected(self, text: Optional[str]) -> None:
        if text and text not in self.rejected:
            self.rejected = (self.rejected + [text[:160]])[-MAX_REJECTED:]

    def has_referent(self) -> bool:
        return any((self.pending_offer, self.pending_choice, self.pending_action, self.pending_question, self.active_breakdown_id))

    def to_prompt(self) -> str:
        """Compact, model-facing summary. Only non-empty fields."""
        lines = []
        if self.topic:
            lines.append(f"- Current topic/goal (user's words): {self.topic}")
        if self.pending_action:
            lines.append(f"- Awaiting the user's confirmation for action: {self.pending_action['tool_name']} {self.pending_action.get('tool_args') or {}}")
        if self.pending_offer:
            lines.append(f"- Your last offer to the user: \"{self.pending_offer['text']}\"")
        if self.pending_choice:
            lines.append(f"- You offered a choice between: {self.pending_choice['options']}")
        elif self.pending_question:
            lines.append(f"- Your last open question: \"{self.pending_question['text']}\"")
        if self.active_breakdown_id:
            lines.append(f"- Active task breakdown id: {self.active_breakdown_id} (use get_task_breakdown for its steps)")
        if self.last_action:
            lines.append(f"- Last action you actually performed: {self.last_action['tool']} — {self.last_action.get('summary', '')}")
        if self.rejected:
            lines.append(f"- The user declined these this conversation — do NOT re-offer them: {self.rejected}")
        if self.stuck_count:
            lines.append(f"- The user has said they're still stuck {self.stuck_count} time(s) — change approach, don't repeat.")
        if self.response_length:
            lines.append(f"- Preferred reply length this conversation: {self.response_length}")
        return "\n".join(lines) or "- (fresh conversation, nothing pending)"


def load_state(db: Session, user_id: str, conversation_id: Optional[int]) -> tuple[ConversationState, Optional[agent_models.AgentConversationState]]:
    if conversation_id is None:
        return ConversationState(), None
    row = (
        db.query(agent_models.AgentConversationState)
        .filter_by(conversation_id=conversation_id, user_id=user_id)
        .first()
    )
    if not row or not isinstance(row.state, dict):
        return ConversationState(), row
    known = {k: v for k, v in row.state.items() if k in ConversationState.__dataclass_fields__}
    try:
        state = ConversationState(**known)
    except TypeError:
        state = ConversationState()
    state.expire_stale()
    return state, row


def save_state(db: Session, user_id: str, conversation_id: Optional[int], state: ConversationState,
               row: Optional[agent_models.AgentConversationState] = None) -> None:
    if conversation_id is None:
        return
    payload: dict[str, Any] = asdict(state)
    if row is None:
        row = (
            db.query(agent_models.AgentConversationState)
            .filter_by(conversation_id=conversation_id, user_id=user_id)
            .first()
        )
    if row is None:
        db.add(agent_models.AgentConversationState(conversation_id=conversation_id, user_id=user_id, state=payload))
    else:
        row.state = payload  # reassign (not mutate) so SQLAlchemy sees the JSON change
    db.commit()


def now() -> float:
    return time.time()
