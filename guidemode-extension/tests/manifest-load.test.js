const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidemode-extension-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    let workers = context.serviceWorkers();
    if (!workers.length) workers = [await context.waitForEvent('serviceworker', { timeout: 10000 })];
    const workerUrl = workers[0].url(); assert(workerUrl.startsWith('chrome-extension://'));
    const extensionId = new URL(workerUrl).host;
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    assert.equal(await panel.locator('h1').textContent(), 'GuideMode');
    assert.equal(await panel.locator('#start').textContent(), 'Start');
    console.log(`GuideMode MV3 load check PASS (${extensionId})`);
  } finally { await context.close(); fs.rmSync(userDataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
