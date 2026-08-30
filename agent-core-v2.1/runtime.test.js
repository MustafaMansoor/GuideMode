const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { observePage, compactObservation } = require('./observer');
const { validateAction, validateFinish, executeResilient } = require('./executor');
const { validateFinish: validateDeterministicFinish } = require('./finish-validator');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    await page.setContent(`<main>
      <label for="search">Search services</label><input id="search" role="combobox" aria-autocomplete="list">
      <label for="department">Department</label><select id="department"><option value="a">A</option><option value="b">B</option></select>
    </main>`);
    let observation = await observePage(page);
    const editable = observation.controls.find(control => control.id === 'search');
    const selectOnly = observation.controls.find(control => control.id === 'department');
    assert.equal(editable.capabilities.editable, true);
    assert(editable.capabilities.actions.includes('fill'));
    assert(!editable.capabilities.actions.includes('select'));
    assert.equal(selectOnly.capabilities.select_only, true);
    assert(selectOnly.capabilities.actions.includes('select'));
    assert(!selectOnly.capabilities.actions.includes('fill'));
    validateAction({ action: 'fill', ref: editable.ref, value: 'licence' }, observation.controls);
    validateAction({ action: 'select', ref: selectOnly.ref, value: 'b' }, observation.controls);
    assert.throws(() => validateAction({ action: 'fill', ref: selectOnly.ref, value: 'x' }, observation.controls), /incompatible/);

    // A. Visible viewport candidate outranks its offscreen responsive equivalent.
    await page.setContent(`<section aria-label="Actions"><button id="desktop">Filter</button><button id="mobile" style="position:absolute;top:2000px">Filter</button></section>`);
    observation = await observePage(page);
    assert.equal(observation.summary.raw_control_count, 2);
    assert.equal(observation.controls.length, 1);
    assert.equal(observation.duplicate_log.length, 1);
    assert.equal(observation.duplicate_log[0].preferred_ref, observation.controls.find(control => control.id === 'desktop').ref);
    assert.equal(observation.duplicate_log[0].decision, 'preferred');
    assert.equal(observation.duplicate_log[0].candidates.length, 2);
    assert(observation.duplicate_log[0].candidates.every(candidate => Number.isFinite(candidate.score) && candidate.ranking_reasons.length));

    // B. Enabled candidate outranks an otherwise equivalent disabled control.
    await page.setContent(`<section aria-label="Actions"><button id="enabled">Continue</button><button id="disabled" disabled>Continue</button></section>`);
    observation = await observePage(page);
    assert.equal(observation.controls.length, 1);
    assert.equal(observation.controls[0].id, 'enabled');
    assert.equal(observation.duplicate_log[0].preferred_ref, observation.controls[0].ref);

    // C. Rendered candidate outranks an equivalent control in a hidden ancestor.
    await page.setContent(`<section aria-label="Actions"><button id="shown">Apply</button><div hidden><button id="hidden">Apply</button></div></section>`);
    observation = await observePage(page);
    assert.equal(observation.controls.length, 1);
    assert.equal(observation.controls[0].id, 'shown');
    assert.equal(observation.duplicate_log[0].candidates.find(candidate => candidate.ref !== observation.controls[0].ref).visible, false);

    // D. Two equally usable visible candidates remain genuinely ambiguous.
    await page.setContent(`<section aria-label="Actions"><button id="left">Save</button><button id="right">Save</button></section>`);
    observation = await observePage(page);
    assert.equal(observation.controls.length, 2);
    assert.equal(observation.duplicate_log[0].preferred_ref, null);
    assert.equal(observation.duplicate_log[0].decision, 'ambiguous');

    // E. Ranking is recomputed from fresh geometry after a rerender/state swap.
    await page.setContent(`<section aria-label="Actions"><button id="first">Filter</button><button id="second" style="position:absolute;top:2000px">Filter</button></section>`);
    const beforeSwap = await observePage(page);
    assert.equal(beforeSwap.controls[0].id, 'first');
    await page.evaluate(() => {
      first.style.position = 'absolute'; first.style.top = '2000px';
      second.style.position = 'static'; second.style.top = '';
    });
    const afterSwap = await observePage(page);
    assert.equal(afterSwap.controls.length, 1);
    assert.equal(afterSwap.controls[0].id, 'second');
    assert.equal(afterSwap.duplicate_log[0].preferred_ref, afterSwap.controls[0].ref);

    // F. A unique ordinary control is unchanged and creates no duplicate log.
    await page.setContent(`<main><button id="unique">Unique action</button></main>`);
    observation = await observePage(page);
    assert.equal(observation.controls.length, 1);
    assert.equal(observation.controls[0].id, 'unique');
    assert.equal(observation.duplicate_log.length, 0);

    await page.setContent(`<main><fieldset><legend>Reason</legend><label for="lost">Lost</label><input id="lost" type="radio"></fieldset></main>`);
    observation = await observePage(page);
    const lost = observation.controls.find(control => control.id === 'lost');
    await page.locator('#lost').evaluate(element => element.addEventListener('change', () => {
      const replacement = element.cloneNode(true); replacement.checked = true; element.replaceWith(replacement);
    }));
    let outcome = await executeResilient(page, { action: 'check', ref: lost.ref }, observation);
    assert.equal(outcome.action_success, true);
    assert.equal(outcome.post_action_observation.controls.find(control => control.id === 'lost').checked, true);

    await page.setContent(`<main><label><input id="blue" type="checkbox">Blue</label><article><h2>Red shirt</h2><p>$20</p></article></main>`);
    observation = await observePage(page);
    let blue = observation.controls.find(control => control.id === 'blue');
    outcome = await executeResilient(page, { action: 'check', ref: blue.ref }, observation);
    assert.equal(outcome.action_success, true);
    assert.equal(outcome.result_effect_confirmed, false);

    await page.setContent(`<main><label><input id="blue" type="checkbox">Blue</label><article id="card"><h2>Red shirt</h2><p>$20</p></article></main>
      <script>blue.addEventListener('change',()=>{card.innerHTML='<h2>Blue shirt</h2><p>$20</p>'})</script>`);
    observation = await observePage(page); blue = observation.controls.find(control => control.id === 'blue');
    outcome = await executeResilient(page, { action: 'check', ref: blue.ref }, observation);
    assert.equal(outcome.result_effect_confirmed, true);
    assert(outcome.result_effect_evidence.reasons.includes('visible_result_summary_changed'));

    await page.setContent(`<div><h1>Renewal information</h1><p id="fee">Online renewal costs £14.</p>
      <p>You must be resident and not disqualified.</p><article><h2>Service A</h2><p>£14 standard fee</p></article></div>`);
    observation = await observePage(page);
    assert(observation.content.some(block => block.type === 'heading'));
    assert(observation.content.some(block => /£14/.test(block.text || '')));
    assert(observation.content.some(block => block.type === 'result_summary'));
    const evidence = observation.content.find(block => /Online renewal costs/.test(block.text));
    validateFinish({ action: 'finish', status: 'completed', answer: 'It costs £14.', evidence_refs: [evidence.ref] }, observation.content);
    assert.throws(() => validateFinish({ action: 'finish', status: 'completed', answer: 'It costs £20.', evidence_refs: ['c999'] }, observation.content), /unsupported finish evidence/);

    const finish = (goal, proposedFinish, currentObservation) => validateDeterministicFinish({ goal, proposedFinish,
      currentObservation, currentControls: currentObservation.controls, currentContent: currentObservation.content,
      currentResultState: currentObservation.result_state });
    const selectedControls = [
      { ref:'e1', role:'radio', name:'Women', value:'Women', group_context:'Department', checked:true },
      { ref:'e2', role:'checkbox', name:'Shirts', value:'Shirts', group_context:'Category', checked:true },
      { ref:'e3', role:'checkbox', name:'S', value:'S', group_context:'Size', checked:true },
      { ref:'e4', role:'checkbox', name:'Blue', value:'Blue', group_context:'Color', checked:true },
      { ref:'e5', role:'slider', name:'Up to $60', value:'60', group_context:'Price', capabilities:{ editable:false } }
    ];
    const noResults = { controls:selectedControls, content:[{ref:'c1',type:'heading',text:'No pieces found',context:'Results'}],
      result_state:{result_count:0,control_selected_labels:['Women','Shirts','S','Blue'],visible_result_summary:null} };
    let finishValidation = finish("Women's blue shirt, S, under $60", {action:'finish',status:'completed',answer:'Found one.',evidence_refs:['c1']}, noResults);
    assert.equal(finishValidation.accepted, false); // A: completion contradicts zero results.
    assert(finishValidation.contradictions.length > 0);
    finishValidation = finish("Women's blue shirt, S, under $60", {action:'finish',status:'impossible',reason:'No matches.',evidence_refs:['c1']}, noResults);
    assert.equal(finishValidation.accepted, true); // B: impossible is supported.

    const positive = { controls:selectedControls, content:[{ref:'c2',type:'result_summary',count_observed:1,samples:[{title:'Blue shirt',price:'$50',metadata:'Women S'}]}],
      result_state:{result_count:1,control_selected_labels:['Women','Shirts','S','Blue'],visible_result_summary:{count_observed:1,samples:[{title:'Blue shirt'}]}} };
    finishValidation = finish("Women's blue shirt, S, under $60", {action:'finish',status:'completed',answer:'Found one.',evidence_refs:['c2']}, positive);
    assert.equal(finishValidation.accepted, true); // C: positive matching result and coverage.
    const missing = { ...positive, controls:selectedControls.map(control => control.ref === 'e4' ? {...control,checked:false} : control) };
    finishValidation = finish("Women's blue shirt, S, under $60", {action:'finish',status:'completed',answer:'Found one.',evidence_refs:['c2']}, missing);
    assert.equal(finishValidation.accepted, false); // D: explicit color constraint absent.
    assert(finishValidation.missing_evidence.some(reason => reason.includes('color=Blue')));

    const information = { controls:[], content:[{ref:'c10',type:'fee_or_price',text:'Online renewal costs £14.',context:'Renewal'},
      {ref:'c11',type:'paragraph',text:'Contact the transport office.',context:'Help'}], result_state:{} };
    finishValidation = finish('What does renewal cost?', {action:'finish',status:'completed',answer:'£14.',evidence_refs:['c10']}, information);
    assert.equal(finishValidation.accepted, true); // E: cited fee answers information goal.
    finishValidation = finish('What does renewal cost?', {action:'finish',status:'completed',answer:'Contact the office.',evidence_refs:['c11']}, information);
    assert.equal(finishValidation.accepted, false); // F: cited content is unrelated.
    finishValidation = finish('Find a purple service', {action:'finish',status:'impossible',reason:'None.',evidence_refs:['c11']}, information);
    assert.equal(finishValidation.accepted, false); // G: impossibility lacks support.
    const eligibility = { controls:[], content:[{ref:'c20',type:'alert',text:'You are not eligible for online renewal.',context:'Eligibility'}],
      result_state:{status_text:['You are not eligible for online renewal.']} };
    finishValidation = finish('Renew my licence online', {action:'finish',status:'completed',answer:'Ready.',evidence_refs:['c20']}, eligibility);
    assert.equal(finishValidation.accepted, false); // H: explicit eligibility contradiction.
    assert(finishValidation.contradictions.length > 0);

    await page.setContent(`<main>${Array.from({ length: 100 }, (_, index) => `<a href="#${index}">Unrelated item ${index}</a>`).join('')}
      <label for="required">Required licence number</label><input id="required" required aria-invalid="true"><div role="alert">Licence number is required</div></main>`);
    observation = await observePage(page);
    const compacted = compactObservation(observation, 'Enter the required licence number', { maxControls: 12, maxContent: 8 });
    assert(compacted.controls.length <= 12);
    assert(compacted.controls.some(control => control.id === 'required'));
    assert(compacted.content.some(block => block.type === 'alert'));
    assert(compacted.compaction.estimated_tokens_after < compacted.compaction.estimated_tokens_before);

    console.log('Agent Core v2.1 deterministic production-hardening checks PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
