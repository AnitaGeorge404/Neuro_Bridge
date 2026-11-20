"""
Post-execution verification: after a write tool reports success, re-read the
real database row(s) through a FRESH query and confirm the claimed state
actually exists. If it doesn't, the outcome is downgraded to an error, so Bri
can never say "I've created your three steps" unless they're really there.

Tools without backend state (e.g. set_presentation_preset, which is applied
by the frontend) return True — their proof is the action payload the
frontend executes.
"""

from __future__ import annotations

from typing import Callable

from sqlalchemy.orm import Session

from ...models import adhd_models, agent_models, anxiety_models, asd_models, ocd_models


def _breakdown(db: Session, user_id: str, result: dict) -> bool:
    row = db.query(adhd_models.TaskBreakdown).filter_by(id=result.get("id"), user_id=user_id).first()
    if not row:
        return False
    db.refresh(row)
    expected = result.get("steps") or []
    if len(row.steps) != len(expected):
        return False
    by_id = {s.id: s for s in row.steps}
    for step in expected:
        db_step = by_id.get(step.get("id"))
        if db_step is None or bool(db_step.is_completed) != bool(step.get("is_completed")):
            return False
        if step.get("description") is not None and db_step.description != step["description"]:
            return False
    return True


def _focus(db: Session, user_id: str, result: dict) -> bool:
    row = db.query(adhd_models.FocusSession).filter_by(id=result.get("id"), user_id=user_id).first()
    return bool(row) and row.status == result.get("status")


def _routine(db: Session, user_id: str, result: dict) -> bool:
    ids = [s["id"] for s in result.get("steps", [])]
    if not ids:
        return False
    return db.query(asd_models.RoutineStep).filter(
        asd_models.RoutineStep.id.in_(ids), asd_models.RoutineStep.user_id == user_id
    ).count() == len(ids)


def _grounding(db: Session, user_id: str, result: dict) -> bool:
    return db.query(anxiety_models.GroundingSession).filter_by(id=result.get("id"), user_id=user_id).first() is not None


def _exposure(db: Session, user_id: str, result: dict) -> bool:
    task = db.query(ocd_models.ExposureTask).filter_by(id=result.get("task_id")).first()
    if not task:
        return False
    hierarchy = db.query(ocd_models.ExposureHierarchy).filter_by(id=task.hierarchy_id, owner_id=user_id).first()
    return hierarchy is not None


def _preference(db: Session, user_id: str, result: dict) -> bool:
    row = db.query(agent_models.AgentLearning).filter_by(user_id=user_id, key=result.get("key")).first()
    return bool(row) and row.value == result.get("value")


VERIFIERS: dict[str, Callable[[Session, str, dict], bool]] = {
    "create_task_breakdown": _breakdown,
    "update_task_step": _breakdown,
    "complete_task_step": _breakdown,
    "start_focus_session": _focus,
    "pause_focus_session": _focus,
    "resume_focus_session": _focus,
    "stop_focus_session": _focus,
    "update_focus_session": _focus,
    "create_daily_routine": _routine,
    "start_grounding_activity": _grounding,
    "create_exposure": _exposure,
    "save_user_preference": _preference,
}


def verify(db: Session, user_id: str, tool_name: str, result: dict) -> bool:
    check = VERIFIERS.get(tool_name)
    if check is None:
        return True
    try:
        return bool(check(db, user_id, result or {}))
    except Exception as e:  # verification must never crash the turn
        print(f"[bri_v2] verification error for {tool_name}: {type(e).__name__}")
        return False
