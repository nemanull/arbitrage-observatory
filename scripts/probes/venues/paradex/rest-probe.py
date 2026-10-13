# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""Read-only probe of the Paradex public REST API, https://api.prod.paradex.trade/v1.

Modes: host (about 15 s), catalog (about 10 s), anchor (about 75 s), funding (about 10 s), book (about 20 s), books (about 30 s), errors (about 10 s), identity (about 5 s, one public call each to binance and bybit as references), and all of them in turn by default.
Every call is a public GET with no key, no signature and no account.
The probe stays near 6 requests a second at its busiest, under the documented 1,500 a minute per IP.
Run from the repository root: uv run scripts/probes/venues/paradex/rest-probe.py [mode]
Captures go to .claude/survey-work/paradex/.
"""

import collections
import gzip
import json
import socket
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

WORK = Path(".claude/survey-work/paradex")
API = "https://api.prod.paradex.trade/v1"
HOSTS = ["api.prod.paradex.trade", "ws.api.prod.paradex.trade"]
SAMPLE = ["BTC-USD-PERP", "ETH-USD-PERP", "kPEPE-USD-PERP", "XAU-USD-PERP", "NVDA-USD-PERP", "US500-USD-PERP"]
HEADERS_OF_INTEREST = ("cache-control", "content-encoding", "content-length", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-window", "retry-after", "paradigm-request-duration", "paradigm-request-received", "server", "via", "x-cache", "age")


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def save(name: str, data) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / name
    if isinstance(data, (bytes, bytearray)):
        path.write_bytes(data)
    else:
        path.write_text(json.dumps(data, indent=1))


def pick(headers: httpx.Headers) -> dict:
    return {k: headers[k] for k in HEADERS_OF_INTEREST if k in headers}


def get(client: httpx.Client, path: str, params=None, headers=None):
    t0 = time.perf_counter()
    sent = now_ms()
    r = client.get(API + path, params=params, headers=headers)
    ms = (time.perf_counter() - t0) * 1000
    return r, ms, sent


def quantiles(values):
    values = sorted(values)
    if not values:
        return {}
    def q(p):
        return values[min(len(values) - 1, int(p * (len(values) - 1) + 0.5))]
    return {"n": len(values), "min": round(values[0], 1), "p50": round(q(0.5), 1), "p90": round(q(0.9), 1), "max": round(values[-1], 1)}


def mode_host() -> None:
    print(f"== host {utc()}")
    for host in HOSTS:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except OSError as error:
            addrs = [f"resolve failed: {error}"]
        try:
            cname = socket.gethostbyname_ex(host)
        except OSError as error:
            cname = str(error)
        print(f"{host}: {addrs} gethostbyname_ex={cname}")
    with httpx.Client(timeout=20) as client:
        r, ms, sent = get(client, "/system/time")
        print(f"cold /system/time status={r.status_code} ms={ms:.1f} http={r.http_version} body={r.text}")
        print(f"cold headers {pick(r.headers)}")
        warm = []
        offsets = []
        for _ in range(10):
            r, ms, sent = get(client, "/system/time")
            got = now_ms()
            warm.append(ms)
            server = int(r.json()["server_time"])
            offsets.append({"rtt_ms": round(ms, 1), "local_minus_server_at_send": sent - server, "local_minus_server_at_recv": got - server})
            time.sleep(0.3)
        print(f"warm /system/time {quantiles(warm)}")
        best = min(offsets, key=lambda o: o["rtt_ms"])
        print(f"clock: smallest rtt {best}")
        print(f"clock: all {offsets}")
        r, ms, sent = get(client, "/system/state")
        print(f"/system/state status={r.status_code} ms={ms:.1f} body={r.text}")


def mode_catalog() -> None:
    print(f"== catalog {utc()}")
    with httpx.Client(timeout=60) as client:
        r, ms, sent = get(client, "/markets", headers={"Accept-Encoding": "identity"})
        raw = r.content
        print(f"/markets status={r.status_code} ms={ms:.0f} bytes={len(raw)} headers={pick(r.headers)}")
        rz, msz, _ = get(client, "/markets", headers={"Accept-Encoding": "gzip"})
        print(f"/markets gzip: content-encoding={rz.headers.get('content-encoding')} wire bytes={rz.num_bytes_downloaded} decoded bytes={len(rz.content)} ms={msz:.0f}")
        markets = r.json()["results"]
        save("catalog-markets.json", markets)
        kinds = collections.Counter((m.get("asset_kind"), m.get("quote_currency"), m.get("settlement_currency"), m.get("trading_mode"), m.get("market_kind")) for m in markets)
        print("asset_kind, quote, settle, trading_mode, market_kind:")
        for key, count in kinds.most_common():
            print(f"  {count} {key}")
        perps = [m for m in markets if m.get("asset_kind") == "PERP"]
        spots = [m for m in markets if m.get("asset_kind") == "SPOT"]
        future = [m["symbol"] for m in perps if (m.get("open_at") or 0) > now_ms()]
        print(f"perps={len(perps)} spot={[m['symbol'] for m in spots]} opening later={future}")
        print("funding_period_hours, funding_multiplier, max_funding_rate on perps:", collections.Counter((m.get("funding_period_hours"), m.get("funding_multiplier"), m.get("max_funding_rate")) for m in perps).most_common())
        groups = collections.defaultdict(list)
        for m in perps:
            groups[(m.get("max_funding_rate"), m.get("funding_multiplier"))].append(m["base_currency"])
        print("bases by max_funding_rate and funding_multiplier:", {f"{k[0]} x{k[1]}": sorted(v) for k, v in groups.items()})
        print("clamp_rate, interest_rate, max_funding_rate_change on perps:", collections.Counter((m.get("clamp_rate"), m.get("interest_rate"), m.get("max_funding_rate_change")) for m in perps).most_common())
        print("price_bands_width on perps:", collections.Counter(m.get("price_bands_width") for m in perps).most_common())
        print("fields that name an owner or deployer:", sorted({k for m in markets for k in m if any(w in k for w in ("deploy", "owner", "builder", "creator"))}))
        print("fee_config on perps:", collections.Counter(json.dumps(m.get("fee_config"), sort_keys=True) for m in perps).most_common())
        print("tags on perps:", collections.Counter(tuple(m.get("tags") or []) for m in perps).most_common())
        bases = collections.Counter(m["base_currency"] for m in perps)
        print("bases listed twice:", [b for b, c in bases.items() if c > 1])
        print("symbol equals base-USD-PERP:", sum(1 for m in perps if m["symbol"] == f"{m['base_currency']}-USD-PERP"), "of", len(perps))
        print("lowercase prefixed bases:", [m["base_currency"] for m in perps if m["base_currency"][:1].islower()])
        print("enableTrading field present on:", sum(1 for m in markets if "enableTrading" in m), "markets")
        print("perp symbols:", sorted(m["symbol"] for m in perps))
        print("RWA perps:", sorted(m["symbol"] for m in perps if "RWA" in (m.get("tags") or [])))
        btc = next(m for m in perps if m["symbol"] == "BTC-USD-PERP")
        print("BTC-USD-PERP row:", json.dumps(btc))
        r1, ms1, _ = get(client, "/markets", params={"market": "BTC-USD-PERP"})
        print(f"/markets?market=BTC-USD-PERP status={r1.status_code} ms={ms1:.0f} bytes={len(r1.content)} rows={len(r1.json().get('results', []))}")


def summary_rows(client: httpx.Client, market: str):
    r, ms, sent = get(client, "/markets/summary", params={"market": market}, headers={"Accept-Encoding": "gzip"})
    arrived = now_ms()
    return r, ms, sent, arrived


def mode_anchor() -> None:
    print(f"== anchor {utc()}")
    with httpx.Client(timeout=60) as client:
        r, ms, sent = get(client, "/markets/summary", params={"market": "ALL"}, headers={"Accept-Encoding": "identity"})
        print(f"summary ALL identity status={r.status_code} ms={ms:.0f} bytes={len(r.content)} headers={pick(r.headers)}")
        rows = r.json()["results"]
        save("anchor-summary-all.json", rows)
        perps = [x for x in rows if x["symbol"].endswith("-PERP")]
        print(f"rows={len(rows)} perp rows={len(perps)}")
        print("fields on perp rows:", sorted(collections.Counter(k for x in perps for k in x).items()))
        empty = [x["symbol"] for x in perps if not x.get("mark_price") or not x.get("underlying_price") or float(x["mark_price"]) <= 0 or float(x["underlying_price"]) <= 0]
        print("perp rows with an empty or zero mark or index:", empty)
        created = collections.Counter(x.get("created_at") for x in perps)
        print("distinct created_at on perp rows:", len(created), "received at", r.headers.get("paradigm-request-received"))
        premium = sorted(((float(x["mark_price"]) / float(x["underlying_price"]) - 1) * 1e6, x["symbol"]) for x in perps)
        print("mark over index ppm, lowest 5:", [(round(p), s) for p, s in premium[:5]], "highest 5:", [(round(p), s) for p, s in premium[-5:]])
        no_book = [x["symbol"] for x in perps if not x.get("bid") or not x.get("ask")]
        print("perp rows with no bid or no ask:", no_book)
        zero_volume = [x["symbol"] for x in perps if float(x.get("volume_24h") or 0) == 0]
        print("perp rows with zero 24 h volume:", zero_volume)
        gz_sizes = []
        all_times = []
        ages = []
        changes = collections.defaultdict(lambda: collections.Counter())
        previous = {}
        for i in range(12):
            t0 = time.perf_counter()
            r, ms, sent, arrived = summary_rows(client, "ALL")
            all_times.append(ms)
            gz_sizes.append(r.num_bytes_downloaded)
            got = {x["symbol"]: x for x in r.json()["results"] if x["symbol"] in SAMPLE}
            for symbol, x in got.items():
                ages.append(arrived - int(x["created_at"]))
                if symbol in previous:
                    for field in ("mark_price", "underlying_price", "funding_rate", "created_at", "bid", "ask"):
                        if x.get(field) != previous[symbol].get(field):
                            changes[symbol][field] += 1
            previous = got
            time.sleep(max(0.0, 2.5 - (time.perf_counter() - t0)))
        print(f"summary ALL gzip x12 at 2.5 s: wire bytes {quantiles(gz_sizes)} time ms {quantiles(all_times)} created_at age at arrival ms {quantiles(ages)}")
        print("changes over 11 transitions:", {s: dict(c) for s, c in changes.items()})
        per_times = []
        per_ages = []
        per_changes = collections.defaultdict(lambda: collections.Counter())
        created_steps = collections.defaultdict(list)
        previous = {}
        holds = collections.defaultdict(int)
        longest = collections.defaultdict(int)
        for i in range(40):
            t0 = time.perf_counter()
            for symbol in SAMPLE[:3]:
                r, ms, sent, arrived = summary_rows(client, symbol)
                per_times.append(ms)
                x = r.json()["results"][0]
                per_ages.append(arrived - int(x["created_at"]))
                if symbol in previous:
                    p = previous[symbol]
                    for field in ("mark_price", "underlying_price", "funding_rate", "created_at"):
                        if x.get(field) != p.get(field):
                            per_changes[symbol][field] += 1
                    if x["created_at"] != p["created_at"]:
                        created_steps[symbol].append(int(x["created_at"]) - int(p["created_at"]))
                    if x["underlying_price"] == p["underlying_price"]:
                        holds[symbol] += 1
                        longest[symbol] = max(longest[symbol], holds[symbol])
                    else:
                        holds[symbol] = 0
                previous[symbol] = x
            time.sleep(max(0.0, 1.0 - (time.perf_counter() - t0)))
        print(f"summary per market x40 at 1 s on {SAMPLE[:3]}: time ms {quantiles(per_times)} created_at age at arrival ms {quantiles(per_ages)}")
        print("changes over 39 transitions:", {s: dict(c) for s, c in per_changes.items()})
        print("created_at steps ms:", {s: quantiles(v) for s, v in created_steps.items()})
        print("longest index hold, polls:", dict(longest))
        r, ms, sent, arrived = summary_rows(client, "BTC-USD-PERP")
        print("one BTC summary:", r.text[:900])


def mode_funding() -> None:
    print(f"== funding {utc()}")
    with httpx.Client(timeout=30) as client:
        for symbol in ("BTC-USD-PERP", "XAU-USD-PERP"):
            r, ms, sent = get(client, "/funding/data", params={"market": symbol, "page_size": 100})
            body = r.json()
            rows = body.get("results", [])
            save(f"funding-{symbol}.json", body)
            print(f"/funding/data {symbol} status={r.status_code} ms={ms:.0f} bytes={len(r.content)} rows={len(rows)} next={'yes' if body.get('next') else 'no'}")
            if rows:
                print("  newest:", json.dumps(rows[0]))
                print("  oldest:", json.dumps(rows[-1]))
                steps = [int(rows[i]["created_at"]) - int(rows[i + 1]["created_at"]) for i in range(len(rows) - 1)]
                print("  created_at steps ms:", quantiles(steps))
                print("  funding_period_hours:", collections.Counter(x.get("funding_period_hours") for x in rows))
                ratios = [float(x["funding_rate_8h"]) / float(x["funding_rate"]) for x in rows if x.get("funding_rate_8h") and float(x.get("funding_rate") or 0) != 0]
                print("  funding_rate_8h over funding_rate:", quantiles(ratios))
                print("  newest created_at age ms:", now_ms() - int(rows[0]["created_at"]))
        start = now_ms() - 26 * 3_600_000
        r, ms, sent = get(client, "/funding/data", params={"market": "BTC-USD-PERP", "start_at": start, "end_at": start + 120_000, "page_size": 200})
        rows = r.json().get("results", [])
        print(f"BTC two minutes from 26 h ago: rows={len(rows)}", "steps ms:", quantiles([int(rows[i]["created_at"]) - int(rows[i + 1]["created_at"]) for i in range(len(rows) - 1)]))
        for hour_offset in (8, 16, 24):
            ts = (now_ms() // 28_800_000) * 28_800_000 - (hour_offset - 8) * 3_600_000
            r, ms, sent = get(client, "/funding/data", params={"market": "BTC-USD-PERP", "start_at": ts - 30_000, "end_at": ts + 30_000, "page_size": 100})
            rows = r.json().get("results", [])
            idx = [float(x["funding_index"]) for x in rows]
            jumps = [abs(idx[i] - idx[i + 1]) for i in range(len(idx) - 1)]
            print(f"BTC around {datetime.fromtimestamp(ts / 1000, timezone.utc):%Y-%m-%d %H:%M} UTC, one minute: rows={len(rows)} largest funding_index step={max(jumps) if jumps else None} median step={statistics.median(jumps) if jumps else None}")


def levels_summary(book: dict) -> dict:
    bids = [[float(p), float(s)] for p, s in book.get("bids", [])]
    asks = [[float(p), float(s)] for p, s in book.get("asks", [])]
    return {
        "bids": len(bids),
        "asks": len(asks),
        "bids_descending": all(bids[i][0] > bids[i + 1][0] for i in range(len(bids) - 1)),
        "asks_ascending": all(asks[i][0] < asks[i + 1][0] for i in range(len(asks) - 1)),
        "best_bid": bids[0] if bids else None,
        "best_ask": asks[0] if asks else None,
        "seq_no": book.get("seq_no"),
        "last_updated_at": book.get("last_updated_at"),
        "best_bid_api": book.get("best_bid_api"),
        "best_ask_api": book.get("best_ask_api"),
        "best_bid_interactive": book.get("best_bid_interactive"),
        "best_ask_interactive": book.get("best_ask_interactive"),
    }


def mode_book() -> None:
    print(f"== book {utc()}")
    with httpx.Client(timeout=30) as client:
        r, ms, sent = get(client, "/orderbook/BTC-USD-PERP")
        arrived = now_ms()
        book = r.json()
        save("book-btc-default.json", book)
        print(f"default status={r.status_code} ms={ms:.0f} bytes={len(r.content)} headers={pick(r.headers)}")
        print("  ", levels_summary(book), "age at arrival ms", arrived - int(book["last_updated_at"]))
        print("   first frame text:", r.text[:400])
        for depth in (15, 50, 100, 200, 1000):
            r, ms, sent = get(client, "/orderbook/BTC-USD-PERP", params={"depth": depth})
            body = r.json()
            print(f"depth={depth} status={r.status_code} ms={ms:.0f} levels={len(body.get('bids', []))}/{len(body.get('asks', []))} body={r.text[:160] if r.status_code != 200 else ''}")
            time.sleep(0.2)
        seqs = []
        for i in range(10):
            r, ms, sent = get(client, "/orderbook/BTC-USD-PERP", params={"depth": 20})
            body = r.json()
            seqs.append((round(ms), body.get("seq_no"), body.get("last_updated_at"), now_ms() - int(body.get("last_updated_at") or 0), r.headers.get("cache-control"), r.headers.get("age")))
            time.sleep(0.25)
        print("ten reads 0.25 s apart, (ms, seq_no, last_updated_at, age at arrival, cache-control, age):", seqs)
        for symbol in ("kPEPE-USD-PERP", "XAU-USD-PERP", "NVDA-USD-PERP", "US500-USD-PERP"):
            r, ms, sent = get(client, f"/orderbook/{symbol}", params={"depth": 20})
            print(f"{symbol} status={r.status_code} ms={ms:.0f}", levels_summary(r.json()))
            time.sleep(0.2)
        r, ms, sent = get(client, "/orderbook/BTC-USD-PERP/interactive", params={"depth": 20})
        print(f"interactive status={r.status_code} ms={ms:.0f}", levels_summary(r.json()))
        save("book-btc-interactive.json", r.json())
        r, ms, sent = get(client, "/bbo/BTC-USD-PERP")
        print(f"bbo status={r.status_code} ms={ms:.0f} body={r.text[:400]}")
        r, ms, sent = get(client, "/bbo/BTC-USD-PERP/interactive")
        print(f"bbo interactive status={r.status_code} ms={ms:.0f} body={r.text[:400]}")
        r, ms, sent = get(client, "/orderbook/BTC-USD-PERP", params={"depth": 20, "price_tick": "10"})
        print(f"price_tick 10 status={r.status_code} ms={ms:.0f}", levels_summary(r.json()) if r.status_code == 200 else r.text[:300])


def mode_errors() -> None:
    print(f"== errors {utc()}")
    cases = [
        ("/orderbook/NOPE-USD-PERP", None),
        ("/orderbook/btc-usd-perp", None),
        ("/markets/summary", {"market": "NOPE-USD-PERP"}),
        ("/markets/summary", None),
        ("/markets", {"market": "NOPE-USD-PERP"}),
        ("/funding/data", {"market": "NOPE-USD-PERP"}),
        ("/funding/data", None),
        ("/bbo/NOPE-USD-PERP", None),
        ("/nope", None),
        ("/orderbook/BTC-USD-PERP", {"depth": "abc"}),
        ("/markets/summary", {"market": "BTC-USD-PERP,ETH-USD-PERP"}),
        ("/account", None),
    ]
    with httpx.Client(timeout=30) as client:
        for path, params in cases:
            r, ms, sent = get(client, path, params=params)
            print(f"GET {path} {params} status={r.status_code} ms={ms:.0f} type={r.headers.get('content-type')} body={r.text[:300]!r} limit={pick(r.headers)}")
            time.sleep(0.25)
        r = client.post(API + "/markets", json={})
        print(f"POST /markets status={r.status_code} body={r.text[:200]!r}")


def spread_ppm(bid, ask):
    if not bid or not ask:
        return None
    mid = (bid + ask) / 2
    return round((ask - bid) / mid * 1e6)


def mode_books() -> None:
    """The API book against the interactive book (with RPI) on every perp, about 30 s at 5 requests a second."""
    print(f"== books {utc()}")
    with httpx.Client(timeout=30) as client:
        r, ms, sent = get(client, "/markets")
        perps = sorted(m["symbol"] for m in r.json()["results"] if m.get("asset_kind") == "PERP")
        rows = []
        for symbol in perps:
            t0 = time.perf_counter()
            api = get(client, f"/orderbook/{symbol}", params={"depth": 20})[0].json()
            interactive = get(client, f"/orderbook/{symbol}/interactive", params={"depth": 20})[0].json()
            a_bid = float(api["bids"][0][0]) if api.get("bids") else None
            a_ask = float(api["asks"][0][0]) if api.get("asks") else None
            i_bid = float(interactive["bids"][0][0]) if interactive.get("bids") else None
            i_ask = float(interactive["asks"][0][0]) if interactive.get("asks") else None
            rows.append({
                "symbol": symbol,
                "api_levels": [len(api.get("bids", [])), len(api.get("asks", []))],
                "api_spread_ppm": spread_ppm(a_bid, a_ask),
                "interactive_levels": [len(interactive.get("bids", [])), len(interactive.get("asks", []))],
                "interactive_spread_ppm": spread_ppm(i_bid, i_ask),
                "same_touch": a_bid == i_bid and a_ask == i_ask,
                "api_crossed": a_bid is not None and a_ask is not None and a_bid >= a_ask,
                "interactive_crossed": i_bid is not None and i_ask is not None and i_bid >= i_ask,
            })
            time.sleep(max(0.0, 0.4 - (time.perf_counter() - t0)))
        save("books-api-vs-interactive.json", rows)
        for row in rows:
            print(row)
        def bucket(v):
            if v is None:
                return "one-sided or empty"
            for limit in (1_000, 10_000, 100_000):
                if v <= limit:
                    return f"<= {limit} ppm"
            return "> 100,000 ppm"
        print("API spread buckets:", collections.Counter(bucket(x["api_spread_ppm"]) for x in rows))
        print("interactive spread buckets:", collections.Counter(bucket(x["interactive_spread_ppm"]) for x in rows))
        print("same touch on both:", sum(1 for x in rows if x["same_touch"]), "of", len(rows))
        print("API books with fewer than 20 levels on a side:", sum(1 for x in rows if min(x["api_levels"]) < 20))
        print("crossed books, API and interactive:", sum(1 for x in rows if x["api_crossed"]), sum(1 for x in rows if x["interactive_crossed"]))


def mode_identity() -> None:
    """Each perp's mark against binance and bybit marks for the same base, one public call to each reference."""
    print(f"== identity {utc()}")
    with httpx.Client(timeout=30) as client:
        rows = [x for x in get(client, "/markets/summary", params={"market": "ALL"})[0].json()["results"] if x["symbol"].endswith("-PERP")]
        binance = {x["symbol"]: float(x["markPrice"]) for x in client.get("https://fapi.binance.com/fapi/v1/premiumIndex").json()}
        bybit = {x["symbol"]: float(x["markPrice"]) for x in client.get("https://api.bybit.com/v5/market/tickers", params={"category": "linear"}).json()["result"]["list"]}
    out = []
    for x in sorted(rows, key=lambda r: r["symbol"]):
        base = x["symbol"].split("-")[0]
        mark = float(x["mark_price"])
        names = [base]
        if base.startswith("k") and base[1:].isupper():
            names = [base[1:], "1000" + base[1:]]
        refs = {}
        for name in names:
            for venue, table in (("binance", binance), ("bybit", bybit)):
                if name + "USDT" in table:
                    refs[f"{venue} {name}USDT"] = table[name + "USDT"]
        ratios = {k: round(mark / v, 4) for k, v in refs.items() if v > 0}
        out.append((x["symbol"], mark, ratios))
        print(x["symbol"], mark, ratios)
    far = [(s, r) for s, m, r in out if r and all(abs(v - 1) > 0.02 and abs(v * 1000 - 1) > 0.02 and abs(v / 1000 - 1) > 0.02 for v in r.values())]
    print("no reference within 2 percent, scaled by 1 or 1,000:", far)
    print("no reference listed:", [s for s, m, r in out if not r])


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "funding": mode_funding, "book": mode_book, "books": mode_books, "errors": mode_errors, "identity": mode_identity}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    for name in chosen:
        MODES[name]()
