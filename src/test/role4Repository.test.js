import { describe, expect, it, vi } from "vitest";
import {
  createLocalRole4Repository,
  createSupabaseFallbackRole4Repository,
  createSupabaseRole4Repository,
  getRole4Repository,
  hydrateRole4UserData,
  interventionFromRow,
  interventionToRow,
  lifecycleEventFromRow,
  lifecycleEventToRow,
  outcomeFromRow,
  outcomeToRow,
} from "@/support/persistence/role4Repository";
import { clearUserRole4Data, listInterventions, listReflections, listUserMemories } from "@/support/persistence/role4Store";
import { completeFocusSessionIntervention, startFocusSessionIntervention } from "@/support/lifecycle/focusSessionLifecycle";
import { getSupportEvidenceAsync } from "@/support/evidence/supportEvidence";

const userId = "repository-user";
const intervention = { id: "i-1", userId, moduleId: "support.focus_session", interventionType: "focus_session", category: "executive", status: "started", title: "Focus", source: "module_event", privacy: "private", tags: [], parameters: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const event = { id: "e-1", userId, interventionId: "i-1", moduleId: "support.focus_session", interventionType: "focus_session", fromStatus: "shown", toStatus: "started", source: "module_event", privacy: "private", metadata: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const outcome = { id: "o-1", userId, interventionId: "i-1", moduleId: "support.focus_session", interventionType: "focus_session", category: "executive", status: "completed", source: "module_event", privacy: "private", completed: true, durationMs: 1000, userFeedback: "helpful", metrics: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

function inMemoryRepository() {
  const interventions = []; const events = []; const outcomes = [];
  return {
    kind: "supabase",
    createIntervention: async (item) => { interventions.push(item); return item; },
    getIntervention: async (_userId, id) => interventions.find((item) => item.id === id) || null,
    updateIntervention: async (item) => { const index = interventions.findIndex((existing) => existing.id === item.id); interventions[index] = item; return item; },
    appendLifecycleEvent: async (item) => { if (events.some((existing) => existing.id === item.id)) throw new Error("Lifecycle events are append-only"); events.push(item); return item; },
    appendOutcome: async (item) => { if (outcomes.some((existing) => existing.id === item.id)) throw new Error("Outcomes are append-only"); outcomes.push(item); return item; },
    listInterventions: async () => interventions,
    listLifecycleEvents: async (_userId, id) => events.filter((item) => item.interventionId === id),
    listOutcomes: async (_userId, id) => outcomes.filter((item) => item.interventionId === id),
  };
}

describe("Role 4 repository", () => {
  it("uses Supabase only when the current authenticated session belongs to the user", async () => {
    const client = { auth: { getSession: async () => ({ data: { session: { user: { id: userId } } }, error: null }) } };
    expect((await getRole4Repository(userId, { client })).kind).toBe("supabase");
    expect((await getRole4Repository("demo-user", { client })).kind).toBe("local");
  });

  it("round-trips explicit camelCase and snake_case mappings", () => {
    expect(interventionFromRow(interventionToRow(intervention))).toMatchObject(intervention);
    expect(lifecycleEventFromRow(lifecycleEventToRow(event))).toMatchObject(event);
    expect(outcomeFromRow(outcomeToRow(outcome))).toMatchObject(outcome);
    expect(outcomeToRow(outcome)).toHaveProperty("duration_ms", 1000);
    expect(outcomeToRow(outcome)).toHaveProperty("user_feedback", "helpful");
  });

  it("converts nullable SQL optional fields back to absent JS fields", () => {
    expect(interventionFromRow({ ...interventionToRow(intervention), context_snapshot: null, description: null, route: null, rationale: null }).contextSnapshot).toBeUndefined();
    expect(lifecycleEventFromRow({ ...lifecycleEventToRow(event), context_snapshot: null, reason: null }).contextSnapshot).toBeUndefined();
    expect(outcomeFromRow({ ...outcomeToRow(outcome), context_snapshot: null, user_feedback: null, duration_ms: null }).contextSnapshot).toBeUndefined();
  });

  it("keeps local demo events and outcomes append-only through the repository", async () => {
    const repository = createLocalRole4Repository();
    await repository.appendLifecycleEvent(event);
    await expect(repository.appendLifecycleEvent(event)).rejects.toThrow("append-only");
    await repository.appendOutcome(outcome);
    await expect(repository.appendOutcome(outcome)).rejects.toThrow("append-only");
  });

  it("surfaces failed Supabase writes", async () => {
    const client = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "RLS denied" } }) }) }) }) };
    await expect(createSupabaseRole4Repository(client).createIntervention(intervention)).rejects.toThrow("RLS denied");
  });

  it("falls back to and stays with local persistence after a Supabase write fails", async () => {
    const remote = { createIntervention: vi.fn().mockRejectedValue(new Error("offline")) };
    const local = { createIntervention: vi.fn().mockResolvedValue(intervention) };
    const repository = createSupabaseFallbackRole4Repository(remote, local);
    await expect(repository.createIntervention(intervention)).rejects.toThrow("offline");
    expect(remote.createIntervention).toHaveBeenCalledTimes(1);
    expect(local.createIntervention).not.toHaveBeenCalled();
  });

  it("hydrates only the authenticated user's remote history into the local read cache", async () => {
    clearUserRole4Data(userId);
    const reflection = { id: "r-1", userId, interventionId: intervention.id, moduleId: intervention.moduleId, reflectionId: "r-1", timestamp: intervention.createdAt, version: 1, reflectionVersion: 1, summary: "completed", insights: [], keyInsights: [], followUpSuggestions: [], confidence: "low", metadata: {}, evidenceOutcomeIds: [], privacy: "private", source: "system_inference", createdAt: intervention.createdAt, updatedAt: intervention.updatedAt };
    const memory = { id: "m-1", userId, memoryId: "m-1", moduleId: intervention.moduleId, category: "successful_strategy", type: "successful_strategy", key: "focus", value: { observedAssociation: "completed" }, supportingReflectionIds: [], confidence: "moderate", version: 1, status: "active", contradictionCount: 0, metadata: {}, privacy: "private", source: "system_inference", evidenceIds: [], createdAt: intervention.createdAt, updatedAt: intervention.updatedAt };
    const rows = {
      support_interventions: [interventionToRow(intervention)],
      support_lifecycle_events: [lifecycleEventToRow(event)],
      support_outcomes: [outcomeToRow(outcome)],
      support_reflections: [{ ...reflection, schema_version: 1, user_id: userId, intervention_id: intervention.id, module_id: intervention.moduleId, reflection_id: reflection.reflectionId, outcome_summary: null, key_insights: [], follow_up_suggestions: [], evidence_outcome_ids: [], created_at: reflection.createdAt, updated_at: reflection.updatedAt }],
      support_memories: [{ ...memory, schema_version: 1, user_id: userId, memory_id: memory.memoryId, module_id: memory.moduleId, evidence_count: null, supporting_reflection_ids: [], confidence_level: null, first_observed_at: null, last_updated_at: null, contradiction_count: 0, evidence_ids: [], expires_at: null, archived_at: null, deleted_at: null, created_at: memory.createdAt, updated_at: memory.updatedAt }],
    };
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: userId } } }, error: null }) },
      from: (table) => {
        const query = {
          select: () => query,
          eq: () => query,
          order: async () => ({ data: rows[table], error: null }),
        };
        return query;
      },
    };

    await expect(hydrateRole4UserData(userId, { client })).resolves.toBe(true);
    expect(listInterventions(userId)).toHaveLength(1);
    expect(listReflections(userId)).toHaveLength(1);
    expect(listUserMemories(userId)).toHaveLength(1);
    expect(listInterventions("another-user")).toEqual([]);
  });

  it("persists Focus start, completion, and reconstructed history through an injected remote boundary", async () => {
    const repository = inMemoryRepository();
    const started = await startFocusSessionIntervention({ userId, interventionId: "focus-1", repository });
    const completed = await completeFocusSessionIntervention({ userId, interventionId: started.intervention.id, repository, outcome: { durationMs: 1500, metrics: { plannedDurationMinutes: 25, completedNaturally: true } } });
    expect(completed.outcome.metrics.completedNaturally).toBe(true);
    expect(await repository.listLifecycleEvents(userId, "focus-1")).toHaveLength(3);
    expect(await repository.listOutcomes(userId, "focus-1")).toHaveLength(1);
    expect((await repository.getIntervention(userId, "focus-1")).status).toBe("completed");
  });

  it("derives an advisory shorter Focus configuration from repository outcomes only", async () => {
    const outcomes = [1, 2, 3].map((id) => ({ ...outcome, id: `short-${id}`, interventionId: `focus-${id}`, createdAt: `2026-01-0${id}T00:00:00.000Z`, metrics: { plannedDurationMinutes: 15, completionRatio: 1, finalConfiguration: { plannedDurationMinutes: 15, breakDurationMinutes: 5 } } }));
    const repository = { listInterventions: async () => [], listLifecycleEvents: async () => outcomes.map((item) => ({ interventionId: item.interventionId, moduleId: item.moduleId, toStatus: "started" })), listOutcomes: async () => outcomes };
    const evidence = await getSupportEvidenceAsync(userId, ["support.focus_session"], { repository });
    expect(evidence.modules[0].preferredConfiguration).toMatchObject({ values: { plannedDurationMinutes: 15, breakDurationMinutes: 5 }, advisory: true });
  });
});
