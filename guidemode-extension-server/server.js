require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ExtensionV2Adapter } = require('./v2-adapter');
const { planFocus, plannerObservation, focusContextKey, reconcileFocusPlan } = require('./focus-adapter');

const PORT = Number(process.env.GUIDEMODE_SERVER_PORT || 4317);
const HOST = '127.0.0.1';
const trajectoriesDir = path.join(__dirname, 'trajectories');
fs.mkdirSync(trajectoriesDir, { recursive: true });
let adapter;
const focusCache = new Map();

function json(response, status, value, origin = 'null') {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
  response.end(JSON.stringify(value));
}
function readBody(request) {
  return new Promise((resolve, reject) => { let data = ''; request.on('data', chunk => { data += chunk; if (data.length > 2_000_000) request.destroy(); });
    request.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } }); request.on('error', reject); });
}
function saveTrajectory(state) {
  if (!state) return null;
  const safeId = state.sessionId.replace(/[^a-z0-9-]/gi, '');
  state.trajectory.finished_at ||= new Date().toISOString();
  const file = path.join(trajectoriesDir, `extension-${safeId}.json`);
  fs.writeFileSync(file, JSON.stringify(state.trajectory, null, 2)); return file;
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || 'null';
  const allowedOrigin = origin === 'null' || origin.startsWith('chrome-extension://') ? origin : null;
  if (!allowedOrigin) return json(response, 403, { error: 'Only the local GuideMode extension may call this server' }, 'null');
  if (request.method === 'OPTIONS') return json(response, 204, {}, allowedOrigin);
  try {
    if (request.method === 'GET' && request.url === '/api/health') return json(response, 200, { ok: true, service: 'guidemode-extension-server', model: adapter.model }, allowedOrigin);
    if (request.method === 'POST' && request.url === '/api/session/step') {
      const body = await readBody(request);
      const transportStarted = Date.now();
      const result = await adapter.step(body);
      const state = adapter.sessions.get(body.sessionId);
      result.timings ||= {}; result.timings.server_processing_ms = Date.now() - transportStarted;
      if (body.observation && ['action','needs_human'].includes(result.status)) {
        try {
          const key = focusContextKey(body.goal, body.observation); const cached = focusCache.get(body.sessionId);
          if (cached?.key === key) { result.focus_plan = reconcileFocusPlan(cached.plan, cached.elements, body.observation); result.timings.focus_planner_gemini_ms = 0; result.focus_cache_hit = true; }
          else { await adapter.pace(); const focusStarted = Date.now(); result.focus_plan = await planFocus({ ai: adapter.ai, model: adapter.model, goal: body.goal, observation: body.observation });
            result.timings.focus_planner_gemini_ms = Date.now() - focusStarted; focusCache.set(body.sessionId, { key, plan: result.focus_plan, elements: plannerObservation(body.observation) }); }
        }
        catch (error) { result.focus_plan_error = error.message; }
      }
      if (['impossible','completed'].includes(result.status)) adapter.markTerminal(body.sessionId, result.status, body.generation);
      if (['impossible','completed','step_limit','needs_human'].includes(result.status)) saveTrajectory(state);
      return json(response, 200, result, allowedOrigin);
    }
    if (request.method === 'POST' && request.url === '/api/session/stop') {
      const body = await readBody(request); const state = adapter.stop(body.sessionId, body.generation); focusCache.delete(body.sessionId); const file = saveTrajectory(state);
      return json(response, 200, { ok: true, trajectory: file ? path.relative(process.cwd(), file) : null }, allowedOrigin);
    }
    return json(response, 404, { error: 'Not found' }, allowedOrigin);
  } catch (error) { console.error(error); return json(response, 500, { error: error.message }, allowedOrigin); }
});

if (!process.env.GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY. Copy .env.example to .env and set the key.'); process.exit(1); }
adapter = new ExtensionV2Adapter({ apiKey: process.env.GEMINI_API_KEY });
server.listen(PORT, HOST, () => console.log(`GuideMode agent server listening at http://${HOST}:${PORT}`));

function shutdown() { for (const state of adapter.sessions.values()) saveTrajectory(state); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
