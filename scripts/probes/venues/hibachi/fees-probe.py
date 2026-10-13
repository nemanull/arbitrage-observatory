# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""Read-only probe of Hibachi fees, the fee fields of the public API, and what CCXT 4.5.68 reports.

Modes: ccxt (about 5 s), feeconfig (about 2 s), docs (about 3 s), and all of them in turn by default.
Run from the repository root: uv run scripts/probes/venues/hibachi/fees-probe.py [mode]
Captures go to .claude/survey-work/hibachi/.
No credentials are used, and nothing is signed or ordered.
"""

import json
import re
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/hibachi")
DATA = "https://data-api.hibachi.xyz"
DOCS = "https://docs.hibachi.xyz/hibachi-docs/trading"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def get(url: str) -> tuple[int, bytes, float]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
        return r.status, body, (time.perf_counter() - t0) * 1000


def ppm(x) -> str:
    return "undefined" if x is None else f"{round(float(x) * 1_000_000)}"


def mode_ccxt() -> None:
    import ccxt

    print(f"[ccxt] {now()} ccxt {ccxt.__version__}")
    ex = ccxt.hibachi()
    print(f"[ccxt] describe fees.trading: {json.dumps(ex.fees['trading'], default=str)}")
    t0 = time.perf_counter()
    markets = ex.load_markets()
    print(f"[ccxt] load_markets {len(markets)} markets in {(time.perf_counter() - t0) * 1000:.0f} ms")
    kinds = Counter()
    for m in markets.values():
        kinds[(m["type"], m["linear"], m["quote"], m["settle"], m["active"])] += 1
    for k, v in sorted(kinds.items(), key=str):
        print(f"[ccxt] type={k[0]} linear={k[1]} quote={k[2]} settle={k[3]} active={k[4]}: {v}")
    active = [m for m in markets.values() if m["swap"] and m["linear"] and m["active"] and m["quote"] in ("USDT", "USDC", "USD")]
    print(f"[ccxt] active linear swaps quoted in USDT, USDC or USD: {len(active)}")
    for m in sorted(active, key=lambda m: m["info"]["id"]):
        print(
            f"[ccxt] {m['symbol']:<18} id={m['id']:<14} numericId={m['numericId']} base={m['base']} contractSize={m['contractSize']} "
            f"taker={m.get('taker')} ({ppm(m.get('taker'))} ppm) maker={m.get('maker')} ({ppm(m.get('maker'))} ppm) "
            f"precision.price={m['precision']['price']} precision.amount={m['precision']['amount']} category={m['info'].get('category')}"
        )
    inactive = [m["id"] for m in markets.values() if not m["active"]]
    print(f"[ccxt] inactive rows: {len(inactive)} {inactive}")
    btc = markets.get("BTC/USDT:USDT")
    if btc:
        print(f"[ccxt] BTC/USDT:USDT market.taker={btc.get('taker')} market.maker={btc.get('maker')} percentage={btc.get('percentage')} tierBased={btc.get('tierBased')}")
    fr = ex.fetch_funding_rate("BTC/USDT:USDT")
    print(f"[ccxt] fetch_funding_rate BTC: fundingRate={fr['fundingRate']} fundingTimestamp={fr['fundingTimestamp']} ({fr['fundingDatetime']}) interval={fr['interval']} markPrice={fr['markPrice']} indexPrice={fr['indexPrice']}")
    (WORK / "fees-ccxt-markets.json").write_text(json.dumps({k: v["info"] for k, v in markets.items()}, indent=1))


def mode_feeconfig() -> None:
    for path in ("/market/exchange-info", "/market/inventory"):
        status, body, ms = get(DATA + path)
        d = json.loads(body)
        print(f"[feeconfig] {now()} GET {path} {status} {len(body)} bytes {ms:.0f} ms")
        fc = d.get("feeConfig", {})
        for k in ("tradeTakerFeeRate", "tradeMakerFeeRate", "transferFeeRate", "depositFees", "withdrawalFees", "instantWithdrawalFees"):
            v = fc.get(k)
            extra = f" = {ppm(v)} ppm" if k.startswith("trade") or k == "transferFeeRate" else ""
            print(f"[feeconfig]   {k}: {json.dumps(v)}{extra}")
        if "tradingTiers" in d:
            tiers = d["tradingTiers"]
            print(f"[feeconfig]   tradingTiers: {len(tiers)} rows, keys {sorted(set(k for t in tiers for k in t))}")
            for t in tiers[:3] + tiers[-1:]:
                print(f"[feeconfig]     {json.dumps(t)}")
        (WORK / f"fees-{path.strip('/').replace('/', '-')}.json").write_text(json.dumps(d, indent=1))


def mode_docs() -> None:
    for page in ("fees", "limits", "funding"):
        status, body, ms = get(f"{DOCS}/{page}.md")
        text = body.decode("utf-8", "replace")
        print(f"[docs] {now()} GET {DOCS}/{page}.md {status} {len(body)} bytes {ms:.0f} ms")
        (WORK / f"docs-{page}.md").write_text(text)
        if page == "fees":
            for line in text.splitlines():
                if re.match(r"\|\s*\d+\s*\|", line):
                    print(f"[docs]   tier row: {line.strip()}")
            for line in text.splitlines():
                if "14-day" in line.lower() or "00:00 UTC" in line or "03:00 UTC" in line:
                    print(f"[docs]   rule: {line.strip()}")
        if page == "limits":
            for line in text.splitlines():
                if "Funding Rate Limits" in line or "requests / 10 seconds" in line:
                    print(f"[docs]   {line.strip()}")
        if page == "funding":
            for line in text.splitlines():
                if "every hour" in line or "Funding Rate =" in line or "clamp(" in line:
                    print(f"[docs]   {line.strip()}")


MODES = {"ccxt": mode_ccxt, "feeconfig": mode_feeconfig, "docs": mode_docs}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    chosen = sys.argv[1:] or list(MODES)
    for name in chosen:
        MODES[name]()
