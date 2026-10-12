# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Cofinex fee probe for docs/profiles/cofinex/fees.md.

Public, unauthenticated and read-only, eleven requests.
  1. The fee fields of every spot row in the web app's catalog on marketdata.cofinex.io, against Bitget's own spot symbols call.
  2. The fee fields of the FUTURE example in the API docs at apidocs.cofinex.io/openapi.json.
  3. The fee fields CoinMarketCap holds for Cofinex, and whether its fee page URL resolves on cofinex.io.
  4. Whether any fee page exists on the site at a few likely paths.
Run from the repository root with: uv run scripts/probes/venues/cofinex/fees-probe.py
"""

import collections
import json
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def ppm(rate: str) -> int:
    return round(float(rate) * 1_000_000)


def main():
    s, body = get("https://marketdata.cofinex.io/spot/v1/tradepair")
    pairs = json.loads(body)["data"]["pairs"]
    print(f"== 1. spot catalog {s}, rows {len(pairs)}")
    c = collections.Counter((p["exchange"], ppm(p["data"]["makerFeeRate"]), ppm(p["data"]["takerFeeRate"])) for p in pairs)
    for (ex, mk, tk), n in sorted(c.items()):
        print(f"exchange {ex}: maker {mk} ppm taker {tk} ppm on {n} rows")
    for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "CNXUSDT"):
        row = next((p for p in pairs if p["symbol"] == sym), None)
        if row:
            print(f"{sym}: maker {row['data']['makerFeeRate']} taker {row['data']['takerFeeRate']} exchange {row['exchange']}")
    s, body = get("https://api.bitget.com/api/v2/spot/public/symbols")
    bg = {r["symbol"]: r for r in json.loads(body)["data"]}
    cmp = collections.Counter()
    for p in pairs:
        if p["exchange"] != "bitget":
            continue
        b = bg.get(p["symbol"])
        if b is None:
            cmp["missing on Bitget"] += 1
        elif b["takerFeeRate"] == p["data"]["takerFeeRate"] and b["makerFeeRate"] == p["data"]["makerFeeRate"]:
            cmp["same fee fields as Bitget"] += 1
        else:
            cmp["different fee fields"] += 1
    print(f"Bitget spot symbols {s}, rows {len(bg)}, BTCUSDT on Bitget maker {bg['BTCUSDT']['makerFeeRate']} taker {bg['BTCUSDT']['takerFeeRate']}, Cofinex bitget rows compared: {dict(cmp)}")
    hi = sorted(p["symbol"] for p in pairs if p["exchange"] == "bitget" and ppm(p["data"]["takerFeeRate"]) == 2000)
    print(f"bitget rows at 2000 ppm ({len(hi)}): {hi}")

    s, body = get("https://apidocs.cofinex.io/openapi.json")
    spec = json.loads(body)
    ex = spec["paths"]["/marketdata/tradepairinfo/{tradeType}"]["get"]["responses"]["200"]["content"]["application/json"]["examples"]
    print(f"== 2. openapi.json {s}")
    for kind in ("spot", "future"):
        for row in ex[kind]["value"]["body"]:
            print(f"{kind} example {row['symbol']}: maker {row['makerFeeRate']} ({ppm(row['makerFeeRate'])} ppm) taker {row['takerFeeRate']} ({ppm(row['takerFeeRate'])} ppm)")

    s, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=cofinex")
    d = json.loads(body)["data"]
    print(f"== 3. CoinMarketCap detail {s}: makerFee {d.get('makerFee')} takerFee {d.get('takerFee')} fee url {d['urls'].get('fee')}")
    for path in ("fee-details-trade", "en/fee-details-trade", "en/fees", "en/fee", "en/content/fees", "en/trading-fees"):
        s, body = get(f"https://cofinex.io/{path}")
        print(f"cofinex.io/{path}: {s}, renders the not found page {b'NEXT_HTTP_ERROR_FALLBACK;404' in body}")


if __name__ == "__main__":
    main()
