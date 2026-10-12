# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""BlueBit public fee probe for docs/profiles/bluebit/fees.md.

Reads the fee table the website's own fee page loads, the per-symbol fee field in the
website config, and the futures fee call that page also makes.
Read-only and unauthenticated, four venue requests one second apart, plus the CoinMarketCap page, the CoinGecko derivatives list and two GitHub API reads.
Run from the repository root with: uv run scripts/probes/venues/bluebit/fees-probe.py
"""

import collections
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Content-Type": "application/json"}


def call(method: str, url: str):
    req = urllib.request.Request(url, method=method, data=b"{}" if method == "POST" else None, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status, body = resp.status, resp.read()
    except urllib.error.HTTPError as err:
        status, body = err.code, err.read()
    dt = time.perf_counter() - t0
    time.sleep(1.0)
    text = body.decode("utf-8", "replace")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = None
    return status, text, data, dt


def ppm(rate) -> int:
    return round(float(rate) * 1_000_000)


def main() -> None:
    print("== POST https://www.bluebit.io/fe-ex-api/fee_info (the fee page table)")
    status, text, data, dt = call("POST", "https://www.bluebit.io/fe-ex-api/fee_info")
    print(f"status {status}, {len(text)} bytes, {dt * 1000:.0f} ms, code {data and data.get('code')}")
    pairs = data["data"]["pairMapList"]
    keys = collections.Counter(k for p in pairs for k in p)
    print(f"pairs listed: {len(pairs)}")
    print(f"keys seen across pairs: {dict(keys)}")
    vip_keys = sorted(k for k in keys if "VIP" in k)
    print(f"VIP keys: {vip_keys}")
    combos = collections.Counter(
        (ppm(p["TRADE_MAKER_VIP0"]) if "TRADE_MAKER_VIP0" in p else None,
         ppm(p["TRADE_TAKER_VIP0"]) if "TRADE_TAKER_VIP0" in p else None)
        for p in pairs
    )
    print("(maker ppm, taker ppm) to pair count:", dict(combos))
    by_symbol = {p["symbol"]: p for p in pairs}
    for sym in ("btcusdt", "ethusdt", "bluesparrowusdt", "bluesparrowbtc", "bluesparroweth", "usdcusdt"):
        print(f"  {sym}: {by_symbol.get(sym)}")
    odd = [p["symbol"] for p in pairs if "TRADE_TAKER_VIP0" not in p or ppm(p["TRADE_TAKER_VIP0"]) != 1000]
    print(f"pairs whose taker is not 1000 ppm or is absent: {odd}")
    print(f"pairs with no fee keys: {[p['symbol'] for p in pairs if 'TRADE_TAKER_VIP0' not in p]}")

    print("\n== GET https://www.bluebit.io/fePublicInfo (quoteFeeRate per live symbol)")
    status, text, _, dt = call("GET", "https://www.bluebit.io/fePublicInfo")
    info = json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))
    live = {d["symbol"]: d for q in info["market"]["market"].values() for d in q.values()}
    print(f"status {status}, {len(text)} bytes, live symbols {len(live)}")
    for sym, d in live.items():
        fee = by_symbol.get(sym, {})
        print(f"  {sym}: quoteFeeRate {d.get('quoteFeeRate')}, fee_info taker {fee.get('TRADE_TAKER_VIP0')}, maker {fee.get('TRADE_MAKER_VIP0')}")
    print(f"futures_type {info.get('futures_type')}, futures URL {info['url'].get('coUrl')}")
    sw = info["switch"]
    print(f"switch lever_open {sw.get('lever_open')!r}, is_invite_open {sw.get('is_invite_open')!r}, agentUserOpen {sw.get('agentUserOpen')!r}, limitCountryList {info.get('limitCountryList')!r}")
    print(f"symbols with is_open_lever 1: {[s for s, d in live.items() if d.get('is_open_lever') == 1]}")

    print("\n== POST https://www.bluebit.io/fe-ex-api/common/public_info (contract switch)")
    status, text, data, dt = call("POST", "https://www.bluebit.io/fe-ex-api/common/public_info")
    d = data["data"]
    print(f"status {status}, contractOpen {d.get('contractOpen')!r}, indep_co_switch {d.get('indep_co_switch')!r}, exOpen {d.get('exOpen')!r}, otcOpen {d.get('otcOpen')!r}, is_invite_open {d.get('is_invite_open')!r}, agentUserOpen {d.get('agentUserOpen')!r}, limitCountryList {d.get('limitCountryList')!r}")

    print("\n== GET https://futures.bluebit.io/fe-co-api/common/getMakerAndTaker (futures fee call of the fee page)")
    status, text, data, dt = call("GET", "https://futures.bluebit.io/fe-co-api/common/getMakerAndTaker")
    title = text[text.find("<title>") + 7:text.find("</title>")] if "<title>" in text else text[:200]
    print(f"status {status}, {len(text)} bytes, {dt * 1000:.0f} ms, body title or start: {title!r}")

    print("\n== outside listings: CoinMarketCap exchange page and CoinGecko derivatives venues")
    status, text, _, dt = call("GET", "https://coinmarketcap.com/exchanges/bluebit/")
    cats = collections.Counter(re.findall(r'"category":"([a-z]+)"', text))
    fees = {k: re.findall(rf'"{k}":([0-9.]+)', text)[:1] for k in ("makerFee", "takerFee")}
    m = re.search(r"For futures, the maker rates are [0-9.]+%, and taker fees are [0-9.]+%\.", text)
    m2 = re.search(r"The exchange charges a flat [0-9.]+% maker and taker fee for spot trading", text)
    m3 = re.search(r"For derivatives, BlueBit also offers [^.]*\.", text)
    print(f"status {status}, market pair categories {dict(cats)}, fee fields {fees}")
    print(f"description spot fee sentence: {m2.group(0) if m2 else None!r}")
    print(f"description futures fee sentence: {m.group(0) if m else None!r}")
    print(f"description derivatives sentence: {m3.group(0) if m3 else None!r}")
    status, text, data, dt = call("GET", "https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    print(f"CoinGecko derivatives venues: status {status}, {len(data or [])} venues, names containing bluebit {[d['name'] for d in data or [] if 'bluebit' in (d['id'] + d['name']).lower()]}")

    print("\n== CCXT: installed 4.5.68 and current master")
    src = pathlib.Path(__file__).resolve().parents[4] / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
    files = sorted(p.name for p in src.glob("*.js"))
    hits = [p.name for p in src.glob("*.js") if "bluebit" in p.read_text("utf-8", "replace").lower()]
    print(f"{src}: {len(files)} .js files, bluebit.js present {'bluebit.js' in files}, files mentioning bluebit {hits}")
    status, text, data, dt = call("GET", "https://api.github.com/repos/ccxt/ccxt/commits/master")
    sha = data["sha"] if data else None
    status, text, data, dt = call("GET", f"https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref={sha}")
    names = [d["name"] for d in data or [] if d["name"].endswith(".ts")]
    print(f"ccxt master {sha}: {len(names)} .ts files in ts/src, names containing blue {[n for n in names if 'blue' in n.lower()]}")


if __name__ == "__main__":
    main()
