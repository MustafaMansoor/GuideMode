const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { observePage } = require('./observer');
const { executeResilient } = require('./executor');
const { ProgressTracker } = require('./progress');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
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
