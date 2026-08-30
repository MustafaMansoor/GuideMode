globalThis.GuideModeConstants = Object.freeze({
  SERVER_ORIGIN: 'http://127.0.0.1:4317',
  MAX_STEPS: 18,
  SETTLE_MS: 140,
  STATUS: Object.freeze({
    READY: 'ready', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped',
    COMPLETED: 'completed', IMPOSSIBLE: 'impossible', ERROR: 'error'
  })
});
