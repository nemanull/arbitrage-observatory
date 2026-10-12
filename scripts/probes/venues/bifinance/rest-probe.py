# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for BiFinance perpetuals, for docs/profiles/bifinance/rest.md.

BiFinance publishes no futures API.
The only futures REST surface is the web app's own API under https://www.bifinance.com/api.
Its spot calls answer unsigned, but its contract calls answer HTTP 500 unless the request carries
the web app's MD5 request signature, whose key ships in the public JS bundle (assets/index-411dd017.js).
This probe sends exactly what the browser sends, for public market data only, with no account and no token.

Modes, each runnable alone: host, catalog, anchor, poll, funding, book, errors, limits, all (the default).
Run from the repository root: uv run scripts/probes/venues/bifinance/rest-probe.py [mode]
Captures go to .claude/survey-work/bifinance/.
"""

import collections
import hashlib
import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/bifinance")
API = "https://www.bifinance.com/api"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
SIGN_KEY = "mnn#QyrnvLcBbGdX7" + "tWNZImfINb7cTL" + "r"  # SLSICHHOREO in the bundle, joined the same way
BINANCE_PREMIUM = "https://fapi.binance.com/fapi/v1/premiumIndex"
BINANCE_BOOK = "https://fapi.binance.com/fapi/v1/ticker/bookTicker"


def sign(body: dict, now_ms: int) -> str:
    """The bundle's requestSign: add time = now - 688, sort keys, append key, join k=v with &, MD5."""
    fields = dict(body)
    fields["time"] = now_ms - 688
    parts = []
    for k in sorted(fields):
        v = fields[k]
        parts.append(f"{k}={json.dumps(v, separators=(',', ':')) if isinstance(v, (dict, list)) else v}")
    parts.append(f"key={SIGN_KEY}")
    return hashlib.md5("&".join(parts).encode()).hexdigest()


def post(path: str, body: dict, signed: bool = True, bad_signature: bool = False) -> tuple[int, dict, bytes, float]:
    now_ms = int(time.time() * 1000)
    headers = {"Content-Type": "application/json", "User-Agent": UA, "language": "en_US"}
    if signed:
        headers.update({"time": str(now_ms), "deviceType": "3", "signature": "0" * 32 if bad_signature else sign(body, now_ms)})
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers=headers, method="POST")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            raw = reply.read()
            return reply.status, dict(reply.headers), raw, (time.perf_counter() - start) * 1000
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(), (time.perf_counter() - start) * 1000


def data(path: str, body: dict, signed: bool = True):
    status, _, raw, ms = post(path, body, signed)
    doc = json.loads(raw)
    if status != 200 or doc.get("code") != 1:
        raise RuntimeError(f"{path} {status} {raw[:200]!r}")
    return doc["data"], ms, len(raw)


def get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.load(reply)


def save(name: str, obj) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False))


def utc(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def catalog() -> list[dict]:
    rows, _, _ = data("/contract-market/get-all-contract-coinmarket", {})
    return rows


def mode_host() -> None:
    print("== host")
    print("www.bifinance.com resolves to", sorted({a[4][0] for a in socket.getaddrinfo("www.bifinance.com", 443, proto=socket.IPPROTO_TCP)}))
    times = []
    for _ in range(6):
        status, headers, raw, ms = post("/market/tickers", {}, signed=False)
        times.append(ms)
    print(f"unsigned spot /market/tickers: status {status}, {len(raw)} bytes, first {times[0]:.0f} ms, warm median {statistics.median(times[1:]):.0f} ms")
    times = []
    for _ in range(6):
        status, headers, raw, ms = post("/contract-market/get-all-contract-coinmarket", {})
        times.append(ms)
    print(f"signed contract catalog: status {status}, {len(raw)} bytes, first {times[0]:.0f} ms, warm median {statistics.median(times[1:]):.0f} ms")
    print("server Date header:", headers.get("Date"), " local:", utc(time.time()))
    for name in ("Server", "Via", "X-Cache", "Cache-Control", "x-req-id", "Retry-After"):
        if name in headers:
            print(f"header {name}: {headers[name]}")


def mode_catalog() -> None:
    print("== catalog")
    rows = catalog()
    save("catalog.json", rows)
    print("contracts:", len(rows), "settle:", dict(collections.Counter(r["marketCoinName"] for r in rows)), "onDealing:", dict(collections.Counter(r["onDealing"] for r in rows)))
    print("fields:", sorted(rows[0]))
    for r in rows:
        if r["coinMarket"] in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "TSLAUSDT", "PAXGUSDT", "CLUSDT", "1000PEPEUSDT"):
            print(f"  {r['coinMarket']:13} origin {r['originCoinMarket']:22} faceValue {r['faceValue']:<6} pricePrecision {r['pricePrecision']} amountPrecision {r['amountPrecision']} maxLever {r['maxLever']}")
    print("all symbols:", " ".join(r["coinMarket"] for r in rows))
    tickers, ms, size = data("/contract-market/tickers", {"coinMarketType": "CONTRACT"})
    save("contract-tickers.json", tickers)
    print(f"contract tickers: {len(tickers)} rows, {size} bytes, {ms:.0f} ms, stockType {dict(collections.Counter(t.get('stockType') for t in tickers))}")
    print("ticker fields:", sorted(tickers[0]))
    print("ticker carries mark, index or funding:", any(k in tickers[0] for k in ("markedPrice", "indexPrice", "rate", "fundingRate")))
    spot, _, _ = data("/market/coinMarkets", {}, signed=False)
    print("spot pairs (unsigned /market/coinMarkets):", len(spot), "by quote:", dict(collections.Counter(s["coinMarket"].split("/")[1] for s in spot)), "status:", dict(collections.Counter(s["status"] for s in spot)))


def mode_anchor() -> None:
    print("== anchor, one mark/index call and one funding call per contract")
    rows = catalog()
    marks, rates, mark_ms, rate_ms, mark_bytes, rate_bytes = {}, {}, [], [], [], []
    for r in rows:
        sym = r["coinMarket"]
        m, ms, size = data("/contract-account/usdt/contract/marked/price", {"coinMarket": sym})
        marks[sym] = m
        mark_ms.append(ms)
        mark_bytes.append(size)
        f, ms, size = data("/contract/rateHistory/currentRate", {"coinMarket": sym})
        rates[sym] = f
        rate_ms.append(ms)
        rate_bytes.append(size)
        time.sleep(0.1)
    save("anchor.json", {"marks": marks, "rates": rates})
    equal = sum(1 for m in marks.values() if m["markedPrice"] == m["indexPrice"])
    print(f"marked/price: {len(marks)} calls, median {statistics.median(mark_ms):.0f} ms, {min(mark_bytes)} to {max(mark_bytes)} bytes, mark equals index on {equal} of {len(marks)}")
    print(f"currentRate: {len(rates)} calls, median {statistics.median(rate_ms):.0f} ms, {min(rate_bytes)} to {max(rate_bytes)} bytes")
    print("rate values:", dict(collections.Counter(f["rate"] for f in rates.values())))
    print("historyTime values:", {utc(t): n for t, n in collections.Counter(f["historyTime"] for f in rates.values()).items()})
    print("nextTime values (seconds):", sorted({f["nextTime"] for f in rates.values()}))
    print("sample:", json.dumps(marks["BTCUSDT"]), json.dumps(rates["BTCUSDT"]))
    status, _, raw, _ = post("/contract-account/usdt/contract/marked/price", {})
    print("marked/price with no coinMarket:", status, raw[:160].decode())
    status, _, raw, _ = post("/contract/rateHistory/currentRate", {})
    print("currentRate with no coinMarket:", status, raw[:200].decode())


def mode_poll(seconds: int = 60) -> None:
    print(f"== poll, BTCUSDT and TSLAUSDT mark/index once a second for {seconds} s, against Binance USD-M")
    seen = {"BTCUSDT": [], "TSLAUSDT": []}
    gaps = []
    end = time.time() + seconds
    while time.time() < end:
        for sym in seen:
            m, _, _ = data("/contract-account/usdt/contract/marked/price", {"coinMarket": sym})
            seen[sym].append((m["markedPrice"], m["indexPrice"]))
        if len(seen["BTCUSDT"]) % 10 == 1:
            b = get_json(f"{BINANCE_PREMIUM}?symbol=BTCUSDT")
            bt = get_json(f"{BINANCE_BOOK}?symbol=BTCUSDT")
            ours = float(seen["BTCUSDT"][-1][1])
            mid = (float(bt["bidPrice"]) + float(bt["askPrice"])) / 2
            gaps.append((ours, float(b["markPrice"]), float(b["indexPrice"]), mid))
        time.sleep(1)
    for sym, values in seen.items():
        changes = sum(1 for a, b in zip(values, values[1:]) if a != b)
        print(f"{sym}: {len(values)} polls, {len(set(values))} distinct pairs, {changes} changes, mark differs from index on {sum(1 for m, i in values if m != i)}")
    for ours, bmark, bindex, bmid in gaps:
        print(f"  BiFinance index {ours:.1f}  Binance mark {bmark:.1f} ({(ours / bmark - 1) * 1e6:+.0f} ppm)  Binance index {bindex:.1f} ({(ours / bindex - 1) * 1e6:+.0f} ppm)  Binance book mid {bmid:.1f} ({(ours / bmid - 1) * 1e6:+.0f} ppm)")


def mode_funding() -> None:
    print("== funding history, newest record per contract")
    for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "TSLAUSDT", "PAXGUSDT"):
        page, ms, size = data("/contract/rateHistory/page", {"coinMarket": sym, "page": 1, "size": 5})
        recs = page["records"]
        times = [r["historyTime"] for r in recs]
        steps = sorted({a - b for a, b in zip(times, times[1:])})
        print(f"{sym}: total {page['total']}, newest {utc(times[0])} rate {recs[0]['rate']}, steps between records {steps} s, {size} bytes, {ms:.0f} ms")
    page, _, _ = data("/contract/rateHistory/page", {"coinMarket": "BTCUSDT", "page": 1, "size": 5, "startTime": 1777334400, "endTime": int(time.time())})
    print("BTCUSDT records after 2026-04-28 00:00 UTC (startTime filter):", page["total"])


def mode_book() -> None:
    print("== REST book")
    for body in ({"type": "trade", "coinMarket": "CONTRACT/BTCUSDT"}, {"type": "paint", "coinMarket": "CONTRACT/BTCUSDT"}):
        path = "/contract-market/deeps" if body["type"] == "trade" else "/contract-market/depth"
        d, ms, size = data(path, body)
        bids, asks = d["bids"], d["asks"]
        size_key = "cumulativeCommissionQuantity" if "cumulativeCommissionQuantity" in bids[0] else "lastNumber"
        bp = [float(x["trustPrice"]) for x in bids]
        ap = [float(x["trustPrice"]) for x in asks]
        print(f"{path} {body['type']}: {size} bytes, {ms:.0f} ms, {len(bids)} bids {len(asks)} asks, size field {size_key}")
        print(f"  bids descending {bp == sorted(bp, reverse=True)}, asks ascending {ap == sorted(ap)}, crossed {bp[0] >= ap[0]}")
        print(f"  top bid {bids[0]}  top ask {asks[0]}  extra keys {sorted(set(d) - {'bids', 'asks'})}")
        save(f"book-{body['type']}.json", d)
    bt = get_json(f"{BINANCE_BOOK}?symbol=BTCUSDT")
    print(f"Binance USD-M BTCUSDT book ticker at the same moment: bid {bt['bidPrice']} x {bt['bidQty']}, ask {bt['askPrice']} x {bt['askQty']}")
    sizes = []
    for limit in (5, 50, 100):
        d, _, _ = data("/contract-market/deeps", {"type": "trade", "coinMarket": "CONTRACT/BTCUSDT", "limit": limit, "size": limit})
        sizes.append((limit, len(d["bids"]), len(d["asks"])))
    print("depth with limit and size fields (limit, bids, asks):", sizes)
    d, _, _ = data("/market/deeps", {"type": "trade", "coinMarket": "BTC/USDT"}, signed=False)
    print(f"spot /market/deeps BTC/USDT unsigned: {len(d['bids'])} bids {len(d['asks'])} asks")


def mode_errors() -> None:
    print("== errors and access")
    cases = [
        ("unsigned contract tickers", "/contract-market/tickers", {"coinMarketType": "CONTRACT"}, dict(signed=False)),
        ("unsigned contract catalog", "/contract-market/get-all-contract-coinmarket", {}, dict(signed=False)),
        ("bad signature contract tickers", "/contract-market/tickers", {"coinMarketType": "CONTRACT"}, dict(bad_signature=True)),
        ("unknown symbol mark", "/contract-account/usdt/contract/marked/price", {"coinMarket": "NOPEUSDT"}, {}),
        ("unknown symbol funding", "/contract/rateHistory/currentRate", {"coinMarket": "NOPEUSDT"}, {}),
        ("unknown symbol book", "/contract-market/deeps", {"type": "trade", "coinMarket": "CONTRACT/NOPEUSDT"}, {}),
        ("own fee tier, no token", "/contract/tradeFee/currentUserTradeFee", {}, {}),
        ("documented market-user tickers, no appKey", "/market/market-user/tickers", {}, dict(signed=False)),
        ("documented market-user depth, no appKey", "/market/market-user/depth", {"coinMarket": "BTC/USDT"}, dict(signed=False)),
        ("unsigned spot tickers", "/market/tickers", {}, dict(signed=False)),
    ]
    for label, path, body, kw in cases:
        status, headers, raw, _ = post(path, body, **kw)
        print(f"{label}: HTTP {status}, {raw[:170].decode(errors='replace')}")
    req = urllib.request.Request("https://api.bifinance.com/", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as reply:
        body = reply.read().decode()
    print("https://api.bifinance.com/:", reply.status, "default nginx page" if "Welcome to nginx" in body else body[:80])


def mode_limits(count: int = 30) -> None:
    print(f"== limits, {count} signed catalog calls back to back")
    codes, times, limit_headers = collections.Counter(), [], set()
    for _ in range(count):
        status, headers, raw, ms = post("/contract-market/get-all-contract-coinmarket", {})
        codes[(status, json.loads(raw).get("code"))] += 1
        times.append(ms)
        limit_headers |= {k for k in headers if "limit" in k.lower() or k.lower() == "retry-after"}
    print("status and code counts:", dict(codes), f"median {statistics.median(times):.0f} ms, max {max(times):.0f} ms", "rate limit headers:", sorted(limit_headers) or "none")


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "poll": mode_poll, "funding": mode_funding, "book": mode_book, "errors": mode_errors, "limits": mode_limits}

if __name__ == "__main__":
    chosen = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("probe run", utc(time.time()))
    for name, fn in MODES.items():
        if chosen in (name, "all"):
            fn()
