require('dotenv').config({ quiet: true });

const { GoogleGenAI, Type } = require('@google/genai');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GOAL = "Find me a men's blue shirt in size small under $70.";
const ALLOWED_ACTIONS = new Set(['click', 'check', 'uncheck', 'fill', 'select']);
const MAX_STEPS = 10;
const runOneStepOnly = process.argv.includes('--one');
const smokeMode = process.argv.includes('--smoke');

const actionSchema = {
  type: Type.OBJECT,
  properties: {
    action: { type: Type.STRING, enum: [...ALLOWED_ACTIONS] },
    ref: { type: Type.STRING, description: 'One exact ref from the provided controls.' },
    value: { type: Type.STRING, nullable: true, description: 'Required for fill/select; otherwise null.' },
    reason: { type: Type.STRING }
  },
  required: ['action', 'ref', 'value', 'reason']
};

function implicitRole(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'a' && element.hasAttribute('href')) return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag !== 'input') return null;
  return ({
    button: 'button', checkbox: 'checkbox', email: 'textbox', number: 'spinbutton',
    radio: 'radio', range: 'slider', reset: 'button', search: 'searchbox',
    submit: 'button', tel: 'textbox', text: 'textbox', url: 'textbox'
  })[(element.type || 'text').toLowerCase()] || null;
}

async function observe(page) {
  return page.locator('button, a, input, select, textarea, [role]').evaluateAll((nodes, roleSource) => {
    const implicit = new Function('element', `return (${roleSource})(element)`);
    const unique = [...new Set(nodes)];
    document.querySelectorAll('[data-agent-ref]').forEach(element => element.removeAttribute('data-agent-ref'));

    const nameOf = element => {
      if (element.getAttribute('aria-label')) return element.getAttribute('aria-label').trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
        if (text) return text;
      }
      if (element.labels?.length) {
        const labelText = [...element.labels].map(label =>
          label.getAttribute('aria-label') || label.getAttribute('title') || label.textContent.replace(/\s+/g, ' ').trim()
        ).filter(Boolean).join(' ');
        if (labelText) return labelText;
      }
      return element.getAttribute('title') || element.getAttribute('placeholder') ||
        element.textContent?.replace(/\s+/g, ' ').trim() || element.value || null;
    };
    const contextOf = element => {
      const fieldset = element.closest('fieldset');
      if (fieldset) return fieldset.querySelector(':scope > legend')?.textContent.replace(/\s+/g, ' ').trim() || 'fieldset';
      const landmark = element.closest('dialog, nav, header, footer, aside, form, article, section');
      if (!landmark) return 'document';
      const productName = landmark.querySelector('.product-name')?.textContent.trim();
      const heading = landmark.querySelector('h1, h2, h3, h4')?.textContent.replace(/\s+/g, ' ').trim();
      return `${landmark.tagName.toLowerCase()}${productName || heading ? `: ${productName || heading}` : ''}`;
    };

    return unique.map((element, index) => {
      const ref = `e${index + 1}`;
      element.setAttribute('data-agent-ref', ref);
      const checkable = element.matches('input[type="checkbox"], input[type="radio"]');
      return {
        ref,
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        role: element.getAttribute('role') || implicit(element),
        name: nameOf(element),
        value: 'value' in element ? element.value : null,
        checked: checkable ? element.checked : null,
        disabled: 'disabled' in element ? element.disabled : element.getAttribute('aria-disabled') === 'true',
        group_context: contextOf(element)
      };
    });
  }, implicitRole.toString());
}

function relevantControls(observation) {
  return observation.filter(control =>
    (control.name === 'Men' && control.group_context.startsWith('Department')) ||
    (control.name === 'Shirts' && control.group_context.startsWith('Category')) ||
    (control.name === 'S' && control.group_context.startsWith('Size')) ||
    (control.name === 'Blue' && control.group_context.startsWith('Color')) ||
    control.id === 'priceRange'
  ).map(({ ref, id, role, name, value, checked, disabled, group_context }) =>
    ({ ref, id, role, name, value, checked, disabled, group_context })
  );
}

function goalState(controls) {
  const find = (name, context) => controls.find(c => c.name === name && c.group_context.startsWith(context));
  const men = find('Men', 'Department');
  const shirts = find('Shirts', 'Category');
  const small = find('S', 'Size');
  const blue = find('Blue', 'Color');
  const price = controls.find(c => c.id === 'priceRange');
  return {
    departmentMen: men?.checked === true,
    categoryShirts: shirts?.checked === true,
    sizeSmall: small?.checked === true,
    colorBlue: blue?.checked === true,
    maxPrice70: Number(price?.value) <= 70
  };
}

function isGoalComplete(state) {
  return Object.values(state).every(Boolean);
}

async function chooseAction(ai, controls, state, feedback = null) {
  const prompt = `You control a browser only through the structured action schema.

User goal:
${GOAL}

Current verified goal state:
${JSON.stringify(state, null, 2)}

These are the available browser controls:
${JSON.stringify(controls, null, 2)}

Choose exactly ONE next action that advances an incomplete part of the goal.
Allowed actions: click, check, uncheck, fill, select.
Use only a ref shown above. Never output JavaScript or a selector.
For the price slider use action "fill" and value "70".
For checkboxes and radio buttons use action "check" and value null.
${feedback ? `Previous action feedback: ${feedback}` : ''}`;

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: actionSchema
    }
  });
  return JSON.parse(response.text);
}

function validateAction(action, controls) {
  if (!action || !ALLOWED_ACTIONS.has(action.action)) throw new Error('Action type is not allowed.');
  const control = controls.find(item => item.ref === action.ref);
  if (!control) throw new Error(`Unknown or unavailable ref: ${action.ref}`);
  if (control.disabled) throw new Error(`Control ${action.ref} is disabled.`);
  const compatible = {
    click: ['button', 'link'], check: ['checkbox', 'radio'], uncheck: ['checkbox'],
    fill: ['textbox', 'searchbox', 'spinbutton', 'slider'], select: ['combobox', 'listbox']
  };
  if (!compatible[action.action].includes(control.role)) {
    throw new Error(`${action.action} is incompatible with role ${control.role}.`);
  }
  if (['fill', 'select'].includes(action.action) && typeof action.value !== 'string') {
    throw new Error(`${action.action} requires a string value.`);
  }
  if (control.id === 'priceRange' && action.value !== '70') throw new Error('Price must be filled with exactly 70.');
  return control;
}

async function execute(page, action) {
  // The model never controls this selector. It can only choose a validated opaque ref.
  const locator = page.locator(`[data-agent-ref="${action.ref}"]`);
  if (await locator.count() !== 1) throw new Error(`Expected exactly one element for ${action.ref}.`);
  let strategy = 'playwright-native';
  switch (action.action) {
    case 'click': await locator.click(); break;
    case 'check':
    case 'uncheck': {
      const desired = action.action === 'check';
      try {
        await locator.setChecked(desired, { timeout: 2500 });
      } catch (error) {
        // Real sites often visually replace a native checkbox/radio and set the
        // input to display:none. Activate its associated label, just as a user
        // would. This fallback is fixed executor code; the model supplies no JS.
        const activated = await locator.evaluate((element, shouldBeChecked) => {
          if (!(element instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(element.type)) {
            return false;
          }
          if (element.checked === shouldBeChecked) return true;
          const label = element.labels?.[0];
          if (label) label.click();
          else element.click();
          return element.checked === shouldBeChecked;
        }, desired);
        if (!activated) throw new Error(`Could not semantically activate ${action.ref}: ${error.message}`);
        strategy = 'associated-label-fallback';
      }
      break;
    }
    case 'fill': await locator.fill(action.value); break;
    case 'select': await locator.selectOption(action.value); break;
    default: throw new Error('Unsupported action.');
  }
  return { locator, strategy };
}

async function verify(locator, action) {
  if (action.action === 'check') return { checked: await locator.isChecked(), expected: true };
  if (action.action === 'uncheck') return { checked: await locator.isChecked(), expected: false };
  if (action.action === 'fill' || action.action === 'select') return { value: await locator.inputValue(), expected: action.value };
  return { clicked: true };
}

function verificationPassed(verification) {
  if ('checked' in verification) return verification.checked === verification.expected;
  if ('value' in verification) return verification.value === verification.expected;
  return verification.clicked === true;
}

function saveTrajectory(trajectory) {
  const directory = path.join(__dirname, 'trajectories');
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `trajectory-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(trajectory, null, 2));
  return file;
}

(async () => {
  if (!smokeMode && !process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY. Add it to mini-ecommerce-store/.env first.');
  }
  const ai = smokeMode ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const trajectory = { goal: GOAL, started_at: new Date().toISOString(), steps: [] };
  let exitCode = 0;

  try {
    await page.goto(`file://${path.resolve(__dirname, 'index.html').replace(/\\/g, '/')}`);
    await page.waitForLoadState('domcontentloaded');
    const limit = runOneStepOnly || smokeMode ? 1 : MAX_STEPS;

    for (let step = 1; step <= limit; step++) {
      const before = relevantControls(await observe(page));
      const beforeState = goalState(before);
      if (isGoalComplete(beforeState)) break;

      let action;
      let feedback = null;
      if (smokeMode) {
        const men = before.find(control => control.name === 'Men' && control.group_context.startsWith('Department'));
        action = { action: 'check', ref: men.ref, value: null, reason: 'Smoke test: select the Men department.' };
        validateAction(action, before);
      }
      for (let attempt = 1; !smokeMode && attempt <= 2; attempt++) {
        try {
          action = await chooseAction(ai, before, beforeState, feedback);
          validateAction(action, before);
          break;
        } catch (error) {
          feedback = error.message;
          trajectory.steps.push({ step, attempt, phase: 'decision_retry', feedback });
          if (attempt === 2) throw error;
        }
      }

      const { locator, strategy } = await execute(page, action);
      const verification = await verify(locator, action);
      const after = relevantControls(await observe(page));
      const afterState = goalState(after);
      const result = verificationPassed(verification) ? 'success' : 'failure';
      trajectory.steps.push({
        step,
        goal: GOAL,
        observation: before,
        model_response: action,
        action: { type: action.action, ref: action.ref, value: action.value },
        executor_strategy: strategy,
        result,
        verification,
        checkpoint: afterState
      });
      console.log(JSON.stringify(trajectory.steps.at(-1), null, 2));
      if (result !== 'success') throw new Error(`Verification failed for ${action.ref}.`);
      if (isGoalComplete(afterState)) break;
    }

    const finalControls = relevantControls(await observe(page));
    trajectory.final_state = goalState(finalControls);
    trajectory.goal_completed = isGoalComplete(trajectory.final_state);
    trajectory.finished_at = new Date().toISOString();
    if (!runOneStepOnly && !smokeMode && !trajectory.goal_completed) exitCode = 1;
  } catch (error) {
    trajectory.error = error.message;
    trajectory.finished_at = new Date().toISOString();
    exitCode = 1;
  } finally {
    const file = saveTrajectory(trajectory);
    console.log(JSON.stringify({ trajectory: file, goal_completed: trajectory.goal_completed ?? false, final_state: trajectory.final_state ?? null, error: trajectory.error ?? null }, null, 2));
    await browser.close();
    process.exitCode = exitCode;
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
