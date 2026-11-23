import { beforeEach, describe, expect, it } from "vitest";
import { abandonSupportModule, completeSupportModule, executeSupportModule } from "@/support/execution";
import { createLocalRole4Repository } from "@/support/persistence/role4Repository";
import { startToolInteraction, ToolEventType, trackToolEvent } from "@/support/persistence/toolInteractionPersistence";

const USER_A = "tool-user-a";
const USER_B = "tool-user-b";
const TOOL_IDS = [
  "support.task_breakdown",
  "support.focus_session",
  "support.gentle_activity",
  "support.grounding",
  "support.social_connection",
  "support.cognitive_reframing",
  "support.evidence_journal",
];

function request(moduleId, index) {
  return {
    userId: USER_A, moduleId, contextSnapshotId: null, triggerSource: "manual",
    selectionMode: "explicit_request", configuration: {}, metadata: { idempotencyKey: `tool-${index}` },
  };
}

describe("unified tool interaction persistence", () => {
  beforeEach(() => localStorage.clear());

  it("persists a start and terminal interaction for every executable tool", async () => {
    for (const [index, moduleId] of TOOL_IDS.entries()) {
      const started = await executeSupportModule(request(moduleId, index));
      expect(started.ok).toBe(true);
      const terminal = moduleId === "support.focus_session"
        ? await abandonSupportModule({ userId: USER_A, moduleId, interventionId: started.interventionId, outcome: { durationMs: 1, metrics: {} } })
        : await completeSupportModule({ userId: USER_A, moduleId, interventionId: started.interventionId, outcome: { durationMs: 1, metrics: {} } });
      expect(terminal.ok).toBe(true);
      expect(terminal.intervention.userId).toBe(USER_A);
    }
  });

  it("replays an explicitly idempotent event without double-counting its outcome", async () => {
    const repository = createLocalRole4Repository();
    await startToolInteraction(USER_A, { toolId: "support.grounding", interactionId: "interaction-one" }, { repository });
    const event = {
      toolId: "support.grounding", interactionId: "interaction-one", eventType: ToolEventType.COMPLETED,
      idempotencyKey: "completion-1", outcome: { completed: true, durationMs: 10, metrics: { completionRatio: 1 } },
    };
    await trackToolEvent(USER_A, event, { repository });
    const replay = await trackToolEvent(USER_A, event, { repository });
    expect(replay.duplicate).toBe(true);
    expect(await repository.listOutcomes(USER_A, "interaction-one")).toHaveLength(1);
  });

  it("does not expose one user's interaction to another user", async () => {
    const repository = createLocalRole4Repository();
    await startToolInteraction(USER_A, { toolId: "support.grounding", interactionId: "private-interaction" }, { repository });
    await expect(trackToolEvent(USER_B, {
      toolId: "support.grounding", interactionId: "private-interaction", eventType: ToolEventType.COMPLETED,
    }, { repository })).rejects.toThrow("authenticated user");
  });

  it("surfaces failed durable writes instead of reporting success", async () => {
    const repository = {
      getIntervention: async () => ({ id: "write-failure", userId: USER_A, moduleId: "support.grounding" }),
      listLifecycleEvents: async () => [],
      updateIntervention: async (record) => record,
      appendLifecycleEvent: async () => { throw new Error("database unavailable"); },
      listOutcomes: async () => [],
    };
    await expect(trackToolEvent(USER_A, {
      toolId: "support.grounding", interactionId: "write-failure", eventType: ToolEventType.STARTED,
    }, { repository })).rejects.toThrow("database unavailable");
  });
});
