# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee, access and CCXT probe for Coinut.

It reads the "Trading fees" and "Terms of Services" articles through the public Zendesk help center API, because the help center HTML pages answer a Cloudflare challenge.
It checks whether CCXT 4.5.68 or current CCXT master has a coinut class, and what CoinGecko lists for the venue.
About 10 requests, no credentials.
Run from the repository root with: uv run scripts/probes/venues/coinut/fees-probe.py
"""

import html
import json
import pathlib
import re
import urllib.error
import urllib.request

UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
HC = "https://help.coinut.com/api/v2/help_center/en-us/articles/{}.json"
CCXT_LOCAL = pathlib.Path(__file__).resolve().parents[4] / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"


def get(url: str):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def text_of(body_html: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body_html))).strip()


def article(aid: int):
    st, body = get(HC.format(aid))
    a = json.loads(body)["article"]
    print(f"article {aid} status {st} title {a['title']!r} created {a['created_at']} updated {a['updated_at']} url {a['html_url']}")
    return text_of(a["body"])


def main() -> None:
    print("=== trading fees")
    t = article(360001416133)
    print(t)
    rows = re.findall(r"(VIP \d|Normal) ([\d.]+%) (Free|[\d.]+%)", t)
    print("parsed taker and maker rows in page order", rows)

    print("\n=== help center HTML page")
    st, body = get("https://help.coinut.com/hc/en-us/articles/360001416133-Trading-fees")
    print("status", st, "title", re.findall(r"<title>(.*?)</title>", body)[:1])

    print("\n=== terms of services, region clauses")
    t = article(115008686648)
    print(t[:420])
    for m in re.finditer(r"[^.]*(?:only for Singapore|United States resident|not a United States|exempted by)[^.]*\.", t):
        print("-", m.group(0).strip()[:400])

    print("\n=== API article")
    print(article(360005115273))

    print("\n=== CCXT")
    print("local 4.5.68 coinut.js exists", (CCXT_LOCAL / "coinut.js").exists(), "local classes", len(list(CCXT_LOCAL.glob("*.js"))))
    st, _ = get("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/coinut.ts")
    print("GitHub master ts/src/coinut.ts status", st)
    st, body = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    print("GitHub master exchanges.json status", st, "mentions coinut", "coinut" in body.lower())

    print("\n=== CoinGecko")
    st, body = get("https://api.coingecko.com/api/v3/exchanges/coinut")
    if st == 200:
        d = json.loads(body)
        print("exchanges/coinut", st, {k: d.get(k) for k in ("name", "country", "year_established", "trust_score_rank", "trade_volume_24h_btc")}, "tickers", len(d.get("tickers", [])))
    else:
        print("exchanges/coinut", st, body[:200])
    st, body = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    print("derivatives/exchanges/list", st, "mentions coinut", "coinut" in body.lower() if st == 200 else body[:120])

    print("\n=== CoinMarketCap")
    UA["User-Agent"] = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
    st, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinut")
    d = json.loads(body)["data"]
    print("exchange/detail", st, {k: d.get(k) for k in ("id", "name", "status", "dateLaunched", "makerFee", "takerFee", "derivativesVolumeUsd", "urls")})
    st, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinut&category=spot&start=1&limit=50")
    d = json.loads(body)["data"]
    pairs = d.get("marketPairs", [])
    print("market-pairs spot", st, "numMarketPairs", d.get("numMarketPairs"), "rows", len(pairs),
          "sum volumeUsd", round(sum(p.get("volumeUsd") or 0 for p in pairs), 2), "lastUpdated", sorted({p.get("lastUpdated") for p in pairs}))
    for p in pairs:
        print(" ", p.get("marketPair"), "price", p.get("price"), "volumeUsd", p.get("volumeUsd"), "excluded", p.get("priceExcluded"), p.get("volumeExcluded"))
    st, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinut&category=perpetual&start=1&limit=10")
    print("market-pairs perpetual", st, "numMarketPairs", json.loads(body).get("data", {}).get("numMarketPairs") if st == 200 else body[:120])


if __name__ == "__main__":
    main()
