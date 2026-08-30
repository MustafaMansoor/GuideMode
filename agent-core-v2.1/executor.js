const { observePage } = require('./observer');
const { analyzeResultEffect } = require('./result-verifier');

function validateFinish(action, content) {
  if (action.action !== 'finish') return true;
  if (!['completed','impossible'].includes(action.status)) throw new Error('finish requires completed or impossible status');
  const valid = new Set(content.map(block => block.ref));
  if (!action.evidence_refs?.length) throw new Error('finish requires semantic content evidence_refs');
  const missing = action.evidence_refs.filter(ref => !valid.has(ref));
  if (missing.length) throw new Error(`unsupported finish evidence: ${missing.join(', ')}`);
  if (action.status === 'completed' && !action.answer?.trim()) throw new Error('completed finish requires an answer');
  if (action.status === 'impossible' && !action.reason?.trim()) throw new Error('impossible finish requires a reason');
  return true;
}

function validateAction(action, controls, content = []) {
  if (!action || !['click','check','uncheck','fill','select','finish'].includes(action.action)) throw new Error('unsupported action');
  if (action.action === 'finish') { validateFinish(action, content); return null; }
  const control = controls.find(item => item.ref === action.ref);
  if (!control) throw new Error(`unknown ref ${action.ref}`);
  if (control.disabled) throw new Error(`control ${action.ref} is disabled`);
  if (!control.capabilities?.actions.includes(action.action)) throw new Error(`${action.action} incompatible with ${control.role}${control.capabilities?.editable ? ' (editable)' : ''}`);
  if (['fill','select'].includes(action.action) && typeof action.value !== 'string') throw new Error(`${action.action} requires a string value`);
  if (action.action === 'select' && control.options && !control.options.some(option => option.value === action.value)) throw new Error(`unknown option ${action.value}`);
  return control;
}

function semanticMatch(controls, beforeControl) {
  if (beforeControl.id) {
    const byId = controls.find(item => item.id === beforeControl.id && item.role === beforeControl.role);
    if (byId) return byId;
  }
  return controls.find(item => item.role === beforeControl.role && item.name === beforeControl.name && item.group_context === beforeControl.group_context) ||
    controls.find(item => item.role === beforeControl.role && item.group_context === beforeControl.group_context && item.value === beforeControl.value);
}

async function executeResilient(page, action, beforeObservation) {
  const beforeControl = validateAction(action, beforeObservation.controls, beforeObservation.content);
  const previousUrl = beforeObservation.page.url;
  let executorStrategy = 'playwright-native', executionError = null, domDetachedDuringAction = false, nativeCompleted = false;
  const started = Date.now();
  const locator = page.locator(`[data-agent-v21-ref="${action.ref}"]`);
  try {
    if (action.action === 'click') await locator.click({ timeout: 3000 });
    if (action.action === 'check' || action.action === 'uncheck') {
      const desired = action.action === 'check';
      if (await locator.isVisible()) await locator.setChecked(desired, { timeout: 3000 });
      else {
        executorStrategy = 'associated-label-activation';
        const activated = await locator.evaluate((element, checked) => {
          if (element.checked === checked) return true;
          const label = element.labels?.[0]; if (!label) return false; label.click(); return true;
        }, desired);
        if (!activated) throw new Error('hidden control has no associated label');
      }
    }
    if (action.action === 'fill') await locator.fill(action.value, { timeout: 3000 });
    if (action.action === 'select') await locator.selectOption(action.value, { timeout: 3000 });
    nativeCompleted = true;
  } catch (error) {
    executionError = error.message;
    domDetachedDuringAction = /detached|not attached|resolved to hidden|Timeout/i.test(error.message);
    executorStrategy = 'fresh-observation-reconciliation';
  }
  await page.waitForTimeout(40);
  const postActionObservation = await observePage(page);
  const freshControl = semanticMatch(postActionObservation.controls, beforeControl);
  let actionSuccess = false;
  if (action.action === 'click') actionSuccess = nativeCompleted || previousUrl !== postActionObservation.page.url || beforeObservation.progress_signature !== postActionObservation.progress_signature;
  if (action.action === 'check') actionSuccess = freshControl?.checked === true;
  if (action.action === 'uncheck') actionSuccess = freshControl?.checked === false;
  if (action.action === 'fill' || action.action === 'select') actionSuccess = freshControl?.value === action.value;
  if (actionSuccess && executionError) executorStrategy = 'rerender-tolerated-by-fresh-semantics';
  const resultEffect = analyzeResultEffect(beforeObservation, postActionObservation, action, beforeControl, actionSuccess);
  return { executor_strategy: executorStrategy, dom_detached_during_action: domDetachedDuringAction,
    execution_error: executionError, execution_outcome: actionSuccess ? 'success' : 'failure', action_success: actionSuccess,
    control_state: freshControl ? { ref: freshControl.ref, value: freshControl.value, checked: freshControl.checked, selected: freshControl.selected } : null,
    result_state: postActionObservation.result_state, result_effect_confirmed: resultEffect.result_effect_confirmed,
    result_effect_evidence: resultEffect, latency_ms: Date.now() - started, post_action_observation: postActionObservation };
}

module.exports = { validateAction, validateFinish, executeResilient, semanticMatch };
