(function initGuideModeState(global) {
  const namespace = global.GuideMode = global.GuideMode || {};

  namespace.createState = function createState(config) {
    const listeners = new Set();
    let value = {
      active: true,
      goal: config.goal || '',
      goalSummary: config.plan?.goal_summary || config.goal || '',
      observation: config.observation || [],
      plan: config.plan || { elements: [], uncertain_refs: [] },
      currentAction: config.currentAction || null
    };
    return {
      get: () => value,
      update(patch) {
        value = { ...value, ...patch };
        listeners.forEach(listener => listener(value));
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
  };
})(window);
