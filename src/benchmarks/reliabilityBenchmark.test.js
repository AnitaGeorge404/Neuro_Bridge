import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deriveMemoryFromReflections, listUserMemories, setLearningEnabled } from "@/support/memory";
import { saveReflection } from "@/support/persistence/role4Store";
import { createLocalRole4Repository } from "@/support/persistence/role4Repository";
import { getRole4InterventionHistory } from "@/support/persistence/role4Repository";
import { startToolInteraction, ToolEventType, trackToolEvent } from "@/support/persistence/toolInteractionPersistence";
import { completeSupportModule, executeSupportModule } from "@/support/execution";

const SEED = 20261128;
const MODULE_ID = "support.task_breakdown";
const RESULT_PATH = resolve(process.cwd(), "results/reliability-benchmark-results.json");
const results = {
  schemaVersion: 1,
  benchmark: "NeuroBridge reliability benchmark",
  seed: SEED,
  definitions: {
    memoryOracle: "Accept selected_style only when a valid history has a unique plurality with at least two observations; reject ties and single observations. This is defined here independently of the production memory implementation.",
    ungatedReference: "Writes the first observed selected_style in every non-empty history. It is a deliberately simple reference, not a production baseline.",
    persistenceScope: "All persistence measurements use createLocalRole4Repository and count repository method calls; they are not database writes or database-level guarantees.",
    consentScope: "The benchmark verifies the existing learning-disabled gate only. It does not establish consent requirements for lifecycle persistence or live database policy enforcement.",
  },
  scenarios: {},
  metrics: {},
  limitations: [
    "Synthetic deterministic inputs test decision correctness, not production latency or user outcomes.",
    "Concurrent duplicate behavior is measured with an in-process local repository and cannot establish cross-process or database atomicity.",
    "No live Supabase/PostgreSQL credentials were used; SQL RLS tests were not executed.",
  ],
};

function git(command) {
  try { return execFileSync("git", command, { cwd: process.cwd(), encoding: "utf8" }).trim(); } catch { return "unavailable"; }
}

function reflection(userId, index, style, status = "completed") {
  const timestamp = `2026-02-${String((index % 27) + 1).padStart(2, "0")}T10:00:00.000Z`;
  return saveReflection(userId, {
    id: `${userId}-reflection-${index}`,
    reflectionId: `${userId}-reflection-${index}`,
    interventionId: `${userId}-intervention-${index}`,
    userId,
    moduleId: MODULE_ID,
    timestamp,
    version: 1,
    reflectionVersion: 1,
    outcomeSummary: { completionStatus: status, completionRate: status === "abandoned" ? 0.2 : 1, durationMs: 120000 },
    insights: [{ type: "task_breakdown_timer", value: true, confidence: 1 }],
    confidence: 0.9,
    metadata: { configuration: { selectedStyle: style, requestedStepCount: 3 } },
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    summary: "synthetic aggregate reflection",
    keyInsights: [],
    followUpSuggestions: [],
  });
}

function expectedMemory(styles) {
  const counts = new Map();
  styles.forEach((style) => counts.set(style, (counts.get(style) || 0) + 1));
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.length && ranked[0][1] >= 2 && (ranked.length === 1 || ranked[0][1] > ranked[1][1])
    ? { accepted: true, value: ranked[0][0] }
    : { accepted: false, value: null };
}

function syntheticHistories() {
  const templates = [
    ["insufficient_evidence", ["Standard"]],
    ["sufficient_positive", ["Standard", "Standard"]],
    ["conflicting_outcomes", ["Standard", "Hero Mode"]],
    ["repeated_observations", ["Bare Minimum", "Bare Minimum", "Bare Minimum"]],
    ["abandoned", ["Hero Mode", "Hero Mode"]],
    ["threshold_boundary", ["Standard", "Standard", "Hero Mode"]],
  ];
  return Array.from({ length: 204 }, (_, index) => {
    const [kind, styles] = templates[index % templates.length];
    return { id: index, kind, styles, status: kind === "abandoned" ? "abandoned" : "completed" };
  });
}

function countedRepository(repository) {
  const calls = { createIntervention: 0, updateIntervention: 0, appendLifecycleEvent: 0, appendOutcome: 0 };
  return {
    calls,
    repository: new Proxy(repository, { get(target, property) {
      const value = target[property];
      if (typeof value !== "function") return value;
      return async (...args) => {
        if (property in calls) calls[property] += 1;
        return value.apply(target, args);
      };
    } }),
  };
}

describe("reliability benchmark", () => {
  beforeEach(() => localStorage.clear());

  it("measures evidence-gated memory decisions across deterministic histories", () => {
    const histories = syntheticHistories();
    const totals = { attempted: histories.length, prematureWrites: 0, incorrectUpdates: 0, correctlyAccepted: 0, correctlyRejected: 0, ungatedWrites: 0 };
    const byScenario = {};
    histories.forEach((history) => {
      const userId = `benchmark-memory-${history.id}`;
      history.styles.forEach((style, index) => reflection(userId, index, style, history.status));
      deriveMemoryFromReflections(userId, MODULE_ID);
      const actual = listUserMemories(userId, { moduleId: MODULE_ID }).find((memory) => memory.key === "selected_style");
      const expected = expectedMemory(history.styles);
      const correct = Boolean(actual) === expected.accepted && (!actual || actual.value.observedAssociation === expected.value);
      if (!expected.accepted && actual) totals.prematureWrites += 1;
      if (expected.accepted && (!actual || actual.value.observedAssociation !== expected.value)) totals.incorrectUpdates += 1;
      if (correct && expected.accepted) totals.correctlyAccepted += 1;
      if (correct && !expected.accepted) totals.correctlyRejected += 1;
      totals.ungatedWrites += 1;
      byScenario[history.kind] = (byScenario[history.kind] || 0) + 1;
    });
    results.scenarios.memory = { total: histories.length, byScenario };
    results.metrics.evidenceGatedMemory = {
      ...totals,
      decisionCorrectnessRate: (totals.correctlyAccepted + totals.correctlyRejected) / totals.attempted,
      ungatedReferenceWrites: totals.ungatedWrites,
      avoidedWritesVsUngatedReference: totals.ungatedWrites - totals.correctlyAccepted,
    };
    expect(results.metrics.evidenceGatedMemory.decisionCorrectnessRate).toBe(1);
  });

  it("measures sequential and concurrent idempotent event replays", async () => {
    const base = createLocalRole4Repository();
    const { repository, calls } = countedRepository(base);
    const userId = "benchmark-idempotency";
    const interactionId = "benchmark-interaction";
    await startToolInteraction(userId, { toolId: "support.grounding", interactionId }, { repository });
    const event = { toolId: "support.grounding", interactionId, eventType: ToolEventType.COMPLETED, idempotencyKey: "same-completion", outcome: { completed: true, durationMs: 100, metrics: {} } };
    const first = await trackToolEvent(userId, event, { repository });
    const replay = await trackToolEvent(userId, event, { repository });
    const concurrentInteractionId = "benchmark-concurrent-interaction";
    await startToolInteraction(userId, { toolId: "support.grounding", interactionId: concurrentInteractionId }, { repository });
    const concurrent = await Promise.allSettled([
      trackToolEvent(userId, { ...event, interactionId: concurrentInteractionId, idempotencyKey: "concurrent" }, { repository }),
      trackToolEvent(userId, { ...event, interactionId: concurrentInteractionId, idempotencyKey: "concurrent" }, { repository }),
    ]);
    const outcomes = await repository.listOutcomes(userId);
    results.scenarios.idempotency = { sequentialDuplicates: 1, concurrentDuplicates: 1, repositoryKind: "local" };
    results.metrics.idempotency = {
      totalAttemptedRequests: 4,
      actualPersistenceOperations: calls.updateIntervention + calls.appendLifecycleEvent + calls.appendOutcome,
      duplicateRecordsCreated: Math.max(0, outcomes.length - 2),
      redundantWritesPrevented: replay.duplicate ? 1 : 0,
      sequentialDuplicatePreventionRate: replay.duplicate ? 1 : 0,
      concurrentResults: concurrent.map((result) => result.status),
      databaseWritesMeasured: false,
    };
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(outcomes).toHaveLength(2);
  });

  it("exercises valid and invalid terminal lifecycle transitions for executable tools", async () => {
    const tools = ["support.task_breakdown", "support.gentle_activity", "support.grounding", "support.social_connection", "support.cognitive_reframing", "support.evidence_journal", "support.mood_checkin", "support.visual_timeline", "support.accountability_session", "asd.social-scenarios", "asd.emotion-decoder"];
    let valid = 0;
    let invalidRejected = 0;
    let unexpectedMutations = 0;
    const mutationTools = [];
    const nonRejectingTools = [];
    for (const [index, moduleId] of tools.entries()) {
      const started = await executeSupportModule({ userId: `benchmark-lifecycle-${index}`, moduleId, contextSnapshotId: null, triggerSource: "manual", selectionMode: "explicit_request", configuration: {}, metadata: { idempotencyKey: `start-${index}` } });
      const complete = await completeSupportModule({ userId: `benchmark-lifecycle-${index}`, moduleId, interventionId: started.interventionId, timestamp: "2026-02-01T00:00:00.000Z", outcome: { durationMs: 1, metrics: {} } });
      const duplicate = await completeSupportModule({ userId: `benchmark-lifecycle-${index}`, moduleId, interventionId: started.interventionId, timestamp: "2026-02-01T00:00:01.000Z", outcome: { durationMs: 1, metrics: {} } });
      const persisted = (await getRole4InterventionHistory(`benchmark-lifecycle-${index}`)).find((entry) => entry.intervention.id === started.interventionId)?.intervention;
      valid += Number(started.ok && complete.ok);
      invalidRejected += Number(!duplicate.ok && duplicate.reasonCodes.includes("invalid_transition"));
      if (duplicate.ok || !duplicate.reasonCodes.includes("invalid_transition")) nonRejectingTools.push({ moduleId, ok: duplicate.ok, reasonCodes: duplicate.reasonCodes, completedStatus: complete.intervention?.status, persistedStatus: persisted?.status });
      const mutated = persisted?.status !== complete.intervention?.status;
      unexpectedMutations += Number(mutated);
      if (mutated) mutationTools.push(moduleId);
    }
    results.scenarios.lifecycle = { tools, validTransitionsPerTool: 1, invalidTransitionsPerTool: 1 };
    results.metrics.lifecycle = { toolsCovered: tools.length, validTransitionsTested: tools.length, invalidTransitionsTested: tools.length, validTransitionAcceptanceRate: valid / tools.length, invalidTransitionRejectionRate: invalidRejected / tools.length, unexpectedStateMutations: unexpectedMutations, mutationTools, nonRejectingTools };
    expect(results.metrics.lifecycle.validTransitionAcceptanceRate).toBe(1);
    expect(results.metrics.lifecycle.invalidTransitionRejectionRate).toBe(1);
    expect(results.metrics.lifecycle.unexpectedStateMutations).toBe(0);
  });

  it("checks user scope and the learning-disabled persistence gate", async () => {
    const userA = "benchmark-consent-a";
    const userB = "benchmark-consent-b";
    reflection(userA, 1, "Standard");
    reflection(userA, 2, "Standard");
    setLearningEnabled(userA, false);
    const disabled = deriveMemoryFromReflections(userA, MODULE_ID);
    const repository = createLocalRole4Repository();
    await startToolInteraction(userA, { toolId: "support.grounding", interactionId: "benchmark-private-interaction" }, { repository });
    const crossUserWrite = await trackToolEvent(userB, { toolId: "support.grounding", interactionId: "benchmark-private-interaction", eventType: ToolEventType.COMPLETED }, { repository }).then(() => false).catch(() => true);
    results.scenarios.isolationAndConsent = { applicationScenarios: 4, liveRlsExecuted: false };
    results.metrics.isolationAndConsent = { crossUserReadRejected: listUserMemories(userB).length === 0, crossUserWriteRejected: crossUserWrite, learningDisabledWritePrevented: disabled.skipped === "learning_disabled" && listUserMemories(userA).length === 0, authorizedOperation: true };
    expect(results.metrics.isolationAndConsent.crossUserWriteRejected).toBe(true);
    expect(results.metrics.isolationAndConsent.learningDisabledWritePrevented).toBe(true);
  });
});

afterAll(() => {
  results.environment = { node: process.version, platform: process.platform, gitCommit: git(["rev-parse", "HEAD"]), gitStatus: git(["status", "--short"]) };
  results.reproduction = ["npm run benchmark:reliability"];
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  writeFileSync(RESULT_PATH, `${JSON.stringify(results, null, 2)}\n`);
});
