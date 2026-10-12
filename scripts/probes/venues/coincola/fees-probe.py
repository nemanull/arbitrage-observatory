# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CoinCola public fee probe for docs/profiles/coincola/.

Reads the per asset maker and taker fields of the documented assets call, the fee text on the spot trading page,
the help centre fee article through the public Zendesk API, and the documented contract call that would carry derivative fees.
It also reads CoinMarketCap's record of the venue, to show how the absence of perpetuals was cross-checked.
Read-only and unauthenticated, ten requests.
Run from the repository root with: uv run scripts/probes/venues/coincola/fees-probe.py
"""

import collections
import html
import json
import re
import time
import urllib.request

UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
ZD = "https://coincolahelp.zendesk.com/api/v2/help_center/en-us/articles"


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read()


def text(body: str) -> str:
    t = html.unescape(re.sub(r"<[^>]+>", " ", body))
    return re.sub(r"\s+", " ", t)


def main() -> None:
    print("probe start UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    print("\n=== 1. GET https://api.coincola.com/v1/market/assets")
    st, data = get("https://api.coincola.com/v1/market/assets")
    assets = json.loads(data)
    pairs = collections.Counter((v.get("maker_fee"), v.get("taker_fee")) for v in assets.values())
    print("status", st, "assets", len(assets), "(maker_fee, taker_fee) counts", dict(pairs))
    print("assets", sorted(assets))

    print("\n=== 2. spot trading page fee text")
    st, data = get("https://www.coincola.com/trading/btc/usdt")
    page = data.decode("utf-8", "replace")
    print("status", st, "order form fee", re.findall(r'class="[^"]*fee">([^<]+)<', page)[:2])
    print("pair box", re.findall(r"<b>Trading Fee:</b>\s*([^<]+)<", page)[:1])

    print("\n=== 3. help centre articles")
    for aid in ["360009260513", "360009595734", "360024165734"]:
        st, data = get(f"{ZD}/{aid}.json")
        a = json.loads(data)["article"]
        t = text(a["body"])
        m = re.search(r"Exchange Market\s*[0-9.]+% trading fee\S*", t)
        promo = re.search(r"50% off promotion.*?from 0\.2%", t)
        print(aid, repr(a["title"]), "updated", a["updated_at"], "|", (m.group(0) if m else (promo.group(0) if promo else t[:160])))

    print("\n=== 4. documented contract call, which carries maker_fee and taker_fee per contract")
    st, data = get("https://api.coincola.com/v1/contract/market?product_type=PERPETUAL")
    print("status", st, "body", data.decode()[:200])

    print("\n=== 5. CoinMarketCap records for slug coincola")
    st, data = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coincola")
    d = json.loads(data)["data"]
    print("status", st, {k: d.get(k) for k in ("id", "name", "dateLaunched", "makerFee", "takerFee", "spotVolumeUsd", "derivativesVolumeUsd")}, "fee url", d["urls"].get("fee"))
    for cat in ("perpetual", "futures", "spot"):
        st, data = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coincola&category={cat}&limit=100")
        d = json.loads(data)["data"]
        print(f"category {cat} status {st} numMarketPairs {d.get('numMarketPairs')} pairs listed {len(d.get('marketPairs', []))}")

    print("\nprobe end UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
