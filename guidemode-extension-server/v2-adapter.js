const { GoogleGenAI, Type } = require('@google/genai');
const { ProgressTracker } = require('../agent-core-v2/progress');
const { searchRoutes } = require('./route-scout');
const { TERMINAL, createRequestSnapshot, invalidRef } = require('./ref-lifecycle');

// Directly reused from frozen v2: ProgressTracker semantics.
// Adapted from frozen v2: Navigator/Replanner roles and bounded one-action contract.
// Extension-specific: observations/actions arrive over HTTP rather than Playwright.
const VERSION = 'guidemode-extension-v2-adapter';
const PROMPT_VERSION = 'agent-core-v2-extension-adapter-v1';
const ACTIONS = ['click','check','uncheck','fill','select','scroll','focus','navigate_route','submit_form','answer','impossible'];
const actionSchema = { type: Type.OBJECT, properties: {
  action: { type: Type.STRING, enum: ACTIONS }, ref: { type: Type.STRING, nullable: true },
  value: { type: Type.STRING, nullable: true }, reason: { type: Type.STRING },
  evidence_refs: { type: Type.ARRAY, items: { type: Type.STRING } }
}, required: ['action','ref','value','reason','evidence_refs'] };
const replanSchema = { type: Type.OBJECT, properties: {
  diagnosis: { type: Type.STRING }, next_subgoal: { type: Type.STRING },
  avoid_actions: { type: Type.ARRAY, items: { type: Type.STRING } },
  evidence_refs: { type: Type.ARRAY, items: { type: Type.STRING } },
  status: { type: Type.STRING, enum: ['continue','goal_impossible','needs_human'] }
}, required: ['diagnosis','next_subgoal','avoid_actions','evidence_refs','status'] };

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const words=value=>new Set(clean(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(word=>word.length>2));
function initialTargetIsGrounded(goal,action,target,step){if(step>1||action.action==='answer'||action.action==='impossible')return true;if(action.action==='fill'&&(/search/i.test(target?.name||'')||['searchbox'].includes(target?.role)))return true;const goalWords=words(goal),targetWords=words(`${target?.name||target?.text||target?.purpose||''} ${target?.group_context||target?.context||''} ${target?.pathname||''} ${action?.value||''}`);return[...goalWords].some(word=>targetWords.has(word))}
function compactModelContent(observation, routeCandidates = []) {
  const repeated = new Set([...(observation.controls || []).map(item => clean(item.name).toLowerCase()),
    ...routeCandidates.map(item => clean(item.text).toLowerCase())].filter(Boolean));
  return (observation.content || []).filter(item => !['paragraph','list_item'].includes(item.type) || !repeated.has(clean(item.text).toLowerCase()));
}
const actionIdentity = (action, controls, routes = [], forms = []) => {
  if (!action || action.action === 'impossible') return action?.action || 'none';
  const control = controls.find(item => item.ref === action.ref);
  const route = routes.find(item => item.ref === action.ref);
  const form = forms.find(item => item.ref === action.ref);
  if (route) return `navigate_route|${route.href}`;
  if (form) return `submit_form|${form.method}|${form.action}`;
  return control ? [action.action, control.role, clean(control.name).toLowerCase(), clean(control.group_context).toLowerCase(), action.value || ''].join('|') : `${action.action}:unknown:${action.ref}`;
};
function validateAction(action, controls, routes = [], forms = []) {
  if (!action || !ACTIONS.includes(action.action)) return { ok: false, code: 'INVALID_ACTION', recoverable: false };
  if (action.action === 'impossible') return null;
  if(action.action==='answer')return null;
  if (action.action === 'navigate_route') {
    const route = routes.find(item => item.ref === action.ref);
    if (!route) return invalidRef(action);
    return route;
  }
  if (action.action === 'submit_form') {
    const form = forms.find(item => item.ref === action.ref);
    if (!form) return invalidRef(action);
    return form;
  }
  const control = controls.find(item => item.ref === action.ref);
  if (!control) return invalidRef(action);
  if (control.disabled) return { ok: false, code: 'DISABLED', ref: action.ref, recoverable: false };
  if (!control.capabilities?.actions?.includes(action.action)) return { ok: false, code: 'INCOMPATIBLE_ACTION', ref: action.ref, recoverable: false };
  if (['fill','select'].includes(action.action) && typeof action.value !== 'string') return { ok: false, code: 'MISSING_VALUE', ref: action.ref, recoverable: false };
  return control;
}
const consequential = control => /\b(start now|buy now|add to (cart|bag)|checkout|pay|payment|place order|submit|approve.{0,8}submit|confirm (appointment|booking|order)|book|booking|transfer|delete|send|purchase|log[ -]?out|sign[ -]?out|remove account|unsubscribe|close account)\b/i
  .test(`${control?.name || ''} ${control?.text || ''} ${control?.purpose || ''} ${control?.pathname || ''} ${control?.action || ''} ${control?.group_context || ''}`);
const sensitive = (control, action) => control?.type === 'password' || (action === 'fill' && /\b(password|passcode|otp|one.time|captcha|card number|cvv|national insurance|identity number|passport number|government id|licen[cs]e number|email|phone|telephone|date of birth|full (legal )?name|street address|postcode)\b/i
  .test(`${control?.name || ''} ${control?.group_context || ''}`));

class ExtensionV2Adapter {
  constructor({ apiKey, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash', requestsPerMinute = 15, ai } = {}) {
    this.ai = ai || new GoogleGenAI({ apiKey }); this.model = model; this.requestsPerMinute = requestsPerMinute;
    this.sessions = new Map(); this.lastCallAt = 0;
  }
  createSession({ sessionId, goal, tabId, maxSteps = 18 }) {
    const state = { sessionId, goal, tabId, maxSteps, step: 0, tracker: new ProgressTracker({ cycleThreshold: 2 }), activeSubgoal: null,
      avoidActions: [], lastObservation: null, lastActionIdentity: null, replans: 0, stopped: false, status: 'running', generation: 1,
      inFlightRequestId: null, routeHistory: new Set(),
      trajectory: { trajectory_id: sessionId, version: VERSION, source_agent: 'agent-core-v2', source_commit: 'ac958d97a549780876f5256a8f9e50e691187ee1',
        prompt_version: PROMPT_VERSION, goal, model: this.model, tab_id: tabId, started_at: new Date().toISOString(), steps: [], navigator_calls: 0,
        replanner_calls: 0, human_pauses: 0, errors: [], usage: { prompt_tokens: 0, candidate_tokens: 0, total_tokens: 0 } } };
    this.sessions.set(sessionId, state); return state;
  }
  stop(sessionId, generation) { const state = this.sessions.get(sessionId); if (state) { state.stopped = true; state.status = 'stopped'; state.generation = Math.max(state.generation + 1, Number(generation || 0)); state.inFlightRequestId = null; state.trajectory.final_status = 'stopped'; state.trajectory.finished_at = new Date().toISOString(); } return state; }
  markTerminal(sessionId, status, generation) { const state = this.sessions.get(sessionId); if (state && TERMINAL.has(status)) { state.stopped = true; state.status = status; state.generation = Math.max(state.generation + 1, Number(generation || 0)); state.inFlightRequestId = null; state.trajectory.final_status = status; } return state; }
  async pace() {
    const interval = Math.ceil(60000 / this.requestsPerMinute) + 250;
    const pacing = Math.max(0, interval - (Date.now() - this.lastCallAt)); if (pacing) await wait(pacing);
    this.lastCallAt = Date.now();
  }
  async generate(state, role, contents, schema) {
    await this.pace(); const started = Date.now();
    state.trajectory[role === 'navigator' ? 'navigator_calls' : 'replanner_calls']++;
    const response = await this.ai.models.generateContent({ model: this.model, contents, config: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema } });
    const usage = response.usageMetadata || {}; state.trajectory.usage.prompt_tokens += usage.promptTokenCount || 0;
    state.trajectory.usage.candidate_tokens += usage.candidatesTokenCount || 0; state.trajectory.usage.total_tokens += usage.totalTokenCount || 0;
    return { value: JSON.parse(response.text), latency_ms: Date.now() - started, usage: { prompt_tokens: usage.promptTokenCount ?? null,
      candidate_tokens: usage.candidatesTokenCount ?? null, total_tokens: usage.totalTokenCount ?? null }, request_chars: contents.length };
  }
  navigatorPrompt(state, observation, feedback) {
    const routeCandidates = searchRoutes(state.activeSubgoal || state.goal, observation.routes || [], { limit: 12, visited: state.routeHistory });
    const getForms = (observation.forms || []).filter(form => form.method === 'GET' && form.auto_submittable).slice(0, 8);
    state.lastRouteCandidates = routeCandidates;
    const compactContent = compactModelContent(observation, routeCandidates); state.lastContextCounts = {
      controls_before: observation.controls?.length || 0, controls_sent: observation.controls?.length || 0,
      content_before: observation.content?.length || 0, content_sent: compactContent.length, route_candidates_sent: routeCandidates.length };
    const routeContext = routeCandidates.length || getForms.length ? `\n\nTOP OBSERVED ROUTE CANDIDATES:\n${JSON.stringify(routeCandidates)}\n\nSAFE GET FORMS:\n${JSON.stringify(getForms)}` : '';
    const routeGuidance = routeCandidates.length || getForms.length ? ' navigate_route accepts only a supplied r-ref and submit_form accepts only a supplied f-ref; never invent a URL or query string. Prefer a strong same-origin route candidate when it directly advances the goal. Submit only listed safe GET forms after configuring their controls.' : '';
    const refKind = routeCandidates.length || getForms.length ? 'ref' : 'e-ref';
    return `You are the Navigator in a browser agent. Choose exactly one safe browser action toward the user's goal.\n\nUSER GOAL:\n${state.goal}\n${state.activeSubgoal ? `\nCURRENT SUBGOAL FROM REPLANNER:\n${state.activeSubgoal}\n` : ''}\nPAGE:\n${JSON.stringify(observation.page)}\n\nINTERACTIVE CONTROLS:\n${JSON.stringify(observation.controls)}${routeContext}\n\nRELEVANT SEMANTIC CONTENT BLOCKS:\n${JSON.stringify(compactContent)}\n\nRECENT ACTIONS AND PROGRESS:\n${JSON.stringify(state.tracker.recentActions)}\n\nACTIONS TO AVOID:\n${JSON.stringify(state.avoidActions)}\n\nChoose one action using only a supplied ${refKind}. The control capabilities.actions field is authoritative. Never invent selectors, XPath, JavaScript, or refs.${routeGuidance} Read eligibility, requirements, fees, warnings, validation, and status content before acting. For a purely information-seeking goal already answered by visible semantic content, return answer with a concise grounded reason and one or more current c-refs; never use answer for an interaction or discovery goal. Use scroll/focus only when it materially reveals or prepares a supplied control. Return impossible only when visible page evidence establishes that no suitable route exists and plausible routes on the page have been considered; cite supplied refs. Never execute final purchase, payment, submission, confirmation, deletion, booking approval, authentication, or personal-data sending. Those steps require a human.${feedback ? `\n\nVALIDATION FEEDBACK:\n${feedback}` : ''}`;
  }
  async replan(state, observation, reason) {
    const routes = searchRoutes(state.goal, observation.routes || [], { limit: 10, visited: state.routeHistory });
    const routeContext = routes.length ? `\n\nTOP OBSERVED ROUTES:\n${JSON.stringify(routes)}` : '';
    const prompt = `You are the Replanner in a browser agent under a deterministic orchestrator. Diagnose a stall without taking a browser action.\n\nORIGINAL GOAL:\n${state.goal}\n\nCURRENT PAGE:\n${JSON.stringify(observation.page)}\n\nINTERACTIVE CONTROLS:\n${JSON.stringify(observation.controls)}${routeContext}\n\nSEMANTIC CONTENT BLOCKS:\n${JSON.stringify(observation.content)}\n\nRECENT ACTIONS:\n${JSON.stringify(state.tracker.recentActions)}\n\nSTALL REASON:\n${reason}\n\nReturn continue with a distinct next_subgoal and concrete action descriptions to avoid, goal_impossible only if page evidence proves no suitable path exists, or needs_human for a consequential, authentication, sensitive, or ambiguous boundary. Ground conclusions in supplied refs.`;
    const response = await this.generate(state, 'replanner', prompt, replanSchema); state.replans++;
    if (response.value.status === 'continue') { state.activeSubgoal = response.value.next_subgoal; state.avoidActions = [...new Set([...state.avoidActions, ...response.value.avoid_actions])].slice(-8); }
    return response;
  }
  async step(input) {
    let state = this.sessions.get(input.sessionId) || this.createSession(input);
    const generation = Number(input.generation || 1);
    if (state.stopped || TERMINAL.has(state.status)) return { status: state.status || 'stopped', step: state.step, message: 'This session is terminal.' };
    if (generation < state.generation) return { status: 'discarded', code: 'LATE_RESPONSE', late_response_discarded: true, step: state.step };
    if (state.inFlightRequestId) return { status: 'busy', code: 'SINGLE_FLIGHT', step: state.step };
    state.generation = generation;
    const snapshot = createRequestSnapshot({ sessionId: input.sessionId, generation, observation: input.observation });
    state.inFlightRequestId = snapshot.requestId;
    try { return await this._step({ ...input, generation, snapshot }); }
    finally { if (state.inFlightRequestId === snapshot.requestId) state.inFlightRequestId = null; }
  }
  async _step({ sessionId, goal, tabId, observation, previousExecution, maxSteps, generation, snapshot }) {
    let state = this.sessions.get(sessionId) || this.createSession({ sessionId, goal, tabId, maxSteps });
    if (state.stopped || state.generation !== generation) return { status: 'discarded', code: 'LATE_RESPONSE', late_response_discarded: true, step: state.step };
    if (!state.lastObservation) state.tracker.seed(observation.progress_signature);
    else if (previousExecution && state.lastActionIdentity) {
      const priorStep = state.trajectory.steps.at(-1);
      if (priorStep && !priorStep.executor_result) priorStep.executor_result = {
        action_success: Boolean(previousExecution.action_success), semantic_progress: Boolean(previousExecution.semantic_progress),
        execution_error: previousExecution.execution_error || null,
        previous_progress_signature: previousExecution.previous_progress_signature,
        new_progress_signature: previousExecution.new_progress_signature
      };
      const progress = state.tracker.record({ actionIdentity: state.lastActionIdentity,
        previousSignature: previousExecution.previous_progress_signature || state.lastObservation.progress_signature,
        newSignature: observation.progress_signature, actionSuccess: Boolean(previousExecution.action_success) });
      previousExecution.semantic_progress = progress.semanticProgress;
      if (progress.replanRequired) {
        state.avoidActions = [...new Set([...state.avoidActions, state.lastActionIdentity])].slice(-8);
        const reason = !previousExecution.action_success ? `Action failed: ${previousExecution.execution_error || 'page did not confirm it'}` :
          progress.cycleDetected ? 'Repeated action entered a page-state cycle' : `Action produced no material progress for ${progress.stallCount} attempts`;
        const replanned = await this.replan(state, observation, reason);
        if (replanned.value.status !== 'continue') {
          state.trajectory.human_pauses += replanned.value.status === 'needs_human' ? 1 : 0;
          return { status: replanned.value.status === 'goal_impossible' ? 'impossible' : 'needs_human', step: state.step,
            model_role: 'replanner', replans: state.replans, latency_ms: replanned.latency_ms, message: replanned.value.diagnosis };
        }
      }
    }
    state.lastObservation = observation;
    if (state.step >= state.maxSteps) return { status: 'step_limit', step: state.step, message: 'I reached the safe step limit.' };
    let response, feedback = null, control = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await this.generate(state, 'navigator', this.navigatorPrompt(state, observation, feedback), actionSchema);
      if (state.stopped || state.generation !== generation) return { status: 'discarded', code: 'LATE_RESPONSE', late_response_discarded: true, request_id: snapshot.requestId, step: state.step };
      const validation = validateAction(response.value, snapshot.controls, snapshot.routes, snapshot.forms);
      if (!(validation && validation.ok === false)) { control = validation; break; }
      feedback = `${validation.code}: choose only a ref supplied in observation ${snapshot.observationId}`;
      if (attempt === 1) return { status: 'invalid_action', ...validation, request_id: snapshot.requestId, observation_id: snapshot.observationId, generation, step: state.step };
    }
    state.step++;
    const action = response.value;
    if(action.action==='answer'){
      const evidence=(action.evidence_refs||[]).map(ref=>(observation.content||[]).find(item=>item.ref===ref)).filter(Boolean);
      if(!evidence.length)return{status:'invalid_action',code:'UNSUPPORTED_ANSWER',recoverable:false,step:state.step,observation_id:snapshot.observationId,generation};
      state.status='completed';state.stopped=true;state.trajectory.final_status='completed';state.trajectory.steps.push({step:state.step,observation_summary:observation.summary,model_role:'navigator',model_action:action,answer_evidence:evidence});
      return{status:'completed',step:state.step,model_role:'navigator',latency_ms:response.latency_ms,message:action.reason,evidence_refs:evidence.map(item=>item.ref),observation_id:snapshot.observationId,generation};
    }
    if (action.action === 'impossible') {
      const replanned = await this.replan(state, observation, `Navigator proposed goal_impossible: ${action.reason}`);
      const status = replanned.value.status === 'goal_impossible' ? 'impossible' : replanned.value.status === 'needs_human' ? 'needs_human' : 'continue';
      state.trajectory.steps.push({ step: state.step, observation_summary: observation.summary, model_role: 'navigator', model_action: action, replan: replanned.value, final_status: status });
      return status === 'continue' ? this._step({ sessionId, goal, tabId, observation, previousExecution: null, maxSteps, generation, snapshot }) :
        { status, step: state.step, model_role: 'replanner', replans: state.replans, latency_ms: response.latency_ms + replanned.latency_ms, message: replanned.value.diagnosis };
    }
    const routeOrFormPause = action.action === 'navigate_route' && !control.same_origin || action.action === 'submit_form' && (control.method !== 'GET' || !control.auto_submittable);
    if (routeOrFormPause || consequential(control) || sensitive(control, action.action)) {
      state.trajectory.human_pauses++; state.trajectory.steps.push({ step: state.step, observation_summary: observation.summary, model_role: 'navigator', model_action: action, human_pause: true });
      return { status: 'needs_human', pause: true, step: state.step, action, target_name: control.name, model_role: 'navigator', replans: state.replans,
        latency_ms: response.latency_ms, message: "You're at a step that needs your review. Please complete it yourself, then press Continue." };
    }
    if(!initialTargetIsGrounded(state.goal,action,control,state.step)){state.trajectory.steps.push({step:state.step,model_role:'navigator',model_action:action,guidance_rejected:'unrelated_initial_target'});return{status:'needs_human',pause:true,step:state.step,action:null,model_role:'navigator',replans:state.replans,latency_ms:response.latency_ms,message:'I could not establish a reliable next step for this goal from the current page.'}}
    state.lastActionIdentity = actionIdentity(action, observation.controls, observation.routes, observation.forms);
    if (action.action === 'navigate_route') state.routeHistory.add(control.href);
    state.trajectory.steps.push({ step: state.step, tab_url: observation.page.url, observation_summary: observation.summary,
      semantic_content_count: observation.content.length, raw_route_count: observation.route_summary?.raw_link_count || 0,
      unique_route_count: observation.routes?.length || 0, route_candidates_sent: state.lastRouteCandidates || [], model_role: 'navigator', model_action: action,
      target: { ref: action.ref, name: control?.name || control?.text || control?.purpose || null }, latency_ms: response.latency_ms });
    return { status: 'action', step: state.step, action, target_name: control?.name || null, model_role: 'navigator', replans: state.replans,
      latency_ms: response.latency_ms, route_candidates: state.lastRouteCandidates || [], request_id: snapshot.requestId,
      observation_id: snapshot.observationId, generation, usage: response.usage,
      context: { ...state.lastContextCounts, request_chars: response.request_chars },
      timings: { navigator_gemini_ms: response.latency_ms, replanner_gemini_ms: 0 }, message: userMessage(action, control) };
  }
}
function userMessage(action, control) {
  const name = clean(control?.name || action.reason || 'the next part');
  return ({ click: `Opening ${name}.`, check: `Selecting ${name}.`, uncheck: `Clearing ${name}.`, fill: `Entering the requested information in ${name}.`,
    select: `Choosing an option in ${name}.`, scroll: `Bringing ${name} into view.`, focus: `Focusing ${name}.`,
    navigate_route: `Opening ${clean(control?.text || name)}.`, submit_form: `Applying ${clean(control?.purpose || name)}.` })[action.action] || 'Working on the next step.';
}

module.exports = { ExtensionV2Adapter, VERSION, PROMPT_VERSION, validateAction, consequential, sensitive, actionIdentity, compactModelContent, initialTargetIsGrounded };
