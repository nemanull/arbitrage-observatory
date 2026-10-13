# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Pacifica public REST probe for docs/profiles/pacifica/rest.md.

Read-only and unauthenticated, with no wallet, no signature and no order.
Every call is a GET on https://api.pacifica.fi/api/v1, except one POST in the errors mode, and the venue publishes 100 credits per rolling 60 s for an unidentified IP.
The probe reads the ratelimit header after every call and waits for the window whenever fewer than 25 credits remain.
Run from the repository root with: uv run scripts/probes/venues/pacifica/rest-probe.py <mode> [<mode> ...]
Modes: host, catalog, anchor, poll, funding, book, errors, listings, all.
poll takes about 50 s, and every other mode a few seconds.
listings also makes one public catalog call each to Binance USD-M, Bybit, OKX and Hyperliquid, the venues of Pacifica's oracle.
"""

import http.client
import json
import socket
import statistics
import sys
import time
from collections import Counter

HOST = "api.pacifica.fi"
BASE = "/api/v1"
UA = "arbitrage-observatory-probe/1.0"
MIN_CREDITS_LEFT = 250  # the header counts credits times 10
POLLS = 45

_conn: http.client.HTTPSConnection | None = None
_remaining: int | None = None
_reset_s: int | None = None


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def connection(fresh: bool = False) -> http.client.HTTPSConnection:
    global _conn
    if fresh or _conn is None:
        if _conn is not None:
            _conn.close()
        _conn = http.client.HTTPSConnection(HOST, timeout=20)
    return _conn


def parse_ratelimit(headers: dict) -> None:
    global _remaining, _reset_s
    raw = headers.get("ratelimit")
    if not raw:
        return
    parts = dict(p.split("=", 1) for p in raw.split(";")[1:] if "=" in p)
    _remaining = int(parts.get("r", "0"))
    _reset_s = int(parts.get("t", "0"))


def pace() -> None:
    if _remaining is not None and _remaining < MIN_CREDITS_LEFT:
        wait = (_reset_s or 0) + 2
        print(f"  pacing: {_remaining / 10:.1f} credits left, waiting {wait} s", flush=True)
        time.sleep(wait)


def get(path: str, fresh: bool = False, body: bytes | None = None, method: str = "GET"):
    """Returns status, headers, raw body, parsed JSON or None, elapsed ms, arrival ms."""
    pace()
    conn = connection(fresh)
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    t0 = time.perf_counter()
    try:
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
    except (http.client.HTTPException, OSError):
        conn = connection(True)
        t0 = time.perf_counter()
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
    elapsed = (time.perf_counter() - t0) * 1000
    arrival = int(time.time() * 1000)
    hdrs = {k.lower(): v for k, v in resp.getheaders()}
    parse_ratelimit(hdrs)
    try:
        parsed = json.loads(raw)
    except ValueError:
        parsed = None
    return resp.status, hdrs, raw, parsed, elapsed, arrival


def show_headers(hdrs: dict) -> None:
    for k in ("content-type", "content-length", "content-encoding", "cache-control", "age", "x-cache",
              "via", "x-amz-cf-pop", "server", "ratelimit", "ratelimit-policy", "retry-after", "date"):
        if k in hdrs:
            print(f"  {k}: {hdrs[k]}")


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(q * (len(s) - 1) + 0.5))]


def mode_host() -> None:
    section("host: DNS")
    infos = socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)
    print("  addresses:", sorted({i[4][0] for i in infos}))
    try:
        print("  canonical:", socket.gethostbyname_ex(HOST)[0])
    except OSError as e:
        print("  canonical lookup failed:", e)
    for path in ("/info", "/info/prices", "/book?symbol=BTC", "/info/fees"):
        section(f"host: GET {BASE}{path}, first request on a new connection, then 5 on the kept one")
        status, hdrs, raw, _, ms, _ = get(BASE + path, fresh=True)
        print(f"  status {status}, {len(raw)} bytes, {ms:.0f} ms with TCP and TLS")
        show_headers(hdrs)
        warm = []
        for _ in range(5):
            status, hdrs, raw, _, ms, _ = get(BASE + path)
            warm.append(ms)
            time.sleep(0.4)
        print(f"  warm ms: min {min(warm):.0f}, median {statistics.median(warm):.0f}, max {max(warm):.0f}; x-cache {hdrs.get('x-cache')}; age {hdrs.get('age')}")


def mode_catalog() -> None:
    section("catalog: GET /api/v1/info")
    status, hdrs, raw, d, ms, _ = get(BASE + "/info")
    print(f"  status {status}, {len(raw)} bytes, {ms:.0f} ms, envelope keys {sorted(d.keys())}, success {d.get('success')}, error {d.get('error')}, code {d.get('code')}")
    rows = d["data"]
    print(f"  rows {len(rows)}")
    print("  instrument_type:", dict(Counter(r.get("instrument_type") for r in rows)))
    print("  execution_modes:", dict(Counter(json.dumps(r.get("execution_modes")) for r in rows)))
    print("  key sets:", dict(Counter(json.dumps(sorted(r.keys())) for r in rows)))
    perps = [r for r in rows if r.get("instrument_type") == "perpetual"]
    print(f"  perpetual rows {len(perps)}")
    print("  isolated_only true:", [r["symbol"] for r in rows if r.get("isolated_only")])
    print("  max_leverage:", dict(sorted(Counter(r.get("max_leverage") for r in perps).items())))
    print("  symbol differs from base_asset:", [(r["symbol"], r["base_asset"]) for r in rows if r["symbol"] != r["base_asset"]])
    print("  symbols not upper case:", [r["symbol"] for r in rows if r["symbol"] != r["symbol"].upper()])
    print("  symbols with a digit:", [r["symbol"] for r in rows if any(c.isdigit() for c in r["symbol"])])
    print("  non-ASCII symbols:", [r["symbol"] for r in rows if not r["symbol"].isascii()])
    print("  duplicate symbols:", [s for s, n in Counter(r["symbol"] for r in rows).items() if n > 1])
    print("  min_order_size:", dict(Counter(r.get("min_order_size") for r in perps)))
    newest = sorted(rows, key=lambda r: r.get("created_at") or 0)[-5:]
    print("  newest five:", [(r["symbol"], time.strftime("%Y-%m-%d", time.gmtime(r["created_at"] / 1000))) for r in newest])
    print("  order is oldest first:", [r.get("created_at") for r in rows] == sorted(r.get("created_at") for r in rows))
    print("  funding_rate equal to next_funding_rate on", sum(r["funding_rate"] == r["next_funding_rate"] for r in perps), "of", len(perps))
    print("  all perpetual symbols:", " ".join(r["symbol"] for r in perps))
    print("  spot rows:", [(r["symbol"], r["base_asset"], r["max_leverage"], r["funding_rate"]) for r in rows if r.get("instrument_type") != "perpetual"])
    print("  sample row:", json.dumps(perps[0]))


def prices_once():
    status, hdrs, raw, d, ms, arrival = get(BASE + "/info/prices")
    return status, hdrs, raw, d, ms, arrival


def mode_anchor() -> None:
    section("anchor: GET /api/v1/info/prices")
    status, hdrs, raw, d, ms, arrival = prices_once()
    print(f"  status {status}, {len(raw)} bytes, {ms:.0f} ms")
    show_headers(hdrs)
    rows = d["data"]
    print(f"  rows {len(rows)}, key sets {dict(Counter(json.dumps(sorted(r.keys())) for r in rows))}")
    _, _, _, cat, _, _ = get(BASE + "/info")
    kinds = {r["symbol"]: r["instrument_type"] for r in cat["data"]}
    print("  symbols in prices but not in the catalog:", sorted(set(r["symbol"] for r in rows) - set(kinds)))
    print("  catalog symbols missing from prices:", sorted(set(kinds) - set(r["symbol"] for r in rows)))
    print("  spot rows in prices:", [(r["symbol"], r["mark"], r["oracle"], r["funding"], r["next_funding"]) for r in rows if kinds.get(r["symbol"]) == "spot"])
    perps = [r for r in rows if kinds.get(r["symbol"]) == "perpetual"]
    ages = [arrival - r["timestamp"] for r in perps]
    print(f"  arrival minus row timestamp ms: min {min(ages)}, median {statistics.median(ages)}, max {max(ages)}")
    print("  distinct row timestamps:", len(set(r["timestamp"] for r in perps)))
    for field in ("mark", "oracle", "mid"):
        zero = [r["symbol"] for r in perps if r.get(field) in (None, "", "0") or float(r[field]) == 0]
        print(f"  {field} null or zero on: {zero}")
    dist = sorted((abs(float(r["mark"]) / float(r["oracle"]) - 1) * 1e6, r["symbol"]) for r in perps if float(r["oracle"]) > 0)
    vals = [x for x, _ in dist]
    print(f"  mark against oracle ppm: median {statistics.median(vals):.0f}, p90 {pct(vals, 0.9):.0f}, max {dist[-1][0]:.0f} on {dist[-1][1]}")
    print("  five widest:", [(s, round(x)) for x, s in dist[-5:]])
    print("  mark equal to oracle on", sum(r["mark"] == r["oracle"] for r in perps), "of", len(perps), "and mark equal to mid on", sum(r["mark"] == r["mid"] for r in perps))
    cat_tick = {r["symbol"]: float(r["tick_size"]) for r in cat["data"]}
    tick_ppm = sorted((cat_tick[r["symbol"]] / float(r["mid"]) * 1e6, r["symbol"]) for r in perps if float(r["mid"]) > 0)
    tv = [x for x, _ in tick_ppm]
    print(f"  one book tick against the mid ppm: median {statistics.median(tv):.0f}, over 100 on {sum(1 for x in tv if x > 100)}, over 1,000 on {[(s, round(x)) for x, s in tick_ppm if x > 1000]}")
    print("  funding equal to next_funding on", sum(r["funding"] == r["next_funding"] for r in perps), "of", len(perps))
    print("  next_funding equal to 0.0000125 on", sum(float(r["next_funding"]) == 0.0000125 for r in perps))
    print("  funding equal to 0.0000125 on", sum(float(r["funding"]) == 0.0000125 for r in perps))
    nf = [abs(float(r["next_funding"])) for r in perps]
    print(f"  largest |next_funding| {max(nf)}")
    cat_rows = {r["symbol"]: r for r in cat["data"]}
    same_f = sum(cat_rows[r["symbol"]]["funding_rate"] == r["funding"] for r in perps)
    same_nf = sum(cat_rows[r["symbol"]]["next_funding_rate"] == r["next_funding"] for r in perps)
    print(f"  catalog funding_rate equal to prices funding on {same_f}, catalog next_funding_rate equal to prices next_funding on {same_nf}, of {len(perps)}")
    for sym in ("BTC", "ETH", "SOL", "kPEPE", "BP", "XAU"):
        r = next((x for x in rows if x["symbol"] == sym), None)
        print(f"  {sym}: {json.dumps(r)}")
    for sym in ("kBONK", "kSHIB", "META", "MU", "SNDK", "DRAM", "SPCX", "LIT", "MEGA", "CHIP", "PONS", "USELESS"):
        r = next((x for x in rows if x["symbol"] == sym), None)
        if r:
            print(f"  {sym}: oracle {r['oracle']}, mark {r['mark']}, listed {time.strftime('%Y-%m-%d', time.gmtime(cat_rows[sym]['created_at'] / 1000))}, modes {cat_rows[sym].get('execution_modes')}")


def mode_poll() -> None:
    section(f"poll: {POLLS} reads of /api/v1/info/prices about one second apart")
    snaps = []
    times = []
    credits = []
    start = time.time()
    for i in range(POLLS):
        t = time.time()
        status, hdrs, raw, d, ms, arrival = prices_once()
        if status != 200:
            print(f"  poll {i}: status {status} {raw[:200]!r}")
            break
        times.append(ms)
        credits.append(_remaining)
        snaps.append((arrival, {r["symbol"]: r for r in d["data"]}, hdrs.get("x-cache"), hdrs.get("age")))
        time.sleep(max(0.0, 1.0 - (time.time() - t)))
    print(f"  {len(snaps)} polls in {time.time() - start:.1f} s, reply ms min {min(times):.0f}, median {statistics.median(times):.0f}, p90 {pct(times, 0.9):.0f}, max {max(times):.0f}")
    print("  x-cache values:", dict(Counter(s[2] for s in snaps)), "age values:", dict(Counter(s[3] for s in snaps)))
    print(f"  ratelimit remaining credits over the polls: first {credits[0] / 10}, min {min(credits) / 10}, last {credits[-1] / 10}")
    symbols = sorted(snaps[0][1])
    fields = ("mark", "oracle", "mid", "funding", "next_funding", "open_interest", "timestamp")
    changes = {f: [] for f in fields}
    for sym in symbols:
        for f in fields:
            n = sum(1 for a, b in zip(snaps, snaps[1:]) if a[1][sym][f] != b[1][sym][f])
            changes[f].append(n)
    trans = len(snaps) - 1
    for f in fields:
        print(f"  {f}: changed on a median of {statistics.median(changes[f])} and a max of {max(changes[f])} of {trans} transitions per symbol, symbols never changing {sum(1 for n in changes[f] if n == 0)}")
    ages = [s[0] - s[1][sym]["timestamp"] for s in snaps for sym in symbols]
    print(f"  arrival minus timestamp ms over all rows: min {min(ages)}, median {statistics.median(ages)}, p90 {pct(ages, 0.9)}, max {max(ages)}")
    per_poll_ts = [len({s[1][sym]['timestamp'] for sym in symbols}) for s in snaps]
    print(f"  distinct timestamps per poll: {dict(Counter(per_poll_ts))}")
    ts_steps = [b[1]["BTC"]["timestamp"] - a[1]["BTC"]["timestamp"] for a, b in zip(snaps, snaps[1:])]
    print(f"  BTC timestamp steps ms: {ts_steps}")
    for sym in ("BTC", "ETH", "SOL", "kPEPE", "XAU", "BP"):
        if sym not in snaps[0][1]:
            continue
        row = []
        for f in ("oracle", "mark", "mid", "next_funding", "funding"):
            row.append(f"{f} {sum(1 for a, b in zip(snaps, snaps[1:]) if a[1][sym][f] != b[1][sym][f])}")
        holds = 0
        best = 0
        for a, b in zip(snaps, snaps[1:]):
            holds = holds + 1 if a[1][sym]["oracle"] == b[1][sym]["oracle"] else 0
            best = max(best, holds)
        mark_eq_mid = sum(1 for s in snaps if s[1][sym]["mark"] == s[1][sym]["mid"])
        print(f"  {sym}: {', '.join(row)}; longest oracle hold {best} transitions; mark equal to mid on {mark_eq_mid} of {len(snaps)}")
    moves = []
    for sym in symbols:
        for f in ("oracle", "mark"):
            for a, b in zip(snaps, snaps[1:]):
                x, y = float(a[1][sym][f]), float(b[1][sym][f])
                if x > 0:
                    moves.append((abs(y / x - 1) * 1e6, sym, f))
    big = [m for m in moves if m[0] > 1000]
    print(f"  poll-to-poll moves over 1,000 ppm: {len(big)} of {len(moves)}, largest {max(moves)[0]:.0f} ppm on {max(moves)[1]} {max(moves)[2]}")
    print("  over 1,000 ppm:", sorted({(s, f) for _, s, f in big}))


def mode_funding() -> None:
    section("funding: GET /api/v1/funding_rate/history")
    _, _, _, pr, _, _ = prices_once()
    prices = {r["symbol"]: r for r in pr["data"]}
    for sym in ("BTC", "ETH", "kPEPE", "XAU"):
        status, hdrs, raw, d, ms, arrival = get(f"{BASE}/funding_rate/history?symbol={sym}&limit=30")
        print(f"  {sym}: status {status}, {len(raw)} bytes, {ms:.0f} ms, envelope keys {sorted(d.keys()) if isinstance(d, dict) else type(d)}")
        rows = d.get("data") or []
        if not rows:
            print("   ", raw[:300])
            continue
        print("    first row:", json.dumps(rows[0]))
        cts = [r["created_at"] for r in rows]
        steps = [a - b for a, b in zip(cts, cts[1:])]
        print(f"    rows {len(rows)}, newest first: {cts == sorted(cts, reverse=True)}, steps ms min {min(steps)}, median {statistics.median(steps)}, max {max(steps)}")
        offsets = [c % 3_600_000 for c in cts]
        print(f"    created_at past the whole hour ms: min {min(offsets)}, median {statistics.median(offsets)}, max {max(offsets)}")
        print(f"    newest created_at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(cts[0] / 1000))}, arrival {time.strftime('%H:%M:%SZ', time.gmtime(arrival / 1000))}")
        newest = rows[0]
        p = prices[sym]
        print(f"    prices funding {p['funding']} next_funding {p['next_funding']}; newest history funding_rate {newest['funding_rate']} next_funding_rate {newest['next_funding_rate']}")
        print(f"    history next_funding_rate of row k equal to funding_rate of row k-1 (newer): {sum(1 for a, b in zip(rows, rows[1:]) if b['next_funding_rate'] == a['funding_rate'])} of {len(rows) - 1}")
        matches = 0
        for r in rows:
            o = float(r["oracle_price"])
            bi = float(r["bid_impact_price"])
            ai = float(r["ask_impact_price"])
            prem = (max(bi - o, 0) - max(o - ai, 0)) / o
            est = (prem + min(max(0.0001 - prem, -0.0005), 0.0005)) / 8
            if abs(est - float(r["funding_rate"])) < 5e-9:
                matches += 1
        print(f"    rows whose funding_rate equals (P + clamp(0.0001 - P, +-0.0005)) / 8 with P from the same row: {matches} of {len(rows)}")
        print(f"    rows at exactly 0.0000125: {sum(1 for r in rows if float(r['funding_rate']) == 0.0000125)} of {len(rows)}")
    status, hdrs, raw, d, ms, _ = get(f"{BASE}/funding_rate/history?symbol=BTC&limit=4000")
    rows = d.get("data") or []
    if rows:
        cts = [r["created_at"] for r in rows]
        steps = Counter(round((a - b) / 60000) for a, b in zip(cts, cts[1:]))
        fr = [abs(float(r["funding_rate"])) for r in rows]
        print(f"  BTC limit 4000: {len(rows)} rows from {time.strftime('%Y-%m-%d %H:%M', time.gmtime(cts[-1] / 1000))} to {time.strftime('%Y-%m-%d %H:%M', time.gmtime(cts[0] / 1000))}, has_more {d.get('has_more')}, step minutes {dict(steps.most_common(5))}, largest |rate| {max(fr)}")
        chain = sum(1 for a, b in zip(rows, rows[1:]) if b["next_funding_rate"] == a["funding_rate"])
        print(f"  BTC limit 4000: next_funding_rate of a row equal to funding_rate of the next newer row on {chain} of {len(rows) - 1}")
        gaps = [(time.strftime('%Y-%m-%d %H:%M', time.gmtime(b['created_at'] / 1000)), time.strftime('%Y-%m-%d %H:%M', time.gmtime(a['created_at'] / 1000)))
                for a, b in zip(rows, rows[1:]) if a['created_at'] - b['created_at'] > 3_700_000]
        print(f"  BTC limit 4000: missing hours between {gaps}")


def mode_book() -> None:
    section("book: GET /api/v1/book")
    for q in ("symbol=BTC", "symbol=BTC&agg_level=10", "symbol=kPEPE", "symbol=XAU", "symbol=SOL-USDC"):
        status, hdrs, raw, d, ms, arrival = get(f"{BASE}/book?{q}")
        if status != 200 or not isinstance(d, dict) or not d.get("data"):
            print(f"  {q}: status {status} {raw[:300]!r}")
            continue
        data = d["data"]
        bids, asks = data["l"][0], data["l"][1]
        bp = [float(x["p"]) for x in bids]
        ap = [float(x["p"]) for x in asks]
        print(f"  {q}: status {status}, {len(raw)} bytes, {ms:.0f} ms, data keys {sorted(data.keys())}, levels {len(bids)} and {len(asks)}, bids descending {bp == sorted(bp, reverse=True)}, asks ascending {ap == sorted(ap)}, arrival minus t {arrival - data['t']} ms, cache-control {hdrs.get('cache-control')}, x-cache {hdrs.get('x-cache')}")
        print(f"    top: bid {bids[0] if bids else None} ask {asks[0] if asks else None}")
    reads = []
    for _ in range(3):
        status, hdrs, raw, d, ms, arrival = get(f"{BASE}/book?symbol=BTC")
        reads.append((d["data"]["t"], json.dumps(d["data"]["l"])))
        time.sleep(0.3)
    print(f"  three BTC reads 0.3 s apart: t steps {[b[0] - a[0] for a, b in zip(reads, reads[1:])]}, levels changed {[a[1] != b[1] for a, b in zip(reads, reads[1:])]}")


def mode_errors() -> None:
    section("errors")
    cases = [
        ("book unknown symbol", "GET", f"{BASE}/book?symbol=NOPE", None),
        ("book lowercase symbol", "GET", f"{BASE}/book?symbol=btc", None),
        ("book no symbol", "GET", f"{BASE}/book", None),
        ("book agg_level 7", "GET", f"{BASE}/book?symbol=BTC&agg_level=7", None),
        ("funding history unknown symbol", "GET", f"{BASE}/funding_rate/history?symbol=NOPE", None),
        ("unknown path", "GET", f"{BASE}/nope", None),
        ("GET with an empty JSON body", "GET", f"{BASE}/info/prices", b"{}"),
        ("POST to a GET route", "POST", f"{BASE}/info/prices", b"{}"),
    ]
    for name, method, path, body in cases:
        status, hdrs, raw, d, ms, _ = get(path, body=body, method=method)
        print(f"  {name}: status {status}, content-type {hdrs.get('content-type')}, retry-after {hdrs.get('retry-after')}, body {raw[:300]!r}")
    section("time: Date header against the local clock")
    offsets = []
    for _ in range(3):
        t0 = time.time()
        status, hdrs, raw, d, ms, arrival = get(f"{BASE}/book?symbol=BTC")
        t1 = time.time()
        server = d["data"]["t"] / 1000
        offsets.append(((t0 + t1) / 2 - server) * 1000)
        print(f"  round trip {(t1 - t0) * 1000:.0f} ms, local midpoint minus book t {offsets[-1]:.0f} ms, date header {hdrs.get('date')}")
        time.sleep(0.5)


def fetch_json(url: str, body: bytes | None = None):
    import urllib.request
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def mode_listings() -> None:
    section("listings: which Pacifica perpetuals the four oracle venues list as perpetuals, one public catalog call each")
    _, _, _, cat, _, _ = get(BASE + "/info")
    perps = [r["symbol"] for r in cat["data"] if r["instrument_type"] == "perpetual"]

    def norm(sym: str) -> str:
        return "1000" + sym[1:] if sym.startswith("k") else sym

    binance = {s["baseAsset"] for s in fetch_json("https://fapi.binance.com/fapi/v1/exchangeInfo")["symbols"]
               if s.get("status") == "TRADING" and s.get("contractType") == "PERPETUAL"}
    bybit = {s["baseCoin"] for s in fetch_json("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000")["result"]["list"]
             if s.get("status") == "Trading" and s.get("contractType") == "LinearPerpetual"}
    okx = {s["ctValCcy"] for s in fetch_json("https://www.okx.com/api/v5/public/instruments?instType=SWAP")["data"]
           if s.get("state") == "live" and s.get("ctType") == "linear"}
    hl = {u["name"] for u in fetch_json("https://api.hyperliquid.xyz/info", b'{"type":"meta"}')["universe"] if not u.get("isDelisted")}
    rows = []
    for p in perps:
        base = norm(p)
        hit = [name for name, have in (("binance", base in binance or p in binance), ("bybit", base in bybit or p in bybit),
                                       ("okx", p in okx or base in okx), ("hyperliquid", p in hl)) if have]
        rows.append((p, hit))
    none = [p for p, h in rows if not h]
    print(f"  listed on none of the four: {none}")
    print(f"  listed on one only: {[(p, h[0]) for p, h in rows if len(h) == 1]}")
    print(f"  listed on all four: {sum(1 for _, h in rows if len(h) == 4)} of {len(rows)}")


MODES = {
    "listings": mode_listings,
    "host": mode_host,
    "catalog": mode_catalog,
    "anchor": mode_anchor,
    "poll": mode_poll,
    "funding": mode_funding,
    "book": mode_book,
    "errors": mode_errors,
}


def main() -> None:
    wanted = sys.argv[1:] or ["all"]
    if "all" in wanted:
        wanted = list(MODES)
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "modes", wanted, flush=True)
    for m in wanted:
        MODES[m]()
    print("\nprobe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), f"credits left {(_remaining or 0) / 10:.1f}", flush=True)


if __name__ == "__main__":
    main()
