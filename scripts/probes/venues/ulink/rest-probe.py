# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Ulink (ulinkex.com) REST probe for docs/profiles/ulink/rest.md.

Public, unauthenticated and read-only, about 50 requests over about 60 seconds.
  1. Which venue CoinMarketCap ranks 218 as Ulink: its exchange listing, detail and market pairs.
  2. DNS for the live site, the hosts its bundle names, and its help center.
  3. The home page, and the default tenant config and REST paths in the live bundle.
  4. The perpetual catalog /v1/cfd/public/instruments, cold and warm, with counts and field values.
  5. The anchor fields: markPrice, settledAt, settlementRate, the funding countdown, and OKX marks beside them.
  6. Fifteen polls of the catalog 2 s apart, counting how often each anchor field changes.
  7. The spot catalog and ticker calls, and REST book paths.
  8. Error shapes, rate limit headers and the Date header offset.
  9. CCXT: the installed 4.5.68 class list and the current master on GitHub.
Run from the repository root with: uv run scripts/probes/venues/ulink/rest-probe.py
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
SITE = "https://ulinkex.com"
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
    for ex_type in (0, 1):
        st, hd, body, ms = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType={ex_type}&start=1&limit=300")
        rows = json.loads(body)["data"]["exchanges"] if st == 200 else []
        for i, e in enumerate(rows, 1):
            if "ulink" in e["slug"] or "ulink" in e["name"].lower():
                print(f"listing exType={ex_type} position {i} of {len(rows)}: id {e['id']} {e['name']} slug {e['slug']} score {e.get('score')}"
                      f" spotVol24h {e.get('spotVol24h')} derivativesVol24h {e.get('derivativesVol24h')} derivativesMarketPairs {e.get('derivativesMarketPairs')}"
                      f" makerFee {e.get('makerFee')} takerFee {e.get('takerFee')}")
    st, hd, body, ms = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=ulink")
    d = json.loads(body).get("data", {}) if st == 200 else {}
    print(f"detail ulink: id {d.get('id')} website {d.get('urls', {}).get('website')} fee page {d.get('urls', {}).get('fee')}"
          f" launched {d.get('dateLaunched')} makerFee {d.get('makerFee')} takerFee {d.get('takerFee')}")
    for cat in ("perpetual", "spot"):
        st, hd, body, ms = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=ulink&category={cat}&start=1&limit=100")
        d = json.loads(body).get("data", {}) if st == 200 else {}
        mp = d.get("marketPairs", [])
        print(f"  {cat}: numMarketPairs {d.get('numMarketPairs')}, first 100 priceExcluded {collections.Counter(m.get('priceExcluded') for m in mp)}"
              f" volumeExcluded {collections.Counter(m.get('volumeExcluded') for m in mp)}")


def section_dns():
    print("== 2. DNS")
    for h in ("ulinkex.com", "www.ulinkex.com", "api.ulinkex.com", "ws.ulinkex.com", "www.yyy23hjkk.com", "www.rmex.vip",
              "ulinkinc.zendesk.com"):
        try:
            print(f"{h}: {sorted(set(a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)))}")
        except OSError as e:
            print(f"{h}: {e}")


def section_bundle():
    print("== 3. Sites and bundle")
    for url in (SITE + "/", "https://www.ulinkex.com/", "https://www.yyy23hjkk.com/", "https://www.rmex.vip/", "https://ulinkinc.zendesk.com/hc/en-us"):
        st, hd, body, ms = get(url, timeout=12)
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
    # Module 7 exports module 696 as the default config, and 696 is the Ulink config.
    m7 = s.find(",7:function(e,t,n){")
    print("module 7 imports 696 as its default:", re.search(r"var r=n\(696\)", s[m7:m7 + 200]) is not None,
          "and ends with t.default=r.a:", "t.default=r.a}" in s[m7:m7 + 20000])
    m696 = s.find(",696:function(e,t,n){")
    seg = s[m696:s.find(",697:function(e,t,n){")]
    print("module 696 brand:", re.findall(r'brand:"([^"]+)"', seg)[:2], "host:", re.findall(r'host:"([^"]+)"', seg)[:3])
    print("module 696 env object:", re.findall(r'\{exId:"[^"]+",ws:"[^"]*",oldws:"[^"]*",host:"[^"]*"[^}]*\}', seg))
    print("every config with brand Ulink, exId:", [re.search(r'exId:"([^"]+)"', s[x.start() - 400:x.start() + 20]).group(1)
                                                    for x in re.finditer(r'brand:"Ulink"', s)])
    print("socket path builders:", sorted(set(re.findall(r'"wss://"\.concat\(\w,"(/v1/[a-z]+/ws)"\)', s))))
    print("desktop socket lookup:", re.findall(r'"(plugin:tinytrader-view\|get_socket_base_url)"', s)[:1])
    print("channel suffixes:", sorted(set(re.findall(r'"(_(?:depth_step0|depth_level|funding_rate|index_price|mark_price|trade_ticker))"', s))))
    print("perpetual book subscribe:", re.search(r'channel:"market_"\.concat\(Ti,"\."\)\.concat\(e,"_depth_level"\)\.concat\(t\)', s) is not None)
    paths = sorted(set(re.findall(r'"(/v1/[a-z]+/public/[A-Za-z0-9/_.-]*)"', s)))
    print("public REST paths:", paths)
    print("REST book or depth path present:", bool(re.search(r'"/v1/[a-z]+/[A-Za-z/_]*(depth|orderbook|orderBook)[A-Za-z/_]*"', s)))
    for k in ("takerFee", "makerFee", "commissionRate", "openSpread", "settlementRate"):
        print(f"bundle reads {k}:", k in s)


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
              "settledAt", "oneLotSize", "minSize", "maxLeverage", "orderBookLevel", "currencyType"):
        print(f"  {k}:", collections.Counter(json.dumps(x[k]) for x in on).most_common(8))
    print("  rows whose fees differ:", [(x["symbol"], x["takerFee"], x["makerFee"]) for x in on if x["takerFee"] != 0.0004])
    names = {x["symbol"]: x["fullName"] for x in on}
    print("  non-crypto rows:", [(k, v) for k, v in names.items() if k[:-4] in ("xau", "xag", "nvda", "tsla", "aapl", "spx", "wti", "eur")])
    btc = next(x for x in data if x["symbol"] == "btcusdt")
    print("  btcusdt row:", json.dumps({k: v for k, v in btc.items() if k != "configBo"}, ensure_ascii=True))
    st, hd, body, ms = get("https://www.yyy23hjkk.com/v1/cfd/public/instruments")
    print(f"same call on the config host www.yyy23hjkk.com: {st} {len(body)} bytes rows {len(json.loads(body)['data']) if st == 200 else head(body, 80)}")
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
    st, hd, body, ms = get(SITE + "/v1/cfd/public/ratesTest")
    print(f"ratesTest: {st} {head(body, 160)}")
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
    print(f"spot_instruments: {st} {len(body)} bytes {ms:.0f} ms, rows {len(data)}, status {collections.Counter(x.get('status') for x in data)}")
    print("  symbols:", [x["symbol"] for x in data])
    print("  fee-like fields:", {k: collections.Counter(json.dumps(x.get(k)) for x in data).most_common(3) for k in sorted(data[0]) if "ee" in k.lower() or "rate" in k.lower()})
    for p in ("/v1/spot/public/products", "/v1/spot/public/tickers", "/v1/cfd/public/option/instruments",
              "/v1/cfd/public/depth?symbol=btcusdt", "/v1/cfd/public/orderbook?symbol=btcusdt"):
        st, hd, body, ms = get(SITE + p)
        print(f"{p}: {st} {len(body)} bytes {head(body, 160)}")


def section_errors():
    print("== 8. Errors, limits, time")
    for p in ("/v1/cfd/public/nope", "/v1/users/profile"):
        st, hd, body, ms = get(SITE + p)
        print(f"{p}: {st} {head(body, 160)}")
    st, hd, body, ms = get(SITE + "/v1/cfd/public/instruments")
    lim = {k: v for k, v in hd.items() if any(t in k.lower() for t in ("limit", "retry", "remaining"))}
    print("limit headers:", lim or "none")
    print("headers:", {k: v for k, v in hd.items() if k.lower() in ("server", "x-envoy-upstream-service-time", "x-via", "cache-control", "via")})
    d = hd.get("Date") or hd.get("date")
    if d:
        print("Date header offset s:", round(email.utils.parsedate_to_datetime(d).timestamp() - time.time(), 1))


def section_ccxt():
    print("== 9. CCXT")
    try:
        ids = sorted(f[:-3] for f in os.listdir(CCXT_DIR) if f.endswith(".js"))
        print(f"4.5.68 files: {len(ids)}, matching ulink or rmex: {[i for i in ids if 'ulink' in i or 'rmex' in i]}")
    except OSError as e:
        print("4.5.68 not readable:", e)
    st, hd, body, ms = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master")
    names = [x["name"] for x in json.loads(body)] if st == 200 else []
    print(f"GitHub API master ts/src: {st}, {len(names)} entries, matching ulink or rmex: {[n for n in names if 'ulink' in n.lower() or 'rmex' in n.lower()]}")
    # The unauthenticated GitHub API is often rate limited, so the raw master files are read as well.
    st, hd, body, ms = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body)["ids"] if st == 200 else []
    print(f"raw master exchanges.json: {st}, {len(ids)} ids, matching ulink or rmex: {[i for i in ids if 'ulink' in i or 'rmex' in i]}, gate present: {'gate' in ids}")
    for name in ("ulink", "gate"):
        st, hd, body, ms = get(f"https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/{name}.ts")
        print(f"raw master ts/src/{name}.ts: {st}")


if __name__ == "__main__":
    section_cmc()
    section_dns()
    section_bundle()
    on = section_catalog()
    section_anchor(on)
    section_polls()
    section_spot()
    section_errors()
    section_ccxt()
