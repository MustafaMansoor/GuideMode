(() => {
  'use strict';
  if (globalThis.__guideModeContentLoaded) return;
  globalThis.__guideModeContentLoaded = true;

  const MSG = {
    OBSERVE: 'GM_OBSERVE', EXECUTE: 'GM_EXECUTE', APPLY_PLAN: 'GM_APPLY_PLAN',
    CLEAR_PLAN: 'GM_CLEAR_PLAN'
  };
  const ACTIONS = new Set(['click', 'fill', 'check', 'uncheck', 'select', 'scroll', 'focus', 'navigate_route', 'submit_form']);
  let refMap = new Map();
  let routeMap = new Map();
  let formMap = new Map();
  let currentObservationId = null;
  let observationGeneration = 0;
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

  function normalizeRoute(rawHref) {
    const raw = clean(rawHref, 2000);
    if (!raw || raw === '#' || /^(javascript|data|blob|mailto|tel):/i.test(raw)) return null;
    if (raw.startsWith('#') && raw.length > 1) {
      const href = `${location.href.split('#')[0]}${raw}`;
      return { href, pathname: location.pathname || '/', search: location.search || '', hash: raw, same_origin: true };
    }
    try {
      const url = new URL(raw, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.username = ''; url.password = '';
      return { href: url.href, pathname: url.pathname || '/', search: url.search || '', hash: url.hash || '', same_origin: url.origin === location.origin };
    } catch { return null; }
  }

  function activeInteractionRoot() {
    const dialogs = [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"],[aria-modal="true"]')].filter(isRendered);
    return dialogs.at(-1) || document;
  }

  function observe() {
    const observationStarted = performance.now();
    clearVisualAttributes();
    refMap = new Map();
    routeMap = new Map();
    formMap = new Map();
    currentObservationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    observationGeneration++;
    const interactionRoot = activeInteractionRoot();
    const modalScoped = interactionRoot !== document;
    const roles = new Set(['button','link','checkbox','radio','slider','textbox','searchbox','spinbutton','combobox','listbox']);
    const nodes = [...new Set(interactionRoot.querySelectorAll('button,input,select,textarea,summary,[contenteditable="true"],[role]'))]
      .filter(element => isSemanticVisible(element) && roles.has(element.getAttribute('role') || implicitRole(element)))
      .filter(element => !((element.getAttribute('role') || implicitRole(element)) === 'link' && element.hasAttribute('href')));
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

    const routeStarted = performance.now();
    const rawRouteNodes = [...interactionRoot.querySelectorAll('a[href],[role="link"][href]')];
    const deduplicatedRoutes = new Map();
    for (const element of rawRouteNodes) {
      const normalized = normalizeRoute(element.getAttribute('href'));
      if (!normalized) continue;
      const candidate = { text: accessibleName(element), context: groupContext(element), source: 'anchor', ...normalized };
      const key = normalized.href;
      const existing = deduplicatedRoutes.get(key);
      const richness = item => clean(`${item.text} ${item.context}`).length + (item.text ? 80 : 0) - (/footer/i.test(item.context) ? 30 : 0);
      if (!existing || richness(candidate) > richness(existing)) deduplicatedRoutes.set(key, candidate);
    }
    const routes = [...deduplicatedRoutes.values()].slice(0, 160).map((route, index) => {
      const ref = `r${index + 1}`; routeMap.set(ref, route); return { ref, ...route };
    });
    const routeScoutMs = performance.now() - routeStarted;

    const forms = [];
    for (const form of [...interactionRoot.querySelectorAll('form')].filter(isRendered).slice(0, 30)) {
      const method = clean(form.method || 'get').toUpperCase();
      const normalized = normalizeRoute(form.getAttribute('action') || location.href);
      if (!normalized) continue;
      const ref = `f${forms.length + 1}`; formMap.set(ref, form);
      const controlRefs = controls.filter(control => form.contains(refMap.get(control.ref))).map(control => control.ref).slice(0, 30);
      forms.push({ ref, method, action: normalized.href, same_origin: normalized.same_origin,
        purpose: accessibleName(form) || groupContext(form), controls: controlRefs, auto_submittable: method === 'GET' && normalized.same_origin });
    }

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
    return { observationId: currentObservationId, observation_id: currentObservationId, generation: observationGeneration, page, controls, content, routes, forms,
      route_summary: { raw_link_count: rawRouteNodes.length, unique_route_count: routes.length, same_origin_count: routes.filter(route => route.same_origin).length },
      summary: { heading: page.heading, control_count: controls.length, content_count: content.length, route_count: routes.length, form_count: forms.length, modal_scoped: modalScoped }, progress_signature,
      timings: { observation_ms: Math.round((performance.now() - observationStarted) * 10) / 10, route_scout_ms: Math.round(routeScoutMs * 10) / 10 } };
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
    return /\b(start now|buy now|add to (cart|bag)|checkout|pay|payment|place order|submit|approve.{0,8}submit|confirm (appointment|booking|order)|book|booking|transfer|delete|send|purchase)\b/.test(text);
  }
  function routeIsConsequential(route) {
    return /\b(log[ -]?out|sign[ -]?out|delete|remove account|unsubscribe|checkout|payment|purchase|confirm order|close account)\b/i
      .test(`${route?.text || ''} ${route?.pathname || ''} ${route?.context || ''}`);
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
    const executorStarted = performance.now();
    if (!action || !ACTIONS.has(action.action)) return { action_success: false, execution_error: 'Unsupported bounded action' };
    if (!action.observation_id || action.observation_id !== currentObservationId) return { ok: false, action_success: false, code: 'STALE_REF', ref: action.ref,
      action: action.action, observationId: action.observation_id || null, latestObservationId: currentObservationId, recoverable: true,
      execution_failure_type: 'stale_ref', execution_error: 'Ref is from an expired observation' };
    if (action.action === 'navigate_route') {
      const route = routeMap.get(action.ref);
      if (!route) return { ok: false, action_success: false, code: 'INVALID_REF', ref: action.ref, action: action.action, observationId: currentObservationId, recoverable: false, execution_failure_type: 'invalid_ref', execution_error: 'Unknown route ref' };
      if (!route.same_origin) return { action_success: false, paused: true, pause_reason: 'external_route', target_name: route.text };
      if (routeIsConsequential(route)) return { action_success: false, paused: true, pause_reason: 'consequential_route', target_name: route.text };
      const previous_url = location.href; setTimeout(() => location.assign(route.href), 0);
      return { action_success: true, executor_strategy: 'observed-route-navigation', navigation_started: true, route_ref: action.ref,
        previous_url, requested_url: route.href, target_name: route.text };
    }
    if (action.action === 'submit_form') {
      const form = formMap.get(action.ref);
      if (!form?.isConnected) return { ok: false, action_success: false, code: 'STALE_REF', ref: action.ref, action: action.action, observationId: currentObservationId, latestObservationId: currentObservationId, recoverable: true, execution_failure_type: 'stale_ref', execution_error: 'Observed form detached before execution' };
      const method = clean(form.method || 'get').toUpperCase();
      if (method !== 'GET') return { action_success: false, paused: true, pause_reason: 'non_get_form', target_name: accessibleName(form) || groupContext(form) };
      const target = normalizeRoute(form.getAttribute('action') || location.href);
      if (!target?.same_origin) return { action_success: false, paused: true, pause_reason: 'external_form', target_name: accessibleName(form) || groupContext(form) };
      const previous_url = location.href; setTimeout(() => form.requestSubmit(), 0);
      return { action_success: true, executor_strategy: 'native-get-form-submit', navigation_started: true, form_ref: action.ref,
        previous_url, requested_url: target.href, target_name: accessibleName(form) || groupContext(form) };
    }
    const node = refMap.get(action.ref);
    if (!node) return { ok: false, action_success: false, code: 'INVALID_REF', ref: action.ref, action: action.action, observationId: currentObservationId, recoverable: false, execution_failure_type: 'invalid_ref', execution_error: 'Unknown control ref' };
    if (!node.isConnected) return { ok: false, action_success: false, code: 'STALE_REF', ref: action.ref, action: action.action, observationId: currentObservationId, latestObservationId: currentObservationId, recoverable: true, execution_failure_type: 'stale_ref', execution_error: 'Observed control detached before execution' };
    const role = node.getAttribute('role') || implicitRole(node);
    const control = { name: accessibleName(node), group_context: groupContext(node), type: node.type || null, role };
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return { action_success: false, execution_error: 'Control is disabled' };
    if (isConsequential(control)) return { action_success: false, paused: true, pause_reason: 'consequential', target_name: control.name };
    if (isSensitive(control, action.action)) return { action_success: false, paused: true, pause_reason: 'sensitive', target_name: control.name };
    let strategy = 'native-dom';
    try {
      if (action.action === 'click') {
        if (!['button', 'link'].includes(role)) throw new Error(`click is incompatible with ${role}`);
        if (isRendered(node)) {
          const rect = node.getBoundingClientRect(); const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
          const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)); const top = document.elementFromPoint(x, y);
          if (top && top !== node && !node.contains(top) && !top.contains(node)) return { action_success: false, execution_failure_type: 'obstructed',
            execution_error: 'Another element is intercepting this control', executor_strategy: 'topmost-click-check', target_name: control.name };
        }
        const submitForm = node.form && node.matches('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]') ? node.form : null;
        if (submitForm) {
          const method = clean(submitForm.method || 'get').toUpperCase();
          if (method !== 'GET') return { action_success: false, paused: true, pause_reason: 'non_get_form', target_name: control.name };
          const target = normalizeRoute(submitForm.getAttribute('action') || location.href);
          if (!target?.same_origin) return { action_success: false, paused: true, pause_reason: 'external_form', target_name: control.name };
          const previous_url = location.href; setTimeout(() => submitForm.requestSubmit(node), 0);
          return { action_success: true, executor_strategy: 'native-get-form-submitter', navigation_started: true, previous_url,
            requested_url: target.href, target_name: control.name };
        }
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
    const settleStarted = performance.now();
    const fastStateAction = ['fill','check','uncheck','select','focus'].includes(action.action);
    if (!fastStateAction) await new Promise(resolve => {
      let done = false; const finish = () => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); resolve(); };
      const observer = new MutationObserver(finish); observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      const timer = setTimeout(finish, 100);
    });
    const stillConnected = node.isConnected;
    let success = true;
    if (action.action === 'check') success = !stillConnected || node.checked === true;
    if (action.action === 'uncheck') success = !stillConnected || node.checked === false;
    if (action.action === 'fill') success = !stillConnected || ('value' in node ? String(node.value) === String(action.value ?? '') : node.textContent === String(action.value ?? ''));
    if (action.action === 'select') success = !stillConnected || node.value === action.value;
    return { action_success: success, executor_strategy: stillConnected ? strategy : 'rerender-tolerated', dom_detached_during_action: !stillConnected, target_name: control.name,
      executor_ms: Math.round((performance.now() - executorStarted) * 10) / 10, settle_wait_ms: Math.round((performance.now() - settleStarted) * 10) / 10 };
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
  globalThis.__GuideModeTest = { observe, execute, applyVisualPlan, setVisualMode, isConsequential, isSensitive, normalizeRoute, routeIsConsequential };
})();
