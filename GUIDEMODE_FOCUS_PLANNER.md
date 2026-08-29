# GuideMode Focus Planner v1

Frozen final run: `focus-planner-evaluation-2026-08-29T17-57-57-537Z.json`

## Architecture

1. Extract a compact semantic observation without raw HTML.
2. Ask Gemini to classify each ref as relevant, critical, consequential, or
   deemphasize, with conservative uncertainty handling.
3. Apply deterministic, generic semantic safety overrides.
4. Evaluate against separately held expected attention descriptors.

The planner receives only the natural-language goal, page title/URL, and semantic
elements. Evaluator labels and ecommerce checkpoints never enter its input.

## Model output schema

```json
{
  "goal_summary": "string",
  "elements": [
    {
      "ref": "e13",
      "classification": "relevant | critical | consequential | deemphasize",
      "reason": "string"
    }
  ],
  "uncertain_refs": ["e20"]
}
```

The deterministic pass adds `model_classification`, `final_classification`, and,
when changed, `override_reason`.

## Final metrics

- Relevant-control recall: 100% (12/12 expected available controls)
- Unsafe omissions: 0
- Average interactive decision-space reduction: 46.6%
- Average model latency: 17,465.2 ms
- Safety overrides: 15

| Test | Goal shape | Recall | Unsafe | Visible actionable | Preserved | Reduction |
|---|---|---:|---:|---:|---:|---:|
| 1 | Constrained product search | 100% | 0 | 101 | 49 | 51.5% |
| 2 | Less constrained search | 100% | 0 | 101 | 41 | 59.4% |
| 3 | Category and price | 100% | 0 | 101 | 9 | 91.1% |
| 4 | Already satisfied | 100% | 0 | 74 | 62 | 16.2% |
| 5 | Impossible/unavailable | 100% | 0 | 101 | 86 | 14.9% |

Examples of deterministic changes include a required email input changed from
deemphasize to critical, a form-associated Subscribe button changed from
deemphasize to consequential, and a live status region changed from deemphasize
to critical.
