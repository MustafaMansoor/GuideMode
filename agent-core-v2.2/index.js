const { GoogleGenAI, Type } = require('@google/genai');
const crypto = require('crypto');
const { observePage, actionIdentity } = require('./observer');
const { executeResilient, validateAction } = require('./executor');
const { ProgressTracker } = require('./progress');

const VERSION = 'agent-core-v2.2-compatibility-hardening';
const PROMPT_VERSION = 'agent-core-v2-navigator-replanner-v1';
const ACTIONS = ['click','check','uncheck','fill','select','impossible'];
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function terminalResult(value) {
  if (!value) return { done: false };
  if (value === true) return { done: true, status: 'completed' };
  return { done: Boolean(value.done), status: value.status || 'completed', reason: value.reason || null };
}

function compactObservation(observation) {
  return { page: observation.page, summary: observation.summary, controls: observation.controls, semantic_content_blocks: observation.content };
}

async function runAgent(options) {
  const {
    page, goal, maxSteps = 15, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }), isTerminal = async () => false,
    metadata = {}, requestsPerMinute = 15
  } = options;
  if (!page || !goal) throw new Error('runAgent requires page and goal');
  const trajectory = {
    trajectory_id: crypto.randomUUID(), version: VERSION, prompt_version: PROMPT_VERSION,
    goal, model, started_at: new Date().toISOString(), metadata, steps: [],
    gemini_calls: 0, navigator_calls: 0, replanner_calls: 0, retries: 0,
    replans_triggered: 0, cycles_detected: 0, execution_failures: 0,
    impossible_eligibility_decisions: 0, usage: { prompt_tokens: 0, candidate_tokens: 0, total_tokens: 0, estimated_cost_usd: null }
  };
  const tracker = new ProgressTracker({ cycleThreshold: 2 });
  let lastCallAt = 0;
  let activeSubgoal = null;
  let avoidActions = [];
  let finalStatus = 'step_limit';
  let failureReason = 'maximum step limit reached';

  async function generate(role, contents, schema) {
    const errors = [];
    const started = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const interval = Math.ceil(60000 / requestsPerMinute) + 250;
      const pacing = Math.max(0, interval - (Date.now() - lastCallAt));
      if (pacing) await delay(pacing);
      lastCallAt = Date.now();
      trajectory.gemini_calls++;
      trajectory[role === 'navigator' ? 'navigator_calls' : 'replanner_calls']++;
      try {
        const response = await ai.models.generateContent({ model, contents, config: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema } });
        const usage = response.usageMetadata || {};
        trajectory.usage.prompt_tokens += usage.promptTokenCount || 0;
        trajectory.usage.candidate_tokens += usage.candidatesTokenCount || 0;
        trajectory.usage.total_tokens += usage.totalTokenCount || 0;
        trajectory.retries += attempt;
        return { value: JSON.parse(response.text), latency_ms: Date.now() - started, retries: attempt, errors };
      } catch (error) {
        errors.push(error.message);
        const retryable = /429|fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message);
        if (!retryable || attempt === 2) throw error;
        const seconds = error.message.includes('429') ? Number(error.message.match(/retry in ([\d.]+)s/i)?.[1] || 60) : 5;
        await delay(Math.ceil(seconds * 1000) + 1000);
      }
    }
  }

  function navigatorPrompt(observation, recentActions, feedback) {
    return `You are the Navigator in a browser agent. Choose exactly one safe browser action toward the user's goal.\n\nUSER GOAL:\n${goal}\n${activeSubgoal ? `\nCURRENT SUBGOAL FROM REPLANNER:\n${activeSubgoal}\n` : ''}\nPAGE:\n${JSON.stringify(observation.page)}\n\nINTERACTIVE CONTROLS:\n${JSON.stringify(observation.controls)}\n\nRELEVANT SEMANTIC CONTENT BLOCKS:\n${JSON.stringify(observation.content)}\n\nRECENT ACTIONS AND PROGRESS:\n${JSON.stringify(recentActions)}\n\nACTIONS TO AVOID:\n${JSON.stringify(avoidActions)}\n\nChoose one action using only a supplied e-ref. Action compatibility is strict: use click only for button/link, check for an unchecked checkbox/radio, uncheck for a checked checkbox, fill for textbox/searchbox/spinbutton/slider or an editable combobox, and select for a select-only combobox/listbox. Use exact select option values and respect disabled/min/max constraints. Read eligibility, requirements, fees, warnings, validation, and status content before acting. When eligibility depends on user details, prefer the page's eligibility/assessment workflow over guessing from a general notice. Never repeat an action listed under actions to avoid. Return impossible only when visible page evidence establishes that no suitable route exists and plausible routes on the page have been considered; cite c-refs/e-refs in evidence_refs. Do not execute final purchase, payment, submission, confirmation, deletion, booking approval, or personal-data sending when the goal says to stop for human review.${feedback ? `\n\nVALIDATION FEEDBACK:\n${feedback}` : ''}`;
  }

  async function replan(observation, reason) {
    const prompt = `You are the Replanner in a browser agent under a deterministic orchestrator. Diagnose a stall without taking a browser action.\n\nORIGINAL GOAL:\n${goal}\n\nCURRENT PAGE:\n${JSON.stringify(observation.page)}\n\nINTERACTIVE CONTROLS:\n${JSON.stringify(observation.controls)}\n\nSEMANTIC CONTENT BLOCKS:\n${JSON.stringify(observation.content)}\n\nRECENT ACTIONS:\n${JSON.stringify(tracker.recentActions)}\n\nSTALL REASON:\n${reason}\n\nReturn continue with a distinct next_subgoal and concrete action descriptions to avoid, goal_impossible only if page evidence proves no suitable path exists, or needs_human for a consequential/ambiguous boundary. A hard control bound that excludes a mandatory constraint, or an exhaustive option group that lacks an exact required option after the page reports no results, is valid impossibility evidence; do not silently substitute a nearest value. When eligibility depends on user-specific details, prefer completing the site's assessment workflow before choosing an alternative route. Ground conclusions in supplied c-refs/e-refs.`;
    const response = await generate('replanner', prompt, replanSchema);
    trajectory.replans_triggered++;
    if (response.value.status === 'continue') {
      activeSubgoal = response.value.next_subgoal;
      avoidActions = [...new Set([...avoidActions, ...response.value.avoid_actions])].slice(-8);
    }
    if (response.value.status === 'goal_impossible') trajectory.impossible_eligibility_decisions++;
    return response;
  }

  let observation = await observePage(page);
  tracker.seed(observation.progress_signature);
  try {
    for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber++) {
      const terminal = terminalResult(await isTerminal({ page, observation }));
      if (terminal.done) { finalStatus = terminal.status; failureReason = terminal.reason; break; }
      let decisionResponse;
      let validationFeedback = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        decisionResponse = await generate('navigator', navigatorPrompt(observation, tracker.recentActions, validationFeedback), actionSchema);
        try { validateAction(decisionResponse.value, observation.controls); break; }
        catch (error) {
          validationFeedback = error.message;
          trajectory.retries++;
          if (attempt === 1) {
            const invalidControl = observation.controls.find(control => control.ref === decisionResponse.value.ref);
            avoidActions = [...new Set([...avoidActions, `${decisionResponse.value.action}|${invalidControl?.role || 'unknown'}|${invalidControl?.name || decisionResponse.value.ref}`])].slice(-8);
            const replanned = await replan(observation, `Navigator action validation failed twice: ${error.message}`);
            trajectory.steps.push({ step: stepNumber, observation_summary: observation.summary, semantic_content_blocks: observation.content,
              model_role: 'navigator', model_response: decisionResponse.value, browser_action: null,
              executor_outcome: { execution_outcome: 'not_executed', action_success: false, execution_error: error.message },
              action_success: false, previous_progress_signature: observation.progress_signature,
              new_progress_signature: observation.progress_signature, semantic_progress: false, cycle_detected: false,
              replan_triggered: true, replan: { model_role: 'replanner', ...replanned }, retries: decisionResponse.retries, latency_ms: decisionResponse.latency_ms + replanned.latency_ms });
            if (replanned.value.status !== 'continue') { finalStatus = replanned.value.status === 'goal_impossible' ? 'impossible' : 'needs_human'; failureReason = replanned.value.diagnosis; }
            decisionResponse = null;
          }
        }
      }
      if (!decisionResponse) {
        if (['impossible','needs_human'].includes(finalStatus)) break;
        continue;
      }
      const decision = decisionResponse.value;
      if (decision.action === 'impossible') {
        const replanned = await replan(observation, `Navigator proposed goal_impossible: ${decision.reason}`);
        const confirmed = replanned.value.status === 'goal_impossible';
        if (confirmed) trajectory.impossible_eligibility_decisions++;
        finalStatus = confirmed ? 'impossible' : replanned.value.status === 'needs_human' ? 'needs_human' : finalStatus;
        failureReason = confirmed || replanned.value.status === 'needs_human' ? replanned.value.diagnosis : failureReason;
        trajectory.steps.push({ step: stepNumber, observation_summary: observation.summary, semantic_content_blocks: observation.content,
          model_role: 'navigator', model_response: decision, browser_action: null,
          executor_outcome: { execution_outcome: 'not_executed', action_success: true }, action_success: true,
          previous_progress_signature: observation.progress_signature, new_progress_signature: observation.progress_signature,
          semantic_progress: false, cycle_detected: false, replan_triggered: true,
          replan: { model_role: 'replanner', response: replanned.value, retries: replanned.retries, latency_ms: replanned.latency_ms },
          retries: decisionResponse.retries, latency_ms: decisionResponse.latency_ms + replanned.latency_ms });
        if (confirmed || replanned.value.status === 'needs_human') break;
        continue;
      }
      const identity = actionIdentity(decision, observation.controls);
      const previousSignature = observation.progress_signature;
      const executor = await executeResilient(page, decision, observation);
      if (!executor.action_success) trajectory.execution_failures++;
      const progress = tracker.record({ actionIdentity: identity, previousSignature, newSignature: executor.post_action_observation.progress_signature, actionSuccess: executor.action_success });
      if (progress.cycleDetected) trajectory.cycles_detected++;
      let replanResponse = null;
      if (progress.replanRequired) {
        avoidActions = [...new Set([...avoidActions, identity])].slice(-8);
        const reason = !executor.action_success ? `Action failed: ${executor.execution_error || 'fresh state did not confirm requested effect'}` :
          progress.cycleDetected ? `Repeated action entered a page-state cycle (${previousSignature} -> ${executor.post_action_observation.progress_signature})` :
          `Action produced no material progress for ${progress.stallCount} attempts`;
        replanResponse = await replan(executor.post_action_observation, reason);
      }
      trajectory.steps.push({
        step: stepNumber, observation_summary: observation.summary, semantic_content_blocks: observation.content,
        model_role: 'navigator', model_response: decision,
        browser_action: { action: decision.action, ref: decision.ref, value: decision.value, identity },
        executor_outcome: { executor_strategy: executor.executor_strategy, dom_detached_during_action: executor.dom_detached_during_action,
          execution_outcome: executor.execution_outcome, execution_error: executor.execution_error,
          post_action_observation: { summary: executor.post_action_observation.summary, controls: executor.post_action_observation.controls, semantic_content_blocks: executor.post_action_observation.content } },
        action_success: executor.action_success, previous_progress_signature: previousSignature,
        new_progress_signature: executor.post_action_observation.progress_signature,
        semantic_progress: progress.semanticProgress, cycle_detected: progress.cycleDetected,
        replan_triggered: Boolean(replanResponse),
        ...(replanResponse ? { replan: { model_role: 'replanner', response: replanResponse.value, retries: replanResponse.retries, latency_ms: replanResponse.latency_ms } } : {}),
        retries: decisionResponse.retries, latency_ms: decisionResponse.latency_ms + executor.latency_ms + (replanResponse?.latency_ms || 0)
      });
      observation = executor.post_action_observation;
      if (replanResponse?.value.status === 'goal_impossible') { finalStatus = 'impossible'; failureReason = replanResponse.value.diagnosis; break; }
      if (replanResponse?.value.status === 'needs_human') { finalStatus = 'needs_human'; failureReason = replanResponse.value.diagnosis; break; }
      const afterTerminal = terminalResult(await isTerminal({ page, observation }));
      if (afterTerminal.done) { finalStatus = afterTerminal.status; failureReason = afterTerminal.reason; break; }
    }
  } catch (error) {
    finalStatus = 'error'; failureReason = error.message; trajectory.error = error.message;
  }
  trajectory.final_status = finalStatus;
  trajectory.failure_reason = failureReason;
  trajectory.final_observation = compactObservation(observation);
  trajectory.finished_at = new Date().toISOString();
  trajectory.total_latency_ms = new Date(trajectory.finished_at) - new Date(trajectory.started_at);
  trajectory.steps_taken = trajectory.steps.length;
  return trajectory;
}

module.exports = { runAgent, observePage, VERSION, PROMPT_VERSION };
