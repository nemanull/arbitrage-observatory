# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""Read-only public fee and coverage probe for Ndax.

Modes, all by default, or name some on the command line:
    page      https://ndax.io/fees, its redirect, and the fee, operator, regulator and residency lines the page carries.
    coverage  CoinMarketCap's exchange record and its spot, perpetual and futures pair lists, and CoinGecko's derivatives venue list.
    private   the fee calls CCXT lists as private, sent without credentials, to record the refusal.
    ccxt      CCXT 4.5.68's Python ndax class: loadMarkets without credentials, taker and maker on every market, market types, ids, and which instrument a pair listed twice maps to.

Run from the repository root:
    uv run scripts/probes/venues/ndax/fees-probe.py [mode ...]
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}
CMC = "https://api.coinmarketcap.com/data-api/v3"


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def get(url: str) -> tuple[int, str, str]:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, e.read().decode("utf-8", "replace")


def text_of(page: str) -> list[str]:
    s = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    s = html.unescape(re.sub(r"<[^>]+>", "\n", s))
    return [x.strip() for x in s.split("\n") if x.strip()]


def mode_page() -> None:
    status, final, page = get("https://ndax.io/fees")
    out(mode="page", status=status, final_url=final, bytes=len(page))
    lines = text_of(page)
    for line in lines:
        if re.search(r"0\.\d+%|maker|taker|tier|volume", line, re.I) and len(line) < 400:
            out(mode="page", line=line)
    for m in re.finditer(r'"(legalName|name|alternateName|foundingDate)":"([^"]{1,80})"', page):
        out(mode="page", org_field=m.group(1), value=m.group(2))
        if m.group(1) == "foundingDate":
            break
    m = re.search(r'"address":\{"@type":"PostalAddress","streetAddress":"([^"]+)","addressLocality":"([^"]+)","addressRegion":"([^"]+)"', page)
    out(mode="page", address=m.groups() if m else None)
    for pat in [r"Canadian residents only[^.<\\]*", r"Canadian Investment Regulatory Organization \(CIRO\)", r"Financial Transactions and Reports Analysis Centre of Canada \(FINTRAC\)",
                r"Order Execution Only \(OEO\)", r"CIPF's Investment Dealer Fund"]:
        m = re.search(pat, page)
        out(mode="page", pattern=pat, found=m.group(0) if m else None)


def mode_coverage() -> None:
    status, _, body = get(f"{CMC}/exchange/detail?slug=ndax")
    d = (json.loads(body).get("data") or {}) if status == 200 else {}
    keep = ["id", "name", "makerFee", "takerFee", "spotVolumeUsd", "derivativesVolumeUsd", "perpetualVolume24h", "futuresVolume24h",
            "countries", "fiats", "type", "dateLaunched", "numMarketPairs"]
    out(mode="coverage", source="coinmarketcap detail", status=status, **{k: d.get(k) for k in keep if k in d})
    for cat in ("spot", "perpetual", "futures"):
        time.sleep(1.5)
        status, _, body = get(f"{CMC}/exchange/market-pairs/latest?slug=ndax&category={cat}&start=1&limit=100")
        j = json.loads(body).get("data") or {} if status == 200 else {}
        out(mode="coverage", source=f"coinmarketcap {cat} pairs", status=status, numMarketPairs=j.get("numMarketPairs"),
            quotes=j.get("quotes"))
    time.sleep(1.5)
    status, _, body = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    venues = json.loads(body) if status == 200 else []
    hits = [v for v in venues if "ndax" in (v.get("id", "") + v.get("name", "")).lower()]
    out(mode="coverage", source="coingecko derivatives list", status=status, venues=len(venues), ndax_hits=hits)


def mode_private() -> None:
    for path in ["GetOmsFeeTiers?OMSId=1", "GetOrderFee?OMSId=1&AccountId=1&InstrumentId=1&Quantity=1&Side=0&OrderType=2&MakerTaker=Taker"]:
        status, _, body = get(f"https://api.ndax.io:8443/AP/{path}")
        out(mode="private", path=path, status=status, body=body[:200])
        time.sleep(1.2)


def mode_ccxt() -> None:
    import ccxt

    ex = ccxt.ndax()
    out(mode="ccxt", version=ccxt.__version__, fees_trading=ex.fees["trading"], has_swap=ex.has.get("swap"), has_future=ex.has.get("future"))
    markets = ex.load_markets()
    rows = list(markets.values())
    takers = sorted({m["taker"] for m in rows})
    makers = sorted({m["maker"] for m in rows})
    types = sorted({m["type"] for m in rows})
    out(mode="ccxt", markets=len(rows), ids_total=len(ex.markets_by_id), types=types, takers=takers, makers=makers,
        active=sum(1 for m in rows if m["active"]), contract_size=sorted({str(m["contractSize"]) for m in rows}),
        linear=sorted({str(m["linear"]) for m in rows}))
    btc = markets["BTC/CAD"]
    out(mode="ccxt", btc_cad_id=btc["id"], taker=btc["taker"], maker=btc["maker"], precision=btc["precision"], limits_amount=btc["limits"]["amount"])
    for sym in ("AAVE/CAD", "POL/CAD", "RENDER/CAD"):
        m = markets.get(sym)
        all_ids = [k for k, v in ex.markets_by_id.items() for mm in v if mm["symbol"] == sym]
        out(mode="ccxt", pair=sym, symbol_maps_to=f'{m["id"]}:{m["info"]["Symbol"]}' if m else None, ids_with_symbol=all_ids)


MODES = {"page": mode_page, "coverage": mode_coverage, "private": mode_private, "ccxt": mode_ccxt}

if __name__ == "__main__":
    picked = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODES)
    out(start=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for name in picked:
        MODES[name]()
