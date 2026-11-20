import { useRef, useState } from "react";
import { Check, FileUp, Loader2, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { API_BASE_URL, backendAuthHeaders } from "@/lib/backendAuth";
import { trackEvent } from "@/lib/firebase";

/**
 * Syllabus -> plan: upload goes to Google Cloud Storage, Gemini extracts
 * assignments + a 5-minute first step each, the user approves, and the steps
 * become a real task breakdown. Uploaded material is embedded so Bri (and the
 * search box) can recall it later.
 */
export default function SyllabusPlanner({ onTasksSaved }) {
  const { user } = useAuth();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);

  async function call(path, init) {
    const headers = await backendAuthHeaders(user);
    const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...(init?.headers || {}), ...headers } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || "Something went wrong.");
    return body;
  }

  async function upload(file) {
    if (!file) return;
    setBusy(true); setError(""); setResult(null); setSavedId(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const body = await call("/api/documents/analyze-syllabus", { method: "POST", body: form });
      setResult(body);
      trackEvent("document_analyzed", { module: "adhd", count: body.analysis?.tasks?.length ?? 0, source: body.google?.ai_source });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function approve() {
    setBusy(true); setError("");
    try {
      const body = await call(`/api/documents/${result.document_id}/approve`, { method: "POST" });
      setSavedId(body.breakdown_id);
      trackEvent("document_tasks_approved", { module: "adhd", count: result.analysis?.tasks?.length ?? 0 });
      onTasksSaved?.(body.breakdown_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      const body = await call("/api/documents/search", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }),
      });
      setHits(body.results);
      trackEvent("semantic_search", { module: "adhd", count: body.results.length });
    } catch (err) {
      setError(err.message);
    }
  }

  const tasks = result?.analysis?.tasks ?? [];

  return (
    <section aria-labelledby="syllabus-planner-title" className="mb-[18px] rounded-[22px] border border-[#e4e8f0] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="syllabus-planner-title" className="text-[15px] font-black text-[#1d2033]">Turn a syllabus into first steps</h2>
          <p className="text-[12px] text-[#5b6478]">PDF, image or text. You'll see the plan before anything is saved.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#1d2033] px-3.5 py-2 text-[13px] font-semibold text-white focus-within:ring-2 focus-within:ring-[#7653df]">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          Upload
          <input ref={inputRef} type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                 disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}

      {result && (
        <div className="mt-4" aria-live="polite">
          <p className="text-[13px] font-bold text-[#1d2033]">{result.analysis.course_title}</p>
          <p className="mt-1 text-[12px] text-[#455067]">{result.analysis.overwhelm_reduction_advice}</p>
          <ol className="mt-3 space-y-2">
            {tasks.map((t, i) => (
              <li key={i} className="rounded-xl border border-[#eef1f6] bg-[#fafbfd] px-3 py-2 text-[12.5px]">
                <span className="font-semibold text-[#1d2033]">{t.title}</span>
                {t.due_date_hint && <span className="ml-2 text-[#7653df]">due {t.due_date_hint}</span>}
                <div className="text-[#455067]">First step: {t.first_micro_step}</div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center gap-3">
            {savedId ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#47764c]"><Check size={15} /> Saved to your tasks</span>
            ) : (
              <button type="button" onClick={approve} disabled={busy || !tasks.length}
                      className="rounded-xl bg-[#69aa65] px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-60">
                Add these steps to my tasks
              </button>
            )}
            {result.google?.ai_source === "fallback" && (
              <span className="text-[11px] text-[#8a93a6]">AI is offline, so this is a sample plan.</span>
            )}
          </div>
        </div>
      )}

      <form onSubmit={search} className="mt-4 flex gap-2" role="search">
        <label htmlFor="syllabus-search" className="sr-only">Search your uploaded courses</label>
        <input id="syllabus-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder="What's due for my essay class?"
               className="min-w-0 flex-1 rounded-xl border border-[#e4e8f0] px-3 py-2 text-[13px]" />
        <button type="submit" className="rounded-xl border border-[#e4e8f0] px-3 py-2" aria-label="Search">
          <Search size={15} />
        </button>
      </form>
      {hits && (
        <ul className="mt-2 space-y-1 text-[12px] text-[#455067]">
          {hits.length === 0 && <li>Nothing matched yet.</li>}
          {hits.map((h, i) => <li key={i}>• {h.text}</li>)}
        </ul>
      )}
    </section>
  );
}
