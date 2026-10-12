# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only access probe for Reku, the Indonesian exchange at reku.id, formerly Rekeningku.

Every Reku host sits behind Cloudflare, and this probe records what each one answers from this host's exit.
Modes, each runnable alone: exit, hosts, ws, archive, ct, all (the default).
Run from the repository root: uv run scripts/probes/venues/reku/access-probe.py [mode]
Captures go to .claude/survey-work/reku/.
"""

import asyncio
import html
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets

WORK = Path(".claude/survey-work/reku")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# Production hosts: the site, the API host CoinMarketCap and the certificate logs name, the docs host and the stream hosts from the certificate logs.
HOSTS = [
    "https://reku.id/",
    "https://www.reku.id/",
    "https://reku.id/en/fees",
    "https://reku.id/en/fees/futures",
    "https://api.reku.id/",
    "https://api.reku.id/v2/price",
    "https://api-docs.reku.id/",
    "https://stream.reku.id/",
    "https://pstream.reku.id/",
    "https://chart.reku.id/",
    "https://rekeningku.com/",
    "https://www.rekeningku.com/",
    "https://api.rekeningku.com/",
]
WS_URLS = ["wss://stream.reku.id/", "wss://pstream.reku.id/", "wss://api.reku.id/"]
ARCHIVE_PAGES = ["reku.id/fees", "reku.id/en/fees", "reku.id/en/fees/futures", "api.reku.id", "api-docs.reku.id", "reku.id/en"]


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # a redirect is recorded as its own status and location


OPENER = urllib.request.build_opener(NoRedirect)


def get(url: str, timeout: float = 20) -> tuple[int, dict, bytes, float]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    t0 = time.perf_counter()
    try:
        with OPENER.open(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), time.perf_counter() - t0
    except Exception as e:  # DNS, TLS or timeout, recorded as status 0
        return 0, {}, repr(e).encode(), time.perf_counter() - t0


def block_text(body: bytes) -> str:
    """Cloudflare sends a plain "error code" line to curl-like clients and an HTML page to browsers, so both are reduced to text."""
    text = body.decode("utf-8", "replace")
    if "<html" not in text[:400].lower():
        return text[:160].strip()
    text = re.sub(r"<(script|style).*?</\1>", "", text, flags=re.S)
    text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)))
    m = re.search(r"(Error \d+).*?What happened\? (.*?\.) ", text)
    return f"{m.group(1)}: {m.group(2)}" if m else text[:160].strip()


def exit_mode() -> dict:
    status, _, body, _ = get("https://ipinfo.io/json")
    info = json.loads(body) if status == 200 else {"status": status}
    row = {k: info.get(k) for k in ("ip", "city", "region", "country", "org")}
    print(f"exit {row}")
    return row


def hosts_mode() -> list[dict]:
    rows = []
    for url in HOSTS:
        host = url.split("/")[2]
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, socket.AF_INET)})
        except OSError as e:
            addrs = [repr(e)]
        status, headers, body, secs = get(url)
        h = {k.lower(): v for k, v in headers.items()}
        row = {
            "url": url,
            "ipv4": addrs,
            "status": status,
            "server": h.get("server"),
            "cf_ray": h.get("cf-ray"),
            "location": h.get("location"),
            "content_type": h.get("content-type"),
            "body": block_text(body),
            "ms": round(secs * 1000),
        }
        rows.append(row)
        print(f"{status} {row['ms']:>5} ms {url} ipv4={addrs} server={row['server']} ray={row['cf_ray']} location={row['location']} body={row['body']!r}")
        time.sleep(0.5)
    return rows


async def ws_one(url: str) -> dict:
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, user_agent_header=UA, open_timeout=15) as ws:
            return {"url": url, "result": "opened", "ms": round((time.perf_counter() - t0) * 1000)}
    except websockets.InvalidStatus as e:
        r = e.response
        return {
            "url": url,
            "result": "refused",
            "status": r.status_code,
            "server": r.headers.get("server"),
            "cf_ray": r.headers.get("cf-ray"),
            "body": (r.body or b"")[:160].decode("utf-8", "replace"),
            "ms": round((time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        return {"url": url, "result": repr(e)[:200], "ms": round((time.perf_counter() - t0) * 1000)}


def ws_mode() -> list[dict]:
    rows = []
    for url in WS_URLS:
        row = asyncio.run(ws_one(url))
        rows.append(row)
        print(f"ws {row}")
    return rows


def archive_mode() -> list[dict]:
    rows = []
    for page in ARCHIVE_PAGES:
        status, _, body, _ = get(f"https://archive.org/wayback/available?url={page}")
        closest = json.loads(body).get("archived_snapshots", {}).get("closest") if status == 200 else None
        row = {"page": page, "status": status, "closest": closest and {k: closest[k] for k in ("timestamp", "status", "url")}}
        if closest:
            ts = closest["timestamp"]
            orig = closest["url"].split(ts + "/", 1)[1]
            s2, _, b2, _ = get(f"https://web.archive.org/web/{ts}id_/{orig}")
            row["snapshot_status"] = s2
            row["snapshot_body"] = b2[:120].decode("utf-8", "replace")
        rows.append(row)
        print(f"archive {row}")
        time.sleep(2)
    return rows


def ct_mode() -> dict:
    status, _, body, secs = get("https://crt.sh/?q=%25.reku.id&output=json", timeout=90)
    if status != 200:
        print(f"crt.sh {status} {body[:120]!r}")
        return {"status": status}
    certs = json.loads(body)
    names = sorted({n.lower() for c in certs for n in c["name_value"].split("\n")})
    print(f"crt.sh certificates={len(certs)} names={len(names)} in {secs:.1f} s")
    print(" ".join(names))
    return {"status": status, "certificates": len(certs), "names": names}


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    WORK.mkdir(parents=True, exist_ok=True)
    modes = {"exit": exit_mode, "hosts": hosts_mode, "ws": ws_mode, "archive": archive_mode, "ct": ct_mode}
    out = {"probed_at": now()}
    for name, fn in modes.items():
        if mode in (name, "all"):
            print(f"== {name} {now()}")
            out[name] = fn()
    (WORK / f"access-{mode}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
