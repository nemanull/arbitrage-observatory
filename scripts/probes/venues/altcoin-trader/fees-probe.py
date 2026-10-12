# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and coverage probe for Altcoin Trader.

Modes, all by default, or name some on the command line:
    page      the live fee page from this host, and the newest archived copy of it
    api       the fee tier paths without a key, the fee fields on /markets, and withdrawal fees on /currencies
    docs      the OpenAPI document of docs.altcointrader.co.za: fee tier paths, the tier example, and derivatives words
    coverage  CoinMarketCap's exchange record and derivatives ranking, CoinGecko's lists, and CCXT's current exchange ids

Every call is unauthenticated and read-only, about 15 requests in all, spaced 1.5 s apart.

Run from the repository root:
    uv run scripts/probes/venues/altcoin-trader/fees-probe.py [mode ...]
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

API = "https://api.altcointrader.co.za"
DOCS = "https://docs.altcointrader.co.za/openapi/openapi.yaml"
FEE_PAGE = "https://www.altcointrader.co.za/trading-fees"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
_last = [0.0]


def get(url: str, headers: dict | None = None) -> tuple[int, dict, bytes]:
    wait = _last[0] + 1.5 - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=headers or UA)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            status, hdrs, body = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, dict(e.headers), e.read()
    except (urllib.error.URLError, TimeoutError) as e:
        status, hdrs, body = 0, {}, repr(e).encode()
    _last[0] = time.monotonic()
    return status, {k.lower(): v for k, v in hdrs.items()}, body


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str))


def text_of(body: bytes) -> str:
    s = body.decode("utf-8", errors="replace")
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def mode_page() -> None:
    s, h, b = get(FEE_PAGE, {"User-Agent": "Mozilla/5.0"})
    title = re.search(rb"<title>(.*?)</title>", b)
    out(mode="page", call="GET " + FEE_PAGE, status=s, title=title.group(1).decode() if title else None, cf_mitigated=h.get("cf-mitigated"), server=h.get("server"))
    s, h, b = get("https://archive.org/wayback/available?url=altcointrader.co.za/trading-fees")
    snap = None
    try:
        snap = json.loads(b)["archived_snapshots"]["closest"]
    except (ValueError, KeyError, TypeError):
        pass
    out(mode="page", call="wayback availability", status=s, closest=snap)
    if snap:
        url = snap["url"].replace("http://", "https://").replace("/web/" + snap["timestamp"] + "/", "/web/" + snap["timestamp"] + "id_/")
        s, h, b = get(url, {"User-Agent": "Mozilla/5.0"})
        t = text_of(b)
        pct = sorted(set(re.findall(r"\d+(?:\.\d+)?\s?%", t)))
        i = t.lower().find("maker")
        out(mode="page", call="GET " + url, status=s, chars=len(t), percents=pct[:40], around_maker=t[max(0, i - 400): i + 1200] if i >= 0 else t[:300])


def mode_api() -> None:
    for path in ("/trading/fees/tiers", "/trading/fees/tier", "/account"):
        s, h, b = get(API + path)
        out(mode="api", call="GET " + path, status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get(API + "/markets")
    try:
        d = json.loads(b)
        out(mode="api", call="GET /markets", status=s, count=len(d), fee_fields_present=any(k for m in d for k in m if "fee" in k), fields=sorted({k for m in d for k in m}))
    except ValueError:
        out(mode="api", call="GET /markets", status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get(API + "/currencies")
    try:
        d = json.loads(b)
        zar = [c for c in d if c.get("code") == "ZAR"]
        btc = [c for c in d if c.get("code") == "BTC"]
        out(mode="api", call="GET /currencies", status=s, count=len(d), tradable=sum(1 for c in d if (c.get("capabilities") or {}).get("trade")),
            zar=zar[:1], btc_withdrawal_fee=[n.get("withdrawal_fee") for n in (btc[0].get("networks") or [])] if btc else None)
    except ValueError:
        out(mode="api", call="GET /currencies", status=s, body=b[:200].decode(errors="replace"))


def mode_docs() -> None:
    s, h, b = get(DOCS)
    t = b.decode(errors="replace")
    lines = t.splitlines()
    paths = [ln.strip().rstrip(":") for ln in lines if ln.startswith("  /")]
    servers = [ln.split("url:", 1)[1].strip() for ln in lines if ln.strip().startswith("- url:")]
    i = t.find("/trading/fees/tiers:")
    example = re.findall(r"tier: (\d+)\s+min_volume_zar: \"([\d.]+)\"\s+max_volume_zar: (\S+)\s+maker_bps: (-?\d+)\s+taker_bps: (-?\d+)", t[i: i + 3000]) if i >= 0 else []
    words = {w: len(re.findall(w, t, re.I)) for w in ("futures", "perpetual", "funding", "mark price", "index price", "leverage", "margin", "sequence", "checksum", "rate limit")}
    out(mode="docs", call="GET " + DOCS, status=s, bytes=len(b), servers=servers, path_count=len(paths), fee_paths=[p for p in paths if "fee" in p],
        tiers_example=example, word_counts=words)


def mode_coverage() -> None:
    s, h, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=altcoin-trader")
    try:
        d = json.loads(b)["data"]
        q = d.get("quote", {}).get("2781", {})
        out(mode="coverage", call="CMC exchange detail", status=s, id=d.get("id"), name=d.get("name"), launched=d.get("dateLaunched"), maker_fee=d.get("makerFee"),
            taker_fee=d.get("takerFee"), fee_url=d.get("urls", {}).get("fee"), spot_usd=q.get("spotVolume24h"), perpetual_usd=q.get("perpetualVolume24h"), futures_usd=q.get("futuresVolume24h"))
    except (ValueError, KeyError, TypeError):
        out(mode="coverage", call="CMC exchange detail", status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=altcoin-trader&category=spot&start=1&limit=100")
    try:
        d = json.loads(b)["data"]
        out(mode="coverage", call="CMC spot market pairs", status=s, num=d.get("numMarketPairs"), quotes=sorted({p["marketPair"].split("/")[1] for p in d["marketPairs"]}))
    except (ValueError, KeyError, TypeError):
        out(mode="coverage", call="CMC spot market pairs", status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=altcoin-trader&category=perpetual&start=1&limit=10")
    try:
        d = json.loads(b)["data"]
        out(mode="coverage", call="CMC perpetual market pairs", status=s, num=d.get("numMarketPairs"), pairs=len(d.get("marketPairs") or []))
    except (ValueError, KeyError, TypeError):
        out(mode="coverage", call="CMC perpetual market pairs", status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2&start=1&limit=200")
    try:
        d = json.loads(b)["data"]
        rows = d.get("exchanges") or []
        out(mode="coverage", call="CMC derivatives listing exType=2", status=s, venues=len(rows), altcoin_trader_listed=any("altcoin" in (r.get("slug") or "") for r in rows))
    except (ValueError, KeyError, TypeError):
        out(mode="coverage", call="CMC derivatives listing exType=2", status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    try:
        d = json.loads(b)
        out(mode="coverage", call="CoinGecko derivatives exchanges list", status=s, venues=len(d), altcoin_trader_listed=any("altcoin" in (r.get("id") or "") for r in d))
    except ValueError:
        out(mode="coverage", call="CoinGecko derivatives exchanges list", status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get("https://api.coingecko.com/api/v3/exchanges/list")
    try:
        d = json.loads(b)
        out(mode="coverage", call="CoinGecko exchanges list", status=s, venues=len(d), altcoin_trader_listed=[r for r in d if "altcoin" in r["id"].lower() or "altcoin" in r["name"].lower()])
    except ValueError:
        out(mode="coverage", call="CoinGecko exchanges list", status=s, body=b[:200].decode(errors="replace"))
    s, h, b = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    try:
        ids = json.loads(b)["ids"]
        out(mode="coverage", call="CCXT master exchanges.json", status=s, ids=len(ids), matches=[i for i in ids if "alt" in i.lower()])
    except (ValueError, KeyError):
        out(mode="coverage", call="CCXT master exchanges.json", status=s, body=b[:200].decode(errors="replace"))
    for f in ("ts/src/altcointrader.ts", "js/src/altcointrader.js"):
        s, h, b = get("https://raw.githubusercontent.com/ccxt/ccxt/master/" + f)
        out(mode="coverage", call="CCXT master " + f, status=s)


MODES = {"page": mode_page, "api": mode_api, "docs": mode_docs, "coverage": mode_coverage}

if __name__ == "__main__":
    out(probe="altcoin-trader fees", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for name in sys.argv[1:] or list(MODES):
        MODES[name]()
