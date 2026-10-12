# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""SunX (sunx.vip) fee probe for docs/profiles/sunx/fees.md.

Public, unauthenticated and read-only, about 20 requests over about 30 seconds.
  1. The help center page CoinMarketCap names as the fee source, through the browser URL and through the Zendesk JSON API.
  2. Help center searches for fee, funding, overnight, terms and restricted, through the same API.
  3. The articles the fee profile cites, with their update dates and the lines that carry rates, regions or entities.
  4. The fee fields of the live perpetual and spot catalogs, for comparison with the articles.
  5. CoinMarketCap's own maker and taker for both venues that CoinMarketCap names SunX.
Run from the repository root with: uv run scripts/probes/venues/sunx/fees-probe.py
"""

import collections
import html
import json
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html, */*"}
HC = "https://support.sunx.vip"
ARTICLES = {
    7655697171983: "perpetual parameters and fees",
    14333323439759: "taker fee adjustment",
    7663768899087: "quick contract parameters and fees",
    13998911880975: "overnight fee mechanism",
    14780005479567: "spot fee adjustment",
    14076014471311: "service agreement",
    14075765676687: "contract service agreement",
    13896801724559: "compliance transformation notice",
}
KEYS = re.compile(r"(%|fee|rate|maker|taker|vip|tier|overnight|spread|funding|hour|countr|region|jurisdiction|united states|canada|china|"
                  r"singapore|resident|prohibit|restrict|ltd|limited|inc\.|registered|licen|entity|operat)", re.I)


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:
        return None, {}, f"{type(e).__name__}: {e}".encode(), (time.perf_counter() - t0) * 1000


def lines_of(body_html):
    t = html.unescape(re.sub(r"<[^>]+>", "\n", body_html))
    return [x.strip() for x in t.split("\n") if x.strip()]


def section_source():
    print("== 1. CoinMarketCap's fee link")
    st, hd, body, ms = get(HC + "/hc/en-001/articles/7655697171983")
    title = re.search(rb"<title>([^<]*)", body)
    print(f"browser URL: {st} {ms:.0f} ms title={title.group(1).decode() if title else None!r} server={hd.get('Server') or hd.get('server')}")
    st, hd, body, ms = get(HC + "/api/v2/help_center/en-001/articles/7655697171983.json")
    a = json.loads(body)["article"] if st == 200 else {}
    print(f"JSON API: {st} {ms:.0f} ms, canonical url {a.get('url')}")


def section_search():
    print("== 2. Help center searches")
    for q in ("fee", "funding", "overnight", "terms", "restricted", "API"):
        st, hd, body, ms = get(f"{HC}/api/v2/help_center/articles/search.json?query={q}&locale=en-001")
        d = json.loads(body) if st == 200 else {}
        print(f"query {q}: {st} count {d.get('count')}")
        for r in d.get("results", [])[:6]:
            print(f"  {r['id']} {r['updated_at'][:10]} {r['title']}")


def section_articles():
    print("== 3. Cited articles")
    for aid, label in ARTICLES.items():
        st, hd, body, ms = get(f"{HC}/api/v2/help_center/en-001/articles/{aid}.json")
        if st != 200:
            print(f"{aid} {label}: {st} {body[:120]!r}")
            continue
        a = json.loads(body)["article"]
        ls = lines_of(a["body"])
        print(f"-- {aid} {label}: '{a['title']}', updated {a['updated_at']}, edited {a['edited_at']}, {len(ls)} lines")
        hits = [x for x in ls if KEYS.search(x)]
        for x in hits[:40]:
            print("   ", x[:260])


def section_catalog():
    print("== 4. Catalog fee fields")
    st, hd, body, ms = get("https://sunx.vip/v1/cfd/public/instruments")
    on = [x for x in json.loads(body)["data"] if x["status"] == "online"]
    for k in ("takerFee", "makerFee", "commissionRate", "openSpread", "closeSpread", "settlementRate", "fundingIntervalHours"):
        print(f"perpetual {k}:", collections.Counter(x[k] for x in on).most_common(6))
    btc = next(x for x in on if x["symbol"] == "btcusdt")
    print("btcusdt:", {k: btc[k] for k in ("takerFee", "makerFee", "commissionRate", "openSpread", "closeSpread", "settlementRate", "fundingIntervalHours")})
    st, hd, body, ms = get("https://sunx.vip/v1/cfd/public/spot_instruments")
    sp = json.loads(body)["data"]
    fee_keys = sorted(k for k in sp[0] if "ee" in k.lower() or "rate" in k.lower() or "commission" in k.lower())
    for k in fee_keys:
        print(f"spot {k}:", collections.Counter(str(x[k]) for x in sp).most_common(4))


def section_cmc():
    print("== 5. CoinMarketCap fees")
    for slug in ("sunx", "sunperp"):
        st, hd, body, ms = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug={slug}")
        d = json.loads(body).get("data", {}) if st == 200 else {}
        print(f"{slug}: {st} id {d.get('id')} website {d.get('urls', {}).get('website')} makerFee {d.get('makerFee')} takerFee {d.get('takerFee')} fee link {d.get('urls', {}).get('fee')}")


if __name__ == "__main__":
    section_source()
    section_search()
    section_articles()
    section_catalog()
    section_cmc()
