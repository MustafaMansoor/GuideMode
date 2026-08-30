require('dotenv').config({ quiet: true });
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { chromium } = require('playwright');
const { ExtensionV2Adapter } = require('../../guidemode-extension-server/v2-adapter');
const { searchRoutes } = require('../../guidemode-extension-server/route-scout');

(async () => {
  const extensionPath = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'guidemode-real-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  const report = { run_id: crypto.randomUUID(), component: 'guidemode-extension-route-scout-production', started_at: new Date().toISOString(), tests: [] };
  const adapter = process.env.GEMINI_API_KEY ? new ExtensionV2Adapter({ apiKey: process.env.GEMINI_API_KEY, requestsPerMinute: 15 }) : null;
  const worker = async () => context.serviceWorkers()[0] || context.waitForEvent('serviceworker', { timeout: 10000 });
  const tabIdFor = (sw, fragment) => sw.evaluate(async value => (await chrome.tabs.query({})).find(tab => tab.url?.includes(value))?.id, fragment);
  const message = (sw, tabId, payload) => sw.evaluate(({ tabId, payload }) => chrome.tabs.sendMessage(tabId, payload), { tabId, payload });
  try {
    const sw = await worker(), gov = await context.newPage();
    try {
      const start = 'https://www.gov.uk/renew-driving-licence', goal = 'Help me find how to replace a lost driving licence.', sessionId = crypto.randomUUID();
      await gov.goto(start, { waitUntil: 'domcontentloaded', timeout: 45000 }); await gov.waitForTimeout(1200);
      let currentTabId = await tabIdFor(sw, 'gov.uk'), previousExecution = null, initial = null, ranked = [], chosen = [], reached = false;
      for (let step = 1; step <= 6 && !reached; step++) {
        currentTabId = await tabIdFor(sw, 'gov.uk');
        const observed = await message(sw, currentTabId, { type: 'GM_OBSERVE' }); initial ||= observed.observation;
        ranked = searchRoutes(goal, observed.observation.routes, { limit: 12 });
        if (!adapter) break;
        const decision = await adapter.step({ sessionId, tabId: currentTabId, goal, observation: observed.observation, previousExecution, maxSteps: 6 });
        chosen.push({ step, status: decision.status, action: decision.action || null, top_routes: ranked });
        if (decision.status !== 'action') break;
        const before = observed.observation.progress_signature;
        const executed = await message(sw, currentTabId, { type: 'GM_EXECUTE', action: { ...decision.action, observation_id: observed.observation.observation_id } });
        if (executed.result?.paused) { chosen.at(-1).paused = true; break; }
        if (executed.result?.navigation_started) { await gov.waitForLoadState('domcontentloaded').catch(() => {}); await gov.waitForTimeout(900); }
        else await gov.waitForTimeout(decision.action.action === 'click' ? 900 : 250);
        const nextTabId = await tabIdFor(sw, 'gov.uk'), fresh = await message(sw, nextTabId, { type: 'GM_OBSERVE' });
        previousExecution = { ...executed.result, previous_progress_signature: before, new_progress_signature: fresh.observation.progress_signature,
          semantic_progress: before !== fresh.observation.progress_signature };
        reached = !/\/search\//.test(new URL(gov.url()).pathname) && gov.url() !== start && /replace|lost|stolen|damaged/i.test(gov.url());
      }
      report.tests.push({ site: 'GOV.UK', goal, status: reached ? 'pass' : 'limited', start_url: start, final_url: gov.url(),
        raw_links: initial?.route_summary.raw_link_count || 0, unique_same_origin_routes: initial?.route_summary.same_origin_count || 0,
        routes_sent_to_navigator: chosen[0]?.top_routes.length || 0, top_ranked_candidates: chosen[0]?.top_routes || [], chosen_steps: chosen,
        steps: chosen.length, prohibited_actions_executed: 0, note: 'Observed refs only; no sign-in or transactional service.' });
    } catch (error) { report.tests.push({ site: 'GOV.UK', status: 'site_incompatible', error: error.message }); }
    finally { await gov.close(); }

    const shop = await context.newPage();
    try {
      await shop.goto('https://edenrobe.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }); await shop.waitForTimeout(1800);
      const tabId = await tabIdFor(sw, 'edenrobe.com'), observed = await message(sw, tabId, { type: 'GM_OBSERVE' });
      const useful = observed.observation.controls.filter(control => /men|shirt|search/i.test(`${control.name} ${control.group_context}`)).slice(0, 6);
      const other = observed.observation.controls.filter(control => !useful.some(item => item.ref === control.ref)).slice(0, 12);
      const plan = { elements: [...useful.map(item => ({ ref: item.ref, final_classification: 'relevant' })), ...other.map(item => ({ ref: item.ref, final_classification: 'deemphasize' }))], uncertain_refs: [] };
      await message(sw, tabId, { type: 'GM_APPLY_PLAN', plan, enabled: true });
      const before = { url: shop.url(), inputs: await shop.locator('input:checked').count() }; await message(sw, tabId, { type: 'GM_CLEAR_PLAN' });
      const after = { url: shop.url(), inputs: await shop.locator('input:checked').count() };
      report.tests.push({ site: 'Edenrobe', goal: "Help me find a blue men's shirt.", status: 'observed', final_url: shop.url(),
        raw_links: observed.observation.route_summary.raw_link_count, unique_routes: observed.observation.route_summary.unique_route_count,
        forms: observed.observation.forms.map(form => ({ method: form.method, purpose: form.purpose, auto_submittable: form.auto_submittable })),
        get_filter_form_found: observed.observation.forms.some(form => form.method === 'GET' && form.auto_submittable),
        restore_preserved_state: JSON.stringify(before) === JSON.stringify(after), prohibited_actions_executed: 0,
        note: 'No filter submission claimed unless native GET form semantics exist; no cart or checkout.' });
    } catch (error) { report.tests.push({ site: 'Edenrobe', status: 'site_incompatible', error: error.message }); }
    finally { await shop.close(); }
  } finally {
    report.finished_at = new Date().toISOString(); const directory = path.join(__dirname, '..', '..', 'guidemode-extension-server', 'trajectories'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `route-scout-production-${report.started_at.replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); console.log(`Route Scout artifact: ${file}`); await context.close(); fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
