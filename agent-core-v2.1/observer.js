const crypto = require('crypto');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

const tokens = value => [...new Set(String(value || '').toLowerCase().match(/[a-z0-9£$]+/g) || [])]
  .filter(token => token.length > 1 || /^[smlx]$/.test(token));

async function observePage(page) {
  const extracted = await page.evaluate(() => {
    document.querySelectorAll('[data-agent-v21-ref]').forEach(node => node.removeAttribute('data-agent-v21-ref'));
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const rendered = element => {
      if (!element?.isConnected || element.hidden || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && element.getClientRects().length > 0;
    };
    const viewport = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    };
    const implicitRole = element => {
      const tag = element.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (element.isContentEditable) return 'textbox';
      if (tag !== 'input') return null;
      return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox',
        number: 'spinbutton', date: 'textbox', email: 'textbox', submit: 'button', button: 'button' })[element.type] || 'textbox';
    };
    const nameOf = element => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy?.split(/\s+/).map(id => clean(document.getElementById(id)?.textContent)).filter(Boolean).join(' ');
      const clone = element.cloneNode(true);
      clone.querySelectorAll?.('[aria-hidden="true"], [hidden]').forEach(node => node.remove());
      return clean(element.getAttribute('aria-label') || labelledText ||
        [...(element.labels || [])].map(label => label.getAttribute('aria-label') || label.title || label.textContent).join(' ') ||
        element.title || element.placeholder || clone.textContent || element.value).slice(0, 220);
    };
    const contextOf = element => {
      const fieldset = element.closest('fieldset');
      if (fieldset) return clean(fieldset.querySelector(':scope > legend')?.textContent) || 'fieldset';
      const form = element.closest('form');
      if (form) return clean(form.getAttribute('aria-label') || form.querySelector('h1,h2,h3')?.textContent || form.closest('section,aside')?.querySelector('h1,h2,h3')?.textContent) || 'form';
      const landmark = element.closest('main, dialog, nav, header, footer, aside, article, section');
      return clean(landmark?.getAttribute('aria-label') || landmark?.querySelector('h1,h2,h3')?.textContent) || landmark?.tagName.toLowerCase() || 'document';
    };
    const capabilitiesOf = (element, role) => {
      const tag = element.tagName.toLowerCase();
      const nativeSelect = tag === 'select';
      const editable = element.isContentEditable || ((tag === 'input' || tag === 'textarea') && !element.readOnly &&
        !['checkbox','radio','button','submit','range'].includes(element.type)) ||
        (role === 'combobox' && element.getAttribute('aria-autocomplete') && element.getAttribute('aria-autocomplete') !== 'none' && !element.hasAttribute('readonly'));
      if (role === 'combobox') return { editable, select_only: nativeSelect || !editable,
        actions: [...new Set(['click', ...(editable ? ['fill'] : []), ...(nativeSelect ? ['select'] : [])])] };
      const map = { button:['click'], link:['click'], checkbox:['check','uncheck'], radio:['check'], slider:['fill'],
        textbox:['fill'], searchbox:['fill'], spinbutton:['fill'], listbox:['select','click'] };
      return { editable: ['textbox','searchbox','spinbutton'].includes(role), select_only: role === 'listbox', actions: map[role] || [] };
    };

    const actionableRoles = new Set(['button','link','checkbox','radio','slider','textbox','searchbox','spinbutton','combobox','listbox']);
    const nodes = [...new Set(document.querySelectorAll('button, a[href], input, select, textarea, [contenteditable="true"], [role]'))];
    const rawControls = nodes.map((element, domIndex) => {
      const role = element.getAttribute('role') || implicitRole(element);
      if (!actionableRoles.has(role)) return null;
      const labelVisible = ['checkbox','radio'].includes(element.type) && [...(element.labels || [])].some(rendered);
      const rect = element.getBoundingClientRect();
      const ariaHidden = Boolean(element.closest('[aria-hidden="true"]'));
      const inert = Boolean(element.closest('[inert]'));
      const attached = element.isConnected;
      const hasBox = rect.width >= 2 && rect.height >= 2;
      const inViewport = viewport(element);
      let obscured = false;
      if (inViewport && hasBox) {
        const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
        const top = document.elementFromPoint(x, y);
        obscured = Boolean(top && top !== element && !element.contains(top) && !top.contains(element));
      }
      const capabilities = capabilitiesOf(element, role);
      return { element, domIndex, id: element.id || null, tag: element.tagName.toLowerCase(), input_type: element.type || null,
        role, name: nameOf(element), group_context: contextOf(element), value: 'value' in element ? element.value : clean(element.textContent),
        checked: ['checkbox','radio'].includes(element.type) ? element.checked : null,
        expanded: element.hasAttribute('aria-expanded') ? element.getAttribute('aria-expanded') === 'true' : null,
        selected: element.getAttribute('aria-selected') === 'true' ? true : null,
        disabled: 'disabled' in element ? element.disabled : element.getAttribute('aria-disabled') === 'true', required: element.required === true,
        invalid: element.getAttribute('aria-invalid') === 'true', readonly: element.readOnly === true || element.getAttribute('aria-readonly') === 'true',
        aria_autocomplete: element.getAttribute('aria-autocomplete'), capabilities,
        options: element instanceof HTMLSelectElement ? [...element.options].map(option => ({ value: option.value, label: clean(option.textContent), selected: option.selected })) : null,
        constraints: 'min' in element ? { min: element.min || null, max: element.max || null } : null,
        geometry: { rendered: rendered(element), label_visible: labelVisible, has_box: hasBox, in_viewport: inViewport,
          aria_hidden: ariaHidden, inert, attached, obscured,
          width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) } };
    }).filter(Boolean);
    rawControls.forEach((control, index) => {
      control.ref = `e${index + 1}`;
      control.element.dataset.agentV21Ref = control.ref;
    });

    const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const groups = new Map();
    for (const control of rawControls) {
      const purposeRole = control.role === 'combobox' ? `combobox:${control.capabilities.editable ? 'editable' : 'select'}` : control.role;
      const key = [purposeRole, normalize(control.name), normalize(control.group_context), normalize(control.value)].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(control);
    }
    const rank = control => {
      const enabled = !control.disabled;
      const visible = control.geometry.rendered || control.geometry.label_visible;
      const hasBox = control.geometry.has_box || control.geometry.label_visible;
      const viewportIntersection = control.geometry.in_viewport;
      const ariaSafe = !control.geometry.aria_hidden;
      const inertSafe = !control.geometry.inert;
      const unobscured = !control.geometry.obscured;
      const attached = control.geometry.attached;
      const score = (enabled ? 128 : 0) + (visible ? 64 : 0) + (hasBox ? 32 : 0) +
        (viewportIntersection ? 16 : 0) + (ariaSafe ? 8 : 0) + (inertSafe ? 4 : 0) +
        (unobscured ? 2 : 0) + (attached ? 1 : 0);
      const rankingReasons = [enabled ? 'enabled/actionable' : 'disabled', visible ? 'rendered or has visible associated label' : 'not rendered',
        hasBox ? 'meaningful bounding box' : 'no meaningful bounding box', viewportIntersection ? 'intersects viewport' : 'outside viewport',
        ariaSafe ? 'not aria-hidden' : 'aria-hidden ancestor', inertSafe ? 'not inert' : 'inert ancestor',
        unobscured ? 'not detectably obscured at center point' : 'obscured at center point', attached ? 'currently attached' : 'detached'];
      return { enabled, visible, has_box: hasBox, viewport_intersection: viewportIntersection,
        aria_hidden: !ariaSafe, inert: !inertSafe, obscured: !unobscured, attached, score, ranking_reasons: rankingReasons };
    };
    const preferred = new Set(); const duplicateGroups = [];
    for (const [key, candidates] of groups) {
      if (candidates.length === 1) {
        const singleRank = rank(candidates[0]);
        if (singleRank.visible && singleRank.attached && !singleRank.aria_hidden && !singleRank.inert) preferred.add(candidates[0]);
        continue;
      }
      const ranked = [...candidates].sort((a, b) => rank(b).score - rank(a).score);
      const firstRank = rank(ranked[0]), secondRank = rank(ranked[1]);
      const firstUniquelyUsable = firstRank.enabled && firstRank.visible && firstRank.has_box && firstRank.viewport_intersection &&
        !firstRank.aria_hidden && !firstRank.inert && !firstRank.obscured && firstRank.attached &&
        !candidates.slice(1).some(candidate => { const item = rank(candidate); return item.enabled && item.visible && item.has_box &&
          item.viewport_intersection && !item.aria_hidden && !item.inert && !item.obscured && item.attached; });
      const decisive = firstUniquelyUsable || firstRank.score - secondRank.score >= 16;
      if (decisive) preferred.add(ranked[0]);
      else candidates.filter(candidate => { const item = rank(candidate); return item.visible && item.attached && !item.aria_hidden && !item.inert; }).forEach(item => preferred.add(item));
      duplicateGroups.push({ key, candidates, preferred: decisive ? ranked[0] : null,
        decision: decisive ? 'preferred' : 'ambiguous',
        reason: decisive ? (firstUniquelyUsable ? 'Only candidate currently enabled, visible, unobscured, and actionable in viewport' : 'Top candidate has a materially stronger deterministic browser-evidence score') :
          'Multiple candidates have equivalent actionable browser evidence; DOM order was not used as a tie-breaker' });
    }
    const selectedControls = rawControls.filter(control => preferred.has(control));
    const controls = selectedControls.map(control => {
      const { element, ...serializable } = control;
      return serializable;
    });
    const duplicateLog = duplicateGroups.map((group, index) => ({ group_id: `d${index + 1}`,
      candidate_refs: group.candidates.map(item => item.ref),
      candidates: group.candidates.map(item => ({ ref: item.ref, role: item.role, name: item.name, group_context: item.group_context,
        value: item.value, ...rank(item) })),
      preferred_ref: group.preferred?.ref || null, decision: group.decision, ranking_reason: group.reason }));

    const boilerplate = element => Boolean(element.closest('nav, footer, header, [role="navigation"]')) || /cookie|newsletter|copyright|privacy/i.test(clean(element.className));
    const contentNodes = [...new Set(document.querySelectorAll('h1,h2,h3,p,li,dt,dd,label,[role="alert"],[role="status"],[role="note"],.error,.warning,.validation,[data-price],.price,.fee'))]
      .filter(element => rendered(element) && !boilerplate(element));
    const seen = new Set(); const content = [];
    for (const element of contentNodes) {
      const text = clean(element.innerText || element.textContent);
      if (text.length < 3 || text.length > 420) continue;
      const normalized = text.toLowerCase();
      if (seen.has(normalized) || [...seen].some(value => value.length > normalized.length && value.includes(normalized))) continue;
      seen.add(normalized);
      const role = element.getAttribute('role');
      const type = role === 'alert' ? 'alert' : role === 'status' ? 'status' : role === 'note' ? 'note' :
        /^H[1-3]$/.test(element.tagName) ? 'heading' : element.tagName === 'LI' ? 'list_item' : element.tagName === 'LABEL' ? 'instruction' :
        /price|fee|cost/i.test(`${element.className} ${text}`) ? 'fee_or_price' : /error|validation/i.test(element.className) ? 'validation' : 'paragraph';
      content.push({ ref: `c${content.length + 1}`, type, text, context: contextOf(element) });
      if (content.length >= 45) break;
    }

    const cardCandidates = [...document.querySelectorAll('article, [class*="product-card"], [class*="product_item"], [class*="product-item"], [class*="result-card"], [class*="search-result"]')]
      .filter(element => rendered(element) && !element.parentElement?.closest('nav,footer'));
    const cardSamples = []; const cardSeen = new Set();
    for (const element of cardCandidates) {
      const title = clean(element.querySelector('h2,h3,h4,a[title],a')?.getAttribute('title') || element.querySelector('h2,h3,h4,a')?.textContent);
      const text = clean(element.innerText || element.textContent);
      const price = text.match(/(?:PKR|£|\$|Rs\.?|₨)\s*[\d,.]+/i)?.[0] || null;
      if (!title || cardSeen.has(title.toLowerCase())) continue;
      cardSeen.add(title.toLowerCase());
      cardSamples.push({ title: title.slice(0, 140), price, metadata: text.replace(title, '').slice(0, 180) });
      if (cardSamples.length >= 6) break;
    }
    if (cardCandidates.length) content.push({ ref: `c${content.length + 1}`, type: 'result_summary', count_observed: cardCandidates.length, samples: cardSamples });

    const bodyText = clean(document.body?.innerText);
    const resultCount = Number(bodyText.match(/(?:filter\s+|\(\s*|showing\s+)(\d+)\s+(?:products?|results?|items?)/i)?.[1]);
    const controlSelectedLabels = controls.filter(control => control.checked || control.selected).map(control => control.name).filter(Boolean);
    const chipLabels = [...document.querySelectorAll('[class*="filter"][class*="active"], [class*="chip"], [class*="tag"][aria-selected="true"]')]
      .filter(rendered).map(element => clean(element.textContent)).filter(text => text && text.length < 100).slice(0, 20);
    const statusText = content.filter(item => ['alert','status','validation'].includes(item.type)).map(item => item.text).slice(0, 8);
    const resultSummary = content.find(item => item.type === 'result_summary') || null;
    const pageHeading = clean(document.querySelector('main h1, h1')?.textContent) || document.title;
    return { controls, content, duplicate_log: duplicateLog,
      counts: { controls_before_deduplication: rawControls.length, controls_after_deduplication: controls.length, content_blocks_before_compaction: content.length },
      page: { url: location.href, title: document.title, heading: pageHeading },
      result_state: { url: location.href, result_count: Number.isFinite(resultCount) ? resultCount : null,
        control_selected_labels: [...new Set(controlSelectedLabels)], applied_filter_labels: [...new Set(chipLabels)], status_text: statusText,
        visible_result_summary: resultSummary ? { count_observed: resultSummary.count_observed, samples: resultSummary.samples } : null } };
  });

  extracted.controls.forEach(control => { delete control.domIndex; });
  const signaturePayload = { url: extracted.page.url, heading: extracted.page.heading,
    selected: extracted.controls.filter(control => control.checked || control.selected || control.expanded !== null ||
      (control.value && control.capabilities?.editable)).map(control => ({ id: control.id, role: control.role, name: control.name,
      group: control.group_context, value: control.value, checked: control.checked, expanded: control.expanded, selected: control.selected })),
    content: extracted.content.filter(item => ['heading','alert','status','validation','note','fee_or_price','result_summary'].includes(item.type)),
    result_state: extracted.result_state };
  return { ...extracted, summary: { heading: extracted.page.heading, control_count: extracted.controls.length,
    raw_control_count: extracted.counts.controls_before_deduplication, content_count: extracted.content.length,
    duplicate_groups: extracted.duplicate_log.length,
    duplicates_suppressed: extracted.duplicate_log.reduce((sum, group) => sum + (group.decision === 'preferred' ? group.candidate_refs.length - 1 : 0), 0),
    editable_comboboxes: extracted.controls.filter(control => control.role === 'combobox' && control.capabilities?.editable).length },
    progress_signature: hash(signaturePayload), signature_payload: signaturePayload };
}

function compactObservation(observation, goal, limits = {}) {
  const maxControls = limits.maxControls || 80, maxContent = limits.maxContent || 36;
  const goalTokens = tokens(goal);
  const overlap = text => { const haystack = String(text || '').toLowerCase(); return goalTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0); };
  const controlScore = control => overlap(`${control.name} ${control.group_context} ${control.value}`) * 20 +
    (control.checked || control.selected ? 35 : 0) + (control.expanded !== null ? 12 : 0) +
    (control.required || control.invalid ? 30 : 0) + (control.disabled ? 8 : 0) +
    (control.geometry?.in_viewport ? 6 : 0) + (control.group_context === 'document' ? -3 : 0);
  const criticalControls = observation.controls.filter(control => control.checked || control.selected || control.required || control.invalid || control.expanded !== null);
  const rankedControls = [...observation.controls].sort((a, b) => controlScore(b) - controlScore(a));
  const controls = [...new Map([...criticalControls, ...rankedControls].map(control => [control.ref, control])).values()].slice(0, maxControls);
  const contentScore = block => overlap(`${block.text || ''} ${block.context || ''} ${JSON.stringify(block.samples || [])}`) * 20 +
    ({ alert:50, validation:50, status:40, note:30, heading:25, fee_or_price:25, result_summary:25, instruction:15 }[block.type] || 0);
  const content = [...observation.content].sort((a, b) => contentScore(b) - contentScore(a)).slice(0, maxContent);
  const before = JSON.stringify({ controls: observation.controls, content: observation.content }).length;
  const after = JSON.stringify({ controls, content }).length;
  return { page: observation.page, controls, content, result_state: observation.result_state,
    compaction: { controls_before: observation.controls.length, controls_after: controls.length,
      content_before: observation.content.length, content_after: content.length,
      estimated_tokens_before: Math.ceil(before / 4), estimated_tokens_after: Math.ceil(after / 4),
      estimated_token_reduction_percentage: before ? (1 - after / before) * 100 : 0 } };
}

function actionIdentity(action, controls) {
  if (!action || ['finish','impossible'].includes(action.action)) return action?.action || 'none';
  const control = controls.find(item => item.ref === action.ref);
  if (!control) return `${action.action}:unknown:${action.ref}`;
  return [action.action, control.role, control.name.toLowerCase(), control.group_context.toLowerCase(), action.value || ''].join('|');
}

module.exports = { observePage, compactObservation, actionIdentity, hash, tokens };
