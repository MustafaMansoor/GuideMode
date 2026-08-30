globalThis.GuideModeConstants = Object.freeze({
  SERVER_ORIGIN: 'http://127.0.0.1:4317',
  MAX_STEPS: 18,
  SETTLE_MS: 140,
  STATUS: Object.freeze({
    READY: 'ready', THINKING: 'thinking', GUIDING: 'guiding', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped',
    COMPLETED: 'completed', IMPOSSIBLE: 'impossible', ERROR: 'error'
  }),
  MODE: Object.freeze({ GUIDE: 'guide', AUTO: 'auto' })
});
