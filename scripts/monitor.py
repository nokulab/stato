"""Public endpoint checks. Standard library only; never print endpoint/error text."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import ipaddress
import json
import math
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
REASONS = {
    "timeout": "Request timed out from the monitoring runner.",
    "network": "Connection or DNS failed from the monitoring runner.",
    "tls": "TLS certificate verification failed.",
    "private": "Private network endpoint; requires a runner with network access.",
    "internal": "The monitor could not complete this check.",
    "config": "Invalid server configuration; check servers.json.",
}


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate(entry):
    if not isinstance(entry, dict):
        return False
    try:
        url = urllib.parse.urlsplit(entry["url"])
        codes = entry.get("expected_status_codes", [200])
        timeout = entry.get("timeout", 10)
        return bool(
            isinstance(entry.get("id"), str)
            and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", entry["id"])
            and isinstance(entry.get("name"), str)
            and 1 <= len(entry["name"].strip()) <= 100
            and not any(ord(c) < 32 for c in entry["name"])
            and isinstance(entry.get("details", ""), str)
            and len(entry.get("details", "")) <= 240
            and not any(ord(c) < 32 for c in entry.get("details", ""))
            and url.scheme in ("http", "https") and url.hostname
            and not url.username and not url.password and not url.fragment
            and (url.port is None or 1 <= url.port <= 65535)
            and not any(c.isspace() for c in entry["url"])
            and isinstance(codes, list) and codes
            and all(type(c) is int and 100 <= c <= 599 for c in codes)
            and type(timeout) in (int, float) and math.isfinite(timeout)
            and 0 < timeout <= 30
            and type(entry.get("enabled", True)) is bool
        )
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe(entry):
    """Executed in a child process so DNS and socket work have a wall-clock limit."""
    start = time.monotonic()
    try:
        url = urllib.parse.urlsplit(entry["url"])
        host = url.hostname.rstrip('.').lower()
        if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal', '.lan')) or ('.' not in host and ':' not in host):
            return {"status": "unknown", "reason_code": "private", "reason": REASONS["private"], "response_ms": None}
        addresses = socket.getaddrinfo(url.hostname, url.port or (443 if url.scheme == "https" else 80))
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            return {"status": "unknown", "reason_code": "private", "reason": REASONS["private"], "response_ms": None}
        # No redirects or proxies: check exactly the configured endpoint, without reading its body.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        request = urllib.request.Request(entry["url"], headers={"User-Agent": "SimpleStatus/1.0", "Accept": "*/*"})
        try:
            with opener.open(request, timeout=entry.get("timeout", 10)) as response:
                code = response.status
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
        elapsed = round((time.monotonic() - start) * 1000)
        ok = code in entry.get("expected_status_codes", [200])
        return {"status": "up" if ok else "down", "response_ms": elapsed,
                "reason_code": None if ok else "http_status",
                "reason": None if ok else f"Unexpected HTTP status {code}."}
    except (TimeoutError, socket.timeout):
        reason = "timeout"
    except urllib.error.URLError as error:
        reason = "tls" if isinstance(error.reason, ssl.SSLError) else "timeout" if isinstance(error.reason, TimeoutError) else "network"
    except ssl.SSLError:
        reason = "tls"
    except OSError:
        reason = "network"
    except Exception:
        return {"status": "unknown", "reason_code": "internal", "reason": REASONS["internal"], "response_ms": None}
    return {"status": "down", "reason_code": reason, "reason": REASONS[reason], "response_ms": None}


def attempt(entry):
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--probe"],
                                input=json.dumps(entry), capture_output=True, text=True,
                                timeout=entry.get("timeout", 10), check=True)
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"status": "down", "reason_code": "timeout", "reason": REASONS["timeout"], "response_ms": None}
    except Exception:
        return {"status": "unknown", "reason_code": "internal", "reason": REASONS["internal"], "response_ms": None}


def check(entry):
    result = attempt(entry)
    if result["status"] == "down":
        time.sleep(1)
        result = attempt(entry)  # One retry only; publish final attempt's measurement.
    return {"id": entry["id"], "name": entry["name"], "details": entry.get("details", ""), **result, "checked_at": now()}


def collect(config):
    generated = {"schema_version": 1, "generated_at": None, "configuration_error": False, "servers": []}
    try:
        entries = json.loads(Path(config).read_text(encoding="utf-8"))
        if not isinstance(entries, list) or len(entries) > 100:
            raise ValueError()
    except (OSError, UnicodeError, ValueError):
        generated.update(generated_at=now(), configuration_error=True)
        return generated
    ids = [e.get("id") for e in entries if isinstance(e, dict) and isinstance(e.get("id"), str)]
    valid, positions = [], []
    for index, entry in enumerate(entries):
        # Disabled entries do not appear publicly or trigger a request.
        if isinstance(entry, dict) and entry.get("enabled") is False:
            continue
        if not validate(entry) or ids.count(entry.get("id")) != 1:
            generated["configuration_error"] = True
            generated["servers"].append({"id": f"invalid-entry-{index + 1}",
                "name": f"Configuration entry {index + 1}", "status": "unknown",
                "response_ms": None, "checked_at": None, "reason_code": "config", "reason": REASONS["config"]})
        else:
            positions.append(len(generated["servers"]))
            generated["servers"].append(None)
            valid.append(entry)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for position, result in zip(positions, pool.map(check, valid)):
            generated["servers"][position] = result
    generated["generated_at"] = now()
    return generated


def build(config, output):
    data = collect(config)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    # Explicit publication allowlist: never copy configuration, source or credentials.
    for name in ("index.html", "style.css", "app.js", "status-model.js"):
        shutil.copyfile(ROOT / "site" / name, output / name)
    (output / ".nojekyll").touch()
    temporary = output / "status.json.tmp"
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output / "status.json")
    print(f"Published results for {len(data['servers'])} enabled entries.")
    if data["configuration_error"]:
        print("Configuration needs attention; published Unknown results. Check servers.json.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(ROOT / "servers.json"))
    parser.add_argument("--output", default=str(ROOT / "dist"))
    parser.add_argument("--probe", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.probe:
        try:
            print(json.dumps(probe(json.load(sys.stdin))))
        except Exception:
            print(json.dumps({"status": "unknown", "reason_code": "internal", "reason": REASONS["internal"], "response_ms": None}))
    else:
        build(args.config, args.output)
