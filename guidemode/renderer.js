(function initGuideModeRenderer(global) {
  const namespace = global.GuideMode = global.GuideMode || {};

  function visualClassification(item, uncertainRefs) {
    if (uncertainRefs.has(item.ref) && !item.override_reason) return 'preserved';
    return item.final_classification || 'preserved';
  }

  namespace.create = function createGuideMode(config) {
    if (namespace.instance) namespace.instance.destroy();
    const state = namespace.createState(config);
    const planByRef = new Map((config.plan?.elements || []).map(item => [item.ref, item]));
    const uncertainRefs = new Set(config.plan?.uncertain_refs || []);
    const sourceNodes = new Map();
    const proxyNodes = new Set();
    const pageStyle = document.createElement('style');
    pageStyle.id = 'guidemode-page-styles';
    pageStyle.textContent = namespace.pageStyles;
    document.head.append(pageStyle);

    for (const observed of config.observation || []) {
      const node = document.querySelector(`[data-focus-ref="${CSS.escape(observed.ref)}"]`);
      if (node) sourceNodes.set(observed.ref, node);
    }

    function clearAttributes() {
      sourceNodes.forEach(node => {
        node.removeAttribute('data-guidemode');
        node.removeAttribute('data-guidemode-current');
      });
      proxyNodes.forEach(node => {
        node.removeAttribute('data-guidemode');
        node.removeAttribute('data-guidemode-proxy-for');
        node.removeAttribute('data-guidemode-current');
      });
      proxyNodes.clear();
    }

    function applyAttributes() {
      clearAttributes();
      const currentRef = state.get().currentAction?.ref || null;
      sourceNodes.forEach((node, ref) => {
        const item = planByRef.get(ref);
        const classification = item ? visualClassification(item, uncertainRefs) : 'preserved';
        const target = node.matches('input[type="checkbox"], input[type="radio"]') && !node.getClientRects().length && node.labels?.[0] ? node.labels[0] : node;
        node.setAttribute('data-guidemode', classification);
        if (target !== node) {
          target.setAttribute('data-guidemode', classification);
          target.setAttribute('data-guidemode-proxy-for', ref);
          proxyNodes.add(target);
        }
        if (currentRef === ref) {
          node.setAttribute('data-guidemode-current', 'true');
          target.setAttribute('data-guidemode', 'current');
          target.setAttribute('data-guidemode-current', 'true');
        }
      });
    }

    function showOriginal() {
      clearAttributes();
      pageStyle.disabled = true;
      state.update({ active: false });
    }
    function returnToGuideMode() {
      pageStyle.disabled = false;
      state.update({ active: true });
      applyAttributes();
    }
    function setCurrentAction(currentAction) {
      state.update({ currentAction: currentAction || null });
      if (state.get().active) applyAttributes();
    }
    const panel = namespace.createPanel(state, { onOriginal: showOriginal, onReturn: returnToGuideMode });
    applyAttributes();

    const instance = {
      state, panel, sourceNodes, pageStyle, showOriginal, returnToGuideMode, setCurrentAction,
      destroy() { clearAttributes(); pageStyle.remove(); panel.destroy(); if (namespace.instance === instance) namespace.instance = null; }
    };
    namespace.instance = instance;
    return instance;
  };
})(window);
