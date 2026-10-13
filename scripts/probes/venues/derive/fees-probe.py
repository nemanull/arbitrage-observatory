# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68", "httpx==0.28.1"]
# ///
"""Fee and CCXT probe of Derive for the venue profile, public and read-only.

Run from the repository root:
    uv run scripts/probes/venues/derive/fees-probe.py

It loads CCXT 4.5.68's derive markets without credentials and prints what each perpetual reports.
Then it reads the fee fields of the v3 instruments call, and one CCXT ticker to show which host CCXT reads.
"""

import time

import ccxt
import httpx

V3 = "https://api.derive.xyz/v3"


def main() -> None:
    print(f"# derive fees-probe at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, ccxt {ccxt.__version__}")
    ex = ccxt.derive()
    print(f"ccxt urls.api: {ex.urls['api']}, has.swap {ex.has.get('swap')}, has.fetchOrderBook {ex.has.get('fetchOrderBook')}, fees {ex.fees}")
    t0 = time.perf_counter()
    markets = ex.load_markets()
    print(f"load_markets: {len(markets)} markets in {time.perf_counter() - t0:.1f} s")
    kinds = {}
    for m in markets.values():
        kinds[m["type"]] = kinds.get(m["type"], 0) + 1
    print(f"by type: {kinds}")
    swaps = sorted((m for m in markets.values() if m["type"] == "swap"), key=lambda m: m["id"])
    active = [m for m in swaps if m.get("active") is not False]
    print(f"swaps {len(swaps)}, active {len(active)}, linear {sum(1 for m in swaps if m['linear'])}")
    for m in swaps:
        print(
            f"  {m['id']}: symbol {m['symbol']}, base {m['base']}, quote {m['quote']}, settle {m['settle']}, linear {m['linear']}, "
            f"contractSize {m['contractSize']}, active {m['active']}, taker {m['taker']}, maker {m['maker']}, "
            f"quote_currency on the wire {m['info'].get('quote_currency')}"
        )
    takers = sorted({m["taker"] for m in swaps}, key=str)
    print(f"distinct CCXT swap takers: {takers}, in ppm {[round(t * 1_000_000) if t is not None else None for t in takers]}")
    time.sleep(1)
    r = httpx.post(f"{V3}/public/get_all_instruments", json={"expired": False, "instrument_type": "perp"}, timeout=15)
    rows = sorted(r.json()["result"]["instruments"], key=lambda i: i["instrument_name"])
    fee_sets = sorted({(i["taker_fee_rate"], i["maker_fee_rate"], i["base_fee"], i["mark_price_fee_rate_cap"]) for i in rows})
    print(f"v3 perps {len(rows)}, distinct (taker_fee_rate, maker_fee_rate, base_fee, mark_price_fee_rate_cap): {fee_sets}")
    for taker, maker, base, _ in fee_sets:
        t, b = float(taker), float(base)
        print(f"  taker {t * 1e6:.0f} ppm plus a base fee of {b} USDC per order, which adds {b / 100 * 1e6:.0f} ppm at 100 USDC, {b / 1000 * 1e6:.0f} ppm at 1,000 and {b / 10000 * 1e6:.0f} ppm at 10,000")
    time.sleep(1)
    tk = ex.fetch_ticker("BTC/USD:USDC")
    print(f"ccxt fetch_ticker BTC/USD:USDC: timestamp {tk['timestamp']}, bid {tk['bid']}, ask {tk['ask']}, index {tk['indexPrice']}, mark {tk['markPrice']}")
    time.sleep(1)
    r = httpx.post(f"{V3}/public/get_ticker", json={"instrument_name": "BTC-PERP"}, timeout=15)
    t = r.json()["result"]
    print(f"v3 get_ticker BTC-PERP: t {t['t']}, bid {t['b']}, ask {t['a']}, index {t['I']}, mark {t['M']}")


if __name__ == "__main__":
    main()
