# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Unocoin futures fee probe for docs/profiles/unocoin/fees.md.

Public, unauthenticated and read-only.
It reads the futures catalog that the fee page renders, the fee page and the terms of use, the CoinMarketCap record, and checks CCXT 4.5.68 and current CCXT for a class.
About ten requests in total.
Run from the repository root with: uv run scripts/probes/venues/unocoin/fees-probe.py
"""

import collections
import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

API = "https://api.unocoin.com/api"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}
CCXT_DIR = pathlib.Path(__file__).resolve().parents[4] / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"


def get(url, headers=UA):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, e.read().decode("utf-8", "replace")


def text(page):
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))


def around(t, needle, before=150, after=350):
    i = t.find(needle)
    return t[max(0, i - before): i + after] if i >= 0 else f"({needle!r} not found)"


def section(title):
    print(f"\n== {title}")


def main():
    print("started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    section("1. futures fees per contract, GET /v1/futures/app-pairs")
    st, url, body = get(API + "/v1/futures/app-pairs")
    c = json.loads(body)["contracts"]
    print(f"status {st}, contracts {len(c)}")
    for k in ["maker_fee", "taker_fee", "liquidation_fee", "funding_fee_interval", "max_leverage", "unocoin_max_leverage", "contract_type"]:
        print(f"  {k}:", dict(collections.Counter(str(x.get(k)) for x in c)))
    taker = float(c[0]["taker_fee"])
    maker = float(c[0]["maker_fee"])
    print(f"taker {taker} % is {round(taker * 1e4)} ppm, maker {maker} % is {round(maker * 1e4)} ppm")
    print("maintenance_margin_config of BTCINR:", c[0]["maintenance_margin_config"])

    section("2. fee page https://unocoin.com/in/support/fees/")
    st, url, page = get("https://unocoin.com/in/support/fees/")
    t = text(page)
    print(f"status {st}, final url {url}, {len(page)} bytes")
    print("futures block:", around(t, "Futures Markets Available", 0, 200))
    print("GST note:", around(t, "IGST", 60, 260))
    chunk = re.search(r'src="(/landing/_next/static/chunks/pages/in/support/fees-[^"]+)"', page)
    if chunk:
        st, url, js = get("https://unocoin.com" + chunk.group(1))
        print(f"fee page chunk {chunk.group(1)}: status {st}")
        print("  fetches /v1/futures/app-pairs:", "/v1/futures/app-pairs" in js)
        print("  renders:", re.findall(r"t\.(maker_fee|taker_fee|max_leverage)\?Number\(t\.\w+\)\.toFixed\(2\)|t\.(max_leverage)\?", js))
    st, url, page = get("https://www.unocoin.com/post/92")
    print(f"CoinMarketCap fee url https://www.unocoin.com/post/92: status {st}, final url {url}")

    section("3. terms of use, futures section")
    st, url, page = get("https://unocoin.com/in/policy/termsofuse/")
    t = text(page)
    print(f"status {st}")
    print("entity:", around(t, "Unocoin Technologies Private Limited", 60, 260))
    print("eligibility:", around(t, "strictly available for use only within India", 60, 200))
    print("brokerage:", around(t, "Nature of Service (Brokerage Model)", 0, 260))
    print("fees:", around(t, "Fees and Charges:", 0, 200))

    section("4. support article on futures")
    # The Zoho help desk answers an unknown user agent with a browser alert page, so this one call sends curl's.
    st, url, page = get("https://support.unocoin.com/portal/en/kb/articles/how-to-trade-on-futures-27-4-2026", {"User-Agent": "curl/8.14.1"})
    t = text(page)
    print(f"status {st}")
    print("settlement:", around(t, "INR-settled perpetual", 60, 200))
    print("pairs and leverage:", around(t, "BTC-INR", 0, 420))
    print("funding:", around(t, "Funding Rate / Countdown", 0, 200))

    section("5. CoinMarketCap record")
    st, url, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=unocoin")
    d = json.loads(body)["data"]
    print(f"status {st}, id {d['id']}, countries {d['countries']}, makerFee {d['makerFee']}, takerFee {d['takerFee']}, fee url {d['urls']['fee']}")
    q = d["quote"]["2781"]
    print(f"USD volumes 24h: spot {q['spotVolume24h']:.0f}, perpetual {q['perpetualVolume24h']}, futures {q['futuresVolume24h']}")

    section("6. CCXT")
    files = sorted(p.name for p in CCXT_DIR.glob("*.js"))
    print(f"CCXT 4.5.68 at {CCXT_DIR.relative_to(CCXT_DIR.parents[6])}: {len(files)} js files")
    print("  unocoin.js present:", "unocoin.js" in files, ", pi42.js present:", "pi42.js" in files)
    hits = [f for f in files if re.search(r"unocoin|pi42", (CCXT_DIR / f).read_text(errors="replace"), re.I)]
    print("  files mentioning unocoin or pi42:", hits or "none")
    st, url, body = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src")
    if st == 200:
        names = [x["name"] for x in json.loads(body)]
        print(f"current CCXT master ts/src: {len(names)} entries, matching unocoin or pi42: {[n for n in names if re.search('unocoin|pi42', n, re.I)] or 'none'}")
    else:
        print("GitHub listing status", st)
    print("\nfinished", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
