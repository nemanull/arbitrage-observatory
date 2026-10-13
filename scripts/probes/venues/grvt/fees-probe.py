# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68", "httpx>=0.27"]
# ///
"""Read-only fee and CCXT probe for GRVT perpetuals.

Modes, all by default, or name some on the command line:
    ccxt     CCXT 4.5.68 loadMarkets without credentials: market count, active flags, and the taker,
             maker, id, contractSize and linear of BTC/USDT:USDT and of one equity perpetual
    article  the fee article of the help center, cut to its perpetual tier table

No order, no credential and no private call.
CCXT's grvt class signs in only when a key is set, and none is set here.

Run from the repository root:
    uv run scripts/probes/venues/grvt/fees-probe.py [mode ...]
"""

import html
import json
import re
import sys
import time
from collections import Counter

import ccxt
import httpx

ARTICLE = "https://help.grvt.io/en/articles/9614699-how-does-grvt-s-fee-model-work"


def out(kind, **fields):
    print(json.dumps({"kind": kind, **fields}, separators=(",", ":"), default=str), flush=True)


def mode_ccxt():
    ex = ccxt.grvt()
    t0 = time.perf_counter()
    markets = ex.load_markets()
    out("load_markets", version=ccxt.__version__, seconds=round(time.perf_counter() - t0, 2), markets=len(markets))
    swaps = [m for m in markets.values() if m.get("swap")]
    out("swaps", count=len(swaps), active=dict(Counter(str(m.get("active")) for m in swaps)),
        linear=dict(Counter(str(m.get("linear")) for m in swaps)), quote=dict(Counter(m.get("quote") for m in swaps)),
        settle=dict(Counter(m.get("settle") for m in swaps)), contract_size=dict(Counter(str(m.get("contractSize")) for m in swaps)),
        taker=dict(Counter(str(m.get("taker")) for m in swaps)), maker=dict(Counter(str(m.get("maker")) for m in swaps)),
        info_status=dict(Counter(m["info"].get("status") for m in swaps)),
        active_not_false=sum(1 for m in swaps if m.get("active") is not False))
    for symbol in ("BTC/USDT:USDT", "TSLA/USDT:USDT"):
        m = markets.get(symbol)
        if m:
            out("market", symbol=symbol, id=m["id"], base=m["base"], quote=m["quote"], settle=m["settle"], active=m["active"],
                linear=m["linear"], contractSize=m["contractSize"], taker=m.get("taker"), maker=m.get("maker"),
                precision=m["precision"], info_status=m["info"].get("status"), info_asset_class=m["info"].get("asset_class"))
    out("exchange_fees", trading=ex.fees.get("trading"))
    delisted = sorted(m["id"] for m in swaps if m["info"].get("status") != "ACTIVE")
    out("ccxt_keeps_delisted", count=len(delisted), ids=delisted)


def mode_article():
    r = httpx.get(ARTICLE, timeout=15)
    text = re.sub(r"<[^>]+>", "\n", r.text)
    text = html.unescape(text)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    out("article", status=r.status_code, bytes=len(r.content))
    try:
        start = lines.index("Perps Taker")
    except ValueError:
        out("article_table_missing")
        return
    cells = lines[start + 2:start + 2 + 9 * 6]
    rows = [cells[i:i + 6] for i in range(0, len(cells), 6)]
    out("perps_tiers", header=lines[start - 4:start + 2], rows=rows)
    for marker in ("Fee Tiers (Expires", "Active after", "Updated"):
        hit = [l for l in lines if marker in l and len(l) < 200]
        out("article_marker", marker=marker, lines=hit[:2])


MODES = {"ccxt": mode_ccxt, "article": mode_article}


def main():
    for m in sys.argv[1:] or list(MODES):
        out("mode", name=m, utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        MODES[m]()


if __name__ == "__main__":
    main()
