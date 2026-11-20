"""
Thin adapter exposing the small slice of the legacy `google.generativeai`
surface that Bri's orchestrator (agent_service) and the OCD helpers
(ai_service) were written against — `GenerativeModel`, `start_chat`,
`send_message`, `generate_content`, `protos.Part/Content/FunctionResponse` —
implemented on the supported `google-genai` SDK.

Why an adapter instead of rewriting the orchestrator: the agent loop has ~180
tests built around this exact call shape. Keeping the shape and swapping the
engine underneath migrates every live call to google-genai (AI Studio *or*
Vertex AI, chosen by env in google_ai_service.get_genai_client) with zero
behavioural change to the state machine.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from google.genai import types as protos  # Part, Content, FunctionResponse share field names with the legacy protos

from . import google_ai_service


def configure(api_key: Optional[str] = None) -> None:  # legacy no-op; the client is built centrally
    return None


def _http_options(request_options: Optional[dict]) -> Optional[protos.HttpOptions]:
    timeout_s = (request_options or {}).get("timeout")
    return protos.HttpOptions(timeout=int(timeout_s * 1000)) if timeout_s else None


def _to_tools(tools: Optional[Iterable[dict]]) -> Optional[list[protos.Tool]]:
    if not tools:
        return None
    out = []
    for tool in tools:
        decls = [
            protos.FunctionDeclaration(
                name=d["name"],
                description=d.get("description", ""),
                parameters_json_schema=d.get("parameters") or {"type": "object", "properties": {}},
            )
            for d in tool.get("function_declarations", [])
        ]
        out.append(protos.Tool(function_declarations=decls))
    return out


def _to_parts(message: Any) -> Any:
    if isinstance(message, protos.Content):
        return list(message.parts or [])
    return message


class _Response:
    """Normalises `.text` to a str (google-genai returns None for tool-only turns)."""

    def __init__(self, raw: Any):
        self._raw = raw
        self.candidates = raw.candidates or []

    @property
    def text(self) -> str:
        try:
            return self._raw.text or ""
        except Exception:
            return ""


class _Chat:
    def __init__(self, model: "GenerativeModel", history: list):
        self._model = model
        self._active_model = model.model_name
        self._chat = model._client.chats.create(model=self._active_model, config=model._config(), history=history)

    def send_message(self, message: Any, request_options: Optional[dict] = None):
        config = self._model._config(request_options)
        parts = _to_parts(message)

        def _send(model_name: str):
            if model_name != self._active_model:
                # Switch model mid-conversation without losing context: carry the curated history over.
                history = self._chat.get_history(curated=True)
                self._chat = self._model._client.chats.create(model=model_name, config=self._model._config(), history=history)
                self._active_model = model_name
            return self._chat.send_message(parts, config=config)

        raw, _ = google_ai_service.call_with_fallback("chat_send_message", self._active_model, _send)
        return _Response(raw)


class GenerativeModel:
    def __init__(self, model_name: Optional[str] = None, tools: Optional[list] = None, system_instruction: Optional[str] = None):
        self.model_name = model_name or google_ai_service.MODEL_FLASH
        self._tools = _to_tools(tools)
        self._system_instruction = system_instruction
        self._client = google_ai_service.get_genai_client()
        if self._client is None:
            raise RuntimeError("Google GenAI is not configured (set GEMINI_API_KEY or Vertex AI env).")

    def _config(self, request_options: Optional[dict] = None) -> protos.GenerateContentConfig:
        return protos.GenerateContentConfig(
            system_instruction=self._system_instruction,
            tools=self._tools,
            # The orchestrator owns tool execution (risk tiers, confirmation gates, audit log),
            # so the SDK must never auto-run functions on its own.
            automatic_function_calling=protos.AutomaticFunctionCallingConfig(disable=True) if self._tools else None,
            http_options=_http_options(request_options),
        )

    def start_chat(self, history: Optional[list] = None) -> _Chat:
        contents = [
            protos.Content(role=turn["role"], parts=[protos.Part.from_text(text=str(p)) for p in turn.get("parts", [])])
            for turn in (history or [])
        ]
        return _Chat(self, contents)

    def generate_content(self, prompt: Any, request_options: Optional[dict] = None):
        raw, _ = google_ai_service.call_with_fallback(
            "generate_content", self.model_name,
            lambda m: self._client.models.generate_content(model=m, contents=prompt, config=self._config(request_options)),
        )
        return _Response(raw)
