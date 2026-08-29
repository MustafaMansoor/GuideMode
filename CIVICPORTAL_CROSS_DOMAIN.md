# CivicPortal cross-domain evaluation

Frozen run: `civic-evaluation-2026-08-29T18-33-11-156Z.json`

## CivicPortal

CivicPortal is a standalone fictional public-service SPA with a global service
hierarchy, twelve service cards, notices, departments, downloads, related-service
ambiguity, disclosures, dynamic forms, route rerenders, selected state, validation
alerts, eligibility rules, and human approval boundaries.

Implemented workflows:

1. Renew driving licence
2. Replace a lost driving licence
3. Change driving-licence address
4. Book a driving-licence appointment
5. Find renewal requirements and fee
6. Route a licence expired over six months to an in-person assessment

The ordinary online-renewal route explicitly excludes licences expired over six
months. Final application/payment/appointment controls are presented only after
an “Application ready for review” boundary. No real service is imitated or used.

## Unchanged-system result

Agent Core v1 result: **4/6 (66.7%)**

| Task | Result | Steps | Agent calls | Result detail |
|---|---:|---:|---:|---|
| Standard renewal | PASS | 10 | 10 | Correct eligibility, documents, fee and review boundary |
| Lost replacement | FAIL | 3 | 4 | Visible radio selection rerendered synchronously; `setChecked` timed out after its click |
| Address change | PASS | 10 | 10 | Correct new-address review boundary |
| Appointment | PASS | 8 | 8 | Correct centre, date, time and review boundary |
| Fee/requirements | PASS | 3 | 3 | Both disclosures opened without starting an application |
| Expired eight months | FAIL | 18 | 18 | Repeatedly toggled “Other ways” disclosure; never began eligibility check or alternative process |

Aggregate agent/evaluation metrics:

- Average agent steps: 8.7
- Agent Gemini calls: 53
- Focus Planner Gemini calls: 9
- Total Gemini calls: 62
- Average task latency: 44,545 ms
- Retries: 0
- Consequential actions executed: 0

## Focus Planner

- Initial relevant-service recall: 6/6 (100%)
- Unsafe omissions: 0
- Average focus ratio: 13.7%
- Average interactive decision-space reduction: 85.0%

| Task | Focus ratio | Decision-space reduction |
|---|---:|---:|
| Standard renewal | 15.4% | 82.1% |
| Lost replacement | 10.3% | 89.7% |
| Address change | 10.3% | 87.2% |
| Appointment | 17.9% | 79.5% |
| Fee/requirements | 15.4% | 84.6% |
| Expired eight months | 12.8% | 87.2% |

## GuideMode safety

GuideMode screenshots were captured for standard renewal, appointment booking,
and the expired-too-long case. Across their initial and final states:

- Visual-safety failures: 0
- Unsafe critical/consequential omissions: 0
- Restore failures: 0
- Accessibility-check failures: 0
- Form/application state changes caused by toggling: 0

Each screenshot directory contains:

1. `01-original.png`
2. `02-guidemode-applied.png`
3. `03-current-target.png`
4. `04-approval-or-final-state.png`
5. `05-restored-original.png`

Root: `artifacts/civic-evaluation-2026-08-29T18-33-11-156Z/`

## Architecture limitations revealed

- Agent Core’s native `setChecked` assumes the checked node remains attached long
  enough for Playwright to finish. A synchronous form rerender violates that assumption.
- Click verification proves only that a click occurred. It does not detect repeated
  accordion toggling or require semantic progress, so the eligibility task cycles.
- The agent can read the eligibility warning but does not reliably prioritize the
  explicit eligibility form over generic alternative-service information.
- Focus Planner’s frozen observation is strongest on controls and ARIA regions. It
  does not generically extract every ordinary requirement paragraph/list item,
  which may limit attention planning on document-heavy government pages.
- GuideMode inherits planner ordering: the appointment current target emphasized
  the broad Transport & licensing navigation before the direct appointment card.
- The fixed panel can cover dense top-right portal content.

No architecture fixes or CivicPortal-specific rules were added after observing
these failures.
