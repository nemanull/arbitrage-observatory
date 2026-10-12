# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of GudangKripto's fee schedule, product coverage and third-party listings.

Public, unauthenticated and read-only.
GudangKripto publishes no API documentation, so the fee schedule is read from the web app.
The /trading-fees page renders a table that ships inside one Nuxt chunk, and the backend serves a public app-parameter call with the fee rates the app charges.

Modes:
  table     the /trading-fees route, its page chunk and the data chunk with the fee, trading rule and withdrawal tables
  coverage  the app's route table and its futures disclaimer, to establish which products the web app offers
  params    https://be.gudangkripto.id/api/core/app-parameter, the backend's fee parameters, and the public FAQ
  listings  CoinMarketCap exchange record, market pairs and derivatives ranking, CoinGecko lists, CCXT master
  all       every mode above, in order
Run from the repository root with: uv run scripts/probes/venues/gudangkripto/fees-probe.py [mode]
"""

import collections
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0 (survey probe)", "Accept": "application/json, text/html, */*"}
SITE = "https://gudangkripto.id"
BACKEND = "https://be.gudangkripto.id"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(url: str, data: bytes | None = None, headers: dict | None = None) -> tuple[int, dict, str]:
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


def chunk(name: str) -> str:
    status, _, body = fetch(f"{SITE}/_nuxt/{name}")
    print(f"chunk {name} HTTP {status} {len(body)} bytes")
    return body


def mode_table() -> None:
    print(f"## table {now()}")
    status, headers, home = fetch(f"{SITE}/trading-fees")
    print(f"/trading-fees HTTP {status} {len(home)} bytes server {headers.get('Server')}")
    entry = re.search(r'<script type="module" src="/_nuxt/([^"]+\.js)"', home).group(1)
    body = chunk(entry)
    route = re.search(r'name:"trading-fees",path:"/trading-fees".{0,80}?import\("\./([^"]+\.js)"\)', body)
    print(f"route trading-fees loads {route.group(1)}")
    page = chunk(route.group(1))
    tabs = re.search(r'\{label:"Exchange Fees".{0,120}?\]', page)
    print("page tabs:", tabs.group(0) if tabs else None)
    data_name = re.search(r'import\{E as [\w$]+,T as [\w$]+,W as [\w$]+\}from"\./([^"]+\.js)"', page).group(1)
    data = chunk(data_name)
    exchange, rules, withdrawal = re.split(r"\],(?=[a-z]=\[)", data)[:3]
    pairs = re.findall(r'pair:"([^"]+)"', exchange)
    print(f"exchange fee rows {len(pairs)}: {', '.join(pairs)}")
    print("trading fee buy, sell:", dict(collections.Counter(re.findall(r'trading_fee:\{buy:"([^"]+)",sell:"([^"]+)"\}', exchange))))
    print("CFX fee buy, sell:", dict(collections.Counter(re.findall(r'cfx_fee:\{buy:"([^"]+)",sell:"([^"]+)"\}', exchange))))
    print("tax buy, sell:", dict(collections.Counter(re.findall(r'tax:\{buy:"([^"]+)",sell:"([^"]+)"\}', exchange))))
    print("first row:", re.search(r"\{pair:\"BTC/IDR\"[^}]*\}[^}]*\}[^}]*\}[^}]*\}", exchange).group(0))
    print(f"trading rule rows {len(re.findall(r'pair:', rules))}, BTC row:", re.search(r'\{pair:"BTC ?/ ?IDR"[^}]*\}', rules).group(0))
    print(f"withdrawal rows {len(re.findall(r'pair:', withdrawal))}, BTC row:", re.search(r'\{pair:"BTC"[^}]*\}', withdrawal).group(0))
    status, _, body_coins = fetch(f"{BACKEND}/api/core/coin")
    coins = {c["coin"] for c in json.loads(body_coins)["data"]}
    table = {p.split("/")[0].strip() for p in pairs}
    print(f"coin list HTTP {status} {len(coins)} coins, in the fee table and not the coin list {sorted(table - coins)}, in the coin list and not the fee table {sorted(coins - table)}")
    i18n = re.search(r'spotTrading:\{title:"Spot Trading Fees",description:"([^"]+)"', body)
    print("unused i18n string for a tier table:", i18n.group(1) if i18n else None)
    tier_rows = re.findall(r"tier[s]?:\[\{", page)
    print(f"tier arrays in the page chunk: {len(tier_rows)}")
    for key in ["maker", "taker", "vip", "VIP"]:
        print(f"'{key}' occurrences in page chunk {page.count(key)}, data chunk {data.count(key)}")


def mode_coverage() -> None:
    print(f"## coverage {now()}")
    status, _, home = fetch(f"{SITE}/")
    entry = re.search(r'<script type="module" src="/_nuxt/([^"]+\.js)"', home).group(1)
    body = chunk(entry)
    routes = re.findall(r'\{name:"([^"]+)",path:"([^"]+)"', body)
    hits = [r for r in routes if re.search(r"futur|perp|deriv|margin|lever|swap|contract", r[0] + r[1], re.I)]
    print(f"route entries {len(routes)}, entries naming futures, perpetual, derivative, margin, leverage, swap or contract: {hits}")
    print(f"trade routes: {sorted({p for _, p in routes if re.search(r'trade|market', p)})}")
    for key in ["disclaimer_2", "footer_sentence_3", "footer_sentence_4"]:
        for m in re.finditer(key + r':"([^"]+)"', body):
            print(f"{key}: {m.group(1)}")
    print("menu label strings equal to Futures:", len(re.findall(r'="Futures"', body)))
    print("i18n keys named futures:", len(re.findall(r"[,{]futures:", body)))


def mode_params() -> None:
    print(f"## params {now()}")
    status, headers, body = fetch(f"{BACKEND}/api/core/app-parameter")
    print(f"app-parameter HTTP {status} {len(body)} bytes cf-ray {headers.get('cf-ray') or headers.get('CF-RAY')}")
    d = json.loads(body)["data"]
    for k in ["buy_fee_percent", "sell_fee_percent", "pph", "ppn", "cfx_buy_fee_fiat", "cfx_sell_fee_fiat", "cfx_buy_fee_crypto_pair",
              "cfx_sell_fee_crypto_pair", "fee_cfx_idr_percentage", "fee_cfx_crypto_percentage", "spread_price_percentage",
              "cash_out_idr_fee", "min_deposit_idr", "max_higher_sell", "max_lower_buy", "max_lower_sell"]:
        print(f"  {k} = {d.get(k)!r}")
    print(f"  all keys: {', '.join(d)}")
    status, _, body = fetch(f"{BACKEND}/api/core/faqs")
    faqs = json.loads(body)["data"]
    print(f"faqs HTTP {status} {len(faqs)} entries")
    for f in faqs:
        q = f.get("question") or ""
        a = (f.get("answer") or "").replace("\r\n", " ").replace("\n", " ")
        if re.search(r"fee|futures|perpetual|leverage|margin|commission", q + a, re.I):
            print(f"  Q {q!r}\n    A {a[:400]!r}")
    hits = collections.Counter()
    for f in faqs:
        text = json.dumps(f).lower()
        for word in ["futures", "perpetual", "leverage", "margin", "derivative"]:
            hits[word] += text.count(word)
    print(f"  derivative words across all FAQ entries: {dict(hits)}")


def mode_listings() -> None:
    print(f"## listings {now()}")
    cmc = "https://api.coinmarketcap.com/data-api/v3/exchange"
    status, _, body = fetch(f"{cmc}/detail?slug=gudangkripto")
    d = json.loads(body)["data"]
    q = d["quote"]["2781"]
    print(f"CMC detail HTTP {status} id {d['id']} name {d['name']} launched {d['dateLaunched']} countries {d['countries']}")
    print(f"  urls website {d['urls']['website']} fee {d['urls']['fee']} actual {d['urls']['actual']}")
    print(f"  makerFee {d['makerFee']} takerFee {d['takerFee']} spotVolume24h USD {q['spotVolume24h']:.2f} perpetualVolume24h {q['perpetualVolume24h']} futuresVolume24h {q['futuresVolume24h']} updated {q['updateTime']}")
    print(f"  tags {[t['name'] for t in d.get('tags', [])]}")
    for cat in ["spot", "perpetual", "futures"]:
        status, _, body = fetch(f"{cmc}/market-pairs/latest?slug=gudangkripto&category={cat}&start=1&limit=100")
        data = json.loads(body).get("data", {})
        pairs = data.get("marketPairs", [])
        print(f"CMC market pairs {cat} HTTP {status} numMarketPairs {data.get('numMarketPairs')} returned {len(pairs)}: {', '.join(p['marketPair'] for p in pairs)}")
    status, _, body = fetch(f"{cmc}/listing?exType=2&start=1&limit=500&sort=volume_24h&sortType=desc")
    rows = json.loads(body)["data"]["exchanges"]
    print(f"CMC derivatives ranking exType=2 HTTP {status} {len(rows)} venues, GudangKripto present {any('gudang' in r['slug'] for r in rows)}")
    status, _, body = fetch("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    deriv = json.loads(body)
    print(f"CoinGecko derivatives list HTTP {status} {len(deriv)} venues, gudang matches {[x for x in deriv if 'gudang' in (x['id'] + x['name']).lower()]}")
    status, _, body = fetch("https://api.coingecko.com/api/v3/exchanges/list")
    ex = json.loads(body)
    print(f"CoinGecko exchanges list HTTP {status} {len(ex)} venues, gudang matches {[x for x in ex if 'gudang' in (x['id'] + x['name']).lower()]}")
    status, _, body = fetch("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body)["ids"]
    print(f"CCXT master exchanges.json HTTP {status} {len(ids)} ids, matches {[i for i in ids if 'gudang' in i or 'kripto' in i]}")
    for path in ["ts/src/gudangkripto.ts", "js/src/gudangkripto.js"]:
        status, _, _ = fetch(f"https://raw.githubusercontent.com/ccxt/ccxt/master/{path}")
        print(f"CCXT master {path} HTTP {status}")
    status, _, body = fetch("https://api.github.com/repos/ccxt/ccxt/commits?per_page=1&sha=master", headers={"Accept": "application/vnd.github+json"})
    if status == 200:
        c = json.loads(body)[0]
        print(f"CCXT master head {c['sha'][:7]} {c['commit']['committer']['date']}")
    else:
        print(f"CCXT master head HTTP {status}")


MODES = {"table": mode_table, "coverage": mode_coverage, "params": mode_params, "listings": mode_listings}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in MODES.items():
        if mode in (name, "all"):
            fn()
