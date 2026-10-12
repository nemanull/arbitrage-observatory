# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of Bittylicious fee, coverage and listing evidence.

Modes:
  pages     the home page price block per region, the terms page, and the fee article CoinMarketCap links
  markup    buy and sell quotes for BTC and ETH against GBP, set beside Kraken's public GBP book
  listings  CoinMarketCap, CoinGecko and the current CCXT source, looking for Bittylicious and any derivative
  all       every mode above, in order

Every call is a single public GET, about 30 in all.
"""

import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html import unescape

UA = "Mozilla/5.0 (survey probe)"
SITE = "https://bittylicious.com"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(url: str, opener: urllib.request.OpenerDirector | None = None) -> tuple[int, str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with (opener or urllib.request.build_opener()).open(req, timeout=20) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, e.read().decode("utf-8", "replace")


def text_of(page: str) -> str:
    page = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", page)))


def pay_methods(page: str) -> list[str]:
    out = []
    for name, body in re.findall(r"bittyState\.payMethod\['(\w+)'\] = \{(.*?)\};", page, flags=re.S):
        fields = dict(re.findall(r"(\w+)\s*:\s*'?([^',\n]*)'?,", body))
        keep = ("price", "currency", "country", "enabled", "minCoin", "maxCoin", "fixedFee")
        out.append(f"{name}: " + ", ".join(f"{k}={fields.get(k)}" for k in keep))
    return out


def mode_pages() -> None:
    print(f"## pages {now()}")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    for region in ("GB", "EU", "**"):
        status, final, page = fetch(f"{SITE}/country/{region}", opener)
        print(f"/country/{region}: HTTP {status}, landed on {final}")
        for line in pay_methods(page):
            print("  " + line)
        text = text_of(page)
        for phrase in ("You need to use an IP address in", "includes all fees", "Minimum purchase is"):
            i = text.find(phrase)
            if i >= 0:
                print(f"  text: ...{text[max(0, i - 60):i + 110]}...")
    status, _, page = fetch(f"{SITE}/terms/GENERAL")
    text = text_of(page)
    print(f"/terms/GENERAL: HTTP {status}, {len(text)} characters of text")
    for phrase in ("company number", "Designated Business", "brokers who operate on Bittylicious", "including the United States", "fiat-for-cryptocurrency"):
        i = text.find(phrase)
        print(f"  {phrase!r}: " + (f"...{text[max(0, i - 120):i + 160]}..." if i >= 0 else "absent"))
    for word in ("fee", "commission", "spread", "futures", "leverage", "margin", "derivative"):
        print(f"  occurrences of {word!r} in the terms: {len(re.findall(word, text, flags=re.I))}")
    for url in (
        "https://help.bittylicious.com/index.php/Are_any_fees_taken_when_buying_virtual_currency%3F",
        "https://help.bittylicious.com/",
        "https://help.bittylicious.com/api.php?action=query&list=search&srsearch=fee&format=json",
        f"{SITE}/fees",
    ):
        status, _, page = fetch(url)
        err = re.search(r"Error \d+: [^<]{0,80}", page)
        print(f"{url}: HTTP {status}, {len(page)} bytes" + (f", {err.group(0)}" if err else ""))
    for target in ("bittylicious.com/api", "help.bittylicious.com/index.php/Are_any_fees_taken_when_buying_virtual_currency%3F"):
        status, _, body = fetch(f"https://archive.org/wayback/available?url={target}")
        print(f"Wayback availability for {target}: HTTP {status}, {body[:160]}")


def quote(coin: str, amount: str, side: str) -> dict:
    status, _, body = fetch(f"{SITE}/api/v1/quote/{coin}/GB/GBP/BANK/{amount}/{side}")
    try:
        return {"status": status, **json.loads(body)}
    except json.JSONDecodeError:
        return {"status": status, "body": body[:120]}


def mode_markup() -> None:
    print(f"## markup {now()}")
    _, _, body = fetch("https://api.kraken.com/0/public/Ticker?pair=XBTGBP,ETHGBP")
    kr = json.loads(body)["result"]
    ref = {}
    for key, coin in (("XXBTZGBP", "BTC"), ("XETHZGBP", "ETH")):
        bid, ask = float(kr[key]["b"][0]), float(kr[key]["a"][0])
        ref[coin] = (bid + ask) / 2
        print(f"Kraken {key}: bid {bid} ask {ask} mid {ref[coin]:.2f}")
    for coin, amounts in (("BTC", ("1", "0.1", "0.01")), ("ETH", ("1", "0.1"))):
        for side in ("BUY", "SELL"):
            for amount in amounts:
                q = quote(coin, amount, side)
                line = f"{coin} {side} {amount}: {json.dumps(q)}"
                if q.get("success"):
                    unit = float(q["totalPrice"]) / float(amount)
                    ppm = (unit / ref[coin] - 1) * 1_000_000
                    line += f" unit {unit:.2f} GBP, {ppm:+.0f} ppm against the Kraken mid"
                print(line)


def mode_listings() -> None:
    print(f"## listings {now()}")
    status, _, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bittylicious")
    d = json.loads(body)["data"]
    keep = ("id", "name", "dateLaunched", "status", "makerFee", "takerFee", "countries", "fiats")
    print(f"CMC detail HTTP {status}: " + json.dumps({k: d.get(k) for k in keep}))
    print("  fee url: " + json.dumps(d["urls"].get("fee")))
    print("  tags: " + json.dumps([t["name"] for t in d.get("tags", [])]))
    print("  quote USD: " + json.dumps(d["quote"].get("2781")))
    for cat in ("spot", "perpetual", "futures"):
        status, _, body = fetch(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bittylicious&category={cat}&start=1&limit=100")
        data = json.loads(body)["data"]
        pairs = [(p["marketPair"], round(p.get("volumeUsd") or 0)) for p in data.get("marketPairs", [])]
        print(f"CMC market pairs {cat} HTTP {status}: {data.get('numMarketPairs')} {pairs}")
    status, _, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2&start=1&limit=500")
    rows = json.loads(body)["data"].get("exchanges", [])
    print(f"CMC derivatives listing HTTP {status}: {len(rows)} venues, Bittylicious present {any('bitty' in r['slug'] for r in rows)}")
    for url in ("https://api.coingecko.com/api/v3/exchanges/list", "https://api.coingecko.com/api/v3/derivatives/exchanges/list"):
        status, _, body = fetch(url)
        rows = json.loads(body) if status == 200 else []
        print(f"{url}: HTTP {status}, {len(rows)} rows, matches {[r for r in rows if 'bitty' in r['id'].lower()]}")
    status, _, body = fetch("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    data = json.loads(body)
    ids = data["ids"] if isinstance(data, dict) else data
    print(f"CCXT master exchanges.json HTTP {status}: {len(ids)} ids, matches {[i for i in ids if 'bitty' in i]}")
    for path in ("ts/src/bittylicious.ts", "js/src/bittylicious.js"):
        status, _, _ = fetch(f"https://raw.githubusercontent.com/ccxt/ccxt/master/{path}")
        print(f"CCXT master {path}: HTTP {status}")
    status, _, body = fetch("https://api.github.com/repos/ccxt/ccxt/commits?per_page=1&sha=master")
    try:
        head = json.loads(body)[0]
        print(f"CCXT master head HTTP {status}: {head['sha'][:7]} {head['commit']['committer']['date']}")
    except (KeyError, IndexError, json.JSONDecodeError):
        print(f"CCXT master head HTTP {status}: {body[:160]}")


MODES = {"pages": mode_pages, "markup": mode_markup, "listings": mode_listings}

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name in MODES if arg == "all" else [arg]:
        MODES[name]()
