import { z } from "zod";
import { getSupportModuleById } from "@/support/framework/supportModuleRegistry";
import { getRole4Repository } from "./role4Repository";
import { InterventionStatus, OutcomeSource, PrivacyLevel } from "@/support/schemas/supportSchemas";
import { ROLE4_SCHEMA_VERSION, normalizeUserId } from "@/support/schemas/storageKeys";

export const ToolEventType = Object.freeze({
  STARTED: "started",
  PROGRESSED: "progressed",
  PAUSED: "paused",
  RESUMED: "resumed",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
  CANCELLED: "cancelled",
  FAILED: "failed",
  FEEDBACK: "feedback",
});

const SafeValue = z.lazy(() => z.union([
  z.string().max(128), z.number().finite(), z.boolean(), z.null(),
  z.array(SafeValue).max(32), z.record(SafeValue),
]));

const EventSchema = z.object({
  toolId: z.string().trim().min(1),
  interactionId: z.string().trim().min(1),
  eventType: z.enum(Object.values(ToolEventType)),
  timestamp: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  metadata: z.record(SafeValue).default({}),
  outcome: z.object({
    durationMs: z.number().int().nonnegative().optional(),
    rating: z.number().int().min(1).max(5).optional(),
    completed: z.boolean().optional(),
    metrics: z.record(SafeValue).default({}),
  }).optional(),
});

const EVENT_STATUS = {
  [ToolEventType.STARTED]: InterventionStatus.STARTED,
  [ToolEventType.PROGRESSED]: InterventionStatus.IN_PROGRESS,
  [ToolEventType.PAUSED]: InterventionStatus.PAUSED,
  [ToolEventType.RESUMED]: InterventionStatus.IN_PROGRESS,
  [ToolEventType.COMPLETED]: InterventionStatus.COMPLETED,
  [ToolEventType.ABANDONED]: InterventionStatus.ABANDONED,
  [ToolEventType.CANCELLED]: InterventionStatus.CANCELLED,
  [ToolEventType.FAILED]: InterventionStatus.FAILED,
  [ToolEventType.FEEDBACK]: InterventionStatus.RATED,
};

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, removeUndefined(entry)]));
  }
  return value;
}

function eventId(interactionId, eventType, key = "once") {
  return `tool-event-${interactionId}-${eventType}-${key}`;
}

function idempotencyKeyFor(event) {
  // Only callers that explicitly provide a key opt into replay semantics.
  return event.idempotencyKey || event.timestamp;
}

function outcomeId(interactionId, eventType, key = "once") {
  return `tool-outcome-${interactionId}-${eventType}-${key}`;
}

function eventReason(eventType) {
  return `tool_${eventType}`;
}

function lifecycleRecord(userId, intervention, event, fromStatus, toStatus) {
  const key = idempotencyKeyFor(event);
  return {
    schemaVersion: ROLE4_SCHEMA_VERSION,
    id: eventId(event.interactionId, event.eventType, key),
    userId,
    interventionId: intervention.id,
    moduleId: intervention.moduleId,
    interventionType: intervention.interventionType,
    fromStatus,
    toStatus,
    source: OutcomeSource.MODULE_EVENT,
    privacy: intervention.privacy || PrivacyLevel.PRIVATE,
    reason: eventReason(event.eventType),
    metadata: event.metadata,
    contextSnapshot: intervention.contextSnapshot,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  };
}

async function appendOnce(repository, record) {
  const events = await repository.listLifecycleEvents(record.userId, record.interventionId);
  const existing = events.find((item) => item.id === record.id);
  return existing || repository.appendLifecycleEvent(record);
}

async function saveOutcome(repository, intervention, event) {
  if (!event.outcome) return null;
  const key = idempotencyKeyFor(event);
  const id = outcomeId(event.interactionId, event.eventType, key);
  const existing = (await repository.listOutcomes(intervention.userId, intervention.id)).find((item) => item.id === id);
  if (existing) return existing;
  return repository.appendOutcome({
    schemaVersion: ROLE4_SCHEMA_VERSION,
    id,
    userId: intervention.userId,
    interventionId: intervention.id,
    moduleId: intervention.moduleId,
    interventionType: intervention.interventionType,
    category: intervention.category,
    status: event.eventType === ToolEventType.FEEDBACK ? intervention.status : EVENT_STATUS[event.eventType],
    source: event.eventType === ToolEventType.FEEDBACK ? OutcomeSource.USER_REPORT : OutcomeSource.MODULE_EVENT,
    privacy: intervention.privacy || PrivacyLevel.PRIVATE,
    completed: event.outcome.completed,
    durationMs: event.outcome.durationMs,
    rating: event.outcome.rating,
    metrics: event.outcome.metrics,
    contextSnapshot: intervention.contextSnapshot,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  });
}

/**
 * Records one minimal, validated interaction event using the existing Role 4
 * intervention, lifecycle-event, and outcome records. It deliberately accepts
 * no free text, raw configuration, or keystroke data.
 */
export async function trackToolEvent(userId, input, { repository: suppliedRepository } = {}) {
  const normalizedUserId = normalizeUserId(userId);
  const event = EventSchema.parse(removeUndefined({ ...input, timestamp: input?.timestamp || new Date().toISOString() }));
  const repository = suppliedRepository || await getRole4Repository(normalizedUserId);
  let intervention = await repository.getIntervention(normalizedUserId, event.interactionId);
  if (!intervention || intervention.moduleId !== event.toolId) {
    throw new Error("Tool interaction was not found for the authenticated user");
  }
  const module = getSupportModuleById(event.toolId);
  if ([ToolEventType.PAUSED, ToolEventType.RESUMED].includes(event.eventType)
    && !module?.actions?.includes(event.eventType === ToolEventType.PAUSED ? "pause" : "resume")) {
    throw new Error("This tool does not support pause or resume");
  }

  const targetStatus = event.eventType === ToolEventType.COMPLETED && event.outcome?.completed === false
    ? InterventionStatus.PARTIALLY_COMPLETED
    : EVENT_STATUS[event.eventType];
  const existingEvent = (await repository.listLifecycleEvents(normalizedUserId, intervention.id))
    .find((item) => item.id === eventId(event.interactionId, event.eventType, idempotencyKeyFor(event)));
  if (existingEvent) {
    return { intervention, lifecycleEvent: existingEvent, outcome: await saveOutcome(repository, intervention, event), repositoryKind: repository.kind, duplicate: true };
  }

  if (event.eventType === ToolEventType.FEEDBACK && ![InterventionStatus.COMPLETED, InterventionStatus.PARTIALLY_COMPLETED, InterventionStatus.ABANDONED, InterventionStatus.CANCELLED, InterventionStatus.RATED].includes(intervention.status)) {
    throw new Error("Feedback requires a terminal interaction");
  }
  if ([ToolEventType.COMPLETED, ToolEventType.ABANDONED, ToolEventType.CANCELLED, ToolEventType.FAILED].includes(event.eventType)
    && ![InterventionStatus.STARTED, InterventionStatus.IN_PROGRESS, InterventionStatus.PROGRESSED, InterventionStatus.PAUSED].includes(intervention.status)) {
    throw new Error(`Invalid intervention transition: ${intervention.status} -> ${targetStatus}`);
  }
  if ([ToolEventType.PROGRESSED, ToolEventType.PAUSED, ToolEventType.RESUMED].includes(event.eventType)
    && [InterventionStatus.COMPLETED, InterventionStatus.PARTIALLY_COMPLETED, InterventionStatus.ABANDONED, InterventionStatus.CANCELLED, InterventionStatus.FAILED, InterventionStatus.RATED].includes(intervention.status)) {
    throw new Error(`Invalid intervention transition: ${intervention.status} -> ${targetStatus}`);
  }
  const fromStatus = intervention.status;
  if (intervention.status !== targetStatus) {
    intervention = await repository.updateIntervention({ ...intervention, status: targetStatus, updatedAt: event.timestamp });
  }
  const lifecycleEvent = await appendOnce(repository, lifecycleRecord(normalizedUserId, intervention, event, fromStatus, targetStatus));
  const outcome = await saveOutcome(repository, intervention, event);
  return { intervention, lifecycleEvent, outcome, repositoryKind: repository.kind, duplicate: false };
}

/** Creates a persisted interaction before a tool becomes visible to the user. */
export async function startToolInteraction(userId, { toolId, interactionId, parameters = {}, contextSnapshot, idempotencyKey } = {}, { repository: suppliedRepository } = {}) {
  const normalizedUserId = normalizeUserId(userId);
  const module = getSupportModuleById(toolId);
  if (!module || module.id !== toolId) throw new Error("Unknown canonical support tool");
  const repository = suppliedRepository || await getRole4Repository(normalizedUserId);
  let intervention = await repository.getIntervention(normalizedUserId, interactionId);
  if (!intervention) {
    const timestamp = new Date().toISOString();
    intervention = await repository.createIntervention({
      schemaVersion: ROLE4_SCHEMA_VERSION, id: interactionId, userId: normalizedUserId,
      moduleId: module.id, interventionType: module.interventionTypes[0], category: module.category,
      status: InterventionStatus.SHOWN, title: module.title, description: module.description, route: module.route,
      source: OutcomeSource.SYSTEM_INFERENCE, privacy: module.privacyDefault || PrivacyLevel.PRIVATE,
      tags: module.tags, parameters, rationale: "explicit_module_delivery", contextSnapshot,
      createdAt: timestamp, updatedAt: timestamp,
    });
    await appendOnce(repository, lifecycleRecord(normalizedUserId, intervention, {
      toolId, interactionId, eventType: ToolEventType.STARTED, timestamp, idempotencyKey: "shown", metadata: {},
    }, null, InterventionStatus.SHOWN));
  }
  return trackToolEvent(normalizedUserId, { toolId, interactionId, eventType: ToolEventType.STARTED, idempotencyKey, metadata: {} }, { repository });
}
