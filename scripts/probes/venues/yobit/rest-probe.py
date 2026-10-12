# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""YoBit public REST probe, read-only and unauthenticated.

The calls are the Public API v2 and v3 documented at https://yobit.net/en/api/.
The page says v3 responses are cached every 2 seconds and publishes no request limit, so this probe spaces repeated calls at least 1 s apart and sends about 60 requests in all.
The trade pages are read only for the numeric pair_id that the web socket topics use.

Run from the repository root: uv run scripts/probes/venues/yobit/rest-probe.py
"""

import collections
import email.utils
import hashlib
import json
import re
import socket
import time
import urllib.error
import urllib.request

BASE = "https://yobit.net"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"


def get(url, follow=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    t0 = time.perf_counter()
    try:
        with opener.open(req, timeout=30) as r:
            body = r.read()
            status, hdrs = r.status, r.headers
    except urllib.error.HTTPError as e:
        body = e.read()
        status, hdrs = e.code, e.headers
    ms = (time.perf_counter() - t0) * 1000
    return status, hdrs, body, ms


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def short(body, n=300):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def section(title):
    print(f"\n## {title}")


def host_and_latency():
    section("Host and latency")
    addrs = sorted({a[4][0] for a in socket.getaddrinfo("yobit.net", 443, proto=socket.IPPROTO_TCP)})
    print("yobit.net resolves to", addrs)
    for i in range(3):
        status, hdrs, body, ms = get(BASE + "/api/3/ticker/btc_usdt")
        print(f"ticker btc_usdt try {i + 1}: HTTP {status}, {len(body)} B, {ms:.0f} ms, Server {hdrs.get('Server')}")
        time.sleep(1.1)


def site_access():
    section("Site access")
    for path in ["/", "/en/", "/en/api/", "/en/fees/", "/en/trade/BTC/USDT", "/en/futures/"]:
        status, hdrs, body, ms = get(BASE + path, follow=False)
        print(f"{path}: HTTP {status}, {len(body)} B, Location {hdrs.get('Location')}, Server {hdrs.get('Server')}")
        time.sleep(1.1)


def catalog():
    section("Catalog, GET /api/3/info")
    t0 = time.time()
    status, hdrs, body, ms = get(BASE + "/api/3/info")
    print(f"HTTP {status}, {len(body)} B, {ms:.0f} ms, Content-Type {hdrs.get('Content-Type')}, Cache-Control {hdrs.get('Cache-Control')}")
    doc = json.loads(body)
    pairs = doc["pairs"]
    print(f"server_time {doc['server_time']}, local at request start {t0:.1f}, server minus local start {doc['server_time'] - t0:+.1f} s, the reply took {ms / 1000:.1f} s")
    print("pairs", len(pairs))
    print("hidden counts", dict(collections.Counter(p["hidden"] for p in pairs.values())))
    print("fee counts", dict(collections.Counter(p["fee"] for p in pairs.values())))
    print("fee_buyer counts", dict(collections.Counter(p.get("fee_buyer") for p in pairs.values())))
    print("fee_seller counts", dict(collections.Counter(p.get("fee_seller") for p in pairs.values())))
    print("field sets", dict(collections.Counter(tuple(sorted(p)) for p in pairs.values())))
    quotes = collections.Counter(k.split("_")[1] for k in pairs)
    print("pairs by quote", dict(quotes.most_common()))
    visible_usdt = [k for k, p in pairs.items() if k.endswith("_usdt") and p["hidden"] == 0]
    print("visible usdt pairs", len(visible_usdt))
    odd = [k for k in pairs if k.count("_") != 1]
    print("ids with other than one underscore", odd[:10], len(odd))
    lower = {}
    for k in pairs:
        lower.setdefault(k.lower(), []).append(k)
    print("case duplicates", [v for v in lower.values() if len(v) > 1][:5])
    for k in ["btc_usdt", "eth_usdt", "eth_btc", "doge_usdt", "yo_btc"]:
        print(k, json.dumps(pairs.get(k)))
    print("sample", short(body, 260))
    return pairs


def tickers(pairs):
    section("Ticker, GET /api/3/ticker/<pairs>")
    names = ["btc_usdt", "eth_usdt", "eth_btc", "doge_usdt", "ltc_usdt", "trx_usdt", "doge_btc", "ltc_btc"]
    status, hdrs, body, ms = get(BASE + "/api/3/ticker/" + "-".join(names))
    doc = json.loads(body)
    print(f"HTTP {status}, {len(body)} B, {ms:.0f} ms")
    for k, v in doc.items():
        print(k, "vol (quote)", v["vol"], "vol_cur (base)", v["vol_cur"], "buy", v["buy"], "sell", v["sell"], "updated", v["updated"])
    time.sleep(1.1)
    usdt = sorted(k for k, p in pairs.items() if k.endswith("_usdt") and p["hidden"] == 0)
    url = BASE + "/api/3/ticker/" + "-".join(usdt[:100]) + "?ignore_invalid=1"
    status, hdrs, body, ms = get(url)
    print(f"100 usdt pairs in one call: URL length {len(url)}, HTTP {status}, {len(body)} B, {ms:.0f} ms, rows {len(json.loads(body)) if status == 200 else short(body)}")
    time.sleep(1.1)
    btc = sorted(k for k, p in pairs.items() if k.endswith("_btc") and p["hidden"] == 0)
    for n in (250, 400):
        url = BASE + "/api/3/ticker/" + "-".join(btc[:n]) + "?ignore_invalid=1"
        status, hdrs, body, ms = get(url)
        rows = len(json.loads(body)) if status == 200 and body.startswith(b"{") else short(body, 160)
        print(f"{n} btc pairs in one call: URL length {len(url)}, HTTP {status}, {len(body)} B, {ms:.0f} ms, rows {rows}")
        time.sleep(1.1)


def book():
    section("Book, GET /api/3/depth/<pair>")
    for q in ["", "?limit=5", "?limit=2000", "?limit=5000"]:
        status, hdrs, body, ms = get(BASE + "/api/3/depth/btc_usdt" + q)
        doc = json.loads(body)["btc_usdt"]
        asks, bids = doc.get("asks") or [], doc.get("bids") or []
        print(f"limit {q or 'default'}: HTTP {status}, {len(body)} B, {ms:.0f} ms, asks {len(asks)}, bids {len(bids)}")
        if asks and bids:
            print("  asks ascending", all(asks[i][0] <= asks[i + 1][0] for i in range(len(asks) - 1)),
                  "bids descending", all(bids[i][0] >= bids[i + 1][0] for i in range(len(bids) - 1)),
                  "best bid", bids[0], "best ask", asks[0], "crossed", bids[0][0] >= asks[0][0])
        time.sleep(1.1)
    status, hdrs, body, ms = get(BASE + "/api/3/depth/btc_usdt-eth_usdt?limit=3")
    print("two pairs:", short(body, 400))
    time.sleep(1.1)
    status, hdrs, body, ms = get(BASE + "/api/2/btc_usdt/depth")
    d = json.loads(body)
    print(f"v2 depth: HTTP {status}, {len(body)} B, asks {len(d.get('asks', []))}, bids {len(d.get('bids', []))}")
    time.sleep(1.1)


def caching():
    section("Caching, GET /api/3/depth/eth_btc?limit=50 once a second for 20 s")
    seen = []
    for i in range(20):
        status, hdrs, body, ms = get(BASE + "/api/3/depth/eth_btc?limit=50")
        seen.append((round(time.time(), 1), hashlib.sha1(body).hexdigest()[:8], hdrs.get("Age"), hdrs.get("Cache-Control"), hdrs.get("Date")))
        time.sleep(1.0)
    changes = sum(1 for i in range(1, len(seen)) if seen[i][1] != seen[i - 1][1])
    for row in seen:
        print(row)
    print("distinct bodies", len({r[1] for r in seen}), "changes", changes)


def errors():
    section("Errors and fee call")
    for path in [
        "/api/3/depth/nosuch_pair",
        "/api/3/depth/btc_usdt-nosuch_pair",
        "/api/3/depth/btc_usdt-nosuch_pair?ignore_invalid=1&limit=1",
        "/api/3/nosuchmethod/btc_usdt",
        "/api/2/btc_usdt/fee",
        "/api/2/eth_btc/fee",
        "/api/defi/info",
    ]:
        status, hdrs, body, ms = get(BASE + path)
        print(f"{path}: HTTP {status}, {len(body)} B, {short(body, 220)}")
        time.sleep(1.1)


def server_time():
    section("Server time")
    for i in range(3):
        t0 = time.time()
        status, hdrs, body, ms = get(BASE + "/api/3/ticker/btc_usdt")
        t1 = time.time()
        date = email.utils.parsedate_to_datetime(hdrs.get("Date")).timestamp()
        print(f"Date header {hdrs.get('Date')}, minus local midpoint {date - (t0 + t1) / 2:+.2f} s, request {ms:.0f} ms")
        time.sleep(1.1)


def pair_ids():
    section("Pair ids from trade pages")
    for pair in ["BTC/USDT", "ETH/USDT", "ETH/BTC", "DOGE/USDT"]:
        status, hdrs, body, ms = get(f"{BASE}/en/trade/{pair}")
        m = re.search(rb"pair_id = '(\d+)'", body)
        fees = re.findall(rb"var (fee_buyer|fee_seller) = ([0-9.]+);", body)
        print(pair, f"HTTP {status}", "pair_id", m.group(1).decode() if m else None, "page fees", [(k.decode(), v.decode()) for k, v in fees])
        time.sleep(1.1)


def coverage():
    section("Coverage")
    status, hdrs, body, ms = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    rows = json.loads(body) if status == 200 else []
    hits = [r for r in rows if "yobit" in (r["id"] + r["name"]).lower()]
    print(f"CoinGecko derivatives exchange list: HTTP {status}, {len(rows)} exchanges, YoBit rows {hits}")
    status, hdrs, body, ms = get(BASE + "/en/")
    text = body.decode("utf-8", "replace").lower()
    print("home page word counts", {w: text.count(w) for w in ["futures", "perpetual", "leverage", "margin trading", "contract"]})
    m = re.search(r'<ul class="top_menu">(.*?)</ul>', body.decode("utf-8", "replace"), re.S)
    print("top menu", re.findall(r">([^<>]+)</a>", m.group(1)) if m else None)


def main():
    print("YoBit REST probe at", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()))
    host_and_latency()
    site_access()
    pairs = catalog()
    time.sleep(1.1)
    tickers(pairs)
    book()
    caching()
    errors()
    server_time()
    pair_ids()
    coverage()


if __name__ == "__main__":
    main()
