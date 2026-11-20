"""Bri V2 — conversational state, follow-up engine, deterministic action policy,
execution verification. Built ON TOP of the V1 AgentOrchestrator (subclass),
which stays intact as the fallback. See docs/BRI_AGENT_UPGRADE.md."""

from . import config


def make_orchestrator(db, user, user_token=None):
    """Router entry point: V2 when enabled, V1 otherwise — or if V2 can't even
    be constructed (import/config error), so chat never goes down with it."""
    from ..agent_service import AgentOrchestrator

    if config.v2_enabled():
        try:
            from .orchestrator import BriAgentV2
            return BriAgentV2(db, user, user_token=user_token)
        except Exception as e:
            print(f"[bri_v2] construction failed, using V1: {type(e).__name__}")
    return AgentOrchestrator(db, user, user_token=user_token)
