(function initGuideModeStyles(global) {
  const namespace = global.GuideMode = global.GuideMode || {};

  namespace.pageStyles = `
    [data-guidemode="deemphasize"] {
      opacity: .58 !important;
      filter: saturate(.72) contrast(.92) !important;
      transition: opacity 180ms ease, filter 180ms ease !important;
    }
    [data-guidemode="relevant"] {
      opacity: 1 !important;
      filter: none !important;
      outline: 2px solid #176b52 !important;
      outline-offset: 3px !important;
      border-radius: 4px;
      transition: outline-color 160ms ease, box-shadow 160ms ease !important;
    }
    [data-guidemode="current"] {
      opacity: 1 !important;
      filter: none !important;
      outline: 3px solid #075bd8 !important;
      outline-offset: 4px !important;
      box-shadow: 0 0 0 7px rgba(7, 91, 216, .18) !important;
      border-radius: 5px;
      transition: outline-color 160ms ease, box-shadow 160ms ease !important;
    }
    [data-guidemode="consequential"] {
      opacity: 1 !important;
      filter: none !important;
      outline: 2px solid #8b4a08 !important;
      outline-offset: 3px !important;
    }
    [data-guidemode="critical"], [data-guidemode="preserved"] {
      opacity: 1 !important;
      filter: none !important;
    }
    @media (prefers-reduced-motion: reduce) {
      [data-guidemode] { transition: none !important; }
    }
  `;

  namespace.panelStyles = `
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; }
    .shell {
      position: fixed; z-index: 2147483647; top: 22px; right: 22px;
      width: min(380px, calc(100vw - 32px));
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17231f; background: #fffdf8; border: 1px solid #b9c8c1;
      border-radius: 18px; box-shadow: 0 18px 55px rgba(24, 44, 36, .20), 0 2px 10px rgba(24, 44, 36, .10);
      overflow: hidden; transform-origin: top right;
      animation: gm-enter 180ms cubic-bezier(.2,.8,.2,1) both;
    }
    .shell.collapsed { width: auto; border-radius: 999px; }
    .content { padding: 20px; }
    .collapsed .content { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 19px; }
    .identity { display: flex; align-items: center; gap: 10px; font-size: 17px; line-height: 1.2; font-weight: 760; letter-spacing: -.01em; }
    .mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: white; background: #176b52; font-size: 17px; }
    .status { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 720; color: #195d49; }
    .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #1c835f; }
    .section + .section { margin-top: 16px; }
    .label { margin: 0 0 5px; color: #52615c; font-size: 14px; line-height: 1.3; font-weight: 700; letter-spacing: .02em; }
    .value { margin: 0; font-size: 18px; line-height: 1.38; font-weight: 720; letter-spacing: -.015em; }
    .action { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid #c8d8d1; border-radius: 12px; background: #f1f7f4; }
    .action-dot { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 6px; border-radius: 50%; background: #075bd8; box-shadow: 0 0 0 4px rgba(7,91,216,.13); }
    .action p { margin: 0; font-size: 16px; line-height: 1.4; font-weight: 680; }
    .counts { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
    .chip { padding: 7px 10px; border-radius: 999px; font-size: 13px; line-height: 1; font-weight: 720; background: #edf1ef; color: #31413b; }
    .chip.focused { background: #e1f2eb; color: #135b45; }
    button { appearance: none; width: 100%; min-height: 46px; border: 2px solid #17231f; border-radius: 12px; padding: 10px 16px; color: #fff; background: #17231f; font: inherit; font-size: 16px; line-height: 1.25; font-weight: 760; cursor: pointer; }
    button:hover { background: #2a3934; }
    button:focus-visible { outline: 3px solid #0a67e8; outline-offset: 3px; }
    .collapsed .identity { white-space: nowrap; font-size: 15px; }
    .collapsed button { width: auto; min-height: 40px; border-width: 1px; border-color: #176b52; border-radius: 999px; padding: 8px 14px; background: #176b52; }
    @keyframes gm-enter { from { opacity: 0; transform: translateY(-8px) scale(.985); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .shell { animation: none; } }
    @media (max-width: 600px) { .shell { top: 12px; right: 12px; width: calc(100vw - 24px); } }
  `;
})(window);
