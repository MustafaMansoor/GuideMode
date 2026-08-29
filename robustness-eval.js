require('dotenv').config({ quiet: true });
const { GoogleGenAI, Type } = require('@google/genai');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PROMPT_VERSION = 'robustness-v1';
const smokeMode = process.argv.includes('--smoke');
const ACTIONS = new Set(['check', 'fill', 'impossible']);
let lastApiCallAt = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Outcomes are declared before execution. Checkpoints remain intentionally
// task-specific until this suite tells us what should be generalized.
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

const schema = { type: Type.OBJECT, properties: {
  action: { type: Type.STRING, enum: [...ACTIONS] }, ref: { type: Type.STRING, nullable: true },
  value: { type: Type.STRING, nullable: true }, reason: { type: Type.STRING }
}, required: ['action', 'ref', 'value', 'reason'] };

async function observe(page) {
  return page.locator('.filters input').evaluateAll(nodes => {
    document.querySelectorAll('[data-agent-ref]').forEach(el => el.removeAttribute('data-agent-ref'));
    return nodes.map((el, i) => {
      const ref = `e${i + 1}`; el.dataset.agentRef = ref;
      const fieldset = el.closest('fieldset');
      return { ref, id: el.id || null, role: el.type === 'range' ? 'slider' : el.type,
        name: (el.getAttribute('aria-label') || el.title || el.labels?.[0]?.textContent || el.value || '').replace(/\s+/g, ' ').trim(),
        value: el.value, checked: ['checkbox', 'radio'].includes(el.type) ? el.checked : null,
        disabled: el.disabled, min: el.min || null, max: el.max || null,
        group_context: fieldset?.querySelector(':scope > legend')?.textContent.trim() || 'document' };
    });
  });
}

function controlsFor(all, target) {
  const pairs = [['department', 'Department'], ['category', 'Category'], ['size', 'Size'], ['color', 'Color']];
  const found = [];
  for (const [key] of pairs) if (target[key]) found.push(...all.filter(c => c.value === target[key] || c.name === target[key]));
  if (target.maxPrice != null) found.push(...all.filter(c => c.id === 'priceRange'));
  if (target.size === 'S') found.push(...all.filter(c => /^(S|Small)$/.test(c.name)));
  return [...new Map(found.map(c => [c.ref, c])).values()];
}

function checkpoint(all, target) {
  const yes = (value, group) => all.some(c => c.value === value && c.group_context === group && c.checked);
  const state = {};
  if (target.department) state.department = yes(target.department, 'Department');
  if (target.category) state.category = yes(target.category, 'Category');
  if (target.size) state.size = yes(target.size, 'Size');
  if (target.color) state.color = yes(target.color, 'Color');
  if (target.maxPrice != null) state.maxPrice = Number(all.find(c => c.id === 'priceRange')?.value) <= target.maxPrice;
  return state;
}
const complete = state => Object.values(state).every(Boolean);

async function setup(page, task) {
  if (task.initial?.department) await page.locator(`input[name="department"][value="${task.initial.department}"]`).check();
  if (task.fixture === 'ambiguous-small') await page.locator('#filters').evaluate(filters => {
    const fieldset = document.createElement('fieldset');
    fieldset.innerHTML = '<legend>Promotions</legend><label><input type="checkbox" value="Small" aria-label="Small"> Small discount</label>';
    filters.appendChild(fieldset);
  });
  if (task.fixture === 'disabled-small') {
    await page.locator('#sizeFilters input[value="S"]').evaluate(el => { el.disabled = true; el.setAttribute('aria-label', 'Small'); });
  }
  if (task.fixture === 'rerender-after-department') {
    await page.locator('input[name="department"]').evaluateAll(nodes => nodes.forEach(node => node.addEventListener('change', () => {
      const host = document.querySelector('#categoryFilters');
      host.innerHTML = host.innerHTML;
      host.onchange = () => { state.categories = new Set([...host.querySelectorAll('input:checked')].map(x => x.value)); render(); };
    })));
  }
}

async function decide(ai, task, controls, state, count, feedback) {
  const prompt = `Choose exactly one shopping-filter action.\nGoal: ${task.goal}\nTarget: ${JSON.stringify(task.target)}\nVerified checkpoint: ${JSON.stringify(state)}\nCurrent result count: ${count}\nControls: ${JSON.stringify(controls)}\nUse group_context to disambiguate. Do not change a satisfied criterion or use disabled controls. Use check for checkbox/radio and fill for price with the exact requested maximum. Return impossible only when a required control is absent/disabled, price is outside its range, or every requested filter is set and results are zero.${feedback ? `\nPrevious error: ${feedback}` : ''}`;
  const start = Date.now();
  const api_errors = [];
  for (let apiAttempt = 0; apiAttempt < 3; apiAttempt++) {
    // Keep a small safety margin below the configured 15 requests/minute.
    const pacing = Math.max(0, 4250 - (Date.now() - lastApiCallAt));
    if (pacing) await delay(pacing);
    lastApiCallAt = Date.now();
    try {
      const response = await ai.models.generateContent({ model: MODEL, contents: prompt, config: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema } });
      return { decision: JSON.parse(response.text), latency_ms: Date.now() - start, api_retry_count: apiAttempt, api_errors };
    } catch (error) {
      api_errors.push(error.message);
      const retryable = error.message.includes('429') || /fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message);
      if (!retryable || apiAttempt === 2) throw error;
      const seconds = error.message.includes('429')
        ? Number(error.message.match(/retry in ([\d.]+)s/i)?.[1] || 60)
        : 5;
      await delay(Math.ceil(seconds * 1000) + 1000);
    }
  }
}

function validate(d, controls, task) {
  if (!d || !ACTIONS.has(d.action)) throw new Error('unsupported action');
  if (d.action === 'impossible') return;
  const c = controls.find(x => x.ref === d.ref);
  if (!c) throw new Error(`unknown ref ${d.ref}`);
  if (c.disabled) throw new Error(`control ${d.ref} is disabled`);
  if (d.action === 'check' && !['checkbox', 'radio'].includes(c.role)) throw new Error('check requires checkbox/radio');
  if (d.action === 'fill' && (c.role !== 'slider' || d.value !== String(task.target.maxPrice))) throw new Error(`price must be ${task.target.maxPrice}`);
}

async function execute(page, d) {
  const locator = page.locator(`[data-agent-ref="${d.ref}"]`);
  if (await locator.count() !== 1) throw new Error(`stale or non-unique ref ${d.ref}`);
  if (d.action === 'check') {
    if (await locator.isVisible()) await locator.check();
    else {
      const checked = await locator.evaluate(el => { el.labels?.[0]?.click(); return el.checked; });
      if (!checked) throw new Error(`could not activate hidden control ${d.ref}`);
    }
  } else await locator.fill(d.value);
}

async function runTask(browser, ai, task, site) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const t = { trajectory_id: crypto.randomUUID(), task_id: task.id, goal: task.goal,
    model: smokeMode ? 'deterministic-smoke' : MODEL, prompt_version: PROMPT_VERSION, site,
    started_at: new Date().toISOString(), expected_final_state: task.expected,
    target_checkpoint: task.target, fixture: task.fixture || null, steps: [] };
  let status = 'step_limit', reason = 'maximum steps reached', actions = 0;
  try {
    await page.goto(site); await page.waitForLoadState('domcontentloaded'); await setup(page, task);
    for (let step = 1; step <= 10; step++) {
      const all = await observe(page), state = checkpoint(all, task.target);
      const count = Number((await page.locator('#resultCount').textContent()).match(/\d+/)?.[0] || 0);
      if (complete(state)) { status = count ? 'completed' : 'impossible'; reason = count ? 'checkpoint satisfied with matching results' : 'no matching result'; break; }
      const controls = controlsFor(all, task.target), errors = [];
      let picked, retries = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (smokeMode) {
            const slider = controls.find(c => c.id === 'priceRange');
            const unavailable = ['department', 'category', 'size', 'color'].some(key => task.target[key] && !controls.some(c => c.value === task.target[key] && !c.disabled)) ||
              (task.target.maxPrice != null && slider && Number(task.target.maxPrice) < Number(slider.min));
            const next = unavailable ? null : controls.find(c => !c.checked && !c.disabled && c.id !== 'priceRange') || controls.find(c => c.id === 'priceRange' && Number(c.value) > task.target.maxPrice);
            picked = { decision: next ? { action: next.id === 'priceRange' ? 'fill' : 'check', ref: next.ref, value: next.id === 'priceRange' ? String(task.target.maxPrice) : null, reason: 'smoke' } : { action: 'impossible', ref: null, value: null, reason: 'required control unavailable' }, latency_ms: 0 };
          } else picked = await decide(ai, task, controls, state, count, errors.at(-1));
          validate(picked.decision, controls, task); break;
        } catch (e) { errors.push(e.message); retries++; if (attempt === 1) throw e; }
      }
      if (picked.decision.action === 'impossible') {
        status = 'impossible'; reason = picked.decision.reason;
        t.steps.push({ step, observation: controls, checkpoint: state, result_count: count, model_response: picked.decision, latency_ms: picked.latency_ms, errors: [...errors, ...(picked.api_errors || [])], retry_count: retries + (picked.api_retry_count || 0) }); break;
      }
      const execStart = Date.now(); await execute(page, picked.decision); actions++;
      t.steps.push({ step, observation: controls, checkpoint_before: state, model_response: picked.decision,
        checkpoint_after: checkpoint(await observe(page), task.target), latency_ms: picked.latency_ms + Date.now() - execStart,
        errors: [...errors, ...(picked.api_errors || [])], retry_count: retries + (picked.api_retry_count || 0) });
    }
    t.final_state = checkpoint(await observe(page), task.target); t.goal_status = status; t.reason = reason; t.action_count = actions;
    t.passed = status === task.expected.goal_status && (status !== 'completed' || complete(t.final_state)) && (task.expected.max_actions == null || actions <= task.expected.max_actions);
  } catch (e) { t.goal_status = 'error'; t.reason = e.message; t.passed = false; }
  t.finished_at = new Date().toISOString(); await page.close(); return t;
}

(async () => {
  if (!smokeMode && !process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');
  const ai = smokeMode ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const browser = await chromium.launch({ headless: true });
  const site = `file://${path.resolve(__dirname, 'index.html').replace(/\\/g, '/')}`;
  const tasks = [];
  try { for (const task of TASKS) { const result = await runTask(browser, ai, task, site); tasks.push(result); console.log(`Task ${task.id} ${result.passed ? 'PASS' : 'FAIL'} - ${result.goal_status}: ${result.reason}`); } }
  finally { await browser.close(); }
  const passed = tasks.filter(t => t.passed).length;
  const report = { evaluation_id: crypto.randomUUID(), model: smokeMode ? 'deterministic-smoke' : MODEL, prompt_version: PROMPT_VERSION, site, started_at: tasks[0]?.started_at, finished_at: new Date().toISOString(), summary: { passed, total: TASKS.length, success_rate: passed / TASKS.length * 100 }, tasks };
  const dir = path.join(__dirname, 'trajectories'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`${passed} / ${TASKS.length} successful = ${report.summary.success_rate.toFixed(1)}%`); console.log(`Report: ${file}`);
  process.exitCode = passed === TASKS.length ? 0 : 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
