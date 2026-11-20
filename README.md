# Stato

A small current-availability dashboard for GitHub Pages. Plain HTML/CSS/JavaScript, Python standard library, and GitHub Actions. No installation or build dependencies, accounts, notifications, database or uptime history.

## 1. Enable the website

1. Put these files in the root of `nokulab/stato`, including `.github/workflows/status.yml`, on its default branch.
2. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. In **Settings → Actions → General**, allow the official `actions/*` actions used by the workflow.
3. In **Actions**, enable workflows if GitHub prompts. Open **Check servers and deploy status → Run workflow**, select the default branch and run it.
4. Wait for both `build` and `deploy` to succeed. The deployment links to the Pages URL, normally `https://nokulab.github.io/stato/`. The environment `github-pages` must allow deployment from the default branch; a required human review will also block scheduled publication until approved.

Both examples start **disabled**. No actual server addresses are assumed. The first deployment therefore shows **No servers enabled**. All URLs used by the dashboard are relative, including `./status.json`, so repository subpaths work.

## 2. Add a server

Edit only `servers.json`. Copy either object inside the surrounding `[` and `]`, add a comma between objects, replace the example URL with your public health endpoint, and give it a unique ID:

```json
{
  "id": "my-new-service",
  "name": "My new service",
  "details": "Public website and customer portal",
  "url": "https://example.com/replace-with-your-health-endpoint",
  "expected_status_codes": [200],
  "timeout": 10,
  "enabled": true
}
```

The URL above is a placeholder, not your server. Save/commit the file on the default branch to trigger a check and publish the updated list. Remove an object to remove a server. JSON does not allow comments or trailing commas.

| Field | Meaning |
| --- | --- |
| `id` | Required unique lower-case ID: letters, numbers, `_`, `-`; starts with a letter or number; maximum 64 characters. |
| `name` | Required public display name, 1–100 characters. Do not put confidential information here. |
| `details` | Optional public description, up to 240 characters; defaults to an empty string. Rendered as text, never HTML. |
| `url` | Required public HTTP/HTTPS URL; no embedded username/password or fragment. Use a non-secret URL. |
| `expected_status_codes` | Optional non-empty array of integer HTTP codes; defaults to `[200]`. |
| `timeout` | Optional wall-clock seconds per attempt, greater than zero and at most 30; defaults to `10`. |
| `enabled` | Optional boolean, defaults to `true`. `false` skips the server entirely. |

Up to 100 entries are supported. Eight checks run concurrently. A failed request gets **one retry after one second**; a server can take up to twice its timeout plus that delay. The last attempt supplies its response time (request start to response headers), or `null` if no HTTP response was received. Bodies are never read or published. Redirects are not followed: configure the final health URL, or explicitly accept a redirect code if that is the intended check.

## 3. Change or disable a server

Change its `url` in `servers.json`, or set `"enabled": false`. Commit to the default branch. No dashboard or workflow edits are necessary. Disabled entries are omitted from the next published results.

## 4. Run a manual check

Open **Actions → Check servers and deploy status → Run workflow**, choose the default branch, then **Run workflow**. Other branches are deliberately skipped. The dashboard's **Refresh results** button only reloads published JSON; it cannot run Actions or contact your endpoints. The page also refreshes automatically every 60 seconds.

## 5. Understand the results

- **Green — Up:** the endpoint returned an expected HTTP status at the last check.
- **Red — Unreachable:** connection/DNS failure or timeout persisted after one retry, from the monitoring runner. This is not proof that the physical server is powered off.
- **Yellow — Warning:** an unexpected HTTP response, certificate error, invalid configuration, missing/unknown result or unsupported private endpoint. Results older than **15 minutes** also turn yellow, even if their last state was green or red; current availability is unknown.

The monitor publishes structured `reason_code` values (`http_status`, `network`, `timeout`, `tls`, `config`, `private`, `internal`). The dashboard never guesses a classification from free-text errors. Older results without codes remain readable; old `down` results are conservatively yellow until a new check supplies a code.

The grid follows configuration order: 1 server fills the area, 4 use 2×2, 6 use 3×2, and 16 use 4×4 on desktop. Intermediate counts use 1–4 columns with no dummy tiles. More than 16 servers add rows. Tiles have a 15rem minimum height, text wraps, and long lists scroll. Tablets use at most two columns and small phones one. The compact toolbar shows counts, results-update time, refresh and a fullscreen toggle where the browser supports it. Press Escape or Exit fullscreen to leave fullscreen.
Times use Australian formatting and **Australia/Sydney**, including daylight-saving changes. Missing/malformed results show Warning; a failed refresh retains previously loaded results with a visible warning and still ages them into Stale. Empty results never produce “all up”. Invalid enabled entries become Warning while valid entries continue. Unreadable JSON publishes a configuration error with no invented server list.

This initial version supports **public, unauthenticated HTTP/HTTPS endpoints**. Recognised private hostnames and addresses resolving to non-public IPs return Warning without a request. Private-network servers require a monitoring runner with network access (for example, a suitably configured self-hosted runner), plus an explicit adaptation of the public-address guard. Their failure to respond from a public runner does not prove they are offline.

## Security and publication

`servers.json` stays out of the Pages artifact, but **is visible in a public source repository**. Never store credentials, secret query parameters, private endpoints or sensitive names in it. This version needs no credentials and does not implement authenticated checks. If authentication is added later, keep its values in **Settings → Secrets and variables → Actions**, inject them only into the monitoring step, and never put them in source, output, browser code or logs.

The public `status.json` contains only schema version, publication time, configuration-error flag and each enabled entry's ID, public name, state, optional public details, structured reason code, response milliseconds, check time and a fixed/sanitised reason. URLs, headers, raw exceptions and responses are excluded. Only the four static site files, `.nojekyll` and generated results are uploaded. No commits are made by the workflow, so deployments cannot create push loops. Workflow concurrency serialises checks/deployments; a newer queued run can replace a pending run.

## Scheduling and limits

The UTC cron `2-57/5 * * * *` requests a run every five minutes, offset from the hour. GitHub can delay or drop scheduled runs during load; schedules run only on the default branch. Public-repository schedules are automatically disabled after **60 days without repository activity**; re-enable them in Actions when needed. This is periodic monitoring, with no guarantee of exact intervals or uninterrupted coverage. [GitHub scheduling rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

A five-minute cadence requests 288 runs per day (8,640 in 30 days), each with build and deployment jobs. Standard hosted runner usage is free in public repositories. Private repositories have plan-dependent compute allowances and storage limits; excess eligible usage can incur charges or stop when budgets/quota block it. Review your account's current allowance and budgets before using a private repository. Artifacts are retained for one day. [Actions usage and limits](https://docs.github.com/en/actions/concepts/billing-and-usage), [current included allowances](https://docs.github.com/en/billing/reference/product-usage-included)

This custom Actions deployment is exempt from Pages' soft ten-builds-per-hour limit; Pages bandwidth, size and service rate limits still apply. [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## 6. Troubleshoot

| Symptom | What to check |
| --- | --- |
| Unreachable / Warning | Confirm the final public URL, expected codes, TLS certificate, firewall access from GitHub runners, DNS and timeout. A 401/403 often means the endpoint is not public. Redirects need their final URL. |
| Warning/configuration error | Validate JSON and the fields above; check duplicate IDs. Diagnostics intentionally avoid echoing input. Fix the file and rerun. |
| Yellow / stale | Inspect the newest Actions run, queued deployments, schedule enablement, inactivity, billing/usage limits and environment approval rules. Run manually. |
| Build failed | Open the failed step in Actions. Check tests, Python/Node runner availability and file paths. No new artifact is deployed on a build failure; previous results age to Stale. |
| Deployment failed/403/404 | Verify Pages source is GitHub Actions, repository plan supports Pages, `github-pages` permits the default branch, and the deploy job retains `pages: write` and `id-token: write`. See [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). |
| No servers | Replace and enable an example in `servers.json`. After committing, wait for deployment, then refresh results. |
| JSON not loading | Open the published `status.json` beside `index.html`, inspect the deployment and refresh. Avoid opening HTML directly with `file://`. |

## Local verification

With Python 3.10+ and a current Node version (Node is only used for tests):

```sh
python3 -m unittest discover -s tests -v
node --test tests/status-model.test.mjs
python3 scripts/monitor.py
python3 -m http.server 8765 --directory dist
```

Open `http://localhost:8765/`. Tests cover real local HTTP responses, expected/unexpected codes, redirects, timeout handling, the retry bound, private addresses, invalid/duplicate configuration, disabled entries, data isolation, publication allowlisting, empty/malformed results and the stale boundary.

## Design reference

The tile grid follows the user-supplied Slide1–Slide4 references: full-area flat tiles, centred content, square corners and thin white dividers. Green and red are darker than the mock-ups to maintain readable white-text contrast; yellow uses dark text. No illustrative/demo results are deployed.
