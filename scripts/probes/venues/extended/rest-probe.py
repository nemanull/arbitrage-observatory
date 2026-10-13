# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""Read-only probe of the Extended public REST API (CCXT id extended).

Modes: host (about 15 s), catalog (5 s), anchor (75 s: 60 polls of every market at 1 s, then 10 of the order book markets), funding (10 s), book (15 s), errors (10 s), and all of them in turn by default, about two minutes.
Every call is a public GET with a User-Agent, as the API documentation requires, and stays far below the documented 1,000 requests a minute per IP.
Run from the repository root: uv run scripts/probes/venues/extended/rest-probe.py [mode]
Captures go to .claude/survey-work/extended/.
"""

import collections
import json
import socket
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

WORK = Path(".claude/survey-work/extended")
HOST = "api.starknet.extended.exchange"
BASE = f"https://{HOST}/api/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"


def iso(ms: int | float | None) -> str:
    if not ms:
        return str(ms)
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def summary_ms(values: list[float]) -> str:
    return f"min {min(values):.0f} median {statistics.median(values):.0f} max {max(values):.0f}"


def client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": UA}, timeout=15.0)


def timed_get(c: httpx.Client, path: str, **kw) -> tuple[httpx.Response, float]:
    t0 = time.perf_counter()
    r = c.get(BASE + path, **kw)
    return r, (time.perf_counter() - t0) * 1000


def save(name: str, payload) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text(json.dumps(payload, indent=1) if not isinstance(payload, str) else payload)


def mode_host() -> None:
    print(f"## host {now()}")
    infos = socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)
    print("resolved", sorted({i[4][0] for i in infos}))
    try:
        print("canonical", socket.gethostbyname_ex(HOST))
    except OSError as e:
        print("gethostbyname_ex failed", e)
    with client() as c:
        r, ms = timed_get(c, "/info/markets", params={"market": "BTC-USD"})
        print(f"first request ms {ms:.0f} status {r.status_code} http {r.http_version} bytes {len(r.content)}")
        print("headers", dict(r.headers))
        warm = []
        for _ in range(10):
            r, ms = timed_get(c, "/info/markets", params={"market": "BTC-USD"})
            warm.append(ms)
            time.sleep(0.3)
        print(f"warm one-market calls ms min {min(warm):.0f} median {statistics.median(warm):.0f} max {max(warm):.0f}")
        r, ms = timed_get(c, "/info/markets/BTC-USD/stats")
        print(f"stats one request ms {ms:.0f} status {r.status_code} bytes {len(r.content)}")
        r, ms = timed_get(c, "/info/markets", headers={"Accept-Encoding": "gzip"})
        print(f"all markets gzip ms {ms:.0f} status {r.status_code} wire content-encoding {r.headers.get('content-encoding')} content-length {r.headers.get('content-length')} decoded bytes {len(r.content)}")
        r, ms = timed_get(c, "/info/markets", headers={"Accept-Encoding": "identity"})
        print(f"all markets identity ms {ms:.0f} status {r.status_code} content-length {r.headers.get('content-length')} decoded bytes {len(r.content)}")
        date = r.headers.get("date")
        print("server date header", date, "local", now())
    for ua in (None, ""):
        hdrs = {} if ua is None else {"User-Agent": ua}
        with httpx.Client(timeout=15.0) as bare:
            req = bare.build_request("GET", BASE + "/info/markets", params={"market": "BTC-USD"}, headers=hdrs)
            if ua is None:
                del req.headers["User-Agent"]
            r = bare.send(req)
            print(f"User-Agent {'absent' if ua is None else 'empty'}: status {r.status_code} bytes {len(r.content)} body {r.text[:160]!r}")


def mode_catalog() -> None:
    print(f"## catalog {now()}")
    with client() as c:
        r, ms = timed_get(c, "/info/markets")
        body = r.json()
        save("catalog-markets.json", body)
        rows = body["data"]
        print(f"status {r.status_code} ms {ms:.0f} bytes {len(r.content)} rows {len(rows)} cache-control {r.headers.get('cache-control')}")
        print("keys of first row", sorted(rows[0].keys()))
        count = collections.Counter
        print("type", count(x.get("type") for x in rows))
        perps = [x for x in rows if x.get("type") == "PERPETUAL"]
        print("perpetual status", count(x["status"] for x in perps))
        print("perpetual active flag by status", count((x["status"], x["active"]) for x in perps))
        print("perpetual collateral", count(x["collateralAssetName"] for x in perps))
        print("perpetual isRfq by status", count((x["status"], x["isRfq"]) for x in perps))
        print("perpetual category", count(x.get("category") for x in perps))
        print("perpetual category and isRfq, ACTIVE only", count((x.get("category"), x["isRfq"]) for x in perps if x["status"] == "ACTIVE"))
        print("perpetual tradingHours, ACTIVE only", count(x.get("tradingHours") for x in perps if x["status"] == "ACTIVE"))
        print("perpetual isOffHours, ACTIVE only", count(x.get("isOffHours") for x in perps if x["status"] == "ACTIVE"))
        print("perpetual subCategory, ACTIVE only", count(x.get("subCategory") for x in perps if x["status"] == "ACTIVE"))
        print("visibleOnUi, ACTIVE only", count(x.get("visibleOnUi") for x in perps if x["status"] == "ACTIVE"))
        names = [x["name"] for x in perps]
        bad_names = [n for n in names if not n.endswith("-USD")]
        print("perpetual names not ending in -USD", bad_names)
        mism = [(x["name"], x["assetName"]) for x in perps if x["name"] != x["assetName"] + "-USD"]
        print("name != assetName-USD", mism[:40], len(mism))
        kpref = [x["name"] for x in perps if x["assetName"][:1] == "k" and x["assetName"][1:2].isupper()]
        print("k-prefixed", kpref, len(kpref))
        k1000 = [x["name"] for x in perps if x["assetName"].startswith("1000")]
        print("1000-prefixed", k1000)
        weird = [x["name"] for x in perps if "_" in x["name"]]
        print("names with an underscore", weird, len(weird))
        assets = count(x["assetName"] for x in perps if x["status"] == "ACTIVE")
        print("assetName listed twice among ACTIVE perps", [a for a, n in assets.items() if n > 1])
        upper = count(x["assetName"].upper().lstrip("K") if x["assetName"][:1] == "k" else x["assetName"].upper() for x in perps if x["status"] == "ACTIVE")
        print("ACTIVE perps folding to one base after upper case and k removal", [a for a, n in upper.items() if n > 1])
        zero_mark = [x["name"] for x in perps if x["status"] == "ACTIVE" and float(x["marketStats"].get("markPrice") or 0) == 0]
        zero_index = [x["name"] for x in perps if x["status"] == "ACTIVE" and float(x["marketStats"].get("indexPrice") or 0) == 0]
        eq = [x["name"] for x in perps if x["status"] == "ACTIVE" and x["marketStats"].get("markPrice") == x["marketStats"].get("indexPrice")]
        print("ACTIVE perps with mark 0", zero_mark)
        print("ACTIVE perps with index 0", zero_index)
        print("ACTIVE perps with mark string equal to index string", eq, len(eq))
        no_book = [x["name"] for x in perps if x["status"] == "ACTIVE" and (float(x["marketStats"].get("bidPrice") or 0) == 0 or float(x["marketStats"].get("askPrice") or 0) == 0)]
        print("ACTIVE perps with bid or ask 0 in stats", no_book, len(no_book))
        caps = count(x["tradingConfig"].get("hourlyFundingRateCap") for x in perps if x["status"] == "ACTIVE")
        print("hourlyFundingRateCap values, ACTIVE", caps)
        nf = count(x["marketStats"].get("nextFundingRate") for x in perps if x["status"] == "ACTIVE")
        print("nextFundingRate values, ACTIVE", {iso(k): v for k, v in nf.items()})
        print("ACTIVE l2Config.type", count(x.get("l2Config", {}).get("type") for x in perps if x["status"] == "ACTIVE"))
        nonactive = [(x["name"], x["status"], x["active"]) for x in perps if x["status"] != "ACTIVE"]
        print("non ACTIVE perps sample", nonactive[:30])
        spot = [(x["name"], x["status"], x["assetName"], x["collateralAssetName"]) for x in rows if x.get("type") == "SPOT"]
        print("spot rows", spot)
        rfq_sample = [x["name"] for x in perps if x["isRfq"] and x["status"] == "ACTIVE"][:15]
        ob = [x["name"] for x in perps if not x["isRfq"] and x["status"] == "ACTIVE"]
        print("order book ACTIVE perps", ob, len(ob))
        print("RFQ ACTIVE sample", rfq_sample)
        off = [(x["name"], x["tradingHours"], x["category"]) for x in perps if x["status"] == "ACTIVE" and x["isOffHours"]]
        print("ACTIVE perps off hours now", off)
        sizes = count(x["l2Config"].get("syntheticResolution") for x in perps if x["status"] == "ACTIVE")
        print("syntheticResolution values, ACTIVE", sizes)
        created = sorted((x.get("createdAt") or 0, x["name"]) for x in perps if x["status"] == "ACTIVE")
        print("oldest and newest ACTIVE createdAt", [(iso(a), b) for a, b in created[:2]], [(iso(a), b) for a, b in created[-3:]])


def mode_anchor() -> None:
    print(f"## anchor {now()}")
    polls = []
    with client() as c:
        for i in range(60):
            t_start = time.time()
            r, ms = timed_get(c, "/info/markets")
            arrival = int(time.time() * 1000)
            rows = {x["name"]: x for x in r.json()["data"] if x.get("type") == "PERPETUAL" and x["status"] == "ACTIVE"}
            polls.append((arrival, ms, len(r.content), rows, dict(r.headers)))
            time.sleep(max(0.0, 1.0 - (time.time() - t_start)))
    times = [p[1] for p in polls]
    sizes = [p[2] for p in polls]
    print(f"polls {len(polls)} ms min {min(times):.0f} median {statistics.median(times):.0f} p90 {pct(times, 0.9):.0f} max {max(times):.0f}")
    print(f"bytes min {min(sizes)} max {max(sizes)}")
    print("headers of last poll", polls[-1][4])
    names = sorted(set(polls[0][3]) & set(polls[-1][3]))
    print("markets in first and last poll", len(names))
    for field in ("markPrice", "indexPrice", "fundingRate", "nextFundingRate", "bidPrice", "askPrice", "lastPrice"):
        change_rates = []
        for n in names:
            seq = [p[3][n]["marketStats"].get(field) for p in polls if n in p[3]]
            changes = sum(1 for a, b in zip(seq, seq[1:]) if a != b)
            change_rates.append(changes / max(1, len(seq) - 1))
        print(f"{field}: share of 1 s polls that changed, over markets: median {statistics.median(change_rates):.2f} p10 {pct(change_rates, 0.1):.2f} p90 {pct(change_rates, 0.9):.2f}; markets that never changed {sum(1 for x in change_rates if x == 0)}")
    identical = sum(1 for a, b in zip(polls, polls[1:]) if json.dumps(a[3], sort_keys=True) == json.dumps(b[3], sort_keys=True))
    print("consecutive polls with identical bodies", identical)
    for n in ("BTC-USD", "ETH-USD"):
        seq = [(p[0], p[3][n]["marketStats"]["markPrice"], p[3][n]["marketStats"]["indexPrice"], p[3][n]["marketStats"]["fundingRate"]) for p in polls if n in p[3]]
        print(n, "first ten polls (arrival, mark, index, funding):")
        for row in seq[:10]:
            print("  ", iso(row[0]), row[1], row[2], row[3])
        marks = len({s[1] for s in seq})
        indexes = len({s[2] for s in seq})
        fundings = len({s[3] for s in seq})
        print(f"  distinct mark {marks} index {indexes} funding {fundings} over {len(seq)} polls")
    ratios = []
    for n in names:
        ms_ = polls[-1][3][n]["marketStats"]
        m, ix = float(ms_["markPrice"] or 0), float(ms_["indexPrice"] or 0)
        if m and ix:
            ratios.append(((m - ix) / ix * 1e6, n, polls[-1][3][n]["isRfq"], polls[-1][3][n]["category"]))
    ratios.sort()
    print("premium (mark - index) / index in ppm, last poll: lowest", [(round(a), b, c, d) for a, b, c, d in ratios[:6]], "highest", [(round(a), b, c, d) for a, b, c, d in ratios[-6:]])
    for label, pred in (("order book", lambda r: not r[2]), ("RFQ", lambda r: r[2])):
        sel = [abs(r[0]) for r in ratios if pred(r)]
        if sel:
            print(f"{label}: |premium| ppm median {statistics.median(sel):.0f} p90 {pct(sel, 0.9):.0f} max {max(sel):.0f} n {len(sel)}")
    zero_prem = [r[1] for r in ratios if r[0] == 0]
    print("markets with premium exactly 0 at last poll", zero_prem, len(zero_prem))
    always_eq = [n for n in names if all(p[3][n]["marketStats"]["markPrice"] == p[3][n]["marketStats"]["indexPrice"] for p in polls if n in p[3])]
    print("markets whose mark string equalled the index string on every poll", len(always_eq), "of which order book", [n for n in always_eq if not polls[-1][3][n]["isRfq"]])
    ob = [n for n in names if not polls[-1][3][n]["isRfq"]]
    with client() as c:
        sub = []
        for _ in range(10):
            r, ms = timed_get(c, "/info/markets", params=[("market", n) for n in ob])
            sub.append((ms, len(r.content), len(r.json()["data"])))
            time.sleep(1)
    print(f"filtered call for the {len(ob)} order book markets: ms {summary_ms([x[0] for x in sub])}, bytes {sub[-1][1]}, rows {sub[-1][2]}")
    nf = collections.Counter(polls[-1][3][n]["marketStats"]["nextFundingRate"] for n in names)
    print("nextFundingRate in last poll", {iso(k): v for k, v in nf.items()}, "last arrival", iso(polls[-1][0]))
    save("anchor-last-poll.json", {n: polls[-1][3][n]["marketStats"] | {"isRfq": polls[-1][3][n]["isRfq"]} for n in names})


def mode_funding() -> None:
    print(f"## funding {now()}")
    end = int(time.time() * 1000)
    start = end - 26 * 3600 * 1000
    with client() as c:
        cat = c.get(BASE + "/info/markets").json()["data"]
        perps = {x["name"]: x for x in cat if x.get("type") == "PERPETUAL" and x["status"] == "ACTIVE"}
        rfq = next(n for n, x in perps.items() if x["isRfq"] and x["category"] == "Crypto")
        rwa = next((n for n, x in perps.items() if x["category"] != "Crypto" and not x["isRfq"]), None)
        rwa_rfq = next((n for n, x in perps.items() if x["category"] != "Crypto" and x["isRfq"]), None)
        for name in [n for n in ("BTC-USD", "ETH-USD", rfq, rwa, rwa_rfq) if n]:
            r, ms = timed_get(c, f"/info/{name}/funding", params={"startTime": start, "endTime": end, "limit": 100})
            body = r.json()
            data = body.get("data") or []
            save(f"funding-{name}.json", body)
            ts = sorted(x["T"] for x in data)
            gaps = [round((b - a) / 60000, 2) for a, b in zip(ts, ts[1:])]
            offsets = [x % 3600000 for x in ts]
            print(f"{name} rfq={perps[name]['isRfq']} category={perps[name]['category']}: status {r.status_code} ms {ms:.0f} rows {len(data)} pagination {body.get('pagination')}")
            if data:
                print("  newest three", [(iso(x["T"]), x["f"]) for x in data[:3]])
                print("  gaps in minutes", collections.Counter(gaps))
                print("  ms after the whole hour: min", min(offsets), "median", statistics.median(offsets), "max", max(offsets))
                print("  live fundingRate", perps[name]["marketStats"]["fundingRate"], "nextFundingRate", iso(perps[name]["marketStats"]["nextFundingRate"]), "cap per hour %", perps[name]["tradingConfig"]["hourlyFundingRateCap"])
                fs = [abs(float(x["f"])) for x in data]
                print("  |f| max", max(fs), "distinct values", len(set(x["f"] for x in data)))
        r, ms = timed_get(c, "/info/BTC-USD/funding", params={"startTime": end - 3600 * 1000 * 3, "endTime": end})
        print("BTC-USD without limit, 3 h window: status", r.status_code, "rows", len(r.json().get("data") or []))


def mode_book() -> None:
    print(f"## book {now()}")
    with client() as c:
        cat = c.get(BASE + "/info/markets").json()["data"]
        perps = {x["name"]: x for x in cat if x.get("type") == "PERPETUAL" and x["status"] == "ACTIVE"}
        rfq = [n for n, x in perps.items() if x["isRfq"]][:2]
        ob = [n for n in ("BTC-USD", "ETH-USD") if n in perps]
        rwa = [n for n, x in perps.items() if x["category"] != "Crypto" and not x["isRfq"]][:1]
        for name in ob + rfq + rwa:
            r, ms = timed_get(c, f"/info/markets/{name}/orderbook")
            body = r.json()
            save(f"book-{name}.json", body)
            d = body["data"]
            bids = [float(x["price"]) for x in d["bid"]]
            asks = [float(x["price"]) for x in d["ask"]]
            print(f"{name} rfq={perps[name]['isRfq']} status {r.status_code} ms {ms:.0f} bytes {len(r.content)} bids {len(bids)} asks {len(asks)} cache-control {r.headers.get('cache-control')}")
            print("  bid order descending", bids == sorted(bids, reverse=True), "ask order ascending", asks == sorted(asks), "best", bids[:1], asks[:1], "level keys", sorted(d["bid"][0].keys()) if d["bid"] else None)
            r2, ms2 = timed_get(c, f"/info/markets/{name}/orderbook")
            print("  second read 0 s later identical", r2.json() == body, f"ms {ms2:.0f}")
            stats = perps[name]["marketStats"]
            print("  stats bid/ask", stats["bidPrice"], stats["askPrice"], "mark", stats["markPrice"], "index", stats["indexPrice"])
        r, ms = timed_get(c, "/info/markets/BTC-USD/orderbook", params={"limit": 5})
        print("limit=5 query: bids", len(r.json()["data"]["bid"]))
        r, ms = timed_get(c, "/info/markets/BTC-USD/orderbook", params={"depth": 1})
        print("depth=1 query: bids", len(r.json()["data"]["bid"]))


def mode_errors() -> None:
    print(f"## errors {now()}")
    with client() as c:
        for path, params in (
            ("/info/markets/NOPE-USD/orderbook", None),
            ("/info/markets/NOPE-USD/stats", None),
            ("/info/NOPE-USD/funding", {"startTime": 0, "endTime": 1}),
            ("/info/markets", {"market": "NOPE-USD"}),
            ("/info/BTC-USD/funding", None),
            ("/info/nothing", None),
            ("/info/assets/BTC/price", None),
            ("/info/assets/NOPE/price", None),
        ):
            r, ms = timed_get(c, path, params=params)
            print(f"GET {path} {params}: status {r.status_code} ms {ms:.0f} body {r.text[:220]!r}")
        r = c.post(BASE + "/info/markets")
        print("POST /info/markets: status", r.status_code, "body", r.text[:200])
        r = c.get(BASE + "/info/markets", params={"market": "BTC-USD"})
        print("ordinary request again: status", r.status_code)
        rl = {k: v for k, v in r.headers.items() if "rate" in k.lower() or "limit" in k.lower() or "retry" in k.lower()}
        print("rate limit headers on an ordinary reply", rl)


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "funding": mode_funding, "book": mode_book, "errors": mode_errors}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    for m in picked:
        MODES[m]()
        print()
