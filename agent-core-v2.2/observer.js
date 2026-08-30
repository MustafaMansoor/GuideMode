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
      if (element.isContentEditable) return 'textbox';
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
    const capabilitiesOf = (element, role) => {
      const tag = element.tagName.toLowerCase();
      const nativeSelect = tag === 'select';
      const editable = element.isContentEditable || ((tag === 'input' || tag === 'textarea') && !element.readOnly &&
        !['checkbox','radio','button','submit','range'].includes(element.type)) ||
        (role === 'combobox' && element.getAttribute('aria-autocomplete') && element.getAttribute('aria-autocomplete') !== 'none' && !element.hasAttribute('readonly'));
      if (role === 'combobox') return { editable, select_only: nativeSelect || !editable,
        actions: [...new Set(['click', ...(editable ? ['fill'] : []), ...(nativeSelect ? ['select'] : [])])] };
      const map = { button:['click'],link:['click'],checkbox:['check','uncheck'],radio:['check'],slider:['fill'],
        textbox:['fill'],searchbox:['fill'],spinbutton:['fill'],listbox:['select','click'] };
      return { editable:['textbox','searchbox','spinbutton'].includes(role),select_only:role==='listbox',actions:map[role]||[] };
    };

    const actionableRoles = new Set(['button','link','checkbox','radio','slider','textbox','searchbox','spinbutton','combobox','listbox']);
    const controlNodes = [...new Set(document.querySelectorAll('button, a[href], input, select, textarea, [contenteditable="true"], [role]'))];
    const rawControls = controlNodes.map((element, index) => {
      const role = element.getAttribute('role') || implicitRole(element);
      if (!actionableRoles.has(role)) return null;
      const ref = `e${index + 1}`;
      element.dataset.agentV2Ref = ref;
      const rect=element.getBoundingClientRect();
      const rendered=isRendered(element),labelVisible=['checkbox','radio'].includes(element.type)&&[...(element.labels||[])].some(isRendered);
      const hasBox=rect.width>=2&&rect.height>=2,inViewport=hasBox&&rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth;
      const ariaHidden=Boolean(element.closest('[aria-hidden="true"]')),inert=Boolean(element.closest('[inert]'));
      let obscured=false;
      if(inViewport){const x=Math.max(0,Math.min(innerWidth-1,rect.left+rect.width/2)),y=Math.max(0,Math.min(innerHeight-1,rect.top+rect.height/2));const top=document.elementFromPoint(x,y);obscured=Boolean(top&&top!==element&&!element.contains(top)&&!top.contains(element));}
      return {
        ref, id: element.id || null, tag:element.tagName.toLowerCase(), input_type:element.type || null,
        role, name: nameOf(element), group_context: contextOf(element),
        value: 'value' in element ? element.value : null,
        checked: ['checkbox','radio'].includes(element.type) ? element.checked : null,
        expanded: element.hasAttribute('aria-expanded') ? element.getAttribute('aria-expanded') === 'true' : null,
        selected: element.getAttribute('aria-selected') === 'true' ? true : null,
        disabled: 'disabled' in element ? element.disabled : element.getAttribute('aria-disabled') === 'true',
        required: element.required === true,
        constraints: 'min' in element ? { min: element.min || null, max: element.max || null } : null,
        options: element instanceof HTMLSelectElement ? [...element.options].map(option => ({ value: option.value, label: option.textContent.trim(), selected: option.selected })) : null,
        readonly:element.readOnly===true || element.getAttribute('aria-readonly')==='true', aria_autocomplete:element.getAttribute('aria-autocomplete'),
        capabilities:capabilitiesOf(element,role),
        geometry:{rendered,label_visible:labelVisible,has_box:hasBox,in_viewport:inViewport,aria_hidden:ariaHidden,inert,
          attached:element.isConnected,obscured,width:Math.round(rect.width),height:Math.round(rect.height),top:Math.round(rect.top),left:Math.round(rect.left)}
      };
    }).filter(Boolean);
    const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ');
    const groups=new Map();
    for(const control of rawControls){const purpose=control.role==='combobox'?`combobox:${control.capabilities.editable?'editable':'select'}`:control.role;
      const key=[purpose,normalize(control.name),normalize(control.group_context),normalize(control.value)].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(control);}
    const rank=control=>{const enabled=!control.disabled,visible=control.geometry.rendered||control.geometry.label_visible,hasBox=control.geometry.has_box||control.geometry.label_visible;
      const score=(enabled?128:0)+(visible?64:0)+(hasBox?32:0)+(control.geometry.in_viewport?16:0)+(!control.geometry.aria_hidden?8:0)+(!control.geometry.inert?4:0)+(!control.geometry.obscured?2:0)+(control.geometry.attached?1:0);
      return{enabled,visible,has_box:hasBox,viewport_intersection:control.geometry.in_viewport,aria_hidden:control.geometry.aria_hidden,inert:control.geometry.inert,
        obscured:control.geometry.obscured,attached:control.geometry.attached,score,ranking_reasons:[enabled?'enabled/actionable':'disabled',visible?'rendered or visible label':'not rendered',hasBox?'meaningful bounding box':'no meaningful bounding box',control.geometry.in_viewport?'intersects viewport':'outside viewport',control.geometry.aria_hidden?'aria-hidden ancestor':'not aria-hidden',control.geometry.inert?'inert ancestor':'not inert',control.geometry.obscured?'obscured':'not detectably obscured',control.geometry.attached?'currently attached':'detached']};};
    const preferred=new Set(),duplicateLog=[];
    for(const [key,candidates] of groups){if(candidates.length===1){const item=rank(candidates[0]);if(item.visible&&item.attached&&!item.aria_hidden&&!item.inert)preferred.add(candidates[0]);continue;}
      const ranked=[...candidates].sort((a,b)=>rank(b).score-rank(a).score),first=rank(ranked[0]),second=rank(ranked[1]);
      const uniquelyUsable=first.enabled&&first.visible&&first.has_box&&first.viewport_intersection&&!first.aria_hidden&&!first.inert&&!first.obscured&&first.attached&&
        !candidates.slice(1).some(candidate=>{const item=rank(candidate);return item.enabled&&item.visible&&item.has_box&&item.viewport_intersection&&!item.aria_hidden&&!item.inert&&!item.obscured&&item.attached;});
      const decisive=uniquelyUsable||first.score-second.score>=16;if(decisive)preferred.add(ranked[0]);else candidates.filter(candidate=>{const item=rank(candidate);return item.visible&&item.attached&&!item.aria_hidden&&!item.inert;}).forEach(item=>preferred.add(item));
      duplicateLog.push({group_id:`d${duplicateLog.length+1}`,candidate_refs:candidates.map(item=>item.ref),candidates:candidates.map(item=>({ref:item.ref,role:item.role,name:item.name,group_context:item.group_context,value:item.value,...rank(item)})),preferred_ref:decisive?ranked[0].ref:null,decision:decisive?'preferred':'ambiguous',ranking_reason:decisive?(uniquelyUsable?'Only candidate currently enabled, visible, unobscured, and actionable in viewport':'Top candidate has a materially stronger deterministic browser-evidence score'):'Multiple candidates have equivalent actionable browser evidence; DOM order was not used as a tie-breaker'});}
    const controls=rawControls.filter(control=>preferred.has(control));

    const priority = element => {
      const role = element.getAttribute('role');
      if (role === 'alert' || element.getAttribute('aria-live') === 'assertive') return 0;
      if (role === 'status' || role === 'note' || element.getAttribute('aria-live')) return 1;
      if (/^H[1-3]$/.test(element.tagName)) return 2;
      if (element.matches('.validation, .error, .warning, [aria-invalid="true"]')) return 3;
      if (element.tagName === 'LI') return 5;
      return 4;
    };
    const contentCandidates = [...new Set(document.querySelectorAll('h1,h2,h3,p,li,dt,dd,[role="alert"],[role="status"],[role="note"],.validation,.error,.warning,[data-price],.price,.fee'))]
      .filter(element => isRendered(element) && !element.closest('nav,footer,header,[role="navigation"]') &&
        !/cookie|newsletter|copyright|privacy/i.test(String(element.className)))
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
      if (content.length >= 45) break;
    }
    const cards=[...document.querySelectorAll('article,[class*="product-card"],[class*="product_item"],[class*="product-item"],[class*="result-card"],[class*="search-result"]')]
      .filter(element=>isRendered(element)&&!element.closest('nav,footer,header'));
    const samples=[],sampled=new Set();
    for(const card of cards){const title=(card.querySelector('h2,h3,h4,a[title],a')?.getAttribute('title')||card.querySelector('h2,h3,h4,a')?.textContent||'').replace(/\s+/g,' ').trim();
      const text=(card.innerText||card.textContent||'').replace(/\s+/g,' ').trim(),price=text.match(/(?:PKR|£|\$|Rs\.?|₨)\s*[\d,.]+/i)?.[0]||null;
      if(!title||sampled.has(title.toLowerCase()))continue;sampled.add(title.toLowerCase());samples.push({title:title.slice(0,140),price,metadata:text.replace(title,'').slice(0,180)});if(samples.length>=6)break;}
    if(cards.length)content.push({ref:`c${content.length+1}`,type:'result_summary',count_observed:cards.length,samples});
    const heading = document.querySelector('main h1, h1')?.textContent?.replace(/\s+/g, ' ').trim() || document.title;
    const alerts = content.filter(item => ['alert','status','validation','note'].includes(item.type)).map(item => item.text);
    return { controls, content, duplicate_log:duplicateLog, raw_control_count:rawControls.length,
      page: { url: location.href, title: document.title, heading }, alerts };
  });

  const signaturePayload = {
    url: extracted.page.url,
    heading: extracted.page.heading,
    selected: extracted.controls.filter(control => control.checked || control.selected || control.expanded !== null || (control.value && ['textbox','searchbox','spinbutton','combobox','listbox','slider'].includes(control.role)))
      .map(control => ({ role: control.role, name: control.name, group: control.group_context, value: control.value, checked: control.checked, expanded: control.expanded, selected: control.selected })),
    content: extracted.content.filter(item => ['heading','alert','status','validation','note','fee_or_price','result_summary'].includes(item.type)).map(item => `${item.type}:${item.text||JSON.stringify(item.samples)}`),
    alerts: extracted.alerts
  };
  return { ...extracted, summary: { heading: extracted.page.heading, control_count: extracted.controls.length, raw_control_count:extracted.raw_control_count,
    content_count: extracted.content.length, alerts: extracted.alerts,duplicate_groups:extracted.duplicate_log.length,
    duplicates_suppressed:extracted.duplicate_log.reduce((sum,group)=>sum+(group.decision==='preferred'?group.candidate_refs.length-1:0),0),
    editable_comboboxes:extracted.controls.filter(control=>control.role==='combobox'&&control.capabilities?.editable).length }, progress_signature: hash(signaturePayload), signature_payload: signaturePayload };
}

function actionIdentity(action, controls) {
  if (!action || action.action === 'impossible') return action?.action || 'none';
  const control = controls.find(item => item.ref === action.ref);
  if (!control) return `${action.action}:unknown:${action.ref}`;
  return [action.action, control.role, control.name.toLowerCase(), control.group_context.toLowerCase(), action.value || ''].join('|');
}

module.exports = { observePage, actionIdentity, hash };
