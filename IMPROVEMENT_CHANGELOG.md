# Improvement Changelog

## Semantic extraction and simple agent
### What we tried
Opaque semantic refs and one bounded Gemini-selected Playwright action at a time.
### Why
Establish the smallest safe observe → act loop.
### Evidence
One success proved plumbing, not robustness.
### Decision / learning
Freeze a multi-task benchmark before UI work.

## Baseline v0
### What we tried
A simple agent without verification-driven replanning or impossible reasoning.
### Why
Create a comparison.
### Evidence
1/10; hidden-checkbox compatibility dominated six failures. [JSON](trajectories/baseline-evaluation-2026-08-29T17-29-33-995Z.json).
### Decision / learning
Do not use it as the primary fairness comparison.

## Fair Baseline v1
### What we tried
Added only associated-label activation for hidden controls.
### Why
Remove a synthetic DOM compatibility confound.
### Evidence
3/10, 7.4 steps/task, 74 calls. [JSON](trajectories/fair-baseline-evaluation-2026-08-29T17-43-15-158Z.json).
### Decision / learning
Use this as the official baseline.

## Agent Core v1
### What we tried
Deterministic verification, recovery, impossible detection, and structured trajectories.
### Why
Address benchmark reasoning/completion failures.
### Evidence
Threadly 10/10. [JSON](trajectories/evaluation-2026-08-28T20-03-33-911Z.json).
### Decision / learning
Freeze and test another domain.

## CivicPortal generalization
### What we tried
Ran unchanged v1 on a public-service SPA with rerenders, ambiguity, eligibility, and approval boundaries.
### Why
Test beyond ecommerce.
### Evidence
4/6. A radio detached during rerender; “Other ways” was clicked 17 times without progress. [JSON](trajectories/civic-evaluation-2026-08-29T18-33-11-156Z.json).
### Decision / learning
**Action success is not task progress.**

## Focus Planner v1
### What we tried
Goal-conditioned classification with deterministic safety overrides.
### Why
Create a safe attention layer.
### Evidence
12/12 recall, 0 unsafe omissions, 46.6% reduction, 15 overrides. [JSON](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json).
### Decision / learning
The model is secondary to deterministic preservation rules.

## GuideMode Visual v1
### What we tried
Reversible, non-destructive visual salience.
### Why
Reduce irrelevant decisions without removing information.
### Evidence
~7.3% focus ratio, ~88.4% decision-space reduction, 0 unsafe omissions/restoration failures. [JSON](trajectories/guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json).
### Decision / learning
Agentic guidance should reduce decisions, not information.

## Agent Core v2
### What we tried
Importable runtime, semantic content, rerender-tolerant execution, progress signatures, cycles, and one Replanner.
### Why
Address demonstrated Civic failures only.
### Evidence
Threadly 10/10; CivicPortal 5/6. [Threadly](trajectories/agent-v2-threadly-evaluation-2026-08-29T19-34-03-568Z.json) · [Civic](trajectories/agent-v2-civic-evaluation-2026-08-29T19-34-03-568Z.json).
### Decision / learning
Retain v2 as the final benchmark runtime; replanning earned its added latency.

## Production generalization
### What we tried
Frozen v2/Planner/Visual on Edenrobe and GOV.UK without site-specific tuning.
### Why
External validity.
### Evidence
5/6 nominal evaluator, but only 3/6 unambiguous functional evidence. It exposed responsive duplicates, uncommitted filter state, editable comboboxes, large contexts, CSP limits, and weak catalog content semantics. [JSON](trajectories/production-generalization-2026-08-29T19-51-45-592Z.json).
### Decision / learning
Keep controlled suites primary and state production caveats.

## Agent Core v2.1 — rejected
### What we tried
Explicit finish, Finish Validator, result-state verification, constraint coverage, and hard-bound feasibility.
### Why
Prevent unsupported completion.
### Evidence
It revealed a real risk but caused stochastic completion regression, over-strict valid-impossibility rejection, numeric interactions, and complexity: 9/10, 766,662 input tokens. [JSON](trajectories/agent-v2.1-threadly-evaluation-2026-08-30T07-25-26-260Z.json).
### Decision / learning
Do not merge v2.1 reasoning semantics.

## Agent Core v2.2 — rejected
### What we tried
Ported editable combobox, responsive duplicate ranking, and richer content extraction from stable v2.
### Why
Improve production compatibility without v2.1 termination.
### Evidence
Deterministic tests passed, but Threadly fell 10/10 → 9/10; steps 3.1 → 4.1; calls 3.5 → 5.0; latency 18.24 → 23.50 s; input tokens 181,468 → 627,413; replans 2 → 8. Geometry led Gemini to treat hidden label-executable controls as unusable. [JSON](trajectories/agent-v2.2-threadly-evaluation-2026-08-30T07-53-11-522Z.json).
### Decision / learning
**More browser metadata is not necessarily better context.** Retain v2.

## Browser extension
### What we tried
Manifest V3 side panel, semantic content script, local-key server, bounded executor, visual layer, Stop/Continue, and human pauses.
### Why
Create the user-facing product without modifying frozen v2.
### Evidence
Threadly/Civic flows worked; public smoke tests exposed routing limits. Commit `e0afee599f1a8e58a034f8230e51e22c795ddd4c`.
### Decision / learning
Adapt at the extension boundary.

## Route Scout
### What we tried
Normalized/deduplicated `r*` routes, deterministic ranking, observed-route navigation, and safe GET forms.
### Why
Real sites encode shortest paths in links/routes.
### Evidence
GOV.UK replacement guidance reached in five observed steps; Edenrobe exposed safe GET form semantics. [JSON](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T12-26-54-836Z.json). Commit `1e5247dbeac5def5042bebdd0c892b788b99547c`.
### Decision / learning
Choose observed refs; never invent URLs.

## Stale-ref/session hardening
### What we tried
Observation IDs/generations, exact snapshots, single-flight sessions, terminal authority, structured stale/invalid refs, late-response discard.
### Why
Fix `unknown ref r155` after visible completion.
### Evidence
Real Edenrobe reproduction returned `STALE_REF` without navigation/server failure. Commit `569a30c60df5b061e8185b295af6d0330e7f8637`.
### Decision / learning
Refs are `(observation, ref)` pairs; terminal state is atomic.

## Extension latency optimization
### What we tried
Focus-plan caching, cheap target updates, safe parallelism, smart settle, and bounded route exposure.
### Why
Profiling showed model calls dominated latency.
### Evidence
Threadly model latency 41.211 s → 15.239 s (63%); planner calls 5 → 1 (80%); localhost median ~1.04 ms.
### Decision / learning
No WebSocket: transport was not the bottleneck.

## Goal-conditioned GuideMode
### What we tried
GuideState driven by goal, Navigator next step, and verified progress; Guide Me and Do It For Me.
### Why
Generic page dimming was not sufficient guidance.
### Evidence
Threadly Guide Me verified 5/5 manual transitions, 0 automatic actions, 0 irrelevant primary highlights; Civic lost-licence target passed; GOV.UK remained `SITE_INCOMPATIBLE`. [JSON](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-17-17-986Z.json) · [screenshots](artifacts/guidemode-goal-conditioned-2026-08-30T18-17-27-440Z/). Commit `ea941932b5320e99b54e527dc4d0d4240565355b`.
### Decision / learning
The differentiator is a temporary goal-specific interface around the current verified next step.

## Main failure mode

GuideMode depends on useful website semantics. Custom controls, incomplete accessible names, ambiguous committed-result state, or unusual routing may leave insufficient evidence, requiring uncertainty/human intervention or causing a wrong workflow such as CivicPortal's expired-eight-month case.
