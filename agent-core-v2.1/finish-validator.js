const STOP_WORDS = new Set(['a','an','and','are','as','at','be','before','do','does','for','from','i','in','is','it','me','my','of','on','or','the','to','what','with']);
const normalize = value => String(value || '').toLowerCase().replace(/[’']/g, '').replace(/\bwomens\b/g, 'women').replace(/\bmens\b/g, 'men').replace(/[^a-z0-9£$]+/g, ' ').trim();
const words = value => normalize(value).split(/\s+/).filter(token => token && !STOP_WORDS.has(token));
const singular = value => value.length > 3 && value.endsWith('s') ? value.slice(0, -1) : value;
const comparable = value => new Set(words(value).map(singular));
const overlaps = (left, right) => { const rightTokens = comparable(right); return [...comparable(left)].some(token => rightTokens.has(token)); };

function goalKind(goal) {
  const text = normalize(goal);
  if (/\b(find|search|show|browse|look for|choose|pick)\b/.test(text)) return 'discovery';
  if (/\b(what|how much|cost|fee|requirements?|eligibility|information|tell me|need to know)\b/.test(text)) return 'information';
  return 'workflow';
}

function contradictionEvidence(observation, content) {
  const result = observation.result_state || {}, contradictions = [];
  if (result.result_count === 0) contradictions.push({ source: 'result_state.result_count', evidence: '0 results' });
  if (result.visible_result_summary?.count_observed === 0) contradictions.push({ source: 'result_state.visible_result_summary', evidence: '0 visible results' });
  const failure = /\b(no (?:results?|items?|products?|pieces|matches)|zero results?|unavailable|not available|out of stock|sold out|not eligible|ineligible|validation (?:failed|error)|cannot continue|error|failed)\b/i;
  for (const block of content) {
    const structuralFailure = ['alert','validation','status'].includes(block.type) && /\b(error|invalid|failed|cannot|unable)\b/i.test(block.text || '');
    if (failure.test(block.text || '') || structuralFailure) contradictions.push({ source: block.ref, type: block.type, evidence: block.text });
  }
  return contradictions;
}

function constraintCoverage(goal, controls) {
  const goalText = normalize(goal), goalTokens = comparable(goal), groups = new Map(), coverage = [];
  for (const control of controls) {
    if (!control.group_context || !control.name) continue;
    if (!['checkbox','radio','slider','combobox','listbox','textbox','searchbox','spinbutton'].includes(control.role)) continue;
    const key = normalize(control.group_context);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(control);
  }
  for (const [group, candidates] of groups) {
    const mentioned = candidates.filter(control => {
      const nameTokens = [...comparable(control.name)], valueTokens = [...comparable(control.value)];
      const completeTokenMatch = candidateTokens => candidateTokens.length > 0 && candidateTokens.every(token => goalTokens.has(token));
      return completeTokenMatch(nameTokens) || completeTokenMatch(valueTokens);
    });
    for (const control of [...new Map(mentioned.map(item => [normalize(item.value || item.name), item])).values()]) {
      const supported = Boolean(control.checked || control.selected ||
        (control.role === 'slider' && String(control.value || '') && goalText.includes(String(control.value))) ||
        (control.capabilities?.editable && String(control.value || '').trim() && goalText.includes(normalize(control.value))));
      coverage.push({ constraint: `${group}=${control.value || control.name}`, supported, evidence: supported ? [control.ref] : [], control_ref: control.ref });
    }
  }
  for (const match of String(goal).matchAll(/(?:under|below|up to|maximum|max)\s*(?:£|\$)?\s*(\d+(?:\.\d+)?)/gi)) {
    const amount = match[1];
    if (coverage.some(item => item.constraint.endsWith(`=${amount}`))) continue;
    const control = controls.find(item => ['slider','spinbutton','textbox'].includes(item.role) && String(item.value) === amount);
    coverage.push({ constraint: `numeric_max=${amount}`, supported: Boolean(control), evidence: control ? [control.ref] : [], control_ref: control?.ref || null });
  }
  return coverage;
}

function positiveResultEvidence(observation, content) {
  const result = observation.result_state || {}, evidence = [];
  if (Number.isFinite(result.result_count) && result.result_count > 0) evidence.push('result_state.result_count');
  if ((result.visible_result_summary?.count_observed || 0) > 0 && result.visible_result_summary?.samples?.length) evidence.push('result_state.visible_result_summary');
  const summary = content.find(block => block.type === 'result_summary' && block.count_observed > 0 && block.samples?.length);
  if (summary) evidence.push(summary.ref);
  return evidence;
}

function validateFinish({ goal, proposedFinish, currentObservation = {}, currentControls, currentContent, currentResultState }) {
  const observation = { ...currentObservation, result_state: currentResultState || currentObservation.result_state || {} };
  const controls = currentControls || currentObservation.controls || [], content = currentContent || currentObservation.content || [];
  const reasons = [], missing_evidence = [], contradictions = contradictionEvidence(observation, content);
  const constraint_coverage = constraintCoverage(goal, controls), refs = proposedFinish.evidence_refs || [];
  const cited = refs.map(ref => content.find(block => block.ref === ref)).filter(Boolean);
  const missingRefs = refs.filter(ref => !content.some(block => block.ref === ref));
  if (!refs.length) missing_evidence.push('finish requires current semantic evidence refs');
  if (missingRefs.length) missing_evidence.push(`unknown evidence refs: ${missingRefs.join(', ')}`);
  const inferredKind = goalKind(goal);
  const goal_kind = inferredKind === 'workflow' && constraint_coverage.length >= 2 &&
    controls.some(control => ['checkbox','radio','slider','combobox','listbox'].includes(control.role)) ? 'discovery' : inferredKind;
  const positive_result_evidence = positiveResultEvidence(observation, content);
  if (proposedFinish.status === 'completed') {
    if (contradictions.length) reasons.push('current page contains explicit evidence contradicting completion');
    const unsupported = constraint_coverage.filter(item => !item.supported);
    if (unsupported.length) missing_evidence.push(`unsupported explicit constraints: ${unsupported.map(item => item.constraint).join(', ')}`);
    if (goal_kind === 'discovery' && !positive_result_evidence.length) missing_evidence.push('no positive usable-result evidence');
    if (goal_kind === 'information' && !cited.some(block => overlaps(goal, `${block.text || ''} ${block.context || ''}`)))
      missing_evidence.push('cited content does not address the information requested');
  } else if (proposedFinish.status === 'impossible') {
    const allSupported = constraint_coverage.length > 0 && constraint_coverage.every(item => item.supported);
    const disabledRequired = constraint_coverage.some(item => !item.supported && controls.find(control => control.ref === item.control_ref)?.disabled);
    if (!contradictions.length && !disabledRequired) missing_evidence.push('no current semantic evidence supports impossibility');
    if (contradictions.some(item => /no |zero/i.test(item.evidence)) && !allSupported)
      missing_evidence.push('zero-result evidence was observed before all explicit constraints were supported');
  } else reasons.push('finish status must be completed or impossible');
  const accepted = reasons.length === 0 && missing_evidence.length === 0;
  return { accepted, status: accepted ? proposedFinish.status : 'uncertain', goal_kind, reasons, contradictions,
    missing_evidence, constraint_coverage, positive_result_evidence, cited_evidence: cited.map(block => block.ref) };
}

module.exports = { validateFinish, goalKind, constraintCoverage, contradictionEvidence, positiveResultEvidence };
