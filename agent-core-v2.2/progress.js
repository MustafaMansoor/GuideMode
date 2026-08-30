class ProgressTracker {
  constructor({ cycleThreshold = 2 } = {}) {
    this.cycleThreshold = cycleThreshold;
    this.signatureHistory = [];
    this.transitionCounts = new Map();
    this.stallCounts = new Map();
    this.recentActions = [];
  }

  seed(signature) { if (!this.signatureHistory.length) this.signatureHistory.push(signature); }

  record({ actionIdentity, previousSignature, newSignature, actionSuccess }) {
    const unchanged = previousSignature === newSignature;
    const signatureSeen = this.signatureHistory.includes(newSignature);
    const transitionKey = `${actionIdentity}|${previousSignature}->${newSignature}`;
    const reverseKey = `${actionIdentity}|${newSignature}->${previousSignature}`;
    const transitionCount = (this.transitionCounts.get(transitionKey) || 0) + 1;
    this.transitionCounts.set(transitionKey, transitionCount);
    const oscillating = previousSignature !== newSignature && signatureSeen && (this.transitionCounts.has(reverseKey) || transitionCount > 1);
    const cycleDetected = oscillating || transitionCount > 1;
    const semanticProgress = Boolean(actionSuccess && !unchanged && !cycleDetected);
    const stallKey = actionIdentity;
    const stallCount = semanticProgress ? 0 : (this.stallCounts.get(stallKey) || 0) + 1;
    this.stallCounts.set(stallKey, stallCount);
    this.signatureHistory.push(newSignature);
    if (this.signatureHistory.length > 12) this.signatureHistory.shift();
    this.recentActions.push({ action_identity: actionIdentity, previous_signature: previousSignature, new_signature: newSignature, action_success: actionSuccess, semantic_progress: semanticProgress, cycle_detected: cycleDetected });
    if (this.recentActions.length > 8) this.recentActions.shift();
    return { semanticProgress, cycleDetected, unchanged, stallCount, replanRequired: !actionSuccess || stallCount >= this.cycleThreshold };
  }
}

module.exports = { ProgressTracker };

