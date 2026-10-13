# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of the Hibachi public market data REST API on data-api.hibachi.xyz.

Modes: host (about 5 s), catalog (about 2 s), anchor (about 75 s), funding (about 5 s), book (about 5 s),
errors (about 5 s), time (about 3 s), identity (about 10 s), and all of them in turn by default.
Run from the repository root: uv run scripts/probes/venues/hibachi/rest-probe.py [mode ...]
Captures go to .claude/survey-work/hibachi/.
Every call is a public GET, no credentials are used, and the pace stays far below the published 350 requests per 10 s per IP.
"""

import gzip
import http.client
import json
import socket
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/hibachi")
HOST = "data-api.hibachi.xyz"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"


def iso(sec: float | None) -> str:
    if sec is None:
        return "-"
    return datetime.fromtimestamp(float(sec), timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class Client:
    """One kept TLS connection, so the first request is cold and the rest are warm."""

    def __init__(self, host: str = HOST):
        self.host = host
        self.conn: http.client.HTTPSConnection | None = None

    def get(self, path: str, gzip_ok: bool = False) -> tuple[int, dict, bytes, float]:
        if self.conn is None:
            self.conn = http.client.HTTPSConnection(self.host, timeout=20)
        headers = {"User-Agent": UA, "Accept": "application/json"}
        if gzip_ok:
            headers["Accept-Encoding"] = "gzip"
        t0 = time.perf_counter()
        try:
            self.conn.request("GET", path, headers=headers)
            r = self.conn.getresponse()
            body = r.read()
        except (http.client.HTTPException, OSError):
            self.conn.close()
            self.conn = http.client.HTTPSConnection(self.host, timeout=20)
            self.conn.request("GET", path, headers=headers)
            r = self.conn.getresponse()
            body = r.read()
        ms = (time.perf_counter() - t0) * 1000
        hdrs = {k.lower(): v for k, v in r.getheaders()}
        return r.status, hdrs, body, ms


def q(symbol: str) -> str:
    return urllib.parse.quote(symbol, safe="/")


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]


def mode_host() -> None:
    for h in (HOST, "api.hibachi.xyz"):
        t0 = time.perf_counter()
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        print(f"[host] {now()} {h} resolves to {addrs} in {(time.perf_counter() - t0) * 1000:.0f} ms")
    c = Client()
    paths = [
        "/exchange/utc-timestamp",
        "/market/exchange-info",
        "/market/inventory",
        "/market/data/prices?symbol=BTC/USDT-P",
        "/market/data/stats?symbol=BTC/USDT-P",
        "/market/data/orderbook?symbol=BTC/USDT-P",
        "/market/data/funding-rates?symbol=BTC/USDT-P&limit=5",
        "/market/data/open-interest?symbol=BTC/USDT-P",
        "/market/data/trades?symbol=BTC/USDT-P",
    ]
    for i, p in enumerate(paths):
        status, h, body, ms = c.get(p)
        tag = "cold, with TLS" if i == 0 else "warm"
        print(f"[host] GET {p} {status} {len(body)} bytes {ms:.0f} ms ({tag}) server={h.get('server')} cf-ray={h.get('cf-ray')} content-encoding={h.get('content-encoding')} rate-limit headers={ {k: v for k, v in h.items() if 'limit' in k or 'retry' in k} }")
        time.sleep(0.2)
    status, h, body, ms = c.get("/market/inventory", gzip_ok=True)
    print(f"[host] GET /market/inventory with Accept-Encoding gzip: {status} {len(body)} bytes on the wire, content-encoding={h.get('content-encoding')}, {ms:.0f} ms")
    warm = []
    for _ in range(10):
        status, h, body, ms = c.get("/exchange/utc-timestamp")
        warm.append(ms)
        time.sleep(0.2)
    print(f"[host] utc-timestamp warm x10: min {min(warm):.0f} median {statistics.median(warm):.0f} max {max(warm):.0f} ms")


def mode_catalog() -> None:
    c = Client()
    status, h, body, ms = c.get("/market/exchange-info")
    ei = json.loads(body)
    (WORK / "rest-exchange-info.json").write_text(json.dumps(ei, indent=1))
    fc = ei["futureContracts"]
    print(f"[catalog] {now()} exchange-info {status} {len(body)} bytes {ms:.0f} ms, top keys {sorted(ei)}, status {ei.get('status')}")
    print(f"[catalog] futureContracts {len(fc)}, by (status, symbolStatus, category, settlementSymbol): {dict(Counter((x['status'], x.get('symbolStatus'), x.get('category'), x['settlementSymbol']) for x in fc))}")
    print(f"[catalog] maintenanceWindow {[(iso(w['begin']), iso(w['end']), w.get('note')) for w in ei.get('maintenanceWindow', [])]}")
    for x in fc:
        print(
            f"[catalog] id={x['id']:<3} {x['symbol']:<12} {x['status']:<6} {x.get('symbolStatus'):<6} {x.get('category'):<6} base={x['underlyingSymbol']} "
            f"uDec={x['underlyingDecimals']} sDec={x['settlementDecimals']} tick={x['tickSize']} step={x['stepSize']} gran={x['orderbookGranularities']} "
            f"open={iso(x['marketOpenTimestamp'])} close={iso(x['marketCloseTimestamp'])} nextOpen={iso(x.get('nextOpenTimestamp'))} nextClose={iso(x.get('nextCloseTimestamp'))}"
        )
    status, h, body, ms = c.get("/market/inventory")
    inv = json.loads(body)
    (WORK / "rest-inventory.json").write_text(json.dumps(inv, indent=1))
    ms_ = inv["markets"]
    print(f"[catalog] inventory {status} {len(body)} bytes {ms:.0f} ms, markets {len(ms_)}, by (status, category): {dict(Counter((m['contract']['status'], m['contract'].get('category')) for m in ms_))}")
    live_inv = sorted(m["contract"]["symbol"] for m in ms_ if m["contract"]["status"] == "LIVE")
    live_ei = sorted(x["symbol"] for x in fc if x["status"] == "LIVE")
    print(f"[catalog] LIVE in inventory equals LIVE in exchange-info: {live_inv == live_ei}")
    nulls = [m["contract"]["symbol"] for m in ms_ if m["contract"]["status"] == "LIVE" and (m["info"].get("markPrice") is None or m["info"].get("spotPrice") is None)]
    print(f"[catalog] LIVE rows with a null mark or spot: {nulls}")
    closed_with_prices = [m["contract"]["symbol"] for m in ms_ if m["contract"]["status"] != "LIVE" and m["info"].get("markPrice") is not None]
    print(f"[catalog] non-LIVE rows with a mark: {closed_with_prices}")
    odd = [m["contract"]["symbol"] for m in ms_ if not m["contract"]["symbol"].endswith("/USDT-P") or "_" in m["contract"]["symbol"]]
    print(f"[catalog] symbols outside the BASE/USDT-P shape: {odd}")
    print(f"[catalog] info tags of LIVE rows: { {m['contract']['symbol']: (m['info'].get('tags'), m['info'].get('category')) for m in ms_ if m['contract']['status'] == 'LIVE'} }")
    print(f"[catalog] contract keys {sorted(set(k for m in ms_ for k in m['contract']))}")
    print(f"[catalog] contract ids by symbol stem for EUR: {[(m['contract']['id'], m['contract']['symbol'], m['contract']['status'], m['contract'].get('category'), iso(m['contract'].get('marketOpenTimestamp')), iso(m['contract'].get('marketCloseTimestamp'))) for m in ms_ if m['contract']['symbol'].startswith('EUR')]}")
    for ch in inv.get("chains", []):
        print(f"[catalog] chain {ch}")
    for a in inv.get("chainAssets", []):
        print(f"[catalog] chain asset {a}")


def mode_anchor(polls: int = 60) -> None:
    c = Client()
    first = {}
    changes = defaultdict(Counter)
    last = {}
    times = []
    sizes = []
    rounds = []
    t_start = time.time()
    for i in range(polls):
        t_send = time.time()
        status, h, body, ms = c.get("/market/inventory")
        times.append(ms)
        sizes.append(len(body))
        if status != 200:
            print(f"[anchor] poll {i} status {status} {body[:200]!r}")
            time.sleep(1)
            continue
        inv = json.loads(body)
        row = {}
        for m in inv["markets"]:
            if m["contract"]["status"] != "LIVE":
                continue
            s = m["contract"]["symbol"]
            info = m["info"]
            vals = (info.get("markPrice"), info.get("spotPrice"), info.get("estimatedFundingRate"), info.get("bestBidPrice"), info.get("bestAskPrice"))
            row[s] = vals
            if s in last:
                for k, name in enumerate(("mark", "spot", "funding", "bid", "ask")):
                    if vals[k] != last[s][k]:
                        changes[s][name] += 1
            else:
                first[s] = vals
            last[s] = vals
        rounds.append((t_send, row))
        time.sleep(max(0.0, 1.0 - (time.time() - t_send)))
    dur = time.time() - t_start
    print(f"[anchor] {now()} /market/inventory polled {polls} times in {dur:.1f} s: reply min {min(times):.0f} median {statistics.median(times):.0f} p90 {pct(times, 0.9):.0f} max {max(times):.0f} ms, {min(sizes)} to {max(sizes)} bytes")
    print(f"[anchor] changes over {polls - 1} consecutive polls, per LIVE market: mark, spot, funding, bid, ask")
    for s in sorted(changes, key=lambda s: s):
        cc = changes[s]
        print(f"[anchor]   {s:<12} mark {cc['mark']:>2} spot {cc['spot']:>2} funding {cc['funding']:>2} bid {cc['bid']:>2} ask {cc['ask']:>2}  last mark={last[s][0]} spot={last[s][1]} funding={last[s][2]}")
    gaps = []
    for s in last:
        mk, sp = float(last[s][0]), float(last[s][1])
        gaps.append((abs(mk / sp - 1) * 1e6, s))
    print(f"[anchor] |mark/spot - 1| in ppm at the last poll: {[(s, round(g)) for g, s in sorted(gaps, reverse=True)]}")
    # Per market endpoint, for the server stamp and the next funding time.
    ages = []
    nexts = Counter()
    for i in range(15):
        t_send = time.time()
        status, h, body, ms = c.get("/market/data/prices?symbol=BTC/USDT-P")
        t_recv = time.time()
        d = json.loads(body)
        ages.append(t_recv * 1000 - d["timestampMs"])
        nexts[(d["fundingRateEstimation"]["nextFundingTimestamp"])] += 1
        time.sleep(max(0.0, 1.0 - (time.time() - t_send)))
    print(f"[anchor] /market/data/prices BTC x15: arrival minus timestampMs min {min(ages):.0f} median {statistics.median(ages):.0f} max {max(ages):.0f} ms, nextFundingTimestamp values {[(k, iso(k)) for k in nexts]}")
    print(f"[anchor] last prices reply: {json.dumps(d)}")
    # Every LIVE market once, for the shape of the next funding time.
    live = sorted(last)
    nf = {}
    for s in live:
        status, h, body, ms = c.get("/market/data/prices?symbol=" + q(s))
        d = json.loads(body)
        nf[s] = (d["fundingRateEstimation"]["nextFundingTimestamp"], d["fundingRateEstimation"]["estimatedFundingRate"], d.get("markPrice"), d.get("spotPrice"))
        time.sleep(0.15)
    print(f"[anchor] nextFundingTimestamp per LIVE market: { {s: iso(v[0]) for s, v in nf.items()} }")
    (WORK / "rest-anchor-rounds.json").write_text(json.dumps([[t, r] for t, r in rounds]))


def mode_funding() -> None:
    c = Client()
    now_s = int(time.time())
    for sym in ("BTC/USDT-P", "EUR/USDT-P", "XAG/USDT-P", "JPY/USDT-P", "PAXG/USDT-P"):
        start = now_s - 80 * 3600
        status, h, body, ms = c.get(f"/market/data/funding-rates?symbol={q(sym)}&startTime={start}&endTime={now_s}&limit=100")
        d = json.loads(body)
        rows = d.get("data", [])
        ts = [r["fundingTimestamp"] for r in rows]
        steps = Counter(int(b - a) for a, b in zip(ts, ts[1:]))
        missing = []
        if ts:
            have = set(int(t) for t in ts)
            hour = int(ts[0])
            while hour <= int(ts[-1]):
                if hour not in have:
                    missing.append(iso(hour)[5:16])
                hour += 3600
        rates = [float(r["fundingRate"]) for r in rows]
        print(f"[funding] {now()} {sym} {status} {len(body)} bytes {ms:.0f} ms rows {len(rows)} from {iso(ts[0]) if ts else '-'} to {iso(ts[-1]) if ts else '-'} steps {dict(steps)} pagination {d.get('pagination')}")
        if rates:
            print(f"[funding]   rate min {min(rates)} max {max(rates)} last 3 {[(iso(r['fundingTimestamp'])[11:16], r['fundingRate'], r.get('indexPrice')) for r in rows[-3:]]}")
        print(f"[funding]   whole hours with no row: {len(missing)} {missing[:12]}{' ...' if len(missing) > 12 else ''}")
        time.sleep(0.3)
    status, h, body, ms = c.get("/market/data/funding-rates?symbol=BTC/USDT-P&limit=3")
    d = json.loads(body)
    print(f"[funding] no startTime, limit 3: first row {iso(d['data'][0]['fundingTimestamp'])} keys {sorted(d['data'][0])}")


def mode_book() -> None:
    c = Client()
    for qs in (
        "symbol=BTC/USDT-P",
        "symbol=BTC/USDT-P&depth=100",
        "symbol=BTC/USDT-P&depth=50&granularity=1",
        "symbol=ETH/USDT-P&depth=100",
        "symbol=JPY/USDT-P",
        "symbol=XAG/USDT-P&depth=100",
    ):
        status, h, body, ms = c.get("/market/data/orderbook?" + qs)
        if status != 200:
            print(f"[book] {qs} {status} {body[:300]!r}")
            continue
        d = json.loads(body)
        b, a = d["bid"]["levels"], d["ask"]["levels"]
        bp = [float(x["price"]) for x in b]
        ap = [float(x["price"]) for x in a]
        print(
            f"[book] {now()} {qs} {status} {len(body)} bytes {ms:.0f} ms bids {len(b)} asks {len(a)} bids descending {bp == sorted(bp, reverse=True)} asks ascending {ap == sorted(ap)} "
            f"bid start/end {d['bid'].get('startPrice')}/{d['bid'].get('endPrice')} ask start/end {d['ask'].get('startPrice')}/{d['ask'].get('endPrice')} top {b[:1]} {a[:1]} keys {sorted(d)}"
        )
        time.sleep(0.25)
    same = 0
    prev = None
    for i in range(6):
        status, h, body, ms = c.get("/market/data/orderbook?symbol=BTC/USDT-P")
        if prev is not None and body == prev:
            same += 1
        prev = body
        time.sleep(0.2)
    print(f"[book] six BTC reads 0.2 s apart: {same} of 5 identical to the read before")


def mode_errors() -> None:
    c = Client()
    for p in (
        "/market/data/prices?symbol=FOO/USDT-P",
        "/market/data/prices?symbol=DOGE/USDT-P",
        "/market/data/prices",
        "/market/data/prices?symbol=btc/usdt-p",
        "/market/data/orderbook?symbol=BTC/USDT-P&granularity=0.5",
        "/market/data/orderbook?symbol=BTC/USDT-P&depth=101",
        "/market/data/orderbook?symbol=BTC/USDT-P&depth=0",
        "/market/data/orderbook?symbol=DOGE/USDT-P",
        "/market/data/funding-rates?symbol=FOO/USDT-P",
        "/market/nothing",
    ):
        status, h, body, ms = c.get(p)
        print(f"[errors] {now()} GET {p} {status} {ms:.0f} ms content-type={h.get('content-type')} body={body[:300]!r}")
        time.sleep(0.25)


def mode_time() -> None:
    c = Client()
    c.get("/exchange/utc-timestamp")
    offs, rtts = [], []
    for _ in range(10):
        t0 = time.time() * 1000
        status, h, body, ms = c.get("/exchange/utc-timestamp")
        t1 = time.time() * 1000
        srv = json.loads(body)["timestampMs"]
        offs.append(srv - (t0 + t1) / 2)
        rtts.append(t1 - t0)
        time.sleep(0.2)
    print(f"[time] {now()} utc-timestamp x10: server minus local midpoint min {min(offs):.0f} median {statistics.median(offs):.0f} max {max(offs):.0f} ms, round trip median {statistics.median(rtts):.0f} ms, reply {body!r}")


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw)


def mode_identity() -> None:
    """Which reference venues list a perpetual on Hibachi's FX, metal and gold bases, and at what price."""
    bases = ["EUR", "GBP", "AUD", "NZD", "JPY", "CAD", "XAG", "PAXG", "XAU"]
    inv = json.loads(Client().get("/market/inventory")[2])
    hib = {m["contract"]["underlyingSymbol"]: m["info"].get("markPrice") for m in inv["markets"] if m["contract"]["status"] == "LIVE"}
    print(f"[identity] {now()} Hibachi marks: { {b: hib.get(b) for b in bases if b in hib} }")
    found = defaultdict(list)
    try:
        d = fetch_json("https://fapi.binance.com/fapi/v1/premiumIndex")
        for r in d:
            for b in bases:
                if r["symbol"] in (f"{b}USDT", f"{b}USDC"):
                    found[b].append(("binance", r["symbol"], r["markPrice"]))
    except Exception as e:
        print(f"[identity] binance failed: {e}")
    try:
        d = fetch_json("https://api.bybit.com/v5/market/tickers?category=linear")
        for r in d["result"]["list"]:
            for b in bases:
                if r["symbol"] in (f"{b}USDT", f"{b}PERP"):
                    found[b].append(("bybit", r["symbol"], r["markPrice"]))
    except Exception as e:
        print(f"[identity] bybit failed: {e}")
    try:
        d = fetch_json("https://www.okx.com/api/v5/public/mark-price?instType=SWAP")
        for r in d["data"]:
            for b in bases:
                if r["instId"] in (f"{b}-USDT-SWAP", f"{b}-USD-SWAP", f"{b}-USDC-SWAP"):
                    found[b].append(("okx", r["instId"], r["markPx"]))
    except Exception as e:
        print(f"[identity] okx failed: {e}")
    try:
        d = fetch_json("https://api.gateio.ws/api/v4/futures/usdt/contracts")
        for r in d:
            for b in bases:
                if r["name"] == f"{b}_USDT":
                    found[b].append(("gate", r["name"], r["mark_price"]))
    except Exception as e:
        print(f"[identity] gate failed: {e}")
    try:
        d = fetch_json("https://contract.mexc.com/api/v1/contract/ticker")
        for r in d["data"]:
            for b in bases:
                if r["symbol"] == f"{b}_USDT":
                    found[b].append(("mexc", r["symbol"], r.get("fairPrice")))
    except Exception as e:
        print(f"[identity] mexc failed: {e}")
    for b in bases:
        h = hib.get(b)
        rows = found.get(b, [])
        ratios = [(v, s, round(float(p) / float(h), 4) if h and p else None) for v, s, p in rows]
        print(f"[identity] {b:<5} hibachi mark {h} | references {ratios if ratios else 'none'}")


MODES = {
    "host": mode_host,
    "catalog": mode_catalog,
    "anchor": mode_anchor,
    "funding": mode_funding,
    "book": mode_book,
    "errors": mode_errors,
    "time": mode_time,
    "identity": mode_identity,
}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    chosen = sys.argv[1:] or list(MODES)
    for name in chosen:
        MODES[name]()
