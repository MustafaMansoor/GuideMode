const { GoogleGenAI, Type } = require('@google/genai');
const { ProgressTracker } = require('../agent-core-v2/progress');

// Directly reused from frozen v2: ProgressTracker semantics.
// Adapted from frozen v2: Navigator/Replanner roles and bounded one-action contract.
// Extension-specific: observations/actions arrive over HTTP rather than Playwright.
const VERSION = 'guidemode-extension-v2-adapter';
const PROMPT_VERSION = 'agent-core-v2-extension-adapter-v1';
const ACTIONS = ['click','check','uncheck','fill','select','scroll','focus','impossible'];
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
const actionIdentity = (action, controls) => {
  if (!action || action.action === 'impossible') return action?.action || 'none';
  const control = controls.find(item => item.ref === action.ref);
  return control ? [action.action, control.role, clean(control.name).toLowerCase(), clean(control.group_context).toLowerCase(), action.value || ''].join('|') : `${action.action}:unknown:${action.ref}`;
};
function validateAction(action, controls) {
  if (!action || !ACTIONS.includes(action.action)) throw new Error('unsupported action');
  if (action.action === 'impossible') return null;
  const control = controls.find(item => item.ref === action.ref);
  if (!control) throw new Error(`unknown ref ${action.ref}`);
  if (control.disabled) throw new Error(`control ${action.ref} is disabled`);
  if (!control.capabilities?.actions?.includes(action.action)) throw new Error(`${action.action} incompatible with ${control.role}`);
  if (['fill','select'].includes(action.action) && typeof action.value !== 'string') throw new Error(`${action.action} requires a string value`);
  return control;
}
const consequential = control => /\b(buy now|add to (cart|bag)|checkout|pay|payment|place order|submit|approve.{0,8}submit|confirm (appointment|booking|order)|book|booking|transfer|delete|send|purchase)\b/i
  .test(`${control?.name || ''} ${control?.group_context || ''}`);
const sensitive = (control, action) => control?.type === 'password' || (action === 'fill' && /\b(password|passcode|otp|one.time|captcha|card number|cvv|national insurance|identity number|passport number|government id|licen[cs]e number|email|phone|telephone|date of birth|full (legal )?name|street address|postcode)\b/i
  .test(`${control?.name || ''} ${control?.group_context || ''}`));

class ExtensionV2Adapter {
  constructor({ apiKey, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash', requestsPerMinute = 15, ai } = {}) {
    this.ai = ai || new GoogleGenAI({ apiKey }); this.model = model; this.requestsPerMinute = requestsPerMinute;
    this.sessions = new Map(); this.lastCallAt = 0;
  }
  createSession({ sessionId, goal, tabId, maxSteps = 18 }) {
    const state = { sessionId, goal, tabId, maxSteps, step: 0, tracker: new ProgressTracker({ cycleThreshold: 2 }), activeSubgoal: null,
      avoidActions: [], lastObservation: null, lastActionIdentity: null, replans: 0, stopped: false,
      trajectory: { trajectory_id: sessionId, version: VERSION, source_agent: 'agent-core-v2', source_commit: 'ac958d97a549780876f5256a8f9e50e691187ee1',
        prompt_version: PROMPT_VERSION, goal, model: this.model, tab_id: tabId, started_at: new Date().toISOString(), steps: [], navigator_calls: 0,
        replanner_calls: 0, human_pauses: 0, errors: [], usage: { prompt_tokens: 0, candidate_tokens: 0, total_tokens: 0 } } };
    this.sessions.set(sessionId, state); return state;
  }
  stop(sessionId) { const state = this.sessions.get(sessionId); if (state) { state.stopped = true; state.trajectory.final_status = 'stopped'; state.trajectory.finished_at = new Date().toISOString(); } return state; }
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
    return { value: JSON.parse(response.text), latency_ms: Date.now() - started };
  }
  navigatorPrompt(state, observation, feedback) {
    return `You are the Navigator in a browser agent. Choose exactly one safe browser action toward the user's goal.\n\nUSER GOAL:\n${state.goal}\n${state.activeSubgoal ? `\nCURRENT SUBGOAL FROM REPLANNER:\n${state.activeSubgoal}\n` : ''}\nPAGE:\n${JSON.stringify(observation.page)}\n\nINTERACTIVE CONTROLS:\n${JSON.stringify(observation.controls)}\n\nRELEVANT SEMANTIC CONTENT BLOCKS:\n${JSON.stringify(observation.content)}\n\nRECENT ACTIONS AND PROGRESS:\n${JSON.stringify(state.tracker.recentActions)}\n\nACTIONS TO AVOID:\n${JSON.stringify(state.avoidActions)}\n\nChoose one action using only a supplied e-ref. The control capabilities.actions field is authoritative. Never invent selectors, XPath, JavaScript, or refs. Read eligibility, requirements, fees, warnings, validation, and status content before acting. Use scroll/focus only when it materially reveals or prepares a supplied control. Return impossible only when visible page evidence establishes that no suitable route exists and plausible routes on the page have been considered; cite supplied refs. Never execute final purchase, payment, submission, confirmation, deletion, booking approval, authentication, or personal-data sending. Those steps require a human.${feedback ? `\n\nVALIDATION FEEDBACK:\n${feedback}` : ''}`;
  }
  async replan(state, observation, reason) {
    const prompt = `You are the Replanner in a browser agent under a deterministic orchestrator. Diagnose a stall without taking a browser action.\n\nORIGINAL GOAL:\n${state.goal}\n\nCURRENT PAGE:\n${JSON.stringify(observation.page)}\n\nINTERACTIVE CONTROLS:\n${JSON.stringify(observation.controls)}\n\nSEMANTIC CONTENT BLOCKS:\n${JSON.stringify(observation.content)}\n\nRECENT ACTIONS:\n${JSON.stringify(state.tracker.recentActions)}\n\nSTALL REASON:\n${reason}\n\nReturn continue with a distinct next_subgoal and concrete action descriptions to avoid, goal_impossible only if page evidence proves no suitable path exists, or needs_human for a consequential, authentication, sensitive, or ambiguous boundary. Ground conclusions in supplied refs.`;
    const response = await this.generate(state, 'replanner', prompt, replanSchema); state.replans++;
    if (response.value.status === 'continue') { state.activeSubgoal = response.value.next_subgoal; state.avoidActions = [...new Set([...state.avoidActions, ...response.value.avoid_actions])].slice(-8); }
    return response;
  }
  async step({ sessionId, goal, tabId, observation, previousExecution, maxSteps }) {
    let state = this.sessions.get(sessionId) || this.createSession({ sessionId, goal, tabId, maxSteps });
    if (state.stopped) return { status: 'stopped', step: state.step, message: 'This session is stopped.' };
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
      try { control = validateAction(response.value, observation.controls); break; }
      catch (error) { feedback = error.message; if (attempt === 1) throw error; }
    }
    state.step++;
    const action = response.value;
    if (action.action === 'impossible') {
      const replanned = await this.replan(state, observation, `Navigator proposed goal_impossible: ${action.reason}`);
      const status = replanned.value.status === 'goal_impossible' ? 'impossible' : replanned.value.status === 'needs_human' ? 'needs_human' : 'continue';
      state.trajectory.steps.push({ step: state.step, observation_summary: observation.summary, model_role: 'navigator', model_action: action, replan: replanned.value, final_status: status });
      return status === 'continue' ? this.step({ sessionId, goal, tabId, observation, previousExecution: null, maxSteps }) :
        { status, step: state.step, model_role: 'replanner', replans: state.replans, latency_ms: response.latency_ms + replanned.latency_ms, message: replanned.value.diagnosis };
    }
    if (consequential(control) || sensitive(control, action.action)) {
      state.trajectory.human_pauses++; state.trajectory.steps.push({ step: state.step, observation_summary: observation.summary, model_role: 'navigator', model_action: action, human_pause: true });
      return { status: 'needs_human', pause: true, step: state.step, action, target_name: control.name, model_role: 'navigator', replans: state.replans,
        latency_ms: response.latency_ms, message: "You're at a step that needs your review. Please complete it yourself, then press Continue." };
    }
    state.lastActionIdentity = actionIdentity(action, observation.controls);
    state.trajectory.steps.push({ step: state.step, tab_url: observation.page.url, observation_summary: observation.summary,
      semantic_content_count: observation.content.length, model_role: 'navigator', model_action: action, target: { ref: action.ref, name: control?.name || null }, latency_ms: response.latency_ms });
    return { status: 'action', step: state.step, action, target_name: control?.name || null, model_role: 'navigator', replans: state.replans,
      latency_ms: response.latency_ms, message: userMessage(action, control) };
  }
}
function userMessage(action, control) {
  const name = clean(control?.name || action.reason || 'the next part');
  return ({ click: `Opening ${name}.`, check: `Selecting ${name}.`, uncheck: `Clearing ${name}.`, fill: `Entering the requested information in ${name}.`,
    select: `Choosing an option in ${name}.`, scroll: `Bringing ${name} into view.`, focus: `Focusing ${name}.` })[action.action] || 'Working on the next step.';
}

module.exports = { ExtensionV2Adapter, VERSION, PROMPT_VERSION, validateAction, consequential, sensitive };
