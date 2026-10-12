# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Gems Trade fees probe for docs/profiles/gems-trade/fees.md.

Public, unauthenticated and read-only, about seven requests.
  1. The fee group table at /api/v2/peatio/public/trading_fees, in ppm.
  2. The account level gates at /api/v2/peatio/public/member-levels.
  3. The fee schedule hard-coded in the web app's /tradingfees page chunk.
  4. CoinMarketCap's exchange detail and its spot, perpetual and futures pair counts for slug gems-trade.
  5. The operator and the local restriction clauses in the web app's /term-condition page chunk.
Run from the repository root with: uv run scripts/probes/venues/gems-trade/fees-probe.py
"""

import json
import re
import urllib.error
import urllib.request

# The CloudFront WAF in front of www.gems.trade answers 403 to a bare "Mozilla/5.0" or a Python user agent, see rest-probe.py section 1.
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
SITE = "https://www.gems.trade"
PEATIO = SITE + "/api/v2/peatio"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def ppm(x):
    return round(float(x) * 1e6)


def fee_groups():
    print("== 1. Fee groups, /public/trading_fees")
    st, body = get(PEATIO + "/public/trading_fees")
    rows = json.loads(body)
    print(f"status {st}, rows {len(rows)}")
    for r in sorted(rows, key=lambda r: r["id"]):
        print(f"  id {r['id']:>2}  group {r['group']!r:40} market {r['market_id']:4} maker {ppm(r['maker']):>5} ppm  taker {ppm(r['taker']):>5} ppm  updated {r['updated_at']}")
    st2, body2 = get(PEATIO + "/public/trading_fees?market_id=btcusdt")
    print(f"  with market_id=btcusdt: status {st2}, same reply {body2 == body}")


def member_levels():
    print("== 2. Account level gates, /public/member-levels")
    st, body = get(PEATIO + "/public/member-levels")
    print(f"status {st}, body {body.decode()}")


CHUNKS = []


def find_chunk(preferred, marker):
    """Returns (path, status, source) of the first lazy chunk holding marker, trying the 2026-10-09 chunk id first."""
    if not CHUNKS:
        st, html = get(SITE + "/")
        main = re.search(rb'src="(/static/js/main\.[0-9a-f]+\.js)"', html).group(1).decode()
        st, js = get(SITE + main)
        print(f"main bundle {main}, status {st}, {len(js)} bytes")
        chunk_map = re.search(rb'"static/js/"\+e\+"\."\+\{([^}]*)\}', js).group(1).decode()
        CHUNKS.extend(re.findall(r'(\d+):"([0-9a-f]+)"', chunk_map))
        print(f"lazy chunks listed: {len(CHUNKS)}")
    for cid, h in sorted(CHUNKS, key=lambda c: c[0] != preferred):
        path = f"/static/js/{cid}.{h}.chunk.js"
        st, src = get(SITE + path)
        if marker in src:
            return path, st, src
    return None, None, None


def fee_page():
    print("== 3. Fee schedule in the /tradingfees page chunk")
    path, st, src = find_chunk("9357", b"regularTakerFee")
    if path:
        text = src.decode("utf-8", "replace")
        print(f"page chunk {path}, status {st}")
        title = re.search(r'"h1",\{children:"([^"]+)"', text)
        print(f"  heading: {title.group(1) if title else None}")
        cols = re.findall(r'title:"([^"]+)",dataIndex', text)
        print(f"  columns: {cols}")
        groups = re.findall(r'title:"(Regular User|Premium User)"', text)
        print(f"  column groups: {groups}")
        for row in re.findall(r'\{key:"\d+",level:"[^}]*\}', text):
            print("  " + row)
        note = re.search(r'"feesSubject".*?children:"([^"]+)"', text)
        print(f"  note: {note.group(1) if note else None}")
    else:
        print("no chunk holds the fee table")


def terms():
    print("== 5. Operator and local restrictions in the /term-condition page chunk")
    path, st, src = find_chunk("1815", b"These Terms and Conditions")
    if not path:
        print("no chunk holds the terms")
        return
    text = re.sub(r"\(0,[a-z]\.jsxs?\)\(\"[a-z0-9]+\",\{(className:\"[^\"]*\",)?children:", "", src.decode("utf-8", "replace"))
    print(f"terms chunk {path}, status {st}")
    print(f"  mentions of Poland or Polish: {text.count('Poland') + text.count('Polish')}, of Comoros: {text.count('Comoros')}")
    for key, n in (("These Terms and Conditions", 420), ("4. Local Restrictions", 900), ("5. Eligibility", 330)):
        i = text.find(key)
        print(f"  {text[i:i + n]!r}")


def cmc():
    print("== 4. CoinMarketCap")
    st, body = get(CMC + "/detail?slug=gems-trade")
    d = json.loads(body)["data"]
    print(f"detail status {st}: id {d['id']}, name {d['name']}, launched {d['dateLaunched']}, makerFee {d['makerFee']}, takerFee {d['takerFee']}")
    print(f"  urls {d['urls']}")
    q = d["quote"]["2781"]
    print(f"  USD spotVolume24h {q['spotVolume24h']:.0f}, perpetualVolume24h {q['perpetualVolume24h']}, futuresVolume24h {q['futuresVolume24h']}, updated {q['updateTime']}")
    desc = d["description"]
    for key in ("registered in", "Restricted Countries", "Fees"):
        i = desc.find(key)
        print(f"  description at {key!r}: {desc[i:i + 260]!r}" if i >= 0 else f"  description lacks {key!r}")
    for cat in ("spot", "perpetual", "futures"):
        st, body = get(f"{CMC}/market-pairs/latest?slug=gems-trade&category={cat}&start=1&limit=100")
        p = json.loads(body)["data"]
        pairs = p.get("marketPairs", [])
        excluded = sum(1 for x in pairs if x.get("priceExcluded") == 1 and x.get("volumeExcluded") == 1)
        print(f"  {cat}: status {st}, numMarketPairs {p.get('numMarketPairs')}, both price and volume excluded on {excluded} of {len(pairs)}")


if __name__ == "__main__":
    fee_groups()
    member_levels()
    fee_page()
    cmc()
    terms()
