const crypto = require('crypto');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

async function observePage(page) {
  const extracted = await page.evaluate(() => {
    document.querySelectorAll('[data-agent-v2-ref]').forEach(node => node.removeAttribute('data-agent-v2-ref'));
    const isRendered = element => {
      if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && element.getClientRects().length > 0;
    };
    const isSemanticVisible = element => isRendered(element) ||
      (['checkbox', 'radio'].includes(element.type) && [...(element.labels || [])].some(isRendered));
    const implicitRole = element => {
      const tag = element.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag !== 'input') return null;
      return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox',
        number: 'spinbutton', date: 'textbox', email: 'textbox', submit: 'button' })[element.type] || 'textbox';
    };
    const nameOf = element => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      const visibleText = (() => {
        const clone = element.cloneNode(true);
        clone.querySelectorAll?.('[aria-hidden="true"], [hidden]').forEach(node => node.remove());
        return clone.textContent;
      })();
      return (element.getAttribute('aria-label') || labelledText ||
        [...(element.labels || [])].map(label => label.getAttribute('aria-label') || label.title || label.textContent).join(' ') || element.title ||
        element.placeholder || visibleText || element.value || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    };
    const contextOf = element => {
      const fieldset = element.closest('fieldset');
      if (fieldset) return fieldset.querySelector(':scope > legend')?.textContent.replace(/\s+/g, ' ').trim() || 'fieldset';
      const form = element.closest('form');
      if (form) return form.getAttribute('aria-label') || form.querySelector('h1,h2,h3')?.textContent?.trim() || 'form';
      const landmark = element.closest('main, dialog, nav, header, footer, aside, article, section');
      return landmark?.getAttribute('aria-label') || landmark?.querySelector('h1,h2,h3')?.textContent?.replace(/\s+/g, ' ').trim() || landmark?.tagName.toLowerCase() || 'document';
    };

    const actionableRoles = new Set(['button','link','checkbox','radio','slider','textbox','searchbox','spinbutton','combobox','listbox']);
    const controlNodes = [...new Set(document.querySelectorAll('button, a[href], input, select, textarea, [role]'))]
      .filter(element => isSemanticVisible(element) && actionableRoles.has(element.getAttribute('role') || implicitRole(element)));
    const controls = controlNodes.map((element, index) => {
      const ref = `e${index + 1}`;
      element.dataset.agentV2Ref = ref;
      const role = element.getAttribute('role') || implicitRole(element);
      return {
        ref, id: element.id || null, role, name: nameOf(element), group_context: contextOf(element),
        value: 'value' in element ? element.value : null,
        checked: ['checkbox','radio'].includes(element.type) ? element.checked : null,
        expanded: element.hasAttribute('aria-expanded') ? element.getAttribute('aria-expanded') === 'true' : null,
        selected: element.getAttribute('aria-selected') === 'true' ? true : null,
        disabled: 'disabled' in element ? element.disabled : element.getAttribute('aria-disabled') === 'true',
        required: element.required === true,
        constraints: 'min' in element ? { min: element.min || null, max: element.max || null } : null,
        options: element instanceof HTMLSelectElement ? [...element.options].map(option => ({ value: option.value, label: option.textContent.trim(), selected: option.selected })) : null
      };
    });

    const priority = element => {
      const role = element.getAttribute('role');
      if (role === 'alert' || element.getAttribute('aria-live') === 'assertive') return 0;
      if (role === 'status' || role === 'note' || element.getAttribute('aria-live')) return 1;
      if (/^H[1-3]$/.test(element.tagName)) return 2;
      if (element.matches('.validation, .error, .warning, [aria-invalid="true"]')) return 3;
      if (element.tagName === 'LI') return 5;
      return 4;
    };
    const contentCandidates = [...new Set(document.querySelectorAll('main h1, main h2, main h3, main p, main li, main [role="alert"], main [role="status"], main [role="note"], main .validation, main .error, main .warning, main [data-price], main .price, main .fee'))]
      .filter(element => isRendered(element) && !element.closest('nav, footer'))
      .map(element => ({ element, text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim() }))
      .filter(item => item.text.length >= 3 && item.text.length <= 420)
      .sort((a, b) => priority(a.element) - priority(b.element));
    const seenText = new Set();
    const content = [];
    for (const item of contentCandidates) {
      const normalized = item.text.toLowerCase();
      if (seenText.has(normalized) || [...seenText].some(existing => existing.length > normalized.length && existing.includes(normalized))) continue;
      seenText.add(normalized);
      const element = item.element;
      const role = element.getAttribute('role');
      const type = role === 'alert' ? 'alert' : role === 'status' ? 'status' : role === 'note' ? 'note' :
        /^H[1-3]$/.test(element.tagName) ? 'heading' : element.tagName === 'LI' ? 'list_item' :
        /fee|price|cost/i.test(element.className) ? 'fee_or_price' : /error|validation/i.test(element.className) ? 'validation' : 'paragraph';
      content.push({ ref: `c${content.length + 1}`, type, text: item.text, context: contextOf(element) });
      if (content.length >= 60) break;
    }
    const heading = document.querySelector('main h1, h1')?.textContent?.replace(/\s+/g, ' ').trim() || document.title;
    const alerts = content.filter(item => ['alert','status','validation','note'].includes(item.type)).map(item => item.text);
    return { controls, content, page: { url: location.href, title: document.title, heading }, alerts };
  });

  const signaturePayload = {
    url: extracted.page.url,
    heading: extracted.page.heading,
    selected: extracted.controls.filter(control => control.checked || control.selected || control.expanded !== null || (control.value && ['textbox','searchbox','spinbutton','combobox','listbox','slider'].includes(control.role)))
      .map(control => ({ role: control.role, name: control.name, group: control.group_context, value: control.value, checked: control.checked, expanded: control.expanded, selected: control.selected })),
    content: extracted.content.filter(item => ['heading','alert','status','validation','note','fee_or_price'].includes(item.type)).map(item => `${item.type}:${item.text}`),
    alerts: extracted.alerts
  };
  return { ...extracted, summary: { heading: extracted.page.heading, control_count: extracted.controls.length, content_count: extracted.content.length, alerts: extracted.alerts }, progress_signature: hash(signaturePayload), signature_payload: signaturePayload };
}

function actionIdentity(action, controls) {
  if (!action || action.action === 'impossible') return action?.action || 'none';
  const control = controls.find(item => item.ref === action.ref);
  if (!control) return `${action.action}:unknown:${action.ref}`;
  return [action.action, control.role, control.name.toLowerCase(), control.group_context.toLowerCase(), action.value || ''].join('|');
}

module.exports = { observePage, actionIdentity, hash };
