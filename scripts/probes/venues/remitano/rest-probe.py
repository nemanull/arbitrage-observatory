# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Remitano public REST probe, read-only and unauthenticated.

The public market calls come from Remitano's own OpenAPI 2.0 document at https://api.remitano.com/api/v1/doc,
which the API explorer at https://developers.remitano.com/api-explorer loads.
The calls /api/v1/order_books and /api/v1/order_book_price_levels are not in that document.
They come from the web app bundle https://cdn.remitano.com/assets/chunks/react-35b6ed4f.js.

Run from the repository root: uv run scripts/probes/venues/remitano/rest-probe.py
It sends about 100 requests over about two minutes, one at a time.
"""

import email.utils
import json
import socket
import time
import urllib.error
import urllib.request

API = "https://api.remitano.com/api/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"


def get(url, headers=None):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body, status, hdrs = r.read(), r.status, r.headers
    except urllib.error.HTTPError as e:
        body, status, hdrs = e.read(), e.code, e.headers
    return status, hdrs, body, (time.perf_counter() - t0) * 1000


def short(body, n=240):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def section(title):
    print(f"\n== {title}")


def pick(hdrs, *names):
    return {n: hdrs.get(n) for n in names if hdrs.get(n) is not None}


def host_and_latency():
    section("1. host and latency")
    for host in ("api.remitano.com", "remitano.com", "socket.remitano.com", "cablesocket.remitano.com", "cdn.remitano.com", "developers.remitano.com"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except OSError as e:
            addrs = [f"unresolved {e}"]
        print(f"{host} {addrs}")
    times = []
    for i in range(6):
        s, h, b, ms = get(f"{API}/markets/exchange_info")
        times.append(round(ms))
        if i == 0:
            print(f"exchange_info status {s} bytes {len(b)} {pick(h, 'server', 'cf-ray', 'cf-cache-status', 'cache-control')}")
        time.sleep(0.5)
    print(f"exchange_info times ms, first is cold: {times}")


def access():
    section("access from this host")
    for url in ("https://remitano.com/", "https://remitano.com/global", "https://remitano.com/global/fees",
                "https://remitano.com/policy/api_terms_of_service", "https://developers.remitano.com/",
                "https://api.remitano.com/", "https://api.remitano.com/api/v1/doc", "https://api.remitano.com/api/v2/doc"):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        opener = urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(req, timeout=20) as r:
                body, status, hdrs = r.read(), r.status, r.headers
        except urllib.error.HTTPError as e:
            body, status, hdrs = e.read(), e.code, e.headers
        title = ""
        low = body.decode("utf-8", "replace")
        if "<title>" in low:
            title = low.split("<title>", 1)[1].split("</title>", 1)[0].strip()[:60]
        print(f"{status} {url} bytes {len(body)} title {title!r} location {hdrs.get('location')} cf-mitigated {hdrs.get('cf-mitigated')}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def catalog():
    section("2. catalog")
    s, h, b, ms = get(f"{API}/markets/exchange_info")
    d = json.loads(b)
    date_hdr = email.utils.parsedate_to_datetime(h["Date"]).timestamp()
    pairs = [r["trading_pairs"] for r in d["data"]]
    quotes = sorted({p.split("_")[1] for p in pairs})
    print(f"exchange_info {s} {len(b)} bytes {ms:.0f} ms, {len(pairs)} pairs, quotes {quotes}")
    print(f"pairs {pairs}")
    print(f"server_time {d['server_time']} ({type(d['server_time']).__name__}), Date header {int(date_hdr)}, server_time minus Date {int(d['server_time']) - int(date_hdr)} s")
    print(f"server_time minus Date minus 7 h {int(d['server_time']) - int(date_hdr) - 7 * 3600} s, cf-cache-status {h.get('cf-cache-status')}")
    print(f"row keys {sorted(d['data'][0])}")
    one_sided = [r["trading_pairs"] for r in d["data"] if float(r["highest_bid"]) <= 0 or float(r["lowest_ask"]) <= 0]
    print(f"pairs with a zero bid or ask {one_sided}")
    spreads = sorted(((float(r["lowest_ask"]) / float(r["highest_bid"]) - 1) * 1e6, r["trading_pairs"]) for r in d["data"] if float(r["highest_bid"]) > 0)
    print(f"top of book spread ppm, narrowest five {[(p, round(x)) for x, p in spreads[:5]]}, widest three {[(p, round(x)) for x, p in spreads[-3:]]}")
    s, h, b, ms = get(f"{API}/coingecko/pairs")
    cg = [r["ticker_id"] for r in json.loads(b)]
    print(f"coingecko/pairs {s} {len(cg)} pairs, same set as exchange_info: {sorted(cg) == sorted(pairs)}")
    s, h, b, ms = get(f"{API}/markets/24h")
    m24 = json.loads(b)
    print(f"markets/24h {s} {len(m24)} keys, spelling {list(m24)[:3]}, keys not in exchange_info {sorted(set(m24) - {p.replace('_', '') for p in pairs})}")
    s, h, b, ms = get(f"{API}/coinmarketcap/exchange_info")
    print(f"coinmarketcap/exchange_info {s} {len(json.loads(b)['data'])} pairs")
    s, h, b, ms = get(f"{API}/volumes/market_summaries")
    ms_ = json.loads(b)
    print(f"volumes/market_summaries {s} {len(ms_)} keys, for example {list(ms_)[:4]}")
    return pairs


def references():
    section("3. reference prices")
    s, h, b, ms = get(f"{API}/tickers/price")
    t = json.loads(b)
    print(f"tickers/price {s} {len(t)} rows, BTCUSDT {t.get('BTCUSDT')}, rows with bid equal to ask {sum(1 for v in t.values() if v.get('bid') == v.get('ask'))}")
    s, h, b, ms = get(f"{API}/altcoins")
    a = json.loads(b)
    print(f"altcoins {s} {len(a)} rows, first default_exchange {[(r['currency'], r.get('default_exchange')) for r in a[:3]]}")
    s, h, b, ms = get(f"{API}/rates/ads")
    r = json.loads(b)
    print(f"rates/ads {s} {len(r)} countries, ca row {r.get('ca')}")


def book(pairs):
    section("5. REST book")
    for depth in (5, 20, 100, 500, 501, 0):
        s, h, b, ms = get(f"{API}/markets/ETH_USDT/order_books?depth={depth}")
        try:
            d = json.loads(b)
        except ValueError:
            d = {}
        if s == 200:
            print(f"ETH_USDT depth={depth} {s} asks {len(d['asks'])} bids {len(d['bids'])} {pick(h, 'cache-control', 'cf-cache-status', 'age')}")
        else:
            print(f"ETH_USDT depth={depth} {s} {short(b)} {pick(h, 'cache-control', 'cf-cache-status')}")
        time.sleep(0.4)
    s, h, b, ms = get(f"{API}/markets/BTC_USDT/order_books")
    d = json.loads(b)
    print(f"BTC_USDT default depth {s} {len(b)} bytes {ms:.0f} ms asks {len(d['asks'])} bids {len(d['bids'])} keys {sorted(d)}")
    print(f"ticker_id {d['ticker_id']!r} timestamp {d['timestamp']} first ask {d['asks'][0]} first bid {d['bids'][0]}")
    date_hdr = email.utils.parsedate_to_datetime(h["Date"]).timestamp()
    print(f"book timestamp minus Date header {d['timestamp'] / 1000 - date_hdr:.1f} s, cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}")
    asks = [float(p) for p, q in d["asks"]]
    bids = [float(p) for p, q in d["bids"]]
    print(f"asks ascending {asks == sorted(asks)}, bids descending {bids == sorted(bids, reverse=True)}, crossed {bids[0] >= asks[0]}")
    print(f"level values are {type(d['asks'][0][0]).__name__}, sizes in base: first ask notional {asks[0] * float(d['asks'][0][1]):.4f} quote")
    counts = {}
    for p in pairs:
        s, h, b, ms = get(f"{API}/markets/{p}/order_books?depth=100")
        x = json.loads(b) if s == 200 else {}
        counts[p] = (s, len(x.get("asks", [])), len(x.get("bids", [])))
        time.sleep(0.3)
    print(f"depth=100 per pair (status, asks, bids) {counts}")
    for p in ("NOPE_USDT", "btc_usdt", "BTCUSDT", "RENEC_VND"):
        s, h, b, ms = get(f"{API}/markets/{p}/order_books?depth=5")
        print(f"{p} {s} {short(b, 200)}")
        time.sleep(0.3)
    s, h, b, ms = get(f"{API}/coingecko/orderbook?ticker_id=BTC_USDT&depth=10")
    print(f"coingecko/orderbook {s} {short(b, 200)}")
    s, h, b, ms = get(f"{API}/coinmarketcap/order_books/BTC_USDT")
    print(f"coinmarketcap/order_books {s} {short(b, 160)}")


def freshness():
    section("5b. REST book freshness, 30 polls at 2 s")
    seen = []
    for i in range(30):
        s, h, b, ms = get(f"{API}/markets/BTC_USDT/order_books?depth=20")
        d = json.loads(b)
        age = email.utils.parsedate_to_datetime(h["Date"]).timestamp() - d["timestamp"] / 1000
        seen.append((d["timestamp"], d["asks"][0][0], d["bids"][0][0], h.get("cf-cache-status"), round(ms), round(age)))
        time.sleep(2)
    stamps = [x[0] for x in seen]
    tops = {(x[1], x[2]) for x in seen}
    print(f"distinct timestamps {len(set(stamps))} of {len(seen)}, distinct top of book {len(tops)}, cf-cache-status {sorted({x[3] for x in seen})}")
    print(f"step between timestamps ms {sorted({b - a for a, b in zip(stamps, stamps[1:])})[:5]}")
    print(f"reply ms min {min(x[4] for x in seen)} max {max(x[4] for x in seen)}")
    print(f"snapshot age at delivery, Date header minus book timestamp, s: first {seen[0][5]} last {seen[-1][5]} max {max(x[5] for x in seen)}")


def internal_book():
    section("app-internal price levels against the REST book")
    s, h, b, ms = get(f"{API}/order_book_price_levels")
    st = json.loads(b)["order_book_price_level_state"]
    print(f"order_book_price_levels {s} {len(b)} bytes {ms:.0f} ms, {len(st)} directed pairs, {sum(1 for v in st.values() if v['price_levels'])} non-empty {pick(h, 'cache-control', 'cf-cache-status')}")
    s, h, b, ms = get(f"{API}/markets/BTC_USDT/order_books?depth=100")
    rb = json.loads(b)
    asks = st["btc_usdt"]["price_levels"]
    bids = st["usdt_btc"]["price_levels"]
    same_asks = [[a["price"], a["amount"]] for a in asks] == rb["asks"]
    print(f"btc_usdt levels {len(asks)} equal REST asks: {same_asks}")
    inv = [(1 / float(x["price"]), float(x["amount"]) * float(x["price"])) for x in bids[:3]]
    print(f"usdt_btc first three as price=1/p, size=amount*p: {[(round(p, 6), round(q, 12)) for p, q in inv]}")
    print(f"REST first three bids {rb['bids'][:3]}")
    print(f"usdt_btc raw first three {[(x['price'], x['amount']) for x in bids[:3]]}")


def limits():
    section("6. rate limit headers and a short burst")
    statuses = []
    hdr_names = set()
    for i in range(10):
        s, h, b, ms = get(f"{API}/markets/24h")
        statuses.append(s)
        hdr_names |= {k.lower() for k in h.keys() if "rate" in k.lower() or "limit" in k.lower() or "retry" in k.lower()}
        time.sleep(0.2)
    print(f"10 calls at 5 per second, statuses {statuses}, rate headers {sorted(hdr_names)}")


if __name__ == "__main__":
    host_and_latency()
    access()
    pairs = catalog()
    references()
    book(pairs)
    internal_book()
    freshness()
    limits()
