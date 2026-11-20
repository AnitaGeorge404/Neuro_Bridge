import { useCallback, useEffect, useRef, useState } from "react";
import useAgentStore from "@/stores/agentStore";
import { GeminiLiveSession, fetchLiveConfig, liveSupported } from "@/lib/geminiLive";

const FALLBACK_COPY = {
  disabled: null,
  not_configured: null,
  demo_mode: null,
  quota_exceeded: "Live voice is busy right now — switched back to regular chat and voice input.",
  policy_or_quota: "Live voice was stopped by the provider — switched back to regular chat and voice input.",
  session_expiring: "The live voice session ended — switched back to regular chat. You can start it again.",
  connection_closed: "Lost the live voice connection — switched back to regular chat and voice input.",
};

/**
 * Optional Gemini Live mode for Bri. `available` is false unless the backend
 * says Live is enabled AND configured AND the browser can do it — otherwise the
 * existing chat + voice input (useAgentVoice) is the only path, unchanged.
 */
export default function useGeminiLive(user) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState("idle"); // idle|connecting|listening|speaking|acting
  const [notice, setNotice] = useState(null);
  const sessionRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!user || !liveSupported()) return undefined;
    fetchLiveConfig(user).then((cfg) => { if (!cancelled) setAvailable(!!cfg.available); });
    return () => { cancelled = true; };
  }, [user]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setNotice(null);
    const store = useAgentStore.getState();
    const session = new GeminiLiveSession({
      user,
      conversationId: store.conversationId,
      onState: setState,
      onConversation: (id) => useAgentStore.setState({ conversationId: id }),
      onTranscript: (role, text, final) => {
        if (!final) return;
        useAgentStore.getState().addMessage({ id: `live-${Date.now()}-${role}`, role, content: text, action_payload: null });
      },
      onAction: (action, toolName) => {
        // Verified backend action -> same frontend action pipeline as text chat.
        useAgentStore.getState().addMessage({
          id: `live-action-${Date.now()}`, role: "model",
          content: `Done: ${toolName.replaceAll("_", " ")}.`, action_payload: action,
        });
      },
      onFallback: (reason) => {
        sessionRef.current = null;
        setState("idle");
        setNotice(FALLBACK_COPY[reason] ?? FALLBACK_COPY.connection_closed);
      },
    });
    sessionRef.current = session;
    try {
      await session.start();
    } catch (e) {
      session.stop();
      sessionRef.current = null;
      setState("idle");
      if (e?.reason) setAvailable(false);
      setNotice(
        e?.name === "NotAllowedError"
          ? "Microphone access was blocked — you can keep using text chat."
          : FALLBACK_COPY[e?.reason] ?? "Live voice isn't available right now — regular chat and voice input still work.",
      );
    }
  }, [user]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  return { available, active: state !== "idle", state, start, stop, notice, clearNotice: () => setNotice(null) };
}
