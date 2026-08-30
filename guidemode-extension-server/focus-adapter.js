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
async function planFocus({ ai, model, goal, observation }) {
  const elements = plannerObservation(observation);
  const generated = await generateModelPlan(ai, model, { goal, page: observation.page, elements });
  return { ...applySafetyOverrides(generated.plan, elements), prompt_version: PROMPT_VERSION, latency_ms: generated.latency_ms };
}
module.exports = { plannerObservation, planFocus };
