# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68", "httpx>=0.27,<1"]
# ///
"""Lighter fees and CCXT catalog probe for docs/profiles/lighter/fees.md and rest.md.

Public, unauthenticated and read-only. No wallet, key or signature is loaded.
It makes three REST calls: CCXT's loadMarkets (assetDetails, then orderBookDetails, paced by CCXT's own 1 s rateLimit),
then systemConfig for the integrator fee caps.
It reports what CCXT 4.5.68 puts in market.taker and market.maker without credentials, the per market fee
fields on the wire, and the catalog counts the survey uses.

Run from the repository root with: uv run scripts/probes/venues/lighter/fees-probe.py [label]
Captures land in .claude/survey-work/lighter/.
"""

import collections
import json
import pathlib
import sys
import time

import ccxt
import httpx

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "lighter"
WORK.mkdir(parents=True, exist_ok=True)
LABEL = sys.argv[1] if len(sys.argv) > 1 else time.strftime("%H%M", time.gmtime())
OUT = {"ccxt_version": ccxt.__version__, "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

ex = ccxt.lighter()
OUT["rateLimit_ms"] = ex.rateLimit
OUT["describe_fees"] = ex.fees
OUT["options_fee_keys"] = {k: ex.options.get(k) for k in ("builderFee", "integratorAccountIndex", "integratorTakerFee", "integratorMakerFee", "defaultType")}
t0 = time.time()
markets = ex.load_markets()
OUT["load_markets_s"] = round(time.time() - t0, 2)

swaps = [m for m in markets.values() if m.get("swap")]
kept = [m for m in swaps if m.get("active") is not False and m.get("linear") and m.get("quote") in ("USDT", "USDC", "USD")]
OUT["markets_total"] = len(markets)
OUT["by_type"] = dict(collections.Counter(m["type"] for m in markets.values()))
OUT["swaps"] = len(swaps)
OUT["swaps_active_linear_usd_family"] = len(kept)
OUT["swaps_inactive"] = sum(1 for m in swaps if m.get("active") is False)
OUT["quote_settle"] = dict(collections.Counter(f'{m["quote"]}/{m["settle"]}' for m in swaps))
OUT["taker_values"] = dict(collections.Counter(str(m.get("taker")) for m in swaps))
OUT["maker_values"] = dict(collections.Counter(str(m.get("maker")) for m in swaps))
OUT["contractSize_values"] = dict(collections.Counter(str(m.get("contractSize")) for m in swaps))
OUT["linear_values"] = dict(collections.Counter(str(m.get("linear")) for m in swaps))
OUT["id_is_market_id"] = sum(1 for m in swaps if m["id"] == str(m["info"]["market_id"]))
OUT["base_equals_symbol_field"] = sum(1 for m in swaps if m["base"] == m["info"]["symbol"])
OUT["base_differs"] = [(m["id"], m["info"]["symbol"], m["base"]) for m in swaps if m["base"] != m["info"]["symbol"]]
OUT["pairs_listed_twice"] = [k for k, v in collections.Counter((m["base"], m["quote"]) for m in kept).items() if v > 1]
btc = markets.get("BTC/USDC:USDC")
OUT["btc"] = {k: btc.get(k) for k in ("id", "symbol", "base", "quote", "settle", "type", "linear", "active", "contractSize", "taker", "maker", "precision")}
OUT["btc_wire_fee_fields"] = {k: btc["info"].get(k) for k in ("taker_fee", "maker_fee", "is_taker_fee_enabled", "is_maker_fee_enabled", "liquidation_fee")}
spot = [m for m in markets.values() if m.get("spot")]
OUT["spot_taker_values"] = dict(collections.Counter(str(m.get("taker")) for m in spot))
OUT["kept_symbols"] = sorted(m["symbol"] for m in kept)

with httpx.Client(headers={"user-agent": "arbitrage-observatory-probe/1.0 (read-only research)"}, timeout=20) as c:
    time.sleep(2)
    r = c.get("https://mainnet.zklighter.elliot.ai/api/v1/systemConfig")
    OUT["systemConfig_status"] = r.status_code
    try:
        OUT["systemConfig"] = r.json()
    except Exception:
        OUT["systemConfig"] = r.text[:500]

OUT["ended_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
path = WORK / f"fees-{LABEL}.json"
path.write_text(json.dumps(OUT, indent=1, default=str))
print(json.dumps({k: v for k, v in OUT.items() if k != "kept_symbols"}, indent=1, default=str))
print("saved", path.relative_to(ROOT))
