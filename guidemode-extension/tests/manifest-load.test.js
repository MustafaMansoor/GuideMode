const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const extensionPath = path.resolve(__dirname, '..');
  const repositoryPath = path.resolve(extensionPath, '..');
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const referencedFiles = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...(manifest.content_scripts || []).flatMap(entry => [...(entry.js || []), ...(entry.css || [])])
  ].filter(Boolean);
  assert.equal(manifest.manifest_version, 3);
  for (const relativePath of referencedFiles) {
    assert.equal(path.isAbsolute(relativePath), false, `Manifest path must be relative: ${relativePath}`);
    const resolved = path.resolve(extensionPath, relativePath);
    assert(resolved.startsWith(`${extensionPath}${path.sep}`), `Manifest path escapes extension: ${relativePath}`);
    assert(fs.existsSync(resolved), `Manifest file missing: ${relativePath}`);
    const source = fs.readFileSync(resolved, 'utf8');
    assert(!/C:[\\/]Users[\\/]Mustafa|Desktop[\\/]micro/i.test(source), `Local absolute path in ${relativePath}`);
  }
  assert(fs.existsSync(path.join(repositoryPath, 'guidemode-extension-server', 'server.js')), 'Extension server entrypoint missing');
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
