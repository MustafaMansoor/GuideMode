const { generateModelPlan, applySafetyOverrides, PROMPT_VERSION } = require('../focus-planner');

function plannerObservation(observation) {
  const controls = observation.controls.map(control => ({ ref: control.ref, role: control.role, name: control.name,
    state: { value: control.value, checked: control.checked, disabled: control.disabled, required: control.required, invalid: control.invalid },
    group_context: control.group_context, visible_text: null,
    semantic_hints: { actionable: true, input_type: control.type, button_type: control.type, form_associated: control.type === 'submit', tag: control.tag } }));
  const content = observation.content.map(block => ({ ref: block.ref, role: block.type === 'alert' ? 'alert' : block.type === 'status' ? 'status' : 'text',
    name: '', state: {}, group_context: block.context, visible_text: block.text,
    semantic_hints: { actionable: false, aria_live: ['alert','status'].includes(block.type) ? (block.type === 'alert' ? 'assertive' : 'polite') : null, tag: block.type === 'heading' ? 'h2' : 'p' } }));
  return [...controls, ...content];
}
const semanticKey = item => [item.role, item.name, item.group_context, item.visible_text].map(value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
function focusContextKey(goal, observation) {
  const url = new URL(observation.page.url); const structural = (observation.content || [])
    .filter(item => ['heading','alert','status'].includes(item.type)).map(item => `${item.type}:${item.text}`).slice(0, 20);
  return JSON.stringify([goal, url.origin, url.pathname, observation.page.heading, observation.modal_scoped || false, structural]);
}
function reconcileFocusPlan(plan, previousElements, observation) {
  const current = plannerObservation(observation); const byKey = new Map(current.map(item => [semanticKey(item), item.ref]));
  const previousByRef = new Map(previousElements.map(item => [item.ref, semanticKey(item)]));
  const elements = (plan.elements || []).map(item => ({ ...item, ref: byKey.get(previousByRef.get(item.ref)) })).filter(item => item.ref);
  const uncertain_refs = (plan.uncertain_refs || []).map(ref => byKey.get(previousByRef.get(ref))).filter(Boolean);
  return { ...plan, elements, uncertain_refs, cache_hit: true };
}
async function planFocus({ ai, model, goal, observation, nextStep = null }) {
  const elements = plannerObservation(observation);
  const target=(observation.controls||[]).find(item=>item.ref===nextStep?.ref)||(observation.routes||[]).find(item=>item.ref===nextStep?.ref)||(observation.forms||[]).find(item=>item.ref===nextStep?.ref);
  const conditionedGoal=nextStep?`OVERALL USER GOAL: ${goal}\nCURRENT NEXT STEP: ${nextStep.reason||nextStep.action}\nPRIMARY TARGET: ${target?.name||target?.text||target?.purpose||nextStep.ref}. Safely reduce only information unrelated to both the goal and this current step. The primary target is controlled by Navigator.`:goal;
  const generated = await generateModelPlan(ai, model, { goal:conditionedGoal, page: observation.page, elements });
  return { ...applySafetyOverrides(generated.plan, elements), prompt_version: PROMPT_VERSION, latency_ms: generated.latency_ms };
}
module.exports = { plannerObservation, planFocus, focusContextKey, reconcileFocusPlan };
