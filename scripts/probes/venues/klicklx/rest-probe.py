# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""KlicklX perpetual REST probe for docs/profiles/klicklx/rest.md.

KlicklX publishes no futures API, so every call here is one the futures website makes without a login.
All of them are POST with a form body, read-only and unauthenticated, about 100 requests at no more than 1 per second.
Run from the repository root with: uv run scripts/probes/venues/klicklx/rest-probe.py
Raw replies go to .claude/survey-work/klicklx/rest-*.json.
"""

import collections
import email.utils
import html
import http.client
import json
import pathlib
import re
import socket
import ssl
import statistics
import time
import urllib.request

HOST = "ctapi.klicklx.com"  # futuresHost of the website config
OTHER_HOSTS = ["ctws.klicklx.com", "futures.klicklx.com", "www.klicklx.com", "api.klicklx.com"]
CTX = ssl.create_default_context()
HEADERS = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json",
           "Content-Type": "application/x-www-form-urlencoded"}
OUT = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "klicklx"

_conn: http.client.HTTPSConnection | None = None


def call(path: str, form: str = "", method: str = "POST", fresh: bool = False, pause: float = 1.0):
    """One request over a kept-alive connection. Returns status, headers, body, seconds."""
    global _conn
    if fresh or _conn is None:
        if _conn is not None:
            _conn.close()
        _conn = http.client.HTTPSConnection(HOST, 443, timeout=20, context=CTX)
    t0 = time.perf_counter()
    try:
        _conn.request(method, path, body=form.encode() if method == "POST" else None, headers=HEADERS)
        r = _conn.getresponse()
        body = r.read().decode("utf-8", "replace")
    except (http.client.HTTPException, OSError):
        _conn.close()
        _conn = None
        if fresh:
            raise
        return call(path, form, method, fresh=True, pause=pause)
    dt = time.perf_counter() - t0
    time.sleep(pause)
    return r.status, {k.lower(): v for k, v in r.getheaders()}, body, dt


def jcall(path: str, form: str = "", **kw):
    status, headers, body, dt = call(path, form, **kw)
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None
    return status, headers, body, dt, data


def save(name: str, obj):
    (OUT / f"rest-{name}.json").write_text(json.dumps(obj, indent=1, ensure_ascii=False, default=str))


def section(title: str):
    print(f"\n== {title}")


def hms(s: str) -> int:
    h, m, sec = (int(x) for x in s.split(":"))
    return (h * 3600 + m * 60 + sec) * 1000


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    section("1. hosts and latency")
    for h in [HOST] + OTHER_HOSTS:
        t0 = time.perf_counter()
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        print(f"{h}: {addrs} resolved in {round((time.perf_counter() - t0) * 1000)} ms")
    cold = []
    for _ in range(3):
        st, hd, body, dt = call("/api/baseinfo/GetContracts", fresh=True)
        cold.append(round(dt * 1000))
    warm = []
    for _ in range(5):
        st, hd, body, dt = call("/api/baseinfo/GetContracts")
        warm.append(round(dt * 1000))
    print(f"GetContracts cold ms {cold}, warm ms {warm}, status {st}, bytes {len(body)}")
    print("server headers:", {k: hd[k] for k in hd if k in ("server", "cf-ray", "cf-cache-status", "cache-control",
                                                             "content-encoding", "vary", "date")})
    print("rate limit headers:", {k: v for k, v in hd.items() if "limit" in k or "retry" in k} or "none")

    section("2. catalog, POST /api/baseinfo/GetContracts")
    cat = json.loads(body)
    save("contracts", cat)
    rows = cat["data"]
    print("envelope:", {k: cat[k] for k in cat if k != "data"})
    print("contracts:", len(rows))
    print("symbolType counts:", dict(collections.Counter(r["symbolType"] for r in rows)))
    print("isLimit true:", sum(bool(r["isLimit"]) for r in rows))
    print("quote suffix counts:", dict(collections.Counter(r["name"][-4:] for r in rows)))
    print("fields:", sorted(rows[0].keys()))
    for r in rows:
        print(f"  {r['name']:<14} id {r['id']} type {r['symbolType']} faceValue {r['faceValue']} "
              f"tickSize {r['tickSize']} lev {r['level']} underlying {r['underlying']}")
    ids = {r["id"]: r["name"] for r in rows}
    st, hd, body, dt, coins = jcall("/api/baseinfo/GetCoins")
    print("GetCoins codes:", [c["code"] for c in coins["data"]])

    section("3. anchor, POST /api/market/RealTimeHandicapFull")
    st, hd, body, dt, full = jcall("/api/market/RealTimeHandicapFull")
    local = time.time() * 1000
    save("handicap-full", full)
    t = full["data"]
    print(f"status {st}, bytes {len(body)}, ms {round(dt * 1000)}, rows {len(t)}")
    print("row fields:", sorted(t[0].keys()))
    print("catalog ids missing from reply:", sorted(set(ids) - {r["contractId"] for r in t}))
    for r in t:
        nxt = r["timestamp"] + hms(r["distanceSettlementTime"])
        nxt_utc = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(round(nxt / 1000)))
        unit = r["turnover24H"] / r["volume24H"] / r["markPrice"] if r["volume24H"] and r["markPrice"] else None
        print(f"  {r['symbol']:<14} mark {r['markPrice']} index {r['indexPrice']} current {r['currentFundRate']} "
              f"forecast {r['forecastFundRate']} interval {r['intervalHour']} h, distance {r['distanceSettlementTime']}, "
              f"next about {nxt_utc} UTC, createTime {r['createTime']}, age {round(local - r['timestamp'])} ms, "
              f"turnover/volume/mark {round(unit, 3) if unit else None}")

    section("3b. funding lists")
    st, hd, body, dt, real = jcall("/api/market/GetRealFundingRateList")
    save("funding-real", real)
    print(f"GetRealFundingRateList status {st}, ms {round(dt * 1000)}, bytes {len(body)}, rows {len(real['data'])}, fields {sorted(real['data'][0].keys())}")
    by_id = {r["contractId"]: r for r in t}
    same = sum(abs(float(x["rate"]) - float(by_id[x["contractId"]]["currentFundRate"])) < 1e-12
               for x in real["data"] if x["contractId"] in by_id)
    print("rows whose rate equals currentFundRate:", same, "of", len(real["data"]))
    print("createTimeOffset values (ms):", sorted({x["createTimeOffset"] for x in real["data"]}))
    btc = next(r["id"] for r in rows if r["name"] == "BTCUSDT")
    st, hd, body, dt, hist = jcall("/api/market/GetHistoryFundingRateList", f"contractId={btc}&pageIndex=1&pageRows=6")
    save("funding-history-btc", hist)
    print(f"GetHistoryFundingRateList BTCUSDT ms {round(dt * 1000)}, total {hist.get('total')}")
    for h in hist["data"]:
        print(f"  createTime {h['createTime']} offset {h['createTimeOffset']} "
              f"({time.strftime('%Y-%m-%d %H:%M', time.gmtime(h['createTimeOffset']))} UTC) "
              f"realRate {h['realRate']} predictionRate {h['predictionRate']}")
    print("BTC currentFundRate", by_id[btc]["currentFundRate"], "forecastFundRate", by_id[btc]["forecastFundRate"])

    section("4. 60 polls of RealTimeHandicapFull at 1 per second")
    track = ["BTCUSDT", "ETHUSDT", "XAUUSDT", "TSLAUSDT"]
    prev: dict = {}
    changes = collections.defaultdict(collections.Counter)
    times, ages = [], []
    for i in range(60):
        st, hd, body, dt, d = jcall("/api/market/RealTimeHandicapFull", pause=0)
        local = time.time() * 1000
        times.append(dt * 1000)
        for r in d["data"]:
            ages.append(local - r["timestamp"])
            if r["symbol"] not in track:
                continue
            for f in ("markPrice", "indexPrice", "forecastFundRate", "currentFundRate", "timestamp"):
                if r["symbol"] in prev and prev[r["symbol"]][f] != r[f]:
                    changes[r["symbol"]][f] += 1
            prev[r["symbol"]] = r
        time.sleep(max(0, 1 - dt))
    print(f"reply ms median {round(statistics.median(times))}, max {round(max(times))}")
    print(f"row age ms median {round(statistics.median(ages))}, max {round(max(ages))}, min {round(min(ages))}")
    for s in track:
        print(f"  {s}: changes in 59 intervals {dict(changes[s])}")

    section("5. REST book, POST /api/market/Depth")
    for form, label in [(f"contractId={btc}&tickSize=0.1", "BTC tick 0.1"),
                        (f"contractId={btc}&tickSize=10", "BTC tick 10"),
                        (f"contractId={btc}", "BTC no tickSize"),
                        ("contractId=123&tickSize=0.1", "unknown id"),
                        (f"contractId={btc}&tickSize=0.1&limit=500", "BTC with limit=500")]:
        st, hd, body, dt, d = jcall("/api/market/Depth", form)
        dd = (d or {}).get("data") or {}
        bids, asks = dd.get("bids") or [], dd.get("asks") or []
        order = (bids == sorted(bids, key=lambda x: -x[0]), asks == sorted(asks, key=lambda x: x[0]))
        print(f"  {label}: status {st}, ms {round(dt * 1000)}, levels {len(bids)}/{len(asks)}, "
              f"bids desc and asks asc {order}, top {bids[:2]} {asks[:2]}, cache {hd.get('cf-cache-status')}, "
              f"envelope {({k: d[k] for k in d if k != 'data'} if d else body[:200])}")
        if label == "BTC tick 0.1":
            save("depth-btc", d)

    section("6. error shapes")
    for path, form, method in [("/api/market/RealTimeHandicapFull", "", "GET"),
                               ("/api/market/NoSuchCall", "", "POST"),
                               ("/api/market/RealTimeHandicap", f"contractId={btc}", "POST"),
                               ("/api/market/RealTimeHandicap", "", "POST"),
                               ("/api/account/GetMyHandlingFee", "", "POST")]:
        st, hd, body, dt = call(path, form, method=method)
        print(f"  {method} {path} {form or '(empty)'}: {st} {round(dt * 1000)} ms {body[:300]!r}")

    section("6b. legacy IDCM spot API on api.klicklx.com")
    base = "https://api.klicklx.com"
    r = urllib.request.Request(f"{base}/api/idcm/foundation/app/ApiDocument/GetApiDocumentTitleList", data=b"{}",
                               headers={**HEADERS, "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=20) as resp:
        titles = json.loads(resp.read())
    print("API document sections:", [(g["EName"], [i["EName"] + " #" + i["ID"] for i in g["Items"]]) for g in titles["Data"]])
    time.sleep(1)
    for doc_id in ("5", "9", "14"):
        with urllib.request.urlopen(urllib.request.Request(
                f"{base}/api/idcm/foundation/app/ApiDocument/GetApiDocument?id={doc_id}", headers=HEADERS), timeout=20) as resp:
            content = (json.loads(resp.read()).get("Extra") or {}).get("Content") or ""
        plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", content)))
        print(f"document {doc_id}: {plain[:260]}")
        time.sleep(1)
    r = urllib.request.Request(f"{base}/api/v1/getticker", data=b'{"Symbol":"BTC-USDT"}',
                               headers={**HEADERS, "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=20) as resp:
        print(f"POST /api/v1/getticker without a key: {resp.status} {resp.read()[:200]!r}")
    time.sleep(1)
    c = http.client.HTTPSConnection("api.klicklx.com", 443, timeout=20, context=CTX)
    c.request("GET", "/websocket", headers={"User-Agent": HEADERS["User-Agent"], "Connection": "Upgrade",
                                            "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
                                            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="})
    resp = c.getresponse()
    print(f"upgrade request to wss://api.klicklx.com/websocket: {resp.status} {resp.read()[:120]!r}")
    c.close()

    section("7. clock")
    offsets = []
    for _ in range(3):
        t0 = time.time()
        st, hd, body, dt, d = jcall("/api/market/RealTimeHandicapFull")
        mid = (t0 + t0 + dt) / 2
        srv = email.utils.parsedate_to_datetime(hd["date"]).timestamp()
        newest = max(r["timestamp"] for r in d["data"]) / 1000
        offsets.append((round(srv - mid, 2), round(newest - mid, 3)))
    print("Date header minus local, newest row timestamp minus local (s):", offsets)


if __name__ == "__main__":
    main()
