# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68", "httpx>=0.27"]
# ///
"""Read-only fee and catalog probe for Aster perpetuals.

Modes, all in turn by default, or name some on the command line:
    ccxt    CCXT 4.5.68's Python aster class: load_markets without credentials, the taker and maker it reports,
            contract sizes, ids, and the count of active linear perpetuals quoted in USDT, USDC or USD.
    pages   the fee and VIP pages of docs.asterdex.com in Markdown, their fee lines, and which kept markets fall in
            the Group B and RWA fee classes of those pages.

Public, unauthenticated, read-only calls only.
Run from the repository root:
    uv run scripts/probes/venues/aster/fees-probe.py [mode ...]
"""

import collections
import json
import re
import sys
import time

import ccxt
import httpx

FAMILY = ("USDT", "USDC", "USD")
DOCS = "https://docs.asterdex.com"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def mode_ccxt() -> None:
    ex = ccxt.aster()
    t0 = time.perf_counter()
    markets = ex.load_markets()
    out(mode="ccxt", version=ccxt.__version__, load_ms=round((time.perf_counter() - t0) * 1000), markets=len(markets),
        fees_trading=ex.fees.get("trading"))
    swaps = [m for m in markets.values() if m.get("swap")]
    kept = [m for m in swaps if m.get("active") and m.get("linear") and m.get("quote") in FAMILY]
    out(mode="ccxt", swaps=len(swaps), active_swaps=sum(1 for m in swaps if m.get("active")), kept=len(kept),
        kept_by_settle=collections.Counter(m.get("settle") for m in kept), inactive_swaps_by_status=collections.Counter(m["info"].get("status") for m in swaps if not m.get("active")),
        other_quote_active_swaps=sorted(m["id"] for m in swaps if m.get("active") and m.get("quote") not in FAMILY))
    out(mode="ccxt", taker=collections.Counter(m.get("taker") for m in kept), maker=collections.Counter(m.get("maker") for m in kept),
        contract_size=collections.Counter(m.get("contractSize") for m in kept), linear=collections.Counter(m.get("linear") for m in kept))
    for sym in ("BTC/USDT:USDT", "AAPL/USDT:USDT"):
        m = markets.get(sym)
        if m:
            out(mode="ccxt", symbol=sym, id=m["id"], base=m["base"], quote=m["quote"], settle=m["settle"], taker=m["taker"], maker=m["maker"], contractSize=m["contractSize"], active=m["active"])
    out(mode="ccxt", non_ascii_ids=[(m["id"], m["symbol"]) for m in kept if not m["id"].isascii()])
    out(mode="ccxt", id_not_symbol_base_quote=[m["id"] for m in kept if m["id"] != m["info"]["baseAsset"] + m["info"]["quoteAsset"]][:10])
    bases = collections.Counter(m["base"] for m in kept)
    out(mode="ccxt", base_twice_in_kept=sorted(b for b, n in bases.items() if n > 1), spot_markets=sum(1 for m in markets.values() if m.get("spot")))


def mode_pages() -> None:
    with httpx.Client(headers=UA, timeout=30, follow_redirects=True) as c:
        texts = {}
        for path in ("/trading/perpetuals/fees-and-specs/fees.md", "/program-and-rewards/vip-program.md"):
            r = c.get(DOCS + path)
            texts[path] = r.text
            out(mode="pages", path=path, status=r.status_code, bytes=len(r.content))
            for line in r.text.splitlines():
                if re.search(r"bps|%|Effective|Group B pairs|Pair List", line) and len(line) < 600:
                    out(mode="pages", path=path, line=line.strip())
        info = c.get("https://fapi.asterdex.com/fapi/v3/exchangeInfo").json()
    kept = {x["symbol"]: x for x in info["symbols"] if x["status"] == "TRADING" and x["quoteAsset"] in FAMILY and x["contractType"] == "PERPETUAL"}
    lists = re.findall(r"(?:Group B pairs include:|Group B Pair List:\*\*)\s*([^\n]+)", texts["/trading/perpetuals/fees-and-specs/fees.md"] + texts["/program-and-rewards/vip-program.md"])
    for i, raw in enumerate(lists):
        names = [n.strip(" .　") for n in re.split(r"[,，]", raw) if n.strip(" .")]
        out(mode="pages", group_b_list=i, listed=len(names), kept=sorted(n for n in names if n in kept), not_kept=sorted(n for n in names if n not in kept))
    rwa = [s for s, x in kept.items() if x.get("symbolType") == 1]
    out(mode="pages", kept_with_symbolType_1=len(rwa), channels=collections.Counter(kept[s].get("channel") for s in rwa), sample=sorted(rwa)[:12])


MODES = {"ccxt": mode_ccxt, "pages": mode_pages}

if __name__ == "__main__":
    for m in sys.argv[1:] or list(MODES):
        out(mode=m, started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        MODES[m]()
