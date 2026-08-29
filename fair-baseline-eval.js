require('dotenv').config({ quiet: true });
const { GoogleGenAI, Type } = require('@google/genai');
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_STEPS = 10;
const PROMPT_VERSION = 'fair-baseline-v1';
const ACTIONS = ['click', 'check', 'uncheck', 'fill', 'select'];
let lastCallAt = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Evaluation-only ground truth. Nothing from target or expected is passed to
// chooseAction. Keep this list aligned with Agent Core's 10-task benchmark.
const TASKS = [
  { id: 1, goal: "Men's blue shirt, S, under $70", target: { department: 'Men', category: 'Shirts', size: 'S', color: 'Blue', maxPrice: 70 }, expected: { goal_status: 'completed', match_exists: true }, fixture: 'rerender-after-department' },
  { id: 2, goal: "Women's black trousers, M, under $100", target: { department: 'Women', category: 'Trousers', size: 'M', color: 'Black', maxPrice: 100 }, expected: { goal_status: 'completed', match_exists: true } },
  { id: 3, goal: "Men's white shirt, L, under $90", target: { department: 'Men', category: 'Shirts', size: 'L', color: 'White', maxPrice: 90 }, expected: { goal_status: 'completed', match_exists: true } },
  { id: 4, goal: "Women's blue shirt, S, under $60", target: { department: 'Women', category: 'Shirts', size: 'S', color: 'Blue', maxPrice: 60 }, expected: { goal_status: 'impossible', match_exists: false } },
  { id: 5, goal: "Men's trousers under $50", target: { department: 'Men', category: 'Trousers', maxPrice: 50 }, expected: { goal_status: 'impossible', match_exists: false } },
  { id: 6, goal: 'Any small shirt under $80', target: { category: 'Shirts', size: 'S', maxPrice: 80 }, expected: { goal_status: 'completed', match_exists: true }, fixture: 'ambiguous-small' },
  { id: 7, goal: 'Blue clothing under $40', target: { color: 'Blue', maxPrice: 40 }, expected: { goal_status: 'impossible', match_exists: false } },
  { id: 8, goal: 'Find a purple XXL shirt under $5', target: { category: 'Shirts', size: 'XXL', color: 'Purple', maxPrice: 5 }, expected: { goal_status: 'impossible', match_exists: false } },
  { id: 9, goal: "Show men's clothing (Men is already selected)", target: { department: 'Men' }, initial: { department: 'Men' }, expected: { goal_status: 'completed', match_exists: true, max_actions: 0 } },
  { id: 10, goal: "Men's small shirts under $70, but Small is disabled", target: { department: 'Men', category: 'Shirts', size: 'S', maxPrice: 70 }, expected: { goal_status: 'impossible', match_exists: false }, fixture: 'disabled-small' }
];

const actionSchema = { type: Type.OBJECT, properties: {
  action: { type: Type.STRING, enum: ACTIONS },
  ref: { type: Type.STRING }, value: { type: Type.STRING, nullable: true }, reason: { type: Type.STRING }
}, required: ['action', 'ref', 'value', 'reason'] };

// Baseline observation: basic semantics only, without Agent Core group_context.
async function observe(page) {
  return page.locator('button, a, input, select, textarea, [role]').evaluateAll(nodes => {
    document.querySelectorAll('[data-baseline-ref]').forEach(el => el.removeAttribute('data-baseline-ref'));
    return [...new Set(nodes)].map((el, index) => {
      const ref = `e${index + 1}`; el.dataset.baselineRef = ref;
      const tag = el.tagName.toLowerCase();
      const roles = { checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox', text: 'textbox', email: 'textbox' };
      const role = el.getAttribute('role') || (tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'select' ? 'combobox' : tag === 'input' ? roles[el.type] || 'textbox' : tag === 'textarea' ? 'textbox' : null);
      const name = (el.getAttribute('aria-label') || el.title || el.labels?.[0]?.textContent || el.placeholder || el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
      return { ref, role, name, value: 'value' in el ? el.value : null,
        checked: ['checkbox', 'radio'].includes(el.type) ? el.checked : null,
        disabled: 'disabled' in el ? el.disabled : el.getAttribute('aria-disabled') === 'true' };
    });
  });
}

async function chooseAction(ai, goal, controls, resultText) {
  const prompt = `You are a browser agent. Choose exactly one browser action that makes progress toward the user's goal.\n\nUser goal:\n${goal}\n\nCurrent page summary:\n${resultText}\n\nInteractive controls:\n${JSON.stringify(controls)}\n\nUse exactly one ref shown above. Allowed actions are click, check, uncheck, fill, and select. Use check for checkboxes/radios, fill for text/range inputs, and select for dropdowns. Do not output selectors or JavaScript.`;
  const pacing = Math.max(0, 4250 - (Date.now() - lastCallAt));
  if (pacing) await wait(pacing);
  lastCallAt = Date.now();
  const started = Date.now();
  const response = await ai.models.generateContent({ model: MODEL, contents: prompt,
    config: { temperature: 0, responseMimeType: 'application/json', responseSchema: actionSchema } });
  return { action: JSON.parse(response.text), latency_ms: Date.now() - started };
}

function validate(action, controls) {
  if (!ACTIONS.includes(action.action)) throw new Error('unsupported action');
  const control = controls.find(c => c.ref === action.ref);
  if (!control) throw new Error(`unknown ref ${action.ref}`);
  const compatible = { click: ['button', 'link'], check: ['checkbox', 'radio'], uncheck: ['checkbox'], fill: ['textbox', 'searchbox', 'slider'], select: ['combobox'] };
  if (!compatible[action.action].includes(control.role)) throw new Error(`${action.action} incompatible with ${control.role}`);
  if (control.disabled) throw new Error(`control ${action.ref} is disabled`);
  if (['fill', 'select'].includes(action.action) && typeof action.value !== 'string') throw new Error(`${action.action} requires a value`);
}

// Basic native Playwright execution with label activation as compatibility only;
// no verification, stale-ref recovery, or verification-driven replanning.
async function activateCheckable(locator, desired) {
  try {
    await locator.setChecked(desired, { timeout: 3000 });
  } catch (nativeError) {
    // Compatibility only: visually hidden native controls are activated through
    // their associated label. No resulting state is checked or sent to Gemini.
    const usedLabel = await locator.evaluate(element => {
      const label = element.labels?.[0];
      if (!label) return false;
      label.click();
      return true;
    });
    if (!usedLabel) throw nativeError;
  }
}

async function execute(page, action) {
  const locator = page.locator(`[data-baseline-ref="${action.ref}"]`);
  if (action.action === 'click') await locator.click({ timeout: 3000 });
  if (action.action === 'check') await activateCheckable(locator, true);
  if (action.action === 'uncheck') await activateCheckable(locator, false);
  if (action.action === 'fill') await locator.fill(action.value, { timeout: 3000 });
  if (action.action === 'select') await locator.selectOption(action.value, { timeout: 3000 });
}

async function installFixture(page, task) {
  if (task.initial?.department) await page.locator(`input[name="department"][value="${task.initial.department}"]`).check();
  if (task.fixture === 'ambiguous-small') await page.locator('#filters').evaluate(filters => {
    const fieldset = document.createElement('fieldset');
    fieldset.innerHTML = '<legend>Promotions</legend><label><input type="checkbox" value="Small" aria-label="Small"> Small discount</label>';
    filters.appendChild(fieldset);
  });
  if (task.fixture === 'disabled-small') await page.locator('#sizeFilters input[value="S"]').evaluate(el => { el.disabled = true; el.setAttribute('aria-label', 'Small'); });
  if (task.fixture === 'rerender-after-department') await page.locator('input[name="department"]').evaluateAll(nodes => nodes.forEach(node => node.addEventListener('change', () => {
    const host = document.querySelector('#categoryFilters'); host.innerHTML = host.innerHTML;
    host.onchange = () => { state.categories = new Set([...host.querySelectorAll('input:checked')].map(x => x.value)); render(); };
  })));
}

// Everything below is evaluator-side ground truth and is never used by the model.
async function evaluateState(page, target) {
  return page.evaluate(target => {
    const checked = (value, legend) => [...document.querySelectorAll('.filters fieldset')].some(fieldset =>
      fieldset.querySelector(':scope > legend')?.textContent.trim() === legend && fieldset.querySelector(`input[value="${value}"]`)?.checked);
    const checkpoint = {};
    if (target.department) checkpoint.department = checked(target.department, 'Department');
    if (target.category) checkpoint.category = checked(target.category, 'Category');
    if (target.size) checkpoint.size = checked(target.size, 'Size');
    if (target.color) checkpoint.color = checked(target.color, 'Color');
    if (target.maxPrice != null) checkpoint.maxPrice = Number(document.querySelector('#priceRange').value) <= target.maxPrice;
    return { checkpoint, result_count: Number(document.querySelector('#resultCount').textContent.match(/\d+/)?.[0] || 0) };
  }, target);
}

function score(task, state, steps, runtimeError) {
  if (runtimeError) {
    let failure_category = 'execution_error';
    if (/not visible|Timeout 3000ms/.test(runtimeError)) failure_category = 'hidden_control_execution';
    else if (/Malformed value/.test(runtimeError)) failure_category = 'invalid_control_value';
    else if (/incompatible with/.test(runtimeError)) failure_category = 'invalid_action_for_role';
    else if (/disabled/.test(runtimeError)) failure_category = 'disabled_control';
    else if (/fetch failed|429|ECONNRESET|ETIMEDOUT/i.test(runtimeError)) failure_category = 'infrastructure_error';
    return { passed: false, final_status: 'error', failure_category, failure_reason: runtimeError };
  }
  const checkpointComplete = Object.values(state.checkpoint).every(Boolean);
  const inferredStatus = checkpointComplete ? (state.result_count > 0 ? 'completed' : 'impossible') : 'step_limit';
  if (task.expected.max_actions != null && steps > task.expected.max_actions) return { passed: false, final_status: inferredStatus, failure_category: 'unnecessary_actions', failure_reason: `already-satisfied goal required 0 actions; baseline took ${steps}` };
  if (!checkpointComplete) return { passed: false, final_status: inferredStatus, failure_category: 'max_steps_incomplete', failure_reason: 'maximum steps ended without the required final filter state' };
  if (inferredStatus !== task.expected.goal_status) return { passed: false, final_status: inferredStatus, failure_category: 'wrong_final_status', failure_reason: `expected ${task.expected.goal_status}, observed ${inferredStatus}` };
  return { passed: true, final_status: inferredStatus, failure_category: null, failure_reason: null };
}

async function runTask(browser, ai, task, site) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const started = Date.now();
  const record = { task_id: task.id, goal: task.goal, expected_final_state: task.expected,
    started_at: new Date().toISOString(), steps: [], gemini_calls: 0, errors: [], retries: 0 };
  let runtimeError = null;
  try {
    await page.goto(site); await page.waitForLoadState('domcontentloaded'); await installFixture(page, task);
    for (let step = 1; step <= MAX_STEPS; step++) {
      const controls = await observe(page);
      const resultText = await page.locator('#resultCount').textContent();
      record.gemini_calls++;
      const picked = await chooseAction(ai, task.goal, controls, resultText);
      const stepRecord = { step, action: picked.action, latency_ms: picked.latency_ms, executed: false };
      record.steps.push(stepRecord);
      validate(picked.action, controls);
      await execute(page, picked.action);
      stepRecord.executed = true;
    }
  } catch (error) {
    runtimeError = error.message; record.errors.push(error.message);
  }
  const state = await evaluateState(page, task.target);
  Object.assign(record, score(task, state, record.steps.length, runtimeError));
  record.final_observation = state; record.agent_steps = record.steps.length;
  record.total_latency_ms = Date.now() - started; record.finished_at = new Date().toISOString();
  await page.close(); return record;
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const browser = await chromium.launch({ headless: true });
  const site = `file://${path.resolve(__dirname, 'index.html').replace(/\\/g, '/')}`;
  const tasks = [];
  try {
    for (const task of TASKS) {
      const result = await runTask(browser, ai, task, site); tasks.push(result);
      console.log(`Task ${task.id} ${result.passed ? 'PASS' : 'FAIL'} - ${result.final_status}${result.failure_reason ? `: ${result.failure_reason}` : ''}`);
    }
  } finally { await browser.close(); }
  const passed = tasks.filter(t => t.passed).length;
  const failuresByReason = tasks.filter(t => !t.passed).reduce((groups, task) => {
    groups[task.failure_category] = (groups[task.failure_category] || 0) + 1; return groups;
  }, {});
  const report = { evaluation_id: crypto.randomUUID(), architecture: 'fair-baseline-v1', model: MODEL,
    prompt_version: PROMPT_VERSION, site, max_steps: MAX_STEPS, started_at: tasks[0]?.started_at,
    finished_at: new Date().toISOString(), tasks, aggregate: {
      tasks_passed: passed, tasks_total: tasks.length, success_percentage: passed / tasks.length * 100,
      average_steps_per_task: tasks.reduce((sum, t) => sum + t.agent_steps, 0) / tasks.length,
      average_latency_ms_per_task: tasks.reduce((sum, t) => sum + t.total_latency_ms, 0) / tasks.length,
      total_gemini_calls: tasks.reduce((sum, t) => sum + t.gemini_calls, 0),
      total_retries: tasks.reduce((sum, t) => sum + t.retries, 0), failures_grouped_by_reason: failuresByReason
    } };
  const directory = path.join(__dirname, 'trajectories'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `fair-baseline-evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`${passed} / ${tasks.length} successful = ${report.aggregate.success_percentage.toFixed(1)}%`);
  console.log(`Report: ${file}`);
  process.exitCode = passed === tasks.length ? 0 : 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
