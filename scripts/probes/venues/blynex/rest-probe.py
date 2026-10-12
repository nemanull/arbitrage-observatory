# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Blynex public REST probe for docs/profiles/blynex/rest.md and fees.md.

Public, unauthenticated and read-only, at most about four requests a second.
Sections, in order:
  hosts    DNS for every Blynex name, cold and warm time of /v1/time, and the status of the web pages the profiles cite.
  catalog  /v1/market, /v2/tickers, /v1/ticker and /v1/assets on api.blynex.com, and the futures pair list on futures.blynex.com.
  book     the REST book at several limit and level values, level order, and two reads 300 ms apart.
  touch    the REST book touch against /v1/market bid and ask, and against OKX's public BTC-USDT and ETH-USDT tickers.
  polls    30 one second polls of /v1/market and the BTC_USDT book, counting changes.
  limits   rate limit headers, a burst of 20 calls at 4 a second, error shapes and the server time offset.
  bundle   the futures web app's chunks: socket URL, REST bases, Socket.IO events, and whether any book code exists.
  app      the Android APK read as a zip, never run, for any socket or API URL, and one Wayback Machine lookup of the spot page.
Run from the repository root with: uv run scripts/probes/venues/blynex/rest-probe.py
Captures land in .claude/survey-work/blynex/.
"""

import io
import json
import pathlib
import re
import socket
import statistics
import time
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "blynex"
WORK.mkdir(parents=True, exist_ok=True)
API = "https://api.blynex.com"
FUT = "https://futures.blynex.com/api"
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
OUT = {}


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000


def get_json(url):
    st, h, body, ms = get(url)
    try:
        return st, h, json.loads(body), ms, len(body)
    except ValueError:
        return st, h, body[:200].decode(errors="replace"), ms, len(body)


def hosts():
    names = ["blynex.com", "www.blynex.com", "api.blynex.com", "docs.blynex.com", "futures.blynex.com", "ws.blynex.com", "wss.blynex.com",
             "stream.blynex.com", "socket.blynex.com", "spot.blynex.com", "trade.blynex.com", "exchange.blynex.com"]
    dns = {}
    for n in names:
        try:
            dns[n] = sorted({a[4][0] for a in socket.getaddrinfo(n, 443)})
        except socket.gaierror as e:
            dns[n] = "error " + str(e)
    times = [get(API + "/v1/time")[3] for _ in range(6)]
    pages = {}
    for p in ["https://blynex.com/", "https://blynex.com/trade-fees/", "https://blynex.com/blynex-hybrid-forex-crypto-future/",
              "https://blynex.com/terms-and-conditions/", "https://blynex.com/spot/BTC_USDT", "https://blynex.com/spot/ETH_USDT",
              "https://blynex.com/futures/BTCUSDT", "https://api.blynex.com/", "https://docs.blynex.com/",
              "https://futures.blynex.com/socket.io/?EIO=4&transport=polling"]:
        req = urllib.request.Request(p, headers={"User-Agent": UA})
        opener = urllib.request.build_opener(NoRedirect())
        try:
            r = opener.open(req, timeout=20)
            st, h, body = r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            st, h, body = e.code, dict(e.headers), e.read()
        text = body.decode(errors="replace")
        title = text.split("<title>")[1].split("</title>")[0].strip() if "<title>" in text else ""
        pages[p] = {"status": st, "bytes": len(body), "title": title[:80], "location": h.get("Location") or h.get("location"),
                    "cf-mitigated": h.get("cf-mitigated") or h.get("Cf-Mitigated"), "server": h.get("Server") or h.get("server")}
    OUT["hosts"] = {"dns": dns, "time_ms_cold": round(times[0]), "time_ms_warm_median": round(statistics.median(times[1:])), "pages": pages}
    print("hosts", json.dumps(OUT["hosts"], indent=1))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def catalog():
    st, h, market, ms, n = get_json(API + "/v1/market")
    (WORK / "v1-market.json").write_text(json.dumps(market))
    types, quotes, fees = {}, {}, {}
    for m in market:
        types[m["type"]] = types.get(m["type"], 0) + 1
        quotes[m["quote"]] = quotes.get(m["quote"], 0) + 1
        k = f'{m["makerFee"]}/{m["takerFee"]}'
        fees[k] = fees.get(k, 0) + 1
    ids = [m["id"] for m in market]
    zero_vol = sum(1 for m in market if not m.get("baseVolume"))
    no_touch = sum(1 for m in market if not m.get("bidPrice") or not m.get("askPrice"))
    crossed = [m["id"] for m in market if m.get("bidPrice") and m.get("askPrice") and m["bidPrice"] > m["askPrice"]]
    st2, _, tick2, ms2, n2 = get_json(API + "/v2/tickers")
    st3, _, tick1, ms3, n3 = get_json(API + "/v1/ticker")
    st4, _, assets, ms4, n4 = get_json(API + "/v1/assets")
    st5, _, info, _, _ = get_json(API + "/v1/info")
    afees = {}
    for a in assets.values():
        k = f'{a.get("makerFee")}/{a.get("takerFee")}'
        afees[k] = afees.get(k, 0) + 1
    stf, hf, pairs, msf, nf = get_json(FUT + "/pairs/list")
    (WORK / "futures-pairs.json").write_text(json.dumps(pairs))
    cats, with_fee = {}, []
    for p in pairs:
        cats[p["category"]] = cats.get(p["category"], 0) + 1
        if "openFee" in p or "closeFee" in p:
            with_fee.append({"pair": p["pair"], "openFee": p.get("openFee"), "closeFee": p.get("closeFee")})
    OUT["catalog"] = {
        "v1_market": {"status": st, "rows": len(market), "bytes": n, "ms": round(ms), "types": types, "quotes": quotes,
                       "maker_taker": fees, "zero_base_volume": zero_vol, "missing_bid_or_ask": no_touch, "crossed": crossed,
                       "first_ids": ids[:5], "id_format_underscore": all("_" in i for i in ids)},
        "v2_tickers": {"status": st2, "rows": len(tick2), "bytes": n2, "ms": round(ms2),
                       "same_ids_as_market": sorted(t["ticker_id"] for t in tick2) == sorted(ids)},
        "v1_ticker": {"status": st3, "rows": len(tick1), "bytes": n3, "ms": round(ms3)},
        "v1_assets": {"status": st4, "rows": len(assets), "maker_taker": afees},
        "v1_info": info,
        "futures_pairs": {"status": stf, "rows": len(pairs), "bytes": nf, "ms": round(msf), "categories": cats,
                          "fields": sorted({k for p in pairs for k in p}), "with_fee_fields": with_fee},
    }
    print("catalog", json.dumps(OUT["catalog"], indent=1))
    return market


def book_shape(d):
    b, a = d.get("bids", []), d.get("asks", [])
    desc = all(b[i][0] > b[i + 1][0] for i in range(len(b) - 1))
    asc = all(a[i][0] < a[i + 1][0] for i in range(len(a) - 1))
    return {"bids": len(b), "asks": len(a), "bids_descending": desc, "asks_ascending": asc,
            "best_bid": b[0] if b else None, "best_ask": a[0] if a else None,
            "level_types": sorted({type(x).__name__ for lv in b + a for x in lv})}


def book():
    res = {}
    for q in ["", "&limit=10", "&limit=20", "&limit=40", "&limit=50", "&limit=100", "&limit=1000", "&level=1", "&level=2", "&level=3", "&level=2&limit=40"]:
        st, h, d, ms, n = get_json(API + "/v1/orderbook?market_id=BTC_USDT" + q)
        res["v1 " + (q or "none")] = {"status": st, "ms": round(ms), "bytes": n, **(book_shape(d) if isinstance(d, dict) and "bids" in d else {"body": d})}
        time.sleep(0.25)
    st, h, d, ms, n = get_json(API + "/v2/orderbook?ticker_id=BTC_USDT&depth=40")
    res["v2 depth=40"] = {"status": st, "ms": round(ms), "keys": sorted(d), **book_shape(d)}
    st, h, d1, ms, n = get_json(API + "/v1/orderbook?market_id=BTC_USDT")
    (WORK / "book-btc.json").write_text(json.dumps(d1))
    time.sleep(0.3)
    st, h, d2, ms, n = get_json(API + "/v1/orderbook?market_id=BTC_USDT")
    res["two_reads_300ms_identical"] = d1 == d2
    res["two_reads_same_lastUpdated"] = d1.get("lastUpdated") == d2.get("lastUpdated")
    res["lastUpdated_unit"] = "seconds" if d1.get("lastUpdated", 0) < 1e11 else "ms"
    res["cache_headers"] = {k: v for k, v in h.items() if k.lower() in ("cache-control", "age", "cf-cache-status", "etag")}
    sizes = [lv[1] for lv in d1["bids"] + d1["asks"]]
    res["btc_notional_usdt_each_side_top20"] = [round(sum(p * s for p, s in d1["bids"][:20])), round(sum(p * s for p, s in d1["asks"][:20]))]
    res["btc_size_median"] = statistics.median(sizes)
    res["btc_spread_ppm"] = round((d1["asks"][0][0] - d1["bids"][0][0]) / d1["bids"][0][0] * 1e6)
    OUT["book"] = res
    print("book", json.dumps(res, indent=1))


def okx(inst):
    st, h, d, ms, n = get_json(f"https://www.okx.com/api/v5/market/ticker?instId={inst}")
    t = d["data"][0]
    return float(t["bidPx"]), float(t["askPx"]), float(t["last"])


def touch(market):
    rows = {m["id"]: m for m in market}
    res = {}
    for blx, ok in [("BTC_USDT", "BTC-USDT"), ("ETH_USDT", "ETH-USDT"), ("SOL_USDT", "SOL-USDT"), ("XRP_USDT", "XRP-USDT")]:
        if blx not in rows:
            continue
        st, h, d, ms, n = get_json(API + f"/v1/orderbook?market_id={blx}&limit=20")
        st, h, mk, ms, n = get_json(API + "/v1/market?pair=" + blx)
        m = mk[0] if isinstance(mk, list) else mk
        ob, oa, ol = okx(ok)
        bmid = (d["bids"][0][0] + d["asks"][0][0]) / 2
        omid = (ob + oa) / 2
        res[blx] = {"book_touch": [d["bids"][0][0], d["asks"][0][0]], "market_bid_ask_last": [m["bidPrice"], m["askPrice"], m["lastPrice"]],
                    "okx_bid_ask": [ob, oa], "book_mid_vs_okx_ppm": round((bmid - omid) / omid * 1e6),
                    "market_last_vs_okx_ppm": round((m["lastPrice"] - omid) / omid * 1e6),
                    "book_mid_vs_market_mid_ppm": round((bmid - (m["bidPrice"] + m["askPrice"]) / 2) / ((m["bidPrice"] + m["askPrice"]) / 2) * 1e6)}
        time.sleep(0.3)
    OUT["touch"] = res
    print("touch", json.dumps(res, indent=1))


def polls():
    last, bidask, book_top, lu = [], [], [], []
    t_market, t_book = [], []
    for _ in range(30):
        t0 = time.time()
        st, h, mk, ms, n = get_json(API + "/v1/market?pair=BTC_USDT")
        t_market.append(ms)
        m = mk[0] if isinstance(mk, list) else mk
        last.append(m["lastPrice"])
        bidask.append((m["bidPrice"], m["askPrice"]))
        st, h, d, ms, n = get_json(API + "/v1/orderbook?market_id=BTC_USDT&limit=20")
        t_book.append(ms)
        book_top.append((d["bids"][0][0], d["asks"][0][0]))
        lu.append(d["lastUpdated"])
        time.sleep(max(0, 1 - (time.time() - t0)))
    ch = lambda xs: sum(1 for i in range(1, len(xs)) if xs[i] != xs[i - 1])
    OUT["polls"] = {"n": 30, "market_last_changes": ch(last), "market_bidask_changes": ch(bidask), "book_touch_changes": ch(book_top),
                    "book_lastUpdated_changes": ch(lu), "market_ms_median": round(statistics.median(t_market)), "market_ms_max": round(max(t_market)),
                    "book_ms_median": round(statistics.median(t_book)), "book_ms_max": round(max(t_book))}
    print("polls", json.dumps(OUT["polls"], indent=1))


def limits():
    st, h, d, ms, n = get_json(API + "/v1/time")
    local = time.time()
    rl = {k: v for k, v in h.items() if "limit" in k.lower() or "retry" in k.lower()}
    statuses = []
    for _ in range(20):
        t0 = time.time()
        statuses.append(get(API + "/v1/time")[0])
        time.sleep(max(0, 0.25 - (time.time() - t0)))
    errs = {}
    for name, url in [("unknown market book", API + "/v1/orderbook?market_id=NOPE_USDT"), ("book no market", API + "/v1/orderbook"),
                      ("unknown pair market", API + "/v1/market?pair=NOPE_USDT"), ("unknown path", API + "/v1/nope"),
                      ("v2 book unknown", API + "/v2/orderbook?ticker_id=NOPE_USDT"), ("futures unknown pair", FUT + "/pairs/NOPEUSDT")]:
        st, h, body, ms = get(url)
        errs[name] = {"status": st, "body": body[:160].decode(errors="replace")}
    OUT["limits"] = {"rate_limit_headers": rl, "burst_20_at_4_per_s": {str(s): statuses.count(s) for s in set(statuses)},
                     "errors": errs, "serverTime": d.get("serverTime"), "server_time_unit": "seconds",
                     "offset_s": round(d.get("serverTime", 0) - local, 1)}
    print("limits", json.dumps(OUT["limits"], indent=1))


def bundle():
    st, h, body, ms = get("https://blynex.com/futures/BTCUSDT")
    chunks = sorted(set(re.findall(r'/futures/_next/static/chunks/[0-9a-z-]+\.js', body.decode(errors="replace"))))
    text = ""
    for c in chunks:
        text += get("https://blynex.com" + c)[2].decode(errors="replace")
    OUT["bundle"] = {"chunks": len(chunks), "ws_urls": sorted(set(re.findall(r'wss://[a-z0-9.]+', text))),
                     "api_bases": sorted(set(re.findall(r'https://futures\.blynex\.com/api[a-z-]*', text))),
                     "events_on": sorted(set(re.findall(r'\.on\("([A-Z0-9_]+)"', text))),
                     "emits": sorted(set(re.findall(r'\.emit\("(subscribe[a-z_]*)"', text))),
                     "transports_websocket_only": 'transports:["websocket"]' in text,
                     "book_strings": {w: len(re.findall(w, text, re.I)) for w in ("orderbook", "order_book", "bids", "asks", "depth")},
                     "rest_paths": sorted(set(re.findall(r'"(/(?:pairs|positions|orders|user|auth)[a-z/-]*)"', text)))}
    print("bundle", json.dumps(OUT["bundle"], indent=1))


def app():
    st, h, body, ms = get("https://blynex.com/APK/xHCGuAqIMbnS8h87oDgy.apk", timeout=120)
    found, assets = set(), []
    if st == 200:
        z = zipfile.ZipFile(io.BytesIO(body))
        for n in z.namelist():
            if n.endswith((".dex", ".json", ".html", ".xml", ".js")):
                data = z.read(n)
                found |= {u.decode(errors="replace") for u in re.findall(rb'(?:wss?|https?)://[a-zA-Z0-9._/-]*blynex[a-zA-Z0-9._/-]*', data)}
                if b"wss://" in data and n.endswith(".dex"):
                    found.add("bare wss:// string in " + n)
            if n.startswith("assets/"):
                assets.append(n)
    wb = get("https://web.archive.org/cdx/search/cdx?url=blynex.com/spot/BTC_USDT&output=json&limit=5", timeout=60)
    OUT["app"] = {"apk_status": st, "apk_bytes": len(body), "blynex_urls_in_apk": sorted(found), "apk_assets": assets[:12],
                  "wayback_cdx_status": wb[0], "wayback_body": wb[2][:120].decode(errors="replace")}
    print("app", json.dumps(OUT["app"], indent=1))


if __name__ == "__main__":
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    hosts()
    market = catalog()
    book()
    touch(market)
    polls()
    limits()
    bundle()
    app()
    OUT["started_utc"] = started
    (WORK / "rest-probe.json").write_text(json.dumps(OUT, indent=1))
    print("wrote", WORK / "rest-probe.json")
