require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { ExtensionV2Adapter } = require('../../guidemode-extension-server/v2-adapter');
const { planFocus, plannerObservation, focusContextKey, reconcileFocusPlan } = require('../../guidemode-extension-server/focus-adapter');

if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
const extensionScript = path.join(__dirname, '..', 'content.js');
async function install(page) { await page.evaluate(() => { globalThis.chrome = { runtime: { onMessage: { addListener() {} } } }; }); await page.addScriptTag({ path: extensionScript }); }
const observe = page => page.evaluate(() => globalThis.__GuideModeTest.observe());
const execute = (page, action) => page.evaluate(value => globalThis.__GuideModeTest.execute(value), action);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const adapter = new ExtensionV2Adapter({ apiKey: process.env.GEMINI_API_KEY, requestsPerMinute: 15 });
  const report = { run_id: crypto.randomUUID(), component: 'guidemode-extension-live-agent-integration', model: adapter.model,
    source_agent_commit: 'ac958d97a549780876f5256a8f9e50e691187ee1', started_at: new Date().toISOString(), tests: [] };
  async function run({ id, goal, url, maxSteps, terminal }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const sessionId = crypto.randomUUID();
    const result = { id, goal, start_url: url, steps: [], status: 'step_limit', focus_planner_calls: 0, focus_cache_hits: 0 };
    let focusCache = null;
    try {
      await page.goto(url); await install(page); let previousExecution = null;
      for (let i = 0; i < maxSteps; i++) {
        const observation = await observe(page);
        const terminalState = await terminal(page, observation); if (terminalState) { result.status = terminalState; break; }
        const decision = await adapter.step({ sessionId, tabId: id, goal, observation, previousExecution, maxSteps, generation: 1 });
        const focusKey = focusContextKey(goal, observation); let plan;
        if (focusCache?.key === focusKey) { plan = reconcileFocusPlan(focusCache.plan, focusCache.elements, observation); result.focus_cache_hits++; }
        else { await adapter.pace(); plan = await planFocus({ ai: adapter.ai, model: adapter.model, goal, observation }); result.focus_planner_calls++;
          focusCache = { key: focusKey, plan, elements: plannerObservation(observation) }; }
        await page.evaluate(value => { globalThis.__GuideModeTest.setVisualMode(true); globalThis.__GuideModeTest.applyVisualPlan(value); }, { ...plan, current_ref: decision.action?.ref || null });
        const step = { step: decision.step, role: decision.model_role, action: decision.action || null, status: decision.status,
          focus_elements: plan.elements.length, latency_ms: decision.latency_ms + (plan.cache_hit ? 0 : plan.latency_ms), observation_ms: observation.timings?.observation_ms || 0 };
        if (decision.status !== 'action') { result.status = decision.status; result.steps.push(step); break; }
        const before = observation.progress_signature; const execution = await execute(page, { ...decision.action, observation_id: observation.observation_id }); const after = await observe(page);
        previousExecution = { ...execution, previous_progress_signature: before, new_progress_signature: after.progress_signature,
          semantic_progress: before !== after.progress_signature };
        step.action_success = execution.action_success; step.semantic_progress = previousExecution.semantic_progress; step.paused = execution.paused || false;
        result.steps.push(step);
        if (execution.paused) { result.status = 'needs_human'; break; }
      }
      result.final_url = page.url(); result.agent_trajectory = adapter.sessions.get(sessionId)?.trajectory;
      return result;
    } finally { await page.close(); }
  }
  try {
    const threadlyUrl = pathToFileURL(path.join(__dirname, '..', '..', 'index.html')).href;
    report.tests.push(await run({ id: 'threadly-constrained', goal: "Find me a men's blue shirt in size small under $70.", url: threadlyUrl, maxSteps: 10,
      terminal: async page => (await page.evaluate(() => document.querySelector('input[value="Men"]')?.checked && document.querySelector('input[value="Shirts"]')?.checked &&
        document.querySelector('input[value="S"]')?.checked && document.querySelector('input[value="Blue"]')?.checked && document.querySelector('#priceRange')?.value === '70')) ? 'completed' : null }));
    report.tests.push(await run({ id: 'threadly-impossible', goal: 'Find a purple XXL shirt under $5.', url: threadlyUrl, maxSteps: 15,
      terminal: async () => null }));
    const civicUrl = pathToFileURL(path.join(__dirname, '..', '..', 'civic-portal', 'index.html')).href;
    report.tests.push(await run({ id: 'civic-lost-replacement', goal: 'Help me replace a lost driving licence.', url: civicUrl, maxSteps: 8,
      terminal: async page => (await page.evaluate(() => location.hash === '#licence-replacement' || location.hash === '#replacement-form')) ? 'service_found' : null }));
  } finally {
    report.finished_at = new Date().toISOString(); const directory = path.join(__dirname, '..', '..', 'guidemode-extension-server', 'trajectories'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `live-agent-extension-${report.started_at.replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.tests.map(test => ({ id: test.id, status: test.status, steps: test.steps.length, final_url: test.final_url })), null, 2));
    console.log(`Live integration artifact: ${file}`); await browser.close();
  }
  assert.equal(report.tests[0].status, 'completed'); assert.equal(report.tests[1].status, 'impossible'); assert.equal(report.tests[2].status, 'service_found');
})().catch(error => { console.error(error); process.exitCode = 1; });
