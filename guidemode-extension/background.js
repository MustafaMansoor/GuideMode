importScripts('shared/constants.js', 'shared/messages.js', 'shared/guide-state.js');

const C = globalThis.GuideModeConstants;
const M = globalThis.GuideModeMessages;
const G = globalThis.GuideModeGuideState;
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
  currentPlan: session.currentPlan || null, guideState: session.guideState || G.idle(), mode: session.mode || C.MODE.AUTO,
  generation: session.generation || 1
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
  await server('/api/session/stop', { sessionId: session.sessionId, generation: session.generation }).catch(() => {});
}

const terminal = session => session.stopped || [C.STATUS.COMPLETED, C.STATUS.IMPOSSIBLE, C.STATUS.STOPPED].includes(session.status);
const activeGeneration = (session, generation) => !terminal(session) && !session.paused && session.generation === generation;
async function renderGuide(session) {
  if (!session.goal || !session.guideState || session.guideState.status === 'idle' || !session.visualMode) return sendTab(session.tabId,{type:M.CLEAR_PLAN}).catch(()=>{});
  return sendTab(session.tabId,{type:M.APPLY_PLAN,plan:{...(session.currentPlan||{elements:[],uncertain_refs:[]}),guide_state:session.guideState,current_ref:session.guideState.target?.ref||null},enabled:true}).catch(()=>{});
}
function completeGuidedStep(session,observation,verification){const prior=session.guideState;const completed={stepNumber:prior.stepNumber,instruction:prior.instruction,targetName:prior.target?.name,verifiedAt:new Date().toISOString(),evidence:{semanticProgress:verification.semanticProgress,urlChanged:verification.urlChanged,headingChanged:verification.headingChanged}};session.completedSteps=[...(session.completedSteps||[]),completed];prior.completedSteps=session.completedSteps;prior.awaitingUser=false;session.lastExecution={action_success:true,semantic_progress:true,previous_progress_signature:prior.expected.previousSignature,new_progress_signature:observation.progress_signature,previous_url:prior.expected.previousUrl,next_url:observation.page.url,user_performed:true};session.semanticProgress=true;session.currentAction=null;message(session,`Completed: ${prior.instruction}`)}

async function runLoop(session) {
  if (locks.has(session.tabId) || terminal(session) || session.paused) return;
  locks.add(session.tabId);
  const generation = session.generation;
  session.abortController = new AbortController();
  try {
    while (!session.stopped && !session.paused && session.generation === generation && session.step < C.MAX_STEPS) {
      session.status = C.STATUS.RUNNING;
      message(session, session.step ? 'Checking what changed…' : 'Understanding this page…'); announce(session);
      const observationResponse = await sendTab(session.tabId, { type: M.OBSERVE });
      if (!activeGeneration(session, generation)) break;
      if (!observationResponse?.ok) throw new Error(observationResponse?.error || 'Could not observe this page');
      const observation = observationResponse.observation;
      if(session.mode===C.MODE.GUIDE&&session.guideState?.awaitingUser){const verification=G.verify(session.guideState,observation);if(verification.verified)completeGuidedStep(session,observation,verification);else if(verification.semanticProgress){session.lastExecution={action_success:false,semantic_progress:true,previous_progress_signature:session.guideState.expected.previousSignature,new_progress_signature:observation.progress_signature,execution_error:'User changed page state differently from the guided outcome'};session.guideState.awaitingUser=false;message(session,'The page changed, so I’m reconsidering the next step.')}else{if(verification.currentTarget)session.guideState.target.ref=verification.currentTarget.ref;session.guideState.observationId=observation.observation_id;session.guideState.supportingRefs=[];session.currentPlan={elements:[],uncertain_refs:[]};session.status=C.STATUS.GUIDING;await renderGuide(session);announce(session);return}}
      if (session.awaitingObservation && session.lastExecution) {
        session.lastExecution.new_progress_signature = observation.progress_signature;
        session.lastExecution.semantic_progress = observation.progress_signature !== session.lastExecution.previous_progress_signature;
        session.awaitingObservation = false;
      }
      session.debug.currentUrl = observation.page.url;
      session.debug.observationMs = observation.timings?.observation_ms || 0;
      session.debug.routeScoutMs = observation.timings?.route_scout_ms || 0;
      message(session, 'Finding the best pathâ€¦'); announce(session);

      const requestBody = {
        sessionId: session.sessionId, tabId: session.tabId, goal: session.goal, observation,
        previousExecution: session.lastExecution || null, maxSteps: C.MAX_STEPS, generation
      }; const serializationStarted = performance.now(); JSON.stringify(requestBody);
      session.debug.requestSerializationMs = Math.round((performance.now() - serializationStarted) * 10) / 10;
      const transportStarted = performance.now();
      const decision = await server('/api/session/step', requestBody, session.abortController.signal);
      session.debug.serverTransportMs = Math.round((performance.now() - transportStarted) * 10) / 10;
      if (!activeGeneration(session, generation)) { session.debug.lateResponseDiscarded = true; break; }
      if (decision.status === 'discarded' || decision.status === 'busy') break;
      if (decision.status === 'invalid_action') { message(session, 'The page changed before that action could be used. I’m checking it again.'); session.lastExecution = { action_success: false, execution_error: decision.code, semantic_progress: false }; announce(session); continue; }
      session.step = decision.step ?? session.step;
      session.debug.role = decision.model_role || 'navigator';
      session.debug.latencyMs = decision.latency_ms || 0;
      session.debug.focusPlannerMs = decision.timings?.focus_planner_gemini_ms || 0;
      session.debug.navigatorGeminiMs = decision.timings?.navigator_gemini_ms || decision.latency_ms || 0;
      session.debug.focusCacheHit = Boolean(decision.focus_cache_hit);
      session.debug.context = decision.context || null; session.debug.usage = decision.usage || null;
      session.debug.replans = decision.replans || session.debug.replans;

      const plan = decision.focus_plan;
      if (plan) session.currentPlan = plan;

      if (['impossible','completed','step_limit','error'].includes(decision.status)) {
        session.status = decision.status === 'impossible' ? C.STATUS.IMPOSSIBLE : decision.status === 'completed' ? C.STATUS.COMPLETED : C.STATUS.STOPPED;
        session.stopped = true;
        session.guideState={...(session.guideState||G.idle()),goal:session.goal,status:decision.status==='impossible'?'impossible':'completed',target:null,awaitingUser:false,instruction:decision.message||'',explanation:decision.message||'',supportingRefs:decision.evidence_refs||session.guideState?.supportingRefs||[],completedSteps:session.completedSteps||[]};await renderGuide(session);
        message(session, decision.message || (decision.status === 'impossible' ? "I couldn't find a safe path matching that goal." : 'GuideMode has stopped.'));
        session.generation++; session.abortController?.abort(); announce(session); break;
      }
      if (decision.status === 'needs_human' || decision.pause) {
        session.paused = true; session.status = C.STATUS.PAUSED; session.currentAction = decision.action || null;
        if(decision.action)session.guideState=G.create({goal:session.goal,mode:session.mode,stepNumber:session.step,decision,observation,focusPlan:plan,completedSteps:session.completedSteps||[]});
        if(session.guideState){session.guideState.status='waiting_for_user';session.guideState.awaitingUser=true}await renderGuide(session);
        message(session, decision.message || "You're at a step that needs your review. Please complete it yourself, then press Continue.");
        announce(session); break;
      }
      if (!decision.action) throw new Error('Agent server returned no bounded action');
      session.currentAction = decision.action;
      session.guideState=G.create({goal:session.goal,mode:session.mode,stepNumber:session.step,decision,observation,focusPlan:plan,completedSteps:session.completedSteps||[]});
      session.debug.lastAction = decision.action.action;
      session.debug.targetName = decision.target_name || decision.action.reason || decision.action.ref;
      await renderGuide(session);
      if(session.mode===C.MODE.GUIDE){session.status=C.STATUS.GUIDING;session.guideState.awaitingUser=true;message(session,session.guideState.instruction);announce(session);return}
      message(session, decision.message || decision.action.reason || 'Working on the next step…'); announce(session);

      const executed = await sendTab(session.tabId, { type: M.EXECUTE, action: { ...decision.action, observation_id: decision.observation_id } });
      if (!activeGeneration(session, generation)) break;
      if (!executed?.ok) throw new Error(executed?.error || 'Page action failed');
      if (executed.result?.paused) {
        session.paused = true; session.status = C.STATUS.PAUSED; session.lastExecution = executed.result;
        message(session, "You're at a step that needs your review. Please complete it yourself, then press Continue."); announce(session); break;
      }
      if (['stale_route_ref','stale_form_ref'].includes(executed.result?.execution_failure_type) || /stale/i.test(executed.result?.execution_error || '')) {
        session.lastExecution = { ...executed.result, code: 'STALE_REF', previous_progress_signature: observation.progress_signature,
          new_progress_signature: observation.progress_signature, semantic_progress: false };
        session.debug.staleRefRecovered = true; message(session, 'The page changed. I’m refreshing what I can act on.'); announce(session); continue;
      }
      if (executed.result?.navigation_started) {
        session.status = 'navigating'; session.awaitingObservation = true;
        session.lastExecution = { ...executed.result, previous_progress_signature: observation.progress_signature,
          new_progress_signature: observation.progress_signature, semantic_progress: false };
        session.debug.executorMs = executed.result.executor_ms || 0; session.debug.settleWaitMs = executed.result.settle_wait_ms || 0;
        announce(session); break;
      }
      const reobserveStarted = performance.now();
      const fresh = await sendTab(session.tabId, { type: M.OBSERVE });
      session.debug.reobserveMs = Math.round((performance.now() - reobserveStarted) * 10) / 10;
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
      session.debug.executorMs = executed.result?.executor_ms || 0; session.debug.settleWaitMs = executed.result?.settle_wait_ms || 0;
      if(progress&&session.guideState){session.completedSteps=[...(session.completedSteps||[]),{stepNumber:session.guideState.stepNumber,instruction:session.guideState.instruction,targetName:session.guideState.target?.name,verifiedAt:new Date().toISOString()}];session.guideState.completedSteps=session.completedSteps}
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if(request.type===M.PAGE_CHANGED&&sender.tab?.id){const session=await getSession(sender.tab.id);if(session?.mode===C.MODE.GUIDE&&session.guideState?.awaitingUser&&!terminal(session))setTimeout(()=>runLoop(session),120);return{ok:true}}
    if (request.type === M.GET_STATE) {
      const tab = await activeTab(); return { ok: true, state: publicSession(await getSession(tab.id)), restricted: isRestricted(tab.url) };
    }
    if (request.type === M.START) {
      const tab = await activeTab();
      if (isRestricted(tab.url)) throw new Error('GuideMode cannot run on browser settings or other restricted pages. Open an HTTP or HTTPS webpage.');
      if (!String(request.goal || '').trim()) throw new Error('Enter a goal first');
      const existing = await getSession(tab.id); if (existing) { await sendTab(tab.id,{type:M.CLEAR_PLAN}).catch(()=>{});await stopSession(existing,'Previous GuideMode session stopped.') }
      await server('/api/health');
      const session = {
        sessionId: crypto.randomUUID(), tabId: tab.id, goal: String(request.goal).trim(), status: C.STATUS.THINKING,
        step: 0, history: [], currentAction: null, semanticProgress: null, visualMode: request.visualMode !== false,
        paused: false, stopped: false, createdAt: new Date().toISOString(), generation: 1, lastExecution: null,
        mode:request.mode===C.MODE.GUIDE?C.MODE.GUIDE:C.MODE.AUTO,guideState:{...G.idle(),goal:String(request.goal).trim(),status:'thinking'},completedSteps:[],
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
      if(session.visualMode)await renderGuide(session);else await sendTab(session.tabId,{type:M.CLEAR_PLAN}).catch(()=>{});
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
