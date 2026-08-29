# Threadly mini ecommerce store

A dependency-free frontend fashion store demo with 40 synthetic products.

## Run it

Open `index.html` directly in a modern browser. No installation or build step is required.

## Included

- Men, women, and unisex departments
- 12 product categories and 40 synthetic products
- Category, size, color, price, and text filters
- Sorting, responsive product grid, and product detail dialog
- Size/color selection and functional cart with quantities
- Cart persistence through `localStorage`
- Responsive mobile layout and newsletter interaction

Checkout is intentionally a demo because the project is frontend-only.

## Extract interactive elements with Playwright

```powershell
npm install
npx playwright install chromium
npm run extract
```

The extractor prints JSON containing sequential references (`e1`, `e2`, ...), tag,
ID, role, accessible-ish name, value, checked state, disabled state, and group context.

## Browser-agent MVP

Put your Gemini key in `.env`:

```text
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

Then run each milestone:

```powershell
# Deterministic executor/verifier smoke test (does not call Gemini)
npm run agent:smoke

# Gemini chooses exactly one action; Playwright executes and verifies it
npm run agent:one

# Gemini repeats one safe action at a time until all five filters match
npm run agent:run

# Run the predeclared 10-goal robustness evaluation
npm run agent:evaluate

# Validate the harness and executor without API calls
npm run agent:evaluate:smoke

# Run the separate simple-baseline comparison
npm run baseline:evaluate

# Run Fair Baseline v1 with hidden-control compatibility
npm run baseline:fair:evaluate

# Evaluate the non-visual GuideMode Focus Planner
npm run focus:evaluate

# Apply and validate GuideMode Visual Layer v1 across three goals
npm run guidemode:visual:evaluate

# Run the frozen system against the separate CivicPortal domain
npm run civic:evaluate

# Validate the importable Agent Core v2 runtime without Gemini calls
npm run agent:v2:test

# Evaluate Agent Core v2 on both frozen benchmarks
npm run agent:v2:evaluate
```

Every run writes a JSON trajectory under `trajectories/`. Gemini receives only the
relevant controls and can return only `click`, `check`, `uncheck`, `fill`, or
`select` with an opaque element ref. The local executor owns the Playwright calls
and selectors, and verification reads the resulting browser state directly.

The robustness suite includes already-satisfied, impossible, ambiguous-control,
dynamic-rerender, and disabled-option cases. Its combined JSON report records the
expected result before execution plus model/prompt metadata, per-step latency,
errors, and retry counts.

## Simple baseline

`baseline-eval.js` is intentionally separate from Agent Core v1. It implements a
plain observe → Gemini action → Playwright execution loop with basic semantic
controls, structured actions, and a 10-step limit. Evaluation ground truth stays
outside its prompt. The frozen comparison result is documented in
`BASELINE_RESULTS.md`.

`fair-baseline-eval.js` preserves that simple architecture and adds only
associated-label activation for visually hidden checkbox/radio controls. Its
frozen result is documented in `FAIR_BASELINE_RESULTS.md`.

The non-visual GuideMode decision layer lives in `focus-planner.js`; its separate
five-case evaluation and frozen metrics are documented in
`GUIDEMODE_FOCUS_PLANNER.md`. That planner remains frozen and separate from rendering.

GuideMode Visual Layer v1 lives under `guidemode/` and is exercised by
`guidemode-visual-eval.js`. It adapts page salience reversibly and renders its
control surface in Shadow DOM. See `GUIDEMODE_VISUAL_LAYER.md` for screenshots,
safety results, metrics, and known limitations.

`civic-portal/` is a separate fictional public-service SPA used for cross-domain
generalization. Its unchanged-system benchmark and screenshots are documented in
`CIVICPORTAL_CROSS_DOMAIN.md`.

The separate importable Agent Core v2 runtime lives under `agent-core-v2/`. Its
semantic content extraction, resilient fresh-state executor, progress signatures,
cycle detection, and Navigator/Replanner orchestration are documented in
`AGENT_CORE_V2.md`.
