require('dotenv').config({ quiet: true });
const { GoogleGenAI } = require('@google/genai');
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PROMPT_VERSION, observeForPlanner, compactPlannerInput, generateModelPlan,
  applySafetyOverrides, safetyClassification } = require('./focus-planner');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
let lastCallAt = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Evaluation-only labels. They are resolved against observations after planning
// and are never included in planner input or the Gemini prompt.
const TESTS = [
  { id: 1, goal: "Find a men's blue shirt in size S under $70", expected_attention: [
    { value: 'Men', group: 'Department' }, { value: 'Shirts', group: 'Category' },
    { value: 'S', group: 'Size' }, { value: 'Blue', group: 'Color' }, { name: /Up to/i, role: 'slider' }
  ] },
  { id: 2, goal: "Find men's trousers", expected_attention: [
    { value: 'Men', group: 'Department' }, { value: 'Trousers', group: 'Category' }
  ] },
  { id: 3, goal: 'Find shirts under $80', expected_attention: [
    { value: 'Shirts', group: 'Category' }, { name: /Up to/i, role: 'slider' }
  ] },
  { id: 4, goal: "Show men's clothing; the Men filter is already selected", initial: { department: 'Men' }, expected_attention: [
    { value: 'Men', group: 'Department' }
  ] },
  { id: 5, goal: 'Find a purple XXL shirt under $5', expected_attention: [
    { value: 'Shirts', group: 'Category' }, { name: /Up to/i, role: 'slider' }
  ], unavailable_requirements: ['Purple color control', 'XXL size control', 'price below slider minimum'] }
];

function matches(element, descriptor) {
  if (descriptor.role && element.role !== descriptor.role) return false;
  if (descriptor.group && element.group_context !== descriptor.group) return false;
  if (descriptor.value && element.state?.value !== descriptor.value) return false;
  if (descriptor.name instanceof RegExp && !descriptor.name.test(element.name)) return false;
  return true;
}

function evaluatePlan(test, observation, finalPlan) {
  const finalByRef = new Map(finalPlan.elements.map(item => [item.ref, item.final_classification]));
  const expectedRefs = test.expected_attention.map(descriptor => observation.find(element => matches(element, descriptor))?.ref).filter(Boolean);
  const preserved = classification => classification && classification !== 'deemphasize';
  const recalledRefs = expectedRefs.filter(ref => preserved(finalByRef.get(ref)));
  const safetyRefs = observation.filter(safetyClassification).map(element => element.ref);
  const unsafeRefs = safetyRefs.filter(ref => !preserved(finalByRef.get(ref)));
  const actionable = observation.filter(element => element.semantic_hints.actionable);
  const focusedActionable = actionable.filter(element => preserved(finalByRef.get(element.ref)));
  const reduction = actionable.length ? (actionable.length - focusedActionable.length) / actionable.length : 0;
  return {
    expected_relevant_refs: expectedRefs,
    recalled_relevant_refs: recalledRefs,
    relevant_control_recall: expectedRefs.length ? recalledRefs.length / expectedRefs.length : 1,
    safety_element_refs: safetyRefs,
    unsafe_omission_refs: unsafeRefs,
    unsafe_omission_count: unsafeRefs.length,
    total_visible_actionable_elements: actionable.length,
    focused_preserved_actionable_elements: focusedActionable.length,
    interactive_decision_space_reduction: reduction
  };
}

async function runTest(browser, ai, test, site) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(site); await page.waitForLoadState('domcontentloaded');
    if (test.initial?.department) await page.locator(`input[name="department"][value="${test.initial.department}"]`).check();
    const observation = await observeForPlanner(page);
    const pageInfo = { title: await page.title(), url: page.url() };
    const plannerInput = compactPlannerInput(test.goal, observation, pageInfo);
    const pacing = Math.max(0, 4250 - (Date.now() - lastCallAt));
    if (pacing) await wait(pacing);
    lastCallAt = Date.now();
    const generated = await generateModelPlan(ai, MODEL, plannerInput);
    const finalPlan = applySafetyOverrides(generated.plan, observation);
    const metrics = evaluatePlan(test, observation, finalPlan);
    return {
      test_id: test.id, goal: test.goal,
      planner_input_summary: { page: plannerInput.page, element_count: observation.length,
        actionable_element_count: observation.filter(element => element.semantic_hints.actionable).length,
        roles: observation.reduce((counts, element) => { counts[element.role] = (counts[element.role] || 0) + 1; return counts; }, {}) },
      unavailable_requirements: test.unavailable_requirements || [],
      gemini_output: generated.plan, safety_overrides: finalPlan.safety_overrides,
      final_classifications: finalPlan.elements, ...metrics,
      model: MODEL, prompt_version: PROMPT_VERSION, latency_ms: generated.latency_ms
    };
  } finally { await page.close(); }
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const browser = await chromium.launch({ headless: true });
  const site = `file://${path.resolve(__dirname, 'index.html').replace(/\\/g, '/')}`;
  const startedAt = new Date().toISOString();
  const tests = [];
  try {
    for (const test of TESTS) {
      const result = await runTest(browser, ai, test, site); tests.push(result);
      console.log(`Test ${test.id}: recall ${(result.relevant_control_recall * 100).toFixed(1)}%, unsafe ${result.unsafe_omission_count}, reduction ${(result.interactive_decision_space_reduction * 100).toFixed(1)}%`);
    }
  } finally { await browser.close(); }
  const report = {
    evaluation_id: crypto.randomUUID(), component: 'guidemode-focus-planner', model: MODEL,
    prompt_version: PROMPT_VERSION, site, started_at: startedAt, finished_at: new Date().toISOString(), tests,
    aggregate: {
      relevant_control_recall: tests.reduce((sum, test) => sum + test.recalled_relevant_refs.length, 0) / tests.reduce((sum, test) => sum + test.expected_relevant_refs.length, 0),
      unsafe_omission_count: tests.reduce((sum, test) => sum + test.unsafe_omission_count, 0),
      average_interactive_decision_space_reduction: tests.reduce((sum, test) => sum + test.interactive_decision_space_reduction, 0) / tests.length,
      average_latency_ms: tests.reduce((sum, test) => sum + test.latency_ms, 0) / tests.length,
      total_safety_overrides: tests.reduce((sum, test) => sum + test.safety_overrides.length, 0)
    }
  };
  const directory = path.join(__dirname, 'trajectories'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `focus-planner-evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.aggregate, null, 2)); console.log(`Report: ${file}`);
  process.exitCode = report.aggregate.unsafe_omission_count === 0 ? 0 : 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
