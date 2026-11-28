import { beforeEach, describe, expect, it } from "vitest";
import { completeSupportModule, executeSupportModule } from "@/support/execution";
import { getInterventionHistory } from "@/support/lifecycle/interventionLifecycle";

const TOOLS = ["support.grounding", "support.cognitive_reframing", "asd.social-scenarios", "asd.emotion-decoder"];
const FIRST_TIMESTAMP = "2026-02-01T00:00:00.000Z";
const SECOND_TIMESTAMP = "2026-02-01T00:00:01.000Z";

function request(userId, moduleId) {
  return {
    userId,
    moduleId,
    contextSnapshotId: null,
    triggerSource: "manual",
    selectionMode: "explicit_request",
    configuration: {},
    metadata: {},
  };
}

describe("deterministic terminal transition semantics", () => {
  beforeEach(() => localStorage.clear());

  it("treats an identical completion event as idempotent without a second outcome", async () => {
    for (const [index, moduleId] of TOOLS.entries()) {
      const userId = `terminal-replay-${index}`;
      const started = await executeSupportModule(request(userId, moduleId));
      const command = { userId, moduleId, interventionId: started.interventionId, timestamp: FIRST_TIMESTAMP, outcome: { durationMs: 1, metrics: {} } };

      expect((await completeSupportModule(command)).ok).toBe(true);
      expect((await completeSupportModule(command)).ok).toBe(true);

      const entry = getInterventionHistory(userId).find((item) => item.intervention.id === started.interventionId);
      expect(entry.intervention.status).toBe("completed");
      expect(entry.outcomes).toHaveLength(1);
    }
  });

  it("rejects a distinct terminal completion and preserves the persisted state", async () => {
    for (const [index, moduleId] of TOOLS.entries()) {
      const userId = `terminal-rejection-${index}`;
      const started = await executeSupportModule(request(userId, moduleId));
      const first = await completeSupportModule({ userId, moduleId, interventionId: started.interventionId, timestamp: FIRST_TIMESTAMP, outcome: { durationMs: 1, metrics: {} } });
      const repeated = await completeSupportModule({ userId, moduleId, interventionId: started.interventionId, timestamp: SECOND_TIMESTAMP, outcome: { durationMs: 1, metrics: {} } });

      expect(first.ok).toBe(true);
      expect(repeated.ok).toBe(false);
      expect(repeated.reasonCodes).toContain("invalid_transition");
      const entry = getInterventionHistory(userId).find((item) => item.intervention.id === started.interventionId);
      expect(entry.intervention.status).toBe("completed");
      expect(entry.outcomes).toHaveLength(1);
    }
  });
});
