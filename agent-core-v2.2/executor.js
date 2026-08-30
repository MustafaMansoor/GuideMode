const { observePage } = require('./observer');

const COMPATIBLE = {
  click: ['button','link'], check: ['checkbox','radio'], uncheck: ['checkbox'],
  fill: ['textbox','searchbox','spinbutton','slider'], select: ['combobox','listbox']
};

function validateAction(action, controls) {
  if (!action || !['click','check','uncheck','fill','select','impossible'].includes(action.action)) throw new Error('unsupported action');
  if (action.action === 'impossible') return null;
  const control = controls.find(item => item.ref === action.ref);
  if (!control) throw new Error(`unknown ref ${action.ref}`);
  if (control.disabled) throw new Error(`control ${action.ref} is disabled`);
  const compatible = control.capabilities?.actions || Object.entries(COMPATIBLE).filter(([,roles])=>roles.includes(control.role)).map(([name])=>name);
  if (!compatible.includes(action.action)) throw new Error(`${action.action} incompatible with ${control.role}`);
  if (['fill','select'].includes(action.action) && typeof action.value !== 'string') throw new Error(`${action.action} requires a string value`);
  if (action.action === 'select' && !control.options?.some(option => option.value === action.value)) throw new Error(`unknown option ${action.value}`);
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
  const beforeControl = validateAction(action, beforeObservation.controls);
  const previousUrl = beforeObservation.page.url;
  let executorStrategy = 'playwright-native';
  let executionError = null;
  let domDetachedDuringAction = false;
  let nativeCompleted = false;
  const started = Date.now();
  if (action.action !== 'impossible') {
    const locator = page.locator(`[data-agent-v2-ref="${action.ref}"]`);
    try {
      if (action.action === 'click') await locator.click({ timeout: 3000 });
      if (action.action === 'check' || action.action === 'uncheck') {
        const desired = action.action === 'check';
        if (await locator.isVisible()) {
          await locator.setChecked(desired, { timeout: 3000 });
        } else {
          executorStrategy = 'associated-label-activation';
          const activated = await locator.evaluate((element, checked) => {
            if (element.checked === checked) return true;
            const label = element.labels?.[0];
            if (!label) return false;
            label.click();
            return true;
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
  }
  await page.waitForTimeout(25);
  const postActionObservation = await observePage(page);
  const freshControl = beforeControl ? semanticMatch(postActionObservation.controls, beforeControl) : null;
  let actionSuccess = false;
  if (action.action === 'click') actionSuccess = nativeCompleted || previousUrl !== postActionObservation.page.url || beforeObservation.progress_signature !== postActionObservation.progress_signature;
  if (action.action === 'check') actionSuccess = freshControl?.checked === true;
  if (action.action === 'uncheck') actionSuccess = freshControl?.checked === false;
  if (action.action === 'fill' || action.action === 'select') actionSuccess = freshControl?.value === action.value;
  if (actionSuccess && executionError) executorStrategy = 'rerender-tolerated-by-fresh-semantics';
  return {
    executor_strategy: executorStrategy,
    dom_detached_during_action: domDetachedDuringAction,
    execution_error: executionError,
    execution_outcome: actionSuccess ? 'success' : 'failure',
    action_success: actionSuccess,
    latency_ms: Date.now() - started,
    post_action_observation: postActionObservation
  };
}

module.exports = { validateAction, executeResilient };
