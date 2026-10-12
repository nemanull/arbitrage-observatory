# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for IndoEx spot.

Modes:
  host     resolve api.indoex.io, time cold and warm requests, record the edge and its headers
  catalog  count the pairs of every catalog call by quote asset, and the fee fields they carry
  book     shape of the REST books: level counts, order, duplicate prices, the depth parameter, crossing
  poll     two second polls of the BTC_USDT and ETH_USDT books for about 60 s, counting top of book changes, then the mid against Kraken
  limits   ten sequential ticker calls, statuses and any rate limit header, plus unknown pair and bad path replies
  time     server Date header against the local clock, and the ticker's lastUpdateTimestamp age
  all      every mode above in order
Run from the repository root: uv run scripts/probes/venues/indoex/rest-probe.py [mode]
"""

import collections
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

WORK = Path(".claude/survey-work/indoex")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
API = "https://api.indoex.io"
REFERENCE = "https://api.kraken.com/0/public/Ticker?pair=XBTUSD"  # outside price for a sanity check of BTC_USDT


def get(path: str) -> tuple[int | None, dict, bytes, float]:
    url = path if path.startswith("http") else API + path
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            body = reply.read()
            return reply.status, dict(reply.headers.items()), body, (time.monotonic() - started) * 1000
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read(), (time.monotonic() - started) * 1000
    except Exception as error:  # noqa: BLE001
        return None, {}, repr(error).encode(), (time.monotonic() - started) * 1000


def get_json(path: str):
    status, headers, body, ms = get(path)
    try:
        data = json.loads(body)
    except ValueError:
        data = None
    return status, headers, data, ms, len(body)


def mode_host() -> None:
    print("\n== host")
    infos = socket.getaddrinfo("api.indoex.io", 443, proto=socket.IPPROTO_TCP)
    print("api.indoex.io resolves to", sorted({i[4][0] for i in infos}))
    for name in ["www.indoex.io", "socket.indoex.io", "proxysocket.indoex.io", "websocket.indoex.io", "masternode.indoex.io"]:
        try:
            print(f"{name} resolves to", sorted({i[4][0] for i in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)}))
        except OSError as error:
            print(f"{name} does not resolve: {error}")
    for label in ["cold", "warm 1", "warm 2", "warm 3"]:
        status, headers, _, ms, size = get_json("/info/")
        print(f"{label}: GET /info/ {status} in {ms:.0f} ms, {size} bytes, server {headers.get('Server')}, cf-ray {headers.get('CF-RAY')}")
    print("headers of the last reply:", headers)
    for url in ["https://www.indoex.io/", "https://api.indoex.io/", "https://api.indoex.io/websocket.html", "https://www.indoex.io/fees"]:
        status, headers, body, ms = get(url)
        print(f"GET {url}: {status} in {ms:.0f} ms, {len(body)} bytes, {headers.get('Content-Type')}")


def mode_catalog() -> None:
    print("\n== catalog")
    _, _, info, _, _ = get_json("/info/")
    print("info capability:", info.get("capability"))
    calls = {
        "markets": ("/markets/", "combinations"),
        "getavailablepairs": ("/getavailablepairs/", "combinations"),
        "coingecko/pairs": ("/coingecko/pairs", "supportedcombinations"),
        "getMarketDetails": ("/getMarketDetails/", "marketdetails"),
        "getCompleteMarkets": ("/getCompleteMarkets/", "marketdetails"),
        "coingecko/tickers": ("/coingecko/tickers", "marketdetails"),
    }
    lists = {}
    for name, (path, key) in calls.items():
        status, headers, data, ms, size = get_json(path)
        rows = data.get(key) or []
        ids = [r if isinstance(r, str) else r.get("id") or r.get("pair") or r.get("ticker_id") for r in rows]
        lists[name] = set(ids)
        quotes = collections.Counter(i.split("_")[1] for i in ids)
        print(f"{name}: {status} in {ms:.0f} ms, {size} bytes, Content-Type {headers.get('Content-Type')}, {len(ids)} rows, quotes {dict(quotes)}")
        if name == "getMarketDetails":
            fees = collections.Counter((r.get("buyfee"), r.get("sellfee")) for r in rows)
            print(f"  buyfee and sellfee pairs: {dict(fees)}")
            zero = [r["pair"] for r in rows if float(r.get("baseVolume") or 0) == 0]
            print(f"  rows with zero baseVolume: {len(zero)}")
            crossed = [r["pair"] for r in rows if r.get("bid") and r.get("ask") and float(r["bid"]) > float(r["ask"])]
            equal = [r["pair"] for r in rows if r.get("bid") and r.get("bid") == r.get("ask")]
            print(f"  rows with bid above ask: {len(crossed)}, rows with bid equal to ask: {len(equal)} of {len(rows)}")
            perp_like = [i for i in ids if any(w in i.upper() for w in ["PERP", "SWAP", "-P", "FUT"])]
            print(f"  ids that look like derivatives: {perp_like}")
    print("markets equals getavailablepairs:", lists["markets"] == lists["getavailablepairs"])
    print("getMarketDetails subset of markets:", lists["getMarketDetails"] <= lists["markets"])
    print("getCompleteMarkets minus getMarketDetails:", sorted(lists["getCompleteMarkets"] - lists["getMarketDetails"])[:20])
    status, _, assets, ms, size = get_json("/assets/all")
    result = assets.get("result") or {}
    fees = collections.Counter((v.get("maker_Fee"), v.get("taker_Fee")) for v in result.values())
    print(f"assets/all: {status} in {ms:.0f} ms, {size} bytes, {len(result)} assets, maker and taker pairs {dict(fees)}")
    odd = {k: (v.get("maker_Fee"), v.get("taker_Fee")) for k, v in result.items() if (v.get("maker_Fee"), v.get("taker_Fee")) != (0.0015, 0.0015)}
    print(f"  assets not at 0.0015 and 0.0015: {odd}")
    status, _, btc, _, _ = get_json("/assets/BTC")
    print(f"assets/BTC: {status}, maker_Fee {btc.get('maker_Fee')}, taker_Fee {btc.get('taker_Fee')}")
    status, _, usdt, _, _ = get_json("/assets/USDT")
    print(f"assets/USDT: {status}, maker_Fee {usdt.get('maker_Fee')}, taker_Fee {usdt.get('taker_Fee')}")


def describe_book(path: str) -> dict:
    status, headers, data, ms, size = get_json(path)
    asks, bids = data.get("asks") or [], data.get("bids") or []
    ap = [float(x["price"]) for x in asks]
    bp = [float(x["price"]) for x in bids]
    print(f"{path}: {status} in {ms:.0f} ms, {size} bytes, cache {headers.get('cf-cache-status')}, keys {list(data)}")
    if ap and bp:
        print(f"  {len(asks)} asks ascending {ap == sorted(ap)}, {len(bids)} bids descending {bp == sorted(bp, reverse=True)}")
        print(f"  duplicate prices: asks {len(ap) - len(set(ap))}, bids {len(bp) - len(set(bp))}")
        print(f"  best bid {bp[0]}, best ask {ap[0]}, crossed {bp[0] >= ap[0]}, spread {ap[0] - bp[0]:.8f}, last {data.get('last')}")
        print(f"  first ask level {asks[0]}, first bid level {bids[0]}")
    return data


def mode_book() -> None:
    print("\n== book")
    describe_book("/depth/BTC_USDT")
    for depth in [10, 20, 30, 50, 100]:
        describe_book(f"/coingecko/orderbook?ticker_id=BTC_USDT&depth={depth}")
    describe_book("/coingecko/orderbook?ticker_id=BTC_USDT&level=2")
    describe_book("/depth/ETH_USDT")
    describe_book("/coingecko/orderbook?ticker_id=ETH_USDT&depth=40")
    status, _, data, ms, size = get_json("/getOrderBook/BTC_USDT")
    rows = data.get("orderbook") or []
    print(f"/getOrderBook/BTC_USDT: {status} in {ms:.0f} ms, {size} bytes, {len(rows)} individual orders, types {dict(collections.Counter(r.get('ordertype') for r in rows))}")
    status, _, ref, _, _ = get_json(REFERENCE)
    pair = next(iter((ref or {}).get("result", {}).values()), {})
    print(f"reference Kraken XBTUSD: {status}, ask {pair.get('a', [None])[0]}, bid {pair.get('b', [None])[0]}")
    status, _, data, _, _ = get_json("/ticker/BTC_USDT")
    print(f"/ticker/BTC_USDT: {status}, {data}")
    _, _, selected, _, _ = get_json("/getSelectedMarket/BTC_USDT")
    row = (selected.get("marketdetails") or [{}])[0]
    print(f"/getSelectedMarket/BTC_USDT: {row}")
    print(f"  ticker lowestAsk equals lowsale {float(data['lowestAsk']) == float(row['lowsale'])}, highestBid equals highsale {float(data['highestBid']) == float(row['highsale'])}, bid equals ask {row['bid'] == row['ask']}")


def mode_poll() -> None:
    print("\n== poll")
    pairs = ["BTC_USDT", "ETH_USDT"]
    tops: dict[str, list] = {p: [] for p in pairs}
    started = time.monotonic()
    for _ in range(30):
        round_start = time.monotonic()
        for pair in pairs:
            _, _, data, _, _ = get_json(f"/coingecko/orderbook?ticker_id={pair}&depth=40")
            asks, bids = data.get("asks") or [], data.get("bids") or []
            stamp = round(time.monotonic() - started, 1)
            tops[pair].append((stamp, bids[0]["price"] if bids else None, asks[0]["price"] if asks else None, len(bids), len(asks)))
        time.sleep(max(0, 2.0 - (time.monotonic() - round_start)))
    for pair in pairs:
        rows = tops[pair]
        changes = [b[0] for a, b in zip(rows, rows[1:]) if a[1:3] != b[1:3]]
        print(f"{pair}: {len(rows)} polls over {rows[-1][0]:.1f} s, top of book changed {len(changes)} times, at seconds {changes}, levels {sorted({r[3:] for r in rows})}")
        print(f"  first {rows[0]}, last {rows[-1]}")
    status, _, ref, _, _ = get_json(REFERENCE)
    kraken = next(iter((ref or {}).get("result", {}).values()), {})
    _, _, book, _, _ = get_json("/coingecko/orderbook?ticker_id=BTC_USDT&depth=2")
    if kraken and book.get("bids"):
        ours = (float(book["bids"][0]["price"]) + float(book["asks"][0]["price"])) / 2
        theirs = (float(kraken["a"][0]) + float(kraken["b"][0])) / 2
        print(f"BTC_USDT mid {ours:.2f} against Kraken XBTUSD mid {theirs:.2f}: {(ours / theirs - 1) * 1e6:+.0f} ppm")


def mode_limits() -> None:
    print("\n== limits")
    statuses = collections.Counter()
    limit_headers = set()
    for _ in range(10):
        status, headers, _, _ = get("/ticker/BTC_USDT")
        statuses[status] += 1
        limit_headers |= {k for k in headers if "limit" in k.lower() or "retry" in k.lower()}
        time.sleep(0.2)
    print(f"10 ticker calls at about 4 per second: statuses {dict(statuses)}, rate limit headers {sorted(limit_headers) or 'none'}")
    for path in ["/ticker/NOPE_USDT", "/depth/NOPE_USDT", "/coingecko/orderbook?ticker_id=NOPE_USDT&depth=20", "/getSelectedMarket/NOPE_USDT", "/nosuchpath"]:
        status, headers, body, ms = get(path)
        print(f"{path}: {status}, {headers.get('Content-Type')}, body {body[:200]!r}")


def mode_time() -> None:
    print("\n== time")
    for _ in range(3):
        before = datetime.now(timezone.utc)
        status, headers, data, ms, _ = get_json("/ticker/BTC_USDT")
        after = datetime.now(timezone.utc)
        server = parsedate_to_datetime(headers["Date"])
        local = before + (after - before) / 2
        updated = datetime.fromisoformat(data["lastUpdateTimestamp"].replace("Z", "+00:00"))
        print(f"Date {headers['Date']}, offset {(server - local).total_seconds():+.2f} s at one second resolution, round trip {ms:.0f} ms, ticker lastUpdateTimestamp {data['lastUpdateTimestamp']}, age {(local - updated).total_seconds():.0f} s")
    status, _, trades, _, _ = get_json("/trades/BTC_USDT")
    rows = trades.get("orderbook") or []
    if rows:
        newest = datetime.fromisoformat(rows[0]["time"].replace("Z", "+00:00"))
        print(f"/trades/BTC_USDT: {len(rows)} trades, newest {rows[0]['time']}, age {(datetime.now(timezone.utc) - newest).total_seconds():.0f} s, oldest {rows[-1]['time']}")
        print(f"  newest row {rows[0]}")


MODES = {"host": mode_host, "catalog": mode_catalog, "book": mode_book, "poll": mode_poll, "limits": mode_limits, "time": mode_time}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"), "mode", mode)
    for name, run in MODES.items():
        if mode in ("all", name):
            run()
