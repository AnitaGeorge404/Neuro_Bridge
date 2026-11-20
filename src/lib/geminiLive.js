/**
 * Gemini Live (real-time voice) client for Bri — OPTIONAL mode.
 *
 * - Auth: a short-lived, single-use EPHEMERAL token from our backend
 *   (POST /api/agent/live/session). The real Gemini key never reaches the browser,
 *   and the model / system prompt / tools are locked server-side in that token.
 * - Audio: mic -> 16 kHz 16-bit PCM -> realtimeInput; model audio (24 kHz PCM)
 *   is scheduled for gapless playback. `interrupted` (user barge-in) stops playback
 *   immediately. Voice activity detection is the Live API's own.
 * - Tools: Gemini's functionCalls are NOT executed here. Each is relayed to
 *   POST /api/agent/live/tool, which applies the same validation, confirmation
 *   policy and verification as text chat; the verified result goes back as a toolResponse.
 * - Transcripts of both sides are saved to the same conversation (/live/turn), so text
 *   chat — including the existing voice-input fallback — continues seamlessly.
 * - Any failure (unavailable, quota, socket error, expired session that can't resume)
 *   calls onFallback(reason); the caller switches back to the existing chat/voice path.
 */
import { API_BASE_URL, backendAuthHeaders } from "@/lib/backendAuth";

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

function floatToPcm16Base64(float32, fromRate) {
  // Downsample (nearest) if the AudioContext didn't honour 16 kHz.
  const ratio = fromRate / INPUT_RATE;
  const len = Math.floor(float32.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  let bin = "";
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64Pcm16ToFloat(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 0x8000;
  return f;
}

async function post(user, path, body) {
  const headers = await backendAuthHeaders(user);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function liveSupported() {
  return typeof window !== "undefined" && "WebSocket" in window && !!window.AudioContext &&
    !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
}

export async function fetchLiveConfig(user) {
  try {
    const headers = await backendAuthHeaders(user);
    const res = await fetch(`${API_BASE_URL}/api/agent/live/config`, { headers });
    if (!res.ok) return { available: false, reason: "unreachable" };
    return await res.json();
  } catch {
    return { available: false, reason: "unreachable" };
  }
}

export class GeminiLiveSession {
  constructor({ user, conversationId, onState, onTranscript, onAction, onFallback, onConversation }) {
    Object.assign(this, { user, conversationId, onState, onTranscript, onAction, onFallback, onConversation });
    this.ws = null;
    this.resumeHandle = null;
    this.resumed = false;
    this.closedByUser = false;
    this.userText = "";
    this.modelText = "";
    this.playHead = 0;
    this.sources = new Set();
  }

  _state(s) { this.onState?.(s); }

  async start() {
    this._state("connecting");
    const session = await post(this.user, "/api/agent/live/session", { conversation_id: this.conversationId });
    if (!session.available) throw Object.assign(new Error(session.reason || "unavailable"), { reason: session.reason });
    this.conversationId = session.conversation_id;
    this.onConversation?.(session.conversation_id);
    await this._startAudio();
    this._connect(session);
  }

  _connect(session) {
    const ws = new WebSocket(`${session.ws_url}?access_token=${encodeURIComponent(session.token)}`);
    this.ws = ws;
    ws.onopen = () => {
      const setup = { model: `models/${session.model}` };
      if (this.resumeHandle) setup.sessionResumption = { handle: this.resumeHandle };
      ws.send(JSON.stringify({ setup }));
    };
    ws.onmessage = async (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : await ev.data.text();
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      this._handle(msg);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (this.closedByUser) return;
      this._reconnectOrFallback(ev.code === 1008 ? "policy_or_quota" : "connection_closed");
    };
  }

  async _reconnectOrFallback(reason) {
    // One resume attempt (new single-use token + resumption handle); otherwise fall back.
    if (this.resumeHandle && !this.resumed) {
      this.resumed = true;
      try {
        const session = await post(this.user, "/api/agent/live/session", { conversation_id: this.conversationId });
        if (session.available) {
          if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* noop */ } }
          this._connect(session);
          return;
        }
      } catch { /* fall through */ }
    }
    this.stop();
    this.onFallback?.(reason);
  }

  _handle(msg) {
    if (msg.setupComplete) this._state("listening");
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
      this.resumed = false;
    }
    if (msg.goAway) this._reconnectOrFallback("session_expiring");
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) this._stopPlayback(); // user barge-in
      if (sc.inputTranscription?.text) {
        this.userText += sc.inputTranscription.text;
        this.onTranscript?.("user", this.userText, false);
      }
      if (sc.outputTranscription?.text) {
        this.modelText += sc.outputTranscription.text;
        this.onTranscript?.("model", this.modelText, false);
      }
      for (const part of sc.modelTurn?.parts || []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) {
          this._state("speaking");
          this._play(part.inlineData.data);
        }
      }
      if (sc.turnComplete) this._flushTurn();
    }
    if (msg.toolCall?.functionCalls?.length) this._runTools(msg.toolCall.functionCalls);
  }

  _flushTurn() {
    const userText = this.userText.trim();
    const modelText = this.modelText.trim();
    this.userText = "";
    this.modelText = "";
    if (userText) {
      this.onTranscript?.("user", userText, true);
      post(this.user, "/api/agent/live/turn", { conversation_id: this.conversationId, role: "user", content: userText.slice(0, 4000) }).catch(() => {});
    }
    if (modelText) {
      this.onTranscript?.("model", modelText, true);
      post(this.user, "/api/agent/live/turn", { conversation_id: this.conversationId, role: "model", content: modelText.slice(0, 4000) }).catch(() => {});
    }
    this._state("listening");
  }

  async _runTools(calls) {
    this._state("acting");
    const transcript = this.userText.trim();
    const functionResponses = [];
    for (const call of calls) {
      let response;
      try {
        const r = await post(this.user, "/api/agent/live/tool", {
          conversation_id: this.conversationId, name: call.name, args: call.args || {}, transcript,
        });
        if (r.status === "executed" && r.action) this.onAction?.(r.action, call.name);
        response = r.status === "executed"
          ? { status: "success", result: r.result }
          : r.status === "confirmation_required"
            ? { status: "confirmation_required", instruction: r.message }
            : { status: "not_done", error: r.error || "That action couldn't be completed." };
      } catch {
        response = { status: "not_done", error: "The app couldn't be reached, so nothing was changed." };
      }
      functionResponses.push({ id: call.id, name: call.name, response });
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
    }
    this._state("listening");
  }

  async _startAudio() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.inCtx = new AudioContext({ sampleRate: INPUT_RATE });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.inCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.inCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.inCtx, "pcm-capture");
    let buffer = [];
    let count = 0;
    this.node.port.onmessage = (e) => {
      buffer.push(e.data);
      count += e.data.length;
      if (count < this.inCtx.sampleRate / 10) return; // ~100 ms chunks
      const merged = new Float32Array(count);
      let o = 0;
      for (const b of buffer) { merged.set(b, o); o += b.length; }
      buffer = [];
      count = 0;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          realtimeInput: { audio: { data: floatToPcm16Base64(merged, this.inCtx.sampleRate), mimeType: `audio/pcm;rate=${INPUT_RATE}` } },
        }));
      }
    };
    src.connect(this.node);
    this.outCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
  }

  _play(b64) {
    const samples = base64Pcm16ToFloat(b64);
    const buf = this.outCtx.createBuffer(1, samples.length, OUTPUT_RATE);
    buf.copyToChannel(samples, 0);
    const node = this.outCtx.createBufferSource();
    node.buffer = buf;
    node.connect(this.outCtx.destination);
    const startAt = Math.max(this.outCtx.currentTime, this.playHead);
    node.start(startAt);
    this.playHead = startAt + buf.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
  }

  _stopPlayback() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.playHead = 0;
  }

  stop() {
    this.closedByUser = true; // any stop is final; prevents onclose from re-triggering fallback
    this._flushTurn();
    this._stopPlayback();
    try { this.ws?.close(); } catch { /* noop */ }
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    this.ws = null;
    this._state("idle");
  }
}
