# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and coverage probe for FreiExchange.

Modes, all by default, or name some on the command line:
    page      the public fee page, its headline sentence, the /pages/fees_data table it loads,
              the about page, the fee page of the sister site FreiXLite,
              and the LTC_BTC market page, searched for any fee term in its order form
    coverage  CoinMarketCap's exchange record, its perpetual pair list and derivatives ranking,
              CoinGecko's derivatives and exchange lists, and CCXT's current exchange ids on GitHub

Every call is unauthenticated and the probe waits 2 s between calls.

Run from the repository root:
    uv run scripts/probes/venues/freiexchange/fees-probe.py [mode ...]
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

SITE = "https://freiexchange.com"
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json, text/html"}
GAP_S = 2.0
_last = [0.0]


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def get(url: str) -> tuple[int, bytes]:
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read()
    _last[0] = time.monotonic()
    return status, body


def text_of(b: bytes) -> str:
    t = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", b.decode(errors="replace"))
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t))).strip()


def page_mode() -> None:
    s, b = get(SITE + "/pages/fees")
    t = text_of(b)
    m = re.search(r"Withdrawal fees and real-time status for all listed coins\. [^.]*\.", t)
    out(mode="page", call="GET /pages/fees", status=s, bytes=len(b), headline=m.group(0) if m else None,
        table_source=re.search(r'"ajax":\s*([^,]+)', b.decode(errors="replace")).group(1) if b"ajax" in b else None)
    s, b = get(SITE + "/pages/fees_data")
    rows = json.loads(b)["data"]
    fees = sorted({r["fee"] for r in rows}, key=float)
    out(mode="page", call="GET /pages/fees_data", status=s, rows=len(rows), fields=sorted(rows[0].keys()),
        coins_with_market=len([r for r in rows if r["market"] != "0"]),
        basecoins=sorted({r["basecoin"] for r in rows if r["basecoin"]}),
        withdrawal_fee_values=fees, status_values=sorted({r["status"] for r in rows}),
        deposits_paused=len([r for r in rows if r["deposits_paused"] != "0"]),
        samples={r["coin"]: r["fee"] for r in rows if r["coin"] in ("BTC", "LTC", "DOGE", "FRC")})
    s, b = get("https://freixlite.com/pages/fees")
    t = text_of(b)
    m = re.search(r"Withdrawal fees[^.]*\. [^.]*\.", t)
    out(mode="page", call="GET https://freixlite.com/pages/fees", status=s, bytes=len(b), headline=m.group(0) if m else t[:300])
    s, b = get(SITE + "/market/LTC/BTC")
    page = b.decode(errors="replace")
    fee_words = [m.group(0) for m in re.finditer(r"(?i)[a-z_/]*(fee|commission)[a-z_/]*", page) if not re.fullmatch(r"(?i).*(feed|pages/fees).*", m.group(0))]
    total = re.search(r"\$\('#' \+ side \+ '_total'\)\.val\(([^;]*)\);", page)
    out(mode="page", call="GET /market/LTC/BTC", status=s, bytes=len(b), fee_words_outside_footer_and_chart=fee_words,
        order_total_formula=total.group(1) if total else None)
    s, b = get(SITE + "/pages/about")
    t = text_of(b)
    out(mode="page", call="GET /pages/about", status=s, operator_named=bool(re.search(r"\b(Ltd|LLC|GmbH|Inc|S\.A\.|registered)\b", t)),
        about=re.search(r"FreiExchange is a [^.]*\.", t).group(0) if "FreiExchange is a" in t else None)


def coverage_mode() -> None:
    s, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=freiexchange")
    d = json.loads(b).get("data") or {}
    q = (d.get("quote") or {}).get("2781") or {}
    out(mode="coverage", call="CoinMarketCap exchange detail", status=s, id=d.get("id"), name=d.get("name"), status_field=d.get("status"),
        date_launched=d.get("dateLaunched"), countries=d.get("countries"), maker_fee=d.get("makerFee"), taker_fee=d.get("takerFee"),
        fee_url=(d.get("urls") or {}).get("fee"), spot_volume_usd=q.get("spotVolume24h"),
        perpetual_volume_usd=q.get("perpetualVolume24h"), futures_volume_usd=q.get("futuresVolume24h"))
    for cat in ("spot", "perpetual"):
        s, b = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=freiexchange&category={cat}&start=1&limit=100")
        j = json.loads(b).get("data") or {}
        out(mode="coverage", call=f"CoinMarketCap market pairs, category {cat}", status=s, num_market_pairs=j.get("numMarketPairs"),
            returned=len(j.get("marketPairs") or []), sample=[p.get("marketPair") for p in (j.get("marketPairs") or [])[:5]])
    s, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2&start=1&limit=200")
    rows = (json.loads(b).get("data") or {}).get("exchanges") or []
    out(mode="coverage", call="CoinMarketCap derivatives ranking exType=2", status=s, venues=len(rows),
        freiexchange_listed=any("frei" in (r.get("slug") or "").lower() for r in rows))
    s, b = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    if s == 200:
        rows = json.loads(b)
        out(mode="coverage", call="CoinGecko derivatives exchanges list", status=s, venues=len(rows),
            freiexchange_listed=[r for r in rows if "frei" in (r.get("id") or "").lower()])
    else:
        out(mode="coverage", call="CoinGecko derivatives exchanges list", status=s, body=b[:200].decode(errors="replace"))
    s, b = get("https://api.coingecko.com/api/v3/exchanges/list")
    if s == 200:
        rows = json.loads(b)
        out(mode="coverage", call="CoinGecko exchanges list", status=s, venues=len(rows),
            freiexchange_rows=[r for r in rows if "frei" in r["id"].lower() or "frei" in r["name"].lower()])
    else:
        out(mode="coverage", call="CoinGecko exchanges list", status=s, body=b[:200].decode(errors="replace"))
    s, b = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    if s == 200:
        ids = json.loads(b).get("ids") or []
        out(mode="coverage", call="CCXT master exchanges.json", status=s, ids=len(ids), freiexchange_ids=[i for i in ids if "frei" in i])
    else:
        out(mode="coverage", call="CCXT master exchanges.json", status=s)
    for f in ("ts/src/freiexchange.ts", "js/src/freiexchange.js"):
        s, b = get("https://raw.githubusercontent.com/ccxt/ccxt/master/" + f)
        out(mode="coverage", call="CCXT master " + f, status=s)


def main() -> None:
    modes = sys.argv[1:] or ["page", "coverage"]
    out(probe="freiexchange fees", started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=modes)
    for m in modes:
        {"page": page_mode, "coverage": coverage_mode}[m]()


if __name__ == "__main__":
    main()
