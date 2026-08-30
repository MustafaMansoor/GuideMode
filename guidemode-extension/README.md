# GuideMode browser extension

GuideMode is a local-development Chrome/Edge Manifest V3 extension. It observes the current HTTP/HTTPS tab semantically, asks a local Agent Core v2 adapter for one bounded action, executes that action in the tab, and can lower the visual salience of unrelated page elements without removing them.

## Requirements

- Node.js 20 or newer
- Chrome or Microsoft Edge (Chromium)
- A Gemini API key

## Start the local agent server

From the repository root:

1. Run `npm install`.
2. Copy `.env.example` to `.env` if it does not exist.
3. Set `GEMINI_API_KEY` in `.env`. Never put the key in this extension directory.
4. Run:

   `npm run extension:server`

The server listens only on `http://127.0.0.1:4317` by default. Extension trajectories are written to `guidemode-extension-server/trajectories/`.

## Load unpacked

Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `guidemode-extension` directory.

Edge:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `guidemode-extension` directory.

Open any ordinary HTTP/HTTPS page, select the GuideMode toolbar icon to open the side panel, enter a goal, and choose **Start GuideMode**.

## Controls

- **Stop** immediately cancels the current loop. It does not undo webpage state.
- **Continue** re-observes the same bound tab after a manual/sensitive step.
- **Show original page** removes GuideMode styling while preserving navigation and form state.
- **Return to GuideMode** reapplies the latest plan.
- The visual toggle enables or disables goal-conditioned page styling.

## Known limitations

- The local server and browser must remain running.
- Browser-internal pages, extension stores, PDFs handled by privileged viewers, and pages that prohibit content scripts are unsupported.
- Sessions are bound to one tab and are not transferred to another tab.
- This extension adapter preserves v2's Navigator/Replanner principles but is not the Playwright benchmark runtime.
- It pauses instead of completing authentication, CAPTCHA, personal-data, payment, purchase, submission, or other consequential steps.
- Semantic observation is bounded and may omit unusually complex custom canvas or closed-shadow-DOM interfaces.
