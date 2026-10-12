# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only search for a public StakeCube market data socket.

StakeCube documents no WebSocket, so this probe checks the places one could live.

Modes, all by default, or name some on the command line:
    dns      the usual socket host names under stakecube.io and stakecube.net
    paths    HTTP status of the socket-like paths on the API host, beside a made-up path for comparison
    handshake  a WebSocket handshake against each candidate URL, holding any opened socket for at most 10 s
    webapp   the web app pages on stakecube.net that would load a socket client, and the Cloudflare answer

Every request is unauthenticated and sends nothing after a handshake.
Total socket time is under one minute.

Run from the repository root:
    uv run scripts/probes/venues/stakecube/ws-probe.py [mode ...]
"""

import asyncio
import json
import socket
import sys
import time
import urllib.error
import urllib.request

import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
CANDIDATES = [
    "wss://stakecube.io/",
    "wss://stakecube.io/ws/",
    "wss://stakecube.io/websocket/",
    "wss://stakecube.io/socket.io/?EIO=4&transport=websocket",
    "wss://stakecube.io/api/v2/ws",
    "wss://stakecube.net/ws/",
    "wss://stakecube.net/socket.io/?EIO=4&transport=websocket",
]


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def http_get(url: str) -> tuple[int, dict, bytes]:
    time.sleep(1.0)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def dns_mode() -> None:
    for name in ("stakecube.io", "stakecube.net", "ws.stakecube.io", "ws.stakecube.net", "socket.stakecube.io",
                 "socket.stakecube.net", "stream.stakecube.io", "stream.stakecube.net", "api.stakecube.net", "api.stakecube.io"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = f"no address: {e.strerror}"
        out(mode="dns", host=name, addresses=addrs)


def paths_mode() -> None:
    for path in ("/ws", "/ws/", "/websocket", "/websocket/", "/socket.io/?EIO=4&transport=polling", "/made-up-dir/"):
        req = urllib.request.Request("https://stakecube.io" + path, headers={"User-Agent": UA})
        opener = urllib.request.build_opener(NoRedirect)
        time.sleep(1.0)
        try:
            with opener.open(req, timeout=20) as r:
                status, hdrs = r.status, dict(r.headers)
        except urllib.error.HTTPError as e:
            status, hdrs = e.code, dict(e.headers)
        out(mode="paths", url="https://stakecube.io" + path, status=status, location=hdrs.get("Location"), server=hdrs.get("Server"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


async def try_handshake(url: str) -> None:
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, user_agent_header=UA, open_timeout=10, compression=None) as ws:
            first = None
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=10)
            except asyncio.TimeoutError:
                first = "no frame in 10 s"
            out(mode="handshake", url=url, opened=True, ms=round((time.perf_counter() - t0) * 1000),
                first_frame=str(first)[:300])
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        body = (r.body or b"").decode(errors="replace")
        out(mode="handshake", url=url, opened=False, status=r.status_code,
            server=r.headers.get("Server"), cf_mitigated=r.headers.get("cf-mitigated"),
            body=" ".join(body.split())[:160])
    except Exception as e:  # DNS failures, resets and timeouts are all results here
        out(mode="handshake", url=url, opened=False, error=f"{type(e).__name__}: {e}"[:200])


def handshake_mode() -> None:
    for url in CANDIDATES:
        asyncio.run(try_handshake(url))
        time.sleep(1.0)


def webapp_mode() -> None:
    for url in ("https://stakecube.net/", "https://stakecube.net/app/exchange/", "https://stakecube.net/app/system/fees"):
        status, hdrs, body = http_get(url)
        text = body.decode(errors="replace")
        title = text.split("<title>")[1].split("</title>")[0] if "<title>" in text else None
        out(mode="webapp", url=url, status=status, server=hdrs.get("server"), cf_mitigated=hdrs.get("cf-mitigated"),
            title=title, bytes=len(body), mentions_websocket=("websocket" in text.lower() or "wss://" in text))


MODES = {"dns": dns_mode, "paths": paths_mode, "handshake": handshake_mode, "webapp": webapp_mode}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    out(probe="stakecube ws", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=chosen)
    for name in chosen:
        MODES[name]()
