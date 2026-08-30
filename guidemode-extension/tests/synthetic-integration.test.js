const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const extensionScript = path.join(__dirname, '..', 'content.js');
async function install(page) {
  await page.evaluate(() => { globalThis.chrome = { runtime: { onMessage: { addListener() {} } } }; });
  await page.addScriptTag({ path: extensionScript });
}
async function observe(page) { return page.evaluate(() => globalThis.__GuideModeTest.observe()); }
async function act(page, action) { return page.evaluate(value => globalThis.__GuideModeTest.execute(value), action); }

(async () => {
  const report = { test_run_id: require('crypto').randomUUID(), component: 'guidemode-extension', started_at: new Date().toISOString(), tests: [] };
  const browser = await chromium.launch({ headless: true });
  try {
    const threadly = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await threadly.goto(pathToFileURL(path.join(__dirname, '..', '..', 'index.html')).href); await install(threadly);
    for (const requirement of [{ group: 'Department', value: 'Men' }, { group: 'Category', value: 'Shirts' }, { group: 'Size', value: 'S' }, { group: 'Color', value: 'Blue' }]) {
      const observation = await observe(threadly);
      const control = observation.controls.find(item => item.group_context === requirement.group && item.value === requirement.value);
      assert(control, `Missing ${requirement.group}=${requirement.value}`);
      const result = await act(threadly, { action: 'check', ref: control.ref });
      assert.equal(result.action_success, true); assert(['native-dom', 'associated-label-activation'].includes(result.executor_strategy));
    }
    let observation = await observe(threadly);
    const slider = observation.controls.find(item => item.role === 'slider'); assert(slider);
    assert.equal((await act(threadly, { action: 'fill', ref: slider.ref, value: '70' })).action_success, true);
    observation = await observe(threadly);
    const relevant = observation.controls.filter(item => item.checked || item.role === 'slider').map(item => ({ ref: item.ref, final_classification: 'relevant' }));
    const unrelated = observation.controls.find(item => item.name === 'Open shopping bag');
    await threadly.evaluate(plan => { globalThis.__GuideModeTest.setVisualMode(true); globalThis.__GuideModeTest.applyVisualPlan(plan); },
      { elements: [...relevant, { ref: unrelated.ref, final_classification: 'deemphasize' }], uncertain_refs: [] });
    assert.equal(await threadly.locator('#priceRange').getAttribute('data-guidemode'), 'relevant');
    const filterState = await threadly.evaluate(() => ({ men: document.querySelector('input[value="Men"]').checked, price: document.querySelector('#priceRange').value }));
    await threadly.evaluate(() => globalThis.__GuideModeTest.setVisualMode(false));
    assert.deepEqual(await threadly.evaluate(() => ({ men: document.querySelector('input[value="Men"]').checked, price: document.querySelector('#priceRange').value })), filterState);
    await threadly.evaluate(() => globalThis.__GuideModeTest.setVisualMode(true));
    assert.equal(await threadly.locator('#priceRange').getAttribute('data-guidemode'), 'relevant');
    report.tests.push({ id: 'threadly-constrained', goal: "Find me a men's blue shirt in size small under $70.", status: 'pass',
      checks: ['semantic observation','multi-step bounded actions','hidden-control compatibility','visual apply','original restore','state preservation'] });

    const civic = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await civic.goto(pathToFileURL(path.join(__dirname, '..', '..', 'civic-portal', 'index.html')).href); await install(civic);
    observation = await observe(civic);
    let replacement = observation.controls.find(item => item.role === 'link' && item.name.includes('Replace a lost driving licence'));
    assert(replacement); assert.equal((await act(civic, { action: 'click', ref: replacement.ref })).action_success, true);
    await civic.waitForTimeout(100); observation = await observe(civic);
    const start = observation.controls.find(item => item.name === 'Start replacement request'); assert(start);
    assert.equal((await act(civic, { action: 'click', ref: start.ref })).action_success, true);
    await civic.waitForTimeout(100); observation = await observe(civic);
    const lost = observation.controls.find(item => item.role === 'radio' && item.value === 'Lost'); assert(lost);
    const radioResult = await act(civic, { action: 'check', ref: lost.ref }); assert.equal(radioResult.action_success, true);
    observation = await observe(civic);
    const licence = observation.controls.find(item => /driving licence number/i.test(item.name)); assert(licence);
    const sensitivePause = await act(civic, { action: 'fill', ref: licence.ref, value: 'PRIVATE' });
    assert.equal(sensitivePause.paused, true); assert.equal(sensitivePause.pause_reason, 'sensitive');
    assert.equal(await civic.evaluate(() => window.civicPortalState?.consequentialActionExecuted), false);
    report.tests.push({ id: 'civic-lost-replacement', goal: 'Help me replace a lost driving licence.', status: 'pass',
      checks: ['service discovery','SPA navigation','rerendered radio','fresh observation','sensitive-field pause','no consequential execution'] });
    report.finished_at = new Date().toISOString();
    const directory = path.join(__dirname, '..', '..', 'guidemode-extension-server', 'trajectories'); fs.mkdirSync(directory, { recursive: true });
    const artifact = path.join(directory, `synthetic-extension-${report.started_at.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(artifact, JSON.stringify(report, null, 2)); console.log(`Synthetic trajectory: ${artifact}`);
    console.log('GuideMode Threadly/CivicPortal integration checks PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
