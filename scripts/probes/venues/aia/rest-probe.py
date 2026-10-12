# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""AIA Exchange REST probe for docs/profiles/aia/rest.md.

Public, unauthenticated and read-only, about 45 requests over about 80 seconds.
  1. DNS for the CoinMarketCap name, the live site and the hosts its bundle names.
  2. The parked aiaexchange.com and the live aianalysisexchange.com home page.
  3. The tenant config the live bundle selects, and the public REST paths it names.
  4. The perpetual catalog /v1/cfd/public/instruments, cold and warm, with counts and field values.
  5. The anchor fields: markPrice, settledAt, settlementRate, the funding countdown, and OKX marks beside them.
  6. Twenty polls of the catalog 3 s apart, counting how often each anchor field changes.
  7. The spot catalog /v1/cfd/public/spot_instruments and the spot paths the bundle names.
  8. Error shapes, rate limit headers and the Date header offset.
Run from the repository root with: uv run scripts/probes/venues/aia/rest-probe.py
"""

import collections
import email.utils
import json
import re
import socket
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html, */*"}
SITE = "https://aianalysisexchange.com"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), (time.perf_counter() - t0) * 1000, r.url
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000, url
    except Exception as e:  # DNS failure, TLS error, timeout
        return None, {}, f"{type(e).__name__}: {e}".encode(), (time.perf_counter() - t0) * 1000, url


def head(body, n=200):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def section_dns():
    print("== 1. DNS")
    for h in ("aiaexchange.com", "www.aiaexchange.com", "aianalysisexchange.com", "www.aianalysisexchange.com",
              "api.aianalysisexchange.com", "ws.aianalysisexchange.com", "m.aianalysisexchange.com",
              "www.cryptoex.aianalysis.co.uk", "aianalysis.co.uk"):
        try:
            print(f"{h}: {sorted(set(a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)))}")
        except OSError as e:
            print(f"{h}: {e}")


def section_sites():
    print("== 2. Sites")
    for url in ("https://www.aiaexchange.com/", "https://aiaexchange.com/", SITE + "/", "https://www.aianalysisexchange.com/",
                "https://api.aianalysisexchange.com/", "https://m.aianalysisexchange.com/", "https://www.cryptoex.aianalysis.co.uk/"):
        req = urllib.request.Request(url, headers=UA)
        opener = urllib.request.build_opener(NoRedirect)
        t0 = time.perf_counter()
        try:
            r = opener.open(req, timeout=20)
            st, hd, body = r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            st, hd, body = e.code, dict(e.headers), e.read()
        except Exception as e:
            st, hd, body = None, {}, f"{type(e).__name__}: {e}".encode()
        ms = (time.perf_counter() - t0) * 1000
        print(f"{url}: {st} {ms:.0f} ms server={hd.get('Server') or hd.get('server')} location={hd.get('Location') or hd.get('location')} body={head(body, 120)!r}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def section_bundle():
    print("== 3. Bundle and tenant config")
    st, hd, body, ms, _ = get(SITE + "/")
    html = body.decode("utf-8", "replace")
    title = re.search(r'name="description"\s+content="([^"]+)"', html)
    print(f"home {st}, {len(body)} bytes, description: {title.group(1) if title else None}")
    scripts = re.findall(r'src="([^"]+\.js)"', html)
    print("scripts:", scripts)
    app = next((s for s in scripts if s.startswith("app.")), None)
    st, hd, js, ms, _ = get(f"{SITE}/{app}", timeout=60)
    s = js.decode("utf-8", "replace")
    print(f"{app}: {st}, {len(js)} bytes")
    m = re.search(r'_\.default=(\w+)\.a\}\}\);\s*//# sourceMappingURL', s)
    var = m.group(1) if m else None
    tail = s[max(0, m.start() - 3000):m.start()] if m else ""
    mods = re.findall(r'var ' + var + r'=e\((\d+)\)', tail) if var else []
    mod = re.match(r'(\d+)', mods[-1]) if mods else None
    print("default config module:", mod.group(1) if mod else None)
    if mod:
        start = s.find(f",{mod.group(1)}:function(a,_,e)")
        nxt = re.compile(r'\},\d+:function\(a,_,e\)').search(s, start + 10)
        seg = s[start:nxt.start() if nxt else start + 6000]
        prod = re.search(r'production:\{exId:"([^"]+)",ws:"([^"]+)",oldws:"([^"]+)",host:"([^"]+)"\}', seg)
        print("production config:", prod.groups() if prod else None)
        print("tenant images:", sorted(set(re.findall(r'invate/([^/"]+)/', seg))))
    print("tenants named by app download links:", sorted(set(re.findall(r'https://([A-Za-z0-9]+)-prod\.oss-accelerate', s))))
    print("hyp_tiny_saas string keys:", s.count("hyp_tiny_saas_"))
    for key in ("chartArea_settlementRate", "chartArea_settlementDate", "funding_rate_countdown", "fee_fx"):
        vals = re.findall(r'hyp_tiny_saas_' + key + r':"([^"]+)"', s)
        print(f"English label of {key}:", [v for v in vals if v.isascii() and " " in v or v.isascii() and v[:1].isupper()][:3])
    paths = sorted(set(re.findall(r'"(/v1/[a-z]+/public/[A-Za-z0-9/_.-]*)"', s)))
    print("public REST paths:", paths)
    print("REST book or depth path present:", bool(re.search(r'"/v1/[a-z]+/[A-Za-z/_]*(depth|orderbook|orderBook)[A-Za-z/_]*"', s)))
    for k in ("takerFee", "makerFee", "commissionRate"):
        print(f"bundle reads {k}:", k in s)
    print("socket picks host from: localStorage ws, an mzd5 service value, or config ws:",
          'localStorage.getItem("ws")' in s, "mzd5" in s, "i.default.ws" in s)
    print("SERVICES.LOAD_SUCCESS dispatched anywhere:", len(re.findall(r'Services\.loadSuccess', s)))
    return s


def section_catalog():
    print("== 4. Perpetual catalog")
    url = SITE + "/v1/cfd/public/instruments"
    for label in ("cold", "warm", "warm"):
        st, hd, body, ms, _ = get(url)
        print(f"{label}: {st} {len(body)} bytes {ms:.0f} ms content-type={hd.get('Content-Type')}")
    env = json.loads(body)
    data = env["data"]
    print("envelope keys:", sorted(env.keys()), "code", env.get("code"))
    print("rows:", len(data), "status:", collections.Counter(x["status"] for x in data))
    on = [x for x in data if x["status"] == "online"]
    print("online symbols:", [x["symbol"] for x in on])
    print("quote:", collections.Counter(x["quote"] for x in data), "margin:", collections.Counter(json.dumps(x["marginCurrencyList"]) for x in on))
    for k in ("takerFee", "makerFee", "commissionRate", "openSpread", "closeSpread", "settlementRate", "fundingIntervalHours",
              "settledAt", "oneLotSize", "minSize", "maxLeverage", "currencyType", "gridStatus"):
        print(f"  {k}:", collections.Counter(x[k] for x in on).most_common(8))
    print("  4 h funding symbols:", [x["symbol"] for x in on if x["fundingIntervalHours"] == 4])
    print("  commissionRate 0.0008 symbols:", [x["symbol"] for x in on if x["commissionRate"] == 0.0008])
    print("  oneLotSize by symbol:", {x["symbol"]: x["oneLotSize"] for x in on})
    print("  non-crypto rows:", [(x["symbol"], x["status"], x["fullName"]) for x in data if x["symbol"] in ("xauusdt", "xagusdt")])
    btc = next(x for x in data if x["symbol"] == "btcusdt")
    print("  btcusdt row:", json.dumps(btc, ensure_ascii=True))
    return on


def okx_mark(inst):
    st, hd, body, ms, _ = get(f"https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId={inst}")
    try:
        return float(json.loads(body)["data"][0]["markPx"])
    except Exception:
        return f"{st} {head(body, 80)}"


def section_anchor(on):
    print("== 5. Anchor fields")
    now = time.time()
    st, hd, body, ms, _ = get(SITE + "/v1/cfd/public/funding/countdown")
    print(f"countdown: {st} {head(body)} {ms:.0f} ms, host clock {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now))} UTC")
    try:
        cd = json.loads(body)["data"]
        print("  countdown points to", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(now + cd)), "UTC")
    except Exception:
        pass
    for sym in ("btc", "btcusdt", "pump"):
        st, hd, body, ms, _ = get(SITE + "/v1/cfd/public/funding/countdown/" + sym)
        print(f"countdown/{sym}: {st} {head(body)}")
    sa = on[0]["settledAt"] / 1000
    print("settledAt:", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(sa)), "UTC, seconds ahead:", round(sa - now))
    st, hd, body, ms, _ = get(SITE + "/v1/cfd/public/instruments")
    rows = {x["symbol"]: x for x in json.loads(body)["data"]}
    for sym, inst in (("btcusdt", "BTC-USDT-SWAP"), ("ethusdt", "ETH-USDT-SWAP"), ("solusdt", "SOL-USDT-SWAP")):
        r = rows[sym]
        ok = okx_mark(inst)
        gap = (r["markPrice"] / ok - 1) * 1e4 if isinstance(ok, float) else None
        print(f"  {sym}: last {r['lastPrice']} mark {r['markPrice']} OKX mark {ok} gap {gap if gap is None else round(gap, 2)} bp")


def section_polls():
    print("== 6. Twenty polls 3 s apart")
    prev, changes, n = {}, collections.Counter(), 0
    t0 = time.time()
    for i in range(20):
        st, hd, body, ms, _ = get(SITE + "/v1/cfd/public/instruments")
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
        time.sleep(3)
    print(f"{n} polls over {time.time() - t0:.0f} s")
    for sym in ("btcusdt", "ethusdt", "dogeusdt"):
        print(" ", sym, {f: changes[(sym, f)] for f in ("lastPrice", "markPrice", "settlementRate", "settledAt")})


def section_spot():
    print("== 7. Spot")
    st, hd, body, ms, _ = get(SITE + "/v1/cfd/public/spot_instruments")
    data = json.loads(body)["data"]
    print(f"spot_instruments: {st} {len(body)} bytes {ms:.0f} ms, rows {len(data)}, status {collections.Counter(x['status'] for x in data)}")
    print("  symbols:", [x["symbol"] for x in data])
    print("  takerFee:", collections.Counter(x["takerFee"] for x in data), "makerFee:", collections.Counter(x["makerFee"] for x in data))
    print("  isTrade:", collections.Counter(x["isTrade"] for x in data), "symbolType:", collections.Counter(x["symbolType"] for x in data))
    for p in ("/v1/spot/public/products", "/v1/spot/public/tickers"):
        st, hd, body, ms, _ = get(SITE + p)
        print(f"{p}: {st} {head(body)}")
    st, hd, body, ms, _ = get(SITE + "/v1/asset/public/biz-currencies")
    print("biz-currencies groups:", sorted(json.loads(body)["data"].keys()) if st == 200 else (st, head(body)))
    for p in ("/v1/cfd/public/option/instruments", "/v1/cfd/public/ratesTest"):
        st, hd, body, ms, _ = get(SITE + p)
        print(f"{p}: {st} {head(body)}")


def section_errors():
    print("== 8. Errors, limits, time")
    for p in ("/v1/cfd/public/nope", "/v1/asset/public/exchange/rate", "/v1/users/profile"):
        st, hd, body, ms, _ = get(SITE + p)
        print(f"{p}: {st} {head(body)}")
    st, hd, body, ms, _ = get(SITE + "/v1/cfd/public/instruments")
    lim = {k: v for k, v in hd.items() if any(t in k.lower() for t in ("limit", "retry", "remaining"))}
    print("limit headers:", lim or "none")
    print("headers:", {k: v for k, v in hd.items() if k.lower() in ("server", "x-envoy-upstream-service-time", "x-ws-request-id", "x-via", "cache-control")})
    d = hd.get("Date") or hd.get("date")
    if d:
        print("Date header offset s:", round(email.utils.parsedate_to_datetime(d).timestamp() - time.time(), 1))


if __name__ == "__main__":
    section_dns()
    section_sites()
    section_bundle()
    on = section_catalog()
    section_anchor(on)
    section_polls()
    section_spot()
    section_errors()
