# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only public REST probe for BIT.TEAM, spot only.

Modes, all by default, or name some on the command line:
    access    the exit's location, DNS, status, server header and size of the home page, the API document and the catalog, plus five latency samples.
    catalog   /trade/api/ccxt/pairs, /trade/api/pairs and /trade/api/pair/{name}: counts, status and active flags, fees, steps and settings.
    book      /trade/api/orderbooks/{symbol} and /trade/api/cmc/orderbook/{pair} on every active pair: depth, order, crossing,
              number type, timestamp, and whether depth or level query parameters change anything.
    ticker    /trade/api/cmc/ticker, /trade/api/cmc/summary and /trade/api/rates, the only reference prices the venue publishes.
    errors    unknown, upper case and inactive symbols, and futures, perpetual, funding, mark and index paths.
    burst     twenty sequential catalog calls, to look for a 429 or a rate limit header.
    time      the Date header and https://history.bit.team/api/tw/time against the local clock.

Every call is a public GET, at most one at a time, about 90 calls in total.

Run from the repository root:
    uv run scripts/probes/venues/bit-team/rest-probe.py [mode ...]
"""

import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request

BASE = "https://bit.team"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:  # DNS failure, timeout, TLS
        return None, {}, repr(e).encode(), (time.perf_counter() - t0) * 1000


def jget(path):
    status, headers, body, ms = get(BASE + path if path.startswith("/") else path)
    try:
        return status, headers, json.loads(body), ms
    except Exception:
        return status, headers, body[:300].decode(errors="replace"), ms


def access():
    print("== access")
    status, _, body, _ = get("https://ipinfo.io/json")
    try:
        info = json.loads(body)
        print(f"exit: {info.get('city')}, {info.get('region')}, {info.get('country')}, {info.get('org')}")
    except Exception:
        print(f"exit: HTTP {status} {body[:120]!r}")
    for host in ["bit.team", "history.bit.team", "p2p.bit.team", "api-v2.bit.team"]:
        try:
            print(f"dns {host}: {sorted({a[4][0] for a in socket.getaddrinfo(host, 443)})}")
        except Exception as e:
            print(f"dns {host}: {e!r}")
    for path in ["/", "/trade/api/documentation", "/trade/api/documentation.json", "/trade/api/ccxt/pairs"]:
        status, headers, body, ms = get(BASE + path)
        print(f"GET {path}: HTTP {status}, {len(body)} bytes, server {headers.get('Server')}, "
              f"content-type {headers.get('Content-Type')}, {ms:.0f} ms")
    with urllib.request.urlopen(urllib.request.Request(BASE + "/trade/api/cmc/ticker", headers={"User-Agent": UA}), timeout=20) as r:
        print(f"cookies set on a fresh call: {sorted({c.split('=', 1)[0] for c in r.headers.get_all('Set-Cookie') or []})}")
    samples = []
    for _ in range(5):
        _, _, _, ms = get(BASE + "/trade/api/cmc/orderbook/btc_usdt")
        samples.append(ms)
        time.sleep(0.5)
    print(f"latency cmc/orderbook/btc_usdt ms: {[round(s) for s in samples]}, median {statistics.median(samples):.0f}")


def catalog():
    print("== catalog")
    status, _, d, _ = jget("/trade/api/ccxt/pairs")
    pairs = d["result"]["pairs"]
    print(f"ccxt/pairs HTTP {status}, count {d['result']['count']}, listed {len(pairs)}")
    print(f"keys: {sorted(pairs[0].keys())}")
    by = {}
    for p in pairs:
        by.setdefault((p["status"], p["active"]), []).append(p["name"])
    for k, v in sorted(by.items()):
        print(f"status {k[0]} active {k[1]}: {len(v)} {sorted(v)}")
    fees = {}
    for p in pairs:
        fees.setdefault((p["makerFee"], p["takerFee"], p["status"]), []).append(p["name"])
    for k, v in sorted(fees.items()):
        print(f"makerFee {k[0]} takerFee {k[1]} status {k[2]}: {sorted(v)}")
    quotes = {}
    for p in pairs:
        if p["status"] == 1:
            quotes.setdefault(p["name"].split("_")[1], []).append(p["name"])
    print(f"active by quote: { {k: len(v) for k, v in quotes.items()} }")
    for p in sorted(pairs, key=lambda p: -(p.get("volume24USD") or 0))[:6]:
        print(f"volume {p['name']}: volume24USD {p.get('volume24USD')}, baseStep {p['baseStep']}, quoteStep {p['quoteStep']}, "
              f"updateId {p['updateId']}, settings {json.dumps(p['settings'], sort_keys=True)}")
    row = next(p for p in pairs if p["name"] == "btc_usdt")
    print(f"btc_usdt row: {json.dumps(row, separators=(',', ':'))}")
    print(f"(price_tick, pricescale) over all rows: {sorted({(p['settings'].get('price_tick'), p['settings'].get('pricescale')) for p in pairs})}")
    status, _, d2, _ = jget("/trade/api/pairs")
    p2 = d2["result"]["pairs"] if isinstance(d2, dict) and "result" in d2 else []
    print(f"pairs HTTP {status}, listed {len(p2)}, same names as ccxt/pairs {sorted(x['name'] for x in p2) == sorted(x['name'] for x in pairs)}")
    status, _, d3, _ = jget("/trade/api/pair/btc_usdt")
    pr = d3["result"]["pair"]
    print(f"pair/btc_usdt HTTP {status}, numbers as {type(pr['lastPrice']).__name__} for lastPrice, keys {sorted(pr.keys())}")
    status, _, d4, _ = jget("/trade/api/pairs/precisions")
    print(f"pairs/precisions HTTP {status}: {json.dumps(d4)[:300]}")


def side_stats(levels, descending):
    prices = [float(x[0]) for x in levels]
    sizes = [float(x[1]) for x in levels]
    ordered = prices == sorted(prices, reverse=descending)
    dupes = len(prices) - len(set(prices))
    return len(levels), ordered, dupes, sum(1 for s in sizes if s == 0)


def book():
    print("== book")
    _, _, d, _ = jget("/trade/api/ccxt/pairs")
    active = sorted(p["name"] for p in d["result"]["pairs"] if p["status"] == 1)
    for name in active:
        status, headers, b, ms = jget(f"/trade/api/orderbooks/{name}")
        r = b.get("result", {}) if isinstance(b, dict) else {}
        bids, asks = r.get("bids", []), r.get("asks", [])
        bs, as_ = side_stats(bids, True), side_stats(asks, False)
        crossed = bool(bids and asks and float(bids[0][0]) >= float(asks[0][0]))
        ntype = type(bids[0][0]).__name__ if bids else None
        print(f"orderbooks/{name}: HTTP {status}, keys {sorted(r.keys())}, symbol {r.get('symbol')}, "
              f"bids {bs[0]} ordered {bs[1]} dup {bs[2]} zero {bs[3]}, asks {as_[0]} ordered {as_[1]} dup {as_[2]} zero {as_[3]}, "
              f"crossed {crossed}, numbers {ntype}, top {bids[:1]} {asks[:1]}, cache-control {headers.get('Cache-Control')}, {ms:.0f} ms")
        sums = {side: (round(sum(float(x[1]) for x in lv), 8), round(sum(float(x[0]) * float(x[1]) for x in lv), 8)) for side, lv in (("bids", bids), ("asks", asks))}
        print(f"  sums over all levels, (base, quote): {sums}")
        time.sleep(0.3)
        status, _, c, ms = jget(f"/trade/api/cmc/orderbook/{name}")
        if isinstance(c, dict):
            cb, ca = c.get("bids", []), c.get("asks", [])
            ts = c.get("timestamp")
            print(f"cmc/orderbook/{name}: HTTP {status}, keys {sorted(c.keys())}, bids {len(cb)}, asks {len(ca)}, "
                  f"numbers {type(cb[0][0]).__name__ if cb else None}, timestamp {ts}, age vs local {time.time() * 1000 - ts if ts else None:.0f} ms, "
                  f"same top as orderbooks {bool(cb and bids and float(cb[0][0]) == float(bids[0][0]))}")
        time.sleep(0.3)
    for q in ["?depth=5", "?limit=5", "?depth=500&level=2", "?level=3"]:
        status, _, c, _ = jget(f"/trade/api/cmc/orderbook/btc_usdt{q}")
        print(f"cmc/orderbook/btc_usdt{q}: HTTP {status}, bids {len(c.get('bids', []))}, asks {len(c.get('asks', []))}")
        status, _, c, _ = jget(f"/trade/api/orderbooks/btc_usdt{q}")
        r = c.get("result", {}) if isinstance(c, dict) else {}
        print(f"orderbooks/btc_usdt{q}: HTTP {status}, bids {len(r.get('bids', []))}, asks {len(r.get('asks', []))}")
        time.sleep(0.3)


def ticker():
    print("== ticker")
    status, _, t, _ = jget("/trade/api/cmc/ticker")
    print(f"cmc/ticker HTTP {status}, {len(t)} entries, BTC_USDT {json.dumps(t.get('BTC_USDT'))}")
    status, _, s, _ = jget("/trade/api/cmc/summary")
    lst = s if isinstance(s, list) else s.get("result", s)
    first = lst[0] if isinstance(lst, list) and lst else lst
    print(f"cmc/summary HTTP {status}, type {type(lst).__name__}, {len(lst)} entries, first keys {sorted(first.keys()) if isinstance(first, dict) else first}")
    status, _, r, _ = jget("/trade/api/rates")
    res = r.get("result", {}).get("res", []) if isinstance(r, dict) else []
    keys = sorted(k for k in res[0].keys() if k != "icon") if res else []
    print(f"rates HTTP {status}, {len(res)} rows, keys {keys}")
    for row in res[:3]:
        print(f"  rate {json.dumps({k: v for k, v in row.items() if k != 'icon'})[:300]}")


def errors():
    print("== errors")
    paths = [
        "/trade/api/orderbooks/foo_bar",
        "/trade/api/orderbooks/BTC_USDT",
        "/trade/api/orderbooks/eth_btc",
        "/trade/api/orderbooks/22",
        "/trade/api/cmc/orderbook/foo_bar",
        "/trade/api/cmc/orderbook/BTC_USDT",
        "/trade/api/pair/foo_bar",
        "/trade/api/futures/pairs",
        "/trade/api/perpetual/pairs",
        "/trade/api/contracts",
        "/trade/api/funding",
        "/trade/api/mark-price",
        "/trade/api/index",
        "/futures",
        "/trade/futures",
        "/fees",
        "/trade/api/stats",
        "/trade/api/markdown/menu",
    ]
    for p in paths:
        status, headers, body, _ = get(BASE + p)
        ct = headers.get("Content-Type", "")
        text = body[:160].decode(errors="replace") if "json" in ct else f"<{ct}, {len(body)} bytes>"
        print(f"GET {p}: HTTP {status} {text}")
        time.sleep(0.3)


def burst():
    print("== burst")
    statuses, limit_headers = [], set()
    t0 = time.time()
    for _ in range(20):
        status, headers, _, _ = get(BASE + "/trade/api/ccxt/pairs")
        statuses.append(status)
        limit_headers |= {k for k in headers if "limit" in k.lower() or "retry" in k.lower()}
    print(f"20 sequential calls in {time.time() - t0:.1f} s: statuses {sorted(set(statuses))}, rate limit headers {sorted(limit_headers) or 'none'}")


def clock():
    print("== time")
    status, headers, _, ms = get(BASE + "/trade/api/cmc/ticker")
    print(f"Date header {headers.get('Date')}, local {time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime())}, round trip {ms:.0f} ms")
    t_local = time.time()
    status, _, body, ms = get("https://history.bit.team/api/tw/time")
    try:
        server = int(body.decode().strip())
        print(f"history /api/tw/time HTTP {status}: {server}, local {t_local:.1f}, offset {server - t_local:.1f} s, round trip {ms:.0f} ms")
    except Exception:
        print(f"history /api/tw/time HTTP {status}: {body[:200]!r}")
    status, _, c, _ = jget("/trade/api/cmc/orderbook/btc_usdt")
    if isinstance(c, dict) and c.get("timestamp"):
        print(f"cmc/orderbook timestamp {c['timestamp']} against local {time.time() * 1000:.0f}")


MODES = {"access": access, "catalog": catalog, "book": book, "ticker": ticker, "errors": errors, "burst": burst, "time": clock}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    print(f"run at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    for m in chosen:
        MODES[m]()
