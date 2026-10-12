# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""TRIV public web backend probe, read-only and unauthenticated.

TRIV publishes no API documentation, so every call here is one the web app at https://triv.co.id makes from a logged-out page.
The probe never calls the web app's CFX auth call /futures/<symbol>/cfx/private/auth, because its reply is a signed credential.

Run from the repository root: uv run scripts/probes/venues/triv/rest-probe.py
It makes about 30 requests over about a minute and holds no socket.
"""

import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.request

SITE = "https://triv.co.id"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get(url, accept="application/json", follow=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, "X-Requested-With": "XMLHttpRequest"})
    handlers = [urllib.request.HTTPSHandler(context=ssl.create_default_context())]
    if not follow:
        handlers.append(NoRedirect())
    t0 = time.perf_counter()
    try:
        with urllib.request.build_opener(*handlers).open(req, timeout=30) as r:
            body = r.read()
            return r.status, dict(r.headers), body, time.perf_counter() - t0, r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), time.perf_counter() - t0, url
    except Exception as e:
        return None, {}, repr(e).encode(), time.perf_counter() - t0, url


def section(name):
    print(f"\n## {name}")


def site_access():
    section("Site access")
    for host in ["triv.co.id", "www.triv.co.id", "triv.id", "help.triv.id", "api.triv.co.id", "ws-exchange.cfx.co.id", "api-exchange.cfx.co.id", "api.cfx.co.id"]:
        try:
            addr = socket.gethostbyname(host)
        except OSError as e:
            print(f"{host}: DNS failed, {e}")
            continue
        status, headers, body, dt, final = get(f"https://{host}/", accept="text/html")
        snippet = body[:160].decode("utf8", "replace").replace("\n", " ")
        print(f"{host}: {addr} status {status} in {dt:.2f} s, final {final}, server {headers.get('Server')}, X-CDN {headers.get('X-CDN')}, body {snippet!r}")


def latency():
    section("Latency")
    url = f"{SITE}/api/v1/perpetuals/udf_market/time"
    for i in range(4):
        status, _, body, dt, _ = get(url)
        print(f"request {i}: status {status} in {dt * 1000:.0f} ms, body {body.decode()!r}")


def futures_page():
    section("Futures page")
    status, _, body, dt, _ = get(f"{SITE}/en/futures/BTCUSDT-PERP", accept="text/html")
    page = body.decode("utf8", "replace")
    print(f"status {status}, {len(body)} bytes in {dt:.2f} s")
    for key in ["ws_endpoint", "ws_url", "udf_market_base_url", "market_futures_pair", "rate_adjustments", "market_config", "current_user"]:
        m = re.search(r"gon\." + key + r"=(.*?);gon\.", page)
        print(f"gon.{key} = {m.group(1)[:200] if m else None}")
    start = page.find("gon.active_market_futures=")
    markets = json.JSONDecoder().raw_decode(page[start + len("gon.active_market_futures="):])[0]
    rows = markets["as_usdt_currency"]
    pairs = sorted({r["pair"] for r in rows})
    print(f"active perpetuals: {len(markets['as_futures_currency'])} symbols, {len(rows)} detail rows, pairs {pairs}")
    print("symbols:", " ".join(markets["as_futures_currency"]))
    print("detail row keys:", sorted(rows[0].keys()))
    print("BTC row:", next(r for r in rows if r["symbol"] == "BTCUSDT-PERP"))
    print("basePrecision values:", sorted({r["basePrecision"] for r in rows}), "quotePrecision values:", sorted({r["quotePrecision"] for r in rows}))
    for word in ["COIN-M", "USDC", "Delivery", "Quarterly"]:
        print(f"page mentions {word!r}: {page.count(word)} times")
    assets = re.findall(r'src="(/assets/[^"]+\.js)"', page)
    return markets["as_futures_currency"], assets


def funding_schedule(assets):
    section("Funding countdown in the web app")
    path = next((a for a in assets if "/futures/settings-" in a), None)
    if not path:
        print("settings script not found")
        return
    status, _, body, _, _ = get(SITE + path, accept="*/*")
    js = body.decode("utf8", "replace")
    m = re.search(r"function updateFCountdown\(\)\{.*?setHours\(7,0,0\);\}", js, re.S)
    print(f"{path} status {status}")
    print(m.group(0) if m else "updateFCountdown not found")
    for name in ["centrifuge-connect", "mark_price", "order_books", "all_ticker_24h"]:
        p = next((a for a in assets if f"/{name}-" in a and ("perpetuals" in a or "futures" in a)), None)
        if not p:
            continue
        status, _, body, _, _ = get(SITE + p, accept="*/*")
        js = body.decode("utf8", "replace")
        print(f"{p} status {status}, channels {sorted(set(re.findall(r'newSubscription\(([^)]*)\)', js)))}, rpc {sorted(set(re.findall(r'rpc\(([^,]*)', js)))}")
        if name == "order_books":
            m = re.search(r"random=\(Math\.random\(\)[^\n]*", js)
            print("display noise:", m.group(0)[:160] if m else "not found")


def settings_calls(symbols):
    section("Per symbol settings call")
    for sym in ["BTCUSDT-PERP", "ETHUSDT-PERP", "SOLUSDT-PERP", "NOPEUSDT-PERP"]:
        status, headers, body, dt, _ = get(f"{SITE}/futures/{sym}/settings", follow=False)
        try:
            d = json.loads(body)
            ob = d.get("orderbooks", {})
            trades = d.get("trades", [])
            first = trades[0] if trades else None
            stamps = [t["timestamp"] for t in trades]
            newest_age_h = (time.time() * 1000 - max(stamps)) / 3.6e6 if stamps else None
            print(f"{sym}: status {status}, {len(body)} bytes in {dt * 1000:.0f} ms, bids {len(ob.get('bids', []))}, asks {len(ob.get('asks', []))}, trades {len(trades)}, ascending {stamps == sorted(stamps)}, newest trade {newest_age_h:.1f} h old, first {first}")
        except ValueError:
            print(f"{sym}: status {status}, type {headers.get('Content-Type')}, Location {headers.get('Location')}, body {body[:200]!r}")
        time.sleep(0.5)


def udf_calls():
    section("UDF chart calls")
    base = f"{SITE}/api/v1/perpetuals/udf_market"
    now = int(time.time())
    for path in ["/config", "/symbols?symbol=BTCUSDT-PERP", "/time", f"/history?symbol=BTCUSDT-PERP&resolution=1&from={now - 600}&to={now}"]:
        status, headers, body, dt, _ = get(base + path)
        print(f"{path}: status {status} in {dt * 1000:.0f} ms, {len(body)} bytes, {body[:400].decode('utf8', 'replace')!r}")
        if path == "/time" and status == 200:
            print(f"clock offset, server minus local: {int(body) - int(time.time())} s, at second resolution")
        time.sleep(0.5)


def spot_calls():
    section("Spot side")
    status, _, body, _, _ = get(f"{SITE}/id/markets/BTC_IDR", accept="text/html")
    page = body.decode("utf8", "replace")
    for key in ["selected_coin_market", "market_pair", "rate_adjustments", "k"]:
        m = re.search(r"gon\." + key + r"=(.*?);gon\.", page)
        print(f"gon.{key} = {m.group(1)[:120] if m else None}")
    m = re.search(r"gon\.k=\"?([^\";]*)", page)
    k = m.group(1) if m else ""
    status, _, body, dt, _ = get(f"{SITE}/markets/BTC_IDR/settings?k={k}")
    print(f"/markets/BTC_IDR/settings: status {status} in {dt * 1000:.0f} ms, {body[:600].decode('utf8', 'replace')!r}")
    status, _, body, dt, _ = get(f"{SITE}/api/v1/udf_market_idr/symbols?symbol=BTC_IDR")
    print(f"/api/v1/udf_market_idr/symbols: status {status} in {dt * 1000:.0f} ms, {body[:300].decode('utf8', 'replace')!r}")


def coinmarketcap():
    section("CoinMarketCap listing")
    for category in ["perpetual", "spot"]:
        url = f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=triv&category={category}&start=1&limit=10"
        status, _, body, _, _ = get(url)
        try:
            data = json.loads(body).get("data", {})
            print(f"{category}: status {status}, numMarketPairs {data.get('numMarketPairs')}, first pairs {[p['marketPair'] for p in data.get('marketPairs', [])][:6]}")
        except ValueError:
            print(f"{category}: status {status}, body {body[:200]!r}")


def main():
    print(f"TRIV rest probe at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    site_access()
    latency()
    symbols, assets = futures_page()
    funding_schedule(assets)
    settings_calls(symbols)
    udf_calls()
    spot_calls()
    coinmarketcap()


if __name__ == "__main__":
    main()
