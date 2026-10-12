# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Crypton Exchange public REST probe for docs/profiles/crypton/rest.md.

Read-only and unauthenticated.
It sends about 110 requests over about two minutes, never more than one per second.
The venue publishes no rate limit, so the probe stays at the pace of the site's own web client or slower.
Run from the repository root with: uv run scripts/probes/venues/crypton/rest-probe.py
"""

import collections
import email.utils
import http.client
import json
import socket
import ssl
import statistics
import time
import urllib.parse

HOST = "crp.is"
PORT = 8182
CTX = ssl.create_default_context()
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
POLL_SECONDS = 60

_conn: http.client.HTTPSConnection | None = None


def request(method: str, path: str, body: str | None = None, fresh: bool = False):
    """One request over a kept-alive connection. Returns status, headers, text, seconds."""
    global _conn
    if fresh and _conn is not None:
        _conn.close()
        _conn = None
    if _conn is None:
        _conn = http.client.HTTPSConnection(HOST, PORT, timeout=20, context=CTX)
    headers = dict(UA)
    if body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    t0 = time.perf_counter()
    try:
        _conn.request(method, path, body=body, headers=headers)
        resp = _conn.getresponse()
        text = resp.read().decode("utf-8", "replace")
    except (http.client.HTTPException, OSError):
        _conn.close()
        _conn = None
        raise
    return resp.status, dict(resp.getheaders()), text, time.perf_counter() - t0


def show(label: str, status: int, headers: dict, text: str, secs: float, limit: int = 300):
    print(f"\n== {label}: HTTP {status}, {len(text)} bytes, {secs * 1000:.0f} ms")
    interesting = {k: v for k, v in headers.items() if k.lower() in (
        "server", "content-type", "cache-control", "retry-after", "x-ratelimit-limit",
        "x-ratelimit-remaining", "access-control-allow-origin", "date", "etag")}
    print("   headers:", interesting)
    print("   body:", text[:limit].replace("\n", " "))


def main():
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    # 1. DNS and latency
    addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(HOST, PORT, proto=socket.IPPROTO_TCP)})
    print("resolved", HOST, addrs)
    cold = []
    for _ in range(3):
        status, _, _, secs = request("GET", "/market/ticker", fresh=True)
        cold.append(secs * 1000)
        time.sleep(1)
    warm = []
    for _ in range(10):
        status, _, _, secs = request("GET", "/market/ticker")
        warm.append(secs * 1000)
        time.sleep(1)
    print(f"cold ms {[round(x) for x in cold]}, warm ms min {min(warm):.0f} median {statistics.median(warm):.0f} max {max(warm):.0f}")

    # 2. Catalog: pairs, ticker, currencies
    status, headers, text, secs = request("GET", "/market/pairs")
    show("GET /market/pairs", status, headers, text, secs)
    pairs = json.loads(text)["result"]["pairs"]
    print(f"   pair rows: {len(pairs)}")
    for row in pairs:
        p, d = row["pair"], row["data_market"]
        print(f"   {p['pair']:<10} id={p['pair_id']} show={p['pair_show']!r} group={p['group']} visible={p['visible']} "
              f"enable={p['enable']} round_amt={p['round_deal_amount']} round_px={p['round_deal_price']} "
              f"min_amount={p['min_amount']} min_price={p['min_price']} max_price={p['max_price']} "
              f"close={d['close']} volume={d['volume']} value={d['value']} rate={d['rate']} date_now={d['date_now']}")
    print("   pair keys:", sorted(pairs[0]["pair"].keys()), "data_market keys:", sorted(pairs[0]["data_market"].keys()))
    time.sleep(1)

    status, headers, text, secs = request("GET", "/market/ticker")
    show("GET /market/ticker", status, headers, text, secs)
    ticker = json.loads(text)["result"]
    for t in ticker:
        print(f"   {t['pair']:<10} last={t['last_price']} bid={t['bid']} ack={t['ack']} base_vol={t['base_volume']} "
              f"quote_vol={t['quote_volume']} enable={t['enable']}")
    quotes = collections.Counter(t["ecur"] for t in ticker)
    print("   ticker rows by quote currency:", dict(quotes))
    time.sleep(1)

    status, headers, text, secs = request("GET", "/market/curlist")
    show("GET /market/curlist", status, headers, text, secs, limit=200)
    for name, c in json.loads(text)["result"].items():
        print(f"   {name:<5} {c['fullname']!r} deposit_fee={c['deposit_fee']} withdraw_fee={c['withdraw_fee']} "
              f"withdraw_fee_pro={c.get('withdraw_fee_pro')} enable={c['enable']} show={c['show']}")
    time.sleep(1)

    # 3. Index, mark and funding do not exist on a spot venue. Try the obvious names once each.
    for path in ("/market/index", "/market/mark", "/market/funding", "/futures/pairs", "/contract/pairs"):
        status, headers, text, secs = request("GET", path)
        show(f"GET {path}", status, headers, text, secs, limit=160)
        time.sleep(1)

    # 5. REST book: the documented POST form and the GET the web client sends
    status, headers, text, secs = request("POST", "/market/panel", body="pair=crp_usdt")
    show("POST /market/panel pair=crp_usdt", status, headers, text, secs, limit=200)
    panel = json.loads(text)["result"]
    print("   result keys:", sorted(panel.keys()))
    for side in ("book_sell", "book_buy"):
        prices = [lvl["price"] for lvl in panel[side]]
        order = "ascending" if prices == sorted(prices) else "descending" if prices == sorted(prices, reverse=True) else "unordered"
        print(f"   {side}: {len(prices)} levels, {order}, first {panel[side][:2]}, last {panel[side][-1:]}")
    print(f"   volumes {panel['volumes']}, time {panel['time']}")
    for side in ("book_sell", "book_buy"):
        print(f"   {side} sum of amount {sum(l['amount'] for l in panel[side]):.6f}, sum of value {sum(l['value'] for l in panel[side]):.6f}")
    time.sleep(1)

    status, headers, text, secs = request("GET", "/market/panel?c=crp_usdt")
    show("GET /market/panel?c=crp_usdt (web client form)", status, headers, text, secs, limit=200)
    time.sleep(1)

    for pair in [t["pair"] for t in ticker]:
        status, headers, text, secs = request("POST", "/market/panel", body=urllib.parse.urlencode({"pair": pair}))
        res = json.loads(text).get("result") or {}
        print(f"   panel {pair:<10} HTTP {status} sell={len(res.get('book_sell', []))} buy={len(res.get('book_buy', []))} "
              f"best_ask={(res.get('book_sell') or [{}])[0].get('price')} best_bid={(res.get('book_buy') or [{}])[0].get('price')}")
        time.sleep(1)

    for body in ("pair=nope_usdt", "pair=", ""):
        status, headers, text, secs = request("POST", "/market/panel", body=body)
        show(f"POST /market/panel body={body!r}", status, headers, text, secs, limit=200)
        time.sleep(1)

    # Trades
    status, headers, text, secs = request("GET", "/history/trade?pair=crp_usdt")
    items = json.loads(text)["result"]["items"]
    show("GET /history/trade?pair=crp_usdt", status, headers, text, secs, limit=200)
    print(f"   {len(items)} trades, newest {items[0]['created_at']}, oldest {items[-1]['created_at']}")
    time.sleep(1)

    # 6. Errors: an unknown path, a private call without a token
    for method, path in (("GET", "/no/such/path"), ("GET", "/user/balance"), ("GET", "/user/session/check")):
        status, headers, text, secs = request(method, path)
        show(f"{method} {path}", status, headers, text, secs, limit=200)
        time.sleep(1)

    # 7. Clock: Date header and the panel time field against the local clock
    offsets = []
    for _ in range(5):
        before = time.time()
        status, headers, text, secs = request("POST", "/market/panel", body="pair=crp_usdt")
        after = time.time()
        server_ms = json.loads(text)["result"]["time"]
        offsets.append(server_ms - (before + after) / 2 * 1000)
        date_hdr = email.utils.parsedate_to_datetime(headers["Date"]).timestamp()
        time.sleep(1)
    print(f"\nclock offset from panel time, ms: {[round(x) for x in offsets]}, last Date header offset s: {date_hdr - after:.1f}")

    # 4. How often the top of book and the ticker change over one minute of one second polls
    tops, lasts, panel_times = [], [], []
    end = time.time() + POLL_SECONDS
    while time.time() < end:
        status, _, text, _ = request("POST", "/market/panel", body="pair=crp_usdt")
        res = json.loads(text)["result"]
        tops.append((res["book_buy"][0]["price"], res["book_buy"][0]["amount"], res["book_sell"][0]["price"], res["book_sell"][0]["amount"]))
        panel_times.append(res["time"])
        time.sleep(1)
    changes = sum(1 for a, b in zip(tops, tops[1:]) if a != b)
    print(f"\npoll: {len(tops)} panel polls, top of book changed {changes} times, distinct tops {len(set(tops))}, "
          f"panel time distinct {len(set(panel_times))}")
    print("probe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
