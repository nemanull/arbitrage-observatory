# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets==15.0.1", "dnspython==2.7.0"]
# ///
"""Cryptomus public WebSocket probe, read-only and unauthenticated.

Three socket hosts are tried.
wss://api-ws.cryptomus.com/ws is the documented API socket at https://doc.cryptomus.com/methods/exchange/websockets, which wants a one-time token from a signed call.
wss://exchange-ws.cryptomus.com/ws is the market data socket that the trading web app bundles at https://cryptomus.com/exchange/trading open.
wss://api-app.cryptomus.com/app/o6h25g2n8v3set is the Pusher protocol socket that the same bundles open for account events.
The probe resolves each host on the system resolver, on Cloudflare and Google DNS over HTTPS, and on the zone's authoritative name server, then opens each socket.
No token is requested and no private channel is subscribed.

Run from the repository root: uv run scripts/probes/venues/cryptomus/ws-probe.py
Sockets stay open for at most about 40 seconds in total.
"""

import asyncio
import json
import socket
import time
import urllib.request

import dns.message
import dns.rcode
import dns.query
import dns.resolver
import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
TARGETS = [
    ("documented API socket, no token", "wss://api-ws.cryptomus.com/ws"),
    ("documented API socket, dummy token", "wss://api-ws.cryptomus.com/ws?token=0"),
    ("web app market data socket", "wss://exchange-ws.cryptomus.com/ws"),
    ("web app Pusher socket", "wss://api-app.cryptomus.com/app/o6h25g2n8v3set?protocol=7&client=js&version=8.4.0&flash=false"),
]
DOH = {
    "cloudflare": "https://cloudflare-dns.com/dns-query?name={}&type=A",
    "google": "https://dns.google/resolve?name={}&type=A",
}


def resolve(host):
    try:
        local = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
    except OSError as e:
        local = f"unresolved: {e}"
    out = {"system": local}
    for name, url in DOH.items():
        req = urllib.request.Request(url.format(host), headers={"accept": "application/dns-json", "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read())
        rcode = {0: "NOERROR", 3: "NXDOMAIN"}.get(d["Status"], d["Status"])
        out[name] = f"{rcode} {[a['data'] for a in d.get('Answer', [])]}"
        soa = [a["data"].split()[2] for a in d.get("Authority", []) if a.get("type") == 6]
        if soa:
            out[name] += f" zone SOA serial {soa[0]}"
    ns = sorted(str(r.target) for r in dns.resolver.resolve("cryptomus.com", "NS"))[0]
    ns_ip = dns.resolver.resolve(ns, "A")[0].address
    reply = dns.query.udp(dns.message.make_query(host, "A"), ns_ip, timeout=10)
    out["authoritative"] = f"{ns} {dns.rcode.to_text(reply.rcode())} {[str(r) for rr in reply.answer for r in rr]}"
    return out


async def try_socket(label, url):
    print(f"\n== {label}: {url}")
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, compression=None, open_timeout=15, user_agent_header=UA,
                                      additional_headers={"Origin": "https://cryptomus.com"}) as ws:
            print(f"open after {round((time.perf_counter() - t0) * 1000)} ms, response headers={dict(ws.response.headers)}")
            if "api-app" in url:
                await read_some(ws, 5)
                await ws.send(json.dumps({"event": "pusher:ping", "data": {}}))
                print("sent pusher:ping")
                await read_some(ws, 5)
                await ws.send(json.dumps({"event": "pusher:subscribe", "data": {"channel": "private-probe"}}))
                print("sent pusher:subscribe for private-probe without auth, to see the refusal shape")
                await read_some(ws, 5)
            else:
                await ws.send(json.dumps({"id": 1, "method": "ping", "params": []}))
                await read_some(ws, 5)
                await ws.send(json.dumps({"id": 2, "method": "depth_subscribe", "params": ["BTC_USDT:0"]}))
                await read_some(ws, 10)
    except Exception as e:
        print(f"failed after {round((time.perf_counter() - t0) * 1000)} ms: {type(e).__name__}: {e}")
        resp = getattr(e, "response", None)
        if resp is not None:
            print(f"refusal headers={dict(resp.headers)} body={(resp.body or b'')[:300]!r}")


async def read_some(ws, seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=end - time.monotonic())
        except asyncio.TimeoutError:
            return
        text = msg if isinstance(msg, str) else msg.decode("utf-8", "replace")
        print(f"recv {text[:300]}")


async def main():
    print("== DNS")
    for host in ("api-ws.cryptomus.com", "exchange-ws.cryptomus.com", "api-app.cryptomus.com", "api.cryptomus.com"):
        print(f"{host} {resolve(host)}")
    for label, url in TARGETS:
        await try_socket(label, url)


if __name__ == "__main__":
    asyncio.run(main())
