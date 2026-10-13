# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""Read-only fee and catalog probe for Extended (CCXT id extended).

Reads the published fee page and the restricted countries page as Markdown, then loads CCXT 4.5.68's extended class without credentials
and reports market.taker, market.maker, the active linear perpetual count and how the class maps ids, bases and contract sizes.
Run from the repository root: uv run scripts/probes/venues/extended/fees-probe.py
Captures go to .claude/survey-work/extended/.
"""

import collections
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import ccxt

WORK = Path(".claude/survey-work/extended")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
PAGES = {
    "fees": "https://docs.extended.exchange/extended-resources/trading/trading-fees-and-rebates.md",
    "restricted": "https://docs.extended.exchange/extended-resources/legal/restricted-countries.md",
}


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read().decode("utf-8", "replace")


def pages() -> None:
    print(f"## pages {stamp()}")
    for name, url in PAGES.items():
        status, body = fetch(url)
        (WORK / f"page-{name}.md").write_text(body)
        print(name, status, len(body), "bytes")
        for line in body.splitlines():
            if re.search(r"Taker|Maker|rebate if|Canada|United States|United Kingdom", line):
                print("  ", line.strip()[:200])


def ccxt_markets() -> None:
    print(f"## ccxt {stamp()}")
    ex = ccxt.extended({"enableRateLimit": True})
    print("ccxt", ccxt.__version__, "fees", ex.fees.get("trading", ex.fees), "rateLimit", ex.rateLimit)
    t0 = time.time()
    markets = ex.load_markets()
    print(f"load_markets {time.time() - t0:.1f} s, {len(markets)} markets")
    rows = list(markets.values())
    print("type and active", collections.Counter((m["type"], m["active"]) for m in rows))
    keep = [m for m in rows if m["swap"] and m["active"] and m["linear"] and m["quote"] in ("USDT", "USDC", "USD")]
    print("active linear swaps quoted in USDT, USDC or USD", len(keep))
    print("settle and quote of kept", collections.Counter((m["settle"], m["quote"]) for m in keep))
    print("contractSize of kept", collections.Counter(m["contractSize"] for m in keep))
    print("taker of kept", collections.Counter(m["taker"] for m in keep), "maker", collections.Counter(m["maker"] for m in keep))
    status = collections.Counter(m["info"]["status"] for m in keep)
    print("venue status behind active", status)
    rfq = collections.Counter(m["info"].get("isRfq") for m in keep)
    print("isRfq of kept", rfq)
    for sym in ("BTC/USDC:USDC", "ETH/USDC:USDC", "KFLOKI/USDC:USDC", "1000PEPE/USDC:USDC", "TSLA_24_5/USDC:USDC", "XAU/USDC:USDC", "BTC/USDC"):
        m = markets.get(sym)
        if m:
            print(sym, "id", m["id"], "base", m["base"], "baseId", m["baseId"], "quote", m["quote"], "type", m["type"], "contractSize", m["contractSize"], "taker", m["taker"], "maker", m["maker"], "precision", m["precision"])
        else:
            print(sym, "absent")
    kn = sorted(m["symbol"] for m in keep if m["baseId"][:1] == "k" and m["baseId"][1:2].isupper())
    print("k-prefixed symbols", kn)
    case = sorted((m["baseId"], m["base"]) for m in keep if m["baseId"] != m["base"])
    print("baseId differing from base", case)
    bases = collections.Counter(m["base"] for m in keep)
    print("bases listed twice", [b for b, n in bases.items() if n > 1])
    (WORK / "ccxt-dump.json").write_text(json.dumps(sorted([m["id"], m["symbol"], m["base"], m["contractSize"], m["active"]] for m in keep), indent=0))


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    pages()
    print()
    ccxt_markets()
