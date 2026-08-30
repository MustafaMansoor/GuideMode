const { GoogleGenAI, Type } = require('@google/genai');
const crypto = require('crypto');
const { observePage, compactObservation, actionIdentity } = require('./observer');
const { executeResilient, validateAction } = require('./executor');
const { ProgressTracker } = require('./progress');
const { validateFinish } = require('./finish-validator');

const VERSION = 'agent-core-v2.1-production-hardening';
const PROMPT_VERSION = 'agent-core-v2.1-navigator-replanner-v1';
const actionSchema = { type: Type.OBJECT, properties: {
  action: { type: Type.STRING, enum: ['click','check','uncheck','fill','select','finish'] },
  ref: { type: Type.STRING, nullable: true }, value: { type: Type.STRING, nullable: true },
  status: { type: Type.STRING, enum: ['completed','impossible'], nullable: true },
  answer: { type: Type.STRING, nullable: true }, reason: { type: Type.STRING, nullable: true },
  evidence_refs: { type: Type.ARRAY, items: { type: Type.STRING } }
}, required: ['action','ref','value','status','answer','reason','evidence_refs'] };
const replanSchema = { type: Type.OBJECT, properties: {
  diagnosis: { type: Type.STRING }, next_subgoal: { type: Type.STRING }, avoid_actions: { type: Type.ARRAY, items: { type: Type.STRING } },
  evidence_refs: { type: Type.ARRAY, items: { type: Type.STRING } },
  status: { type: Type.STRING, enum: ['continue','goal_impossible','needs_human'] }
}, required: ['diagnosis','next_subgoal','avoid_actions','evidence_refs','status'] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function terminalResult(value) {
  if (!value) return { done: false };
  if (value === true) return { done: true, status: 'completed' };
  return { done: Boolean(value.done), status: value.status || 'completed', reason: value.reason || null };
}

async function runAgent(options) {
  const { page, goal, maxSteps = 15, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }), isTerminal = async () => false,
    metadata = {}, requestsPerMinute = 15, requireExplicitFinish = false, compactionLimits = {} } = options;
  if (!page || !goal) throw new Error('runAgent requires page and goal');
  const trajectory = { trajectory_id: crypto.randomUUID(), version: VERSION, prompt_version: PROMPT_VERSION,
    goal, model, started_at: new Date().toISOString(), metadata, steps: [], gemini_calls: 0, navigator_calls: 0,
    replanner_calls: 0, retries: 0, replans_triggered: 0, cycles_detected: 0, stalls_detected: 0,
    execution_failures: 0, unsupported_finish_attempts: 0, impossible_conclusions: 0, human_needed_conclusions: 0,
    result_effect: { confirmed: 0, false: 0, unknown: 0 },
    compaction: { observations: 0, controls_before: 0, controls_after: 0, content_before: 0, content_after: 0,
      estimated_tokens_before: 0, estimated_tokens_after: 0 },
    usage: { prompt_tokens: 0, candidate_tokens: 0, total_tokens: 0, estimated_cost_usd: null } };
  const tracker = new ProgressTracker({ cycleThreshold: 2 });
  let lastCallAt = 0, activeSubgoal = null, avoidActions = [], finalStatus = 'step_limit';
  let failureReason = 'maximum step limit reached', finalResult = null, lastResultEffect = null, consecutiveFinishRejections = 0;

  function compact(observation) {
    const result = compactObservation(observation, goal, compactionLimits); const c = result.compaction;
    trajectory.compaction.observations++; trajectory.compaction.controls_before += c.controls_before;
    trajectory.compaction.controls_after += c.controls_after; trajectory.compaction.content_before += c.content_before;
    trajectory.compaction.content_after += c.content_after; trajectory.compaction.estimated_tokens_before += c.estimated_tokens_before;
    trajectory.compaction.estimated_tokens_after += c.estimated_tokens_after; return result;
  }

  async function generate(role, contents, schema) {
    const errors = [], started = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const interval = Math.ceil(60000 / requestsPerMinute) + 250;
      const pacing = Math.max(0, interval - (Date.now() - lastCallAt)); if (pacing) await delay(pacing);
      lastCallAt = Date.now(); trajectory.gemini_calls++; trajectory[role === 'navigator' ? 'navigator_calls' : 'replanner_calls']++;
      try {
        const response = await ai.models.generateContent({ model, contents, config: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema } });
        const usage = response.usageMetadata || {}; trajectory.usage.prompt_tokens += usage.promptTokenCount || 0;
        trajectory.usage.candidate_tokens += usage.candidatesTokenCount || 0; trajectory.usage.total_tokens += usage.totalTokenCount || 0;
        trajectory.retries += attempt;
        return { value: JSON.parse(response.text), latency_ms: Date.now() - started, retries: attempt, errors };
      } catch (error) {
        errors.push(error.message); const retryable = /429|fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message);
        if (!retryable || attempt === 2) throw error;
        const seconds = error.message.includes('429') ? Number(error.message.match(/retry in ([\d.]+)s/i)?.[1] || 60) : 5;
        await delay(Math.ceil(seconds * 1000) + 1000);
      }
    }
  }

  function navigatorPrompt(modelObservation, recentActions, feedback) {
    return `You are the Navigator in a browser agent. Choose exactly one safe action toward the user's goal.\n\nUSER GOAL:\n${goal}\n${activeSubgoal ? `\nCURRENT SUBGOAL FROM REPLANNER:\n${activeSubgoal}\n` : ''}\nPAGE:\n${JSON.stringify(modelObservation.page)}\n\nINTERACTIVE CONTROLS (capabilities.actions is authoritative):\n${JSON.stringify(modelObservation.controls)}\n\nRELEVANT SEMANTIC CONTENT BLOCKS:\n${JSON.stringify(modelObservation.content)}\n\nCURRENT RESULT EVIDENCE:\n${JSON.stringify(modelObservation.result_state)}\n\nCOMPACTION METRICS:\n${JSON.stringify(modelObservation.compaction)}\n\nRECENT ACTIONS AND PROGRESS:\n${JSON.stringify(recentActions)}\n\nACTIONS TO AVOID:\n${JSON.stringify(avoidActions)}\n\nChoose one action using only a supplied e-ref and only an action listed in that control's capabilities.actions. Editable comboboxes accept fill; native/select-only comboboxes accept select. Use exact native option values. Read eligibility, requirements, fees, warnings, validation, and status content before acting. A checked filter is not proof that results changed: use result evidence and continue or replan when result_effect_confirmed is false or unknown. Use finish completed only when the goal is informational or already fully satisfied by visible c-ref evidence; provide a concise answer. Use finish impossible only when visible evidence proves the exact goal unavailable. Every finish evidence_ref must be a supplied c-ref. Never repeat avoided actions. Do not execute purchase, payment, submission, confirmation, deletion, booking approval, authentication, or personal-data sending.${feedback ? `\n\nVALIDATION FEEDBACK:\n${feedback}` : ''}`;
  }

  async function replan(observation, modelObservation, reason) {
    const prompt = `You are the Replanner in a browser agent under a deterministic orchestrator. Diagnose a stall without taking a browser action.\n\nORIGINAL GOAL:\n${goal}\n\nCURRENT PAGE:\n${JSON.stringify(modelObservation.page)}\n\nINTERACTIVE CONTROLS:\n${JSON.stringify(modelObservation.controls)}\n\nSEMANTIC CONTENT BLOCKS:\n${JSON.stringify(modelObservation.content)}\n\nRESULT EVIDENCE:\n${JSON.stringify(modelObservation.result_state)}\n\nRECENT ACTIONS:\n${JSON.stringify(tracker.recentActions)}\n\nSTALL REASON:\n${reason}\n\nReturn continue with a distinct subgoal, goal_impossible only when current c-ref/e-ref evidence proves no route, or needs_human at a consequential boundary. Respect control capabilities. A control-state change without an independently confirmed result effect is not completion. Ground conclusions in supplied refs.`;
    const response = await generate('replanner', prompt, replanSchema); trajectory.replans_triggered++;
    if (response.value.status === 'continue') { activeSubgoal = response.value.next_subgoal;
      avoidActions = [...new Set([...avoidActions, ...response.value.avoid_actions])].slice(-8); }
    if (response.value.status === 'goal_impossible') trajectory.impossible_conclusions++;
    if (response.value.status === 'needs_human') trajectory.human_needed_conclusions++;
    return response;
  }

  let observation = await observePage(page), modelObservation = compact(observation); tracker.seed(observation.progress_signature);
  try {
    for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber++) {
      if (!requireExplicitFinish) {
        const terminal = terminalResult(await isTerminal({ page, observation, finalResult }));
        if (terminal.done && !(lastResultEffect?.filter_like_action && lastResultEffect.result_effect_confirmed !== true)) {
          finalStatus = terminal.status; failureReason = terminal.reason; break;
        }
      }
      let decisionResponse, validationFeedback = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        decisionResponse = await generate('navigator', navigatorPrompt(modelObservation, tracker.recentActions, validationFeedback), actionSchema);
        try { validateAction(decisionResponse.value, observation.controls, modelObservation.content); break; }
        catch (error) {
          if (decisionResponse.value.action === 'finish') trajectory.unsupported_finish_attempts++;
          validationFeedback = error.message; trajectory.retries++;
          if (attempt === 1) {
            const invalidControl = observation.controls.find(control => control.ref === decisionResponse.value.ref);
            avoidActions = [...new Set([...avoidActions, `${decisionResponse.value.action}|${invalidControl?.role || 'none'}|${invalidControl?.name || decisionResponse.value.ref || 'finish'}`])].slice(-8);
            const replanned = await replan(observation, modelObservation, `Navigator action validation failed twice: ${error.message}`);
            trajectory.steps.push({ step: stepNumber, observation_summary: observation.summary, duplicate_control_groups: observation.duplicate_log,
              compaction: modelObservation.compaction, semantic_content_blocks: modelObservation.content, model_role: 'navigator',
              model_response: decisionResponse.value, browser_action: null,
              executor_outcome: { execution_outcome: 'not_executed', action_success: false, execution_error: error.message },
              action_success: false, result_effect_confirmed: 'unknown', previous_progress_signature: observation.progress_signature,
              new_progress_signature: observation.progress_signature, semantic_progress: false, cycle_detected: false,
              replan_triggered: true, replan: { model_role: 'replanner', response: replanned.value },
              retries: decisionResponse.retries, latency_ms: decisionResponse.latency_ms + replanned.latency_ms });
            trajectory.stalls_detected++;
            if (replanned.value.status !== 'continue') { finalStatus = replanned.value.status === 'goal_impossible' ? 'impossible' : 'needs_human'; failureReason = replanned.value.diagnosis; }
            decisionResponse = null;
          }
        }
      }
      if (!decisionResponse) { if (['impossible','needs_human'].includes(finalStatus)) break; continue; }
      const decision = decisionResponse.value;
      if (decision.action === 'finish') {
        const finishValidation = validateFinish({ goal, proposedFinish: decision, currentObservation: observation,
          currentControls: observation.controls, currentContent: modelObservation.content, currentResultState: observation.result_state });
        if (!finishValidation.accepted) {
          trajectory.unsupported_finish_attempts++; consecutiveFinishRejections++;
          const signature = observation.progress_signature;
          const progress = tracker.record({ actionIdentity: `finish|${decision.status}`, previousSignature: signature, newSignature: signature, actionSuccess: false });
          if (progress.cycleDetected) trajectory.cycles_detected++;
          trajectory.stalls_detected++;
          let replanResponse = null;
          if (consecutiveFinishRejections >= 2 || progress.replanRequired) {
            avoidActions = [...new Set([...avoidActions, `finish|${decision.status}`])].slice(-8);
            replanResponse = await replan(observation, modelObservation,
              `Finish proposal rejected deterministically: ${[...finishValidation.reasons, ...finishValidation.missing_evidence].join('; ')}`);
          }
          trajectory.steps.push({ step: stepNumber, observation_summary: observation.summary, duplicate_control_groups: observation.duplicate_log,
            compaction: modelObservation.compaction, semantic_content_blocks: modelObservation.content, model_role: 'navigator', model_response: decision,
            browser_action: null, executor_outcome: { execution_outcome: 'finish_rejected', action_success: false }, action_success: false,
            result_effect_confirmed: 'unknown', previous_progress_signature: signature, new_progress_signature: signature,
            semantic_progress: false, cycle_detected: progress.cycleDetected, replan_triggered: Boolean(replanResponse),
            finish_proposed: true, finish_accepted: false,
            finish_rejection_reason: [...finishValidation.reasons, ...finishValidation.missing_evidence].join('; '), finish_validation: finishValidation,
            ...(replanResponse ? { replan: { model_role: 'replanner', response: replanResponse.value, retries: replanResponse.retries, latency_ms: replanResponse.latency_ms } } : {}),
            retries: decisionResponse.retries, latency_ms: decisionResponse.latency_ms + (replanResponse?.latency_ms || 0) });
          if (replanResponse?.value.status === 'goal_impossible') { finalStatus = 'impossible'; failureReason = replanResponse.value.diagnosis; break; }
          if (replanResponse?.value.status === 'needs_human') { finalStatus = 'needs_human'; failureReason = replanResponse.value.diagnosis; break; }
          continue;
        }
        consecutiveFinishRejections = 0;
        finalStatus = decision.status; failureReason = decision.status === 'impossible' ? decision.reason : null;
        finalResult = { status: decision.status, answer: decision.answer || null, reason: decision.reason || null, evidence_refs: decision.evidence_refs };
        if (decision.status === 'impossible') trajectory.impossible_conclusions++;
        trajectory.steps.push({ step: stepNumber, observation_summary: observation.summary, duplicate_control_groups: observation.duplicate_log,
          compaction: modelObservation.compaction, semantic_content_blocks: modelObservation.content, model_role: 'navigator',
          model_response: decision, browser_action: null, executor_outcome: { execution_outcome: 'finish', action_success: true },
          action_success: true, result_effect_confirmed: 'unknown', previous_progress_signature: observation.progress_signature,
          new_progress_signature: observation.progress_signature, semantic_progress: false, cycle_detected: false,
          replan_triggered: false, finish_proposed: true, finish_accepted: true, finish_validation: finishValidation,
          retries: decisionResponse.retries, latency_ms: decisionResponse.latency_ms });
        break;
      }
      const identity = actionIdentity(decision, observation.controls), previousSignature = observation.progress_signature;
      const executor = await executeResilient(page, decision, observation);
      if (!executor.action_success) trajectory.execution_failures++;
      trajectory.result_effect[String(executor.result_effect_confirmed)]++;
      let progress = tracker.record({ actionIdentity: identity, previousSignature, newSignature: executor.post_action_observation.progress_signature, actionSuccess: executor.action_success });
      if (executor.result_effect_evidence.filter_like_action && executor.result_effect_confirmed === false) {
        progress = { ...progress, semanticProgress: false, replanRequired: true, resultEvidenceStall: true };
      }
      if (progress.cycleDetected) trajectory.cycles_detected++;
      if (!progress.semanticProgress) trajectory.stalls_detected++;
      let replanResponse = null;
      if (progress.replanRequired) {
        avoidActions = [...new Set([...avoidActions, identity])].slice(-8);
        const reason = !executor.action_success ? `Action failed: ${executor.execution_error || 'fresh state did not confirm requested effect'}` :
          progress.resultEvidenceStall ? `Control changed but user-relevant result effect was not confirmed: ${executor.result_effect_evidence.reasons.join('; ')}` :
          progress.cycleDetected ? `Repeated action entered a page-state cycle` : `Action produced no material progress for ${progress.stallCount} attempts`;
        replanResponse = await replan(executor.post_action_observation, compact(executor.post_action_observation), reason);
      }
      const nextModelObservation = compact(executor.post_action_observation);
      trajectory.steps.push({ step: stepNumber, observation_summary: observation.summary, duplicate_control_groups: observation.duplicate_log,
        compaction: modelObservation.compaction, semantic_content_blocks: modelObservation.content, model_role: 'navigator', model_response: decision,
        browser_action: { action: decision.action, ref: decision.ref, value: decision.value, identity },
        executor_outcome: { executor_strategy: executor.executor_strategy, dom_detached_during_action: executor.dom_detached_during_action,
          execution_outcome: executor.execution_outcome, execution_error: executor.execution_error,
          control_state: executor.control_state, result_state: executor.result_state, result_effect_evidence: executor.result_effect_evidence,
          post_action_observation: { summary: executor.post_action_observation.summary, compaction: nextModelObservation.compaction } },
        action_success: executor.action_success, result_effect_confirmed: executor.result_effect_confirmed,
        previous_progress_signature: previousSignature, new_progress_signature: executor.post_action_observation.progress_signature,
        semantic_progress: progress.semanticProgress, cycle_detected: progress.cycleDetected, replan_triggered: Boolean(replanResponse),
        ...(replanResponse ? { replan: { model_role: 'replanner', response: replanResponse.value, retries: replanResponse.retries, latency_ms: replanResponse.latency_ms } } : {}),
        retries: decisionResponse.retries, latency_ms: decisionResponse.latency_ms + executor.latency_ms + (replanResponse?.latency_ms || 0) });
      observation = executor.post_action_observation; modelObservation = nextModelObservation; lastResultEffect = executor.result_effect_evidence;
      if (replanResponse?.value.status === 'goal_impossible') { finalStatus = 'impossible'; failureReason = replanResponse.value.diagnosis; break; }
      if (replanResponse?.value.status === 'needs_human') { finalStatus = 'needs_human'; failureReason = replanResponse.value.diagnosis; break; }
      const afterTerminal = terminalResult(await isTerminal({ page, observation, finalResult }));
      if (afterTerminal.done && !(executor.result_effect_evidence.filter_like_action && executor.result_effect_confirmed !== true)) {
        finalStatus = afterTerminal.status; failureReason = afterTerminal.reason; break;
      }
    }
  } catch (error) { finalStatus = 'error'; failureReason = error.message; trajectory.error = error.message; }
  trajectory.final_status = finalStatus; trajectory.failure_reason = failureReason; trajectory.final_result = finalResult;
  trajectory.final_observation = { page: observation.page, summary: observation.summary, result_state: observation.result_state,
    controls: modelObservation.controls, semantic_content_blocks: modelObservation.content, compaction: modelObservation.compaction };
  trajectory.finished_at = new Date().toISOString(); trajectory.total_latency_ms = new Date(trajectory.finished_at) - new Date(trajectory.started_at);
  trajectory.steps_taken = trajectory.steps.length; return trajectory;
}

module.exports = { runAgent, observePage, compactObservation, VERSION, PROMPT_VERSION };
