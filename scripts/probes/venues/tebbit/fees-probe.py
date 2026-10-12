# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Tebbit fee probe for docs/profiles/tebbit/fees.md.

Public, unauthenticated and read-only, about fifteen requests in total.
It reads the help center articles that carry fees, funding and region wording through the public Zendesk API,
parses the perpetual fee table, compares it with the catalog's per contract fees,
and reads the maker and taker CoinMarketCap shows for the venue.
Run from the repository root with: uv run scripts/probes/venues/tebbit/fees-probe.py
"""

import html
import json
import re
import time
import urllib.error
import urllib.request

HC = "https://support.tebbitdocs.com/api/v2/help_center"
CATALOG = "https://tebbit.io/futures/fapi/market/v1/public/symbol/list"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=tebbit"
UA = "arbitrage-observatory-probe/1.0"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def text(body):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body or ""))).strip()


def fee_rows(body):
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = [text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) >= 6 and re.fullmatch(r"0(\.\d+)?", cells[-1] or "x"):
            rows.append(cells)
    return rows


def show(aid, needles, width=260):
    try:
        a = get(f"{HC}/en-001/articles/{aid}.json")["article"]
    except urllib.error.HTTPError:
        a = get(f"{HC}/zh-cn/articles/{aid}.json")["article"]
    t = text(a["body"])
    print(f"== {aid} {a['title'][:90]}")
    print(f"  locale {a['locale']}, created {a['created_at']}, updated {a['updated_at']}, {a['html_url']}")
    for n in needles:
        m = re.search(n, t, re.I)
        if m:
            print(f"  [{n}] {t[max(0, m.start() - 60):m.start() + width]}")
        else:
            print(f"  [{n}] not found")
    return a


def main():
    print(f"tebbit fees probe at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    a = show(43055037110681, [r"Maker Fee"])
    rows = fee_rows(a["body"])
    pairs = {}
    for r in rows:
        pairs[(r[-2], r[-1])] = pairs.get((r[-2], r[-1]), 0) + 1
    print(f"  fee table rows {len(rows)}, (maker, taker) counts {pairs}")
    print(f"  rows not at 0.0004 and 0.0004: {[(r[0], r[-2], r[-1]) for r in rows if (r[-2], r[-1]) != ('0.0004', '0.0004')]}")
    old = show(50639438129689, [r"Taker Fee Maker Fee"])
    orows = fee_rows(old["body"])
    print(f"  older table rows {len(orows)}, distinct (5th, 6th) columns {sorted({(r[4], r[5]) for r in orows})}")
    show(43055264652313, [r"Taker: ", r"Maker: ", r"BTC_USDT 0 0"])
    show(62180329502233, [r"as low as 0\.01%", r"two-way holding fees"])
    show(61093150998425, [r"reduced to 0", r"uniformly adjusted to 0"])
    show(51841572728601, [r"zero funding fee"])
    show(50631807271321, [r"Not Supported", r"Canada"])
    show(42597014186393, [r"funding fees"])
    show(60855137532569, [r"funding fees"])
    show(41977608050201, [r"Tebbit Technology Ltd"])
    show(42692489331097, [r"dual MSB", r"MSB Registration No"])
    show(41977719930777, [r"hedging to game", r"arbitrage"])
    show(57290419502361, [r"官方域名", r"备用域名"])
    for q in ("funding", "资金费率", "restricted", "API"):
        res = get(f"{HC}/articles/search.json?query={urllib.request.quote(q)}&per_page=25")
        titles = [r["title"][:50] for r in res.get("results", [])][:3]
        print(f"== help center search {q!r}: {res.get('count')} results, first {titles}")
    cat = get(CATALOG)["data"]
    perps = [r for r in cat if r["contractType"] == "PERPETUAL"]
    c = {}
    for r in perps:
        c[(r["makerFee"], r["takerFee"])] = c.get((r["makerFee"], r["takerFee"]), 0) + 1
    print(f"== catalog: {len(perps)} perpetuals, (makerFee, takerFee) counts {c}")
    liq = {}
    for r in perps:
        liq[r["liquidationFee"]] = liq.get(r["liquidationFee"], 0) + 1
    print(f"  liquidationFee counts {liq}, btc_usdt {next(r['liquidationFee'] for r in perps if r['symbol'] == 'btc_usdt')}")
    by_base = {r["baseCoin"].lower(): (r["makerFee"], r["takerFee"]) for r in perps}
    diff = [(r[0].strip().lower(), r[-2], r[-1], by_base.get(r[0].strip().lower())) for r in rows if by_base.get(r[0].strip().lower()) not in (None, (r[-2], r[-1]))]
    missing = [r[0].strip() for r in rows if r[0].strip().lower() not in by_base]
    print(f"  article rows whose catalog fee differs: {diff}")
    print(f"  article rows with no live perpetual: {len(missing)}, first {missing[:10]}")
    cmc = get(CMC)["data"]
    print(f"== CoinMarketCap: makerFee {cmc['makerFee']}, takerFee {cmc['takerFee']}, fee url {cmc['urls']['fee']}, website {cmc['urls']['website']}, launched {cmc['dateLaunched']}")


if __name__ == "__main__":
    main()
