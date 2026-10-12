# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""COINSPACE public REST probe for docs/profiles/coinspace/rest.md.

Public, unauthenticated and read-only.
The hosts are the ones the www.coinspace.world web app and CoinMarketCap's listing use.
The venue's edge advertises 100 requests a minute, 500 per 15 minutes and 1000 an hour.
This probe sends about 80 requests to COINSPACE over about 2.5 minutes, never faster than one each 1.5 s.
It also reads Binance USD-M futures once per COINSPACE read, to test whether COINSPACE relays that book.
Run from the repository root with: uv run scripts/probes/venues/coinspace/rest-probe.py
"""

import email.utils
import http.client
import json
import socket
import ssl
import statistics
import time

WWW = "www.coinspace.world"
API = "api.coinspace.world"
FAPI = "fapi.binance.com"
CTX = ssl.create_default_context()
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
PACE = 1.5
POLL_SECONDS = 60

_conns: dict[str, http.client.HTTPSConnection] = {}


def get(host: str, path: str, fresh: bool = False):
    """One GET over a kept-alive connection per host. Returns status, headers, text, seconds."""
    if fresh and host in _conns:
        _conns.pop(host).close()
    if host not in _conns:
        _conns[host] = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    conn = _conns[host]
    t0 = time.perf_counter()
    try:
        conn.request("GET", path, headers=UA)
        resp = conn.getresponse()
        text = resp.read().decode("utf-8", "replace")
    except (http.client.HTTPException, OSError):
        _conns.pop(host).close()
        if fresh:
            raise
        return get(host, path, fresh=True)  # the edge drops a kept-alive connection after some idle seconds
    return resp.status, {k.lower(): v for k, v in resp.getheaders()}, text, time.perf_counter() - t0


def cs(path: str, fresh: bool = False, host: str = WWW):
    out = get(host, path, fresh)
    time.sleep(PACE)
    return out


def show(label, status, headers, text, secs, limit=240):
    keep = ("server", "content-type", "cache-control", "x-cache", "etag", "age", "retry-after",
            "x-ratelimit-limit-short", "x-ratelimit-remaining-short", "x-ratelimit-reset-short",
            "x-ratelimit-limit-medium", "x-ratelimit-limit-long", "access-control-allow-origin")
    print(f"\n== {label}: HTTP {status}, {len(text)} bytes, {secs * 1000:.0f} ms")
    print("   headers:", {k: v for k, v in headers.items() if k in keep})
    print("   body:", text[:limit].replace("\n", " "))


def latency():
    print("\n### 1. DNS and latency")
    for host in (WWW, API):
        addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        print("resolved", host, addrs)
    for host, path in ((WWW, "/proxy/api/v1/markets"), (API, "/api/public/symbols")):
        cold = [cs(path, fresh=True, host=host)[3] * 1000 for _ in range(3)]
        warm = [cs(path, host=host)[3] * 1000 for _ in range(6)]
        print(f"{host}{path}: cold ms {[round(x) for x in cold]}, warm ms min {min(warm):.0f} "
              f"median {statistics.median(warm):.0f} max {max(warm):.0f}")


def catalog():
    print("\n### 2. Catalog")
    st, h, text, secs = cs("/api/public/symbols", host=API)
    show("GET api.coinspace.world/api/public/symbols", st, h, text, secs)
    syms = json.loads(text)
    active = [s for s in syms if s.get("is_active")]
    print(f"symbols {len(syms)}, is_active true {len(active)}, quotes {sorted({s['symbol'].split('/')[1] for s in syms})}")
    print("fields", sorted(syms[0].keys()))
    print("max_leverage values", sorted({s.get("max_leverage") for s in syms}))
    print("list", sorted(s["symbol"] for s in syms))
    btc = next(s for s in syms if s["symbol"] == "BTC/USDT")
    print("BTC/USDT row", json.dumps(btc))

    st, h, text, secs = cs("/proxy/api/v1/markets")
    show("GET www.coinspace.world/proxy/api/v1/markets", st, h, text, secs)
    mk = json.loads(text)
    print(f"markets rows {len(mk)}, types {sorted({m.get('type') for m in mk})}, fields {sorted(mk[0].keys())}")
    cat = {s["symbol"].replace("/", "") for s in syms}
    print("markets symbols equal catalog symbols:", {m["symbol"] for m in mk} == cat,
          "catalog symbols missing from markets", sorted(cat - {m["symbol"] for m in mk}))
    print("markets symbols", sorted(m["symbol"] for m in mk))
    st, h, text, secs = cs("/proxy/api/v1/fees")
    fees = json.loads(text)
    print(f"fees rows {len(fees)}, symbols not in markets", sorted({f["symbol"] for f in fees} - {m["symbol"] for m in mk}))
    return sorted(cat), sorted({m["symbol"] for m in mk})


def binance_perps(symbols):
    st, h, text, secs = get(FAPI, "/fapi/v1/exchangeInfo")
    show("GET fapi.binance.com/fapi/v1/exchangeInfo", st, h, text, secs, limit=120)
    if st != 200:
        return
    info = {s["symbol"]: s for s in json.loads(text)["symbols"]}
    hits = [s for s in symbols if s in info and info[s]["contractType"] == "PERPETUAL" and info[s]["status"] == "TRADING"]
    print(f"COINSPACE symbols that are a TRADING Binance USD-M perpetual: {len(hits)} of {len(symbols)}")
    st, h, text, _ = cs("/api/public/symbols", host=API)
    ticks = 0
    if len(symbols) != len(json.loads(text)):
        return
    for s in json.loads(text):
        b = info.get(s["symbol"].replace("/", ""))
        pf = next(f for f in b["filters"] if f["filterType"] == "PRICE_FILTER") if b else None
        if pf and float(pf["tickSize"]) == float(s["price_tick_size"]):
            ticks += 1
    print(f"price_tick_size equal to Binance PRICE_FILTER tickSize: {ticks} of {len(symbols)}")


def relay_check():
    print("\n### 3. Depth, trades and ticker against Binance USD-M")
    st, h, text, secs = cs("/proxy/api/v1/depth?symbol=BTCUSDT")
    show("GET /proxy/api/v1/depth?symbol=BTCUSDT", st, h, text, secs, limit=400)
    d = json.loads(text)
    bids = [l["price"] for l in d["bids"]]
    asks = [l["price"] for l in d["asks"]]
    print(f"levels bids {len(bids)} asks {len(asks)}, bids descending {bids == sorted(bids, reverse=True)}, "
          f"asks ascending {asks == sorted(asks)}, keys {sorted(d.keys())}, level keys {sorted(d['bids'][0].keys())}")
    for q in ("limit=50", "limit=1000", "depth=50", "size=100"):
        st, _, t2, _ = cs(f"/proxy/api/v1/depth?symbol=BTCUSDT&{q}")
        dd = json.loads(t2) if st == 200 else {}
        print(f"depth with {q}: HTTP {st}, levels {len(dd.get('bids', []))}/{len(dd.get('asks', []))}")

    st, h, text, secs = cs("/proxy/api/v1/trades?symbol=BTCUSDT")
    show("GET /proxy/api/v1/trades?symbol=BTCUSDT", st, h, text, secs)
    tr = json.loads(text)
    st2, _, t2, _ = get(FAPI, "/fapi/v1/trades?symbol=BTCUSDT&limit=1000")
    bt = {t["id"]: t for t in json.loads(t2)} if st2 == 200 else {}
    same = sum(1 for t in tr if t["trade_id"] in bt and float(bt[t["trade_id"]]["price"]) == t["price"]
               and float(bt[t["trade_id"]]["qty"]) == t["volume"])
    print(f"trades rows {len(tr)}, trade_id present in Binance /fapi/v1/trades with equal price and qty: {same} "
          f"(Binance window {min(bt) if bt else '-'} to {max(bt) if bt else '-'}), timestamp unit sample {tr[0]['timestamp']}")

    st, h, text, secs = cs("/proxy/api/v1/ticker?symbol=BTCUSDT")
    show("GET /proxy/api/v1/ticker?symbol=BTCUSDT", st, h, text, secs)


def depth_poll():
    print(f"\n### 4. Depth poll, {POLL_SECONDS} s, BTCUSDT, COINSPACE then Binance fapi depth limit 10")
    rows = []
    end = time.time() + POLL_SECONDS
    while time.time() < end:
        st, h, text, secs = get(WWW, "/proxy/api/v1/depth?symbol=BTCUSDT")
        t_cs = time.time() * 1000
        st2, _, t2, secs2 = get(FAPI, "/fapi/v1/depth?symbol=BTCUSDT&limit=10")
        if st == 200 and st2 == 200:
            c, b = json.loads(text), json.loads(t2)
            ctop = [(l["price"], l["volume"]) for l in c["bids"][:10]], [(l["price"], l["volume"]) for l in c["asks"][:10]]
            btop = [(float(p), float(q)) for p, q in b["bids"]], [(float(p), float(q)) for p, q in b["asks"]]
            rows.append({"cs_ms": secs * 1000, "age": t_cs - c["time"], "xcache": h.get("x-cache"),
                         "same_prices": [p for p, _ in ctop[0]] == [p for p, _ in btop[0]]
                         and [p for p, _ in ctop[1]] == [p for p, _ in btop[1]],
                         "same_book": ctop == btop, "top": (ctop[0][0][0], ctop[1][0][0], btop[0][0][0], btop[1][0][0]),
                         "remaining": h.get("x-ratelimit-remaining-short")})
        time.sleep(PACE)
    n = len(rows)
    print(f"polls {n}, COINSPACE ms median {statistics.median(r['cs_ms'] for r in rows):.0f} max {max(r['cs_ms'] for r in rows):.0f}")
    print(f"reply time field age vs local clock ms: min {min(r['age'] for r in rows):.0f} median "
          f"{statistics.median(r['age'] for r in rows):.0f} max {max(r['age'] for r in rows):.0f}")
    print(f"10 price levels per side equal to Binance read about {statistics.median(r['cs_ms'] for r in rows):.0f} ms later: "
          f"{sum(r['same_prices'] for r in rows)} of {n}, prices and sizes equal: {sum(r['same_book'] for r in rows)} of {n}")
    print(f"best bid and ask equal: {sum(r['top'][0] == r['top'][2] and r['top'][1] == r['top'][3] for r in rows)} of {n}")
    print("x-cache values", sorted({str(r['xcache']) for r in rows}), "last remaining-short", rows[-1]["remaining"])


def anchor_and_errors():
    print("\n### 5. Anchor search, errors and clock")
    for path in ("/proxy/api/v1/premiumIndex?symbol=BTCUSDT", "/proxy/api/v1/funding?symbol=BTCUSDT",
                 "/proxy/api/v1/fundingRate?symbol=BTCUSDT", "/proxy/api/v1/markPrice?symbol=BTCUSDT",
                 "/proxy/api/v1/index?symbol=BTCUSDT", "/proxy/api/v1/time",
                 "/proxy/api/v1/ticker?symbol=NOPEUSDT", "/proxy/api/v1/depth?symbol=NOPEUSDT",
                 "/proxy/api/v1/depth", "/proxy/api/v1/orderbook/BTC_USDT"):
        st, h, text, secs = cs(path)
        print(f"{path}: HTTP {st}, {text[:160]}")
    for path in ("/api/membership/tiers", "/api/settings/kyc", "/api/public/funding", "/api/public/markets"):
        st, h, text, secs = cs(path, host=API)
        print(f"api {path}: HTTP {st}, {text[:160]}")
    st, h, text, secs = get(FAPI, "/fapi/v1/premiumIndex?symbol=BTCUSDT")
    print(f"Binance /fapi/v1/premiumIndex?symbol=BTCUSDT, the call the COINSPACE trade page makes: HTTP {st}, {text[:200]}")
    st, h, text, secs = get(FAPI, "/fapi/v1/fundingInfo")
    if st == 200:
        listed = json.loads(cs("/proxy/api/v1/markets")[2])
        intervals = {r["symbol"]: r.get("fundingIntervalHours") for r in json.loads(text)}
        print("Binance funding interval hours for the COINSPACE markets symbols (absent means the default 8):",
              {m["symbol"]: intervals.get(m["symbol"], 8) for m in listed})
    offsets = []
    for _ in range(3):
        t0 = time.time()
        st, h, text, secs = cs("/proxy/api/v1/ticker?symbol=BTCUSDT")
        mid = t0 + secs / 2
        offsets.append((json.loads(text)["time"] / 1000) - mid)
        date = email.utils.parsedate_to_datetime(h["date"]).timestamp()
        print(f"Date header {h['date']}, header minus local mid {date - mid:+.2f} s")
    print("ticker time minus local mid, s:", [round(o, 3) for o in offsets])


def main():
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    latency()
    symbols, listed = catalog()
    binance_perps(symbols)
    binance_perps(listed)
    relay_check()
    depth_poll()
    anchor_and_errors()
    print("\nprobe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
