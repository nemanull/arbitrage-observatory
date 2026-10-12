# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for Binibit, public sources only.

Modes, all by default, or name some on the command line:
    futures  makerFeeRate and takerFeeRate per contract from /api/futures-public/contracts, and the bundle's fee arithmetic
    spot     the per pair trade commission the web app reads from internal-api-v2stage, and the documented commissions call
    page     the /en/fees page text and the futures terminal text that says trading is disabled
    legal    the Terms of Service and Prohibited Use clauses on restricted persons and the operator
    cmc      CoinMarketCap's exchange record and its spot, perpetual and futures pair counts
    ccxt     the installed CCXT 4.5.68 source folder, searched for a Binibit class, and CCXT master on GitHub

Every call is unauthenticated, about 15 requests in all, at least 1.0 s apart per host.

Run from the repository root:
    uv run scripts/probes/venues/binibit/fees-probe.py [mode ...]
"""

import collections
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SITE = "https://binibit.com"
STAGE = "https://internal-api-v2stage.binibit.com"
PUBLIC = "https://public-api.binibit.com"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"
CCXT_SRC = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}


def get(url: str) -> tuple[int, bytes]:
    time.sleep(1.0)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def text_of(page: bytes) -> list[str]:
    t = page.decode(errors="replace")
    t = re.sub(r"<script.*?</script>", "", t, flags=re.S)
    t = re.sub(r"<style.*?</style>", "", t, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    return [x.strip() for x in t.split("\n") if x.strip()]


def futures() -> None:
    print("== futures")
    s, b = get(SITE + "/api/futures-public/contracts")
    rows = json.loads(b)["data"]
    pairs = collections.Counter((r["makerFeeRate"], r["takerFeeRate"]) for r in rows)
    print(f"status={s} contracts={len(rows)} (maker, taker) counts={dict(pairs)}")
    for (mk, tk), n in pairs.items():
        print(f"  read as fractions: maker {float(mk) * 100:.3f} % = {round(float(mk) * 1e6)} ppm, taker {float(tk) * 100:.3f} % = {round(float(tk) * 1e6)} ppm, on {n} contracts")
    s, b = get(SITE + "/en/futures/BTC_USDT")
    src = re.findall(r'src="(/_next/static/chunks/app/[^"]*futures[^"]*page-[^"]+?\.js[^"]*)"', b.decode(errors="replace"))
    if not src:
        print("futures page chunk not found in the HTML")
        return
    s, chunk = get(SITE + src[0])
    t = chunk.decode(errors="replace")
    m = re.search(r"let n=r/t,i=r\*a;return\{quantity:e,notional:r,initialMargin:n,fee:i", t)
    print(f"page chunk {src[0]} status={s} bytes={len(chunk)}")
    print("  fee arithmetic, where r is notional and a the fee rate:", t[m.start() - 60 : m.end() + 40] if m else "not found")
    for phrase in ("READ-ONLY PREVIEW", "Trading disabled", "No execution", "when Futures trading is enabled", "intentionally unavailable in this read-only stage", "not requested in F1.5"):
        print(f"  phrase in page chunk: {phrase!r} {phrase in t}")


def spot() -> None:
    print("== spot")
    s, b = get(STAGE + "/api/currency-pairs/commissions")
    d = json.loads(b)
    c = d["commissions"]
    pair_rows = [x for x in c if x.get("currencyPairCode")]
    print(f"stage status={s} rows={len(c)} pair rows={len(pair_rows)}")
    print("  pair rows by (type, percent, dealBid, dealAsk):", dict(collections.Counter((x["commissionTypeCode"], x["percent"], x["dealBid"], x["dealAsk"]) for x in pair_rows)))
    print("  other keys:", {k: v for k, v in d.items() if k != "commissions"})
    print("  sample:", pair_rows[:1])
    s, b = get(PUBLIC + "/api/currencies/commissions")
    print(f"documented /api/currencies/commissions status={s} body={b[:120]!r}")


def page() -> None:
    print("== page")
    s, b = get(SITE + "/en/fees")
    lines = text_of(b)
    i = next((k for k, x in enumerate(lines) if x == "Fees."), None)
    print(f"/en/fees status={s} lines around the heading:", lines[i : i + 5] if i is not None else "heading not found")
    print("  digits with a percent sign in the server HTML:", re.findall(r"\d+(?:\.\d+)?\s?%", " ".join(lines))[:10])
    s, b = get(SITE + "/en/futures/BTC_USDT")
    lines = text_of(b)
    keep = [x for x in lines if x in ("NEW", "BETA", "Funding", "No execution", "Futures order") or x.startswith("Max ") or "read-only" in x.lower()]
    print(f"/en/futures/BTC_USDT status={s} markers:", keep)
    raw = b.decode(errors="replace")
    for phrase in ("READ-ONLY PREVIEW", "Trading disabled", "when Futures trading is enabled", "intentionally unavailable in this read-only stage"):
        print(f"  phrase in server HTML: {phrase!r} {phrase in raw}")


def legal() -> None:
    print("== legal")
    for path in ("/en/legal/terms", "/en/legal/prohibited-use"):
        s, b = get(SITE + path)
        joined = " ".join(text_of(b))
        print(f"{path} status={s}")
        for pat in (r"Effective date: [0-9A-Za-z ]+ · Version: [0-9.]+", r"2\.2\. Restricted Persons\.[^;]{0,260}", r"Restricted Jurisdiction — [^.]{0,200}", r"2\.3\. [^.]{0,200}\.[^.]{0,120}", r"Mercantile Folio No\. \d+[^.]{0,120}"):
            m = re.search(pat, joined)
            if m:
                print("  ", m.group(0))


def cmc() -> None:
    print("== cmc")
    s, b = get(f"{CMC}/detail?slug=binibit")
    d = json.loads(b)["data"]
    print(f"detail status={s}", {k: d.get(k) for k in ("id", "name", "dateLaunched", "countries", "makerFee", "takerFee", "spotVolumeUsd", "derivativesVolumeUsd")})
    desc = d.get("description", "")
    for needle in ("0.10% maker", "does not support", "Panama", "restricted from"):
        i = desc.find(needle)
        print(f"  description: ...{desc[max(0, i - 60): i + 160]}..." if i >= 0 else f"  description lacks {needle!r}")
    for cat in ("spot", "perpetual", "futures"):
        s, b = get(f"{CMC}/market-pairs/latest?slug=binibit&category={cat}&start=1&limit=500")
        dd = json.loads(b).get("data") or {}
        print(f"pairs {cat}: status={s} numMarketPairs={dd.get('numMarketPairs')} listed={len(dd.get('marketPairs', []))}")


def ccxt() -> None:
    print("== ccxt")
    if not CCXT_SRC.exists():
        print("CCXT source folder missing:", CCXT_SRC)
        return
    files = [p.name for p in CCXT_SRC.glob("*.js")]
    print(f"{CCXT_SRC}: {len(files)} .js files, binibit.js present: {'binibit.js' in files}")
    hits = [p.name for p in CCXT_SRC.rglob("*.js") if "binibit" in p.read_text(errors="replace").lower()]
    print("files mentioning 'binibit' (case-insensitive):", hits)
    s, b = get("https://raw.githubusercontent.com/ccxt/ccxt/master/package.json")
    print("CCXT master version:", json.loads(b).get("version") if s == 200 else s)
    s, b = get("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/binibit.ts")
    print("CCXT master ts/src/binibit.ts status:", s)
    s, b = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src")
    names = [x["name"] for x in json.loads(b)] if s == 200 else []
    print(f"CCXT master ts/src entries={len(names)} names containing 'bini':", [n for n in names if "bini" in n.lower()])


MODES = {"futures": futures, "spot": spot, "page": page, "legal": legal, "cmc": cmc, "ccxt": ccxt}

if __name__ == "__main__":
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for m in sys.argv[1:] or list(MODES):
        MODES[m]()
