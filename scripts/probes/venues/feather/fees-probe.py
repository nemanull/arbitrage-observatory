# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Feather Exchange (ftrex.io) fee probe for docs/profiles/feather/fees.md.

Public, unauthenticated and read-only.
It reads the fee page CoinMarketCap links, CoinMarketCap's exchange record and market pair lists, the fee fields of
Feather's own catalog, and a few candidate legal pages.
It also checks the installed CCXT 4.5.68 and CCXT master on GitHub for a Feather class.
About 15 requests, at most two a second.
Run from the repository root with: uv run scripts/probes/venues/feather/fees-probe.py
"""

import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT_SRC = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    finally:
        time.sleep(0.5)


def page_text(body):
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", body, flags=re.S)
    lines = [html.unescape(x).strip() for x in re.sub(r"<[^>]+>", "\n", body).split("\n")]
    return [x for x in lines if x]


def main():
    print(f"run at {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")

    print("\n== CoinMarketCap exchange record")
    status, body = get(f"{CMC}/detail?slug=feather-exchange")
    d = json.loads(body)["data"]
    print(f"status {status}, id {d['id']}, name {d['name']}, launched {d['dateLaunched']}, status {d['status']}")
    print(f"makerFee {d['makerFee']}, takerFee {d['takerFee']}, fee url {d['urls']['fee']}, website {d['urls']['website']}")
    print(f"countries {d['countries']}, fiats {d['fiats']}, tags {[t['name'] for t in d['tags']]}")
    q = d["quote"]["2781"]
    print(f"USD quote: spotVolume24h {q['spotVolume24h']:.0f}, perpetualVolume24h {q['perpetualVolume24h']}, futuresVolume24h {q['futuresVolume24h']}")
    for needle in ["Hong Kong", "FTR Capital", "spot trading", "launched on"]:
        for sentence in re.split(r"(?<=\.)\s+", d["description"]):
            if needle in sentence:
                print(f"description, {needle!r}: {sentence.strip()[:240]}")
                break

    print("\n== CoinMarketCap market pairs")
    for cat in ["spot", "perpetual", "futures"]:
        status, body = get(f"{CMC}/market-pairs/latest?slug=feather-exchange&category={cat}&start=1&limit=100")
        data = json.loads(body)["data"]
        pairs = [p["marketPair"] for p in data["marketPairs"]]
        print(f"{cat}: {status}, numMarketPairs {data['numMarketPairs']}, {pairs}")

    print("\n== Feather fee page, https://ftrex.io/en/trade/fee")
    status, body = get("https://ftrex.io/en/trade/fee")
    lines = page_text(body)
    start = next((i for i, x in enumerate(lines) if x == "Trading Fees"), 0)
    print(f"status {status}")
    for x in lines[start:start + 30]:
        print(f"  {x}")

    print("\n== fee fields of GET https://ftrex.io/api/market/symbol")
    status, body = get("https://ftrex.io/api/market/symbol")
    rows = json.loads(body)
    print(f"status {status}, {len(rows)} rows")
    for r in rows:
        print(f"  {r['symbol']}: fee {r['fee']}, feeInBaseSymbol {r['feeInBaseSymbol']}, matchingMode {r['matchingMode']}")
    print(f"distinct fee values {sorted({r['fee'] for r in rows})}, no maker or taker field: {not any('maker' in k.lower() or 'taker' in k.lower() for k in rows[0])}")

    print("\n== candidate legal pages")
    for p in ["en/terms", "en/privacy", "en/legal", "en/user-agreement"]:
        status, _ = get(f"https://ftrex.io/{p}")
        print(f"  /{p}: {status}")

    print("\n== CCXT")
    names = sorted(p.name for p in CCXT_SRC.glob("*.js"))
    hits = [n for n in names if re.search(r"feather|ftr", n, re.I)]
    text_hits = [n for n in names if re.search(r"ftrex|feather", (CCXT_SRC / n).read_text(errors="ignore"), re.I)]
    print(f"installed 4.5.68 at {CCXT_SRC.relative_to(ROOT)}: {len(names)} .js files, file name hits {hits}, files mentioning ftrex or feather {text_hits}")
    status, body = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src")
    master = [x["name"] for x in json.loads(body) if x["name"].endswith(".ts")]
    print(f"CCXT master ts/src: {status}, {len(master)} .ts files, hits {[n for n in master if re.search(r'feather|ftr', n, re.I)]}")


main()
