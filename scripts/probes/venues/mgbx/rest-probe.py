# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for the MGBX USDT-M perpetuals.

MGBX publishes no API documentation, so every path here is one the www.mgbx.com web app called when the 2026-09-23 run read its bundle.
Public, unauthenticated and read-only. One request at a time, at most about 4 a second, each with a 5 s timeout.
A third or more of fresh TLS handshakes to www.mgbx.com stall from this host, so a read that must succeed is tried three times.

Run from the repository root:
    uv run scripts/probes/venues/mgbx/rest-probe.py [latency|catalog|anchor|funding|book|errors|clock|mirror]

Modes:
    latency  DNS, 10 cold requests on fresh connections, 20 warm requests on one kept-alive connection.
    catalog  CCXT check, symbol/list counts by type, state, fee and contract size, agg-tickers against the list, the spot list and the coin-M path.
    anchor   60 polls at 1 s of agg-tickers, mark-price and index-price, reply size and time, and how often each field changed.
    funding  funding-rate for every listed contract at 4 a second, a bulk funding guess, then funding-rate-record on three contracts.
    book     REST depth at each level, level order, number types, two reads back to back.
    errors   unknown symbol, missing parameter, bad level, unknown path.
    clock    Binance serverTime, the MGBX time call and the Date header against the local clock.
    mirror   MGBX mark and agg index against Binance USDT-M mark and index, one read each.

Captures go to .claude/survey-work/mgbx/ unless PROBE_OUT_DIR names another folder.
Recorded in docs/profiles/mgbx/rest.md and docs/profiles/mgbx/fees.md.
"""

import http.client
import json
import os
import socket
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

HOST = "www.mgbx.com"
BASE = f"https://{HOST}/futures/fapi/market/v1/public"
BINANCE = "https://fapi.binance.com/fapi/v1"
TIMEOUT = 5
REPO = Path(__file__).resolve().parents[4]
OUT = Path(os.environ.get("PROBE_OUT_DIR", REPO / ".claude/survey-work/mgbx"))
CCXT_SRC = REPO / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) survey-probe"}


def log(tag, **kw):
    print(json.dumps({"tag": tag, **kw}, default=str), flush=True)


def keep(name, text):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(text)


def get(url):
    """One request, never raised: a hang or refused connection comes back as status 0."""
    t0 = time.perf_counter()
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            text = res.read().decode()
            status, headers = res.status, dict(res.headers)
    except urllib.error.HTTPError as e:
        text, status, headers = e.read().decode(errors="replace"), e.code, dict(e.headers)
    except Exception as e:
        return {"status": 0, "ms": round((time.perf_counter() - t0) * 1000), "error": type(e).__name__, "bytes": 0, "text": "", "json": None, "headers": {}}
    ms = round((time.perf_counter() - t0) * 1000)
    try:
        body = json.loads(text)
    except ValueError:
        body = None
    return {"status": status, "ms": ms, "bytes": len(text.encode()), "text": text, "json": body, "headers": headers}


def get_retry(url, tries=3):
    r = None
    for i in range(tries):
        r = get(url)
        if r["status"] != 0:
            return {**r, "tries": i + 1}
    return {**r, "tries": tries}


def q(path):
    return f"{BASE}/{path}"


def stats(xs):
    if not xs:
        return {"n": 0}
    s = sorted(xs)
    return {"n": len(s), "min": s[0], "median": statistics.median(s), "p90": s[min(len(s) - 1, int(0.9 * len(s)))], "max": s[-1]}


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()


def warm_conn():
    for _ in range(3):
        try:
            conn = http.client.HTTPSConnection(HOST, timeout=TIMEOUT)
            conn.connect()
            return conn
        except Exception:
            pass
    raise SystemExit("three TLS handshakes to www.mgbx.com stalled")


def warm_get(conn, path):
    try:
        conn.request("GET", path, headers=UA)
        res = conn.getresponse()
        return res.status, res.read().decode(), dict(res.headers)
    except Exception as e:
        return 0, type(e).__name__, {}


def latency():
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})
    log("dns", host=HOST, addrs=addrs)
    cold = []
    for _ in range(10):
        # A fresh connection per request, so each one pays DNS, TCP and TLS.
        t0 = time.perf_counter()
        try:
            conn = http.client.HTTPSConnection(HOST, timeout=TIMEOUT, context=ssl.create_default_context())
            conn.connect()
            t_conn = time.perf_counter()
            conn.request("GET", "/futures/fapi/market/v1/public/q/mark-price?symbol=btc_usdt", headers=UA)
            res = conn.getresponse()
            res.read()
            cold.append({"status": res.status, "connectTlsMs": round((t_conn - t0) * 1000), "totalMs": round((time.perf_counter() - t0) * 1000)})
            conn.close()
        except Exception as e:
            cold.append({"status": 0, "error": type(e).__name__, "totalMs": round((time.perf_counter() - t0) * 1000)})
        time.sleep(1)
    ok = [c for c in cold if c["status"] == 200]
    log("cold", requests=len(cold), ok=len(ok), hung=len(cold) - len(ok), connectTls=stats([c["connectTlsMs"] for c in ok]), total=stats([c["totalMs"] for c in ok]))
    warm, fails = [], 0
    conn = warm_conn()
    for _ in range(20):
        t0 = time.perf_counter()
        status, _t, _h = warm_get(conn, "/futures/fapi/market/v1/public/q/mark-price?symbol=btc_usdt")
        if status == 200:
            warm.append(round((time.perf_counter() - t0) * 1000))
        else:
            fails += 1
        time.sleep(0.5)
    log("warm", fails=fails, **stats(warm))


def catalog():
    files = sorted(p.name for p in CCXT_SRC.glob("*.js")) if CCXT_SRC.exists() else []
    log("ccxt", src=str(CCXT_SRC.relative_to(REPO)), jsFiles=len(files), match=[f for f in files if "mgbx" in f.lower() or "megabit" in f.lower()])
    r = get_retry(q("symbol/list"))
    log("symbol_list", status=r["status"], tries=r["tries"], ms=r["ms"], bytes=r["bytes"], code=(r["json"] or {}).get("code"))
    if not r["json"]:
        return
    keep("symbol-list.json", r["text"])
    d = r["json"]["data"]
    c = lambda f: dict(Counter(f(x) for x in d))
    log("counts", rows=len(d), contractType=c(lambda x: x.get("contractType")), underlyingType=c(lambda x: x.get("underlyingType")), quoteCoin=c(lambda x: x.get("quoteCoin")), targetType=c(lambda x: x.get("targetType")), state=c(lambda x: x.get("state")), tradeSwitch=c(lambda x: x.get("tradeSwitch")))
    log("fees", pairs=dict(Counter(f"taker {x.get('takerFee')} maker {x.get('makerFee')}" for x in d)))
    for pair in ["taker 0.001 maker 0.0006", "taker 0.001 maker 0.001", "taker 0.00005 maker 0.0005"]:
        log("fee_rows", pair=pair, symbols=[x["symbol"] for x in d if f"taker {x.get('takerFee')} maker {x.get('makerFee')}" == pair])
    log("fees_by_target", rows=dict(Counter(f"{x.get('targetType')} taker {x.get('takerFee')}" for x in d)))
    log("liquidation_fee", values=c(lambda x: x.get("liquidationFee")))
    log("contract_size", values=c(lambda x: x.get("contractSize")))
    bases = Counter(x.get("baseCoin") for x in d)
    log("pairs_twice", bases=[b for b, n in bases.items() if n > 1], symbolsTwice=[s for s, n in Counter(x["symbol"] for x in d).items() if n > 1])
    log("non_ascii_symbols", symbols=[x["symbol"] for x in d if not x["symbol"].isascii()])
    log("scaled_names", symbols=[x["symbol"] for x in d if str(x.get("baseCoin", "")).lower().startswith(("1000", "1m", "10000"))])
    log("tradfi_sample", symbols=[x["symbol"] for x in d if x.get("targetType") == 2][:30])
    btc = next(x for x in d if x["symbol"] == "btc_usdt")
    log("btc_row", row={k: v for k, v in btc.items() if k not in ("supportOrderType", "supportTimeInForce", "supportEntrustType", "supportPositionType", "coinName", "coinNameZh", "coinNameHk", "partitionId")})
    onboard = [x["onboardDate"] for x in d if x.get("onboardDate")]
    log("onboard", first=iso(min(onboard)), last=iso(max(onboard)), newest=[x["symbol"] for x in sorted(d, key=lambda x: x.get("onboardDate") or 0)[-5:]])
    a = get_retry(q("q/agg-tickers"))
    listed = {x["symbol"] for x in d}
    in_agg = {x["s"] for x in ((a["json"] or {}).get("data") or [])}
    log("agg_vs_list", status=a["status"], tries=a["tries"], aggRows=len(in_agg), notListed=sorted(in_agg - listed), notInAgg=sorted(listed - in_agg)[:20])
    spot = get_retry(f"https://{HOST}/pro/p/symbol/list")
    sd = ((spot["json"] or {}).get("data")) or []
    log("spot_list", status=spot["status"], tries=spot["tries"], pairs=len(sd), tradeSwitch=dict(Counter(x.get("tradeSwitch") for x in sd)))
    for path in ["futures/dapi/market/v1/public/symbol/list", "futures/dapi/market/v1/public/q/agg-tickers"]:
        r2 = get_retry(f"https://{HOST}/{path}")
        log("coin_m_path", path=path, status=r2["status"], tries=r2["tries"], body=r2["text"][:200])


class Warm:
    """One kept-alive connection, reopened after a failure, the way a poller would hold it."""

    def __init__(self):
        self.conn, self.reopens = None, 0

    def get(self, path):
        t0 = time.perf_counter()
        for _ in range(2):
            if self.conn is None:
                try:
                    self.conn = warm_conn()
                    self.reopens += 1
                except SystemExit:
                    break
            status, text, headers = warm_get(self.conn, path)
            if status:
                body = json.loads(text) if text.startswith("{") else None
                return {"status": status, "ms": round((time.perf_counter() - t0) * 1000), "bytes": len(text.encode()), "text": text, "json": body, "headers": headers}
            self.conn.close()
            self.conn = None
        return {"status": 0, "ms": round((time.perf_counter() - t0) * 1000), "bytes": 0, "text": "", "json": None, "headers": {}}


def anchor():
    w = Warm()
    path = lambda p: f"/futures/fapi/market/v1/public/{p}"
    times = {"agg": [], "mark": [], "index": []}
    fails = Counter()
    sizes = {}
    hist = {}
    i_eq_m = rows = idx_eq_mark = idx_rows = 0
    for i in range(60):
        start = time.time()
        a = w.get(path("q/agg-tickers"))
        if a["status"] == 200 and (a["json"] or {}).get("code") == 0:
            times["agg"].append(a["ms"])
            sizes["agg"] = a["bytes"]
            for x in a["json"]["data"]:
                rows += 1
                i_eq_m += x.get("i") == x.get("m")
                hist.setdefault(x["s"], []).append((x.get("i"), x.get("m"), x.get("c")))
            if i == 59:
                keep("agg-tickers.json", a["text"])
        else:
            fails["agg"] += 1
        m = w.get(path("q/mark-price"))
        x = w.get(path("q/index-price"))
        for name, r in (("mark", m), ("index", x)):
            if r["status"] == 200 and (r["json"] or {}).get("code") == 0:
                times[name].append(r["ms"])
                sizes[name] = r["bytes"]
            else:
                fails[name] += 1
        if (m["json"] or {}).get("data") and (x["json"] or {}).get("data"):
            mm = {r["s"]: r["p"] for r in m["json"]["data"]}
            for r in x["json"]["data"]:
                idx_rows += 1
                idx_eq_mark += mm.get(r["s"]) == r["p"]
        time.sleep(max(0, 1 - (time.time() - start)))
    log("times", agg=stats(times["agg"]), mark=stats(times["mark"]), index=stats(times["index"]), fails=dict(fails), connectionOpens=w.reopens, sizes=sizes)
    log("agg_index_equals_mark", rows=rows, equal=i_eq_m)
    log("bulk_index_equals_bulk_mark", rows=idx_rows, equal=idx_eq_mark)

    def changes(v, k):
        return sum(1 for j in range(1, len(v)) if v[j][k] != v[j - 1][k])

    log("changes_per_symbol", symbols=len(hist), polls=len(next(iter(hist.values()), [])), index=stats([changes(v, 0) for v in hist.values()]), mark=stats([changes(v, 1) for v in hist.values()]), last=stats([changes(v, 2) for v in hist.values()]))
    for s in ["btc_usdt", "eth_usdt", "xau_usdt", "aapl_usdt"]:
        v = hist.get(s)
        if v:
            log("symbol_changes", s=s, polls=len(v), index=changes(v, 0), mark=changes(v, 1), last=changes(v, 2))


def funding():
    lst = get_retry(q("symbol/list"))
    syms = [(x["symbol"], x.get("targetType")) for x in ((lst["json"] or {}).get("data") or [])]
    rows, fails = [], 0
    t0 = time.time()
    w = Warm()
    for s, typ in syms:
        r = w.get(f"/futures/fapi/market/v1/public/q/funding-rate?symbol={urllib.parse.quote(s)}")  # three symbols are Chinese words
        if (r["json"] or {}).get("code") == 0 and r["json"].get("data"):
            rows.append({**r["json"]["data"], "type": typ, "ms": r["ms"]})
        else:
            fails += 1
        time.sleep(0.25)
    keep("funding-rates.json", json.dumps(rows))
    log("funding_sweep", symbols=len(syms), ok=len(rows), fails=fails, connectionOpens=w.reopens, seconds=round(time.time() - t0), times=stats([r["ms"] for r in rows]))
    log("funding_fields", keys=list(rows[0].keys()) if rows else [])
    log("interval", counts=dict(Counter(r["collectionInterval"] for r in rows)), oneHour=[r["symbol"] for r in rows if r["collectionInterval"] == 1])
    log("next", counts=dict(Counter(iso(r["nextCollectionTime"]) for r in rows)))
    caps = Counter(f"{r['fundingRateLowerLimit']}..{r['fundingRateUpperLimit']}" for r in rows)
    log("caps", counts=dict(caps))
    for cap, n in caps.items():
        if n < 10:
            log("cap_rows", cap=cap, symbols=[r["symbol"] for r in rows if f"{r['fundingRateLowerLimit']}..{r['fundingRateUpperLimit']}" == cap])
    at = [r for r in rows if float(r["fundingRate"]) in (float(r["fundingRateUpperLimit"]), float(r["fundingRateLowerLimit"]))]
    log("at_cap", current=len(at), sample=[(r["symbol"], r["fundingRate"]) for r in at][:12])
    log("rate_equals_last", equal=sum(r["fundingRate"] == r["lastFundingRate"] for r in rows), rows=len(rows))
    for s in ["btc_usdt", "eth_usdt", "xau_usdt"]:
        log("funding_row", row=next((r for r in rows if r["symbol"] == s), None))
    for path in ["q/funding-rate", "q/funding-rates", "q/funding-rate/list", "q/premium-index"]:
        r = get_retry(q(path))
        log("bulk_funding_guess", path=path, status=r["status"], body=r["text"][:160])
        time.sleep(0.3)
    for s in ["btc_usdt", "eth_usdt", "xau_usdt"]:
        h = get_retry(q(f"q/funding-rate-record?symbol={s}"))
        items = (((h["json"] or {}).get("data")) or {}).get("items") or []
        gaps = [(items[j]["createdTime"] - items[j + 1]["createdTime"]) / 3.6e6 for j in range(len(items) - 1)]
        log("history", s=s, status=h["status"], n=len(items), hasNext=(((h["json"] or {}).get("data")) or {}).get("hasNext"), keys=list(items[0].keys()) if items else [], newest=items[0] if items else None, spacingHours=dict(Counter(gaps)), rates=dict(Counter(x.get("fundingRate") for x in items)))
        time.sleep(0.3)


def book():
    lst = get_retry(q("symbol/list"))
    cs = {x["symbol"]: x["contractSize"] for x in ((lst["json"] or {}).get("data") or [])}
    for level in [1, 5, 10, 20, 50, 100, 200, 500, 1000]:
        r = get_retry(q(f"q/depth?symbol=btc_usdt&level={level}"))
        d = ((r["json"] or {}).get("data")) or {}
        log("depth_level", level=level, status=r["status"], code=(r["json"] or {}).get("code"), msg=(r["json"] or {}).get("msg"), bids=len(d.get("b") or []), asks=len(d.get("a") or []), ms=r["ms"], bytes=r["bytes"])
        time.sleep(0.3)
    for s in ["btc_usdt", "eth_usdt", "doge_usdt", "xau_usdt", "aapl_usdt"]:
        r = get_retry(q(f"q/depth?symbol={s}&level=50"))
        d = ((r["json"] or {}).get("data")) or {}
        if not d.get("b"):
            log("depth", s=s, status=r["status"], body=r["text"][:160])
            continue
        b, a = d["b"], d["a"]
        desc = all(float(b[j][0]) < float(b[j - 1][0]) for j in range(1, len(b)))
        asc = all(float(a[j][0]) > float(a[j - 1][0]) for j in range(1, len(a)))
        types = dict(Counter(type(v).__name__ for lvl in b + a for v in lvl))
        sci = sum(1 for lvl in b + a if "e" in str(lvl[1]).lower())
        u = d.get("u")
        log("depth", s=s, keys=list(d.keys()), u=u, uType=type(u).__name__, uDecodedMs=((int(u) >> 22) + 1629702000000) if u else None, tAgeMs=round(time.time() * 1000) - d["t"] if d.get("t") else None, bids=len(b), asks=len(a), bidsDesc=desc, asksAsc=asc, types=types, sciSizes=sci, touch=[b[0], a[0]], contractSize=cs.get(s))
        time.sleep(0.3)
    r1 = get(q("q/depth?symbol=btc_usdt&level=20"))
    r2 = get(q("q/depth?symbol=btc_usdt&level=20"))
    g = lambda r: (((r["json"] or {}).get("data")) or {})
    log("cache", u1=g(r1).get("u"), u2=g(r2).get("u"), t1=g(r1).get("t"), t2=g(r2).get("t"), cacheHeaders={k: v for k, v in r1["headers"].items() if k.lower() in ("cache-control", "x-cache", "age", "via", "server")})


def errors():
    cases = [
        ("unknown symbol, depth", q("q/depth?symbol=nope_usdt&level=20")),
        ("missing level, depth", q("q/depth?symbol=btc_usdt")),
        ("level 7, depth", q("q/depth?symbol=btc_usdt&level=7")),
        ("unknown symbol, mark", q("q/mark-price?symbol=nope_usdt")),
        ("uppercase symbol, mark", q("q/mark-price?symbol=BTC_USDT")),
        ("unknown symbol, funding", q("q/funding-rate?symbol=nope_usdt")),
        ("unknown path", q("q/nope")),
    ]
    for name, url in cases:
        r = get_retry(url, tries=5)
        d = ((r["json"] or {}).get("data"))
        levels = [len(d.get("b") or []), len(d.get("a") or [])] if isinstance(d, dict) and "b" in d else None
        log("error_case", name=name, status=r["status"], tries=r["tries"], levels=levels, body=r["text"][:160], retryAfter=r["headers"].get("Retry-After"))
        time.sleep(0.5)


def clock():
    for _ in range(3):
        t0 = time.time() * 1000
        b = get(f"{BINANCE}/time")
        t1 = time.time() * 1000
        st = (b["json"] or {}).get("serverTime")
        log("local_vs_binance", status=b["status"], rttMs=round(t1 - t0), offsetMs=round(st - (t0 + t1) / 2) if st else None)
        time.sleep(0.5)
    # One kept-alive connection, so the round trip holds no TLS handshake and the midpoint bounds the offset.
    conn = warm_conn()
    for _ in range(6):
        t0 = time.time() * 1000
        status, text, _h = warm_get(conn, "/futures/fapi/market/v1/public/time")
        t1 = time.time() * 1000
        d = json.loads(text).get("data") if status == 200 else None
        log("server_time", status=status, rttMs=round(t1 - t0), body=text[:80], offsetMs=round(d - (t0 + t1) / 2) if isinstance(d, int) else None)
        time.sleep(0.5)
    for _ in range(3):
        t0 = time.time() * 1000
        status, text, headers = warm_get(conn, "/futures/fapi/market/v1/public/q/mark-price?symbol=btc_usdt")
        t1 = time.time() * 1000
        r = {"status": status}
        h = {k.lower(): v for k, v in headers.items()}
        date = h.get("date")
        log("headers", status=r["status"], rttMs=round(t1 - t0), date=date, dateOffsetMs=round(parsedate_to_datetime(date).timestamp() * 1000 - (t0 + t1) / 2) if date else None, server=h.get("server"), rateLimit={k: v for k, v in h.items() if "ratelimit" in k or "retry" in k})
        time.sleep(1)


def mirror():
    bn = get_retry(f"{BINANCE}/premiumIndex")
    m = get_retry(q("q/mark-price"))
    a = get_retry(q("q/agg-tickers"))
    log("reads", binance=[bn["status"], bn["ms"]], mgbxMark=[m["status"], m["ms"]], mgbxAgg=[a["status"], a["ms"]])
    if not bn["json"] or not (m["json"] or {}).get("data"):
        return
    bmap = {r["symbol"]: r for r in bn["json"]}
    to_mark, to_index = [], []
    for r in m["json"]["data"]:
        b = bmap.get(r["s"].replace("_", "").upper())
        if b:
            to_mark.append(abs(round((float(r["p"]) / float(b["markPrice"]) - 1) * 1e6)))
            to_index.append(abs(round((float(r["p"]) / float(b["indexPrice"]) - 1) * 1e6)))
    log("mark_vs_binance_mark", common=len(to_mark), absPpm=stats(to_mark))
    log("mark_vs_binance_index", common=len(to_index), absPpm=stats(to_index))
    idx = []
    for r in ((a["json"] or {}).get("data")) or []:
        b = bmap.get(r["s"].replace("_", "").upper())
        if b:
            idx.append(abs(round((float(r["i"]) / float(b["indexPrice"]) - 1) * 1e6)))
    log("agg_index_vs_binance_index", common=len(idx), absPpm=stats(idx))


MODES = {f.__name__: f for f in (latency, catalog, anchor, funding, book, errors, clock, mirror)}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "catalog"
    if mode not in MODES:
        sys.exit(f"unknown mode {mode}, one of {', '.join(MODES)}")
    log("start", mode=mode, at=datetime.now(timezone.utc).isoformat())
    MODES[mode]()
    log("end", mode=mode, at=datetime.now(timezone.utc).isoformat())
