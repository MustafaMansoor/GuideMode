const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { observePage, compactObservation } = require('./observer');
const { validateAction, validateFinish, executeResilient } = require('./executor');

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
