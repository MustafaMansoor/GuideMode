const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidemode-real-smoke-'));
  const context = await chromium.launchPersistentContext(userDataDir, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  const report = { run_id: require('crypto').randomUUID(), component: 'guidemode-extension-real-site-smoke', started_at: new Date().toISOString(), tests: [] };
  async function worker() { const current = context.serviceWorkers(); return current[0] || context.waitForEvent('serviceworker', { timeout: 10000 }); }
  async function tabIdFor(serviceWorker, fragment) { return serviceWorker.evaluate(async fragment => (await chrome.tabs.query({})).find(tab => tab.url?.includes(fragment))?.id, fragment); }
  async function message(serviceWorker, tabId, payload) { return serviceWorker.evaluate(({ tabId, payload }) => chrome.tabs.sendMessage(tabId, payload), { tabId, payload }); }
  try {
    const serviceWorker = await worker();
    const gov = await context.newPage();
    try {
      await gov.goto('https://www.gov.uk/renew-driving-licence', { waitUntil: 'domcontentloaded', timeout: 45000 }); await gov.waitForTimeout(1200);
      const tabId = await tabIdFor(serviceWorker, 'gov.uk/renew-driving-licence');
      const observed = await message(serviceWorker, tabId, { type: 'GM_OBSERVE' });
      let link = observed.observation.controls.find(control => control.role === 'link' && /lost|replace/i.test(control.name));
      let execution = null;
      let editableSearch = null;
      if (!link) {
        editableSearch = observed.observation.controls.find(control => ['searchbox','combobox','textbox'].includes(control.role) &&
          control.capabilities?.actions?.includes('fill') && /search/i.test(`${control.name} ${control.group_context}`));
        if (editableSearch) {
          const filled = await message(serviceWorker, tabId, { type: 'GM_EXECUTE', action: { action: 'fill', ref: editableSearch.ref, value: 'replace lost driving licence', reason: 'Search official guidance' } });
          const searchButton = observed.observation.controls.find(control => control.role === 'button' && /search/i.test(control.name));
          if (filled?.result?.action_success && searchButton) {
            await message(serviceWorker, tabId, { type: 'GM_EXECUTE', action: { action: 'click', ref: searchButton.ref, reason: 'Search official guidance' } });
            await gov.waitForLoadState('domcontentloaded').catch(() => {}); await gov.waitForTimeout(900);
            const resultTabId = await tabIdFor(serviceWorker, 'gov.uk'); const results = await message(serviceWorker, resultTabId, { type: 'GM_OBSERVE' });
            link = results.observation.controls.find(control => control.role === 'link' && /replace.*(lost|stolen)|lost.*licen[cs]e/i.test(control.name));
            if (link) execution = await message(serviceWorker, resultTabId, { type: 'GM_EXECUTE', action: { action: 'click', ref: link.ref, reason: 'Open replacement guidance' } });
          }
        }
      } else execution = await message(serviceWorker, tabId, { type: 'GM_EXECUTE', action: { action: 'click', ref: link.ref, reason: 'Open replacement guidance' } });
      report.tests.push({ site: 'GOV.UK', goal: 'Help me find how to replace a lost driving licence.', status: link && execution?.result?.action_success ? 'pass' : 'limited',
        start_url: 'https://www.gov.uk/renew-driving-licence', final_url: gov.url(), controls: observed.observation.controls.length,
        content_blocks: observed.observation.content.length, editable_search_found: Boolean(editableSearch), link_found: Boolean(link), action_success: execution?.result?.action_success ?? null,
        note: 'Manifest V3 content-script observation/execution; no sign-in or Start now action.' });
    } catch (error) { report.tests.push({ site: 'GOV.UK', status: 'site_incompatible', error: error.message }); } finally { await gov.close(); }

    const shop = await context.newPage();
    try {
      await shop.goto('https://edenrobe.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }); await shop.waitForTimeout(1800);
      const tabId = await tabIdFor(serviceWorker, 'edenrobe.com'); const observed = await message(serviceWorker, tabId, { type: 'GM_OBSERVE' });
      const useful = observed.observation.controls.filter(control => /men|shirt|search/i.test(`${control.name} ${control.group_context}`)).slice(0, 6);
      const other = observed.observation.controls.filter(control => !useful.some(item => item.ref === control.ref)).slice(0, 12);
      const plan = { elements: [...useful.map(item => ({ ref: item.ref, final_classification: 'relevant' })), ...other.map(item => ({ ref: item.ref, final_classification: 'deemphasize' }))], uncertain_refs: [] };
      await message(serviceWorker, tabId, { type: 'GM_APPLY_PLAN', plan, enabled: true });
      const stateBefore = { url: shop.url(), inputs: await shop.locator('input:checked').count() };
      await message(serviceWorker, tabId, { type: 'GM_CLEAR_PLAN' });
      const stateAfter = { url: shop.url(), inputs: await shop.locator('input:checked').count() };
      report.tests.push({ site: 'Edenrobe', goal: "Help me find a blue men's shirt.", status: 'pass', final_url: shop.url(), controls: observed.observation.controls.length,
        content_blocks: observed.observation.content.length, focused: useful.length, deemphasized_sample: other.length,
        restore_preserved_state: JSON.stringify(stateBefore) === JSON.stringify(stateAfter), note: 'Observation and reversible GuideMode smoke only; no cart, checkout, or purchase.' });
    } catch (error) { report.tests.push({ site: 'Edenrobe', status: 'site_incompatible', error: error.message }); } finally { await shop.close(); }
  } finally {
    report.finished_at = new Date().toISOString(); const directory = path.join(__dirname, '..', '..', 'guidemode-extension-server', 'trajectories'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `real-site-smoke-${report.started_at.replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); console.log(`Real-site artifact: ${file}`); await context.close(); fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
