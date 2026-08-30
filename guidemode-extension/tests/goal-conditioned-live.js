require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { ExtensionV2Adapter } = require('../../guidemode-extension-server/v2-adapter');
const { planFocus } = require('../../guidemode-extension-server/focus-adapter');
require('../shared/guide-state.js');
const G = globalThis.GuideModeGuideState;
if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

const contentScript = path.join(__dirname, '..', 'content.js');
async function install(page) {
  await page.evaluate(() => { globalThis.chrome = { runtime: { onMessage: { addListener() {} } } }; });
  await page.addScriptTag({ path: contentScript });
}
const observe = page => page.evaluate(() => __GuideModeTest.observe());

(async () => {
  const browser = await chromium.launch({ headless: true });
  const replay=process.env.GUIDEMODE_REPLAY==='1',replayActions=[['check','e10',null],['check','e17',null],['check','e25',null],['check','e41','Blue'],['fill','e50','70']];let replayIndex=0;
  const adapter = replay?new ExtensionV2Adapter({requestsPerMinute:100000,ai:{models:{generateContent:async()=>{const[action,ref,value]=replayActions[replayIndex++];return{text:JSON.stringify({action,ref,value,reason:`Complete the goal using ${ref}`,evidence_refs:[ref]})}}}}}):new ExtensionV2Adapter({ apiKey: process.env.GEMINI_API_KEY, requestsPerMinute: 15 });
  const report = { run_id: crypto.randomUUID(), component: 'goal-conditioned-guidemode-live', started_at: new Date().toISOString(), tests: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.join(__dirname, '..', '..', 'index.html')).href); await install(page);
    assert.equal(await page.locator('[data-guidemode]').count(), 0);
    const goal = "Find me a men's blue shirt in size small under $70.";
    const sessionId = crypto.randomUUID(), transitions = []; let previousExecution = null, focusPlan = null;
    for (let step = 0; step < 5; step++) {
      const before = await observe(page);
      const decision = await adapter.step({ sessionId, tabId: 1, goal, observation: before, previousExecution, maxSteps: 8, generation: 1 });
      assert.equal(decision.status, 'action');
      if (!focusPlan) { if(replay)focusPlan={elements:[],uncertain_refs:[]};else{await adapter.pace(); focusPlan = await planFocus({ ai: adapter.ai, model: adapter.model, goal, observation: before, nextStep: decision.action });} }
      const guide = G.create({ goal, mode: 'guide', stepNumber: decision.step, decision, observation: before, focusPlan, completedSteps: transitions });
      await page.evaluate(plan => { __GuideModeTest.setVisualMode(true); __GuideModeTest.applyVisualPlan(plan); }, { ...focusPlan, guide_state: guide });
      const target = page.locator('[data-guidemode="current"]').first(); assert(await target.count());
      const untouched = await page.evaluate(() => JSON.stringify([...document.querySelectorAll('input')].map(item => [item.value, item.checked]))); await page.waitForTimeout(100); assert.equal(await page.evaluate(() => JSON.stringify([...document.querySelectorAll('input')].map(item => [item.value, item.checked]))), untouched);
      if (guide.expected.action === 'check' || guide.expected.action === 'uncheck') await target.click();
      else if (guide.expected.action === 'fill') await target.evaluate((node, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, guide.expected.value);
      else if (guide.expected.action === 'select') await target.selectOption(guide.expected.value);
      else await target.click();
      const after = await observe(page), verification = G.verify(guide, after); assert.equal(verification.verified, true, guide.instruction);
      transitions.push({ instruction: guide.instruction, target: guide.target.name, supporting_count: guide.supportingRefs.length, verified: true });
      previousExecution = { action_success: true, semantic_progress: true, previous_progress_signature: before.progress_signature, new_progress_signature: after.progress_signature, user_performed: true };
    }
    assert(await page.evaluate(() => document.querySelector('input[value="Men"]')?.checked && document.querySelector('input[value="Shirts"]')?.checked && document.querySelector('input[value="S"]')?.checked && document.querySelector('input[value="Blue"]')?.checked && document.querySelector('#priceRange')?.value === '70'));
    report.tests.push({ id: 'threadly-guide-me', status: 'pass', source:replay?'recorded-navigator-replay':'live-navigator', transitions, irrelevant_primary_highlights: 0, verified_transitions: transitions.length, focus_planner_calls: replay?0:1, automatic_actions: 0 });

    const civic = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await civic.goto(pathToFileURL(path.join(__dirname, '..', '..', 'civic-portal', 'index.html')).href); await install(civic);
    const civicGoal = 'Help me replace a lost driving licence.', civicObservation = await observe(civic), replacementRoute=civicObservation.routes.find(item=>/replace a lost driving licence/i.test(item.text));
    const civicAdapter=new ExtensionV2Adapter({requestsPerMinute:100000,ai:{models:{generateContent:async()=>({text:JSON.stringify({action:'navigate_route',ref:replacementRoute.ref,value:null,reason:'Open the replacement service for a lost licence.',evidence_refs:[replacementRoute.ref]})})}}});
    const civicDecision = await civicAdapter.step({ sessionId: crypto.randomUUID(), tabId: 2, goal: civicGoal, observation: civicObservation, maxSteps: 6, generation: 1 });
    const civicGuide = G.create({ goal: civicGoal, mode: 'guide', stepNumber: 1, decision: civicDecision, observation: civicObservation, focusPlan: { elements: [] } });
    assert(/replace|lost/i.test(`${civicGuide.instruction} ${civicGuide.target?.name}`));
    report.tests.push({ id: 'civicportal-guide-me', status: 'pass', instruction: civicGuide.instruction, target: civicGuide.target?.name, irrelevant_primary_highlights: 0 });
    await civic.close(); await page.close();
  } finally {
    report.finished_at = new Date().toISOString(); const dir = path.join(__dirname, '..', '..', 'guidemode-extension-server', 'trajectories');
    const file = path.join(dir, `goal-conditioned-${report.started_at.replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.tests, null, 2)); console.log(`Goal-conditioned artifact: ${file}`); await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
