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
    const checked = await page.evaluate(({ref,observation_id}) => globalThis.__GuideModeTest.execute({ action: 'check', ref, observation_id }), {ref:small.ref,observation_id:observation.observation_id});
    assert.equal(checked.action_success, true); assert.equal(checked.executor_strategy, 'associated-label-activation');
    const filled = await page.evaluate(({ref,observation_id}) => globalThis.__GuideModeTest.execute({ action: 'fill', ref, value: 'lost licence', observation_id }), {ref:search.ref,observation_id:observation.observation_id});
    assert.equal(filled.action_success, true);
    const submit = observation.controls.find(item => item.name === 'Submit application');
    const paused = await page.evaluate(({ref,observation_id}) => globalThis.__GuideModeTest.execute({ action: 'click', ref, observation_id }), {ref:submit.ref,observation_id:observation.observation_id});
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
    await page.evaluate(()=>{const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.innerHTML='<h2>Confirm choice</h2><button id="modalAction">Review details</button>';document.body.append(dialog)});
    const modalObservation=await page.evaluate(()=>globalThis.__GuideModeTest.observe());assert.equal(modalObservation.summary.modal_scoped,true);assert(modalObservation.controls.some(item=>item.name==='Review details'));assert(!modalObservation.controls.some(item=>item.name==='Continue'));
    await page.evaluate(()=>{document.querySelector('[role="dialog"]').remove();const button=document.createElement('button');button.id='covered';button.textContent='Covered action';button.style.cssText='position:fixed;left:20px;top:20px;width:140px;height:40px';document.body.append(button);const cover=document.createElement('div');cover.id='cover';cover.style.cssText='position:fixed;left:20px;top:20px;width:140px;height:40px;z-index:999;background:white';document.body.append(cover)});
    const coveredObservation=await page.evaluate(()=>globalThis.__GuideModeTest.observe());const covered=coveredObservation.controls.find(item=>item.name==='Covered action');const obstruction=await page.evaluate(action=>globalThis.__GuideModeTest.execute(action),{action:'click',ref:covered.ref,observation_id:coveredObservation.observation_id});assert.equal(obstruction.execution_failure_type,'obstructed');
    await page.evaluate(()=>{document.querySelector('#cover').remove();const form=document.createElement('form');form.method='get';form.action='#searched';form.innerHTML='<button type="submit">Run search</button>';document.body.append(form)});const submitterObservation=await page.evaluate(()=>globalThis.__GuideModeTest.observe());const submitter=submitterObservation.controls.find(item=>item.name==='Run search');const submitterResult=await page.evaluate(action=>globalThis.__GuideModeTest.execute(action),{action:'click',ref:submitter.ref,observation_id:submitterObservation.observation_id});assert.equal(submitterResult.executor_strategy,'native-get-form-submitter');
    console.log('GuideMode content observer/executor/visual checks PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
