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
```

Every run writes a JSON trajectory under `trajectories/`. Gemini receives only the
relevant controls and can return only `click`, `check`, `uncheck`, `fill`, or
`select` with an opaque element ref. The local executor owns the Playwright calls
and selectors, and verification reads the resulting browser state directly.

The robustness suite includes already-satisfied, impossible, ambiguous-control,
dynamic-rerender, and disabled-option cases. Its combined JSON report records the
expected result before execution plus model/prompt metadata, per-step latency,
errors, and retry counts.
