# Results

This is the canonical metrics source. The primary metric is **task success rate**: whether the goal reached the frozen expected functional state. Model behavior can vary, so these are preserved measurements rather than promises for every rerun.

## Primary comparison

| System | Threadly success | Evidence |
|---|---:|---|
| Baseline v0 | 1/10 | [frozen JSON](trajectories/baseline-evaluation-2026-08-29T17-33-20-384Z.json) |
| Fair Baseline v1 | 3/10 | [JSON](trajectories/fair-baseline-evaluation-2026-08-29T17-43-15-158Z.json) |
| Agent Core v2 | 10/10 | [JSON](trajectories/agent-v2-threadly-evaluation-2026-08-29T19-34-03-568Z.json) |

Fair Baseline v1 is official. It and the final runtime used the same ten frozen Threadly goals, fixtures, evaluator, website, and configured Gemini model; the baseline intentionally lacked v2's verification, recovery, progress, and replanning features. v0 was unfair as the primary comparison because hidden-checkbox compatibility dominated six failures. v2 gained **70 percentage points** and achieved **3.33×** Fair Baseline's success rate.

## Stable Agent Core v2

Frozen commit `ac958d97a549780876f5256a8f9e50e691187ee1`; recorded model `gemini-3.5-flash-lite`.

| Benchmark | Success | Avg steps | Avg calls | Avg latency | Input | Output | Evidence |
|---|---:|---:|---:|---:|---:|---:|---|
| Threadly | 10/10 | 3.10 | 3.50 | 18.24 s | 181,468 | 3,237 | [JSON](trajectories/agent-v2-threadly-evaluation-2026-08-29T19-34-03-568Z.json) |
| CivicPortal | 5/6 | 9.50 | 10.17 | 51.65 s | 156,413 | 6,116 | [JSON](trajectories/agent-v2-civic-evaluation-2026-08-29T19-34-03-568Z.json) |

CivicPortal v1 was 4/6. The remaining v2 failure entered the wrong appointment workflow for the expired-eight-month case and detected a cycle.

## Focus and visual evidence

| Metric | Result | Evidence |
|---|---:|---|
| Relevant-control recall | 12/12 (100%) | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Unsafe planner omissions | 0 | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Planner decision-space reduction | 46.6% | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Safety overrides | 15 | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Visual focus ratio | ~7.3% | [visual](trajectories/guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json) |
| Visual decision-space reduction | ~88.4% | [visual](trajectories/guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json) |
| Unsafe visual omissions / restore failures | 0 / 0 | [visual](trajectories/guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json) |

These are interface/attention-space metrics, not human cognitive-load measurements.

## Production generalization

The frozen evaluator recorded Edenrobe 3/3 and GOV.UK 2/3: 5/6 nominal. Only **3/6 had unambiguous end-to-end functional evidence** because two Edenrobe passes did not prove every checked filter was committed to results. Production pages can change and are optional external-validity evidence. [JSON](trajectories/production-generalization-2026-08-29T19-51-45-592Z.json) · [report](PRODUCTION_GENERALIZATION.md).

## Extension evidence

- Threadly Guide Me: 5/5 manually performed transitions verified; 0 automatic actions; 0 irrelevant primary highlights; 2.4 supporting elements average; 5 Navigator calls; 1 Focus Planner call in the optimized live flow.
- Threadly Do It For Me: extension automation regression PASS.
- CivicPortal Guide Me: PASS on recorded lost-licence route.
- GOV.UK Guide Me: `SITE_INCOMPATIBLE` from the tested starting state.
- A separate Route Scout run reached `/replace-a-driving-licence` in five steps. It is not the later Guide Me result.

[Live Guide Me JSON](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-10-31-855Z.json) · [deterministic GuideState replay](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-17-17-986Z.json) · [Route Scout JSON](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T12-26-54-836Z.json) · [screenshots](artifacts/guidemode-goal-conditioned-2026-08-30T18-17-27-440Z/)

Lifecycle/performance optimization reduced constrained Threadly model latency 41.211 s → 15.239 s (63.0%) and Focus Planner calls 5 → 1 (80%). The optimized five-step run and planner-cache behavior are preserved in the [live extension trajectory](guidemode-extension-server/trajectories/live-agent-extension-2026-08-30T15-48-15-633Z.json); the before-run aggregate and ~1.04 ms localhost health median were recorded in engineering test notes, not a standalone raw artifact. Because localhost transport was negligible, WebSocket was not added. Edenrobe's [stale-ref reproduction](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T15-52-18-572Z.json) returned structured `STALE_REF` without navigation or server failure.

## Rejected experiments

| Runtime | Success | Steps | Calls | Latency | Input tokens | Decision |
|---|---:|---:|---:|---:|---:|---|
| v2 | 10/10 | 3.1 | 3.5 | 18.24 s | 181,468 | retained |
| v2.1 | 9/10 | 4.2 | 6.0 | 23.58 s | 766,662 | rejected |
| v2.2 | 9/10 | 4.1 | 5.0 | 23.50 s | 627,413 | rejected |

[v2.1 evidence](trajectories/agent-v2.1-threadly-evaluation-2026-08-30T07-25-26-260Z.json) · [v2.2 evidence](trajectories/agent-v2.2-threadly-evaluation-2026-08-30T07-53-11-522Z.json)

## Cost

Token usage was recorded; historical monetary cost was **not measured**. Exact cost depends on current Gemini pricing/account terms, so no retrospective dollar estimate is invented.
