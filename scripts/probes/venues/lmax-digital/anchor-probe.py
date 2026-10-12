# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""LMAX perpetual futures anchor probe for docs/profiles/lmax-digital/rest.md sections 3 and 4.

Public, unauthenticated and read-only, one socket of about 6 s and 3 to 33 HTTP requests.
  1. The instrument definitions over the market data socket, for each symbol's pythProId.
  2. Pyth Pro's public symbol list, mapping each pythProId to a Pyth symbol and its Hermes feed id.
  3. One bulk Hermes latest price call for every mapped feed, without a key, against the LMAX top of book from a depth 1 SNAPSHOT socket.
  4. If Hermes answered, Hermes BTC/USD polled once a second for 30 s: how often the price and publish_time change.
LMAX publishes no index or mark on any public channel, so this asks whether the index source it names is readable on its own.
Run from the repository root with: uv run scripts/probes/venues/lmax-digital/anchor-probe.py
"""

import asyncio
import json
import time
import urllib.error
import urllib.parse
import urllib.request

import websockets

MD = "wss://market-data.london-perpetual.lmax.com/v1/marketdata/web-socket"
LAZER_SYMBOLS = "https://history.pyth-lazer.dourolabs.app/history/v1/symbols"
HERMES = "https://hermes.pyth.network/v2/updates/price/latest"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}


def get_json(url):
    t0 = time.perf_counter()
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        body = r.read()
    return json.loads(body), len(body), (time.perf_counter() - t0) * 1000


def try_get(url):
    """Status, headers and body, without raising on an HTTP error."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


async def lmax_side():
    async with websockets.connect(MD, open_timeout=15, compression=None) as ws:
        await ws.send(json.dumps({"type": "GET_INSTRUMENT_DEFINITIONS", "symbols": []}))
        defs = None
        while defs is None:
            f = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if f.get("type") == "metadata":
                defs = f["instruments"]
        symbols = [i["symbol"] for i in defs]
        await ws.send(json.dumps({"type": "SUBSCRIBE", "symbols": symbols, "depth": "1"}))
        tops = {}
        end = time.time() + 5
        while time.time() < end and len(tops) < len(symbols):
            f = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if f.get("type") == "snapshot" and f["bids"] and f["asks"]:
                tops[f["symbol"]] = (float(f["bids"][0]["price"]) + float(f["asks"][0]["price"])) / 2
        return defs, tops


def main():
    print("== 1. instrument definitions and LMAX mids")
    defs, mids = asyncio.run(lmax_side())
    print(f"   instruments {len(defs)}, mids read {len(mids)}")

    print("\n== 2. Pyth Pro symbol list")
    lazer, size, ms = get_json(LAZER_SYMBOLS)
    print(f"   {LAZER_SYMBOLS}: {len(lazer)} feeds, {size} bytes, {round(ms)} ms")
    by_id = {str(x["pyth_lazer_id"]): x for x in lazer}
    mapping = {}
    for i in sorted(defs, key=lambda d: d["symbol"]):
        feed = by_id.get(i["pythProId"])
        mapping[i["symbol"]] = feed
        print(f"   {i['symbol']}: pythProId {i['pythProId']} is {feed['symbol'] if feed else None}, state {feed['state'] if feed else None}, hermes id present {bool(feed and feed.get('hermes_id'))}")

    print("\n== 3. Hermes latest price, one bulk call, against the LMAX mid")
    ids = {f["hermes_id"]: s for s, f in mapping.items() if f and f.get("hermes_id")}
    query = urllib.parse.urlencode([("ids[]", h) for h in ids] + [("parsed", "true")])
    status, headers, body = try_get(f"{HERMES}?{query}")
    if status != 200:
        print(f"   {HERMES} without a key: status {status}, body {body[:200]!r}, server {headers.get('Server')}")
        status, headers, body = try_get(f"{HERMES}?ids[]={ids and next(iter(ids))}&parsed=true")
        print(f"   one feed, BTC/USD, without a key: status {status}, body {body[:200]!r}")
        print("   the Hermes steps stop here, because Pyth gates Hermes behind an API key")
        return
    reply, size = json.loads(body), len(body)
    now = time.time()
    print(f"   {len(ids)} feeds asked, {len(reply['parsed'])} returned, {size} bytes")
    for p in sorted(reply["parsed"], key=lambda x: ids[x["id"]]):
        sym = ids[p["id"]]
        price = int(p["price"]["price"]) * 10 ** p["price"]["expo"]
        mid = mids.get(sym)
        gap = round((mid / price - 1) * 1e6) if mid else None
        print(f"   {sym}: hermes {price:.6g}, age {round(now - p['price']['publish_time'], 1)} s, LMAX mid {mid}, mid against hermes {gap} ppm")

    print("\n== 4. Hermes BTC/USD once a second for 30 s")
    btc = mapping["BTCUSDPERP"]["hermes_id"]
    prices, times, lat = [], [], []
    for _ in range(30):
        t0 = time.time()
        reply, size, ms = get_json(f"{HERMES}?ids[]={btc}&parsed=true")
        lat.append(ms)
        p = reply["parsed"][0]["price"]
        prices.append(p["price"])
        times.append(p["publish_time"])
        time.sleep(max(0, 1 - (time.time() - t0)))
    changes = sum(1 for a, b in zip(prices, prices[1:]) if a != b)
    print(f"   polls 30, price changed on {changes} of 29, distinct publish_time {len(set(times))}, reply ms min {round(min(lat))} median {round(sorted(lat)[15])} max {round(max(lat))}")


main()
