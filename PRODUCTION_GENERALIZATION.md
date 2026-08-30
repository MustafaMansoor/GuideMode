# Production website generalization v1

This is the first controlled production run of frozen Agent Core v2 (`ac958d9`), Focus Planner v1, and GuideMode Visual Layer v1. No production-specific logic was added to those components and no failed task was rerun.

## Frozen manifest

The six tasks and evaluation ground truth were committed before Agent Core execution in commit `868fbe0`. Tests were limited to public navigation, filtering, and information discovery. No account, personal data, cart, checkout, payment, application, or authentication flow was used.

## Results

| Site | Result | Average steps | Average Gemini calls | Average latency |
|---|---:|---:|---:|---:|
| Edenrobe | 3/3 (100%) | 2.67 | 4.00 | 24.86 s |
| GOV.UK | 2/3 (66.7%) | 4.33 | 8.33 | 33.87 s |
| Overall | 5/6 (83.3%) | 3.50 | 6.17 | 29.36 s |

This is the frozen evaluator outcome, not an unqualified production-success claim. Two Edenrobe tasks lacked unambiguous proof that every checked filter had been committed to the catalog result state; only 3/6 tasks had unambiguous end-to-end functional evidence. Production pages are mutable external-generalization evidence and are not required to reproduce the primary controlled result.

The run used 354,398 prompt tokens, 4,689 candidate tokens, and 359,087 total tokens. No prohibited action was attempted or executed.

## Failures and incompatibilities

- **GOV.UK lost-licence guidance — primary A, observation failure; secondary D, progress failure.** The live GOV.UK search input was represented as an ARIA `combobox`. The frozen action compatibility table therefore rejected `fill`, even though the production control accepts text entry. The agent toggled the search disclosure, detected two cycles, navigated to the Driving licences browse page at the last step, and exhausted the limit without reaching `/replace-a-driving-licence`.
- **GOV.UK GuideMode — E, site incompatibility.** Focus planning completed, but GOV.UK's Content Security Policy rejected the renderer's local `addScriptTag` injection. Only the original screenshot was captured. There was no bypass attempt.
- **Edenrobe execution friction.** Three actions failed transiently against duplicated/mobile filter controls: a price input timeout, a color-label evaluation timeout after rerender, and an off-viewport mobile Apply button. Replanning recovered all three tasks. The observer supplied 233 controls but zero semantic content blocks.

## GuideMode

Edenrobe produced four screenshots and passed automated DOM-preservation, critical/consequential preservation, restore, form-state, and panel accessibility checks.

- Visible interactive elements: 233
- Directly focused/relevant: 96
- Protected: 4
- Deemphasized: 133
- Focus ratio: 41.2%
- Interactive decision-space reduction: 57.1%
- Unsafe visual omissions: 0
- Restore failures: 0
- Safety overrides: 4

Although safe, the visual focus was too broad: navigation and many product links were outlined while the closed filter surface prevented a compact next-action experience.

The GOV.UK planner call completed before CSP blocked renderer injection, but the failure path did not retain its plan payload. Therefore no GOV.UK focus-classification metrics are claimed.

## Recommendations (not implemented)

1. Distinguish editable ARIA comboboxes from select-only comboboxes in semantic action compatibility.
2. Rank or deduplicate responsive desktop/mobile variants and off-viewport controls before model input.
3. Broaden compact content extraction beyond `main`-scoped assumptions while retaining boilerplate suppression.
4. Add an explicit information-task completion/reporting mechanism so already-visible answers are not represented only as evaluator zero-step passes.
5. Deliver GuideMode through a CSP-compatible isolated browser context or extension content-script architecture rather than inline script injection.
6. Improve Focus Planner precision on dense production catalogs; safety was strong, but 41.2% of controls remained directly focused.

These are observations only. No architecture changes were made in this iteration.
