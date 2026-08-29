const { Type } = require('@google/genai');

const CLASSIFICATIONS = ['relevant', 'critical', 'consequential', 'deemphasize'];
const PROMPT_VERSION = 'focus-planner-v1';

const focusPlanSchema = {
  type: Type.OBJECT,
  properties: {
    goal_summary: { type: Type.STRING },
    elements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ref: { type: Type.STRING },
          classification: { type: Type.STRING, enum: CLASSIFICATIONS },
          reason: { type: Type.STRING }
        },
        required: ['ref', 'classification', 'reason']
      }
    },
    uncertain_refs: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['goal_summary', 'elements', 'uncertain_refs']
};

// Produces compact semantics only. No raw HTML is collected or returned.
async function observeForPlanner(page) {
  return page.locator('button, a, input, select, textarea, [role], #resultCount, .product-price, .product-meta, .empty-state, .modal-error, #newsletterMessage, #shippingText, #subtotal').evaluateAll(nodes => {
    document.querySelectorAll('[data-focus-ref]').forEach(el => el.removeAttribute('data-focus-ref'));
    const unique = [...new Set(nodes)];

    const isRendered = element => {
      if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      return element.getClientRects().length > 0;
    };
    const isSemanticallyVisible = element => isRendered(element) ||
      (['checkbox', 'radio'].includes(element.type) && [...(element.labels || [])].some(isRendered));
    const implicitRole = element => {
      const tag = element.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag !== 'input') return null;
      return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox',
        text: 'textbox', email: 'textbox', number: 'spinbutton', submit: 'button', button: 'button' })[element.type] || 'textbox';
    };
    const nameOf = element => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      return (element.getAttribute('aria-label') || labelledText ||
        [...(element.labels || [])].map(label => label.textContent).join(' ') || element.title ||
        element.placeholder || element.textContent || element.value || '').replace(/\s+/g, ' ').trim();
    };
    const contextOf = element => {
      const fieldset = element.closest('fieldset');
      if (fieldset) return fieldset.querySelector(':scope > legend')?.textContent.replace(/\s+/g, ' ').trim() || 'fieldset';
      const form = element.closest('form');
      if (form) return form.getAttribute('aria-label') || form.closest('footer,section,aside')?.querySelector('h1,h2,h3,h4,strong')?.textContent?.trim() || 'form';
      const landmark = element.closest('dialog, nav, header, footer, aside, article, section');
      return landmark?.getAttribute('aria-label') || landmark?.querySelector('h1,h2,h3,h4')?.textContent?.replace(/\s+/g, ' ').trim() || landmark?.tagName.toLowerCase() || 'document';
    };

    return unique.filter(element => isSemanticallyVisible(element)).map((element, index) => {
      const ref = `e${index + 1}`;
      element.dataset.focusRef = ref;
      const role = element.getAttribute('role') || implicitRole(element) || 'text';
      const checkable = ['checkbox', 'radio'].includes(element.type);
      const actionable = ['button', 'link', 'checkbox', 'radio', 'slider', 'textbox', 'searchbox', 'spinbutton', 'combobox', 'listbox'].includes(role);
      return {
        ref,
        role,
        name: nameOf(element),
        state: {
          value: 'value' in element ? element.value : null,
          checked: checkable ? element.checked : null,
          disabled: 'disabled' in element ? element.disabled : element.getAttribute('aria-disabled') === 'true',
          required: element.required === true,
          invalid: element.getAttribute('aria-invalid') === 'true'
        },
        group_context: contextOf(element),
        visible_text: actionable ? null : (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        semantic_hints: {
          actionable,
          input_type: element instanceof HTMLInputElement ? element.type : null,
          button_type: element instanceof HTMLButtonElement ? element.type : null,
          form_associated: element instanceof HTMLButtonElement ? Boolean(element.form) : false,
          aria_live: element.getAttribute('aria-live'),
          tag: element.tagName.toLowerCase()
        }
      };
    });
  });
}

function compactPlannerInput(goal, observation, pageInfo) {
  return { goal, page: { title: pageInfo.title || null, url: pageInfo.url || null }, elements: observation };
}

async function generateModelPlan(ai, model, plannerInput) {
  const prompt = `You are the decision layer for GuideMode, an attention aid. Classify page elements for the user's current goal.\n\nDefinitions:\n- relevant: directly helps complete the current goal.\n- critical: information that must remain clearly visible, including price, warnings, errors, required information, availability, and current/selected state.\n- consequential: initiates or confirms an important action such as purchase, checkout, payment, submission, booking, deletion, or sending personal information.\n- deemphasize: unrelated to the task and safe to lower in visual priority.\n\nSafety rule: if uncertain whether an element is relevant, critical, or consequential, do not classify it as deemphasize. Put its ref in uncertain_refs and preserve it. Classify every supplied ref exactly once. Do not invent refs.\n\nPlanner input:\n${JSON.stringify(plannerInput)}`;
  const started = Date.now();
  const response = await ai.models.generateContent({ model, contents: prompt, config: {
    temperature: 0, responseMimeType: 'application/json', responseSchema: focusPlanSchema
  } });
  return { plan: JSON.parse(response.text), latency_ms: Date.now() - started };
}

function safetyClassification(element) {
  const text = `${element.name || ''} ${element.visible_text || ''}`.toLowerCase();
  const hints = element.semantic_hints || {};
  const state = element.state || {};
  if (element.role === 'alert' || hints.aria_live === 'assertive' || state.invalid || /\b(error|warning|validation|invalid|required)\b/.test(text)) {
    return { classification: 'critical', reason: 'Semantic alert, validation, warning, or invalid-state evidence must remain visible' };
  }
  if ((hints.button_type === 'submit' && hints.form_associated) || /\b(checkout|purchase|buy|pay|confirm|delete|book|booking|place order|send|subscribe|submit)\b/.test(text)) {
    return { classification: 'consequential', reason: hints.button_type === 'submit' && hints.form_associated ? 'Form-associated submit control initiates a consequential action' : 'Control semantics indicate a consequential action' };
  }
  if (state.required) return { classification: 'critical', reason: 'Required input must remain visible' };
  if (element.role === 'status' || hints.aria_live === 'polite') return { classification: 'critical', reason: 'Live status information must remain visible' };
  return null;
}

function applySafetyOverrides(modelPlan, observation) {
  const validRefs = new Set(observation.map(element => element.ref));
  const uncertain = new Set((modelPlan.uncertain_refs || []).filter(ref => validRefs.has(ref)));
  const byRef = new Map();
  for (const item of modelPlan.elements || []) {
    if (validRefs.has(item.ref) && CLASSIFICATIONS.includes(item.classification) && !byRef.has(item.ref)) byRef.set(item.ref, item);
  }
  const overrides = [];
  const elements = observation.map(element => {
    const modelItem = byRef.get(element.ref);
    const modelClassification = modelItem?.classification || null;
    let finalClassification = modelClassification || 'critical';
    let reason = modelItem?.reason || 'Model omitted this ref; preserved conservatively';
    if (uncertain.has(element.ref)) {
      finalClassification = modelClassification === 'deemphasize' || !modelClassification ? 'critical' : modelClassification;
      reason = `${reason} Preserved because the model marked it uncertain.`;
    }
    const safety = safetyClassification(element);
    let overrideReason = null;
    if (safety && finalClassification !== safety.classification) {
      overrideReason = safety.reason;
      overrides.push({ ref: element.ref, model_classification: modelClassification, final_classification: safety.classification, override_reason: overrideReason });
      finalClassification = safety.classification;
    }
    return { ref: element.ref, model_classification: modelClassification, final_classification: finalClassification,
      reason, ...(overrideReason ? { override_reason: overrideReason } : {}) };
  });
  return { goal_summary: modelPlan.goal_summary, elements, uncertain_refs: [...uncertain], safety_overrides: overrides };
}

module.exports = { CLASSIFICATIONS, PROMPT_VERSION, focusPlanSchema, observeForPlanner,
  compactPlannerInput, generateModelPlan, applySafetyOverrides, safetyClassification };
