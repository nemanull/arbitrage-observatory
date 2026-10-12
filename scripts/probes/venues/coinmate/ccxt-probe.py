# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""Read-only CCXT probe for Coinmate.

It loads the public catalog through the CCXT 4.5.68 Python class, without credentials,
and prints the count, and for each market the id, type, active flag, contract size and the maker and taker CCXT reports.
The JavaScript class the profiles cite is the same release, so the numbers should match it.
One public call to /api/tradingPairs.

Run from the repository root:
    uv run scripts/probes/venues/coinmate/ccxt-probe.py
"""

import json

import ccxt


def main() -> None:
    ex = ccxt.coinmate()
    markets = ex.load_markets()
    print(json.dumps({"ccxt": ccxt.__version__, "markets": len(markets),
                      "types": sorted({m["type"] for m in markets.values()})}))
    for sym, m in markets.items():
        print(json.dumps({"symbol": sym, "id": m["id"], "type": m["type"], "active": m["active"],
                          "contractSize": m["contractSize"], "linear": m["linear"],
                          "maker": m["maker"], "taker": m["taker"], "precision": m["precision"]}))


if __name__ == "__main__":
    main()
