# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""Pacifica fee and CCXT probe for docs/profiles/pacifica/fees.md.

Read-only and unauthenticated, with no wallet, no signature and no order.
It reads the public fee level call GET /api/v1/info/fees, then loads the markets through CCXT 4.5.68 without credentials and reports what market.taker says.
CCXT's loadMarkets makes one call to GET /api/v1/info, so the probe sends two requests in all.
Run from the repository root with: uv run scripts/probes/venues/pacifica/fees-probe.py
"""

import json
import time
import urllib.request
from collections import Counter

import ccxt

UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def main() -> None:
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ccxt", ccxt.__version__, flush=True)

    section("GET https://api.pacifica.fi/api/v1/info/fees")
    req = urllib.request.Request("https://api.pacifica.fi/api/v1/info/fees", headers=UA)
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read()
        print(f"  status {resp.status}, cache-control {resp.headers.get('cache-control')}, x-cache {resp.headers.get('x-cache')}, age {resp.headers.get('age')}")
    levels = json.loads(body)["data"]
    for lv in levels:
        mk, tk = float(lv["maker_fee_rate"]), float(lv["taker_fee_rate"])
        print(f"  level {lv['level']}: maker {lv['maker_fee_rate']} ({mk * 1e6:.0f} ppm), taker {lv['taker_fee_rate']} ({tk * 1e6:.0f} ppm)")

    section("CCXT 4.5.68 pacifica, no credentials")
    ex = ccxt.pacifica()
    t0 = time.perf_counter()
    markets = ex.load_markets()
    print(f"  load_markets {len(markets)} markets in {(time.perf_counter() - t0) * 1000:.0f} ms")
    print(f"  describe fees: {ex.fees.get('swap')}, spot {ex.fees.get('spot')}, trading {ex.fees.get('trading')}")
    print("  types:", dict(Counter(m["type"] for m in markets.values())))
    swaps = [m for m in markets.values() if m["swap"]]
    kept = [m for m in swaps if m.get("active") is not False and m.get("linear") and m.get("quote") in ("USDT", "USDC", "USD")]
    print(f"  active linear swaps quoted in USDT, USDC or USD: {len(kept)}")
    print("  quote, settle:", dict(Counter((m["quote"], m["settle"]) for m in swaps)))
    print("  active:", dict(Counter(m["active"] for m in markets.values())))
    print("  contractSize:", dict(Counter(m["contractSize"] for m in swaps)))
    print("  linear:", dict(Counter(m["linear"] for m in swaps)))
    print("  taker on swaps:", dict(Counter(m["taker"] for m in swaps)), " maker on swaps:", dict(Counter(m["maker"] for m in swaps)))
    spot = [m for m in markets.values() if m["spot"]]
    print("  spot markets:", [(m["symbol"], m["id"], m["taker"], m["maker"]) for m in spot])
    print("  market.id equal to info.symbol on", sum(1 for m in swaps if m["id"] == m["info"]["symbol"]), "of", len(swaps))
    print("  base differs from id:", [(m["id"], m["base"]) for m in swaps if m["base"] != m["id"]])
    btc = markets["BTC/USDC:USDC"]
    print(f"  BTC/USDC:USDC id {btc['id']}, taker {btc['taker']}, maker {btc['maker']}, contractSize {btc['contractSize']}, precision {btc['precision']}, percentage {btc.get('percentage')}, tierBased {btc.get('tierBased')}")
    for sym in ("kPEPE", "kBONK", "kSHIB", "XAU", "BP"):
        m = next((x for x in swaps if x["id"] == sym), None)
        if m:
            print(f"  {sym}: symbol {m['symbol']}, base {m['base']}, taker {m['taker']}")


if __name__ == "__main__":
    main()
