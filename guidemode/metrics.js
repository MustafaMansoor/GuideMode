(function initGuideModeMetrics(global) {
  const namespace = global.GuideMode = global.GuideMode || {};

  function visible(node) {
    if (!node?.isConnected || node.hidden || node.closest('[hidden], [aria-hidden="true"]')) return false;
    const target = node.matches('input[type="checkbox"], input[type="radio"]') && !node.getClientRects().length ? node.labels?.[0] : node;
    if (!target) return false;
    const style = getComputedStyle(target);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && target.getClientRects().length > 0;
  }

  function formSnapshot() {
    return [...document.querySelectorAll('input, select, textarea')].map((node, index) => ({
      index, name: node.name || null, id: node.id || null, type: node.type || node.tagName.toLowerCase(),
      value: node.value, checked: 'checked' in node ? node.checked : null, disabled: node.disabled
    }));
  }

  namespace.captureBaseline = function captureBaseline(observation) {
    return {
      interactive: observation.filter(item => item.semantic_hints?.actionable).map(item => ({ ref: item.ref, node: document.querySelector(`[data-focus-ref="${CSS.escape(item.ref)}"]`) })),
      formState: formSnapshot()
    };
  };

  namespace.collectMetrics = function collectMetrics(observation, plan, currentRef) {
    const planByRef = new Map((plan.elements || []).map(item => [item.ref, item]));
    const actionable = observation.filter(item => item.semantic_hints?.actionable);
    const relevant = actionable.filter(item => planByRef.get(item.ref)?.final_classification === 'relevant');
    const protectedItems = actionable.filter(item => ['critical', 'consequential'].includes(planByRef.get(item.ref)?.final_classification));
    const deemphasized = actionable.filter(item => planByRef.get(item.ref)?.final_classification === 'deemphasize');
    return {
      original_visible_interactive_elements: actionable.length,
      relevant_interactive_elements: relevant.length,
      directly_focused_interactive_elements: relevant.length,
      protected_critical_consequential_elements: protectedItems.length,
      deemphasized_interactive_elements: deemphasized.length,
      focus_ratio: actionable.length ? relevant.length / actionable.length : 0,
      interactive_decision_space_reduction: actionable.length ? deemphasized.length / actionable.length : 0,
      current_target_ref: currentRef || null
    };
  };

  namespace.validateApplied = function validateApplied(baseline, observation, plan, currentRef) {
    const failures = [];
    const planByRef = new Map((plan.elements || []).map(item => [item.ref, item]));
    for (const item of baseline.interactive) if (!item.node?.isConnected) failures.push(`missing-interactive:${item.ref}`);
    for (const observed of observation) {
      const node = document.querySelector(`[data-focus-ref="${CSS.escape(observed.ref)}"]`);
      const classification = planByRef.get(observed.ref)?.final_classification;
      if (['critical', 'consequential'].includes(classification) && node?.getAttribute('data-guidemode') === 'deemphasize') failures.push(`unsafe-deemphasis:${observed.ref}`);
      if (classification === 'relevant' && !visible(node)) failures.push(`hidden-relevant:${observed.ref}`);
    }
    if (currentRef) {
      const current = document.querySelector(`[data-focus-ref="${CSS.escape(currentRef)}"]`);
      if (!visible(current)) failures.push(`hidden-current:${currentRef}`);
    }
    return failures;
  };

  namespace.validateOriginalMode = function validateOriginalMode(baseline) {
    const failures = [];
    if (!namespace.instance?.pageStyle.disabled) failures.push('page-style-still-enabled');
    if (document.querySelector('[data-guidemode]:not([data-guidemode-ui])')) failures.push('page-attributes-not-cleared');
    if (JSON.stringify(formSnapshot()) !== JSON.stringify(baseline.formState)) failures.push('form-state-changed');
    return failures;
  };

  namespace.validateReturnedMode = function validateReturnedMode(baseline, observation, plan, currentRef) {
    const failures = namespace.validateApplied(baseline, observation, plan, currentRef);
    if (namespace.instance?.pageStyle.disabled) failures.push('page-style-not-restored');
    if (JSON.stringify(formSnapshot()) !== JSON.stringify(baseline.formState)) failures.push('form-state-changed');
    return failures;
  };

  namespace.auditPanelAccessibility = function auditPanelAccessibility() {
    const shadow = namespace.instance?.panel?.shadow;
    const failures = [];
    if (!shadow) return ['panel-shadow-root-missing'];
    const region = shadow.querySelector('[role="region"][aria-label]');
    if (!region) failures.push('labeled-region-missing');
    function luminance(rgb) {
      const values = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    }
    function contrast(foreground, background) {
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }
    const buttons = [...shadow.querySelectorAll('button')];
    if (!buttons.length) failures.push('button-missing');
    for (const button of buttons) {
      if (!(button.getAttribute('aria-label') || button.textContent.trim())) failures.push('button-name-missing');
      button.focus();
      if (shadow.activeElement !== button) failures.push('button-not-keyboard-focusable');
      const style = getComputedStyle(button);
      if (parseFloat(style.minHeight) < 40) failures.push('button-target-too-small');
      if (contrast(style.color, style.backgroundColor) < 4.5) failures.push('button-contrast-too-low');
    }
    if (!namespace.panelStyles.includes(':focus-visible')) failures.push('visible-focus-style-missing');
    if (!namespace.panelStyles.includes('prefers-reduced-motion')) failures.push('reduced-motion-rule-missing');
    if (shadow.querySelector('[aria-modal="true"]')) failures.push('unexpected-modal-focus-trap');
    return failures;
  };
})(window);
