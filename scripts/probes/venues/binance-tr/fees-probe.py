# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Binance TR fee probe for docs/profiles/binance-tr/fees.md.

Public, unauthenticated and read-only, seven requests.
The fee page at www.binance.tr/en/fees renders its two tables from two public calls of the web app, found in its main bundle.
  1. /v1/commission/fiat/rule, the TRY pair schedule.
  2. /v1/common/vip-rules, the crypto pair VIP schedule.
  3. /v1/common/system-config, the BNB fee asset and its discount factor.
  4. The fee page itself, for its title, its footnotes and the operator line.
  5. CoinMarketCap's exchange detail for Binance TR, for its fee and product text.
  6. CoinGecko's exchange and derivatives lists, for any Binance TR entry.
Run from the repository root with: uv run scripts/probes/venues/binance-tr/fees-probe.py
"""

import email.utils
import html
import json
import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html"}
WWW = "https://www.binance.tr"


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


def ppm(x):
    return round(float(x) * 1_000_000)


def main():
    print(f"run at {email.utils.formatdate(usegmt=True)}")

    print("== 1. TRY pair schedule /v1/commission/fiat/rule")
    s, body = get(WWW + "/v1/commission/fiat/rule")
    rows = json.loads(body)["data"]["list"]
    print(f"status {s} rows {len(rows)}")
    for i, r in enumerate(rows):
        print(f"tier {i}: 30 d {r['tradeVolumeAsset']} volume {r['tradeMinVolume']} to {r['tradeMaxVolume']} maker {r['makerCommission']} ({ppm(r['makerCommission'])} ppm) taker {r['takerCommission']} ({ppm(r['takerCommission'])} ppm) status {r['status']}")

    print("== 2. Crypto pair VIP schedule /v1/common/vip-rules")
    s, body = get(WWW + "/v1/common/vip-rules")
    rows = json.loads(body)["data"]["list"]
    print(f"status {s} rows {len(rows)} keys {sorted(rows[0].keys())}")
    for r in rows:
        print(f"VIP {r['vipLevel']}: 30 d {r['tradeVolumeAsset']} volume {r['tradeVolume']} {r['balanceAsset']} balance {r['balance']} maker {r['makerCommission']} ({ppm(r['makerCommission'])} ppm) taker {r['takerCommission']} ({ppm(r['takerCommission'])} ppm)")

    print("== 3. /v1/common/system-config fee fields")
    s, body = get(WWW + "/v1/common/system-config")
    d = json.loads(body)["data"]
    print(f"status {s} specificAsset {d.get('specificAsset')} specificAssetPayFeeDiscount {d.get('specificAssetPayFeeDiscount')}")
    print({k: d.get(k) for k in ("binanceApiBaseUrl", "binanceApiBaseUrlList", "binanceWssBaseUrl", "binanceWssBaseUrlList", "binanceWssApiBaseUrl", "nextMeWssBaseUrl", "nextMeApiBaseUrl")})

    print("== 4. Fee page")
    s, body = get(WWW + "/en/fees")
    t = body.decode("utf-8", "replace")
    title = re.findall(r"<title[^>]*>(.*?)</title>", t)
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", text))
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    print(f"status {s} title {title}")
    for x in lines:
        if any(k in x for k in ("Discount", "evaluated", "updated at", "free", "Log in", "A.Ş.", "Mersis")):
            print(f"  {x}")

    print("== 5. CoinMarketCap exchange detail")
    s, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=binance-tr")
    d = json.loads(body)["data"]
    desc = d["description"]
    print(f"status {s} id {d['id']} name {d['name']} fiats {d.get('fiats')} countries {d.get('countries')} makerFee {d.get('makerFee')} takerFee {d.get('takerFee')}")
    q = d["quote"].get("2781", {})
    print(f"USD spot volume 24 h {q.get('spotVolume24h')} perpetual {q.get('perpetualVolume24h')} futures {q.get('futuresVolume24h')}")
    for key in ("How Much Are Binance TR Fees?", "Is It Possible To Use Leverage", "Binance TR Restricted Countries"):
        i = desc.find(key)
        print(f"  {desc[i:i + 330].replace(chr(10), ' ')!r}")

    print("== 6. CoinGecko lists")
    s, body = get("https://api.coingecko.com/api/v3/exchanges/list")
    ex = json.loads(body)
    print(f"exchanges/list {s} rows {len(ex)} binance ids {[x['id'] for x in ex if 'binance' in x['id'].lower() or 'binance' in x['name'].lower()]}")
    s, body = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    dx = json.loads(body)
    print(f"derivatives/exchanges/list {s} rows {len(dx)} binance ids {[x['id'] for x in dx if 'binance' in x['id'].lower()]}")


if __name__ == "__main__":
    main()
