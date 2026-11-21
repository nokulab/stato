# Stato

A simple server-status grid for **private home servers**. Plain HTML/CSS/JavaScript, Python standard library and no database or monitoring subscription.

## Run on your server

Requires Python 3.10+ on a machine that can reach the monitored endpoints. The example below assumes Linux, a checkout at `/opt/stato`, and an existing private web server. Adapt paths to your installation.

1. Clone this repository. Copy the example `servers.json` to `/etc/stato/servers.json`, outside the checkout and web root. Restrict this file to the account running the monitor. Do not commit real internal addresses to the public repository.
2. Edit that configuration as described below. Both included examples are disabled; no real addresses are assumed.
3. Run a check and generate the website:

   ```sh
   python3 /opt/stato/scripts/monitor.py --config /etc/stato/servers.json --output /var/www/stato
   ```

   For endpoints on your own private network, explicitly add `--allow-private`. This permits internal addresses; it does not provide network access or disable TLS certificate verification. Use it only on your trusted monitoring machine with a trusted configuration file. Without it, recognised private endpoints produce a yellow Warning, not a definitive offline claim.

4. Configure your existing web server to serve **only `/var/www/stato`**, never the checkout or `/etc/stato`. Limit access using your LAN/VPN or existing authenticated HTTPS server. The dashboard has no built-in login, and a private server can still expose a website publicly if its firewall or web server allows it. Apply the same access restrictions to `status.json` as the HTML page.
5. Schedule the command every five minutes on that machine. For Linux with `cron` and `flock`, run this as the monitor account, with a writable `/var/lib/stato` directory and output directory:

   ```cron
   */5 * * * * /usr/bin/flock -n /var/lib/stato/check.lock /usr/bin/python3 /opt/stato/scripts/monitor.py --config /etc/stato/servers.json --output /var/www/stato --allow-private
   ```

   Omit `--allow-private` if all targets should be public. The lock skips overlapping runs. Configure your scheduler's log destination privately. Run the same command manually after configuration changes; it is also picked up on the next scheduled check. No workflow or HTML changes are needed when changing servers.

Monitoring depends on the host, scheduler and network being available; exact timing and uninterrupted monitoring are not guaranteed. Results older than 15 minutes turn yellow. Checks establish endpoint availability **from the monitoring machine**, not proof that a physical server is powered on or off.

For a local preview, generate the default `dist/` directory with `python3 scripts/monitor.py`, then use `python3 -m http.server 8765 --bind 127.0.0.1 --directory dist`. Open `http://localhost:8765/`. This development server is not an authenticated production server.

## Add, edit or disable a server

Edit only your private `servers.json`. Copy one entry inside its surrounding `[` and `]`, separate entries with commas, and replace the placeholder URL. This is a complete entry:

```json
{
  "id": "my-service",
  "name": "Customer portal",
  "details": "Website and sign-in availability",
  "url": "https://example.com/replace-with-your-health-endpoint",
  "expected_status_codes": [200],
  "timeout": 10,
  "enabled": true
}
```

The URL is an example, not your server. Existing entries without `details` remain compatible. Change `url` to change the endpoint; set `enabled` to `false` to hide and skip it; remove an entry to remove it entirely. Run a check or wait for the next scheduled run. JSON does not allow comments or trailing commas.

| Field | Meaning |
| --- | --- |
| `id` | Unique lower-case ID, letters/numbers/`_`/`-`, starting with a letter or number; up to 64 characters. |
| `name` | Display name, 1–100 characters. Use a non-sensitive service label. |
| `details` | Optional description, up to 240 characters. Rendered as text, never HTML. |
| `url` | HTTP/HTTPS health endpoint, or `tcp://hostname:port`; no username/password or fragment. TCP requires an explicit port and no path or query. |
| `expected_status_codes` | HTTP only: optional non-empty list of HTTP codes; defaults to `[200]`. Omit for TCP checks. |
| `timeout` | Optional wall-clock seconds per attempt, greater than zero and at most 30; defaults to `10`. |
| `enabled` | Optional boolean; defaults to `true`. |

Up to 100 entries are supported, with eight concurrent checks. Failed requests get one retry after one second. The last attempt supplies the HTTP result and response time, measured to response headers. Bodies are not read; redirects are not followed. Configure the final health URL, or explicitly accept a redirect code if intended. Endpoint authentication is not implemented: do not embed credentials or secret query parameters in URLs. A future authentication extension should use local secret storage/environment injection, not source files or browser code.

## Monitor server connectivity (TCP)

Use a TCP check to verify that a server accepts connections on a chosen port, such as SSH port 22. No SSH credentials or keys are needed. Copy this disabled example into your private configuration, replace the placeholder and enable it:

```json
{
  "id": "example-server",
  "name": "Example server",
  "details": "Server connectivity",
  "url": "tcp://replace-with-your-server:22",
  "timeout": 10,
  "enabled": false
}
```

Omit `expected_status_codes` for TCP. Private addresses still require `--allow-private`. The monitor connects and immediately closes the socket without logging in, reading a banner or sending application data. TCP response time measures DNS/connection setup. Retries, timeouts and stale handling are the same as HTTP checks. TCP tiles show the check type instead of HTTP result fields; addresses and ports stay out of generated data.

An open TCP port establishes reachability of that listener, not SSH authentication, website health, CPU, RAM or disk health. A firewall can cause an unreachable result. If OMV runs the monitor and OMV goes down, checks stop too; an already-open dashboard ages into a stale warning, while the hosted page may become unavailable. Independent detection of that outage needs a monitor on another machine.

## Read the tiles

- **Green — Up:** the last check returned an expected HTTP status or accepted a TCP connection.
- **Red — Unreachable:** connection/DNS failure or timeout persisted after the retry, from the monitoring machine.
- **Yellow — Warning:** unexpected HTTP status, certificate error, invalid configuration, unknown/missing result, unsupported private endpoint, or a check older than **15 minutes**. Stale green and red results both become yellow; current availability is unknown.

Each tile shows the name, optional details, status, last HTTP result and expected codes, response time when available, last-check time, and a fixed failure explanation when needed. Old results without HTTP metadata remain readable. A last HTTP 200 never overrides a stale warning.

IP addresses, hostnames, ports, endpoint paths, headers, credentials, raw responses and software versions are excluded from generated results. Names, IDs and details are deliberately displayed, not automatically redacted: avoid confidential text. Availability and timing can still reveal operational information, so keep access restricted; no information selection can guarantee zero security impact.

The grid follows configuration order, with no dummy tiles: 1 fills the area, 4 use 2×2, 6 use 3×2 and 16 use 4×4 on desktop. Larger lists scroll, tablets use at most two columns, and phones use one. Tiles have readable minimum heights and wrap long names. The toolbar shows overall status/counts, publication time, refresh and fullscreen where supported.

Results refresh every 60 seconds. **Refresh results** reloads generated data; it does not initiate a server check. Failed refreshes retain the previous data with a warning and continue ageing it. Missing/malformed data and an empty server list are handled explicitly. Times use Australian formatting and **Australia/Sydney**, including daylight saving. Relative asset URLs support subpaths.

## Source code, deployment and privacy

The GitHub repository contains reusable code and disabled examples only. Its `Verify Stato` workflow runs Python and JavaScript tests on pushes, pull requests and manual triggers, with read-only permissions. It has no scheduled endpoint checks, Pages upload, deployment permission or results artifact. Do not restore the old Pages workflow with private configuration.

Existing GitHub Pages deployments remain online until explicitly unpublished in **Settings → Pages**; changing a workflow alone does not remove a previously published website. Keep your actual configuration and generated files on your server. `dist/` is ignored by Git. The monitor copies only four static files, `.nojekyll` and generated `status.json` into the output directory and replaces JSON atomically. Do not use that directory to store other sensitive files.

To update your private installation, pull the source changes, run the tests and regenerate the output. Your configuration outside the checkout remains in place. Local scheduling avoids GitHub Actions scheduling delays and inactivity rules; it depends instead on your server's own scheduler. GitHub-hosted test runs remain subject to your account's Actions allowances.

## Troubleshoot

| Symptom | Check |
| --- | --- |
| Unreachable | DNS, routing, firewall and timeout from the monitoring host. This is not proof that the server is powered off. |
| Unexpected HTTP | Final URL and expected codes. Redirects need the final URL; 401/403 may indicate authentication requirements. |
| Certificate warning | Certificate validity, hostname and the monitoring host's trusted CA store. Do not disable TLS verification. |
| Private endpoint warning | Use a runner with access and explicitly pass `--allow-private` for trusted internal endpoints. |
| Configuration warning | JSON syntax, duplicate IDs, supported fields and file read permissions. Other valid entries continue to be checked. |
| Stale/yellow | Scheduler, overlapping-run lock, monitor process, output permissions and web-server caching. Run a manual check. |
| No servers enabled | Replace an example endpoint in your private config, enable it, and rerun. |
| Results cannot load | Serve the generated directory over HTTP/HTTPS; ensure `status.json` is accessible under the same authenticated path. Avoid `file://`. |
| Source checks fail | Inspect the failed GitHub Actions test step or run the same tests locally. CI does not deploy the dashboard. |

## Verification

Python 3.10+ and a current Node version (Node is only needed for tests):

```sh
python3 -m unittest discover -s tests -v
node --test tests/status-model.test.mjs
```

Tests cover successful/unexpected HTTP responses, timeouts, TLS/network failures, retries, explicit private-network opt-in, configuration errors, output isolation, optional details and HTTP metadata, missing/stale results and grid sizes. Preview data is temporary and never published as monitoring results.

## Design reference

The grid follows the supplied Slide1–Slide4 references: flat full-area tiles, centred content, square corners and thin white dividers. Green and red are dark enough for white text; yellow uses dark text.
