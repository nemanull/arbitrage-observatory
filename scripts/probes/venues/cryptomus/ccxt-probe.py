# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""What the CCXT 4.5.68 cryptomus class reports without credentials.

The Python package is generated from the same source as the installed JavaScript class at node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/cryptomus.js, which the profile cites by line.

Run from the repository root: uv run scripts/probes/venues/cryptomus/ccxt-probe.py
It sends three public requests: markets, one order book and tickers.
"""

import collections

import ccxt


def main():
    ex = ccxt.cryptomus()
    print(f"ccxt {ccxt.__version__} id={ex.id} has swap={ex.has.get('swap')} spot={ex.has.get('spot')} "
          f"watchOrderBook={ex.has.get('watchOrderBook')} fetchFundingRate={ex.has.get('fetchFundingRate')}")
    markets = ex.load_markets()
    print(f"markets={len(markets)} by type={dict(collections.Counter(m['type'] for m in markets.values()))} "
          f"inactive={sum(1 for m in markets.values() if not m['active'])}")
    m = markets["BTC/USDT"]
    keys = ("id", "symbol", "type", "spot", "swap", "linear", "contractSize", "active", "taker", "maker", "feeSide", "precision", "limits")
    for k in keys:
        print(f"BTC/USDT {k}={m[k]}")
    print(f"BTC/USDT info pricePrec={m['info'].get('pricePrec')} basePrec={m['info'].get('basePrec')} quotePrec={m['info'].get('quotePrec')}")
    book = ex.fetch_order_book("BTC/USDT")
    print(f"fetch_order_book bids={len(book['bids'])} asks={len(book['asks'])} best bid={book['bids'][0]} best ask={book['asks'][0]} timestamp={book['timestamp']}")
    tickers = ex.fetch_tickers()
    t = tickers.get("BTC/USDT", {})
    print(f"fetch_tickers count={len(tickers)} BTC/USDT last={t.get('last')} bid={t.get('bid')} ask={t.get('ask')}")


if __name__ == "__main__":
    main()
