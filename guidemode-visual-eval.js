require('dotenv').config({ quiet: true });
const { GoogleGenAI } = require('@google/genai');
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PROMPT_VERSION: PLANNER_PROMPT_VERSION, observeForPlanner, compactPlannerInput,
  generateModelPlan, applySafetyOverrides } = require('./focus-planner');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const VISUAL_VERSION = 'guidemode-visual-v1';
const VIEWPORT = { width: 1440, height: 1000 };
const GUIDEMODE_SCRIPTS = ['state.js', 'styles.js', 'panel.js', 'renderer.js', 'metrics.js'];
let lastCallAt = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const CASES = [
  { id: 'constrained', goal: "Find me a men's blue shirt in size small under $70.", current: { value: 'S', group_context: 'Size' } },
  { id: 'broad', goal: "Find men's trousers.", current: { value: 'Men', group_context: 'Department' } },
  { id: 'impossible', goal: 'Find a purple XXL shirt under $5.', current: { value: 'Shirts', group_context: 'Category' } }
];

function findCurrentRef(observation, plan, descriptor) {
  const relevant = new Set(plan.elements.filter(item => item.final_classification === 'relevant').map(item => item.ref));
  const exact = observation.find(item => relevant.has(item.ref) &&
    (!descriptor.value || item.state?.value === descriptor.value) &&
    (!descriptor.group_context || item.group_context === descriptor.group_context));
  return exact?.ref || observation.find(item => relevant.has(item.ref) && item.semantic_hints?.actionable)?.ref || null;
}

function actionLabel(element) {
  if (!element) return null;
  if (['checkbox', 'radio'].includes(element.role)) return `Selecting ${element.name}`;
  if (element.role === 'slider') return `Adjusting ${element.name}`;
  return `Working on ${element.name}`;
}

async function injectGuideMode(page) {
  for (const filename of GUIDEMODE_SCRIPTS) {
    await page.addScriptTag({ path: path.join(__dirname, 'guidemode', filename) });
  }
}

async function screenshot(page, directory, name) {
  const file = path.join(directory, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  return file;
}

async function planFor(ai, page, goal) {
  const observation = await observeForPlanner(page);
  const plannerInput = compactPlannerInput(goal, observation, { title: await page.title(), url: page.url() });
  const pacing = Math.max(0, 4250 - (Date.now() - lastCallAt));
  if (pacing) await wait(pacing);
  lastCallAt = Date.now();
  const generated = await generateModelPlan(ai, MODEL, plannerInput);
  return { observation, modelPlan: generated.plan, finalPlan: applySafetyOverrides(generated.plan, observation), planner_latency_ms: generated.latency_ms };
}

async function runCase(browser, ai, testCase, site, rootDirectory) {
  const page = await browser.newPage({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  const caseDirectory = path.join(rootDirectory, testCase.id);
  fs.mkdirSync(caseDirectory, { recursive: true });
  try {
    await page.goto(site); await page.waitForLoadState('domcontentloaded');
    await page.locator('#shop').scrollIntoViewIfNeeded();
    const planned = await planFor(ai, page, testCase.goal);
    const currentRef = findCurrentRef(planned.observation, planned.finalPlan, testCase.current);
    const currentElement = planned.observation.find(item => item.ref === currentRef);
    const screenshots = {};
    screenshots.original = await screenshot(page, caseDirectory, '01-original');

    await injectGuideMode(page);
    // Weak DOM handles cannot cross the Playwright boundary, so the browser-side
    // metrics module retains its own baseline immediately before renderer creation.
    await page.evaluate(({ observation, plan, goal }) => {
      window.__guideModeBaseline = window.GuideMode.captureBaseline(observation);
      window.GuideMode.create({ observation, plan, goal, currentAction: null });
    }, { observation: planned.observation, plan: planned.finalPlan, goal: testCase.goal });
    screenshots.applied = await screenshot(page, caseDirectory, '02-guidemode-applied');

    await page.evaluate(({ ref, label }) => window.GuideMode.instance.setCurrentAction(ref ? { ref, label } : null),
      { ref: currentRef, label: actionLabel(currentElement) });
    if (currentRef) await page.evaluate(ref => {
      const source = document.querySelector(`[data-focus-ref="${CSS.escape(ref)}"]`);
      const visualTarget = document.querySelector(`[data-guidemode-proxy-for="${CSS.escape(ref)}"]`) || source;
      visualTarget?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, currentRef);
    screenshots.current_target = await screenshot(page, caseDirectory, '03-current-target');

    const applied = await page.evaluate(({ observation, plan, currentRef }) => ({
      metrics: window.GuideMode.collectMetrics(observation, plan, currentRef),
      safety_failures: window.GuideMode.validateApplied(window.__guideModeBaseline, observation, plan, currentRef),
      accessibility_failures: window.GuideMode.auditPanelAccessibility()
    }), { observation: planned.observation, plan: planned.finalPlan, currentRef });

    await page.evaluate(() => window.GuideMode.instance.panel.shadow.querySelector('[data-action="original"]').click());
    const originalModeFailures = await page.evaluate(() => window.GuideMode.validateOriginalMode(window.__guideModeBaseline));
    screenshots.restored_original = await screenshot(page, caseDirectory, '04-restored-original');

    await page.evaluate(() => window.GuideMode.instance.panel.shadow.querySelector('[data-action="return"]').click());
    const returnedModeFailures = await page.evaluate(({ observation, plan, currentRef }) =>
      window.GuideMode.validateReturnedMode(window.__guideModeBaseline, observation, plan, currentRef),
    { observation: planned.observation, plan: planned.finalPlan, currentRef });

    const restoreFailures = [...originalModeFailures, ...returnedModeFailures];
    return {
      case_id: testCase.id, goal: testCase.goal, viewport: VIEWPORT,
      planner: { model: MODEL, prompt_version: PLANNER_PROMPT_VERSION, latency_ms: planned.planner_latency_ms,
        observation_count: planned.observation.length, goal_summary: planned.finalPlan.goal_summary,
        safety_override_count: planned.finalPlan.safety_overrides.length },
      current_action: currentRef ? { ref: currentRef, user_label: actionLabel(currentElement) } : null,
      metrics: { ...applied.metrics, unsafe_visual_omissions: applied.safety_failures.filter(item => item.startsWith('unsafe-') || item.startsWith('hidden-')).length,
        restore_failures: restoreFailures.length },
      visual_safety_failures: applied.safety_failures,
      restore_failures: restoreFailures,
      accessibility_check: { passed: applied.accessibility_failures.length === 0, failures: applied.accessibility_failures },
      screenshots
    };
  } finally { await page.close(); }
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const browser = await chromium.launch({ headless: true });
  const site = `file://${path.resolve(__dirname, 'index.html').replace(/\\/g, '/')}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotRoot = path.join(__dirname, 'artifacts', `guidemode-visual-${stamp}`);
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const cases = [];
  try {
    for (const testCase of CASES) {
      const result = await runCase(browser, ai, testCase, site, screenshotRoot); cases.push(result);
      console.log(`${testCase.id}: focus ${(result.metrics.focus_ratio * 100).toFixed(1)}%, reduction ${(result.metrics.interactive_decision_space_reduction * 100).toFixed(1)}%, unsafe ${result.metrics.unsafe_visual_omissions}, restore failures ${result.metrics.restore_failures}`);
    }
  } finally { await browser.close(); }
  const report = {
    evaluation_id: crypto.randomUUID(), component: VISUAL_VERSION, model: MODEL,
    planner_prompt_version: PLANNER_PROMPT_VERSION, site, viewport: VIEWPORT,
    created_at: new Date().toISOString(), cases,
    aggregate: {
      average_focus_ratio: cases.reduce((sum, item) => sum + item.metrics.focus_ratio, 0) / cases.length,
      average_interactive_decision_space_reduction: cases.reduce((sum, item) => sum + item.metrics.interactive_decision_space_reduction, 0) / cases.length,
      unsafe_visual_omissions: cases.reduce((sum, item) => sum + item.metrics.unsafe_visual_omissions, 0),
      restore_failures: cases.reduce((sum, item) => sum + item.metrics.restore_failures, 0),
      accessibility_failures: cases.reduce((sum, item) => sum + item.accessibility_check.failures.length, 0)
    },
    screenshot_root: screenshotRoot
  };
  const trajectoryDirectory = path.join(__dirname, 'trajectories');
  const reportFile = path.join(trajectoryDirectory, `guidemode-visual-evaluation-${stamp}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.aggregate, null, 2)); console.log(`Report: ${reportFile}`); console.log(`Screenshots: ${screenshotRoot}`);
  process.exitCode = report.aggregate.unsafe_visual_omissions || report.aggregate.restore_failures || report.aggregate.accessibility_failures ? 1 : 0;
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
