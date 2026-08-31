# Representative trajectories

| Scenario | Why selected / roles | Human checkpoint | Artifact |
|---|---|---|---|
| Threadly constrained success | Navigator, bounded execution, fresh observation, verification | none | [v2 Task 1](trajectories/agent-v2-threadly-evaluation-2026-08-29T19-34-03-568Z.json) |
| Threadly impossible purple XXL | Stable-v2 impossible handling | none | [v2 Task 8](trajectories/agent-v2-threadly-evaluation-2026-08-29T19-34-03-568Z.json) |
| Civic lost-licence replacement | Navigator, rerender reconciliation, resilient executor | final submission remains human | [Civic Task 2](trajectories/agent-v2-civic-evaluation-2026-08-29T19-34-03-568Z.json) |
| Civic expired-eight-month failure | Wrong route, cycle detection, Replanner limitation | no consequential action | [Civic Task 6](trajectories/agent-v2-civic-evaluation-2026-08-29T19-34-03-568Z.json) |
| Focus Planner | model classifications + deterministic safety overrides | n/a | [planner](trajectories/focus-planner-evaluation-2026-08-29T17-57-57-537Z.json) |
| Production | real DOMs, stalls/cycles/executor evidence and caveat | 0 prohibited violations | [production](trajectories/production-generalization-2026-08-29T19-51-45-592Z.json) |
| GOV.UK Route Scout | observed GET form, ranked routes, safe `r28` navigation | stopped before transaction | [route](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T12-26-54-836Z.json) |
| Threadly Guide Me | goal → GuideState → manual action → verification; 5/5 | all five ordinary actions human-performed | [GuideState](guidemode-extension-server/trajectories/goal-conditioned-2026-08-30T18-17-17-986Z.json) |
| Optimized extension automation | five Navigator steps, one Focus Planner call, four cache hits, per-step latency and tokens | no consequential action | [live extension](guidemode-extension-server/trajectories/live-agent-extension-2026-08-30T15-48-15-633Z.json) |
| Stale route recovery | expired `r*` ref becomes structured recoverable `STALE_REF`, never fuzzy-matched | no navigation executed | [stale-ref reproduction](guidemode-extension-server/trajectories/route-scout-production-2026-08-30T15-52-18-572Z.json) |

Benchmark tasks record observation/content, role, model response, browser action, executor outcome, action success, progress signatures, semantic progress, cycles/replans, latency, and evaluator-only final state. Historical JSON may retain recording-machine `file://` URLs; documentation uses portable relative links while raw evidence remains intact.
