# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only public REST probe for Coinut, the JSON POST API at https://api.coinut.com.

Every public request is a POST of one JSON object with a "request" name and a nonce, per https://github.com/coinut/api/wiki.
Sections: host and latency, catalog for every sec_type, tick and last trade for every spot instrument, the REST book, about 30 s of 1 s polls, error shapes, server time, the website paths, and what the current web and mobile clients are.
About 120 requests at no more than about 2 per second, with no credentials.
Run from the repository root with: uv run scripts/probes/venues/coinut/rest-probe.py
"""

import collections
import datetime
import email.utils
import http.client
import json
import re
import socket
import ssl
import statistics
import time

API = "api.coinut.com"
CTX = ssl.create_default_context()
HDRS = {"User-Agent": "arbitrage-observatory-probe/1.0", "Content-Type": "application/json", "Accept": "application/json"}
_nonce = int(time.time()) % 1_000_000
_conns: dict[str, http.client.HTTPSConnection] = {}


def nonce() -> int:
    global _nonce
    _nonce += 1
    return _nonce


def call(method: str, host: str, path: str, body: str | None = None, fresh: bool = False):
    """One request over a kept-alive connection per host. Returns status, lowercased headers, body text, seconds."""
    if fresh or host not in _conns:
        if host in _conns:
            _conns[host].close()
        _conns[host] = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    conn = _conns[host]
    t0 = time.perf_counter()
    try:
        conn.request(method, path, body=body, headers=HDRS)
        resp = conn.getresponse()
        text = resp.read().decode("utf-8", "replace")
    except (http.client.HTTPException, OSError):
        conn.close()
        _conns.pop(host, None)
        if fresh:
            raise
        return call(method, host, path, body, fresh=True)
    return resp.status, {k.lower(): v for k, v in resp.getheaders()}, text, time.perf_counter() - t0


def post(payload: dict, fresh: bool = False):
    payload = dict(payload)
    payload.setdefault("nonce", nonce())
    st, h, text, t = call("POST", API, "/", json.dumps(payload), fresh)
    try:
        return st, h, json.loads(text), text, t
    except json.JSONDecodeError:
        return st, h, None, text, t


def us_to_iso(us: int) -> str:
    return datetime.datetime.fromtimestamp(us / 1e6, datetime.UTC).strftime("%Y-%m-%d %H:%M:%S")


def section(title: str) -> None:
    print(f"\n=== {title}")


def host_and_latency() -> None:
    section("1. host and latency")
    for host in (API, "wsapi.coinut.com", "coinut.com"):
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        print("resolved", host, addrs)
    st, h, text, cold = call("GET", API, "/", fresh=True)
    print("GET / cold", st, round(cold * 1000), "ms", repr(text.strip()), "server", h.get("server"), "cf-ray", h.get("cf-ray"))
    warm = []
    for _ in range(8):
        time.sleep(0.5)
        warm.append(post({"request": "hb"})[4] * 1000)
    print("POST hb warm ms", [round(x) for x in warm], "median", round(statistics.median(warm)))
    print("hb reply", post({"request": "hb"})[3])


def catalog() -> dict:
    section("2. catalog")
    st, h, d, text, t = post({"request": "inst_list", "sec_type": "SPOT"})
    rows = {sym: r[0] for sym, r in d["SPOT"].items()}
    print("inst_list SPOT", st, len(text), "bytes", round(t * 1000), "ms", "instruments", len(rows))
    print("rows with more than one entry", [s for s, r in d["SPOT"].items() if len(r) != 1])
    print("quote counts", dict(collections.Counter(r["quote"] for r in rows.values())))
    print("symbol equals base plus quote on every row", all(s == r["base"] + r["quote"] for s, r in rows.items()))
    print("symbols", " ".join(sorted(rows)))
    for st_type in ("OPTION", "FUTURE", "FUTURES", "SWAP", "PERPETUAL", "MARGIN"):
        time.sleep(0.5)
        print("inst_list", st_type, post({"request": "inst_list", "sec_type": st_type})[3])
    return rows


def ticks_and_trades(rows: dict) -> None:
    section("3. tick and last trade for every spot instrument")
    stale, tick_ts = [], set()
    for sym in sorted(rows):
        iid = rows[sym]["inst_id"]
        time.sleep(0.4)
        _, h, tk, _, _ = post({"request": "inst_tick", "inst_id": iid})
        time.sleep(0.4)
        _, _, tr, _, _ = post({"request": "inst_trade", "inst_id": iid})
        tick_ts.add(tk.get("timestamp"))
        now_us = int(email.utils.parsedate_to_datetime(h["date"]).timestamp() * 1e6)
        trades = tr.get("trades") or []
        last_trade = max((x["timestamp"] for x in trades), default=0)
        bid, ask = tk.get("highest_buy"), tk.get("lowest_sell")
        crossed = bid is not None and ask is not None and float(ask) > 0 and float(bid) >= float(ask)
        print(f"{sym:10} id {iid:8} bid {bid} ask {ask} last {tk.get('last')} vol24 {tk.get('volume24')} "
              f"trades {len(trades)} last_trade {us_to_iso(last_trade) if last_trade else None} crossed {crossed}")
        stale.append((sym, last_trade))
    print("server now from the Date header", us_to_iso(now_us))
    print("distinct tick timestamps across all instruments", [(t, us_to_iso(t)) for t in sorted(x for x in tick_ts if x)])
    for days in (1, 7, 30, 90, 365):
        n = sum(1 for _, ts in stale if ts and now_us - ts < days * 86400e6)
        print(f"instruments with a trade in the last {days} d", n, "of", len(stale))
    print("newest trade on any instrument", us_to_iso(max(ts for _, ts in stale)))


def book(rows: dict) -> None:
    section("4. REST book")
    iid = rows["BTCUSDT"]["inst_id"]
    st, h, d, text, t = post({"request": "inst_order_book", "inst_id": iid})
    buy, sell = d["buy"], d["sell"]
    print("inst_order_book BTCUSDT default", st, len(text), "bytes", round(t * 1000), "ms", "levels buy", len(buy), "sell", len(sell))
    print("keys", sorted(d), "level keys", sorted(buy[0]))
    print("buy descending", all(float(a["price"]) > float(b["price"]) for a, b in zip(buy, buy[1:])),
          "sell ascending", all(float(a["price"]) < float(b["price"]) for a, b in zip(sell, sell[1:])))
    print("best bid", buy[0], "best ask", sell[0], "total_buy", d.get("total_buy"), "total_sell", d.get("total_sell"))
    print("trans_id on snapshot", d.get("trans_id"))
    for top_n in (10, 50, 100, 200, 20):
        time.sleep(0.5)
        st, _, d, text, _ = post({"request": "inst_order_book", "inst_id": iid, "top_n": top_n})
        if d and "buy" in d:
            print("top_n", top_n, "levels buy", len(d["buy"]), "sell", len(d["sell"]))
        else:
            print("top_n", top_n, text[:200])
    for sym in ("ETHUSDT", "LTCBTC", "USDTXSGD"):
        time.sleep(0.5)
        _, _, d, _, _ = post({"request": "inst_order_book", "inst_id": rows[sym]["inst_id"]})
        b, s = d["buy"], d["sell"]
        print(sym, "levels buy", len(b), "sell", len(s), "best bid", b[0]["price"] if b else None, "best ask", s[0]["price"] if s else None)


def polls(rows: dict) -> None:
    section("5. 30 one-second polls of the BTCUSDT tick and book")
    iid = rows["BTCUSDT"]["inst_id"]
    seen_tick, seen_book, times = set(), set(), []
    for _ in range(30):
        _, _, tk, _, t = post({"request": "inst_tick", "inst_id": iid})
        _, _, bk, _, _ = post({"request": "inst_order_book", "inst_id": iid, "top_n": 10})
        times.append(t * 1000)
        seen_tick.add((tk["highest_buy"], tk["lowest_sell"], tk["last"], tk["trans_id"]))
        seen_book.add(json.dumps([bk["buy"], bk["sell"]]))
        time.sleep(1)
    print("distinct ticks", len(seen_tick), sorted(seen_tick)[:3], "distinct top 10 books", len(seen_book), "median tick ms", round(statistics.median(times)))


def errors(rows: dict) -> None:
    section("6. error shapes and limit headers")
    cases = [
        ("unknown inst_id", {"request": "inst_tick", "inst_id": 999999999}),
        ("inst_id as symbol", {"request": "inst_tick", "inst_id": "BTCUSDT"}),
        ("unknown request", {"request": "no_such_request"}),
        ("missing nonce", {"request": "inst_tick", "inst_id": rows["BTCUSDT"]["inst_id"], "nonce": None}),
        ("nonce out of range", {"request": "hb", "nonce": 16777216}),
        ("private without auth", {"request": "user_balance"}),
    ]
    for label, payload in cases:
        time.sleep(0.5)
        if payload.get("nonce", 0) is None:
            payload = {k: v for k, v in payload.items() if k != "nonce"}
            st, h, text, _ = call("POST", API, "/", json.dumps(payload))
        else:
            st, h, _, text, _ = post(payload)
        print(label, st, text[:220])
    time.sleep(0.5)
    st, h, text, _ = call("POST", API, "/", "not json")
    print("body not JSON", st, text[:200])
    time.sleep(0.5)
    st, h, text, _ = call("GET", API, "/?request=inst_list&sec_type=SPOT")
    print("GET with query", st, text[:120])
    limit_keys = [k for k in h if "rate" in k or "limit" in k or "retry" in k]
    print("rate limit or retry headers on the last reply", limit_keys or "none")
    print("all headers on the last reply", sorted(h))


def server_time() -> None:
    section("7. server time")
    before = time.time()
    _, h, tk, _, _ = post({"request": "inst_tick", "inst_id": 490589})
    after = time.time()
    mid = (before + after) / 2
    print("tick timestamp", tk["timestamp"], us_to_iso(tk["timestamp"]), "minus local mid in hours", round((tk["timestamp"] / 1e6 - mid) / 3600, 1))
    st, _, d, text, _ = post({"request": "time"})
    print("request time", st, text[:160])
    print("Date header", h.get("date"), "offset s", round(email.utils.parsedate_to_datetime(h["date"]).timestamp() - mid, 1))


def website() -> None:
    section("8. website and help center")
    for host, path in (("coinut.com", "/"), ("coinut.com", "/spot/BTCUSDT/"), ("coinut.com", "/trade/"), ("wsapi.coinut.com", "/"),
                       ("help.coinut.com", "/hc/en-us"), ("help.coinut.com", "/api/v2/help_center/en-us/articles/360001416133.json")):
        time.sleep(0.5)
        st, h, text, t = call("GET", host, path)
        title = text.split("<title>")[1].split("</title>")[0] if "<title>" in text else text[:60].strip()
        print("GET", host + path, st, len(text), "bytes", round(t * 1000), "ms", "location", h.get("location"), "cf-mitigated", h.get("cf-mitigated"), "title", repr(title))


def web_client() -> None:
    section("9. what the current web and mobile clients are")
    st, _, home, _ = call("GET", "coinut.com", "/")
    bundles = re.findall(r'<script src="(/new-web/[^"]+\.js)"', home)
    print("homepage", st, "bundles", bundles)
    for b in bundles:
        st, _, js, _ = call("GET", "coinut.com", b)
        routes = sorted(set(re.findall(r'"(/dashboard/[a-z-]+)', js)))
        print("bundle", b, st, len(js), "bytes", "wss urls", sorted(set(re.findall(r"wss?://[A-Za-z0-9./_-]+", js))),
              "inst_ requests", len(re.findall(r"inst_(?:list|tick|order_book|trade)", js)), "api.coinut.com mentions", js.count("api.coinut.com"))
        print("dashboard routes", routes)
    st, _, body, _ = call("GET", "itunes.apple.com", "/lookup?id=1331328939&country=sg")
    for r in json.loads(body).get("results", []):
        print("App Store", r["trackName"], r["currentVersionReleaseDate"], repr(r["description"][:300]))


def main() -> None:
    print("probe start", datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"))
    host_and_latency()
    rows = catalog()
    ticks_and_trades(rows)
    book(rows)
    polls(rows)
    errors(rows)
    server_time()
    website()
    web_client()
    print("\nprobe end", datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"))


if __name__ == "__main__":
    main()
