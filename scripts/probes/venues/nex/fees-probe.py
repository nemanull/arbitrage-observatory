# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""NEX Exchange fee and listing probe for docs/profiles/nex/fees.md.

Public, unauthenticated and read-only, standard library only.
About 15 requests, at most one per second, in these sections:
  vip       the futures VIP table the web app's VIP page reads, /futures/web/api/v1/setting/vip/configs.
  markets   the per market maker_fee and taker_fee fields of the futures market list.
  spotfee   whether any spot fee field exists in the spot ticker list.
  cmc       CoinMarketCap's exchange record, its spot and derivatives listings, and the market pair count.
  coingecko CoinGecko's exchange and derivatives exchange lists, searched for NEX, All InX and allinpro.
  ccxt      the installed CCXT 4.5.68 source folder and the current ccxt/ccxt master ts/src listing on GitHub.
  site      the restricted regions text in the web bundle.
Run from the repository root with: uv run scripts/probes/venues/nex/fees-probe.py
Captures land in .claude/survey-work/nex/.
"""

import json
import pathlib
import re
import time
import urllib.error
import urllib.request

API = "https://api.allinpro.com"
FUT = API + "/futures"
ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "nex"
WORK.mkdir(parents=True, exist_ok=True)
CCXT_DIR = ROOT / "node_modules" / ".pnpm" / "ccxt@4.5.68" / "node_modules" / "ccxt" / "js" / "src"
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
PREFIXES = ("nex", "n-exchange", "allin", "all-in", "all in")


def is_hit(*names):
    """A name that starts with a NEX or All InX spelling, so Bitfinex and CoinEx do not match on their nex suffix."""
    return any(n.lower().replace(".ts", "").replace(".js", "").startswith(PREFIXES) for n in names)
OUT = {}


def get(url, as_json=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Origin": "https://n-exchange.io"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        body = e.read()
        status = e.code
    time.sleep(1)
    if not as_json:
        return status, body.decode("utf-8", "replace")
    try:
        return status, json.loads(body)
    except ValueError:
        return status, body[:300].decode("utf-8", "replace")


def ppm(rate):
    return round(float(rate) * 1_000_000)


def vip():
    status, d = get(FUT + "/web/api/v1/setting/vip/configs")
    rows = d["data"]
    return {"status": status, "rows": rows,
            "ppm": [{"name": r["name"], "maker_ppm": ppm(r["maker_fee_rate"]), "taker_ppm": ppm(r["taker_fee_rate"]), "trade_amount": r["trade_amount"]} for r in rows]}


def markets():
    status, d = get(FUT + "/web/api/v1/market/list")
    return {"status": status, "rows": [{"name": m["name"], "maker_fee": m["maker_fee"], "taker_fee": m["taker_fee"],
                                        "maker_ppm": ppm(m["maker_fee"]), "taker_ppm": ppm(m["taker_fee"]), "fee_prec": m.get("fee_prec")} for m in d["data"]]}


def spotfee():
    status, d = get(API + "/api/spot/tickers")
    keys = sorted({k for t in d["data"]["tickers"] for k in t})
    return {"status": status, "fee_like_fields": [k for k in keys if "fee" in k.lower() or "rate" in k.lower()], "ticker_count": len(d["data"]["tickers"])}


def cmc():
    res = {}
    status, d = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=nexchange")
    x = d["data"]
    q = x["quote"]["2781"]
    res["detail"] = {"status": status, "id": x["id"], "name": x["name"], "slug": x["slug"], "website": x["urls"]["website"],
                     "fee_url": x["urls"]["fee"], "countries": x.get("countries"), "dateLaunched": x.get("dateLaunched"),
                     "makerFee": x.get("makerFee"), "takerFee": x.get("takerFee"), "spotVolume24h_usd": round(q["spotVolume24h"]),
                     "perpetualVolume24h_usd": q["perpetualVolume24h"], "futuresVolume24h_usd": q["futuresVolume24h"]}
    for ex_type, label in ((1, "spot"), (2, "derivatives")):
        status, d = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType={ex_type}&start=1&limit=400&sortBy=score&sortType=desc")
        ex = d["data"]["exchanges"]
        res[f"listing_{label}"] = {"status": status, "count": len(ex), "nex_present": any(e["slug"] == "nexchange" for e in ex)}
    status, d = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=nexchange&category=spot&start=1&limit=100")
    res["pairs_spot"] = {"status": status, "numMarketPairs": d["data"].get("numMarketPairs")}
    status, d = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=nexchange&category=perpetual&start=1&limit=100")
    res["pairs_perpetual"] = {"status": status, "numMarketPairs": d["data"].get("numMarketPairs") if isinstance(d, dict) and d.get("data") else d}
    return res


def coingecko():
    res = {}
    status, d = get("https://api.coingecko.com/api/v3/exchanges/list")
    hits = [e for e in d if is_hit(e["id"], e["name"])] if isinstance(d, list) else d
    res["exchanges_list"] = {"status": status, "count": len(d) if isinstance(d, list) else None, "hits": hits}
    status, d = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    hits = [e for e in d if is_hit(e["id"], e["name"])] if isinstance(d, list) else d
    res["derivatives_list"] = {"status": status, "count": len(d) if isinstance(d, list) else None, "hits": hits}
    return res


def ccxt():
    local = sorted(p.name for p in CCXT_DIR.glob("*.js"))
    status, d = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master")
    names = [x["name"] for x in d if x["name"].endswith(".ts")] if isinstance(d, list) else []
    _, c = get("https://api.github.com/repos/ccxt/ccxt/commits/master")
    def hits(lst):
        return [n for n in lst if is_hit(n)]
    return {"local_js_count": len(local), "local_hits": hits(local), "github_status": status, "github_ts_count": len(names),
            "github_hits": hits(names), "github_master_sha": c.get("sha") if isinstance(c, dict) else None,
            "github_master_date": c["commit"]["committer"]["date"] if isinstance(c, dict) and "commit" in c else None}


def site():
    status, html = get("https://n-exchange.io/", as_json=False)
    m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
    if not m:
        return {"status": status, "bundle": None}
    status2, js = get("https://n-exchange.io" + m.group(1), as_json=False)
    i = js.find("NEX does not serve users in certain jurisdictions")
    j = js.find("'", i)
    return {"status": status, "bundle": m.group(1), "bundle_status": status2, "bundle_bytes": len(js),
            "restricted_regions": js[i:j] if i >= 0 else None,
            "futures_ws": sorted(set(re.findall(r'wss://[a-z.]+allinpro\.com/[a-z/]+', js)))}


def main():
    OUT["started_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for name, fn in (("vip", vip), ("markets", markets), ("spotfee", spotfee), ("cmc", cmc), ("coingecko", coingecko), ("ccxt", ccxt), ("site", site)):
        try:
            OUT[name] = fn()
        except Exception as e:  # keep going so one failure does not hide the rest
            OUT[name] = {"error": repr(e)}
    (WORK / "fees-probe.json").write_text(json.dumps(OUT, indent=2))
    print(json.dumps(OUT, indent=2))


main()
