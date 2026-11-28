# Reliability Benchmark Methodology

## Scope

`src/benchmarks/reliabilityBenchmark.test.js` is a deterministic Vitest harness that calls existing production memory, execution, lifecycle, and local repository APIs. It uses no external credentials or user data.

## Memory scenarios

The harness creates 204 synthetic, version-1 Task Breakdown reflections: 34 each for single-observation evidence, two matching observations, a one-to-one conflict, three repeated observations, two abandoned observations, and a two-to-one boundary case. Each history is written through `saveReflection` and evaluated through `deriveMemoryFromReflections`.

The independently specified oracle accepts `selected_style` only when it has a unique plurality with at least two observations; it rejects single observations and one-to-one ties. The reported 136 accepted and 68 rejected cases follow directly from four accepted and two rejected scenario groups of 34. This benchmark measures only the `selected_style` memory decision, not all memory categories or production write volume.

The ungated reference writes the first observed style for every non-empty history. It is a transparent comparison heuristic, not a historical or production baseline. It writes 204 times versus 136 accepted gated decisions, so the difference is 68/204 = 33.3%.

## Persistence and lifecycle scenarios

The harness replays a completion event sequentially and concurrently through `trackToolEvent` using `createLocalRole4Repository`. An identical event identity is an idempotent replay that may return the existing result; a distinct timestamp produces a distinct event identity and must be rejected after a terminal transition. It counts repository mutation calls and explicitly labels them as local calls, not database writes. The concurrent result is recorded rather than treated as a concurrency guarantee.

For 11 executable non-Focus tools, the harness starts the tool, completes it, repeats the completion, checks the production rejection result, and rereads the persisted intervention state through `getInterventionHistory`. It fails if any valid transition is rejected, any duplicate terminal transition is accepted, or an invalid retry changes persisted state.

## Results and reproduction

The machine-readable artifact is `results/reliability-benchmark-results.json`.

```bash
npm run benchmark:reliability
npx vitest run src/test/reflectionMemory.test.js src/test/toolInteractionPersistence.test.js src/test/supportExecution.test.js
```

## Limitations

- Synthetic decisions do not measure production database writes, latency, or user outcomes.
- The memory scenarios exercise abandoned reflections but do not exercise paused reflections; the current Task Breakdown `selected_style` rule does not branch on either status.
- Local repository results do not establish database-level idempotency, concurrent atomicity, authorization, or RLS behavior.
- The repository contains SQL RLS tests, but they require a non-production Supabase/PostgreSQL environment and were not run by this benchmark.
