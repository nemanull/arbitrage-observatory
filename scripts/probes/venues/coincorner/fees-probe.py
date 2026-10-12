# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of CoinCorner's fee schedule, product coverage and third-party listings.

Modes:
  page      the fee redirect, the Zendesk fee article through the Help Center API, and the supported countries page
  coverage  help centre searches for futures, perpetual, margin and leverage, plus the trading articles
  listings  CoinMarketCap exchange record and market pairs, CoinGecko exchange and derivatives lists, CCXT master
  all       every mode above, in order
"""

import html
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (survey probe)", "Accept": "application/json, text/html"}
HC = "https://support.coincorner.com/api/v2/help_center"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url: str, follow: bool = True) -> tuple[int, dict, str]:
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(urllib.request.Request(url, headers=UA), timeout=20) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


def text_of(body: str) -> list[str]:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", body, flags=re.S)
    t = re.sub(r"<td[^>]*>", " | ", t)
    t = re.sub(r"<(tr|p|li|h\d|br|div)[^>]*>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return [line.strip() for line in t.splitlines() if line.strip()]


def article(aid: int) -> dict:
    status, _, body = fetch(f"{HC}/en-us/articles/{aid}.json")
    a = json.loads(body)["article"]
    print(f"article {aid} HTTP {status} title {a['title']!r} updated_at {a['updated_at']}")
    return a


def mode_page() -> None:
    print(f"## page {now()}")
    for url in ("https://www.coincorner.com/fees", "https://www.coincorner.com/Fees"):
        status, h, _ = fetch(url, follow=False)
        print(f"{url} HTTP {status} Location {h.get('Location') or h.get('location')}")
    a = article(5901068854812)
    lines = text_of(a["body"])
    start = next(i for i, line in enumerate(lines) if line.startswith("Cryptocurrency buy/sell"))
    print("buy and sell section:", " / ".join(lines[start:start + 12]))
    start = next(i for i, line in enumerate(lines) if line.startswith("Withdrawal"))
    print("withdrawal section:", " / ".join(lines[start:start + 30]))
    status, _, body = fetch("https://www.coincorner.com/countries")
    lines = text_of(body)
    i = next(k for k, line in enumerate(lines) if line.startswith("If you don"))
    j = next(k for k in range(i, len(lines)) if lines[k].startswith("This site uses cookies"))
    countries = lines[i + 1:j]
    print(f"countries page HTTP {status}, {len(countries)} countries: {', '.join(countries)}")
    footer = next(line for line in lines if line.startswith("CoinCorner Ltd ("))
    print("footer:", footer)


def mode_coverage() -> None:
    print(f"## coverage {now()}")
    for q in ("futures", "perpetual", "margin", "leverage", "order book", "limit order", "API"):
        status, _, body = fetch(f"{HC}/articles/search.json?query={urllib.parse.quote(q)}&per_page=50")
        d = json.loads(body)
        exact = [r["title"] for r in d.get("results", []) if q.lower() in (r["title"] + " " + r.get("body", "")).lower()]
        print(f"search {q!r} HTTP {status} count {d.get('count')}, articles whose title or body contain the phrase: {exact}")
    for aid in (360001862453, 360001952954, 360004119833, 25625527470620):
        a = article(aid)
        lines = text_of(a["body"])
        print("  " + " ".join(lines)[:500])


def mode_listings() -> None:
    print(f"## listings {now()}")
    _, _, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coincorner")
    d = json.loads(body)["data"]
    print(f"CMC id {d['id']} name {d['name']} launched {d['dateLaunched']} makerFee {d['makerFee']} takerFee {d['takerFee']} fee url {d['urls'].get('fee')} tags {[t['slug'] for t in d.get('tags', [])]}")
    print(f"CMC quote USD {json.dumps(d['quote'].get('2781'))}")
    print(f"CMC quote BTC {json.dumps(d['quote'].get('1'))}")
    for cat in ("spot", "perpetual", "futures"):
        _, _, body = fetch(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coincorner&category={cat}&start=1&limit=100")
        x = json.loads(body).get("data") or {}
        pairs = [(p["marketPair"], round(p["price"], 2), round(p["volumeUsd"], 2)) for p in x.get("marketPairs", [])]
        print(f"CMC {cat} pairs {x.get('numMarketPairs')}: {pairs}")
    _, _, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2&start=1&limit=500")
    rows = json.loads(body)["data"]["exchanges"]
    print(f"CMC derivatives listing exType=2: {len(rows)} venues, CoinCorner present: {any('corner' in r['slug'] for r in rows)}")
    for url in ("https://api.coingecko.com/api/v3/exchanges/list", "https://api.coingecko.com/api/v3/derivatives/exchanges/list"):
        _, _, body = fetch(url)
        rows = json.loads(body)
        print(f"{url}: {len(rows)} rows, CoinCorner rows {[r for r in rows if 'corner' in r['id'] or 'corner' in r['name'].lower()]}")
    _, _, body = fetch("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body)["ids"]
    print(f"CCXT master exchanges.json: {len(ids)} ids, ids containing 'corner': {[i for i in ids if 'corner' in i]}")
    for path in ("ts/src/coincorner.ts", "js/src/coincorner.js"):
        status, _, _ = fetch(f"https://raw.githubusercontent.com/ccxt/ccxt/master/{path}")
        print(f"CCXT master {path}: HTTP {status}")
    _, _, body = fetch("https://api.github.com/repos/ccxt/ccxt/commits?per_page=1&sha=master")
    c = json.loads(body)
    if isinstance(c, list) and c:
        print(f"CCXT master head {c[0]['sha'][:7]} {c[0]['commit']['committer']['date']}")
    else:
        print(f"CCXT master head not read, GitHub API answered {str(c)[:160]}")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    modes = {"page": mode_page, "coverage": mode_coverage, "listings": mode_listings}
    for name in (modes if mode == "all" else [mode]):
        modes[name]()


if __name__ == "__main__":
    import urllib.parse

    main()
