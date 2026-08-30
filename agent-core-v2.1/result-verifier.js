const { hash } = require('./observer');

function resultSurface(state) {
  return Boolean(state && (state.result_count != null || state.applied_filter_labels?.length || state.status_text?.length || state.visible_result_summary));
}

function filterLike(action, control) {
  if (!action || !control || !['check','uncheck','fill','select','click'].includes(action.action)) return false;
  const text = `${control.name || ''} ${control.group_context || ''}`;
  return ['check','uncheck','select'].includes(action.action) ||
    /filter|search|sort|price|size|color|category|department|fit|result/i.test(text);
}

function analyzeResultEffect(beforeObservation, afterObservation, action, control, actionSuccess) {
  const before = beforeObservation.result_state || {}, after = afterObservation.result_state || {};
  if (!filterLike(action, control)) return { filter_like_action: false, result_effect_confirmed: 'unknown', reasons: ['Action is not semantically result-affecting'] };
  if (!actionSuccess) return { filter_like_action: true, result_effect_confirmed: false, reasons: ['Browser action was not confirmed'] };
  const evidence = {
    url_changed: before.url !== after.url,
    result_count_changed: before.result_count != null && after.result_count != null && before.result_count !== after.result_count,
    applied_filter_labels_changed: hash(before.applied_filter_labels || []) !== hash(after.applied_filter_labels || []),
    status_text_changed: hash(before.status_text || []) !== hash(after.status_text || []),
    visible_result_summary_changed: hash(before.visible_result_summary || null) !== hash(after.visible_result_summary || null)
  };
  const confirmedSignals = Object.entries(evidence).filter(([, value]) => value).map(([key]) => key);
  if (confirmedSignals.length) return { filter_like_action: true, result_effect_confirmed: true, reasons: confirmedSignals, evidence };
  if (resultSurface(before) || resultSurface(after)) return { filter_like_action: true, result_effect_confirmed: false,
    reasons: ['Control changed but no independent result surface evidence changed'], evidence };
  return { filter_like_action: true, result_effect_confirmed: 'unknown', reasons: ['No generic result surface was available'], evidence };
}

module.exports = { analyzeResultEffect, filterLike, resultSurface };
