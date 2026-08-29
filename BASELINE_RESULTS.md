# Simple baseline evaluation

Frozen run: `baseline-evaluation-2026-08-29T17-33-20-384Z.json`

- Model: same configured Gemini model as Agent Core v1
- Tasks: same 10 benchmark goals and fixtures
- Result: 1/10 (10%)
- Average steps per task: 4.1
- Average latency per task: 17,444.3 ms
- Total Gemini calls: 41
- Total retries: 0

Failure categories:

- Hidden native control execution: 6
- Invalid control value: 1
- Unnecessary actions on an already-satisfied goal: 1
- Invalid action for role: 1

The result was not tuned. A prior raw run with the same 1/10 outcome is retained
as a separate artifact; the frozen run only corrects evaluator bookkeeping for
attempted-step counting and stable failure categories.
