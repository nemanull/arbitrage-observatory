# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and coverage probe for 5DAX.

Modes, all by default, or name some on the command line:
    page      the fee policy view behind https://5dax.com/trading-rule.html, its VIP table and FDX discounts,
              the fee view behind https://5dax.com/fees.html, the API view, the about and terms views,
              and the margin trading view
    api       the unauthenticated replies of the two fee calls the fee page makes,
              and whether the catalog calls carry any fee field
    coverage  the app's route list for any futures, perpetual or contract page,
              CoinMarketCap's exchange record and perpetual pair list, and CoinGecko's derivatives list
    ccxt      the installed CCXT 4.5.68 class folder and the current CCXT master on GitHub

Run from the repository root:
    uv run scripts/probes/venues/5dax/fees-probe.py [mode ...]
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SITE = "https://5dax.com"
API = "https://api.5dax.com/api/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
CCXT_SRC = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def fetch(url: str, method: str = "GET", data: bytes | None = None, headers: dict | None = None):
    time.sleep(1.3)
    h = {"User-Agent": UA, "Accept": "application/json, text/html"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def text_of(page: str) -> list[str]:
    page = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    page = re.sub(r"<(style|script)[^>]*>.*?</\1>", "", page, flags=re.S)
    page = re.sub(r"<[^>]+>", "\n", page)
    return [html.unescape(x).strip() for x in page.split("\n") if x.strip()]


def page_mode() -> None:
    status, body = fetch(SITE + "/public/common/views/trading.rule.html?v=1.0.8")
    lines = text_of(body)
    out(mode="page", url=SITE + "/public/common/views/trading.rule.html?v=1.0.8", status=status, bytes=len(body))
    for marker in ("5DAX Trading Fee Policy", "Applicable to all Spot Trading Pairs", "Hold FDX Tokens",
                   "Pay Fees Using FDX", "Wyoming MSB"):
        hits = [l for l in lines if marker in l]
        out(mode="page", marker=marker, found=bool(hits), line=hits[0][:200] if hits else None)
    i = lines.index("VIP Level") if "VIP Level" in lines else -1
    if i >= 0:
        table = lines[i:i + 50]
        end = table.index("RULE:") if "RULE:" in table else len(table)
        out(mode="page", vip_table=table[:end])
    j = [k for k, l in enumerate(lines) if l == "FDX Balance"]
    out(mode="page", fdx_hold=[lines[k + 1:k + 3] for k in j])
    k = [n for n, l in enumerate(lines) if l.startswith("Fee = ")]
    out(mode="page", worked_example=[lines[n] for n in k])
    out(mode="page", base_fee_template=[l for l in lines if "trade_fee_default" in l][:3])

    status, body = fetch(SITE + "/public/common/views/fees.html?v=1.0.4")
    commented = re.findall(r"<!--(.*?)-->", body, flags=re.S)
    trading = [" ".join(text_of(c)) for c in commented if "Fee for trading" in c]
    out(mode="page", url=SITE + "/public/common/views/fees.html?v=1.0.4", status=status,
        trading_fee_block_is_commented_out=bool(trading), commented_block=trading[0][:200] if trading else None,
        trading_fee_link=re.findall(r'href="([^"]*trading-rule[^"]*)"', body)[:2])

    status, body = fetch(SITE + "/public/common/views/api.html?v=1.0.1")
    lines = text_of(body)
    out(mode="page", url=SITE + "/public/common/views/api.html?v=1.0.1", status=status,
        last_updated=[l for l in lines if l.startswith("Last updated")][:1],
        base=[l for l in lines if "base endpoint" in l][:1],
        limits=[l for l in lines if "calls" in l and ("IP" in l or "second" in l)][:3],
        endpoints=[l for l in lines if re.match(r"^GET /api/", l)],
        socket_words=[l for l in lines if re.search(r"wss|websocket|socket\.io|stream", l, re.I)][:5])

    status, body = fetch(SITE + "/public/common/views/about.html?v=1.0.4")
    out(mode="page", url=SITE + "/public/common/views/about.html?v=1.0.4", status=status,
        owner=[l for l in text_of(body) if "Bitprotos" in l][:2])

    status, body = fetch(SITE + "/public/common/views/terms.of.use.html?v=1.0.15")
    lines = text_of(body)
    joined = " ".join(lines)
    i = joined.find("Afghanistan")
    j = joined.find("Tanzania", i)
    names = [x.strip() for x in joined[i:j + len("Tanzania")].replace(" and Tanzania", ", Tanzania").split(",") if x.strip()]
    out(mode="page", url=SITE + "/public/common/views/terms.of.use.html?v=1.0.15", status=status,
        governing=joined[joined.find("operated under"):joined.find("operated under") + 80],
        restricted_entries=len(names), restricted_names=names,
        canada="Canada" in names, united_states="United States" in names,
        vpn_clause=[l[:160] for l in lines if "VPN" in l][:1])

    status, body = fetch(SITE + "/public/common/views/margin.trading.html")
    out(mode="page", url=SITE + "/public/common/views/margin.trading.html", status=status, text=text_of(body))


def api_mode() -> None:
    for path, method in (("/exchange/getTradeFeeDefault", "POST"), ("/currency/listMarketTrading", "GET")):
        status, body = fetch(SITE + path, method=method, data=b"{}" if method == "POST" else None,
                             headers={"Content-Type": "application/json"} if method == "POST" else None)
        out(mode="api", url=SITE + path, method=method, status=status, bytes=len(body), body=body[:300])
    status, body = fetch(SITE + "/exchange/getProducts")
    p = json.loads(body)["data"]
    feeish = sorted({k for x in p for k in x if "fee" in k.lower()})
    out(mode="api", url=SITE + "/exchange/getProducts", fee_like_keys=feeish,
        withdrawFee_values=sorted({str(x.get("withdrawFee")) for x in p})[:10])
    status, body = fetch(API + "/exchangeInfo")
    e = json.loads(body)
    keys = sorted({k for s in e["symbols"] for k in s})
    out(mode="api", url=API + "/exchangeInfo", symbol_keys=keys, fee_like_keys=[k for k in keys if "fee" in k.lower()])


def coverage_mode() -> None:
    status, body = fetch(SITE + "/public/common/common.js?v=1.0.26")
    urls = re.findall(r"url:\s*'([^']+)'", body)
    out(mode="coverage", url=SITE + "/public/common/common.js?v=1.0.26", status=status, routes=len(urls),
        derivative_routes=[u for u in urls if re.search(r"futur|perp|contract|swap|margin|leverage|deriv", u, re.I)])
    status, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=5dax")
    d = json.loads(body)["data"]
    q = d.get("quote", {}).get("2781", {})
    out(mode="coverage", source="CoinMarketCap detail", status=status, id=d.get("id"), name=d.get("name"),
        dateLaunched=d.get("dateLaunched"), makerFee=d.get("makerFee"), takerFee=d.get("takerFee"),
        fee_urls=d.get("urls", {}).get("fee"), countries=d.get("countries"),
        usd_quote={k: q.get(k) for k in ("spotVolume24h", "perpetualVolume24h", "futuresVolume24h", "updateTime")})
    for cat in ("spot", "perpetual"):
        url = f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=5dax&category={cat}&start=1&limit=100"
        status, body = fetch(url)
        try:
            dd = json.loads(body)["data"]
            out(mode="coverage", source=f"CoinMarketCap pairs {cat}", status=status, numMarketPairs=dd.get("numMarketPairs"),
                returned=len(dd.get("marketPairs") or []))
        except (ValueError, KeyError, TypeError):
            out(mode="coverage", source=f"CoinMarketCap pairs {cat}", status=status, body=body[:200])
    status, body = fetch("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    try:
        lst = json.loads(body)
        out(mode="coverage", source="CoinGecko derivatives list", status=status, count=len(lst),
            matches=[x for x in lst if "dax" in (x.get("id", "") + x.get("name", "")).lower()])
    except ValueError:
        out(mode="coverage", source="CoinGecko derivatives list", status=status, body=body[:200])
    status, body = fetch("https://api.coingecko.com/api/v3/exchanges/list")
    try:
        lst = json.loads(body)
        out(mode="coverage", source="CoinGecko exchanges list", status=status, count=len(lst),
            matches=[x for x in lst if "5dax" in (x.get("id", "") + x.get("name", "")).lower()])
    except ValueError:
        out(mode="coverage", source="CoinGecko exchanges list", status=status, body=body[:200])


def ccxt_mode() -> None:
    files = sorted(p.name for p in CCXT_SRC.glob("*.js"))
    out(mode="ccxt", folder=str(CCXT_SRC), classes=len(files),
        matches=[f for f in files if re.search(r"5dax|fivedax|fdx", f, re.I)],
        dax_like=[f for f in files if "dax" in f])
    status, body = fetch("https://api.github.com/repos/ccxt/ccxt/commits/master")
    try:
        c = json.loads(body)
        out(mode="ccxt", source="GitHub master head", status=status, sha=c["sha"][:7], date=c["commit"]["committer"]["date"])
    except (ValueError, KeyError):
        out(mode="ccxt", source="GitHub master head", status=status, body=body[:200])
    status, body = fetch("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body)["ids"]
    out(mode="ccxt", source="exchanges.json on master", status=status, ids=len(ids),
        matches=[i for i in ids if re.search(r"5dax|fivedax", i, re.I)], dax_like=[i for i in ids if "dax" in i])
    for path in ("ts/src/5dax.ts", "js/src/5dax.js", "ts/src/fivedax.ts"):
        status, _ = fetch("https://raw.githubusercontent.com/ccxt/ccxt/master/" + path)
        out(mode="ccxt", path=path, status=status)


def main() -> None:
    modes = sys.argv[1:] or ["page", "api", "coverage", "ccxt"]
    out(probe="5dax fees", started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=modes)
    for m in modes:
        {"page": page_mode, "api": api_mode, "coverage": coverage_mode, "ccxt": ccxt_mode}[m]()
    out(probe="5dax fees", finished=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
