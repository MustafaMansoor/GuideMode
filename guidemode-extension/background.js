importScripts('shared/constants.js', 'shared/messages.js');

const C = globalThis.GuideModeConstants;
const M = globalThis.GuideModeMessages;
const sessions = new Map();
const locks = new Set();
let lastWebTabId = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const publicSession = session => session ? {
  sessionId: session.sessionId, tabId: session.tabId, goal: session.goal, status: session.status,
  step: session.step, history: session.history, currentAction: session.currentAction,
  semanticProgress: session.semanticProgress, visualMode: session.visualMode, paused: session.paused,
  stopped: session.stopped, createdAt: session.createdAt, debug: session.debug,
  connectionError: session.connectionError || null, lastExecution: session.lastExecution || null,
  currentPlan: session.currentPlan || null, generation: session.generation || 1
} : null;

async function persist(session) {
  await chrome.storage.session.set({ [`session:${session.tabId}`]: publicSession(session) });
}
async function getSession(tabId) {
  if (sessions.has(tabId)) return sessions.get(tabId);
  const stored = await chrome.storage.session.get(`session:${tabId}`);
  const saved = stored[`session:${tabId}`];
  if (!saved) return null;
  const hydrated = { ...saved, abortController: null, generation: saved.generation || 1 };
  sessions.set(tabId, hydrated); return hydrated;
}
function announce(session) {
  persist(session).catch(() => {});
  chrome.runtime.sendMessage({ type: M.STATE_CHANGED, state: publicSession(session) }).catch(() => {});
}
function message(session, text, kind = 'assistant') {
  session.history.push({ kind, text, at: new Date().toISOString() });
  if (session.history.length > 80) session.history.shift();
}
async function server(path, body, signal) {
  const response = await fetch(`${C.SERVER_ORIGIN}${path}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal
  });
  if (!response.ok) throw new Error(`Agent server returned ${response.status}`);
  return response.json();
}
async function sendTab(tabId, payload, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try { return await chrome.tabs.sendMessage(tabId, payload); }
    catch (error) {
      if (attempt === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 + attempt * 250));
    }
  }
}
function isRestricted(url = '') { return !/^https?:\/\//i.test(url); }

async function stopSession(session, reason = 'Stopped') {
  session.stopped = true; session.paused = false; session.status = C.STATUS.STOPPED;
  session.generation++; session.abortController?.abort(); session.abortController = null;
  message(session, reason); announce(session);
  await server('/api/session/stop', { sessionId: session.sessionId }).catch(() => {});
}

async function runLoop(session) {
  if (locks.has(session.tabId) || session.stopped || session.paused) return;
  locks.add(session.tabId);
  const generation = session.generation;
  session.abortController = new AbortController();
  try {
    while (!session.stopped && !session.paused && session.generation === generation && session.step < C.MAX_STEPS) {
      session.status = C.STATUS.RUNNING;
      message(session, session.step ? 'Checking what changed…' : 'Understanding this page…'); announce(session);
      const observationResponse = await sendTab(session.tabId, { type: M.OBSERVE });
      if (!observationResponse?.ok) throw new Error(observationResponse?.error || 'Could not observe this page');
      const observation = observationResponse.observation;
      session.debug.currentUrl = observation.page.url;

      const decision = await server('/api/session/step', {
        sessionId: session.sessionId, tabId: session.tabId, goal: session.goal, observation,
        previousExecution: session.lastExecution || null, maxSteps: C.MAX_STEPS
      }, session.abortController.signal);
      if (session.stopped || session.generation !== generation) break;
      session.step = decision.step ?? session.step;
      session.debug.role = decision.model_role || 'navigator';
      session.debug.latencyMs = decision.latency_ms || 0;
      session.debug.replans = decision.replans || session.debug.replans;

      const plan = decision.focus_plan;
      if (plan) session.currentPlan = { ...plan, current_ref: decision.action?.ref || null };
      if (session.currentPlan && session.visualMode) await sendTab(session.tabId, { type: M.APPLY_PLAN, plan: session.currentPlan, enabled: true }).catch(() => {});

      if (['impossible','completed','step_limit','error'].includes(decision.status)) {
        session.status = decision.status === 'impossible' ? C.STATUS.IMPOSSIBLE : decision.status === 'completed' ? C.STATUS.COMPLETED : C.STATUS.STOPPED;
        session.stopped = true;
        message(session, decision.message || (decision.status === 'impossible' ? "I couldn't find a safe path matching that goal." : 'GuideMode has stopped.'));
        announce(session); break;
      }
      if (decision.status === 'needs_human' || decision.pause) {
        session.paused = true; session.status = C.STATUS.PAUSED; session.currentAction = decision.action || null;
        message(session, decision.message || "You're at a step that needs your review. Please complete it yourself, then press Continue.");
        announce(session); break;
      }
      if (!decision.action) throw new Error('Agent server returned no bounded action');
      session.currentAction = decision.action;
      session.debug.lastAction = decision.action.action;
      session.debug.targetName = decision.target_name || decision.action.reason || decision.action.ref;
      message(session, decision.message || decision.action.reason || 'Working on the next step…'); announce(session);

      const executed = await sendTab(session.tabId, { type: M.EXECUTE, action: { ...decision.action, observation_id: observation.observation_id } });
      if (!executed?.ok) throw new Error(executed?.error || 'Page action failed');
      if (executed.result?.paused) {
        session.paused = true; session.status = C.STATUS.PAUSED; session.lastExecution = executed.result;
        message(session, "You're at a step that needs your review. Please complete it yourself, then press Continue."); announce(session); break;
      }
      const fresh = await sendTab(session.tabId, { type: M.OBSERVE });
      const progress = fresh?.observation?.progress_signature !== observation.progress_signature;
      const previousUrl = new URL(observation.page.url); const nextUrl = new URL(fresh?.observation?.page?.url || observation.page.url);
      session.semanticProgress = progress;
      session.lastExecution = { ...executed.result, previous_progress_signature: observation.progress_signature,
        new_progress_signature: fresh?.observation?.progress_signature || observation.progress_signature, semantic_progress: progress,
        previous_url: previousUrl.href, next_url: nextUrl.href, pathname_changed: previousUrl.pathname !== nextUrl.pathname,
        query_changed: previousUrl.search !== nextUrl.search, heading_changed: observation.page.heading !== fresh?.observation?.page?.heading,
        route_candidate_selected: decision.action.action === 'navigate_route' ? decision.action.ref : null };
      session.debug.actionSuccess = Boolean(executed.result?.action_success);
      session.debug.semanticProgress = progress;
      session.currentAction = null;
      announce(session);
    }
    if (!session.stopped && !session.paused && session.step >= C.MAX_STEPS) {
      session.stopped = true; session.status = C.STATUS.STOPPED;
      message(session, 'I reached the safe step limit. Review the page and start again if you want to continue.'); announce(session);
    }
  } catch (error) {
    if (error.name === 'AbortError' || session.stopped) return;
    session.status = C.STATUS.ERROR; session.connectionError = /fetch|server|Failed/i.test(error.message) ? error.message : null;
    session.paused = true; message(session, session.connectionError ? 'GuideMode agent server is not connected.' : `GuideMode paused: ${error.message}`); announce(session);
  } finally { locks.delete(session.tabId); session.abortController = null; }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id && /^https?:\/\//i.test(tab.url || '')) { lastWebTabId = tab.id; return tab; }
  if (lastWebTabId != null) {
    try { const previous = await chrome.tabs.get(lastWebTabId); if (previous?.id && /^https?:\/\//i.test(previous.url || '')) return previous; } catch {}
  }
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    if (request.type === M.GET_STATE) {
      const tab = await activeTab(); return { ok: true, state: publicSession(await getSession(tab.id)), restricted: isRestricted(tab.url) };
    }
    if (request.type === M.START) {
      const tab = await activeTab();
      if (isRestricted(tab.url)) throw new Error('GuideMode cannot run on browser settings or other restricted pages. Open an HTTP or HTTPS webpage.');
      if (!String(request.goal || '').trim()) throw new Error('Enter a goal first');
      const existing = await getSession(tab.id); if (existing) await stopSession(existing, 'Previous GuideMode session stopped.');
      await server('/api/health');
      const session = {
        sessionId: crypto.randomUUID(), tabId: tab.id, goal: String(request.goal).trim(), status: C.STATUS.RUNNING,
        step: 0, history: [], currentAction: null, semanticProgress: null, visualMode: request.visualMode !== false,
        paused: false, stopped: false, createdAt: new Date().toISOString(), generation: 1, lastExecution: null,
        debug: { currentUrl: tab.url, role: null, lastAction: null, targetName: null, actionSuccess: null, semanticProgress: null, replans: 0, latencyMs: null }
      };
      message(session, session.goal, 'user'); sessions.set(tab.id, session); announce(session); runLoop(session);
      return { ok: true, state: publicSession(session) };
    }
    const tab = await activeTab(); const session = await getSession(tab.id);
    if (!session) throw new Error('No GuideMode session is bound to this tab');
    if (request.type === M.STOP) { await stopSession(session); return { ok: true, state: publicSession(session) }; }
    if (request.type === M.CONTINUE) {
      session.paused = false; session.stopped = false; session.status = C.STATUS.RUNNING; session.connectionError = null; session.generation++;
      message(session, 'Ready to continue.'); announce(session); runLoop(session); return { ok: true, state: publicSession(session) };
    }
    if (request.type === M.RETRY_CONNECTION) { await server('/api/health'); session.connectionError = null; return { ok: true }; }
    if (request.type === M.SET_VISUAL_MODE) {
      session.visualMode = Boolean(request.enabled);
      await sendTab(session.tabId, session.visualMode && session.currentPlan ? { type: M.APPLY_PLAN, plan: session.currentPlan, enabled: true } : { type: M.CLEAR_PLAN }).catch(() => {});
      announce(session); return { ok: true, state: publicSession(session) };
    }
    throw new Error('Unknown GuideMode command');
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => { const session = await getSession(tabId); if (session) await stopSession(session, 'The bound tab was closed.').catch(() => {}); sessions.delete(tabId); chrome.storage.session.remove(`session:${tabId}`).catch(() => {}); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { try { const tab = await chrome.tabs.get(tabId); if (/^https?:\/\//i.test(tab.url || '')) lastWebTabId = tabId; } catch {} });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  getSession(tabId).then(session => {
    if (!session) return;
    if (changeInfo.url) { session.debug.currentUrl = changeInfo.url; announce(session); }
    if (changeInfo.status === 'complete' && !session.stopped && !session.paused) setTimeout(() => runLoop(session), 250);
  }).catch(() => {});
});
