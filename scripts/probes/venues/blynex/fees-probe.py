# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Blynex fee probe for docs/profiles/blynex/fees.md.

Public, unauthenticated and read-only, about fifteen requests in total.
Sections, in order:
  page     the spot fee table on https://blynex.com/trade-fees/, parsed into maker and taker per asset.
  api      makerFee and takerFee per asset from /v1/assets and per pair from /v1/market, compared with the page.
  futures  the fee sentences of the futures user guide and the openFee and closeFee fields of the futures pair list.
  cmc      CoinMarketCap's exchange record for Blynex.
  ccxt     whether CCXT 4.5.68 in node_modules or CCXT master on GitHub has a Blynex class.
Run from the repository root with: uv run scripts/probes/venues/blynex/fees-probe.py
Captures land in .claude/survey-work/blynex/.
"""

import html
import json
import pathlib
import re
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "blynex"
WORK.mkdir(parents=True, exist_ok=True)
CCXT_SRC = ROOT / "node_modules" / ".pnpm" / "ccxt@4.5.68" / "node_modules" / "ccxt" / "js" / "src"
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
OUT = {}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def text_of(body):
    t = body.decode(errors="replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
    t = re.sub(r"<[^>]+>", "|", t)
    t = html.unescape(re.sub(r"\s+", " ", t))
    return re.sub(r"(\| ?)+", "|", t)


def page():
    st, body = get("https://blynex.com/trade-fees/")
    (WORK / "trade-fees.html").write_bytes(body)
    t = text_of(body)
    rows = re.findall(r"\|([A-Z0-9]+)\|(\d+ USDT)\|([\d.]+)%\|([\d.]+)%", t)
    fees = {a: (float(m), float(k)) for a, _, m, k in rows}
    dist = {}
    for m, k in fees.values():
        dist[f"{m}/{k}"] = dist.get(f"{m}/{k}", 0) + 1
    tabs = [s for s in ["Spot Trading Fees", "Stock Market Fees", "Deposit & Withdrawal Fees"] if s in t]
    OUT["page"] = {"status": st, "rows": len(rows), "min_trade_sizes": sorted({r[1] for r in rows}), "maker_taker_pct": dist,
                   "btc": fees.get("BTC"), "eth": fees.get("ETH"), "usdt": fees.get("USDT"), "tabs": tabs,
                   "vip_or_tier_words": [w for w in ["VIP", "Tier", "tier", "30-day", "volume"] if w in t],
                   "not_0_25": {a: v for a, v in fees.items() if v != (0.25, 0.25)}}
    print("page", json.dumps(OUT["page"], indent=1))
    return fees


def api(page_fees):
    st, body = get("https://api.blynex.com/v1/assets")
    assets = json.loads(body)
    st, body = get("https://api.blynex.com/v1/market")
    market = json.loads(body)
    asset_vs_page = {"same": 0, "differ": {}, "asset_not_on_page": [], "page_not_in_assets": []}
    for a, row in assets.items():
        if a not in page_fees:
            asset_vs_page["asset_not_on_page"].append(a)
        elif (row["makerFee"], row["takerFee"]) == page_fees[a]:
            asset_vs_page["same"] += 1
        else:
            asset_vs_page["differ"][a] = {"api": [row["makerFee"], row["takerFee"]], "page": list(page_fees[a])}
    asset_vs_page["page_not_in_assets"] = [a for a in page_fees if a not in assets]
    rules = {"taker_eq_base_asset_taker": 0, "taker_eq_quote_asset_taker": 0, "taker_eq_max_base_quote": 0, "maker_eq_base_asset_maker": 0,
             "maker_eq_quote_asset_maker": 0, "neither": []}
    for m in market:
        b, q = assets.get(m["base"], {}), assets.get(m["quote"], {})
        bt, qt = b.get("takerFee"), q.get("takerFee")
        if m["takerFee"] == bt:
            rules["taker_eq_base_asset_taker"] += 1
        if m["takerFee"] == qt:
            rules["taker_eq_quote_asset_taker"] += 1
        if bt is not None and qt is not None and m["takerFee"] == max(bt, qt):
            rules["taker_eq_max_base_quote"] += 1
        if m["makerFee"] == b.get("makerFee"):
            rules["maker_eq_base_asset_maker"] += 1
        if m["makerFee"] == q.get("makerFee"):
            rules["maker_eq_quote_asset_maker"] += 1
        if m["takerFee"] not in (bt, qt):
            rules["neither"].append([m["id"], m["makerFee"], m["takerFee"], bt, qt])
    taker_dist = {}
    for m in market:
        taker_dist[str(m["takerFee"])] = taker_dist.get(str(m["takerFee"]), 0) + 1
    by_quote = {}
    for m in market:
        by_quote.setdefault(m["quote"], {}).setdefault(f'{m["makerFee"]}/{m["takerFee"]}', 0)
        by_quote[m["quote"]][f'{m["makerFee"]}/{m["takerFee"]}'] += 1
    btc = next(m for m in market if m["id"] == "BTC_USDT")
    OUT["api"] = {"assets": len(assets), "pairs": len(market), "asset_vs_page": asset_vs_page, "pair_rules": rules,
                  "pair_taker_dist_pct": taker_dist, "pair_fees_by_quote": by_quote,
                  "btc_usdt": [btc["makerFee"], btc["takerFee"]], "usdt_asset": [assets["USDT"]["makerFee"], assets["USDT"]["takerFee"]]}
    print("api", json.dumps(OUT["api"], indent=1))


def futures():
    st, body = get("https://blynex.com/blynex-hybrid-forex-crypto-future/")
    t = text_of(body)
    keep = []
    for pat in [r"Blynex does not charge[^|]*", r"hybrid perpetual futures[^|]*", r"Up to 100x leverage", r"Initial Margin = [^|]*",
                r"No funding or overnight fees apply\.?", r"Not a fee or commission[^|]*", r"Version [\d.]+[^|]*", r"Minimum position size[^|]*"]:
        m = re.search(pat, t)
        keep.append(m.group(0).strip() if m else "missing: " + pat)
    st2, body2 = get("https://futures.blynex.com/api/pairs/list")
    pairs = json.loads(body2)
    fee_rows = [{k: p.get(k) for k in ("pair", "openFee", "closeFee", "spread", "initialMarginMultiplier")} for p in pairs if "openFee" in p or "closeFee" in p]
    OUT["futures"] = {"guide_status": st, "guide_sentences": keep, "pairs": len(pairs), "pairs_with_fee_fields": fee_rows}
    print("futures", json.dumps(OUT["futures"], indent=1))


def cmc():
    st, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=blynex")
    d = json.loads(body)["data"]
    OUT["cmc"] = {"http_status": st, **{k: d.get(k) for k in ("id", "name", "slug", "makerFee", "takerFee", "countries", "dateLaunched", "status")},
                  "fee_url": d.get("urls", {}).get("fee"), "tags": [t["name"] for t in d.get("tags") or []]}
    st, body = get("https://api.coingecko.com/api/v3/exchanges/blynex")
    OUT["coingecko"] = {"status": st, "body": body[:80].decode(errors="replace")}
    print("cmc", json.dumps(OUT["cmc"], indent=1), json.dumps(OUT["coingecko"]))


def ccxt():
    local_file = (CCXT_SRC / "blynex.js").exists()
    local_hits = [p.name for p in CCXT_SRC.glob("*.js") if "blynex" in p.read_text(errors="replace").lower()]
    st, body = get("https://api.github.com/repos/ccxt/ccxt/commits/master")
    head = json.loads(body)
    sha = head["sha"]
    st_ts, _ = get(f"https://raw.githubusercontent.com/ccxt/ccxt/{sha}/ts/src/blynex.ts")
    st_ex, ex = get(f"https://raw.githubusercontent.com/ccxt/ccxt/{sha}/exchanges.json")
    OUT["ccxt"] = {"local_dir_exists": CCXT_SRC.exists(), "local_blynex_js": local_file, "local_files_mentioning_blynex": local_hits,
                   "github_master": sha[:7], "github_master_date": head["commit"]["committer"]["date"],
                   "ts_src_blynex_status": st_ts, "exchanges_json_status": st_ex, "exchanges_json_mentions_blynex": "blynex" in ex.decode().lower()}
    print("ccxt", json.dumps(OUT["ccxt"], indent=1))


if __name__ == "__main__":
    fees = page()
    api(fees)
    futures()
    cmc()
    ccxt()
    (WORK / "fees-probe.json").write_text(json.dumps(OUT, indent=1))
    print("wrote", WORK / "fees-probe.json")
