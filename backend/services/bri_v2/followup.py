"""
Deterministic follow-up understanding for short replies.

Short replies ("yes", "the first one", "make it easier", "I finished it") carry
almost no meaning on their own — their meaning comes from what Bri just
offered/asked. This module only classifies the *shape* of the reply; the
orchestrator resolves it against ConversationState. Deterministic on purpose:
it's cheap, testable, and never invents an action. Anything it isn't sure
about returns kind=None and is left to Gemini (with the state injected).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# Ordered: first match wins. Each pattern must match the WHOLE (normalized)
# message or a clearly-leading phrase, so long messages that merely contain
# "yes" somewhere aren't misread as an acceptance.
_AFFIRM = r"(yes|yeah|yep|yup|sure|ok|okay|k|please|please do|do it|do that|go ahead|go for it|sounds good|let'?s do it|let'?s do that|that works|alright|yes please|ok do it|okay do it|sure thing|absolutely|definitely|that one|that sounds good)"
_DENY = r"(no|nope|nah|no thanks|no thank you|don'?t|i don'?t want (to|that)|i don'?t like (that|it|this)|that doesn'?t work( for me)?|not that|cancel( that| it)?|never ?mind)"
_DEFER = r"(not now|later|maybe later|not right now|not today|another time|some other time)"
_MAYBE = r"(maybe|i guess|i'?m not sure|not sure|idk|i don'?t know|perhaps|kind of|sort of)"
_STOP = r"(stop|stop it|enough|that'?s enough|leave it|forget it)"
_EASIER = r"(make it easier|easier|smaller|make it smaller|simpler|make it simpler|too (hard|much|big)|that'?s too (hard|much|big)|smaller steps?)"
_SHORTER = r"(shorter|too long|tl;?dr|less detail|briefer|keep it short)"
_LONGER = r"(more detail(ed)?|more details|explain more|tell me more|elaborate|go deeper)"
_WHY = r"(why|why\?|why that|why that one|how come)"
_NEXT = r"(what next|what'?s next|now what|next step|what do i do now|then what|and then)"
_CONTINUE = r"(continue|keep going|go on|carry on|next|more)"
_DONE = r"(i('?m| am)? (finished|done)( with)?( it| that| this| the (first|next|last) (one|step))?|finished( it)?|done( it)?|completed( it)?|i (did|completed) it|i finished( it)?|all done)"
_FAILED = r"(i (couldn'?t|could not|can'?t|cannot|didn'?t|did not) (do|manage|finish|start)( it| that)?|i('?m| am) still stuck|still stuck|i still can'?t( do it)?|it didn'?t (work|help)|that didn'?t (work|help)|i failed)"
_DIFFERENT = r"(let'?s try something else|try something else|something else|another (way|approach|idea)|different (approach|idea|way)|anything else)"
_CHANGE = r"(can you change it|change it|change that|can you change (that|this)|edit it|adjust it)"
_CORRECTION = r"(actually,? i meant|i meant|no,? i meant|what i meant (was|is)|actually)"

_ORDINALS = {
    "first": 0, "1st": 0, "one": 0, "1": 0,
    "second": 1, "2nd": 1, "two": 1, "2": 1,
    "third": 2, "3rd": 2, "three": 2, "3": 2,
    "fourth": 3, "4th": 3, "four": 3, "4": 3,
    "fifth": 4, "5th": 4, "five": 4, "5": 4,
    "last": -1, "final": -1,
}
_SELECT = re.compile(
    r"^(the |option |number |#)?(?P<ord>first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|final|one|two|three|four|five|[1-5])"
    r"( one| option| step| task)?( please)?$"
)
_SELECT_LEADING = re.compile(r"^(let'?s (do|go with|start with) |i'?ll (take|go with|do) |go with |start with )(the )?(?P<rest>.+)$")


@dataclass(frozen=True)
class FollowUp:
    kind: Optional[str]  # affirm|deny|defer|maybe|stop|easier|shorter|longer|why|next|continue|done|failed|different|change|correction|select|None
    ordinal: Optional[int] = None  # for kind == "select" (0-based, -1 = last)
    choice_text: Optional[str] = None  # free-text choice ("the easiest") for matching against offered options
    remainder: str = ""  # for "correction": what came after "actually I meant"


def _normalize(message: str) -> str:
    text = message.strip().lower()
    text = re.sub(r"[!.,?]+$", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _full(pattern: str, text: str) -> bool:
    return re.fullmatch(pattern + r"( (please|thanks|thank you))?", text) is not None


def is_short_reply(message: str) -> bool:
    return len(_normalize(message).split()) <= 8


def classify(message: str) -> FollowUp:
    text = _normalize(message)
    if not text:
        return FollowUp(None)

    m = re.match(_CORRECTION + r"[, ]+(?P<rest>.+)$", text)
    if m and len(text.split()) > 2:
        return FollowUp("correction", remainder=m.group("rest"))

    # Long messages carry their own meaning — leave them to Gemini.
    if len(text.split()) > 8:
        return FollowUp(None)

    for kind, pattern in (
        ("done", _DONE), ("failed", _FAILED), ("defer", _DEFER), ("different", _DIFFERENT),
        ("easier", _EASIER), ("shorter", _SHORTER), ("longer", _LONGER), ("change", _CHANGE),
        ("next", _NEXT), ("why", _WHY), ("stop", _STOP), ("deny", _DENY), ("maybe", _MAYBE),
        ("affirm", _AFFIRM + r"([, ]+" + _AFFIRM + r")*"), ("continue", _CONTINUE),
    ):
        if _full(pattern, text):
            return FollowUp(kind)

    # "yes, the first one" / "ok let's do the easiest"
    stripped = re.sub(r"^(" + _AFFIRM + r")[, ]+", "", text)
    lead = _SELECT_LEADING.match(stripped)
    candidate = lead.group("rest") if lead else stripped
    sel = _SELECT.match(candidate)
    if sel:
        return FollowUp("select", ordinal=_ORDINALS[sel.group("ord")])
    if lead or re.match(r"^the \w+( one)?$", candidate):
        return FollowUp("select", choice_text=re.sub(r"^the |( one)$", "", candidate).strip())
    # "no, that doesn't work for me" / "nah, something else"
    if re.match(r"^(no|nope|nah)[, ]+", text) and len(text.split()) <= 8:
        return FollowUp("deny")
    return FollowUp(None)


# --- detecting what Bri itself just offered/asked ---------------------------

_OFFER_RE = re.compile(
    r"(want me to|would you like me to|shall i|should i|do you want me to|i can [^.?!]*(if you(?:'d)? like|if you want)|"
    r"would it help if i|how about i|want to try|would you like to try|want to give [^?]* a try|ready to)\b[^?]*\?",
    re.IGNORECASE,
)
_CHOICE_RE = re.compile(
    r"(?:would you (?:prefer|rather|like)(?: to)?|do you want(?: to)?|should we|want to)\s+(?P<a>[^?]+?)\s+or\s+(?P<b>[^?]+?)\?",
    re.IGNORECASE,
)
_QUESTION_RE = re.compile(r"[^.?!]*\?")


def extract_offer(reply: str) -> Optional[str]:
    """The last explicit offer Bri made in its reply, verbatim (or None)."""
    matches = list(_OFFER_RE.finditer(reply or ""))
    if not matches:
        return None
    start = matches[-1].start()
    # extend back to the sentence start for readable context
    sentence_start = max((reply.rfind(c, 0, start) for c in ".!?\n"), default=-1) + 1
    return reply[sentence_start:matches[-1].end()].strip()


def extract_choice(reply: str) -> Optional[list[str]]:
    matches = list(_CHOICE_RE.finditer(reply or ""))
    if not matches:
        return None
    m = matches[-1]
    first = re.sub(r"^(start with|go with|do|try)\s+", "", m.group("a").strip(), flags=re.IGNORECASE)
    second = re.sub(r"^(start with|go with|do|try)\s+", "", m.group("b").strip(), flags=re.IGNORECASE)
    parts = [p.strip(" ,") for p in re.split(r",\s*", first) if p.strip(" ,")] + [second.strip(" ,")]
    return [p for p in parts if p][:5]


def extract_question(reply: str) -> Optional[str]:
    questions = _QUESTION_RE.findall(reply or "")
    return questions[-1].strip() if questions else None


def match_choice(options: list[str], follow: FollowUp) -> Optional[int]:
    """Resolve 'the first one' / 'the easiest' against offered options."""
    if not options:
        return None
    if follow.ordinal is not None:
        idx = follow.ordinal if follow.ordinal >= 0 else len(options) - 1
        return idx if 0 <= idx < len(options) else None
    if follow.choice_text:
        needle = follow.choice_text.lower()
        hits = [i for i, opt in enumerate(options) if needle in opt.lower() or any(w in opt.lower() for w in needle.split() if len(w) > 3)]
        return hits[0] if len(hits) == 1 else None
    return None


# --- interaction mode (what kind of help the user wants) --------------------

_MODE_PATTERNS = (
    ("emotional_support", r"\b(overwhelm\w*|anxious|panic\w*|scared|sad|lonely|crying|hopeless|exhausted|burn(ed|t)? out|stressed|can'?t cope|freaking out|i feel)\b"),
    ("action", r"\b(start|create|make|add|set up|schedule|turn on|turn off|switch|save|delete|remove|pause|resume|stop|break (it|this|that)? ?down|remind)\b"),
    ("planning", r"\b(plan|organi[sz]e|prioriti[sz]e|where (do|should) i start|don'?t know where to start|what should i do first|due|deadline|assignments?)\b"),
    ("information", r"^(what|how|why|when|who|which|is|are|does|do|can)\b.*\?$"),
    ("thinking", r"\b(should i|help me (think|decide)|i'?m torn|not sure (if|whether)|pros and cons)\b"),
)


def infer_mode(message: str) -> str:
    text = (message or "").strip().lower()
    for mode, pattern in _MODE_PATTERNS:
        if re.search(pattern, text):
            return mode
    return "conversation"
