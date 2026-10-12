# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""ASTX (astx.io) access and REST probe for docs/profiles/astx/rest.md, websocket.md and fees.md.

Public, unauthenticated and read-only.
It names the exit this host leaves through, and resolves astx.io and www.astx.io through the system resolver and DNS over HTTPS.
It tries a TLS handshake against four of the edge's twelve addresses, and against one of them with other SNI values and with none.
It sends one plain HTTP request on port 80 and looks for API subdomains in DNS.
It records what support.astx.io serves to HTML and to its Zendesk JSON API, and what the Wayback Machine holds for www.astx.io.
About 40 short connections over about 4 minutes, most of it waiting for the edge to close.
Run from the repository root with: uv run scripts/probes/venues/astx/rest-probe.py
"""

import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
SUBDOMAINS = ["api", "ws", "wss", "fapi", "openapi", "open-api", "contract", "futures", "swap", "stream", "socket",
              "h5", "m", "app", "web", "static", "cdn", "docs", "apidoc", "futures-api", "market", "quote", "push"]


def section(title):
    print(f"\n== {title}")


def get(url, timeout=20, accept="*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    t = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode(errors="replace"), dict(r.headers), 1000 * (time.monotonic() - t)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace"), dict(e.headers), 1000 * (time.monotonic() - t)
    except Exception as e:
        return None, f"{type(e).__name__}: {e}", {}, 1000 * (time.monotonic() - t)


def doh(name, rtype="A"):
    status, body, _, _ = get(f"https://cloudflare-dns.com/dns-query?name={name}&type={rtype}", accept="application/dns-json")
    try:
        return [(a["type"], a["data"]) for a in json.loads(body).get("Answer", [])]
    except Exception:
        return f"status {status} {body[:100]}"


def exit_node():
    section("exit this host leaves through")
    status, body, _, _ = get("https://ipinfo.io/json")
    try:
        d = json.loads(body)
        print(f"status {status}, city {d.get('city')}, region {d.get('region')}, country {d.get('country')}, org {d.get('org')}")
    except Exception:
        print(f"status {status} {body[:200]}")


def dns():
    section("DNS")
    for host in ("astx.io", "www.astx.io", "support.astx.io"):
        try:
            canon, _, addrs = socket.gethostbyname_ex(host)
            print(f"system resolver {host}: canonical {canon}, {len(addrs)} addresses {sorted(addrs)}")
        except Exception as e:
            print(f"system resolver {host}: {type(e).__name__}: {e}")
    print(f"DoH NS astx.io: {doh('astx.io', 'NS')}")
    print(f"DoH A www.astx.io: {doh('www.astx.io')}")
    found = {}
    for s in SUBDOMAINS:
        ans = doh(f"{s}.astx.io")
        if ans:
            found[s] = ans
    print(f"DoH A for {len(SUBDOMAINS)} candidate API subdomains: answered {found if found else 'none'}")


def tls(ip, sni):
    ctx = ssl.create_default_context()
    if sni is None:
        ctx.check_hostname = False
    t = time.monotonic()
    try:
        with socket.create_connection((ip, 443), timeout=20) as raw:
            tcp_ms = 1000 * (time.monotonic() - t)
            with ctx.wrap_socket(raw, server_hostname=sni) as s:
                return f"TCP {tcp_ms:.0f} ms, TLS ok {s.version()} in {1000 * (time.monotonic() - t):.0f} ms"
    except Exception as e:
        return f"{type(e).__name__}: {e} after {1000 * (time.monotonic() - t):.0f} ms"


def handshakes():
    section("TLS handshakes against the edge")
    _, _, addrs = socket.gethostbyname_ex("www.astx.io")
    for ip in sorted(addrs)[::3]:
        print(f"{ip} SNI www.astx.io: {tls(ip, 'www.astx.io')}")
    ip = sorted(addrs)[0]
    for sni in ("astx.io", "example.com", None):
        print(f"{ip} SNI {sni}: {tls(ip, sni)}")
    _, _, apex = socket.gethostbyname_ex("astx.io")
    print(f"apex astx.io {sorted(apex)[0]} SNI astx.io: {tls(sorted(apex)[0], 'astx.io')}")


def plain_http():
    section("plain HTTP on port 80")
    _, _, addrs = socket.gethostbyname_ex("www.astx.io")
    ip = sorted(addrs)[0]
    t = time.monotonic()
    try:
        with socket.create_connection((ip, 80), timeout=20) as s:
            s.settimeout(20)
            s.sendall(b"GET / HTTP/1.1\r\nHost: www.astx.io\r\nUser-Agent: " + UA.encode() + b"\r\nConnection: close\r\n\r\n")
            data = s.recv(2048)
            print(f"{ip}:80 connected, read {len(data)} bytes in {1000 * (time.monotonic() - t):.0f} ms: {data[:200]!r}")
    except Exception as e:
        print(f"{ip}:80 {type(e).__name__}: {e} after {1000 * (time.monotonic() - t):.0f} ms")
    for url in ("https://www.astx.io/", "https://www.astx.io/en"):
        status, body, _, ms = get(url, timeout=15)
        print(f"GET {url}: status {status}, {body[:160]} after {ms:.0f} ms")


def support():
    section("support.astx.io")
    status, body, h, ms = get("https://support.astx.io/hc/en-us")
    title = body.split("<title>")[1].split("</title>")[0] if "<title>" in body else ""
    print(f"GET /hc/en-us: status {status}, server {h.get('Server') or h.get('server')}, cf-mitigated {h.get('cf-mitigated')}, title {title!r}, {ms:.0f} ms")
    status, body, h, ms = get("https://support.astx.io/hc/en-us/articles/14834308052111")
    title = body.split("<title>")[1].split("</title>")[0] if "<title>" in body else ""
    print(f"GET fee article page: status {status}, cf-mitigated {h.get('cf-mitigated')}, title {title.strip()[:60]!r}, {ms:.0f} ms")
    status, body, h, ms = get("https://support.astx.io/api/v2/help_center/en-us/articles.json?per_page=1")
    d = json.loads(body) if status == 200 else {}
    print(f"GET Zendesk articles.json: status {status}, count {d.get('count')}, {ms:.0f} ms")
    status, body, _, _ = get("https://support.astx.io/api/v2/help_center/articles/search.json?query=API")
    print(f"GET Zendesk search query=API: status {status}, {body[:120]}")


def wayback():
    section("Wayback Machine")
    status, body, _, _ = get("https://archive.org/wayback/available?url=www.astx.io")
    print(f"availability: status {status}, {' '.join(body.split())[:200]}")
    try:
        snap = json.loads(body)["archived_snapshots"]["closest"]["timestamp"]
    except Exception:
        return
    status, body, _, ms = get(f"https://web.archive.org/web/{snap}id_/https://www.astx.io/", timeout=40)
    hosts = sorted(set(re.findall(r"(?:https?|wss?)://[a-zA-Z0-9.-]*astx[a-zA-Z0-9.-]*", body))) if status == 200 else []
    print(f"snapshot {snap} raw fetch: status {status}, {len(body)} bytes, astx hosts named {hosts}, {ms:.0f} ms")


if __name__ == "__main__":
    print(f"run at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    exit_node()
    dns()
    handshakes()
    plain_http()
    support()
    wayback()
