# GuideMode Visual Layer v1

Frozen final run: `guidemode-visual-evaluation-2026-08-29T18-12-54-364Z.json`

## Architecture

- `guidemode/state.js`: goal, plan, active/original mode, and current-action state.
- `guidemode/styles.js`: isolated panel styles and one reversible host-page salience stylesheet.
- `guidemode/panel.js`: accessible persistent control surface inside Shadow DOM.
- `guidemode/renderer.js`: generic ref-to-node rendering with reversible attributes and label proxies for visually hidden controls.
- `guidemode/metrics.js`: DOM preservation, visual safety, form-state, restore, and panel accessibility checks.
- `guidemode-visual-eval.js`: three-goal Playwright evaluation and screenshot capture.

The renderer knows only semantic refs and final classifications. It contains no
ecommerce category, product, filter, or site selectors.

## Design

The panel uses a focused hierarchy, large readable goal text, an explicit current
action, restrained counts, and a prominent original-page control. Relevant items
receive a green outline; the current target receives a stronger blue outline and
halo. Critical information is preserved without decoration, consequential actions
use a restrained amber outline, and deemphasized content remains readable and
interactive at reduced saturation/opacity.

The vanilla site was not rewritten to add Motion for React. Short CSS state
transitions provide comprehension-focused feedback, with all motion disabled by
`prefers-reduced-motion`.

Design references: [Apple Assistive Access](https://support.apple.com/guide/assistive-access-iphone/welcome/ios)
and [Motion command palette](https://motion.dev/examples/react-command-palette).

## Final visual-safety results

- Original interactive elements removed: 0
- Hidden relevant/current elements: 0
- Critical or consequential elements visually deemphasized: 0
- Unsafe visual omissions: 0
- Original-mode restore failures: 0
- Return-to-GuideMode failures: 0
- Form/filter state changes during toggling: 0
- Panel accessibility check failures: 0

The accessibility check covers a labeled region, accessible button names, keyboard
focusability, visible focus styling, minimum target size, text contrast, absence of
an unintended modal/focus trap, and reduced-motion support.

## Metrics

| Case | Interactive | Relevant/focused | Protected | Deemphasized | Focus ratio | Decision-space reduction |
|---|---:|---:|---:|---:|---:|---:|
| Constrained | 101 | 7 | 6 | 88 | 6.9% | 87.1% |
| Broad | 101 | 5 | 5 | 91 | 5.0% | 90.1% |
| Impossible | 101 | 10 | 2 | 89 | 9.9% | 88.1% |
| **Average** | — | — | — | — | **7.3%** | **88.4%** |

## Screenshots

Each case directory contains `01-original.png`, `02-guidemode-applied.png`,
`03-current-target.png`, and `04-restored-original.png` at 1440×1000.

Root: `artifacts/guidemode-visual-2026-08-29T18-12-54-364Z/`

## Known weaknesses

- The fixed top-right panel can cover host content on dense pages; collision-aware
  placement is not implemented.
- Focus quality inherits planner granularity. Some controls are individually
  outlined where a future semantic group treatment would be calmer.
- The impossible case remains safe, but the planner still emphasizes approximate
  options such as XL because it lacks an explicit unavailable-goal presentation.
- Shadow DOM isolates the panel, but the host-page salience stylesheet necessarily
  participates in the host document cascade and may need stronger compatibility
  handling on sites with unusual filters or transforms.
