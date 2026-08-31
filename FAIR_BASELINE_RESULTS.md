# Fair Baseline v1 evaluation — historical Gemini 3.1 run

> This 3/10 run is retained for auditability but is not the canonical submission baseline. The fresh same-model Gemini 3.5 baseline scored 1/10; see [RESULTS.md](RESULTS.md).

Frozen run: `fair-baseline-evaluation-2026-08-29T17-43-15-158Z.json`

- Model: same configured Gemini model as Baseline v0 and Agent Core v1
- Tasks/evaluator: same 10 benchmark goals, fixtures, and ground truth
- Result: 3/10 (30%)
- Average steps per task: 7.4
- Average latency per task: 31,249.1 ms
- Total Gemini calls: 74
- Total retries: 0

Failure categories:

- Invalid action for role after continued manipulation: 4
- Maximum steps with incomplete final filters: 1
- Invalid out-of-range control value: 1
- Unnecessary actions on an already-satisfied goal: 1

Comparison:

- Baseline v0: 1/10 (10%)
- Fair Baseline v1: 3/10 (30%)
- Agent Core v1: 10/10 (100%)

The only behavioral difference from Baseline v0 is associated-label activation
when native Playwright interaction with a visually hidden checkbox/radio fails.
The fallback does not verify the result or provide feedback to Gemini.
