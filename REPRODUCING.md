# Reproducing GuideMode

Primary results use controlled local Threadly and CivicPortal pages. Production websites are optional and mutable.

## Requirements

- Windows, macOS, or Linux with Node.js 20+ and Chromium.
- Submission environment: Node `20.11.0`, npm `10.2.4`.
- Locked packages: `@google/genai` `1.52.0`, `dotenv` `17.4.2`, Playwright `1.62.1`.
- Chrome/Edge Chromium for the extension and Gemini API access/quota.

## Clean setup

```powershell
git clone https://github.com/MustafaMansoor/GuideMode.git
cd GuideMode
npm ci
npx playwright install chromium
Copy-Item .env.example .env
```

Set `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash-lite` in `.env`. The definitive artifacts used that model; availability/output can vary. `.env` is ignored.

## Exact commands

| Purpose | Command | Gemini | Expected output |
|---|---|---:|---|
| v2 deterministic | `npm run agent:v2:test` | No | passing assertions |
| extension deterministic | `npm run extension:test` | No | passing suites |
| Fair Baseline, 10 tasks | `npm run baseline:fair:evaluate` | Yes | new JSON in `trajectories/`; frozen 3/10 |
| Final v2 Threadly + Civic | `npm run agent:v2:evaluate` | Yes | three new JSON files; frozen 10/10 and 5/6 |
| Focus Planner | `npm run focus:evaluate` | Yes | JSON; frozen 12/12 recall |
| GuideMode Visual | `npm run guidemode:visual:evaluate` | Yes | JSON/screenshots |
| v1 Civic history | `npm run civic:evaluate` | Yes | v1 JSON/screenshots; frozen 4/6 |
| Extension server | `npm run extension:server` | When used | `127.0.0.1:4317` |

Threadly is `index.html`; CivicPortal is `civic-portal/index.html`. Harnesses open both with `file://`, so no site server is needed.

The Fair Baseline and Agent Core v2 commands deliberately return a non-zero process exit when any evaluated task fails. Therefore the frozen Fair Baseline run exits non-zero at 3/10, and the combined v2 command exits non-zero at 10/10 Threadly plus 5/6 CivicPortal. This is expected: inspect the timestamped JSON files, which are written before exit, rather than interpreting that exit code as a setup crash.

To run one complete domain only:

```powershell
$env:AGENT_V2_BENCHMARK='threadly' # or civic
npm run agent:v2:evaluate
Remove-Item Env:AGENT_V2_BENCHMARK
```

## Extension install/use

Run `npm run extension:server`, open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select `guidemode-extension/`. Open a normal HTTP/HTTPS page, open the toolbar side panel, select Guide Me or Do It For Me, and enter a goal. The API key stays in the local server, not the extension.

## Runtime, outputs, and cost

Frozen v2 averaged 18.24 s/task Threadly and 51.65 s/task CivicPortal—about 492 s total recorded task latency for 16 tasks, excluding setup. Fair Baseline averaged 31.25 s/task. Runtime varies with quota/network/service.

Frozen v2 used 181,468 input + 3,237 output tokens on Threadly and 156,413 + 6,116 on CivicPortal. Monetary cost was not measured; use current Gemini pricing/account terms. Commands create timestamped artifacts and do not overwrite frozen evidence. Gemini is stochastic; do not expect byte-identical trajectories.

No private data is needed. Synthetic identities are fictional. Do not log in, purchase, submit, pay, enter personal data, or bypass CAPTCHA in optional public-site tests.
