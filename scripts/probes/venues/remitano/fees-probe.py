# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Remitano fee, coverage and CCXT probe, read-only and unauthenticated.

Remitano's fee page https://remitano.com/global/fees answers a Cloudflare challenge from this host, so the fee numbers here come from the wire.
/api/v1/order_books is not in the OpenAPI document at https://api.remitano.com/api/v1/doc.
The web app bundle fetches it and reads maker_fee_percentage and taker_fee_percentage per directed pair.
The probe finds the current bundle names in the web app HTML at https://remitano.com/policy/api_terms_of_service, which this host is served.

Run from the repository root: uv run scripts/probes/venues/remitano/fees-probe.py
It sends about a dozen requests, one at a time.
"""

import collections
import json
import pathlib
import re
import urllib.error
import urllib.request

API = "https://api.remitano.com/api/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT_SRC = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
CCXT_INDEX = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def fee_map():
    print("== fee map, GET /api/v1/order_books")
    s, h, b = get(f"{API}/order_books")
    fees = json.loads(b)
    print(f"status {s} bytes {len(b)} cache-control {h.get('cache-control')} directed pairs {len(fees)}")
    combos = collections.Counter((v["maker_fee_percentage"], v["taker_fee_percentage"]) for v in fees.values())
    print(f"(maker %, taker %) across all directed pairs {combos.most_common()}")
    s, h, b = get(f"{API}/markets/exchange_info")
    pairs = [r["trading_pairs"] for r in json.loads(b)["data"]]
    rows = {}
    for p in pairs:
        base, quote = p.lower().split("_")
        rows[p] = (fees.get(f"{base}_{quote}"), fees.get(f"{quote}_{base}"))
    distinct = collections.Counter(json.dumps(v, sort_keys=True) for v in rows.values())
    print(f"the {len(pairs)} public USDT pairs, both directions: {distinct.most_common()}")
    print(f"btc_usdt {fees.get('btc_usdt')} usdt_btc {fees.get('usdt_btc')}")
    by_quote = collections.defaultdict(collections.Counter)
    for k, v in fees.items():
        q = k.split("_")[-1]
        by_quote[q][(v["maker_fee_percentage"], v["taker_fee_percentage"])] += 1
    for q in ("usdt", "vnd", "ngn", "btc", "usd"):
        print(f"directed pairs ending in _{q}: {dict(by_quote[q])}")
    for k in ("usdt_vnd", "vnd_usdt", "vnd_btc", "btc_vnd"):
        print(f"{k} {fees.get(k)}")


def bundle_strings():
    print("\n== web app strings")
    s, h, b = get("https://remitano.com/policy/api_terms_of_service")
    html = b.decode("utf-8", "replace")
    print(f"policy page status {s} bytes {len(b)}")
    for k in ("WEBSOCKET_HOST", "CABLESOCKET_HOST"):
        m = re.search(rf'window\.{k}\s*=\s*"([^"]*)"', html)
        print(f"window.{k} = {m.group(1) if m else None}")
    chunks = re.findall(r'src="(https://cdn\.remitano\.com/assets/chunks/(?:en|react)-[0-9a-f]+\.js)"', html)
    print(f"chunks {chunks}")
    text = ""
    for url in chunks:
        s, h, b = get(url)
        print(f"{url} status {s} bytes {len(b)}")
        text += b.decode("utf-8", "replace")
    for pat in (r'"What is the P2P taker fee\?"', r'Takers who buy and sell cryptocurrencies from existing adverts[^"]{0,160}',
                r'Delta Exchange offers Futures and Options[^"]{0,40}', r'Kine exchange offers perpetual futures[^"]{0,60}',
                r'channel:"order_book_price_level_state"', r'"/api/v1/order_books"', r'"/api/v1/order_book_price_levels"'):
        m = re.search(pat, text)
        print(f"{pat[:50]!r}: {m.group(0)[:220] if m else 'not found'}")
    for word in ("perpetual", "Perpetual", "funding_rate", "mark_price", "index_price", "leverage"):
        print(f"count of {word!r} in the bundles: {text.count(word)}")


def derivatives_paths():
    print("\n== derivatives in the API documents")
    for v in ("v1", "v2"):
        s, h, b = get(f"https://api.remitano.com/api/{v}/doc")
        d = json.loads(b)
        paths = list(d["paths"])
        hits = [p for p in paths if re.search(r"futur|perp|funding|mark_price|premium|index_price|leverage|margin", p, re.I)]
        print(f"{v} doc status {s} paths {len(paths)} matching futures, perpetual, funding, mark price, premium, index price, leverage or margin: {hits}")
    s, h, b = get("https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2&start=1&limit=500&sortBy=score&sortType=desc")
    ex = json.loads(b)["data"]["exchanges"]
    print(f"CoinMarketCap derivatives ranking status {s} venues {len(ex)} remitano listed {any('remitano' in (e.get('slug') or '') for e in ex)}")
    s, h, b = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    print(f"CoinGecko derivatives list status {s} venues {len(json.loads(b))} remitano listed {'remitano' in b.decode().lower()}")
    s, h, b = get("https://api.coingecko.com/api/v3/exchanges/remitano")
    print(f"CoinGecko exchanges/remitano status {s} {b[:80].decode('utf-8', 'replace')}")


def ccxt():
    print("\n== CCXT")
    print(f"4.5.68 js/src has remitano.js: {(CCXT_SRC / 'remitano.js').exists()}, classes {len(list(CCXT_SRC.glob('*.js')))}")
    idx = CCXT_INDEX.read_text().splitlines()
    start = next(i for i, l in enumerate(idx) if l.startswith("const exchanges = {"))
    print(f"js/ccxt.js line {start + 1} opens the exchanges map, lines naming remitano: {[i + 1 for i, l in enumerate(idx) if 'remitano' in l.lower()]}")
    s, h, b = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(b).get("ids", [])
    print(f"ccxt master exchanges.json status {s} ids {len(ids)} remitano listed {'remitano' in ids}")
    for path in ("ts/src/remitano.ts", "js/src/remitano.js"):
        s, h, b = get(f"https://raw.githubusercontent.com/ccxt/ccxt/master/{path}")
        print(f"ccxt master {path} status {s}")


if __name__ == "__main__":
    fee_map()
    bundle_strings()
    derivatives_paths()
    ccxt()
