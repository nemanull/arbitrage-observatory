# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68", "httpx>=0.27"]
# ///
"""Read-only probe of what CCXT 4.5.68 and the Paradex public API say about fees and the catalog.

Modes: ccxt (about 20 s, one loadMarkets of about 9,500 markets), tiers (about 2 s), and both in turn by default.
Nothing here signs, authenticates or trades.
Run from the repository root: uv run scripts/probes/venues/paradex/fees-probe.py [mode]
Captures go to .claude/survey-work/paradex/.
"""

import collections
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import ccxt
import httpx

WORK = Path(".claude/survey-work/paradex")
API = "https://api.prod.paradex.trade/v1"


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def mode_ccxt() -> None:
    print(f"== ccxt {utc()} version {ccxt.__version__}")
    exchange = ccxt.paradex()
    print("describe fees:", exchange.fees.get("swap"), "rateLimit:", exchange.rateLimit, "urls.api:", exchange.urls["api"])
    t0 = time.perf_counter()
    markets = exchange.load_markets()
    print(f"loadMarkets {time.perf_counter() - t0:.1f} s, {len(markets)} markets")
    rows = list(markets.values())
    print("type, swap, linear, active:", collections.Counter((m["type"], m["swap"], m["linear"], m["active"]) for m in rows).most_common())
    # The connector filter the main session used: type swap, linear, active not False, quote in USD, USDC or USDT.
    kept = [m for m in rows if m["type"] == "swap" and m["swap"] and m["linear"] and m["active"] is not False and m["quote"] in ("USD", "USDC", "USDT")]
    print(f"kept by the swap filter: {len(kept)}")
    print("asset_kind of kept:", collections.Counter(m["info"].get("asset_kind") for m in kept))
    not_perp = [m["id"] for m in kept if m["info"].get("asset_kind") != "PERP"]
    print("kept but not PERP:", not_perp)
    print("quote, settle of kept:", collections.Counter((m["quote"], m["settle"]) for m in kept))
    print("taker, maker of kept:", collections.Counter((m["taker"], m["maker"]) for m in kept))
    print("contractSize of kept:", collections.Counter(m["contractSize"] for m in kept))
    print("id equals info.symbol:", sum(1 for m in kept if m["id"] == m["info"]["symbol"]), "of", len(kept))
    for symbol in ("BTC/USD:USDC", "ETH/USD:USDC"):
        m = markets[symbol]
        print(symbol, {k: m[k] for k in ("id", "base", "quote", "settle", "linear", "active", "contractSize", "taker", "maker", "precision")})
    k = [m for m in kept if m["info"]["base_currency"][:1].islower()]
    print("k-prefixed:", [(m["id"], m["base"], m["symbol"]) for m in k])
    print("spot parsed by CCXT:", [(m["id"], m["symbol"], m["type"], m["swap"], m["contract"]) for m in rows if m["info"].get("asset_kind") == "SPOT"])
    print("options:", sum(1 for m in rows if m["type"] == "option"))
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / "ccxt-kept.json").write_text(json.dumps(sorted(m["id"] for m in kept), indent=1))


def mode_tiers() -> None:
    print(f"== tiers {utc()}")
    with httpx.Client(timeout=30) as client:
        r = client.get(API + "/system/volume-tiers")
        print(f"/system/volume-tiers status={r.status_code} bytes={len(r.content)}")
        for tier in r.json()["results"]:
            print("  ", tier["kind"], tier["tier_name"], tier["min_volume"], tier.get("min_volume_duration"), tier["fee_rates"])
        r = client.get(API + "/markets", params={"market": "BTC-USD-PERP"})
        print("BTC-USD-PERP fee_config:", json.dumps(r.json()["results"][0].get("fee_config")))
        for path in ("/xp/fee-config", "/staking/config", "/system/config"):
            r = client.get(API + path)
            body = r.json()
            if path == "/system/config":
                body = {k: body.get(k) for k in ("liquidation_fee", "partial_liquidation_buffer", "partial_liquidation_share_increment", "starknet_chain_id", "oracle_address", "starknet_fullnode_rpc_url")}
            print(f"{path} status={r.status_code} body={json.dumps(body)[:700]}")


MODES = {"ccxt": mode_ccxt, "tiers": mode_tiers}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(MODES):
        MODES[name]()
