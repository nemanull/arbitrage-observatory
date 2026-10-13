# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27,<1", "ccxt==4.5.68"]
# ///
"""Read-only fee probe for ApeX Omni: the published tier table and what CCXT 4.5.68 reports.

Public and unauthenticated. It reads two documentation pages and one CCXT loadMarkets.

Run from the repository root:
    uv run scripts/probes/venues/apex/fees-probe.py [page|ccxt]

Modes:
    page  the Markdown of the fee page and the VIP page: the tier rows, the funding sentences, and the redirect from CCXT's fee URL.
    ccxt  CCXT's market taker and maker for every active swap, and fees.swap, without credentials.

Captures go to .claude/survey-work/apex/ unless PROBE_OUT_DIR names another folder.
Recorded in docs/profiles/apex/fees.md.
"""

import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx

DOCS = "https://apex-pro.gitbook.io/apex-pro"
CCXT_FEE_URL = "https://apex-pro.gitbook.io/apex-pro/apex-omni-live-now/trading-perpetual-contracts/trading-fees"
REPO = Path(__file__).resolve().parents[4]
OUT = Path(os.environ.get("PROBE_OUT_DIR", REPO / ".claude/survey-work/apex"))
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def log(tag, **kw):
    print(json.dumps({"tag": tag, **kw}, default=str), flush=True)


def mode_page():
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, headers={"User-Agent": "observatory-probe"}) as c:
        r = c.get(CCXT_FEE_URL)
        log("ccxt_fee_url", status=r.status_code, location=r.headers.get("location"))
        for page in ("apex-omni/trading-and-funding-fees", "apex-omni/vip-program", "apex-omni/tradfi-perpetuals", "apex-omni/price-markers"):
            r = c.get(f"{DOCS}/{page}.md", follow_redirects=True)
            text = r.text
            (OUT / f"fees-{page.split('/')[-1]}-{STAMP}.md").write_text(text)
            rows = [line for line in text.splitlines() if re.match(r"^\|\s*\d+\s*\|", line)]
            hits = [line.strip() for line in text.splitlines() if re.search(r"(?i)taker|maker|funding (settles|rate \(f\))|caps|every hour|effective", line)]
            log("page", page=page, status=r.status_code, bytes=len(text), tier_rows=rows, lines=hits[:14])


def mode_ccxt():
    import ccxt

    ex = ccxt.apex()
    mk = ex.load_markets()
    swaps = [m for m in mk.values() if m.get("swap") and m.get("active") is not False]
    btc = mk["BTC/USDT:USDT"]
    log("ccxt_fees", version=ccxt.__version__, swaps=len(swaps), market_taker=dict(Counter(m["taker"] for m in swaps)), market_maker=dict(Counter(m["maker"] for m in swaps)), fees_swap=ex.fees.get("swap"), btc_taker=btc["taker"], btc_maker=btc["maker"], btc_taker_ppm=round(btc["taker"] * 1e6), btc_maker_ppm=round(btc["maker"] * 1e6))


MODES = {"page": mode_page, "ccxt": mode_ccxt}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "page"
    log("start", mode=mode, utc=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    MODES[mode]()
    log("end", mode=mode, utc=datetime.now(timezone.utc).isoformat(timespec="seconds"))
