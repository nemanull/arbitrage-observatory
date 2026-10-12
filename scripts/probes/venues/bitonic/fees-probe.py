# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for Bitonic.

Modes, all by default, or name some on the command line:
    pricing  the English pricing page, with the trading, Instant, Auto Invest and OTC fee lines
    markup   /api/prices/v1/last-price next to /api/buy and /api/sell for 1 BTC, and the markup each quote carries
    smallbuy /api/buy for 1 BTC and for 100 EUR, to show the fixed iDEAL charge inside the quote
    listing  CoinMarketCap's exchange detail and market pairs for the slug bitonic, and the news item on BL3P
    ccxt     the installed CCXT 4.5.68 class files and the current CCXT master id list, searched for bitonic and bl3p

Bitonic is a broker with no maker or taker book, so there is no VIP 0 taker on a book to read.
The probe waits 7 s between calls, because the API page asks for at most 10 requests per minute.

Run from the repository root:
    uv run scripts/probes/venues/bitonic/fees-probe.py [mode ...]
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

SITE = "https://bitonic.nl"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html"}
GAP_S = 7.0
_last = [0.0]


def get(path: str) -> tuple[int, bytes, float]:
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(SITE + path, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read()
    _last[0] = time.monotonic()
    return status, body, time.time()


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def text_of(body: bytes) -> list[str]:
    t = body.decode(errors="replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    t = t.replace("\xa0", " ")
    return [ln.strip() for ln in t.split("\n") if ln.strip()]


def after(lines: list[str], label: str, n: int = 1, start: int = 0) -> list[str]:
    for i in range(start, len(lines)):
        if lines[i] == label:
            return lines[i + 1:i + 1 + n]
    return []


def mode_pricing() -> None:
    s, b, _ = get("/en/pricing")
    lines = text_of(b)
    i_trade = lines.index("Trading fees") if "Trading fees" in lines else 0
    i_instant = lines.index("Instant") if "Instant" in lines else 0
    i_sell = lines.index("Fees for selling") if "Fees for selling" in lines else 0
    i_otc = lines.index("OTC") if "OTC" in lines else 0
    otc = []
    for i in range(i_otc, len(lines) - 1):
        if lines[i].startswith("≥"):
            otc.append((lines[i], lines[i + 1]))
    out(mode="pricing", call="GET /en/pricing", status=s,
        trading_fees={"buy": after(lines, "Buy", 1, i_trade), "sell": after(lines, "Sell", 1, i_trade)},
        volume_note=[ln for ln in lines if ln.startswith("Depending on the trading volume")],
        instant_buy={"service_charge": after(lines, "Service charge", 1, i_instant), "ideal": after(lines, "iDEAL | Wero", 1, i_instant),
                     "bancontact": after(lines, "Bancontact", 1, i_instant)},
        instant_sell={"service_charge": after(lines, "Service charge", 1, i_sell), "sepa": after(lines, "SEPA costs", 1, i_sell)},
        auto_invest=[ln for ln in lines if ln.startswith("0 % up to")],
        otc_tiers=otc,
        referral=[ln for ln in lines if "referral" in ln.lower()][:2])


def mode_markup() -> None:
    s1, b1, t1 = get("/api/prices/v1/last-price")
    s2, b2, t2 = get("/api/buy")
    s3, b3, t3 = get("/api/sell")
    last = json.loads(b1)["data"]
    buy = json.loads(b2)["price"]
    sell = json.loads(b3)["price"]
    lb, ls = float(last["buy_price"]), float(last["sell_price"])
    out(mode="markup", last_price=last, last_price_at=round(t1, 1), api_buy_1btc=buy, api_buy_at=round(t2, 1),
        api_sell_1btc=sell, api_sell_at=round(t3, 1),
        buy_markup_pct=round((buy / lb - 1) * 100, 3), sell_markdown_pct=round((1 - sell / ls) * 100, 3),
        last_price_spread_pct=round((lb / ls - 1) * 100, 3), api_round_trip_pct=round((buy / sell - 1) * 100, 3),
        note="quotes are 7 s apart, so part of each markup is price movement")


def mode_smallbuy() -> None:
    s1, b1, _ = get("/api/buy")
    s2, b2, _ = get("/api/buy?eur=100")
    p1 = json.loads(b1)["price"]
    p2 = json.loads(b2)["price"]
    out(mode="smallbuy", buy_1btc=json.loads(b1), buy_100eur=json.loads(b2),
        extra_pct_on_100eur=round((p2 / p1 - 1) * 100, 3),
        implied_fixed_eur=round(100 - 100 * p1 / p2, 2), note="the pricing page names a fixed EUR 0.51 iDEAL charge")


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def mode_listing() -> None:
    cmc = "https://api.coinmarketcap.com/data-api/v3/exchange"
    d = fetch_json(cmc + "/detail?slug=bitonic")["data"]
    out(mode="listing", call="CMC exchange detail", name=d.get("name"), status=d.get("status"), date_launched=d.get("dateLaunched"),
        description=d.get("description"), fee_url=d.get("urls", {}).get("fee"), maker_fee=d.get("makerFee"), taker_fee=d.get("takerFee"),
        tags=[t.get("name") for t in d.get("tags", [])], quote_btc=d.get("quote", {}).get("1"))
    d = fetch_json(cmc + "/market-pairs/latest?slug=bitonic&category=spot&start=1&limit=10")["data"]
    pairs = [{k: m.get(k) for k in ("marketPair", "category", "quote", "volumeBase", "marketUrl", "priceExcluded", "volumeExcluded", "lastUpdated")}
             for m in d.get("marketPairs", [])]
    out(mode="listing", call="CMC market pairs", num_market_pairs=d.get("numMarketPairs"), pairs=pairs)
    s, b, _ = get("/en/news/301")
    lines = text_of(b)
    i = next((k for k, ln in enumerate(lines) if ln.startswith("Published on")), 0)
    out(mode="listing", call="GET /en/news/301", status=s, lines=lines[i:i + 8])


def mode_ccxt() -> None:
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[4]
    src = root / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
    names = sorted(p.stem for p in src.glob("*.js")) if src.is_dir() else []
    hits = [n for n in names if "bitonic" in n or "bl3p" in n]
    out(mode="ccxt", installed_dir=str(src.relative_to(root)), js_files=len(names), matches=hits)
    ids = fetch_json("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")["ids"]
    out(mode="ccxt", call="CCXT master exchanges.json", ids=len(ids), matches=[i for i in ids if "bitonic" in i or "bl3p" in i])
    for name in ("bitonic", "bl3p"):
        req = urllib.request.Request(f"https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/{name}.ts", headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            status = e.code
        out(mode="ccxt", call=f"CCXT master ts/src/{name}.ts", status=status)


MODES = {"pricing": mode_pricing, "markup": mode_markup, "smallbuy": mode_smallbuy, "listing": mode_listing, "ccxt": mode_ccxt}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    out(probe="bitonic fees", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for name in picked:
        MODES[name]()
