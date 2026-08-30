const crypto = require('crypto');

const TERMINAL = new Set(['completed', 'impossible', 'stopped']);

function createRequestSnapshot({ sessionId, generation, observation }) {
  return Object.freeze({
    requestId: crypto.randomUUID(), sessionId, generation,
    observationId: observation.observationId || observation.observation_id,
    controls: Object.freeze([...(observation.controls || [])]),
    routes: Object.freeze([...(observation.routes || [])]),
    forms: Object.freeze([...(observation.forms || [])]), observation
  });
}

function invalidRef(action, snapshot) {
  return { ok: false, code: 'INVALID_REF', ref: action?.ref || null, action: action?.action || null,
    observationId: snapshot?.observationId || null, requestId: snapshot?.requestId || null, recoverable: false };
}

function staleRef(action, snapshot, latestObservationId) {
  return { ok: false, code: 'STALE_REF', ref: action?.ref || null, action: action?.action || null,
    observationId: snapshot?.observationId || null, latestObservationId, requestId: snapshot?.requestId || null, recoverable: true };
}

module.exports = { TERMINAL, createRequestSnapshot, invalidRef, staleRef };
