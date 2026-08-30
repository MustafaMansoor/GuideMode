# GuideMode browser extension

GuideMode is a local-development Chrome/Edge Manifest V3 extension. It observes the current HTTP/HTTPS tab semantically, asks a local Agent Core v2 adapter for one bounded action, executes that action in the tab, and can lower the visual salience of unrelated page elements without removing them.

Route Scout keeps links and GET forms separate from ordinary controls. It normalizes and deduplicates observed routes, sends only strongly matched candidates to the Navigator, and navigates only through fresh opaque route/form refs. It never accepts a model-authored URL or query string.

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

Choose **Guide me** to receive one highlighted, verified next step at a time while you operate the page. Choose **Do it for me** to let the bounded executor perform ordinary safe steps. Without an active goal, GuideMode does not classify, style, scroll, or alter the page.

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
- External, destructive-looking, POST, authentication, and transactional routes/forms pause for human review.
