# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""ASTX (astx.io) fee and catalog probe for docs/profiles/astx/fees.md and rest.md.

Public, unauthenticated and read-only.
www.astx.io refuses every TLS handshake from this host, see rest-probe.py, so this probe reads only what is reachable.
It reads the CoinMarketCap exchange record and its spot, perpetual and futures pair lists, and Binance's public futures prices for comparison.
It reads the ASTX help center through its Zendesk JSON API, since the HTML pages sometimes answer with a Cloudflare challenge.
From the help center it parses the two perpetual parameter tables, the spot fee announcement, the terms, the agent rebates and the index text.
Last it checks whether CCXT 4.5.68 or CCXT master on GitHub has an ASTX class.
About 20 requests over about 15 s.
Run from the repository root with: uv run scripts/probes/venues/astx/fees-probe.py
"""

import collections
import html
import json
import pathlib
import re
import statistics
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"
ZD = "https://support.astx.io/api/v2/help_center/en-us"
TABLE_I = 14834308052111
TABLE_II = 14832769069967
SPOT_FEE = 14534137215887
TERMS = 14533480830223
REGISTRATION = 15891094193423
AGENT_REBATE = 15727051822863
ORDER_GUIDE = 14576071558031
CCXT_DIR = pathlib.Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


def section(title):
    print(f"\n== {title}")


def text(body):
    body = re.sub(r"<img[^>]*>", "", body)
    body = re.sub(r"</(p|tr|li|h\d|div|td)>", "\n", body)
    body = html.unescape(re.sub(r"<[^>]+>", "", body))
    return re.sub(r"\n\s*\n+", "\n", body).strip()


def cells(body):
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", body, flags=re.S)]


def cmc_record():
    section("CoinMarketCap exchange record")
    status, d = get_json(f"{CMC}/detail?slug=astx")
    d = d["data"]
    q = d["quote"]["1"]
    print(f"status {status}, id {d['id']}, name {d['name']}, dateLaunched {d['dateLaunched']}, status {d['status']}")
    print(f"urls.website {d['urls']['website']}, urls.fee {d['urls']['fee']}")
    print(f"countries {d['countries']}, fiats {d['fiats']}, makerFee {d['makerFee']}, takerFee {d['takerFee']}")
    print(f"description starts: {d['description'][:120]!r}")
    print(f"spotVolume24h {q['spotVolume24h']:.0f}, perpetualVolume24h {q['perpetualVolume24h']:.0f}, "
          f"futuresVolume24h {q['futuresVolume24h']}, derivativesOpenInterests {q['derivativesOpenInterests']:.0f}, updateTime {q['updateTime']}")


def cmc_pairs():
    section("CoinMarketCap market pairs")
    out = {}
    for cat in ("spot", "perpetual", "futures"):
        status, d = get_json(f"{CMC}/market-pairs/latest?slug=astx&category={cat}&start=1&limit=500")
        pairs = d["data"]["marketPairs"]
        out[cat] = pairs
        quotes = collections.Counter(p["quoteSymbol"] for p in pairs)
        excl = collections.Counter((p.get("priceExcluded"), p.get("volumeExcluded")) for p in pairs)
        vol = sum(p["volumeUsd"] or 0 for p in pairs)
        print(f"{cat}: status {status}, numMarketPairs {d['data']['numMarketPairs']}, rows {len(pairs)}, quotes {dict(quotes)}, "
              f"(priceExcluded, volumeExcluded) {dict(excl)}, summed pair volumeUsd {vol:.0f}")
        if pairs:
            print(f"  lastUpdated range {min(p['lastUpdated'] for p in pairs)} to {max(p['lastUpdated'] for p in pairs)}")
            print(f"  marketUrl values {collections.Counter(p.get('marketUrl') for p in pairs).most_common(3)}")
    perps = out["perpetual"]
    if perps:
        print(f"perpetual fundingRate nonzero on {sum(1 for p in perps if p.get('fundingRate'))} of {len(perps)}")
        print(f"perpetual derivativeTickerId sample {[p.get('derivativeTickerId') for p in perps[:5]]}")
    return out


def binance_compare(perps):
    section("CoinMarketCap ASTX perpetual price against Binance USD-M futures last price")
    status, bn = get_json("https://fapi.binance.com/fapi/v1/ticker/price")
    bn = {x["symbol"]: float(x["price"]) for x in bn}
    rows = []
    for p in perps:
        s = p["baseSymbol"] + "USDT"
        if s in bn and p["price"]:
            rows.append((abs(p["price"] / bn[s] - 1), p["marketPair"], p["price"], bn[s], p["volumeUsd"]))
    rows.sort()
    print(f"status {status}, matched {len(rows)} of {len(perps)}")
    print(f"median deviation {100 * statistics.median(r[0] for r in rows):.2f}%, within 1% {sum(r[0] < 0.01 for r in rows)}, "
          f"over 5% {sum(r[0] > 0.05 for r in rows)}")
    for r in rows[-3:]:
        print(f"  {r[1]}: CMC {r[2]:.6g}, Binance {r[3]:.6g}, deviation {100 * r[0]:.1f}%, CMC volumeUsd {r[4]:.0f}")


def help_center():
    section("help center article list through the Zendesk API")
    url, arts = f"{ZD}/articles.json?per_page=100", []
    while url:
        status, d = get_json(url)
        arts += d["articles"]
        url = d.get("next_page")
        time.sleep(0.5)
    print(f"status {status}, {len(arts)} articles, Zendesk account {arts[0]['url'].split('/')[2]}")
    hits = [a["title"] for a in arts if re.search(r"\bAPI\b|websocket|developer", a["title"] + a["body"], flags=re.I)]
    print(f"articles naming API, websocket or developer in title or body: {len(hits)} {hits[:5]}")
    vip = [a["title"] for a in arts if re.search(r"\bVIP\b|fee tier|volume tier", a["title"] + text(a["body"]), flags=re.I)]
    print(f"articles naming VIP, fee tier or volume tier: {len(vip)} {vip[:6]}")
    region = [a["title"] for a in arts if re.search(r"United States|\bU\.S\.|Canada|restricted (countr|region|jurisdiction)|prohibited (countr|region|jurisdiction)",
                                                    text(a["body"]), flags=re.I)]
    print(f"articles naming the United States, Canada or a restricted region: {len(region)} {region[:5]}")
    newest = sorted(arts, key=lambda a: a["created_at"])[-3:]
    for a in newest:
        print(f"  newest: {a['created_at']} {a['title']}")


def param_tables():
    section("perpetual parameter tables")
    allpairs = {}
    for aid in (TABLE_I, TABLE_II):
        status, d = get_json(f"{ZD}/articles/{aid}.json")
        a = d["article"]
        c = cells(a["body"])
        rows = []
        for i, x in enumerate(c):
            m = re.match(r"(\S+?/USDT)\s*[（(]Trading Fee Rate[：:]\s*maker[:：]\s*([\d.]+)%\s*taker[:：]\s*([\d.]+)%", x)
            if m:
                rows.append((m.group(1), m.group(2), m.group(3), c[i + 5], c[i + 6], c[i + 7], c[i + 8].replace(" ", "")))
        for r in rows:
            allpairs.setdefault(r[0], r)
        print(f"{a['title']}: status {status}, updated_at {a['updated_at']}, {len(rows)} pairs")
        print(f"  (maker %, taker %) {dict(collections.Counter((r[1], r[2]) for r in rows))}")
        print(f"  funding limits {dict(collections.Counter(r[5] for r in rows))}, intervals {dict(collections.Counter(r[6] for r in rows))}")
        print(f"  4 h pairs {[r[0] for r in rows if r[6] == '4H']}")
        print(f"  first rows {rows[:2]}")
        if aid == TABLE_I:
            body = text(a["body"])
            print(f"  formula text: {body[:200]!r}")
    print(f"distinct pairs over both tables {len(allpairs)}")
    return allpairs


def compare_catalogs(allpairs, perps):
    section("parameter tables against CoinMarketCap's perpetual list")
    cmc = {p["marketPair"] for p in perps}
    tab = set(allpairs)
    print(f"in both {len(cmc & tab)}, only CMC {len(cmc - tab)} {sorted(cmc - tab)[:10]}, only tables {len(tab - cmc)}")


def articles():
    for aid, label in ((SPOT_FEE, "spot fee announcement"), (TERMS, "terms of use"), (REGISTRATION, "registration notice"),
                       (AGENT_REBATE, "agent rebate programme"), (ORDER_GUIDE, "contract order guide")):
        section(label)
        status, d = get_json(f"{ZD}/articles/{aid}.json")
        a = d["article"]
        t = text(a["body"])
        print(f"status {status}, {a['title']!r}, updated_at {a['updated_at']}")
        for pat in (r"[^.\n]*0\.1%[^.\n]*", r"[^.\n]*governed by[^.\n]*", r"[^.\n]*new users will be unable[^.\n]*",
                    r"[^.\n]*(restrict|prohibit)ed (countr|region|jurisdiction)[^.\n]*", r"[^.\n]*United States[^.\n]*",
                    r"Up to 90% commission rebate", r"≥\d+ million\n\d+%", r"[^.\n]*weighted average price[^.\n]*"):
            for m in re.finditer(pat, t, flags=re.I):
                print(f"  {m.group(0).strip()}")


def ccxt():
    section("CCXT")
    files = sorted(CCXT_DIR.glob("*.js"))
    named = [f.name for f in files if "astx" in f.name.lower()]
    mention = [f.name for f in files if re.search(r"\bastx\b", f.read_text(errors="replace"), flags=re.I)]
    print(f"CCXT 4.5.68: {len(files)} .js files in {CCXT_DIR}, named astx {named}, mentioning the word astx {mention}")
    status, d = get_json("https://api.github.com/repos/ccxt/ccxt/contents/ts/src")
    ts = [x["name"] for x in d if x["name"].endswith(".ts")]
    print(f"CCXT master ts/src: status {status}, {len(ts)} .ts files, named astx {[n for n in ts if 'astx' in n.lower()]}")


if __name__ == "__main__":
    print(f"run at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    cmc_record()
    pairs = cmc_pairs()
    binance_compare(pairs["perpetual"])
    help_center()
    tables = param_tables()
    compare_catalogs(tables, pairs["perpetual"])
    articles()
    ccxt()
