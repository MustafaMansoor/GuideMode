(function initGuideModePanel(global) {
  const namespace = global.GuideMode = global.GuideMode || {};

  function countsFor(state) {
    const actionable = new Map(state.observation.filter(item => item.semantic_hints?.actionable).map(item => [item.ref, item]));
    let relevant = 0;
    let protectedCount = 0;
    for (const item of state.plan.elements || []) {
      if (!actionable.has(item.ref)) continue;
      if (item.final_classification === 'relevant') relevant++;
      if (['critical', 'consequential'].includes(item.final_classification)) protectedCount++;
    }
    return { relevant, protectedCount };
  }

  namespace.createPanel = function createPanel(stateStore, callbacks) {
    const existing = document.querySelector('#guidemode-root');
    if (existing) existing.remove();
    const host = document.createElement('div');
    host.id = 'guidemode-root';
    host.setAttribute('data-guidemode-ui', 'true');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = namespace.panelStyles;
    shadow.append(style);
    const region = document.createElement('section');
    region.className = 'shell';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', 'GuideMode controls');
    shadow.append(region);
    document.documentElement.append(host);

    function render(state) {
      const counts = countsFor(state);
      if (!state.active) {
        region.className = 'shell collapsed';
        region.innerHTML = `<div class="content"><div class="identity"><span class="mark" aria-hidden="true">✦</span><span>Original page</span></div><button type="button" data-action="return" aria-label="Return to GuideMode">Return to GuideMode</button></div>`;
        region.querySelector('[data-action="return"]').addEventListener('click', callbacks.onReturn);
        return;
      }
      region.className = 'shell';
      region.innerHTML = `<div class="content">
        <div class="topline"><div class="identity"><span class="mark" aria-hidden="true">✦</span><span>GuideMode</span></div><span class="status">Active</span></div>
        <div class="section"><p class="label">Your goal</p><p class="value"></p></div>
        ${state.currentAction?.label ? `<div class="section"><p class="label">Current action</p><div class="action"><span class="action-dot" aria-hidden="true"></span><p class="action-value"></p></div></div>` : ''}
        <div class="counts"><span class="chip focused">${counts.relevant} relevant</span><span class="chip">${counts.protectedCount} protected</span></div>
        <button type="button" data-action="original" aria-label="Show original page without GuideMode styling">Show original page</button>
      </div>`;
      region.querySelector('.value').textContent = state.goalSummary;
      const action = region.querySelector('.action-value');
      if (action) action.textContent = state.currentAction.label;
      region.querySelector('[data-action="original"]').addEventListener('click', callbacks.onOriginal);
    }
    render(stateStore.get());
    const unsubscribe = stateStore.subscribe(render);
    return { host, shadow, region, destroy() { unsubscribe(); host.remove(); } };
  };
})(window);
