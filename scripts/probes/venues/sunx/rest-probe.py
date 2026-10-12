# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""SunX (sunx.vip) REST probe for docs/profiles/sunx/rest.md.

Public, unauthenticated and read-only, about 60 requests over about 70 seconds.
  1. Which venue CoinMarketCap ranks 209: its exchange listing, and the detail of both venues it names SunX.
  2. DNS for the live site, its mirror hosts, its help center and the namesake DEX.
  3. The home pages and the SunX tenant configs in the live bundle.
  4. The perpetual catalog /v1/cfd/public/instruments, cold and warm, with counts and field values.
  5. The anchor fields: markPrice, settledAt, settlementRate, the funding countdown, and OKX marks beside them.
  6. Fifteen polls of the catalog 2 s apart, counting how often each anchor field changes.
  7. The spot catalog, and REST book paths the bundle might name.
  8. Error shapes, rate limit headers and the Date header offset.
  9. The namesake SunX DEX at api.sunx.io, a different venue: catalog, batch index, batch funding, mark, book.
  10. CCXT: the installed 4.5.68 class list and the current master on GitHub.
Run from the repository root with: uv run scripts/probes/venues/sunx/rest-probe.py
"""

import collections
import email.utils
import json
import os
import re
import socket
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html, */*"}
SITE = "https://sunx.vip"
DEX = "https://api.sunx.io"
CCXT_DIR = "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:  # DNS failure, TLS error, timeout
        return None, {}, f"{type(e).__name__}: {e}".encode(), (time.perf_counter() - t0) * 1000


def head(body, n=200):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def utc(ms):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ms / 1000))


def section_cmc():
    print("== 1. CoinMarketCap identity")
    st, hd, body, ms = get("https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=0&start=1&limit=300")
    rows = json.loads(body)["data"]["exchanges"] if st == 200 else []
    for i, e in enumerate(rows, 1):
        if "sun" in e["slug"]:
            print(f"listing exType=0 position {i}: id {e['id']} {e['name']} slug {e['slug']} score {e.get('score')} spotVol24h {e.get('spotVol24h')}")
    for slug in ("sunx", "sunperp"):
        st, hd, body, ms = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug={slug}")
        d = json.loads(body).get("data", {}) if st == 200 else {}
        print(f"detail {slug}: id {d.get('id')} website {d.get('urls', {}).get('website')} type {d.get('type')!r} launched {d.get('dateLaunched')}")
        for cat in ("perpetual", "spot"):
            st, hd, body, ms = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug={slug}&category={cat}&start=1&limit=100")
            d = json.loads(body).get("data", {}) if st == 200 else {}
            mp = d.get("marketPairs", [])
            print(f"  {cat}: numMarketPairs {d.get('numMarketPairs')}, first 100 priceExcluded {collections.Counter(m.get('priceExcluded') for m in mp)}"
                  f" volumeExcluded {collections.Counter(m.get('volumeExcluded') for m in mp)}")


def section_dns():
    print("== 2. DNS")
    for h in ("sunx.vip", "www.sunx.vip", "api.sunx.vip", "www.31976.me", "ws.31976.me", "www.sun3259.me", "support.sunx.vip",
              "www.sunx.io", "api.sunx.io"):
        try:
            print(f"{h}: {sorted(set(a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)))}")
        except OSError as e:
            print(f"{h}: {e}")


def section_bundle():
    print("== 3. Sites and bundle")
    for url in (SITE + "/", "https://www.31976.me/", "https://www.sun3259.me/", "https://api.sunx.vip/", "https://support.sunx.vip/hc/en-001"):
        st, hd, body, ms = get(url, timeout=20)
        t = re.search(rb"<title>\s*([^<]*)", body)
        print(f"{url}: {st} {len(body)} bytes {ms:.0f} ms server={hd.get('Server') or hd.get('server')} title={t.group(1).decode().strip()[:70] if t else head(body, 60)!r}")
    st, hd, body, ms = get(SITE + "/")
    app = re.search(r'src="/(app\.[0-9a-f]+\.js)"', body.decode())
    st, hd, js, ms = get(f"{SITE}/{app.group(1)}", timeout=60)
    s = js.decode("utf-8", "replace")
    print(f"{app.group(1)}: {st}, {len(js)} bytes")
    info = re.search(r"__APP_INFO__=JSON\.parse\('([^']+)'\)", s)
    if info:
        i = json.loads(info.group(1))
        print("app info:", {k: i.get(k) for k in ("name", "project", "env", "namespace", "buildTime")})
    print("SunX configs (exId, ws, oldws, host):")
    for m in re.finditer(r'invate/SunX/en-US-invate\.png"\]\}[^}]{0,400}\},a=\{exId:"([^"]+)",ws:"([^"]+)",oldws:"([^"]+)",host:"([^"]+)"', s):
        print("  ", m.groups())
    print("host special case:", re.search(r'\["sunx\.vip"\]\.includes\(n\)&&\(r=g\.h\)', s) is not None)
    print("socket path builders:", sorted(set(re.findall(r'"wss://"\.concat\(\w,"(/v1/[a-z]+/ws)"\)', s))))
    paths = sorted(set(re.findall(r'"(/v1/[a-z]+/public/[A-Za-z0-9/_.-]*)"', s)))
    print("public REST paths:", paths)
    print("REST book or depth path present:", bool(re.search(r'"/v1/[a-z]+/[A-Za-z/_]*(depth|orderbook|orderBook)[A-Za-z/_]*"', s)))
    for k in ("takerFee", "makerFee", "commissionRate", "openSpread", "settlementRate"):
        print(f"bundle reads {k}:", k in s)
    lab = re.findall(r'hyp_tiny_saas_chartArea_settlementRate:"([^"]+)"', s)
    print("labels of chartArea_settlementRate:", [x for x in lab if x.isascii()][:3])


def section_catalog():
    print("== 4. Perpetual catalog")
    url = SITE + "/v1/cfd/public/instruments"
    for label in ("cold", "warm", "warm"):
        st, hd, body, ms = get(url)
        print(f"{label}: {st} {len(body)} bytes {ms:.0f} ms content-type={hd.get('Content-Type')}")
    env = json.loads(body)
    data = env["data"]
    print("envelope keys:", sorted(env.keys()), "code", env.get("code"))
    print("rows:", len(data), "status:", collections.Counter(x["status"] for x in data))
    on = [x for x in data if x["status"] == "online"]
    print("online symbols, first 30:", [x["symbol"] for x in on][:30])
    print("quote:", collections.Counter(x["quote"] for x in on), "margin:", collections.Counter(json.dumps(x["marginCurrencyList"]) for x in on))
    print("symbol listed twice:", [k for k, v in collections.Counter(x["symbol"] for x in data).items() if v > 1])
    for k in ("takerFee", "makerFee", "commissionRate", "openSpread", "closeSpread", "settlementRate", "fundingIntervalHours",
              "settledAt", "oneLotSize", "minSize", "maxLeverage", "currencyType"):
        print(f"  {k}:", collections.Counter(x[k] for x in on).most_common(8))
    print("  non-crypto rows:", [(x["symbol"], x["status"], x["fullName"]) for x in data if x["symbol"] in ("xauusdt", "xagusdt", "nvdausdt", "tslausdt")])
    btc = next(x for x in data if x["symbol"] == "btcusdt")
    print("  btcusdt row:", json.dumps({k: v for k, v in btc.items() if k != "configBo"}, ensure_ascii=True))
    st, hd, body, ms = get("https://www.31976.me/v1/cfd/public/instruments")
    print(f"same call on the mirror www.31976.me: {st} {len(body)} bytes rows {len(json.loads(body)['data']) if st == 200 else None}")
    return on


def okx_mark(inst):
    st, hd, body, ms = get(f"https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId={inst}")
    try:
        return float(json.loads(body)["data"][0]["markPx"])
    except Exception:
        return f"{st} {head(body, 80)}"


def section_anchor(on):
    print("== 5. Anchor fields")
    now = time.time()
    st, hd, body, ms = get(SITE + "/v1/cfd/public/funding/countdown")
    print(f"countdown: {st} {head(body)} {ms:.0f} ms, host clock {utc(now * 1000)} UTC")
    try:
        print("  countdown points to", utc((now + json.loads(body)["data"]) * 1000), "UTC")
    except Exception:
        pass
    for sym in ("btcusdt", "dogeusdt"):
        st, hd, body, ms = get(SITE + "/v1/cfd/public/funding/countdown/" + sym)
        print(f"countdown/{sym}: {st} {head(body)}")
    print("settledAt values:", {utc(k): v for k, v in collections.Counter(x["settledAt"] for x in on).items()}, "hours ahead:",
          round((on[0]["settledAt"] / 1000 - now) / 3600, 2))
    st, hd, body, ms = get(SITE + "/v1/cfd/public/instruments")
    rows = {x["symbol"]: x for x in json.loads(body)["data"]}
    for sym, inst in (("btcusdt", "BTC-USDT-SWAP"), ("ethusdt", "ETH-USDT-SWAP"), ("solusdt", "SOL-USDT-SWAP"), ("dogeusdt", "DOGE-USDT-SWAP")):
        r = rows[sym]
        ok = okx_mark(inst)
        gap = (r["markPrice"] / ok - 1) * 1e4 if isinstance(ok, float) else None
        print(f"  {sym}: last {r['lastPrice']} mark {r['markPrice']} OKX mark {ok} gap {gap if gap is None else round(gap, 2)} bp,"
              f" settlementRate {r['settlementRate']} interval {r['fundingIntervalHours']}")


def section_polls():
    print("== 6. Fifteen polls 2 s apart")
    prev, changes, n = {}, collections.Counter(), 0
    t0 = time.time()
    for i in range(15):
        st, hd, body, ms = get(SITE + "/v1/cfd/public/instruments")
        if st != 200:
            print("poll", i, st, head(body))
            continue
        n += 1
        rows = {x["symbol"]: x for x in json.loads(body)["data"] if x["status"] == "online"}
        for sym in ("btcusdt", "ethusdt", "dogeusdt"):
            for f in ("lastPrice", "markPrice", "settlementRate", "settledAt"):
                v = rows[sym][f]
                if (sym, f) in prev and prev[(sym, f)] != v:
                    changes[(sym, f)] += 1
                prev[(sym, f)] = v
        time.sleep(2)
    print(f"{n} polls over {time.time() - t0:.0f} s")
    for sym in ("btcusdt", "ethusdt", "dogeusdt"):
        print(" ", sym, {f: changes[(sym, f)] for f in ("lastPrice", "markPrice", "settlementRate", "settledAt")})


def section_spot():
    print("== 7. Spot and book paths")
    st, hd, body, ms = get(SITE + "/v1/cfd/public/spot_instruments")
    data = json.loads(body)["data"]
    print(f"spot_instruments: {st} {len(body)} bytes {ms:.0f} ms, rows {len(data)}, status {collections.Counter(x['status'] for x in data)}")
    print("  symbols:", [x["symbol"] for x in data])
    for p in ("/v1/cfd/public/depth?symbol=btcusdt", "/v1/cfd/public/orderbook?symbol=btcusdt", "/v1/spot/public/products"):
        st, hd, body, ms = get(SITE + p)
        print(f"{p}: {st} {head(body, 120)}")


def section_errors():
    print("== 8. Errors, limits, time")
    for p in ("/v1/cfd/public/nope", "/v1/users/profile"):
        st, hd, body, ms = get(SITE + p)
        print(f"{p}: {st} {head(body, 160)}")
    st, hd, body, ms = get(SITE + "/v1/cfd/public/instruments")
    lim = {k: v for k, v in hd.items() if any(t in k.lower() for t in ("limit", "retry", "remaining"))}
    print("limit headers:", lim or "none")
    print("headers:", {k: v for k, v in hd.items() if k.lower() in ("server", "x-envoy-upstream-service-time", "x-via", "cache-control")})
    d = hd.get("Date") or hd.get("date")
    if d:
        print("Date header offset s:", round(email.utils.parsedate_to_datetime(d).timestamp() - time.time(), 1))


def section_dex():
    print("== 9. Namesake SunX DEX, api.sunx.io")
    st, hd, body, ms = get(DEX + "/sapi/v1/public/contract_info")
    d = json.loads(body)["data"]
    print(f"contract_info: {st} {len(body)} bytes {ms:.0f} ms rows {len(d)} status {collections.Counter(x['contract_status'] for x in d)}"
          f" type {collections.Counter(x['contract_type'] for x in d)} partition {collections.Counter(x['trade_partition'] for x in d)}"
          f" settlement_period {collections.Counter(x['settlement_period'] for x in d)}")
    for p in ("/sapi/v1/public/index", "/sapi/v1/public/batch_funding_rate", "/sapi/v1/market/bbo"):
        st, hd, body, ms = get(DEX + p)
        j = json.loads(body)
        rows = j.get("data") or j.get("ticks") or []
        print(f"{p}: {st} {len(body)} bytes {ms:.0f} ms rows {len(rows)} first {json.dumps(rows[0])[:220] if rows else head(body)}")
    for p in ("/sapi/v1/public/funding_rate", "/sapi/v1/public/funding_rate?contract_code=BTC-USDT",
              "/sapi/v1/index/market/history/linear_swap_mark_price_kline?contract_code=BTC-USDT&period=1min&size=1",
              "/sapi/v1/market/depth?contract_code=BTC-USDT&type=step6", "/sapi/v1/public/timestamp"):
        st, hd, body, ms = get(DEX + p)
        print(f"{p}: {st} {ms:.0f} ms {head(body, 260)}")
    d = hd.get("Date") or hd.get("date")
    if d:
        print("Date header offset s:", round(email.utils.parsedate_to_datetime(d).timestamp() - time.time(), 1))


def section_ccxt():
    print("== 10. CCXT")
    try:
        ids = sorted(f[:-3] for f in os.listdir(CCXT_DIR) if f.endswith(".js"))
        print(f"4.5.68 files: {len(ids)}, matching sun or swk: {[i for i in ids if 'sun' in i or 'swk' in i]}, htx present: {'htx' in ids}")
    except OSError as e:
        print("4.5.68 not readable:", e)
    st, hd, body, ms = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master")
    names = [x["name"] for x in json.loads(body)] if st == 200 else []
    print(f"GitHub master ts/src: {st}, {len(names)} entries, matching sun: {[n for n in names if 'sun' in n.lower()]}")


if __name__ == "__main__":
    section_cmc()
    section_dns()
    section_bundle()
    on = section_catalog()
    section_anchor(on)
    section_polls()
    section_spot()
    section_errors()
    section_dex()
    section_ccxt()
