# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CriptoSwaps fee probe for docs/profiles/criptoswaps/.

Reads Peatio's public trading fee table, the fee fields on resting orders, the fee table hard-coded in the web bundle, CoinMarketCap's fee fields, and whether CCXT has a class.
Read-only and unauthenticated, about 15 requests, one of them the 21 MB web bundle.
Run from the repository root with: uv run scripts/probes/venues/criptoswaps/fees-probe.py
"""

import collections
import json
import pathlib
import re
import urllib.error
import urllib.request

SITE = "https://www.criptoswaps.com"
PUB = SITE + "/api/v2/peatio/public"
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"}
CCXT_SRC = pathlib.Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def section(title: str) -> None:
    print(f"\n=== {title}")


def pct(x: str) -> str:
    return f"{float(x) * 100:.4f} % = {round(float(x) * 1e6)} ppm"


def trading_fees() -> None:
    section("1. GET /api/v2/peatio/public/trading_fees")
    st, body = fetch(PUB + "/trading_fees")
    rows = json.loads(body)
    print("status", st, "rows", len(rows))
    for r in sorted(rows, key=lambda r: r["id"]):
        print(f"id {r['id']} group {r['group']} market {r['market_id']} type {r['market_type']} maker {r['maker']} ({pct(r['maker'])}) taker {r['taker']} ({pct(r['taker'])}) updated {r['updated_at']}")
    st, body = fetch(PUB + "/member-levels")
    print("GET /member-levels", st, body)


def resting_order_fees() -> None:
    section("2. fee fields on resting orders, GET /markets/<id>/order-book?asks_limit=200&bids_limit=200")
    for m in ("btcusdt", "ethusdt", "zecbtc"):
        st, body = fetch(f"{PUB}/markets/{m}/order-book?asks_limit=200&bids_limit=200")
        ob = json.loads(body)
        orders = ob["asks"] + ob["bids"]
        fees = collections.Counter((o["maker_fee"], o["taker_fee"]) for o in orders)
        types = collections.Counter(o["ord_type"] for o in orders)
        print(m, st, "orders", len(orders), "(maker_fee, taker_fee) counts", dict(fees), "ord_type", dict(types))


def bundle_fee_table() -> None:
    section("3. fee table hard-coded in the web bundle")
    st, home = fetch(SITE + "/fee-detail")
    src = re.search(r'src="(/public/assets/bundle\.[0-9a-f]+\.js)"', home)
    print("GET /fee-detail", st, len(home), "bytes, a client-side route, bundle", src.group(1) if src else None)
    if not src:
        return
    st, js = fetch(SITE + src.group(1))
    print("bundle", st, len(js), "bytes")
    head = js[: js.find("_0x3eb8=function")]
    end = head.rfind("];(function")
    arr = re.findall(r"'((?:[^'\\]|\\.)*)'", head[head.find("[") + 1 : end])
    rot = int(re.search(r"\(_0x396f,(0x[0-9a-f]+)\)", js[end : end + 400]).group(1), 16)  # while(--n) after ++n shifts exactly n times
    arr = arr[rot:] + arr[:rot]
    lookup = lambda h: bytes(arr[int(h, 16)], "utf-8").decode("unicode_escape") if "\\x" in arr[int(h, 16)] else arr[int(h, 16)]
    start = js.find("['FeeBuyOrSellTable']=void 0x0")
    body = js[start : start + 4000]
    body = body[: body.find("'Nru8'")]
    cells = re.findall(r"\('(th|td)',(?:null|\{[^}]*\}),(?:_0x3eb8\('(0x[0-9a-f]+)'\)|'([^']*)')\)", body)
    row: list[str] = []
    for tag, ref, lit in cells:
        text = lookup(ref) if ref else lit
        if tag == "th" and row and (text.isdigit() or text == "ID"):
            print(" | ".join(row))
            row = []
        row.append(text)
    print(" | ".join(row))
    for key in ("page.body.profile.header.statusfee1", "page.body.profile.header.statusfee2"):
        m = re.search(re.escape(f"'{key}':'") + r"((?:[^'\\]|\\.)*)'", js)
        print(key, bytes(m.group(1), "utf-8").decode("unicode_escape") if m else None)


def cmc() -> None:
    section("4. CoinMarketCap exchange detail")
    st, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=criptoswaps")
    d = json.loads(body)["data"]
    print("status", st, "makerFee", d["makerFee"], "takerFee", d["takerFee"], "fee url", d["urls"]["fee"], "status field", d["status"], "launched", d["dateLaunched"])
    spot = d["quote"]["2781"]
    print("USD quote spotVolume24h", round(spot["spotVolume24h"]), "perpetualVolume24h", spot["perpetualVolume24h"], "futuresVolume24h", spot["futuresVolume24h"])
    for phrase in ("does not offer derivatives", "Ankara", "not licensed"):
        i = d["description"].find(phrase)
        print(repr(phrase), "found" if i >= 0 else "absent", d["description"][max(0, i - 80) : i + 120].replace("\r\n", " ") if i >= 0 else "")


def ccxt() -> None:
    section("5. CCXT")
    names = sorted(p.name for p in CCXT_SRC.glob("*.js")) if CCXT_SRC.exists() else []
    print("4.5.68 classes", len(names), "matching cripto, swaps, peatio or openware", [n for n in names if re.search("cripto|swaps|peatio|openware", n)])
    st, body = fetch("https://api.github.com/repos/ccxt/ccxt/commits/master")
    sha = json.loads(body).get("sha") if st == 200 else None
    print("GitHub ccxt master", st, sha)
    st, body = fetch("https://api.github.com/repos/ccxt/ccxt/contents/ts/src")
    if st == 200:
        files = [f["name"] for f in json.loads(body)]
        print("ts/src entries", len(files), "matching", [f for f in files if re.search("cripto|swaps|peatio|openware", f)])
    else:
        print("ts/src listing", st, body[:120])


def main() -> None:
    trading_fees()
    resting_order_fees()
    bundle_fee_table()
    cmc()
    ccxt()


if __name__ == "__main__":
    main()
