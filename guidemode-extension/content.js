(() => {
  'use strict';
  if (globalThis.__guideModeContentLoaded) return;
  globalThis.__guideModeContentLoaded = true;

  const MSG = {
    OBSERVE: 'GM_OBSERVE', EXECUTE: 'GM_EXECUTE', APPLY_PLAN: 'GM_APPLY_PLAN',
    CLEAR_PLAN: 'GM_CLEAR_PLAN'
  };
  const ACTIONS = new Set(['click', 'fill', 'check', 'uncheck', 'select', 'scroll', 'focus']);
  let refMap = new Map();
  let currentPlan = null;
  let visualEnabled = false;
  let styleElement = null;
  const touched = new Set();

  const clean = (value, limit = 260) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const isRendered = element => {
    if (!element?.isConnected || element.hidden || element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && element.getClientRects().length > 0;
  };
  const labelIsUsable = element => ['checkbox', 'radio'].includes(element.type) && [...(element.labels || [])].some(isRendered);
  const isSemanticVisible = element => isRendered(element) || labelIsUsable(element);
  const implicitRole = element => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (element.isContentEditable) return 'textbox';
    if (tag !== 'input') return null;
    return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox',
      number: 'spinbutton', submit: 'button', button: 'button', reset: 'button', image: 'button' })[element.type] || 'textbox';
  };
  const labelledByText = element => clean((element.getAttribute('aria-labelledby') || '').split(/\s+/)
    .map(id => document.getElementById(id)?.textContent).filter(Boolean).join(' '));
  const accessibleName = element => {
    const labels = [...(element.labels || [])].map(label => label.getAttribute('aria-label') || label.textContent).join(' ');
    const imageAlt = element.matches('input[type="image"]') ? element.alt : element.querySelector?.('img[alt]')?.alt;
    return clean(element.getAttribute('aria-label') || labelledByText(element) || labels ||
      (['BUTTON', 'A', 'SUMMARY'].includes(element.tagName) ? element.innerText || element.textContent : '') ||
      element.placeholder || imageAlt || element.title || element.value);
  };
  const groupContext = element => {
    const fieldset = element.closest('fieldset');
    if (fieldset) return clean(fieldset.querySelector(':scope > legend')?.textContent || 'fieldset', 180);
    const form = element.closest('form');
    if (form) return clean(form.getAttribute('aria-label') || form.querySelector('h1,h2,h3')?.textContent || 'form', 180);
    const region = element.closest('dialog,[role="dialog"],main,article,section,aside,nav,header,footer');
    return clean(region?.getAttribute('aria-label') || region?.querySelector('h1,h2,h3')?.textContent || region?.tagName?.toLowerCase() || 'document', 180);
  };
  const controlCapabilities = (element, role) => {
    const editableCombobox = role === 'combobox' && element.tagName !== 'SELECT' &&
      !element.readOnly && (element.matches('input:not([type="hidden"])') || element.isContentEditable || element.getAttribute('aria-autocomplete'));
    const actions = [];
    if (['button', 'link'].includes(role)) actions.push('click');
    if (['checkbox', 'radio'].includes(role)) actions.push(element.checked ? 'uncheck' : 'check');
    if (['textbox', 'searchbox', 'spinbutton', 'slider'].includes(role) || editableCombobox) actions.push('fill');
    if (['combobox', 'listbox'].includes(role) && (element.tagName === 'SELECT' || element.querySelector('[role="option"]'))) actions.push('select');
    actions.push('scroll', 'focus');
    return { actions: [...new Set(actions)], editable_combobox: editableCombobox };
  };

  function observe() {
    clearVisualAttributes();
    refMap = new Map();
    const roles = new Set(['button','link','checkbox','radio','slider','textbox','searchbox','spinbutton','combobox','listbox']);
    const nodes = [...new Set(document.querySelectorAll('button,a[href],input,select,textarea,summary,[contenteditable="true"],[role]'))]
      .filter(element => isSemanticVisible(element) && roles.has(element.getAttribute('role') || implicitRole(element)));
    const controls = nodes.slice(0, 240).map((element, index) => {
      const ref = `e${index + 1}`;
      refMap.set(ref, element);
      const role = element.getAttribute('role') || implicitRole(element);
      const options = element instanceof HTMLSelectElement ? [...element.options].slice(0, 80).map(option => ({ value: option.value, label: clean(option.textContent, 120), selected: option.selected, disabled: option.disabled })) : null;
      return {
        ref, tag: element.tagName.toLowerCase(), role, name: accessibleName(element), type: element.type || null,
        value: 'value' in element ? clean(element.value, 180) : null,
        checked: ['checkbox','radio'].includes(element.type) ? element.checked : null,
        selected: element.getAttribute('aria-selected') === 'true' ? true : null,
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        expanded: element.hasAttribute('aria-expanded') ? element.getAttribute('aria-expanded') === 'true' : null,
        href: element.matches('a[href]') ? element.href : null,
        required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
        invalid: element.getAttribute('aria-invalid') === 'true',
        group_context: groupContext(element), options, capabilities: controlCapabilities(element, role)
      };
    });

    const selectors = [
      'main h1','main h2','main h3','main p','main li','main [role="alert"]','main [role="status"]','main [role="note"]',
      'article h1','article h2','article h3','article p','article li','[role="main"] h1','[role="main"] h2','[role="main"] p',
      '[aria-live]','.error','.warning','.validation','[data-price]','.price','.fee'
    ].join(',');
    const seen = new Set();
    const content = [];
    for (const element of document.querySelectorAll(selectors)) {
      if (!isRendered(element) || element.closest('nav,footer,[role="navigation"],[role="contentinfo"]')) continue;
      const text = clean(element.innerText || element.textContent, 420);
      const normalized = text.toLowerCase();
      if (text.length < 3 || seen.has(normalized) || content.length >= 60) continue;
      seen.add(normalized);
      const role = element.getAttribute('role');
      const type = role === 'alert' ? 'alert' : role === 'status' ? 'status' : role === 'note' ? 'note' :
        /^H[1-3]$/.test(element.tagName) ? 'heading' : element.tagName === 'LI' ? 'list_item' :
        /price|fee|cost/i.test(`${element.className} ${text.slice(0, 40)}`) ? 'fee_or_price' :
        /error|warning|validation|invalid/i.test(`${element.className} ${role}`) ? 'validation' : 'paragraph';
      content.push({ ref: `c${content.length + 1}`, type, text, context: groupContext(element) });
    }
    const page = { url: location.href, title: document.title, heading: clean(document.querySelector('main h1,[role="main"] h1,h1')?.textContent || document.title) };
    const signaturePayload = {
      url: page.url, heading: page.heading,
      state: controls.filter(c => c.checked || c.selected || c.expanded !== null || (c.value && ['textbox','searchbox','spinbutton','slider','combobox','listbox'].includes(c.role)))
        .map(c => [c.role,c.name,c.group_context,c.value,c.checked,c.selected,c.expanded]),
      status: content.filter(c => ['heading','alert','status','validation','note','fee_or_price'].includes(c.type)).map(c => `${c.type}:${c.text}`)
    };
    const progress_signature = hash(JSON.stringify(signaturePayload));
    return { page, controls, content, summary: { heading: page.heading, control_count: controls.length, content_count: content.length }, progress_signature };
  }

  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); }
    return (result >>> 0).toString(16).padStart(8, '0');
  }

  const visualCss = `
    [data-guidemode="deemphasize"]{opacity:.58!important;filter:saturate(.72) contrast(.93)!important;transition:opacity .18s ease,filter .18s ease!important}
    [data-guidemode="relevant"]{opacity:1!important;filter:none!important;outline:2px solid #176b52!important;outline-offset:3px!important;border-radius:4px}
    [data-guidemode="current"]{opacity:1!important;filter:none!important;outline:3px solid #075bd8!important;outline-offset:4px!important;box-shadow:0 0 0 7px rgba(7,91,216,.18)!important;border-radius:5px}
    [data-guidemode="consequential"]{opacity:1!important;filter:none!important;outline:2px solid #8b4a08!important;outline-offset:3px!important}
    [data-guidemode="critical"],[data-guidemode="uncertain"],[data-guidemode="preserved"]{opacity:1!important;filter:none!important}
    @media(prefers-reduced-motion:reduce){[data-guidemode]{transition:none!important}}
  `;
  function clearVisualAttributes() {
    for (const node of touched) {
      if (!node?.isConnected) continue;
      node.removeAttribute('data-guidemode'); node.removeAttribute('data-guidemode-current'); node.removeAttribute('data-guidemode-proxy');
    }
    touched.clear();
  }
  function applyVisualPlan(plan, updateCurrent = true) {
    currentPlan = updateCurrent ? plan : currentPlan;
    clearVisualAttributes();
    if (!visualEnabled || !currentPlan) return;
    if (!styleElement) { styleElement = document.createElement('style'); styleElement.id = 'guidemode-extension-styles'; styleElement.textContent = visualCss; (document.head || document.documentElement).append(styleElement); }
    styleElement.disabled = false;
    const uncertain = new Set(currentPlan.uncertain_refs || []);
    for (const item of currentPlan.elements || []) {
      const node = refMap.get(item.ref);
      if (!node?.isConnected) continue;
      let classification = uncertain.has(item.ref) ? 'uncertain' : item.final_classification || item.classification || 'preserved';
      if (currentPlan.current_ref === item.ref) classification = 'current';
      const target = labelIsUsable(node) && !isRendered(node) ? [...node.labels].find(isRendered) || node : node;
      node.setAttribute('data-guidemode', classification); touched.add(node);
      if (target !== node) { target.setAttribute('data-guidemode', classification); target.setAttribute('data-guidemode-proxy', item.ref); touched.add(target); }
      if (classification === 'current') { node.setAttribute('data-guidemode-current', 'true'); target.setAttribute('data-guidemode-current', 'true'); }
    }
  }
  function setVisualMode(enabled) {
    visualEnabled = Boolean(enabled);
    if (!visualEnabled) { clearVisualAttributes(); if (styleElement) styleElement.disabled = true; }
    else if (currentPlan) applyVisualPlan(currentPlan, false);
    return { visual_enabled: visualEnabled };
  }

  function isConsequential(control) {
    const text = `${control?.name || ''} ${control?.group_context || ''}`.toLowerCase();
    return /\b(buy now|add to (cart|bag)|checkout|pay|payment|place order|submit|approve.{0,8}submit|confirm (appointment|booking|order)|book|booking|transfer|delete|send|purchase)\b/.test(text);
  }
  function isSensitive(control, action) {
    const text = `${control?.name || ''} ${control?.type || ''} ${control?.group_context || ''}`.toLowerCase();
    if (control?.type === 'password') return true;
    return action === 'fill' && /\b(password|passcode|otp|one.time|captcha|card number|cvv|security code|national insurance|social security|identity number|passport number|government id|licen[cs]e number|email|phone|telephone|date of birth|full (legal )?name|street address|postcode)\b/.test(text);
  }
  function setNativeValue(element, value) {
    if (element.isContentEditable) { element.textContent = value; }
    else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) throw new Error('Control does not support editable value');
      setter.call(element, value);
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function execute(action) {
    if (!action || !ACTIONS.has(action.action)) return { action_success: false, execution_error: 'Unsupported bounded action' };
    const node = refMap.get(action.ref);
    if (!node?.isConnected) return { action_success: false, execution_error: 'Ref is stale or unknown; re-observation required' };
    const role = node.getAttribute('role') || implicitRole(node);
    const control = { name: accessibleName(node), group_context: groupContext(node), type: node.type || null, role };
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return { action_success: false, execution_error: 'Control is disabled' };
    if (isConsequential(control)) return { action_success: false, paused: true, pause_reason: 'consequential', target_name: control.name };
    if (isSensitive(control, action.action)) return { action_success: false, paused: true, pause_reason: 'sensitive', target_name: control.name };
    let strategy = 'native-dom';
    try {
      if (action.action === 'click') {
        if (!['button', 'link'].includes(role)) throw new Error(`click is incompatible with ${role}`);
        node.click();
      } else if (action.action === 'fill') {
        const editableCombo = role === 'combobox' && node.tagName !== 'SELECT' && !node.readOnly;
        if (!['textbox','searchbox','spinbutton','slider'].includes(role) && !editableCombo && !node.isContentEditable) throw new Error(`fill is incompatible with ${role}`);
        setNativeValue(node, String(action.value ?? ''));
      } else if (action.action === 'check' || action.action === 'uncheck') {
        if (!['checkbox','radio'].includes(role)) throw new Error(`${action.action} is incompatible with ${role}`);
        const desired = action.action === 'check';
        if (role === 'radio' && !desired) throw new Error('A radio cannot be unchecked directly');
        if (node.checked !== desired) {
          if (isRendered(node)) node.click();
          else {
            const label = [...(node.labels || [])].find(isRendered);
            if (!label) throw new Error('Hidden control has no visible associated label');
            strategy = 'associated-label-activation'; label.click();
          }
        }
      } else if (action.action === 'select') {
        if (!(node instanceof HTMLSelectElement)) throw new Error('select requires a native select control');
        if (![...node.options].some(option => option.value === action.value)) throw new Error('Requested option does not exist');
        node.value = action.value; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (action.action === 'scroll') {
        node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      } else if (action.action === 'focus') node.focus({ preventScroll: false });
    } catch (error) { return { action_success: false, execution_error: error.message, executor_strategy: strategy, target_name: control.name }; }
    await new Promise(resolve => setTimeout(resolve, 140));
    const stillConnected = node.isConnected;
    let success = true;
    if (action.action === 'check') success = !stillConnected || node.checked === true;
    if (action.action === 'uncheck') success = !stillConnected || node.checked === false;
    if (action.action === 'fill') success = !stillConnected || ('value' in node ? String(node.value) === String(action.value ?? '') : node.textContent === String(action.value ?? ''));
    if (action.action === 'select') success = !stillConnected || node.value === action.value;
    return { action_success: success, executor_strategy: stillConnected ? strategy : 'rerender-tolerated', dom_detached_during_action: !stillConnected, target_name: control.name };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === MSG.OBSERVE) return { ok: true, observation: observe() };
      if (message.type === MSG.EXECUTE) return { ok: true, result: await execute(message.action) };
      if (message.type === MSG.APPLY_PLAN) { visualEnabled = message.enabled !== false; applyVisualPlan(message.plan); return { ok: true, visual_enabled: visualEnabled }; }
      if (message.type === MSG.CLEAR_PLAN) return { ok: true, ...setVisualMode(false) };
      return { ok: false, error: 'Unknown GuideMode message' };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  // Test-only API; it contains no selectors or privileged behavior and is not used by the agent.
  globalThis.__GuideModeTest = { observe, execute, applyVisualPlan, setVisualMode, isConsequential, isSensitive };
})();
