# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and coverage probe for Coinmate.

Modes, all by default, or name some on the command line:
    zones     /frontend/fees/fee-zones, the JSON the coinmate.io/fees page renders, converted to ppm with the volume bands
    page      the coinmate.io/fees shell and the English strings in /assets/i18n/en.json that explain the tiers,
              plus the operator name and address, and the FAQ line that quotes a fee range
    countries /frontend/countries, the country list the web app loads, and whether a few named codes are on it
    private   POST /api/traderFees without a key, to show the per account fee call is signed
    coverage  CoinMarketCap's exchange record and market pair counts by category, and CoinGecko's derivatives venue list

Every call is unauthenticated and read-only, with at least 1 s between calls.

Run from the repository root:
    uv run scripts/probes/venues/coinmate/fees-probe.py [mode ...]
"""

import json
import sys
import time
import urllib.error
import urllib.request

SITE = "https://coinmate.io"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
_last = [0.0]


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def get(url: str, method: str = "GET", data: bytes | None = None, accept: str = "application/json"):
    wait = _last[0] + 1.0 - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={**UA, "Accept": accept}, method=method, data=data)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read()
    _last[0] = time.monotonic()
    return status, body


def ppm(percent: float | None) -> int | None:
    return None if percent is None else round(percent * 10_000)


def zones() -> None:
    st, b = get(f"{SITE}/frontend/fees/fee-zones")
    rows = json.loads(b)
    out(mode="zones", status=st, count=len(rows), keys=sorted(rows[0]))
    lower = 0
    for i, z in enumerate(rows):
        upper = z["tradingVolume"]
        out(mode="zones", tier=i, volume_eur_from=lower, volume_eur_below=upper,
            maker_pct=z["makerFeeValue"], taker_pct=z["takerFeeValue"],
            maker_ppm=ppm(z["makerFeeValue"]), taker_ppm=ppm(z["takerFeeValue"]),
            referral=[z.get("applyMakerReferral"), z.get("applyTakerReferral")])
        lower = upper


def page() -> None:
    st, b = get(f"{SITE}/fees", accept="text/html")
    html = b.decode("utf-8", "replace")
    out(mode="page", url=f"{SITE}/fees", status=st, bytes=len(b), angular_shell="<app-root" in html or "main-" in html)
    st, b = get(f"{SITE}/assets/i18n/en.json")
    d = json.loads(b)
    fees = d.get("fees", {})
    para = fees.get("paragraphs", {})
    out(mode="page", url=f"{SITE}/assets/i18n/en.json", status=st,
        tiers_rule=para.get("maker-vs-taker", {}).get("content2"),
        volume_rule=para.get("calculated-value", {}).get("content"),
        next_tier=fees.get("trade-another-n"),
        faq_fees=d.get("faqs", {}).get("fees", {}).get("answer"),
        operator=d.get("about_us", {}).get("address"),
        licence=d.get("home-page", {}).get("benefits", {}).get("modal", {}).get("cnb", {}).get("text"))


def countries() -> None:
    st, b = get(f"{SITE}/frontend/countries")
    rows = json.loads(b)
    codes = {r["code"] for r in rows}
    named = ["US", "CA", "GB", "CZ", "SK", "DE", "RU", "BY", "KP", "IR", "AF", "MM", "CN", "UA"]
    out(mode="countries", status=st, count=len(rows), keys=sorted(rows[0]), present={c: c in codes for c in named})


def private() -> None:
    st, b = get(f"{SITE}/api/traderFees", method="POST", data=b"currencyPair=BTC_EUR")
    out(mode="private", call="POST /api/traderFees", status=st, body=b.decode()[:200])


def coverage() -> None:
    st, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinmate")
    d = json.loads(b).get("data", {})
    q = d.get("quote", {}).get("2781", {})
    out(mode="coverage", source="coinmarketcap detail", status=st, id=d.get("id"), launched=d.get("dateLaunched"),
        maker_fee=d.get("makerFee"), taker_fee=d.get("takerFee"), spot_usd_24h=q.get("spotVolume24h"),
        perpetual_usd_24h=q.get("perpetualVolume24h"), futures_usd_24h=q.get("futuresVolume24h"))
    for cat in ["spot", "perpetual", "futures"]:
        st, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest"
                    f"?slug=coinmate&category={cat}&start=1&limit=100")
        x = json.loads(b).get("data", {})
        out(mode="coverage", source=f"coinmarketcap pairs {cat}", status=st, num=x.get("numMarketPairs"),
            listed=len(x.get("marketPairs", [])))
    st, b = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    rows = json.loads(b)
    out(mode="coverage", source="coingecko derivatives list", status=st, venues=len(rows),
        coinmate=[r for r in rows if "coinmate" in (r["id"] + r["name"]).lower()])


if __name__ == "__main__":
    table = {"zones": zones, "page": page, "countries": countries, "private": private, "coverage": coverage}
    for m in sys.argv[1:] or list(table):
        out(mode=m, event="start", utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        table[m]()
