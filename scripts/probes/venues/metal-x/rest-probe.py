# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only public REST probe for Metal X, the XPR Network order book DEX at https://dex.api.mainnet.metalx.com/dex/v1.

Modes, all by default, or name some on the command line:
    host     the exit IP and its geolocation, DNS for the API host and that address's geolocation, TCP and TLS time, and four cold status/sync calls.
    catalog  markets/all: counts by type and status_code, quote token, fee values, and any pair listed twice.
    anchor   paths an index, mark or funding call would use, to show they do not exist.
    book     orders/depth on XBTC_XMD and XPR_XMD at several step and limit values, with level order, repeated prices, size and time, plus trades/daily and trades/recent.
    errors   unknown symbol, missing step, missing symbol, a huge limit, and an unknown path.
    poll     orders/depth on XBTC_XMD, one call every 1.2 s for 60 s, counting top of book and sync changes, reply times and rate limit headers.
    time     the HTTP Date header against the local clock, the depth sync counter over ten seconds against the XPR chain head, and whether markets/all is cached.

The poll mode makes about 50 calls in 60 s, under one call a second, far inside the published 10 requests a second.
The flag --short halves the poll window for the second pass rerun.

Run from the repository root:
    uv run scripts/probes/venues/metal-x/rest-probe.py [--short] [mode ...]
"""

import email.utils
import json
import socket
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.request

HOST = "dex.api.mainnet.metalx.com"
BASE = f"https://{HOST}/dex/v1"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
POLL_S = 60 * (0.5 if "--short" in sys.argv else 1.0)
CHAIN_INFO = "https://rpc.api.mainnet.metalx.com/v1/chain/get_info"  # XPR Network RPC named in the app bundle
RL_HEADERS = ("x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after")


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def get(path: str, timeout: float = 20.0) -> dict:
    url = path if path.startswith("http") else f"{BASE}/{path}"
    req = urllib.request.Request(url, headers=UA)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            status, headers = r.status, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        body, status, headers = e.read(), e.code, {k.lower(): v for k, v in e.headers.items()}
    t1 = time.time()
    text = body.decode("utf-8", "replace")
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    return {"url": url, "status": status, "ms": round((t1 - t0) * 1000, 1), "bytes": len(body),
            "headers": headers, "text": text, "json": data, "t0": t0, "t1": t1}


def rl(r: dict) -> dict:
    return {k: r["headers"].get(k) for k in RL_HEADERS if k in r["headers"]}


def mode_host() -> None:
    r = get("https://ipinfo.io/json")
    j = r["json"] or {}
    out(mode="host", exit_ip=j.get("ip"), city=j.get("city"), region=j.get("region"), country=j.get("country"), org=j.get("org"))
    infos = socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)
    addrs = sorted({i[4][0] for i in infos})
    out(mode="host", dns=addrs)
    v4 = next(a for a in addrs if ":" not in a)
    g = get(f"https://ipinfo.io/{v4}/json")["json"] or {}
    out(mode="host", api_ip=v4, city=g.get("city"), country=g.get("country"), org=g.get("org"), hostname=g.get("hostname"))
    for _ in range(2):
        t0 = time.perf_counter()
        s = socket.create_connection((v4, 443), timeout=10)
        t1 = time.perf_counter()
        ctx = ssl.create_default_context()
        ss = ctx.wrap_socket(s, server_hostname=HOST)
        t2 = time.perf_counter()
        out(mode="host", ip=v4, tcp_ms=round((t1 - t0) * 1000, 1), tls_ms=round((t2 - t1) * 1000, 1), tls=ss.version())
        ss.close()
        time.sleep(0.5)
    for _ in range(4):
        r = get("status/sync")
        out(mode="host", call="status/sync", status=r["status"], ms=r["ms"], body=r["text"][:200],
            server=r["headers"].get("server"), cf_ray=r["headers"].get("cf-ray"), **rl(r))
        time.sleep(0.5)


def mode_catalog() -> None:
    r = get("markets/all")
    j = r["json"]
    rows = j["data"]
    out(mode="catalog", status=r["status"], ms=r["ms"], bytes=r["bytes"], sync=j.get("sync"), count=len(rows),
        top_keys=sorted(j.keys()), row_keys=sorted(rows[0].keys()), token_keys=sorted(rows[0]["bid_token"].keys()))
    by = lambda f: dict(sorted(((str(k), sum(1 for x in rows if f(x) == k)) for k in {f(x) for x in rows})))
    out(mode="catalog", by_type=by(lambda x: x["type"]), by_status=by(lambda x: x["status_code"]),
        by_quote=by(lambda x: x["ask_token"]["code"]), by_taker=by(lambda x: x["taker_fee"]), by_maker=by(lambda x: x["maker_fee"]))
    for x in rows:
        out(mode="catalog", id=x["market_id"], symbol=x["symbol"], status=x["status_code"], type=x["type"],
            maker=x["maker_fee"], taker=x["taker_fee"], order_min=x["order_min"],
            base=f'{x["bid_token"]["code"]}@{x["bid_token"]["contract"]}/{x["bid_token"]["precision"]}',
            quote=f'{x["ask_token"]["code"]}@{x["ask_token"]["contract"]}/{x["ask_token"]["precision"]}')
    pairs: dict = {}
    for x in rows:
        pairs.setdefault((x["bid_token"]["code"], x["ask_token"]["code"]), []).append(x["symbol"])
    out(mode="catalog", listed_twice={f"{b}/{q}": s for (b, q), s in pairs.items() if len(s) > 1},
        bases_on_two_quotes=sorted({b for (b, q) in pairs if sum(1 for (b2, _) in pairs if b2 == b) > 1}))
    sample = json.dumps(rows[0], separators=(",", ":"))
    out(mode="catalog", sample=sample)


def mode_anchor() -> None:
    for p in ("markets/perpetual", "markets/futures", "funding/rate", "funding/history", "index/price",
              "mark/price", "markets/index", "markets/mark", "prices/oracle", "oracles"):
        r = get(p)
        out(mode="anchor", path=p, status=r["status"], ms=r["ms"], body=r["text"][:200])
        time.sleep(0.3)


def book_stats(r: dict) -> dict:
    d = (r["json"] or {}).get("data") or {}
    bids, asks = d.get("bids", []), d.get("asks", [])
    bl, al = [x["level"] for x in bids], [x["level"] for x in asks]
    return {
        "status": r["status"], "ms": r["ms"], "bytes": r["bytes"], "sync": (r["json"] or {}).get("sync"),
        "bids": len(bids), "asks": len(asks),
        "bids_desc": bl == sorted(bl, reverse=True), "asks_asc": al == sorted(al),
        "bid_repeats": len(bl) - len(set(bl)), "ask_repeats": len(al) - len(set(al)),
        "crossed": bool(bl and al and bl[0] >= al[0]),
        "zero_rows": sum(1 for x in bids + asks if not x["bid"] or not x["ask"]),
        "best_bid": bids[0] if bids else None, "best_ask": asks[0] if asks else None,
        "max_count": max((x["count"] for x in bids + asks), default=None),
        "row_keys": sorted(bids[0].keys()) if bids else None,
        "ask_over_bid_vs_level": [round(x["ask"] / x["bid"] / x["level"], 4) for x in (bids[:2] + asks[:2]) if x["bid"]],
    }


def mode_book() -> None:
    for sym, steps in (("XBTC_XMD", (1, 10, 100, 1000)), ("XPR_XMD", (1000000, 10000, 1000))):
        for step in steps:
            for limit in (5, 100, 250, 251):
                r = get(f"orders/depth?symbol={sym}&step={step}&limit={limit}")
                out(mode="book", symbol=sym, step=step, limit=limit, **book_stats(r))
                time.sleep(0.4)
    r = get("orders/depth?symbol=XBTC_XMD&step=100")
    out(mode="book", note="no limit", **book_stats(r))
    r = get("orders/depth?symbol=XBTC_XMD&step=100&limit=3")
    out(mode="book", sample=r["text"][:1200])
    r = get("orders/depth?symbol=XMD_XUSDT&step=1000000&limit=100")
    out(mode="book", symbol="XMD_XUSDT", **book_stats(r))
    r = get("trades/daily")
    rows = (r["json"] or {}).get("data") or []
    out(mode="book", call="trades/daily", status=r["status"], bytes=r["bytes"], rows=len(rows),
        zero_volume=[x["symbol"] for x in rows if not x["volume_bid"]], sample=json.dumps(rows[:2]))
    r = get("trades/recent?symbol=XBTC_XMD&offset=0&limit=3")
    out(mode="book", call="trades/recent", status=r["status"], bytes=r["bytes"], sample=r["text"][:900])


def mode_errors() -> None:
    for p in ("orders/depth?symbol=FOO_BAR&step=100&limit=5",
              "orders/depth?symbol=XBTC_XMD&limit=5",
              "orders/depth?step=100&limit=5",
              "orders/depth?symbol=XBTC_XMD&step=100&limit=100000",
              "orders/depth?symbol=xbtc_xmd&step=100&limit=5",
              "orders/depth?symbol=XBTC_XMD&step=0&limit=5",
              "nope"):
        r = get(p)
        d = (r["json"] or {}).get("data") if isinstance(r["json"], dict) else None
        sizes = {k: len(v) for k, v in d.items()} if isinstance(d, dict) else None
        out(mode="errors", path=p, status=r["status"], bytes=r["bytes"], sides=sizes, body=r["text"][:240])
        time.sleep(0.4)


def mode_poll() -> None:
    times, tops, syncs, statuses, rls = [], [], [], {}, []
    end = time.time() + POLL_S
    while time.time() < end:
        r = get("orders/depth?symbol=XBTC_XMD&step=100&limit=20")
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
        times.append(r["ms"])
        j = r["json"] or {}
        d = j.get("data") or {}
        b, a = (d.get("bids") or [None])[0], (d.get("asks") or [None])[0]
        tops.append(json.dumps([b, a]))
        syncs.append(j.get("sync"))
        rls.append(r["headers"].get("x-ratelimit-remaining"))
        time.sleep(max(0.0, 1.2 - r["ms"] / 1000))
    top_changes = sum(1 for i in range(1, len(tops)) if tops[i] != tops[i - 1])
    sync_changes = sum(1 for i in range(1, len(syncs)) if syncs[i] != syncs[i - 1])
    out(mode="poll", seconds=POLL_S, replies=len(times), statuses=statuses, top_changes=top_changes,
        sync_changes=sync_changes, sync_first=syncs[0], sync_last=syncs[-1],
        sync_monotonic=all(syncs[i] >= syncs[i - 1] for i in range(1, len(syncs))),
        median_ms=round(statistics.median(times), 1), min_ms=min(times), max_ms=max(times),
        ratelimit_remaining_first=rls[0], ratelimit_remaining_last=rls[-1], cache=r["headers"].get("cache-control"),
        etag=r["headers"].get("etag"))


def mode_time() -> None:
    for _ in range(3):
        r = get("status/sync")
        server = email.utils.parsedate_to_datetime(r["headers"]["date"]).timestamp()
        mid = (r["t0"] + r["t1"]) / 2
        out(mode="time", date=r["headers"]["date"], offset_s=round(server - mid, 3), rtt_ms=r["ms"], body=r["text"])
        time.sleep(0.5)
    depth = "orders/depth?symbol=XBTC_XMD&step=100&limit=1"
    first = get(depth)["json"]["sync"]
    head = get(CHAIN_INFO)["json"]
    t0 = time.time()
    time.sleep(10)
    second = get(depth)["json"]["sync"]
    dt = time.time() - t0
    out(mode="time", depth_sync_first=first, chain_head=head["head_block_num"], chain_irreversible=head["last_irreversible_block_num"],
        head_block_time=head["head_block_time"], depth_sync_second=second, seconds=round(dt, 2),
        per_second=round((second - first) / dt, 2))
    a = get("markets/all")["json"]["sync"]
    time.sleep(3)
    b = get("markets/all")["json"]["sync"]
    out(mode="time", markets_all_sync_3s_apart=[a, b], depth_sync_now=get(depth)["json"]["sync"])


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "book": mode_book,
         "errors": mode_errors, "poll": mode_poll, "time": mode_time}

if __name__ == "__main__":
    chosen = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODES)
    for m in chosen:
        MODES[m]()
