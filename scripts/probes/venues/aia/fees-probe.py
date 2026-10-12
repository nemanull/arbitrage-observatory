# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""AIA Exchange fees probe for docs/profiles/aia/fees.md.

Public, unauthenticated and read-only, seven requests.
  1. The fee and funding fields of every online perpetual in /v1/cfd/public/instruments.
  2. The fee fields of every spot pair in /v1/cfd/public/spot_instruments.
  3. CoinMarketCap's exchange detail and its spot, perpetual and futures market pairs for slug aia-exchange.
Run from the repository root with: uv run scripts/probes/venues/aia/fees-probe.py
"""

import collections
import json
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json"}
SITE = "https://aianalysisexchange.com"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200]


def ppm(x):
    return round(x * 1e6)


def perp():
    print("== 1. Perpetual fee fields")
    st, env = get_json(SITE + "/v1/cfd/public/instruments")
    on = [x for x in env["data"] if x["status"] == "online"]
    print(f"status {st}, online rows {len(on)} of {len(env['data'])}")
    groups = collections.defaultdict(list)
    for x in on:
        key = (ppm(x["takerFee"]), ppm(x["makerFee"]), ppm(x["commissionRate"]), ppm(x["openSpread"]), ppm(x["closeSpread"]),
               ppm(x["settlementRate"]), x["fundingIntervalHours"])
        groups[key].append(x["symbol"])
    print("taker ppm, maker ppm, commissionRate ppm, openSpread ppm, closeSpread ppm, settlementRate ppm, funding hours: symbols")
    for k, v in sorted(groups.items()):
        print(f"  {k}: {len(v)} {v}")


def spot():
    print("== 2. Spot fee fields")
    st, env = get_json(SITE + "/v1/cfd/public/spot_instruments")
    groups = collections.defaultdict(list)
    for x in env["data"]:
        groups[(ppm(x["takerFee"]), ppm(x["makerFee"]))].append(x["symbol"])
    print(f"status {st}, rows {len(env['data'])}")
    for k, v in sorted(groups.items()):
        print(f"  taker, maker ppm {k}: {len(v)} {v}")


def cmc():
    print("== 3. CoinMarketCap")
    st, d = get_json(f"{CMC}/detail?slug=aia-exchange")
    if st == 200:
        dd = d["data"]
        print(f"detail {st}: id {dd.get('id')} name {dd.get('name')} launched {dd.get('dateLaunched')} countries {dd.get('countries')}")
        print(f"  makerFee {dd.get('makerFee')} takerFee {dd.get('takerFee')} urls {json.dumps(dd.get('urls'))}")
        desc = dd.get("description") or ""
        i = desc.find("### Fee Structure")
        print("  fee text:", desc[i:i + 260].replace("\n", " ") if i >= 0 else None)
    else:
        print("detail", st, d)
    for cat in ("spot", "perpetual", "futures"):
        st, d = get_json(f"{CMC}/market-pairs/latest?slug=aia-exchange&category={cat}&start=1&limit=100")
        if st != 200:
            print(cat, st, d)
            continue
        mp = d["data"].get("marketPairs", [])
        excl = collections.Counter((m.get("priceExcluded"), m.get("volumeExcluded")) for m in mp)
        print(f"{cat}: {st} numMarketPairs {d['data'].get('numMarketPairs')} rows {len(mp)} (priceExcluded, volumeExcluded) {dict(excl)}")
        if mp:
            print("  pairs:", [m["marketPair"] for m in mp])
            print("  first marketUrl:", mp[0].get("marketUrl"), "feeType:", mp[0].get("feeType"))


if __name__ == "__main__":
    perp()
    spot()
    cmc()
