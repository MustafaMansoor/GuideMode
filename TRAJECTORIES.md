# Representative trajectories

This index turns preserved JSON evidence into short judge-readable walkthroughs. Evaluator truth is recorded after the agent loop and never enters model context.

## 1. Navigator — Threadly constrained success

- **Goal:** Find a men's blue shirt in size S under $70.
- **Agent(s):** Navigator.
- **Sequence:** observe semantic controls → select one bounded filter action → execute by opaque `e*` ref → fresh-observe → verify changed state → continue.
- **Browser/tool response:** executor success is recorded separately from semantic progress; refs regenerate after observations.
- **Verification:** the final page state satisfies the frozen evaluator rather than relying on a successful click alone.
- **Retry/replan:** none required in this success.
- **Human checkpoint:** none in the benchmark runtime.
- **Result:** PASS.
- **Artifact:** [canonical Threadly Task 1](trajectories/agent-core-v2-threadly-gemini-3.5-flash-lite-evaluation-2026-08-31T16-08-01-515Z.json).

## 2. Navigator + Replanner — CivicPortal rerender recovery

- **Goal:** Replace a lost driving licence.
- **Agent(s):** Navigator, Replanner, rerender-tolerant executor.
- **Sequence:** discover replacement service → choose lost-licence path → encounter synchronous DOM replacement → reconcile the intended semantic control against the fresh page → continue.
- **Browser/tool response:** when a node detaches, the executor re-observes and resolves the current semantic equivalent rather than reusing a stale handle.
- **Verification:** workflow content/form state establishes progress, not the click return value.
- **Retry/replan:** bounded recovery is recorded when the original target is no longer current.
- **Human checkpoint:** final submission remains human-controlled.
- **Result:** PASS.
- **Artifact:** [canonical CivicPortal Task 2](trajectories/agent-core-v2-civicportal-gemini-3.5-flash-lite-evaluation-2026-08-31T16-08-01-515Z.json).

## 3. Replanner/cycle — expired-eight-month failure

- **Goal:** Handle a licence that expired eight months ago.
- **Agent(s):** Navigator and Replanner.
- **Sequence:** enter the wrong appointment/review workflow → observe repeated semantic state → progress signature detects a stall/cycle → Replanner attempts recovery.
- **Browser/tool response:** actions may execute, but the required alternative-process state is never reached.
- **Verification:** the evaluator rejects the wrong workflow; the failure is retained rather than replaced by a retry.
- **Retry/replan:** the historical trajectory shows the cycle/replan; the fresh canonical run also fails, ending `impossible` after the wrong workflow.
- **Human checkpoint:** no consequential action is executed.
- **Result:** FAIL; known planning/routing limitation.
- **Artifacts:** [historical cycle, Civic Task 6](trajectories/agent-v2-civic-evaluation-2026-08-29T19-34-03-568Z.json) · [fresh canonical failure](trajectories/agent-core-v2-civicportal-gemini-3.5-flash-lite-evaluation-2026-08-31T16-08-01-515Z.json).

## 4. Focus Planner — deterministic safety override

- **Goal:** Reduce the decision surface around the current task.
- **Agent(s):** Focus Planner plus deterministic safety overrides.
- **Sequence:** classify bounded elements → inspect critical/consequential semantics → override unsafe deemphasis → render the protected plan.
- **Browser/tool response:** status/alert regions and consequential controls remain visible even when ranked as unrelated.
- **Verification:** evaluation checks relevant-control recall and unsafe omissions.
- **Retry/replan:** not applicable; deterministic overrides are final authority.
- **Human checkpoint:** consequential controls stay available for human review.
- **Result:** 12/12 recall, 0 unsafe omissions, 15 safety overrides.
- **Artifact:** [Focus Planner evaluation](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json).

## 5. Route Scout — observed `r*` navigation

- **Goal:** Find official lost-driving-licence replacement guidance.
- **Agent(s):** deterministic Route Scout and Navigator.
- **Sequence:** observe links/forms → normalize and deduplicate URLs → rank a bounded same-origin set → select an observed `r*` ref → resolve stored URL → navigate → fresh-observe.
- **Browser/tool response:** the GOV.UK run used an observed GET search form and ranked result route before reaching `/replace-a-driving-licence`.
- **Verification:** pathname/heading changes count as progress only after re-observation.
- **Retry/replan:** route refs expire after navigation; stale refs are rejected, never fuzzy-matched.
- **Human checkpoint:** testing stops before authentication or transaction.
- **Result:** guidance reached in five observed steps in this Route Scout run.
- **Artifact:** [Route Scout trajectory](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T12-26-54-836Z.json).

## 6. Guide Me — human action and semantic verification

- **Goal:** Find a men's blue shirt in size S under $70.
- **Agent(s):** Navigator, GuideState renderer, Focus Planner once.
- **Sequence:** propose next action → highlight one primary target → human acts → observe expected semantic state → mark verified step complete → show next target.
- **Browser/tool response:** Men, Shirts, S, Blue, and price transitions are independently observed.
- **Verification:** 5/5 transitions verified; a click alone does not complete a step.
- **Retry/replan:** target updates locally; cached Focus Plan avoids four redundant calls.
- **Human checkpoint:** all five ordinary actions are human-performed; automatic Guide Me actions are zero.
- **Result:** PASS, zero irrelevant primary highlights.
- **Artifacts:** [live trajectory](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-10-31-855Z.json) · [replay](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-17-17-986Z.json) · [screenshots](artifacts/guidemode-goal-conditioned-2026-08-30T18-17-27-440Z/).

## 7. Human/sensitive checkpoint

- **Goal:** Continue a workflow that reaches identity or final-submission input.
- **Agent(s):** Navigator, deterministic safety boundary, GuideState.
- **Sequence:** identify next control → recognize sensitive/consequential semantics → enter `waiting_for_user` → explain manual step → wait for Continue and a fresh observation.
- **Browser/tool response:** the field may be emphasized, but the executor does not fill or submit it.
- **Verification:** tests assert zero autonomous consequential executions and no action after pause/stop.
- **Retry/replan:** resume only follows explicit user continuation and fresh state.
- **Human checkpoint:** required by design.
- **Result:** protected manual boundary; no sensitive data in trajectory logs.
- **Artifacts:** [manual-step screenshot](artifacts/guidemode-goal-conditioned-2026-08-30T18-17-27-440Z/06-sensitive-manual-step.png) · [GuideState replay](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-17-17-986Z.json).

## Additional reliability evidence

- [Optimized extension automation](guidemode-extension-server/trajectories/live-agent-extension-2026-08-30T15-48-15-633Z.json): five Navigator steps, one Focus Planner call, four cache hits, per-step latency and tokens.
- [Stale route recovery](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T15-52-18-572Z.json): expired `r*` ref becomes recoverable `STALE_REF`; no fuzzy execution or navigation.
- [Production generalization](trajectories/production-generalization-2026-08-29T19-51-45-592Z.json): real DOM evidence and the checked-filter versus committed-result caveat.

Raw benchmark artifacts contain observations, bounded model actions, browser responses, action success, semantic-progress signatures, retries/replans, latency, and evaluator-only final state. Historical JSON may retain recording-machine `file://` URLs; this index uses portable repository-relative links while preserving raw evidence unchanged.
