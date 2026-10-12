# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Coinmetro, public market data only.

Modes, all by default, or name some on the command line:
    host     DNS, cold and warm request time, and the access answer from this host
    catalog  /markets, /assets and /exchange/prices, with counts and the age of every price
    book     the BTCEUR full book, its checksum recomputed by the documented rule, and /bookUpdates
    poll     /exchange/prices once a second for 30 s, counting how often anything changes
    errors   an unknown pair, an unknown path, an oversized candle range, and the demo environment
    time     the HTTP Date header against the local clock

Every call is unauthenticated and the whole run makes about 50 requests, far inside the documented 500 per 10 s per IP.

Run from the repository root:
    uv run scripts/probes/venues/coinmetro/rest-probe.py [mode ...]
"""

import collections
import email.utils
import json
import socket
import sys
import time
import urllib.error
import urllib.request
import zlib

API = "https://api.coinmetro.com"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}


def get(path: str, base: str = API) -> tuple[int, dict, bytes, float]:
    req = urllib.request.Request(base + path, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str))


def age_days(ms: float) -> float:
    return round((time.time() * 1000 - ms) / 86_400_000, 2)


def utc(ms: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def mode_host() -> None:
    addrs = sorted({a[4][0] for a in socket.getaddrinfo("api.coinmetro.com", 443, proto=socket.IPPROTO_TCP)})
    out(mode="host", resolved=addrs)
    for label in ("cold", "warm", "warm"):
        status, headers, body, ms = get("/exchange/prices")
        out(mode="host", call="/exchange/prices", label=label, status=status, ms=round(ms), bytes=len(body),
            server=headers.get("server") or headers.get("Server"), cf_ray=headers.get("cf-ray") or headers.get("CF-RAY"))
    for site in ("https://coinmetro.com/", "https://help.coinmetro.com/en/"):
        status, headers, body, ms = get("", base=site)
        out(mode="host", call=site, status=status, ms=round(ms), body_start=body[:80].decode("utf-8", "replace"))


def mode_catalog() -> None:
    status, _, body, ms = get("/markets")
    markets = json.loads(body)
    out(mode="catalog", call="/markets", status=status, ms=round(ms), count=len(markets),
        margin=sum(1 for m in markets if m.get("margin")), keys=sorted(markets[0].keys()),
        quotes=collections.Counter(m["pair"][-4:] if m["pair"].endswith(("USDT", "USDC", "USDG")) else m["pair"][-3:] for m in markets))
    status, _, body, ms = get("/assets")
    assets = json.loads(body)
    flags = collections.Counter((a.get("canDeposit"), a.get("canWithdraw"), a.get("canTrade")) for a in assets)
    msgs = collections.Counter(a.get("cantTradeMessage", "") for a in assets)
    out(mode="catalog", call="/assets", status=status, count=len(assets),
        canDeposit_canWithdraw_canTrade=[[list(k), v] for k, v in flags.items()],
        cantTradeMessage_top=msgs.most_common(3), keys=sorted(assets[0].keys()))
    status, _, body, ms = get("/exchange/prices")
    prices = json.loads(body)
    lp = prices["latestPrices"]
    ts = [p["timestamp"] for p in lp]
    crossed = [p["pair"] for p in lp if p.get("bid") and p.get("ask") and p["bid"] > p["ask"]]
    out(mode="catalog", call="/exchange/prices", status=status, ms=round(ms), bytes=len(body), pairs=len(lp),
        quotes=collections.Counter(p["quote"] for p in lp), newest=utc(max(ts)), oldest=utc(min(ts)),
        newest_age_days=age_days(max(ts)), qty_values=collections.Counter(p.get("qty") for p in lp).most_common(3),
        crossed=crossed, info_keys=sorted(prices["24hInfo"][0].keys()))
    # CoinMarketCap's volume for this venue matches these frozen 24h figures.
    info = {i["pair"]: i for i in prices["24hInfo"]}
    out(mode="catalog", info_pairs_with_volume=sum(1 for i in info.values() if i.get("v")), XCMEUR_24hInfo=info.get("XCMEUR"),
        XCMEUR_volume_eur=round(info["XCMEUR"]["v"] * next(p["price"] for p in lp if p["pair"] == "XCMEUR"), 2) if "XCMEUR" in info else None)
    pairs = {m["pair"] for m in markets}
    out(mode="catalog", markets_not_in_prices=sorted(pairs - {p["pair"] for p in lp}),
        prices_not_in_markets=sorted({p["pair"] for p in lp} - pairs))
    for p in lp:
        if p["pair"] in ("BTCEUR", "BTCUSDT", "BTCUSD", "ETHEUR"):
            out(mode="catalog", sample=p, at=utc(p["timestamp"]))
    # The last trade proves when matching stopped, independent of the price feed.
    status, _, body, _ = get("/exchange/ticks/BTCEUR/1782000000000")
    ticks = json.loads(body)["tickHistory"]
    last = ticks[-1] if ticks else None
    out(mode="catalog", call="/exchange/ticks/BTCEUR/1782000000000", status=status, ticks=len(ticks),
        last=last, last_at=utc(last["timestamp"]) if last else None)
    if last:
        status, _, body, _ = get(f"/exchange/ticks/BTCEUR/{last['timestamp'] + 1}")
        out(mode="catalog", call="ticks after the last one", status=status, ticks=len(json.loads(body)["tickHistory"]))


def fmt_qty(q: float) -> str:
    return f"{q:.8f}".rstrip("0").rstrip(".")


def checksum(book: dict) -> int:
    s = "".join(f"{p}{fmt_qty(book['ask'][p])}" for p in sorted(p for p in book["ask"] if book["ask"][p]))
    s += "".join(f"{p}{fmt_qty(book['bid'][p])}" for p in sorted(p for p in book["bid"] if book["bid"][p]))
    c = zlib.crc32(s.encode())
    return c - (1 << 32) if c >= 1 << 31 else c


def mode_book() -> None:
    status, headers, body, ms = get("/exchange/book/BTCEUR")
    book = json.loads(body)["book"]
    bids = sorted(((float(p), q) for p, q in book["bid"].items()), reverse=True)
    asks = sorted((float(p), q) for p, q in book["ask"].items())
    out(mode="book", call="/exchange/book/BTCEUR", status=status, ms=round(ms), bytes=len(body),
        cache_control=headers.get("cache-control") or headers.get("Cache-Control"), keys=sorted(book.keys()),
        bid_levels=len(bids), ask_levels=len(asks), best_bid=bids[0], best_ask=asks[0],
        seqNumber=book["seqNumber"], checksum=book["checksum"], recomputed=checksum(book),
        key_order_on_wire_ask=list(book["ask"].keys())[:3], key_order_on_wire_bid=list(book["bid"].keys())[:3])
    status, _, body, ms = get("/exchange/bookUpdates/BTCEUR/0")
    ups = json.loads(body)
    seqs = [u["seqNumber"] for u in ups]
    gaps = collections.Counter(b - a for a, b in zip(seqs, seqs[1:]))
    out(mode="book", call="/exchange/bookUpdates/BTCEUR/0", status=status, ms=round(ms), updates=len(ups),
        first_seq=seqs[0] if seqs else None, last_seq=seqs[-1] if seqs else None,
        book_seq_minus_last=book["seqNumber"] - seqs[-1] if seqs else None, seq_steps=gaps.most_common(5), sample=ups[-1] if ups else None)
    # Interleaved ranges with no shared value mean one counter across pairs, not one per pair.
    _, _, body, _ = get("/exchange/bookUpdates/ETHEUR/0")
    eth = [u["seqNumber"] for u in json.loads(body)]
    lo, hi = max(min(seqs), min(eth)), min(max(seqs), max(eth))
    out(mode="book", call="/exchange/bookUpdates/ETHEUR/0", updates=len(eth), first_seq=min(eth), last_seq=max(eth),
        shared_values_with_btceur=len(set(eth) & set(seqs)), eth_inside_btc_range=sum(1 for s in eth if lo <= s <= hi))


def mode_poll() -> None:
    prev, changes, polls, slow = None, 0, 0, []
    for _ in range(30):
        status, _, body, ms = get("/exchange/prices")
        polls += 1
        cur = {p["pair"]: (p["price"], p.get("bid"), p.get("ask"), p["timestamp"]) for p in json.loads(body)["latestPrices"]}
        if prev is not None:
            changes += sum(1 for k in cur if prev.get(k) != cur[k])
        slow.append(round(ms))
        prev = cur
        time.sleep(1)
    out(mode="poll", polls=polls, pair_changes_between_polls=changes, ms_min=min(slow), ms_max=max(slow))


def mode_errors() -> None:
    for path in ("/exchange/book/NOPEEUR", "/exchange/nope", "/exchange/candles/BTCEUR/60000/1782800000000/1782901080000"):
        status, headers, body, ms = get(path)
        out(mode="errors", call=path, status=status, body=body[:120].decode("utf-8", "replace"),
            retry_after=headers.get("retry-after") or headers.get("Retry-After"))
    status, _, body, _ = get("/exchange/candles/BTCEUR/60000/1782000000000/1782030000000")
    candles = json.loads(body)["candleHistory"]
    out(mode="errors", call="/exchange/candles/BTCEUR/60000/1782000000000/1782030000000", status=status, candles=len(candles),
        distinct_closes=len({c["c"] for c in candles}), volume_sum=sum(c["v"] for c in candles))
    status, _, body, _ = get("/open/exchange/prices")
    lp = json.loads(body)["latestPrices"]
    newest = max(p["timestamp"] for p in lp)
    out(mode="errors", call="/open/exchange/prices (demo environment)", status=status, pairs=len(lp),
        newest=utc(newest), newest_age_s=round(time.time() - newest / 1000, 1))


def mode_time() -> None:
    for _ in range(3):
        t0 = time.time()
        status, headers, _, ms = get("/markets")
        date = headers.get("date") or headers.get("Date")
        server = email.utils.parsedate_to_datetime(date).timestamp()
        local = t0 + ms / 2000
        out(mode="time", date=date, offset_s=round(server - local, 2), note="Date has one second resolution")
        time.sleep(1)


MODES = {"host": mode_host, "catalog": mode_catalog, "book": mode_book, "poll": mode_poll, "errors": mode_errors, "time": mode_time}

if __name__ == "__main__":
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for name in sys.argv[1:] or list(MODES):
        MODES[name]()
