# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only catalog probe for Reku, read from third parties because every Reku host refuses this exit.

Sources: CoinMarketCap's data API, CoinGecko's public API, the CCXT source on GitHub and the installed CCXT 4.5.68,
and CFX, Indonesia's crypto asset exchange, which registers every perpetual an Indonesian venue may list and publishes an index price for each.
Modes, each runnable alone: cmc, coingecko, ccxt, cfx, all (the default).
Run from the repository root: uv run scripts/probes/venues/reku/catalog-probe.py [mode]
Captures go to .claude/survey-work/reku/.
"""

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/reku")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"
CMC_SLUG = "rekeningku-com"  # CoinMarketCap id 723, named Reku
CCXT_LOCAL = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
CFX = "https://www.cfx.co.id/en"
CFX_LISTS = {
    "registered": "/products-and-services/derivatives-crypto-asset",
    "index": "/market-data/index-price",
    "summary": "/market-data/perpetual-derivatives",
}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url: str, timeout: float = 30) -> tuple[int, dict, bytes, float]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), time.perf_counter() - t0


def get_json(url: str) -> tuple[int, dict | list]:
    status, _, body, _ = get(url)
    try:
        return status, json.loads(body)
    except ValueError:
        return status, {"raw": body[:200].decode("utf-8", "replace")}


def cmc_mode() -> dict:
    out = {}
    for ex_type, label in ((1, "spot ranking"), (2, "derivatives ranking")):
        status, d = get_json(f"{CMC}/listing?exType={ex_type}&start=1&limit=400")
        rows = d["data"]["exchanges"]
        hit = [(i + 1, r) for i, r in enumerate(rows) if r["slug"] == CMC_SLUG]
        out[label] = {"rows": len(rows), "position": hit[0][0] if hit else None}
        if hit:
            r = hit[0][1]
            out[label].update({k: r.get(k) for k in ("id", "name", "numMarkets", "spotVol24h", "makerFee", "takerFee", "fiats")})
        print(f"cmc {label} exType={ex_type}: {len(rows)} rows, Reku at {out[label]['position']}")
    status, d = get_json(f"{CMC}/detail?slug={CMC_SLUG}")
    det = d["data"]
    quote = det["quote"].get("2781", {})  # 2781 is USD
    out["detail"] = {
        "name": det["name"],
        "urls": det["urls"],
        "fiats": det["fiats"],
        "makerFee": det["makerFee"],
        "takerFee": det["takerFee"],
        "spotVolume24hUsd": quote.get("spotVolume24h"),
        "perpetualVolume24h": quote.get("perpetualVolume24h"),
        "futuresVolume24h": quote.get("futuresVolume24h"),
    }
    print(f"cmc detail {out['detail']}")
    for category in ("spot", "perpetual", "futures"):
        status, d = get_json(f"{CMC}/market-pairs/latest?slug={CMC_SLUG}&category={category}&start=1&limit=100")
        pairs = (d.get("data") or {}).get("marketPairs") or []
        quotes = sorted({p["quoteSymbol"] for p in pairs})
        out[f"pairs_{category}"] = {"count": len(pairs), "quotes": quotes, "pairs": [p["marketPair"] for p in pairs]}
        print(f"cmc market pairs {category}: {len(pairs)} quotes={quotes}")
        if pairs:
            print("  " + " ".join(p["marketPair"] for p in pairs))
            print(f"  first marketUrl {pairs[0].get('marketUrl')}")
    return out


def coingecko_mode() -> dict:
    status, d = get_json("https://api.coingecko.com/api/v3/exchanges/reku")
    print(f"coingecko /exchanges/reku {status} {json.dumps(d)[:120]}")
    out = {"exchanges_reku": status}
    time.sleep(3)
    status, d = get_json("https://api.coingecko.com/api/v3/exchanges/list")
    if isinstance(d, list):
        hits = [e for e in d if "reku" in (e["id"] + e["name"]).lower() or "rekening" in e["name"].lower()]
        out["list"] = {"status": status, "rows": len(d), "hits": hits}
        print(f"coingecko /exchanges/list {status} rows={len(d)} hits={hits}")
    else:
        out["list"] = {"status": status, "body": d}
        print(f"coingecko /exchanges/list {status} {json.dumps(d)[:160]}")
    time.sleep(3)
    status, d = get_json("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    if isinstance(d, list):
        hits = [e for e in d if "reku" in (e["id"] + e["name"]).lower()]
        out["derivatives"] = {"status": status, "rows": len(d), "hits": hits}
        print(f"coingecko /derivatives/exchanges/list {status} rows={len(d)} hits={hits}")
    else:
        out["derivatives"] = {"status": status, "body": d}
        print(f"coingecko /derivatives/exchanges/list {status} {json.dumps(d)[:160]}")
    return out


def ccxt_mode() -> dict:
    local = sorted(p.name for p in CCXT_LOCAL.glob("*.js") if re.search(r"reku|rekening", p.name, re.I))
    print(f"ccxt 4.5.68 local classes matching reku or rekening: {local}")
    out = {"local": local}
    status, head = get_json("https://api.github.com/repos/ccxt/ccxt/commits/master")
    out["master_sha"] = head.get("sha") if isinstance(head, dict) else None
    print(f"ccxt master commit {out['master_sha']}")
    for path in ("ts/src/reku.ts", "ts/src/rekeningku.ts", "js/src/reku.js"):
        status, _, _, _ = get(f"https://raw.githubusercontent.com/ccxt/ccxt/master/{path}")
        out[path] = status
        print(f"ccxt master {path}: {status}")
    status, _, body, _ = get("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts")
    text = body.decode()
    ids = re.findall(r"^import (\w+) from\s+'\./src/\w+\.js'", text, re.M)
    hits = [i for i in ids if re.search(r"reku|rekening", i, re.I)]
    out["master_ids"] = {"status": status, "count": len(ids), "hits": hits}
    print(f"ccxt master ts/ccxt.ts {status}: {len(ids)} exchange imports, matching reku or rekening: {hits}")
    return out


def page_text(body: bytes) -> str:
    text = re.sub(r"<(script|style).*?</\1>", "", body.decode("utf-8", "replace"), flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)))


def cfx_list(path: str) -> dict:
    contracts: list[str] = []
    rows: list[str] = []
    page = 1
    while page <= 30:
        status, headers, body, _ = get(f"{CFX}{path}?page={page}")
        if status != 200:
            print(f"  page {page}: {status}")
            break
        text = page_text(body)
        found = re.findall(r"\b([A-Z0-9]+USDT-PERP)\b", text)
        new = [c for c in dict.fromkeys(found) if c not in contracts]
        if not new:
            break
        contracts += new
        for c in new:
            m = re.search(re.escape(c) + r" (.{0,120}?)(?= \d* ?[A-Z0-9]+USDT-PERP | Previous)", text)
            rows.append(f"{c} {m.group(1) if m else ''}".strip())
        if page == 1:
            print(f"  page 1 age header {headers.get('age') or headers.get('Age')}")
        page += 1
        time.sleep(1)
    return {"contracts": contracts, "rows": rows, "pages": page - 1}


def cfx_mode() -> dict:
    out = {}
    for name, path in CFX_LISTS.items():
        print(f"cfx {name} {CFX}{path}")
        res = cfx_list(path)
        out[name] = res
        print(f"  {len(res['contracts'])} contracts over {res['pages']} pages")
        for r in res["rows"][:3] + (["..."] + res["rows"][-2:] if len(res["rows"]) > 3 else []):
            print(f"  {r}")
    reg, idx = set(out["registered"]["contracts"]), set(out["index"]["contracts"])
    print(f"cfx registered without an index row: {sorted(reg - idx)}")
    print(f"cfx index rows not registered: {sorted(idx - reg)}")
    stamps = sorted({m for r in out["index"]["rows"] for m in re.findall(r"\d{1,2} \w{3} \d{4} \d{2}:\d{2}", r)})
    print(f"cfx index Last Update values: {stamps}")
    out["index_stamps"] = stamps
    status, _, body, _ = get(f"{CFX}/exchanges-and-participants/members?page=2")
    text = body.decode("utf-8", "replace").replace('\\"', '"')
    m = re.search(r'"brand":"Reku".*?"name":"([^"]+)","marketCategory":\{"name":"(\w+)".*?"spabDate":"([^"]+)","spabNumber":"([^"]+)"', text)
    out["member"] = m.groups() if m else None
    print(f"cfx member row for Reku: {out['member']}")
    return out


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    WORK.mkdir(parents=True, exist_ok=True)
    modes = {"cmc": cmc_mode, "coingecko": coingecko_mode, "ccxt": ccxt_mode, "cfx": cfx_mode}
    out = {"probed_at": now()}
    for name, fn in modes.items():
        if mode in (name, "all"):
            print(f"== {name} {now()}")
            out[name] = fn()
    (WORK / f"catalog-{mode}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
