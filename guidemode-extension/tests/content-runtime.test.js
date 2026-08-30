const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  try {
    await page.setContent(`<!doctype html><main><h1>Services</h1><p>Renewal costs £14 online.</p>
      <fieldset><legend>Size</legend><input id="small" type="checkbox" hidden><label for="small">Small</label></fieldset>
      <label for="search">Search</label><input id="search" role="combobox" aria-autocomplete="list" type="search">
      <select id="route" aria-label="Route"><option value="renew">Renew</option><option value="replace">Replace</option></select>
      <button id="continue">Continue</button><button id="submit">Submit application</button><div role="alert">Bring proof of identity.</div></main>`);
    await page.evaluate(() => { globalThis.chrome = { runtime: { onMessage: { addListener() {} } } }; });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'content.js') });
    const observation = await page.evaluate(() => globalThis.__GuideModeTest.observe());
    assert.equal(observation.page.heading, 'Services');
    assert(observation.content.some(item => item.type === 'fee_or_price' && item.text.includes('£14')));
    assert(observation.content.some(item => item.type === 'alert'));
    const small = observation.controls.find(item => item.name === 'Small');
    const search = observation.controls.find(item => item.name === 'Search');
    const select = observation.controls.find(item => item.name === 'Route');
    assert(small && small.capabilities.actions.includes('check'));
    assert(search.capabilities.editable_combobox && search.capabilities.actions.includes('fill'));
    assert(select.capabilities.actions.includes('select') && !select.capabilities.actions.includes('fill'));
    const checked = await page.evaluate(ref => globalThis.__GuideModeTest.execute({ action: 'check', ref }), small.ref);
    assert.equal(checked.action_success, true); assert.equal(checked.executor_strategy, 'associated-label-activation');
    const filled = await page.evaluate(ref => globalThis.__GuideModeTest.execute({ action: 'fill', ref, value: 'lost licence' }), search.ref);
    assert.equal(filled.action_success, true);
    const submit = observation.controls.find(item => item.name === 'Submit application');
    const paused = await page.evaluate(ref => globalThis.__GuideModeTest.execute({ action: 'click', ref }), submit.ref);
    assert.equal(paused.paused, true); assert.equal(paused.pause_reason, 'consequential');
    await page.evaluate(() => globalThis.__GuideModeTest.setVisualMode(true));
    await page.evaluate(plan => globalThis.__GuideModeTest.applyVisualPlan(plan), { elements: [
      { ref: search.ref, final_classification: 'relevant' }, { ref: submit.ref, final_classification: 'consequential' },
      { ref: observation.controls.find(item => item.name === 'Continue').ref, final_classification: 'deemphasize' }
    ], uncertain_refs: [] });
    assert.equal(await page.locator('#search').getAttribute('data-guidemode'), 'relevant');
    const stateBefore = await page.locator('#small').isChecked();
    await page.evaluate(() => globalThis.__GuideModeTest.setVisualMode(false));
    assert.equal(await page.locator('[data-guidemode]').count(), 0); assert.equal(await page.locator('#small').isChecked(), stateBefore);
    await page.evaluate(() => globalThis.__GuideModeTest.setVisualMode(true));
    assert.equal(await page.locator('#search').getAttribute('data-guidemode'), 'relevant'); assert.equal(await page.locator('#small').isChecked(), stateBefore);
    console.log('GuideMode content observer/executor/visual checks PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
