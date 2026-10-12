# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and coverage probe for Metal X.

Modes, all by default, or name some on the command line:
    markets  the maker_fee and taker_fee of every market in markets/all, and the market types present.
    trades   fee fields of recent XPR_XMD and XBTC_XMD trades, as fee over amount, to see the charged rate on the wire.
    docs     the published fee table on docs.metalx.com, reduced to its rows.
    coverage CoinMarketCap's exchange record and pair counts by category, and CoinGecko's derivatives venue list.
    ccxt     whether CCXT 4.5.68 in node_modules or the current CCXT master on GitHub has a class for Metal X.

Run from the repository root:
    uv run scripts/probes/venues/metal-x/fees-probe.py [mode ...]
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

REST = "https://dex.api.mainnet.metalx.com/dex/v1"
DOCS = "https://docs.metalx.com/dex/what-is-metal-x/dex-fees-and-discounts.md"
CCXT_DIR = os.path.join(os.path.dirname(__file__), "../../../../node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
GITHUB = "https://api.github.com/repos/ccxt/ccxt"
KEYS = ("metal", "proton", "xpr")
CMC = "https://api.coinmarketcap.com/data-api/v3"


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except ValueError:
        return body


def mode_markets() -> None:
    rows = get(f"{REST}/markets/all")["data"]
    out(mode="markets", count=len(rows), types=sorted({x["type"] for x in rows}))
    groups: dict = {}
    for x in rows:
        groups.setdefault((x["maker_fee"], x["taker_fee"]), []).append(x["symbol"])
    for (mk, tk), syms in groups.items():
        out(mode="markets", maker_fee=mk, taker_fee=tk, markets=len(syms), symbols=syms if len(syms) < 4 else syms[:3] + ["..."])


def mode_trades() -> None:
    for sym in ("XPR_XMD", "XBTC_XMD"):
        rows = get(f"{REST}/trades/recent?symbol={sym}&offset=0&limit=100")["data"]
        rates = []
        for t in rows:
            for side in ("bid", "ask"):
                tot, fee = t[f"{side}_total"], t[f"{side}_fee"]
                if tot:
                    rates.append(round(fee / tot * 100, 4))
        counts: dict = {}
        for r in rates:
            counts[r] = counts.get(r, 0) + 1
        out(mode="trades", symbol=sym, trades=len(rows), fee_percent_of_total=dict(sorted(counts.items(), key=lambda x: -x[1])[:6]),
            sample={k: rows[0][k] for k in ("bid_total", "bid_amount", "bid_fee", "ask_total", "ask_amount", "ask_fee", "order_side")} if rows else None)


def mode_docs() -> None:
    text = get(DOCS)
    tables = re.findall(r"<table>.*?</table>", text, flags=re.S)
    for i, t in enumerate(tables[:2]):
        rows = [[re.sub(r"<[^>]+>", "", c).replace("&#x3C;", "<").strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r)]
                for r in re.findall(r"<tr>(.*?)</tr>", t, flags=re.S)]
        out(mode="docs", table=["volume", "staking"][i], rows=rows)
    for phrase in ("highest discount", "0% Trading Fees on XBTC", "DEX Key"):
        m = re.search(rf".{{0,80}}{re.escape(phrase)}.{{0,160}}", text)
        out(mode="docs", phrase=phrase, context=m.group(0).replace("\n", " ") if m else None)


def mode_coverage() -> None:
    d = get(f"{CMC}/exchange/detail?slug=metal-x").get("data") or {}
    keep = ["id", "name", "slug", "makerFee", "takerFee", "spotVolumeUsd", "derivativesVolumeUsd", "type", "dateLaunched", "numMarketPairs"]
    out(mode="coverage", source="coinmarketcap detail", **{k: d.get(k) for k in keep if k in d})
    for cat in ("spot", "perpetual", "futures"):
        time.sleep(1.5)
        try:
            j = get(f"{CMC}/exchange/market-pairs/latest?slug=metal-x&category={cat}&start=1&limit=100").get("data") or {}
        except urllib.error.HTTPError as e:
            out(mode="coverage", source=f"coinmarketcap {cat} pairs", status=e.code)
            continue
        pairs = j.get("marketPairs") or []
        out(mode="coverage", source=f"coinmarketcap {cat} pairs", numMarketPairs=j.get("numMarketPairs"),
            pairs=[p.get("marketPair") for p in pairs][:30])
    time.sleep(1.5)
    venues = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    hits = [v for v in venues if any(k in (v.get("id", "") + v.get("name", "")).lower() for k in ("metal", "proton", "xpr"))]
    out(mode="coverage", source="coingecko derivatives list", venues=len(venues), hits=hits)


def mode_ccxt() -> None:
    local = sorted(f for f in os.listdir(CCXT_DIR) if f.endswith(".js"))
    out(mode="ccxt", installed_files=len(local), matches=[f for f in local if any(k in f.lower() for k in KEYS)])
    try:
        sha = get(f"{GITHUB}/commits/master")["sha"]
        names = [x["name"] for x in get(f"{GITHUB}/contents/ts/src?ref={sha}") if isinstance(x, dict)]
        out(mode="ccxt", github_master=sha, ts_files=len([n for n in names if n.endswith(".ts")]),
            matches=[n for n in names if any(k in n.lower() for k in KEYS)])
    except urllib.error.HTTPError as e:
        out(mode="ccxt", github_error=e.code)


MODES = {"markets": mode_markets, "trades": mode_trades, "docs": mode_docs, "coverage": mode_coverage, "ccxt": mode_ccxt}

if __name__ == "__main__":
    chosen = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODES)
    for m in chosen:
        MODES[m]()
