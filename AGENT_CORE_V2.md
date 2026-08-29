# Agent Core v2

Agent Core v2 is a separate importable runtime. Frozen v1 implementations and benchmark artifacts are unchanged.

```js
const { runAgent } = require('./agent-core-v2');

const trajectory = await runAgent({
  page,
  goal: 'Complete the requested workflow and stop at review',
  maxSteps: 18,
  isTerminal: async ({ page, observation }) => false
});
```

The evaluator callback is owned by the harness and is never included in either model prompt.

## Architecture

- `observer.js` extracts opaque interactive refs and a bounded set of headings, short paragraphs, list items, alerts, status/validation text, and fee/price content. Raw HTML and evaluator state are excluded.
- `executor.js` validates the restricted action vocabulary, preserves associated-label compatibility for visually hidden checkboxes/radios, and reconciles action effects against a fresh observation after synchronous rerenders.
- `progress.js` hashes route, heading, selected/value/expanded control state, important content, and alerts. It distinguishes physical action success from semantic progress and detects repeated transitions/oscillation.
- `index.js` orchestrates a Navigator and a single role-separated Replanner. Failures, repeated stalls, cycles, and proposed impossible conclusions can trigger replanning.
- `agent-v2-eval.js` keeps Threadly and CivicPortal ground truth in an evaluation-only harness and writes separate reports.

## Commands

```powershell
npm run agent:v2:test
npm run agent:v2:evaluate
```

Optional diagnostic selection (still uses the unchanged task definitions):

```powershell
$env:AGENT_V2_BENCHMARK='civic'
$env:AGENT_V2_TASK='2'
npm run agent:v2:evaluate
```

## Evaluation status

The first complete v2 measurement produced Threadly 9/10 and CivicPortal 4/6. It demonstrated zero Civic executor failures but exposed an action-contract loop and overly eager impossible reasoning. After generic corrections, an isolated lost-licence rerun passed. A subsequent eligibility rerun was interrupted by the Gemini project's 500-request daily quota, so a final post-correction 16-task score must not be inferred from these partial runs. Rerun `npm run agent:v2:evaluate` after quota reset and preserve the resulting three timestamped artifacts.

Cost remains unavailable because no pricing configuration is encoded. Token counts, calls, latency, replans, cycles, retries, and execution failures are recorded in the JSON reports.
