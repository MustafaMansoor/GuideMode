# Agent instructions

This indexes every final LLM role. Actual prompt strings/schemas remain in source; no chain-of-thought is exposed.

## Navigator

Chooses exactly one safe action toward the explicit goal from bounded page semantics, recent progress, and actions to avoid. Outputs use supplied opaque refs only. Selectors, XPath, JavaScript, arbitrary URLs, evaluator truth, and consequential completion are forbidden. Deterministic code owns browser execution. Sources: [`agent-core-v2/index.js`](agent-core-v2/index.js) and extension adaptation [`guidemode-extension-server/v2-adapter.js`](guidemode-extension-server/v2-adapter.js).

## Replanner

Diagnoses failure/stall/cycle from the goal, fresh observation, content, recent actions, and deterministic stall reason. It returns `continue`, `goal_impossible`, or `needs_human`; it takes no browser action. Conclusions must use supplied evidence. Sources: [`agent-core-v2/index.js`](agent-core-v2/index.js), [`guidemode-extension-server/v2-adapter.js`](guidemode-extension-server/v2-adapter.js).

## Focus Planner

Given the goal and current next step, classifies supplied semantics as relevant, critical, consequential, uncertain, or safe to deemphasize. Raw DOM/evaluator truth are excluded. Deterministic overrides protect obvious safety semantics. Sources: [`focus-planner.js`](focus-planner.js), [`guidemode-extension-server/focus-adapter.js`](guidemode-extension-server/focus-adapter.js).

## GuideState (not an LLM agent)

Deterministically translates Navigator decisions and verified progress into one current instruction/target, bounded support, completed verified steps, and session status. Guide Me observes human actions; Do It For Me coordinates the executor. Sources: [`guidemode-extension/shared/guide-state.js`](guidemode-extension/shared/guide-state.js), [`guidemode-extension/background.js`](guidemode-extension/background.js), [`guidemode-extension/content.js`](guidemode-extension/content.js).

Evaluator ground truth lives only in harnesses such as [`agent-v2-eval.js`](agent-v2-eval.js) and is never sent to these roles.
