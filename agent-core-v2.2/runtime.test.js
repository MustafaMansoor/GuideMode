const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { observePage } = require('./observer');
const { executeResilient } = require('./executor');
const { validateAction } = require('./executor');
const { ProgressTracker } = require('./progress');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<main><label for="search">Search services</label><input id="search" role="combobox" aria-autocomplete="list">
      <label for="choice">Choice</label><select id="choice"><option value="a">A</option><option value="b">B</option></select>
      <label for="plain">Plain</label><input id="plain" type="text"></main>`);
    let compatibility = await observePage(page);
    const editable = compatibility.controls.find(control=>control.id==='search');
    const selectOnly = compatibility.controls.find(control=>control.id==='choice');
    const plain = compatibility.controls.find(control=>control.id==='plain');
    assert.equal(editable.capabilities.editable,true);
    assert(editable.capabilities.actions.includes('fill'));
    assert(!editable.capabilities.actions.includes('select'));
    assert.equal(selectOnly.capabilities.select_only,true);
    assert(selectOnly.capabilities.actions.includes('select'));
    assert(!selectOnly.capabilities.actions.includes('fill'));
    assert.equal(plain.role,'textbox');
    assert.deepEqual(plain.capabilities.actions,['fill']);
    validateAction({action:'fill',ref:editable.ref,value:'licence'},compatibility.controls);
    validateAction({action:'select',ref:selectOnly.ref,value:'b'},compatibility.controls);

    await page.setContent(`<section aria-label="Actions"><button id="desktop">Filter</button><button id="mobile" style="position:absolute;top:2000px">Filter</button></section>`);
    let ranked=await observePage(page);assert.equal(ranked.controls.length,1);assert.equal(ranked.controls[0].id,'desktop');assert.equal(ranked.duplicate_log[0].decision,'preferred');
    await page.setContent(`<section aria-label="Actions"><button id="enabled">Continue</button><button id="disabled" disabled>Continue</button></section>`);
    ranked=await observePage(page);assert.equal(ranked.controls.length,1);assert.equal(ranked.controls[0].id,'enabled');
    await page.setContent(`<section aria-label="Actions"><button id="shown">Apply</button><div hidden><button id="hidden">Apply</button></div></section>`);
    ranked=await observePage(page);assert.equal(ranked.controls.length,1);assert.equal(ranked.controls[0].id,'shown');
    await page.setContent(`<section aria-label="Actions"><button id="left">Save</button><button id="right">Save</button></section>`);
    ranked=await observePage(page);assert.equal(ranked.controls.length,2);assert.equal(ranked.duplicate_log[0].decision,'ambiguous');assert.equal(ranked.duplicate_log[0].preferred_ref,null);
    await page.setContent(`<section aria-label="Actions"><button id="first">Filter</button><button id="second" style="position:absolute;top:2000px">Filter</button></section>`);
    ranked=await observePage(page);assert.equal(ranked.controls[0].id,'first');await page.evaluate(()=>{first.style.position='absolute';first.style.top='2000px';second.style.position='static';second.style.top='';});ranked=await observePage(page);assert.equal(ranked.controls[0].id,'second');
    await page.setContent(`<main><button id="unique">Unique action</button></main>`);ranked=await observePage(page);assert.equal(ranked.controls.length,1);assert.equal(ranked.duplicate_log.length,0);

    await page.setContent(`<div><h1>Renewal service</h1><p>Bring proof of identity.</p><p class="fee">The fee is £14.</p>
      <div role="status">Applications are available.</div><div role="alert">Check eligibility before continuing.</div>
      ${Array.from({length:20},(_,i)=>`<article><h2>Service ${i}</h2><p>Summary ${i}</p></article>`).join('')}
      <footer><p>Privacy and copyright boilerplate</p></footer></div>`);
    const contentObservation=await observePage(page);
    assert(contentObservation.content.some(block=>block.type==='heading'&&block.text==='Renewal service'));
    assert(contentObservation.content.some(block=>block.type==='fee_or_price'&&/£14/.test(block.text)));
    assert(contentObservation.content.some(block=>block.type==='status'));
    assert(contentObservation.content.some(block=>block.type==='alert'));
    const resultSummary=contentObservation.content.find(block=>block.type==='result_summary');
    assert.equal(resultSummary.count_observed,20);assert(resultSummary.samples.length<=6);
    assert(!contentObservation.content.some(block=>/Privacy and copyright/.test(block.text||'')));

    await page.setContent(`
      <main><h1>Eligibility</h1><p>Online service is available within six months.</p>
      <div role="alert">Review the warning.</div><fieldset><legend>What happened?</legend>
      <label for="lost">Lost</label><input id="lost" type="radio" name="reason" value="lost"></fieldset></main>`);
    const first = await observePage(page);
    assert(first.content.some(block => block.type === 'heading' && block.text === 'Eligibility'));
    assert(first.content.some(block => block.type === 'alert' && block.text === 'Review the warning.'));
    const lost = first.controls.find(control => control.id === 'lost');
    assert(lost && lost.role === 'radio');

    await page.locator('#lost').evaluate(element => element.addEventListener('change', () => {
      const replacement = element.cloneNode(true);
      replacement.checked = true;
      element.replaceWith(replacement);
    }));
    const outcome = await executeResilient(page, { action: 'check', ref: lost.ref }, first);
    assert.equal(outcome.action_success, true);
    assert.equal(outcome.post_action_observation.controls.find(control => control.id === 'lost').checked, true);

    const tracker = new ProgressTracker({ cycleThreshold: 2 });
    tracker.seed('A');
    tracker.record({ actionIdentity: 'click|disclosure', previousSignature: 'A', newSignature: 'B', actionSuccess: true });
    const cycle = tracker.record({ actionIdentity: 'click|disclosure', previousSignature: 'B', newSignature: 'A', actionSuccess: true });
    assert.equal(cycle.cycleDetected, true);
    assert.equal(cycle.semanticProgress, false);
    console.log('Agent Core v2 deterministic runtime checks PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
