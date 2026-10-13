# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for dYdX (CCXT id dydx), the public Indexer API and public node REST reads.

Every call is an unauthenticated GET.
The Indexer is https://indexer.dydx.trade/v4, documented at https://docs.dydx.xyz/indexer-client/http.
Node REST reads go to a public full node listed at https://docs.dydx.xyz/interaction/endpoints.

Modes, all by default, or name some on the command line:
    host     DNS, one cold and ten warm /v4/time requests on one kept connection, the edge and geo headers, /v4/height
    catalog  /v4/perpetualMarkets in full: status and marketType counts, ticker shapes, fields, a saved copy
    anchor   /v4/perpetualMarkets and /v4/height once a second for 60 s on one kept connection,
             counting how often each market's oraclePrice and nextFundingRate change
    funding  /v4/historicalFunding for three markets: effectiveAt spacing, rates, and nextFundingRate beside them
    book     /v4/orderbooks/perpetualMarket for BTC-USD and one thin market: levels, order, crossing, caching
    errors   an unknown market on three calls and a bad path, with status and body
    chain    public node REST: perpetual params, liquidity tiers, epochs, perpetuals, clob pairs, market params, market map

The probe stays far inside the documented 100 requests per 10 s of the Indexer and 350 a minute of the node.
Captures land in .claude/survey-work/dydx/captures/ under the repository root.

Run from the repository root:
    uv run scripts/probes/venues/dydx/rest-probe.py [mode ...]
"""

import calendar
import http.client
import json
import os
import re
import socket
import statistics
import sys
import time
from collections import Counter

INDEXER_HOST = "indexer.dydx.trade"
NODE_HOST = "dydx-ops-rest.kingnodes.com"  # KingNodes, 350 req/m per the endpoints page
UA = "arbitrage-observatory-survey-probe"
CAPTURES = os.path.join(".claude", "survey-work", "dydx", "captures")
HEADERS_KEPT = (
    "server", "cf-ray", "cf-cache-status", "cache-control", "age", "content-length", "content-encoding",
    "geo-origin-country", "geo-origin-region", "geo-origin-status",
    "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after", "x-response-time", "etag",
)


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


class Client:
    """One kept HTTPS connection, so the first request pays DNS and TLS and the rest do not."""

    def __init__(self, host: str):
        self.host = host
        self.conn = None

    def get(self, path: str) -> tuple[int, dict, bytes, float]:
        if self.conn is None:
            self.conn = http.client.HTTPSConnection(self.host, timeout=15)
        t0 = time.perf_counter()
        try:
            self.conn.request("GET", path, headers={"User-Agent": UA, "Accept": "application/json"})
            resp = self.conn.getresponse()
            body = resp.read()
        except (http.client.HTTPException, OSError):
            self.conn.close()
            self.conn = None
            raise
        ms = (time.perf_counter() - t0) * 1000
        headers = {k.lower(): v for k, v in resp.getheaders()}
        return resp.status, headers, body, ms


def kept(headers: dict) -> dict:
    return {k: headers[k] for k in HEADERS_KEPT if k in headers}


def save(name: str, body: bytes) -> str:
    os.makedirs(CAPTURES, exist_ok=True)
    path = os.path.join(CAPTURES, name)
    with open(path, "wb") as f:
        f.write(body)
    return path


def iso_ms(text: str) -> int:
    # 2026-10-12T22:19:27.123Z
    base, _, frac = text.rstrip("Z").partition(".")
    seconds = calendar.timegm(time.strptime(base, "%Y-%m-%dT%H:%M:%S"))
    return seconds * 1000 + int((frac + "000")[:3])


def mode_host() -> None:
    infos = socket.getaddrinfo(INDEXER_HOST, 443, proto=socket.IPPROTO_TCP)
    out(mode="host", at=stamp(), dns=sorted({i[4][0] for i in infos}))
    c = Client(INDEXER_HOST)
    status, headers, body, ms = c.get("/v4/time")
    out(mode="host", call="/v4/time", first=True, status=status, ms=round(ms, 1), body=body.decode(), headers=kept(headers))
    warm = []
    offsets = []
    for _ in range(10):
        t_send = time.time() * 1000
        status, headers, body, ms = c.get("/v4/time")
        t_recv = time.time() * 1000
        warm.append(ms)
        server_ms = json.loads(body)["epoch"] * 1000
        offsets.append(server_ms - (t_send + t_recv) / 2)
        time.sleep(0.2)
    out(mode="host", call="/v4/time", warm_ms={"min": round(min(warm), 1), "median": round(statistics.median(warm), 1), "max": round(max(warm), 1)},
        clock_offset_ms={"min": round(min(offsets), 1), "median": round(statistics.median(offsets), 1), "max": round(max(offsets), 1)})
    status, headers, body, ms = c.get("/v4/height")
    recv = time.time() * 1000
    data = json.loads(body)
    out(mode="host", call="/v4/height", status=status, ms=round(ms, 1), body=data, block_age_ms=round(recv - iso_ms(data["time"])), headers=kept(headers))


def mode_catalog() -> None:
    c = Client(INDEXER_HOST)
    status, headers, body, ms = c.get("/v4/perpetualMarkets")
    path = save("perpetualMarkets.json", body)
    data = json.loads(body)
    markets = data["markets"]
    out(mode="catalog", at=stamp(), status=status, ms=round(ms, 1), bytes=len(body), saved=path, headers=kept(headers), top_keys=list(data))
    rows = list(markets.values())
    statuses = Counter(m.get("status") for m in rows)
    types = Counter((m.get("status"), m.get("marketType")) for m in rows)
    keys = Counter(k for m in rows for k in m)
    out(mode="catalog", rows=len(rows), status=dict(statuses), status_and_type={f"{a}|{b}": n for (a, b), n in types.items()}, fields=dict(keys))
    odd = [m["ticker"] for m in rows if not re.fullmatch(r"[A-Z0-9]+-USD", m["ticker"])]
    key_mismatch = [k for k, m in markets.items() if k != m["ticker"]]
    out(mode="catalog", tickers_not_BASE_USD=odd, key_not_ticker=key_mismatch)
    active = [m for m in rows if m.get("status") == "ACTIVE"]
    bases = Counter(m["ticker"].split("-")[0] for m in active)
    out(mode="catalog", active=len(active), active_tickers=sorted(m["ticker"] for m in active))
    out(mode="catalog", base_listed_twice=[b for b, n in bases.items() if n > 1],
        digit_or_prefix_bases=sorted(b for b in bases if re.match(r"^(\d|K[A-Z]|1000)", b)))
    out(mode="catalog", atomicResolution=dict(Counter(m.get("atomicResolution") for m in active)),
        defaultFundingRate1H=dict(Counter(m.get("defaultFundingRate1H") for m in active)),
        marketType_active=dict(Counter(m.get("marketType") for m in active)))
    not_active = [(m["ticker"], m.get("status"), m.get("oraclePrice"), m.get("volume24H")) for m in rows if m.get("status") != "ACTIVE"]
    out(mode="catalog", not_active=not_active)
    zero_volume = sorted(m["ticker"] for m in active if float(m.get("volume24H") or 0) == 0)
    out(mode="catalog", active_with_zero_volume24H=zero_volume)
    sample = markets.get("BTC-USD")
    out(mode="catalog", sample_BTC_USD=sample)
    status, headers, body2, ms = c.get("/v4/perpetualMarkets?limit=1000")
    out(mode="catalog", call="?limit=1000", status=status, rows=len(json.loads(body2).get("markets", {})))
    status, headers, body3, ms = c.get("/v4/perpetualMarkets?market=BTC-USD")
    out(mode="catalog", call="?market=BTC-USD", status=status, ms=round(ms, 1), bytes=len(body3), keys=list(json.loads(body3).get("markets", {})))


def mode_anchor(seconds: int = 60) -> None:
    c = Client(INDEXER_HOST)
    last_oracle: dict[str, str] = {}
    last_rate: dict[str, str] = {}
    oracle_changes: Counter = Counter()
    rate_changes: Counter = Counter()
    times = []
    sizes = []
    heights = []
    cache = Counter()
    polls = 0
    start = time.time()
    while time.time() - start < seconds:
        t0 = time.time()
        status, headers, body, ms = c.get("/v4/perpetualMarkets")
        polls += 1
        times.append(ms)
        sizes.append(len(body))
        cache[(headers.get("cf-cache-status"), headers.get("cache-control"))] += 1
        if status != 200:
            out(mode="anchor", status=status, body=body[:300].decode(errors="replace"), headers=kept(headers))
            time.sleep(1)
            continue
        for ticker, m in json.loads(body)["markets"].items():
            if m.get("status") != "ACTIVE":
                continue
            o, r = m.get("oraclePrice"), m.get("nextFundingRate")
            if ticker in last_oracle and last_oracle[ticker] != o:
                oracle_changes[ticker] += 1
            if ticker in last_rate and last_rate[ticker] != r:
                rate_changes[ticker] += 1
            last_oracle[ticker], last_rate[ticker] = o, r
        hs, hh, hb, hms = c.get("/v4/height")
        recv = time.time() * 1000
        hd = json.loads(hb)
        heights.append((int(hd["height"]), round(recv - iso_ms(hd["time"]))))
        time.sleep(max(0.0, 1.0 - (time.time() - t0)))
    tickers = sorted(last_oracle)
    per_market = sorted(oracle_changes.get(t, 0) for t in tickers)
    out(mode="anchor", at=stamp(), polls=polls, markets=len(tickers),
        reply_ms={"min": round(min(times), 1), "median": round(statistics.median(times), 1), "p90": round(sorted(times)[int(len(times) * 0.9)], 1), "max": round(max(times), 1)},
        reply_bytes={"min": min(sizes), "max": max(sizes)}, cache={f"{a}|{b}": n for (a, b), n in cache.items()})
    out(mode="anchor", oracle_changes_per_market={"min": per_market[0], "median": statistics.median(per_market), "max": per_market[-1]},
        oracle_changes_BTC=oracle_changes.get("BTC-USD", 0), oracle_changes_ETH=oracle_changes.get("ETH-USD", 0),
        never_changed=[t for t in tickers if oracle_changes.get(t, 0) == 0])
    rates = sorted(rate_changes.get(t, 0) for t in tickers)
    out(mode="anchor", nextFundingRate_changes_per_market={"min": rates[0], "median": statistics.median(rates), "max": rates[-1]},
        nextFundingRate_changes_BTC=rate_changes.get("BTC-USD", 0))
    blocks = [h for h, _ in heights]
    ages = [a for _, a in heights]
    out(mode="anchor", heights_first_last=[blocks[0], blocks[-1]], blocks_per_second=round((blocks[-1] - blocks[0]) / max(1, seconds), 3),
        block_age_ms={"min": min(ages), "median": statistics.median(ages), "max": max(ages)})


def mode_funding() -> None:
    c = Client(INDEXER_HOST)
    status, headers, body, ms = c.get("/v4/perpetualMarkets")
    markets = json.loads(body)["markets"]
    active = [m for m in markets.values() if m.get("status") == "ACTIVE"]
    # BTC and ETH, the market whose default hourly rate is not 0, and the one with the largest predicted rate
    with_default = sorted(m["ticker"] for m in active if float(m.get("defaultFundingRate1H") or 0) != 0)
    largest = max(active, key=lambda m: abs(float(m.get("nextFundingRate") or 0)))["ticker"]
    picks = list(dict.fromkeys(["BTC-USD", "ETH-USD"] + with_default[:1] + [largest]))
    for t in picks:
        status, headers, body, ms = c.get(f"/v4/historicalFunding/{t}?limit=48")
        rows = json.loads(body).get("historicalFunding", [])
        ats = [iso_ms(r["effectiveAt"]) for r in rows]
        gaps = sorted({round((a - b) / 1000) for a, b in zip(ats, ats[1:])})
        ms_after_hour = sorted({a % 3_600_000 for a in ats})
        out(mode="funding", at=stamp(), ticker=t, status=status, ms=round(ms, 1), rows=len(rows), headers=kept(headers),
            newest=rows[:3], gaps_s=gaps, ms_after_hour={"min": ms_after_hour[0], "max": ms_after_hour[-1]} if ms_after_hour else None,
            rates_seen=sorted({r["rate"] for r in rows})[:8], nextFundingRate=markets[t].get("nextFundingRate"),
            defaultFundingRate1H=markets[t].get("defaultFundingRate1H"), marketType=markets[t].get("marketType"))


def book_summary(data: dict) -> dict:
    bids, asks = data.get("bids", []), data.get("asks", [])
    bp = [float(level["price"]) for level in bids]
    ap = [float(level["price"]) for level in asks]
    return {
        "bids": len(bids), "asks": len(asks),
        "bids_descending": bp == sorted(bp, reverse=True), "asks_ascending": ap == sorted(ap),
        "best_bid": bids[0] if bids else None, "best_ask": asks[0] if asks else None,
        "crossed": bool(bp and ap and bp[0] >= ap[0]),
        "level_keys": sorted({k for level in bids + asks for k in level}),
    }


def mode_book() -> None:
    c = Client(INDEXER_HOST)
    status, headers, body, ms = c.get("/v4/perpetualMarkets")
    markets = json.loads(body)["markets"]
    active = [m for m in markets.values() if m.get("status") == "ACTIVE"]
    thin = min(active, key=lambda m: float(m.get("volume24H") or 0))["ticker"]
    for t in ["BTC-USD", thin]:
        for i in range(3):
            status, headers, body, ms = c.get(f"/v4/orderbooks/perpetualMarket/{t}")
            if i == 0:
                save(f"orderbook-{t}.json", body)
            out(mode="book", at=stamp(), ticker=t, read=i, status=status, ms=round(ms, 1), bytes=len(body), headers=kept(headers), **book_summary(json.loads(body)))
            time.sleep(0.3)
    crossed = []
    for m in active:
        status, headers, body, ms = c.get(f"/v4/orderbooks/perpetualMarket/{m['ticker']}")
        s = book_summary(json.loads(body))
        if s["crossed"] or not s["bids"] or not s["asks"]:
            crossed.append({"ticker": m["ticker"], "bids": s["bids"], "asks": s["asks"], "crossed": s["crossed"], "best_bid": s["best_bid"], "best_ask": s["best_ask"]})
        time.sleep(0.25)
    out(mode="book", sweep_markets=len(active), crossed_or_one_sided=crossed)


def mode_errors() -> None:
    c = Client(INDEXER_HOST)
    for path in ["/v4/orderbooks/perpetualMarket/FOO-USD", "/v4/perpetualMarkets?market=FOO-USD", "/v4/historicalFunding/FOO-USD",
                 "/v4/orderbooks/perpetualMarket/btc-usd", "/v4/nosuchpath"]:
        status, headers, body, ms = c.get(path)
        out(mode="errors", at=stamp(), path=path, status=status, body=body[:300].decode(errors="replace"), headers=kept(headers))
        time.sleep(0.3)


def mode_chain() -> None:
    c = Client(NODE_HOST)
    paths = {
        "perpetual_params": "/dydxprotocol/perpetuals/params",
        "liquidity_tiers": "/dydxprotocol/perpetuals/liquidity_tiers",
        "epochs": "/dydxprotocol/v4/epochs/epoch_info",
        "perpetuals": "/dydxprotocol/perpetuals/perpetual?pagination.limit=1000",
        "clob_pairs": "/dydxprotocol/clob/clob_pair?pagination.limit=1000",
        "market_params": "/dydxprotocol/prices/params/market?pagination.limit=1000",
        "listing_hard_cap": "/dydxprotocol/listing/markets_hard_cap",
        "marketmap_v2": "/connect/marketmap/v2/marketmap",  # answered 501 Not Implemented on 2026-10-12
        "marketmap": "/slinky/marketmap/v1/marketmap",
        "blocktime_synchrony": "/dydxprotocol/v4/blocktime/synchrony_params",
    }
    replies = {}
    for name, path in paths.items():
        try:
            status, headers, body, ms = c.get(path)
        except Exception as error:  # a public node can drop the connection, and the mode carries on
            out(mode="chain", name=name, path=path, error=repr(error))
            continue
        save(f"chain-{name}.json", body)
        out(mode="chain", at=stamp(), name=name, host=NODE_HOST, path=path, status=status, ms=round(ms, 1), bytes=len(body))
        if status == 200:
            replies[name] = json.loads(body)
        time.sleep(0.4)
    if "perpetual_params" in replies:
        out(mode="chain", perpetual_params=replies["perpetual_params"])
    if "liquidity_tiers" in replies:
        out(mode="chain", liquidity_tiers=replies["liquidity_tiers"].get("liquidity_tiers"))
    if "epochs" in replies:
        out(mode="chain", epochs=replies["epochs"].get("epoch_info"))
    if "listing_hard_cap" in replies:
        out(mode="chain", listing_hard_cap=replies["listing_hard_cap"])
    if "blocktime_synchrony" in replies:
        out(mode="chain", blocktime_synchrony=replies["blocktime_synchrony"])
    if "perpetuals" in replies:
        perps = replies["perpetuals"].get("perpetual", [])
        params = [p.get("params", {}) for p in perps]
        out(mode="chain", perpetuals=len(perps), market_type=dict(Counter(p.get("market_type") for p in params)),
            default_funding_ppm=dict(Counter(p.get("default_funding_ppm") for p in params)),
            sample=perps[0] if perps else None)
    if "clob_pairs" in replies:
        pairs = replies["clob_pairs"].get("clob_pair", [])
        out(mode="chain", clob_pairs=len(pairs), status=dict(Counter(p.get("status") for p in pairs)))
    if "market_params" in replies:
        mps = replies["market_params"].get("market_params", [])
        out(mode="chain", market_params=len(mps), sample=[m for m in mps if m.get("pair") in ("BTC-USD", "ETH-USD")][:2])
    if "marketmap" in replies:
        mm = replies["marketmap"].get("market_map", {}).get("markets", {})
        providers = Counter(p.get("name") for m in mm.values() for p in m.get("provider_configs", []))
        btc = mm.get("BTC/USD", {})
        out(mode="chain", marketmap_markets=len(mm), enabled=sum(1 for m in mm.values() if m.get("ticker", {}).get("enabled")),
            providers=dict(providers.most_common()), btc=btc)
        normalised = sorted({p.get("normalize_by_pair", {}).get("Base", "") + "/" + p.get("normalize_by_pair", {}).get("Quote", "")
                             for m in mm.values() for p in m.get("provider_configs", []) if p.get("normalize_by_pair")})
        out(mode="chain", normalize_by_pairs=normalised)
        # Which token each live ticker follows: its providers' own symbols and the market map metadata.
        c2 = Client(INDEXER_HOST)
        status, headers, body, ms = c2.get("/v4/perpetualMarkets")
        live = sorted(t for t, m in json.loads(body)["markets"].items() if m.get("status") == "ACTIVE")
        provider_counts = []
        for t in live:
            entry = mm.get(t.replace("-", "/"), {})
            configs = entry.get("provider_configs", [])
            provider_counts.append(len(configs))
            out(mode="chain", live_ticker=t, in_market_map=bool(entry), enabled=entry.get("ticker", {}).get("enabled"),
                min_provider_count=entry.get("ticker", {}).get("min_provider_count"), metadata=entry.get("ticker", {}).get("metadata_JSON"),
                providers=[(p.get("name"), p.get("off_chain_ticker"), (p.get("normalize_by_pair") or {}).get("Base")) for p in configs])
        out(mode="chain", live_providers_per_market={"min": min(provider_counts), "median": statistics.median(provider_counts), "max": max(provider_counts)})


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "funding": mode_funding,
         "book": mode_book, "errors": mode_errors, "chain": mode_chain}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    for name in chosen:
        MODES[name]()
