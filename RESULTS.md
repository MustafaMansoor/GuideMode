# Results

Task success rate is the primary metric: whether the user goal reached the frozen expected functional state. The canonical comparison below uses the same `gemini-3.5-flash-lite` model, ten Threadly goals, fixtures, evaluator, website, and first complete runs for both systems.

## Canonical submission evaluation

| System / domain | Result | Avg steps | Avg calls | Avg latency | Input tokens | Output tokens | Canonical artifact |
|---|---:|---:|---:|---:|---:|---:|---|
| Fair Baseline v1 — Threadly | 1/10 (10%) | 5.80 | 5.80 | 37.56 s | Not captured | Not captured | [Gemini 3.5 JSON](trajectories/fair-baseline-gemini-3.5-flash-lite-evaluation-2026-08-31T16-07-08-321Z.json) |
| Agent Core v2 — Threadly | 10/10 (100%) | 3.10 | 3.50 | 13.58 s | 181,461 | 3,105 | [Gemini 3.5 JSON](trajectories/agent-core-v2-threadly-gemini-3.5-flash-lite-evaluation-2026-08-31T16-08-01-515Z.json) |
| Agent Core v2 — CivicPortal | 5/6 (83.3%) | 9.17 | 9.50 | 37.71 s | 149,140 | 5,527 | [Gemini 3.5 JSON](trajectories/agent-core-v2-civicportal-gemini-3.5-flash-lite-evaluation-2026-08-31T16-08-01-515Z.json) |

[Canonical comparison metadata](trajectories/agent-core-v2-gemini-3.5-flash-lite-comparison-2026-08-31T16-08-01-515Z.json)

### Primary fair comparison

| System | Threadly success |
|---|---:|
| Fair Baseline v1 | 1/10 (10%) |
| Agent Core v2 | 10/10 (100%) |

The same-model improvement is **+90 percentage points** and **10× the baseline success rate**. Fair Baseline v1 retains semantic controls, opaque refs, structured actions, bounded execution, and hidden-control label compatibility, but intentionally lacks v2's deterministic verification, semantic progress, recovery, cycle detection, and Replanner.

The baseline harness predates token instrumentation and did not persist Gemini `usageMetadata`; its exact input/output tokens and token cost are therefore unavailable. We did not rerun or estimate them after seeing the outcome.

### Agent Core v2 operational telemetry

| Domain | Navigator calls | Replanner calls | Replans/stalls | Cycles | Execution failures |
|---|---:|---:|---:|---:|---:|
| Threadly | 33 | 2 | 2 | 0 | 0 |
| CivicPortal | 55 | 2 | 2 | 0 | 1 |

CivicPortal Tasks 1–5 passed. Task 6, the expired-eight-month eligibility case, failed after entering an incorrect underlying appointment/review state and returning `impossible`; the required alternative-process evaluator state was not reached.

## Approximate model-token cost

Assumption: **Gemini 3.5 Flash-Lite paid Standard pricing at submission time: $0.30 per 1M input tokens and $2.50 per 1M output tokens. Free-tier/account pricing may differ.** Infrastructure and local-machine costs are excluded.

| Canonical run | Approximate token cost |
|---|---:|
| Fair Baseline v1 | Not calculable: frozen harness did not capture token usage |
| Agent Core v2 — Threadly | $0.0622 |
| Agent Core v2 — CivicPortal | $0.0586 |
| Known v2 canonical total | $0.1208 |
| Complete canonical evaluation total | $0.1208 plus unmeasured baseline usage |

## Challenging case

**Threadly Task 8:** “Find a purple XXL shirt under $5.” It is intentionally impossible: the visible price control has a $20 minimum and the requested options are unavailable. Stable v2 passed in two steps plus one Replanner call, grounding `impossible` in current page evidence. Later v2.1 experimentation tried to make finish validation stricter, but initially rejected this valid impossibility because hard browser bounds were not admitted correctly; subsequent numeric-evidence work introduced further regressions. The lesson was to keep the stable evidence-grounded v2 termination path rather than add complexity that reduced reliability. See canonical [Task 8](trajectories/agent-core-v2-threadly-gemini-3.5-flash-lite-evaluation-2026-08-31T16-08-01-515Z.json) and the historical [v2.1 gate](trajectories/agent-v2.1-threadly-evaluation-2026-08-30T07-25-26-260Z.json).

## Benchmark versus product validation

The controlled Threadly comparison evaluates the stable Agent Core v2 reasoning loop on frozen cases. The Chrome/Edge GuideMode extension is the end-to-end user product and is validated separately through Guide Me and Do It For Me integration tests because live websites, browser navigation, and human-guidance interactions are mutable.

## Focus Planner and visual evidence

| Metric | Result | Evidence |
|---|---:|---|
| Relevant-control recall | 12/12 (100%) | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Unsafe planner omissions | 0 | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Planner decision-space reduction | 46.6% | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Deterministic safety overrides | 15 | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Visual focus ratio | ~7.3% | [visual](trajectories/guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json) |
| Visual decision-space reduction | ~88.4% | [visual](trajectories/guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json) |
| Unsafe visual omissions / restore failures | 0 / 0 | [visual](trajectories/guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json) |

These are interface/attention-space metrics, not human cognitive-load measurements.

## Production generalization

**5/6 passed the frozen evaluator, but only 3/6 had unambiguous end-to-end functional evidence** because two Edenrobe cases verified form state without conclusively proving that every filter was committed to catalog results. Production pages are mutable external-validity evidence, not part of the canonical same-model comparison. [JSON](trajectories/production-generalization-2026-08-29T19-51-45-592Z.json) · [report](PRODUCTION_GENERALIZATION.md).

## Extension evidence

- Threadly Guide Me: 5/5 manual transitions verified, 0 automatic actions, 0 irrelevant primary highlights, and one Focus Planner call in the live run.
- Threadly Do It For Me: extension automation regression passed.
- CivicPortal Guide Me: recorded lost-licence route passed.
- GOV.UK Guide Me: `SITE_INCOMPATIBLE` from the tested starting state.
- A separate Route Scout run reached `/replace-a-driving-licence` in five observed steps; it is not the later Guide Me result.

[Live Guide Me](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-10-31-855Z.json) · [GuideState replay](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-17-17-986Z.json) · [Route Scout](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T12-26-54-836Z.json) · [screenshots](artifacts/guidemode-goal-conditioned-2026-08-30T18-17-27-440Z/)

Extension optimization reduced recorded constrained-Threadly model latency from 41.211 s to 15.239 s and Focus Planner calls from 5 to 1. The optimized run is in the [live extension trajectory](guidemode-extension-server/trajectories/live-agent-extension-2026-08-30T15-48-15-633Z.json); the before aggregate and ~1.04 ms localhost health median survive only in engineering test notes. [Stale-ref evidence](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T15-52-18-572Z.json) records recoverable `STALE_REF` without navigation.

## Historical evaluation artifacts

Historical artifacts remain unchanged for auditability but are **not used in the canonical headline comparison**:

- Fair Baseline v1 on `gemini-3.1-flash-lite`: 3/10 — [historical JSON](trajectories/fair-baseline-evaluation-2026-08-29T17-43-15-158Z.json).
- Baseline v0 on `gemini-3.1-flash-lite`: 1/10 — [historical JSON](trajectories/baseline-evaluation-2026-08-29T17-33-20-384Z.json).
- Earlier frozen v2 3.5 measurement: Threadly 10/10 and CivicPortal 5/6 — [Threadly](trajectories/agent-v2-threadly-evaluation-2026-08-29T19-34-03-568Z.json), [CivicPortal](trajectories/agent-v2-civic-evaluation-2026-08-29T19-34-03-568Z.json).
- Rejected v2.1: 9/10, 766,662 input tokens — [JSON](trajectories/agent-v2.1-threadly-evaluation-2026-08-30T07-25-26-260Z.json).
- Rejected v2.2: 9/10, 627,413 input tokens — [JSON](trajectories/agent-v2.2-threadly-evaluation-2026-08-30T07-53-11-522Z.json).
