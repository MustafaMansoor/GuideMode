# Reproducing GuideMode

Primary results use controlled local Threadly and CivicPortal pages. Production websites are optional and mutable.

## Requirements

- Windows, macOS, or Linux with Node.js 20+ and Chromium.
- Submission environment: Node `20.11.0`, npm `10.2.4`.
- Locked packages: `@google/genai` `1.52.0`, `dotenv` `17.4.2`, Playwright `1.62.1`.
- Chrome/Edge Chromium for the extension and Gemini API access/quota.

## Clean setup

```text
git clone https://github.com/MustafaMansoor/GuideMode.git
cd GuideMode
npm ci
npx playwright install chromium
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```sh
cp .env.example .env
```

`GEMINI_API_KEY` is **required** for Gemini-backed evaluations and the extension server. `GEMINI_MODEL` is optional; the checked-in example and canonical submission runs use `gemini-3.5-flash-lite`. `.env` is ignored. If the key is missing, the server exits immediately with an actionable setup message rather than a later Gemini error.

## Exact commands

| Purpose | Command | Gemini | Expected output |
|---|---|---:|---|
| v2 deterministic | `npm run agent:v2:test` | No | passing assertions |
| extension deterministic | `npm run extension:test` | No | passing suites |
| Fair Baseline, 10 tasks | `npm run baseline:fair:evaluate` | Yes | new JSON in `trajectories/`; canonical 1/10 |
| Final v2 Threadly + Civic | `npm run agent:v2:evaluate` | Yes | three new JSON files; canonical 10/10 and 5/6 |
| Focus Planner | `npm run focus:evaluate` | Yes | JSON; frozen 12/12 recall |
| GuideMode Visual | `npm run guidemode:visual:evaluate` | Yes | JSON/screenshots |
| v1 Civic history | `npm run civic:evaluate` | Yes | v1 JSON/screenshots; frozen 4/6 |
| Extension server | `npm run extension:server` | When used | `127.0.0.1:4317` |

Threadly is `index.html`; CivicPortal is `civic-portal/index.html`. Harnesses open both with `file://`, so no site server is needed.

The Fair Baseline and Agent Core v2 commands deliberately return a non-zero process exit when any evaluated task fails. Therefore the canonical Fair Baseline run exits non-zero at 1/10, and the combined v2 command exits non-zero at 10/10 Threadly plus 5/6 CivicPortal. This is expected: inspect the timestamped JSON files, which are written before exit, rather than interpreting that exit code as a setup crash.

To run one complete domain only:

```powershell
$env:AGENT_V2_BENCHMARK='threadly' # or civic
npm run agent:v2:evaluate
Remove-Item Env:AGENT_V2_BENCHMARK
```

macOS/Linux:

```sh
AGENT_V2_BENCHMARK=threadly npm run agent:v2:evaluate
AGENT_V2_BENCHMARK=civic npm run agent:v2:evaluate
```

## Extension install/use

Run `npm run extension:server`, open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select `guidemode-extension/`. Open a normal HTTP/HTTPS page, open the toolbar side panel, select Guide Me or Do It For Me, and enter a goal. The API key stays in the local server, not the extension. **No extension build step is required.**

## Runtime, outputs, and cost

The fresh canonical runs averaged 37.56 s/task for Fair Baseline, 13.58 s/task for v2 Threadly, and 37.71 s/task for v2 CivicPortal—about 7.9 minutes of recorded task latency across all 26 cases, excluding setup. Runtime varies with quota/network/service.

Canonical v2 used 181,461 input + 3,105 output tokens on Threadly and 149,140 + 5,527 on CivicPortal. The Fair Baseline harness did not capture token usage. At the submission-time paid Standard assumption of $0.30/M input and $2.50/M output, the known v2 runs cost approximately $0.1208 in model tokens; baseline cost remains unmeasured. Free-tier/account pricing may differ. Commands create timestamped artifacts and do not overwrite frozen evidence. Gemini is stochastic; do not expect byte-identical trajectories.

Canonical artifacts are indexed in [RESULTS.md](RESULTS.md). The controlled Threadly comparison measures the frozen reasoning loop; the browser extension is the user-facing product and is validated separately because live sites and human interactions are mutable.

No private data is needed. Synthetic identities are fictional. Do not log in, purchase, submit, pay, enter personal data, or bypass CAPTCHA in optional public-site tests.
