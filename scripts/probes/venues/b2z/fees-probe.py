# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee, access and listing probe for B2Z Exchange, public data only.

B2Z runs on the BTSE white-label platform, so several modes read the same call from BTSE beside it.

Modes, all by default, or name some on the command line:
    fees      GET /api/account/dashboard/tradingFees on api.b2z.exchange and on api.btse.com, the VIP tables
    regions   GET /api/country/all on both hosts, the countries carrying each restriction flag
    brand     the web app's English strings file: brand name, the entity line of the footer, the restricted jurisdiction text
    listings  CoinMarketCap's exchange record and pair counts by category, and CoinGecko's derivatives venue list
    ccxt      the installed CCXT 4.5.68 classes and the current CCXT master id list, searched for b2z and btse

Every call is unauthenticated and read-only, about 15 requests with a 1 s gap.

Run from the repository root:
    uv run scripts/probes/venues/b2z/fees-probe.py [mode ...]
"""

import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json"}
B2Z = "https://api.b2z.exchange"
BTSE = "https://api.btse.com"
ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js"


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def get(url: str) -> tuple[int, dict, bytes]:
    time.sleep(1.0)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def ppm(x) -> int | None:
    return None if x is None else round(float(x) * 1_000_000)


def fees_mode() -> None:
    for name, host in (("b2z", B2Z), ("btse", BTSE)):
        status, _, body = get(host + "/api/account/dashboard/tradingFees")
        d = json.loads(body)
        out(mode="fees", host=name, status=status, code=d.get("code"), msg=d.get("msg"))
        for product, rows in (d.get("data") or {}).items():
            for r in rows:
                out(mode="fees", host=name, product=product, level=r["level"], maker=r["maker"], taker=r["taker"],
                    maker_ppm=ppm(r["maker"]), taker_ppm=ppm(r["taker"]), token_balance=r.get("tokenBalance"),
                    token_staking=r.get("tokenStaking"), spot_volume=r.get("spotVolume"), futures_volume=r.get("futuresVolume"))


def regions_mode() -> None:
    flags = ("prohibition", "restricted", "prohibitRegistration", "prohibitLogin", "prohibitKyc")
    for name, host in (("b2z", B2Z), ("btse", BTSE)):
        status, _, body = get(host + "/api/country/all")
        rows = json.loads(body)["data"]
        out(mode="regions", host=name, status=status, countries=len(rows))
        for flag in flags:
            codes = sorted(c["shortName"] for c in rows if c.get(flag))
            out(mode="regions", host=name, flag=flag, count=len(codes), codes=" ".join(codes))
        for c in rows:
            if c["shortName"] in ("US", "CA", "PL", "VG"):
                out(mode="regions", host=name, country=c["shortName"], **{f: c.get(f) for f in flags})


def brand_mode() -> None:
    status, _, body = get("https://www.b2z.exchange/i18n/en.json")
    d = json.loads(body)
    out(mode="brand", status=status, bytes=len(body), keys=len(d))
    for k in ("brand.name", "footer.about-us.1", "footer.about-us.2", "account.verification.checkBoxText",
              "prohibitRegionAlert.title", "prohibitRegionAlert.description.v2"):
        out(mode="brand", key=k, value=d.get(k))
    status, hdrs, body = get("https://www.b2z.exchange/en/vip-program")
    out(mode="brand", page="/en/vip-program", status=status, bytes=len(body), content_type=hdrs.get("content-type"),
        has_app_div='<div id="app"></div>' in body.decode("utf-8", "replace"))


def listings_mode() -> None:
    status, _, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=b2z-exchange")
    d = json.loads(body)["data"]
    q = d.get("quote", {}).get("1", {})
    out(mode="listings", source="cmc detail", status=status, id=d.get("id"), launched=d.get("dateLaunched"),
        makerFee=d.get("makerFee"), takerFee=d.get("takerFee"), fee_url=d.get("urls", {}).get("fee"),
        spotVolume24h=q.get("spotVolume24h"), perpetualVolume24h=q.get("perpetualVolume24h"),
        futuresVolume24h=q.get("futuresVolume24h"), tags=[t["slug"] for t in d.get("tags", [])][:6])
    for cat in ("spot", "perpetual", "futures"):
        status, _, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest"
                              f"?slug=b2z-exchange&category={cat}&start=1&limit=5")
        dd = json.loads(body)["data"]
        out(mode="listings", source="cmc pairs", category=cat, status=status, numMarketPairs=dd.get("numMarketPairs"),
            first=[p.get("marketPair") for p in dd.get("marketPairs", [])])
    status, _, body = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    rows = json.loads(body) if status == 200 else []
    hits = [r for r in rows if "b2z" in (r.get("id", "") + r.get("name", "")).lower()]
    out(mode="listings", source="coingecko derivatives list", status=status, venues=len(rows), b2z_rows=hits)


def ccxt_mode() -> None:
    src = CCXT / "src"
    classes = sorted(p.stem for p in src.glob("*.js"))
    out(mode="ccxt", installed_dir=str(src.relative_to(ROOT)), classes=len(classes),
        matches=[c for c in classes if re.search(r"b2z|btse", c)])
    lines = (CCXT / "ccxt.js").read_text().splitlines()
    start = next(i for i, l in enumerate(lines, 1) if l.startswith("const exchanges = {"))
    end = next(i for i, l in enumerate(lines, 1) if i > start and l.startswith("};"))
    out(mode="ccxt", exchanges_map_lines=f"{start}-{end}", ids=end - start - 1,
        matches=[f"{i}: {l.strip()}" for i, l in enumerate(lines, 1) if start <= i <= end and re.search(r"b2z|btse", l)])
    status, _, body = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body).get("ids", []) if status == 200 else []
    out(mode="ccxt", source="master exchanges.json", status=status, ids=len(ids),
        matches=[i for i in ids if re.search(r"b2z|btse", i)])
    status, _, _ = get("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/b2z.ts")
    out(mode="ccxt", source="master ts/src/b2z.ts", status=status)


MODES = {"fees": fees_mode, "regions": regions_mode, "brand": brand_mode, "listings": listings_mode, "ccxt": ccxt_mode}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    out(probe="b2z fees", started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for m in picked:
        MODES[m]()
