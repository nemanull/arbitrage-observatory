# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""Read-only fee probe for dYdX (CCXT id dydx).

dYdX keeps its fee schedule in chain state, so this probe reads it from a public full node's REST gateway,
listed at https://docs.dydx.xyz/interaction/endpoints, and then reads what CCXT 4.5.68 reports without credentials.
Every call is an unauthenticated GET.

Modes, all by default, or name some on the command line:
    chain   perpetual fee tiers, per market fee discounts, staking tiers, affiliate tiers and parameters, and the quote asset
    ccxt    CCXT 4.5.68 load_markets: fees.trading, market.taker and maker for BTC/USDC:USDC, and the swap counts

Run from the repository root:
    uv run scripts/probes/venues/dydx/fees-probe.py [mode ...]
"""

import json
import sys
import time
import urllib.request
from collections import Counter

NODE = "https://dydx-ops-rest.kingnodes.com"  # KingNodes, 350 req/m per the endpoints page
UA = "arbitrage-observatory-survey-probe"


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False, default=str), flush=True)


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def get(path: str) -> tuple[int, dict | str]:
    req = urllib.request.Request(NODE + path, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as error:
        return error.code, error.read()[:300].decode(errors="replace")


def mode_chain() -> None:
    paths = {
        "perpetual_fee_params": "/dydxprotocol/v4/feetiers/perpetual_fee_params",
        "market_fee_discount_params": "/dydxprotocol/v4/feetiers/market_fee_discount_params",
        "staking_tiers": "/dydxprotocol/v4/feetiers/staking_tiers",
        "affiliate_tiers": "/dydxprotocol/affiliates/all_affiliate_tiers",
        "affiliate_parameters": "/dydxprotocol/affiliates/affiliate_parameters",
        "quote_asset": "/dydxprotocol/assets/asset/0",  # USDC, whose atomic resolution turns quote quantums into dollars
    }
    for name, path in paths.items():
        status, body = get(path)
        out(mode="chain", at=stamp(), name=name, host=NODE, path=path, status=status, body=body)
        time.sleep(0.5)
    status, body = get(paths["perpetual_fee_params"])
    if status == 200:
        for tier in body["params"]["tiers"]:
            out(mode="chain", tier=tier.get("name"), taker_ppm=tier.get("taker_fee_ppm"), maker_ppm=tier.get("maker_fee_ppm"),
                taker_percent=tier.get("taker_fee_ppm", 0) / 10_000, maker_percent=tier.get("maker_fee_ppm", 0) / 10_000,
                volume_requirement_quote_quantums=tier.get("absolute_volume_requirement"),
                total_volume_share_requirement_ppm=tier.get("total_volume_share_requirement_ppm"),
                maker_volume_share_requirement_ppm=tier.get("maker_volume_share_requirement_ppm"))


def mode_ccxt() -> None:
    import ccxt

    exchange = ccxt.dydx()
    out(mode="ccxt", ccxt_version=ccxt.__version__, fees_trading=exchange.fees.get("trading"))
    markets = exchange.load_markets()
    swaps = [m for m in markets.values() if m.get("swap")]
    active = [m for m in swaps if m.get("active")]
    linear_usd = [m for m in active if m.get("linear") and m.get("quote") in ("USD", "USDC", "USDT")]
    out(mode="ccxt", at=stamp(), markets=len(markets), swaps=len(swaps), active_swaps=len(active), active_linear_usd_quoted=len(linear_usd),
        quote=dict(Counter(m.get("quote") for m in active)), settle=dict(Counter(m.get("settle") for m in active)),
        contract_size=dict(Counter(str(m.get("contractSize")) for m in active)))
    btc = markets.get("BTC/USDC:USDC")  # CCXT hard codes the quote USDC although the venue ticker reads BTC-USD
    out(mode="ccxt", symbol="BTC/USDC:USDC", id=btc.get("id"), taker=btc.get("taker"), maker=btc.get("maker"),
        taker_ppm=None if btc.get("taker") is None else round(btc["taker"] * 1_000_000), contractSize=btc.get("contractSize"),
        precision=btc.get("precision"), linear=btc.get("linear"), active=btc.get("active"))
    takers = Counter(str(m.get("taker")) for m in active)
    out(mode="ccxt", taker_values_on_active=dict(takers))
    ids_equal_ticker = sum(1 for m in active if m["id"] == m["info"]["ticker"])
    out(mode="ccxt", ids_equal_info_ticker=ids_equal_ticker, of_active=len(active))


MODES = {"chain": mode_chain, "ccxt": mode_ccxt}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    for name in chosen:
        MODES[name]()
