# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CoinLion fee probe for docs/profiles/coinlion/fees.md.

Public, unauthenticated and read-only.
It fetches the help center fee pages, the user agreement, the web app's config and bundle, CoinMarketCap's public exchange record, and the installed and current CCXT exchange lists.
About fifteen requests in all, one at a time.
Run from the repository root with: uv run scripts/probes/venues/coinlion/fees-probe.py
"""

import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}
CCXT_DIR = pathlib.Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")


def get(url, method="GET"):
    req = urllib.request.Request(url, headers=UA, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body, status = r.read().decode("utf-8", "replace"), r.status
    except urllib.error.HTTPError as e:
        body, status = e.read().decode("utf-8", "replace"), e.code
    time.sleep(0.5)
    return status, body


def text(page):
    page = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", page, flags=re.S)
    page = html.unescape(re.sub(r"<[^>]+>", " ", page))
    return re.sub(r"\s+", " ", page)


def section(name):
    print(f"\n=== {name}")


def help_pages():
    section("1. help center fee pages")
    for slug in ["trading-fees", "discounted-trading-fees", "limit-and-market-orders"]:
        status, body = get(f"https://help.coinlion.com/{slug}")
        t = text(body)
        print(slug, status)
        for pat in [r"[^.]*0\.15%[^.]*\.", r"[^.]*0% trading fee[^.]*\.", r"\d+% discount[^.]*?(?=\d+% discount|Disclaimer)", r"[^.]*80% discount[^.]*\.", r"[^.]*market orders are currently not available[^.]*\."]:
            for m in dict.fromkeys(re.findall(pat, t, flags=re.I)):
                print("  ", m.strip())


def agreement():
    section("1b. user agreement")
    status, body = get("https://www.coinlion.com/user-agreement/")
    t = text(body)
    print("status", status)
    for pat in [r"CoinLion, LLC", r"not registered with the U\.S\. Securities and Exchange Commission[^.]*\.", r"Use in Restricted Jurisdictions[^.]*\.", r"API Agreement"]:
        m = re.search(pat, t)
        print("  ", pat, "found" if m else "absent", "|", m.group(0)[:200] if m else "")
    for word in ["futures", "perpetual", "derivative", "leverage", "margin trading", "funding rate"]:
        print("  word", word, len(re.findall(word, t, flags=re.I)))


def app_bundle():
    section("2. web app config and bundle")
    status, cfg = get("https://trade.coinlion.com/config.js")
    m = re.search(r'"COINLION_API_URL":"([^"]+)"', cfg)
    print("config.js", status, "COINLION_API_URL", m.group(1) if m else None)
    status, shell = get("https://trade.coinlion.com/")
    js = re.search(r'src="(/assets/index-[^"]+\.js)"', shell).group(1)
    status, bundle = get(f"https://trade.coinlion.com{js}")
    print("bundle", js, status, "bytes", len(bundle))
    for pat in [r'MARKETS_INFO:"[^"]+"', r"\['pairs'\]\[\$\{K\}\]\['(?:fee|takerFee)'\]", r"frontoffice-v2/api/v2/", r"marketdata/info", r'subscribe\("(?:MiniTicker|Book|Trades)"']:
        print("  ", pat, sorted(set(re.findall(pat, bundle)))[:4])
    for word in ["perpetual", "futures", "funding rate", "liquidation"]:
        print("  word", word, len(re.findall(word, bundle, flags=re.I)))
    status, body = get("https://ursa.coinlion.com/frontoffice-v2/api/v2/markets/basic")
    print("markets/basic without a token", status, body[:100])


def cmc():
    section("3. CoinMarketCap public record")
    status, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinlion")
    d = json.loads(body)["data"]
    print("detail", status, {k: d.get(k) for k in ["id", "name", "countries", "makerFee", "takerFee", "dateLaunched", "status"]}, "fee url", d["urls"].get("fee"))
    for cat in ["perpetual", "futures", "spot"]:
        status, body = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinlion&category={cat}&start=1&limit=100")
        d = json.loads(body)["data"]
        print(cat, status, "numMarketPairs", d.get("numMarketPairs"), "quotes", d.get("quotes"))


def ccxt():
    section("8. CCXT")
    hits = sorted(p.name for p in CCXT_DIR.glob("*.js") if "lion" in p.name.lower())
    print("installed 4.5.68 files with lion in the name", hits)
    status, body = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body)
    flat = json.dumps(ids).lower()
    print("master exchanges.json", status, "ids", len(ids["ids"]), "mentions coinlion", "coinlion" in flat)
    status, _ = get("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/coinlion.ts")
    print("master ts/src/coinlion.ts", status)
    status, body = get("https://api.github.com/repos/ccxt/ccxt/commits/master")
    if status == 200:
        c = json.loads(body)
        print("master head", c["sha"][:12], c["commit"]["committer"]["date"])


if __name__ == "__main__":
    print("started UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    help_pages()
    agreement()
    app_bundle()
    cmc()
    ccxt()
    print("\nfinished UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
