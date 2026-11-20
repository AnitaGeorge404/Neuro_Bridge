"""
Deterministic, backend-enforced action policy for Bri V2.

Gemini *requests* actions; this module decides. Nothing here depends on
prompt wording, so a hallucinated or injected tool call can't talk its way
past it.

Tiers:
  LOW       read + write_low tools — run when requested.
  MODERATE  confirm-gated, but reversible/additive (e.g. saving a breakdown):
            runs directly ONLY when the user explicitly asked for it this turn
            (typed request, or "yes" to Bri's own offer of it); otherwise proposed.
  HIGH      destructive, clinical, or OCD-exposure writes: ALWAYS proposed and
            confirmed, never auto-run — regardless of what the user typed.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Optional

from ..agent_tools import RiskLevel, Tool


class Tier(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


# Confirm-gated tools that are additive and easy to undo. Anything confirm-gated
# and NOT listed here is HIGH by default (fail closed).
_MODERATE_TOOLS = {"create_task_breakdown"}

# What counts as the user explicitly requesting a moderate/gated tool.
_EXPLICIT_REQUEST = {
    "create_task_breakdown": re.compile(
        r"\b(break down|break (it|this|that|them|.+?) down|split (it|this|that|.+?) (up|into)|smaller steps|into steps|"
        r"steps for|step[- ]by[- ]step|make (the )?(first )?steps?|first step smaller|chunk (it|this))\b",
        re.IGNORECASE,
    ),
    "save_user_preference": re.compile(
        r"\b(remember|from now on|always (give|use|keep|make)|i prefer|please keep (it|replies|answers))\b", re.IGNORECASE
    ),
}

# Tools that may ONLY run on an explicit user request (never on model initiative).
_EXPLICIT_ONLY = {"save_user_preference"}

MAX_TOOL_EXECUTIONS_PER_TURN = 8
_MAX_STRING = 500
_INT_BOUNDS = {
    "pre_suds": (0, 100), "post_suds": (0, 100), "value": (0, 100), "estimated_suds": (0, 100),
    "duration_minutes": (1, 240), "new_estimated_minutes": (1, 240),
    "step_index": (0, 50), "new_order_index": (0, 200),
}


def tier_for(tool: Tool) -> Tier:
    if tool.risk_level != RiskLevel.WRITE_CONFIRM:
        return Tier.LOW
    return Tier.MODERATE if tool.name in _MODERATE_TOOLS else Tier.HIGH


def user_explicitly_requested(tool_name: str, user_message: str, accepted_offer: Optional[str] = None) -> bool:
    pattern = _EXPLICIT_REQUEST.get(tool_name)
    if not pattern:
        return False
    if pattern.search(user_message or ""):
        return True
    # "Yes" to Bri's own offer of this exact kind of action counts as an explicit request.
    return bool(accepted_offer and pattern.search(accepted_offer))


def decide(tool: Tool, user_message: str, accepted_offer: Optional[str] = None) -> str:
    """Returns 'execute' | 'confirm' | 'deny'."""
    if tool.name in _EXPLICIT_ONLY and not user_explicitly_requested(tool.name, user_message, None):
        return "deny"
    tier = tier_for(tool)
    if tier == Tier.LOW:
        return "execute"
    if tier == Tier.MODERATE and user_explicitly_requested(tool.name, user_message, accepted_offer):
        return "execute"
    return "confirm"


def validate_args(tool: Tool, args: dict) -> tuple[dict, Optional[str]]:
    """Validate + lightly coerce args against the tool's JSON schema.
    Returns (clean_args, error). Unknown keys are dropped, never passed through."""
    schema = tool.parameters or {}
    props: dict[str, Any] = schema.get("properties", {})
    clean: dict[str, Any] = {}
    for key, value in (args or {}).items():
        spec = props.get(key)
        if spec is None or value is None:
            continue
        typ = spec.get("type")
        try:
            if typ == "integer":
                if isinstance(value, bool):
                    raise ValueError
                if isinstance(value, float) and not value.is_integer():
                    raise ValueError
                value = int(value)
                lo, hi = _INT_BOUNDS.get(key, (-10**6, 10**6))
                if not lo <= value <= hi:
                    return {}, f"'{key}' must be between {lo} and {hi}."
            elif typ == "number":
                value = float(value)
            elif typ == "boolean":
                if not isinstance(value, bool):
                    raise ValueError
            elif typ == "string":
                if not isinstance(value, str):
                    raise ValueError
                value = value.strip()[:_MAX_STRING]
        except (TypeError, ValueError):
            return {}, f"'{key}' has the wrong type (expected {typ})."
        enum = spec.get("enum")
        if enum and value not in enum:
            return {}, f"'{key}' must be one of {enum}."
        clean[key] = value
    missing = [k for k in schema.get("required", []) if clean.get(k) in (None, "")]
    if missing:
        return {}, f"Missing required argument(s): {', '.join(missing)}."
    return clean, None
