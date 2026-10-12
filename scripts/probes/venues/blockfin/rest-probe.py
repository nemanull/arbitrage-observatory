# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for BlockFin (blockfin.com).

Public, unauthenticated, read-only, about eighty requests for mode all, at two a second or slower.

Modes, each printing one line per finding:
    access   DNS for the BlockFin hosts, the exit and Cloudflare's trace, then one GET to each web page and each candidate API path.
             The paths are BloFin's public v1 paths, because a third party says BlockFin shares BloFin's API structure.
             Prints status, bytes, Cloudflare ray and the refusal sentence when the body is the restricted region page.
    cmc      CoinMarketCap's exchange detail and market pair lists for BlockFin: fees, counts, and the index, basis and funding fields.
             Then it compares each BlockFin perpetual's funding rate and index on CoinMarketCap with BloFin's.
    repeat   five API paths 6 to 15 times each, one request a second, to measure how often the refusal lets a request through.
             Any reply that is not the restricted region page is saved and summarised.
    ccxt     whether CCXT 4.5.68 here, or CCXT master on GitHub, has a BlockFin class.
    all      every mode above.

Run from the repository root:
    uv run scripts/probes/venues/blockfin/rest-probe.py [access|cmc|repeat|ccxt|all]

Captures go to .claude/survey-work/blockfin/.
Recorded in docs/profiles/blockfin/rest.md, websocket.md and fees.md.
"""

import collections
import json
import math
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/blockfin")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
HOSTS = ["blockfin.com", "www.blockfin.com", "openapi.blockfin.com", "api.blockfin.com", "docs.blockfin.com", "ws.blockfin.com"]
PAGES = [
    "https://blockfin.com/",
    "https://blockfin.com/en/docs",
    "https://blockfin.com/en/fees",
    "https://blockfin.com/en/vip",
    "https://blockfin.com/futures/BTC-USDT",
    "https://docs.blockfin.com/",
]
API_PATHS = [
    "/api/v1/market/instruments?instType=SWAP",
    "/api/v1/market/tickers",
    "/api/v1/market/mark-price",
    "/api/v1/market/funding-rate?instId=BTC-USDT",
    "/api/v1/market/books?instId=BTC-USDT&size=5",
    "/api/v1/no-such-path",
]
API_HOSTS = ["https://openapi.blockfin.com", "https://blockfin.com"]
CMC_DETAIL = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=blockfin"
CMC_BLOFIN = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=blofin&category=perpetual&start=1&limit=1000"
CMC_PAIRS = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=blockfin&category={cat}&start=1&limit=1000"
CCXT_DIR = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
GH_SRC = "https://api.github.com/repos/ccxt/ccxt/contents/ts/src"
GH_HEAD = "https://api.github.com/repos/ccxt/ccxt/commits/master"
REFUSAL = re.compile(r"We noticed that your IP address is from one of (\w+)'s restricted\s+countries or regions")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def fetch(url: str, accept: str = "*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    start = time.monotonic()
    try:
        with OPENER.open(req, timeout=30) as reply:
            body, status, headers = reply.read(), reply.status, reply.headers
    except urllib.error.HTTPError as err:
        body, status, headers = err.read(), err.code, err.headers
    return status, headers, body, (time.monotonic() - start) * 1000


def get_json(url: str):
    status, _, body, _ = fetch(url, "application/json")
    if status != 200:
        raise RuntimeError(f"{url} answered {status}")
    return json.loads(body)


def summarise(url: str, body: bytes) -> None:
    try:
        reply = json.loads(body)
    except ValueError:
        return
    rows = reply.get("data") if isinstance(reply, dict) else None
    if not isinstance(rows, list):
        return
    ids = [r.get("instId", "") for r in rows if isinstance(r, dict)]
    times = collections.Counter(r.get("fundingTime") for r in rows if isinstance(r, dict) and "fundingTime" in r)
    if times:
        common = times.most_common(1)[0][0]
        print(json.dumps({"summary_of": url, "fundingTime_utc": {datetime.fromtimestamp(int(t) / 1000, timezone.utc).isoformat(): n for t, n in times.items()},
                          "off_common_time": [r["instId"] for r in rows if r.get("fundingTime") != common]}))
    for field in ("instType", "contractType", "state", "settleCurrency", "contractValue", "listTime"):
        values = collections.Counter(str(r.get(field)) for r in rows if isinstance(r, dict) and field in r)
        if values:
            print(json.dumps({"summary_of": url, "field": field, "values": dict(values.most_common(8))}))
    shapes = collections.Counter(i.split("-")[-1] if "-" in i else "other" for i in ids)
    print(json.dumps({"summary_of": url, "code": reply.get("code"), "rows": len(rows), "quote_suffixes": shapes, "fields": sorted(rows[0]) if rows else []}))
    btc = next((r for r in rows if r.get("instId") == "BTC-USDT"), None)
    if btc:
        print(json.dumps({"BTC-USDT": btc}))


def describe(url: str) -> bool:
    status, headers, body, ms = fetch(url)
    text = body.decode("utf-8", "replace")
    refusal = REFUSAL.search(text)
    if not refusal:
        name = re.sub(r"[^A-Za-z0-9]+", "_", url.split("//", 1)[1])[:80]
        (WORK / f"pass-{name}-{int(time.time())}.body").write_bytes(body)
        summarise(url, body)
    finding = {
        "url": url,
        "status": status,
        "ms": round(ms),
        "bytes": len(body),
        "type": headers.get("content-type"),
        "server": headers.get("server"),
        "cf_ray": headers.get("cf-ray"),
        "location": headers.get("location"),
        "refusal": " ".join(refusal.group(0).split()) if refusal else None,
    }
    if not refusal and status != 403:
        finding["head"] = text[:160]
    print(json.dumps(finding))
    return refusal is None


def access() -> None:
    print("## DNS")
    for host in HOSTS:
        try:
            addrs = sorted({info[4][0] for info in socket.getaddrinfo(host, 443, socket.AF_INET)})
        except socket.gaierror as err:
            addrs = [f"error {err}"]
        print(json.dumps({"host": host, "a": addrs}))
    print("## exit")
    print(json.dumps(get_json("https://ipinfo.io/json")))
    for url in ("https://openapi.blockfin.com/cdn-cgi/trace", "https://blockfin.com/cdn-cgi/trace"):
        status, _, body, _ = fetch(url)
        trace = dict(line.split("=", 1) for line in body.decode().splitlines() if "=" in line)
        print(json.dumps({"trace": url, "status": status, "ip": trace.get("ip"), "colo": trace.get("colo"), "loc": trace.get("loc")}))
    print("## pages")
    for url in PAGES:
        describe(url)
        time.sleep(0.5)
    print("## API paths in BloFin's v1 shape")
    for host in API_HOSTS:
        for path in API_PATHS:
            describe(host + path)
            time.sleep(0.5)
    status, _, body, _ = fetch("https://blockfin.com/")
    (WORK / "home-403.html").write_bytes(body)


def cmc() -> None:
    detail = get_json(CMC_DETAIL)["data"]
    (WORK / "cmc-detail.json").write_text(json.dumps(detail, indent=1))
    usd = detail["quote"]["2781"]
    print(json.dumps({
        "name": detail["name"], "id": detail["id"], "status": detail["status"], "launched": detail["dateLaunched"],
        "makerFee": detail["makerFee"], "takerFee": detail["takerFee"], "fee_url": detail["urls"]["fee"],
        "website": detail["urls"]["website"], "countries": detail["countries"], "fiats": detail["fiats"],
        "spot_usd_24h": round(usd["spotVolume24h"]), "perp_usd_24h": round(usd["perpetualVolume24h"]),
        "oi_usd": round(usd["derivativesOpenInterests"]), "updated": usd["updateTime"],
    }))
    for cat in ("perpetual", "spot", "futures"):
        data = get_json(CMC_PAIRS.format(cat=cat))["data"]
        pairs = data.get("marketPairs", [])
        (WORK / f"cmc-pairs-{cat}.json").write_text(json.dumps(data, indent=1))
        quotes = collections.Counter(p["quoteSymbol"] for p in pairs)
        print(json.dumps({"category": cat, "numMarketPairs": data.get("numMarketPairs"), "rows": len(pairs), "quotes": quotes}))
        if cat == "perpetual" and pairs:
            with_funding = sum(1 for p in pairs if p.get("fundingRate") is not None)
            with_index = sum(1 for p in pairs if p.get("indexPrice") is not None)
            urls = collections.Counter(re.sub(r"/[A-Z0-9]+-[A-Z]+$", "/<BASE>-<QUOTE>", p["marketUrl"]) for p in pairs)
            ids = collections.Counter(bool(re.fullmatch(r"[A-Z0-9]+-USDT", p.get("derivativeTickerId") or "")) for p in pairs)
            print(json.dumps({"with_fundingRate": with_funding, "with_indexPrice": with_index, "url_shapes": urls, "ticker_id_BASE-USDT": ids}))
            for p in pairs[:3]:
                print(json.dumps({k: p.get(k) for k in ("marketPair", "derivativeTickerId", "price", "indexPrice", "indexBasis", "fundingRate", "openInterestUsd", "volumeUsd", "lastUpdated")}))
        if cat == "spot" and pairs:
            for p in pairs[:2]:
                print(json.dumps({k: p.get(k) for k in ("marketPair", "price", "volumeUsd", "marketUrl", "lastUpdated")}))
        time.sleep(1)
    blofin_detail = get_json(CMC_DETAIL.replace("blockfin", "blofin"))["data"]
    print(json.dumps({"blofin_name": blofin_detail["name"], "blofin_launched": blofin_detail["dateLaunched"],
                      "blofin_makerFee": blofin_detail["makerFee"], "blofin_takerFee": blofin_detail["takerFee"]}))
    blockfin = {p["marketPair"]: p for p in get_json(CMC_PAIRS.format(cat="perpetual"))["data"]["marketPairs"]}
    time.sleep(1)
    blofin = {p["marketPair"]: p for p in get_json(CMC_BLOFIN)["data"]["marketPairs"]}
    common = sorted(set(blockfin) & set(blofin))
    same = [k for k in common if math.isclose(blockfin[k]["fundingRate"], blofin[k]["fundingRate"], rel_tol=1e-9, abs_tol=1e-15)]
    same_index = [k for k in common if math.isclose(blockfin[k]["indexPrice"], blofin[k]["indexPrice"], rel_tol=1e-9)]
    print(json.dumps({"blofin_pairs": len(blofin), "blockfin_pairs": len(blockfin), "common": len(common),
                      "same_fundingRate": len(same), "same_indexPrice": len(same_index),
                      "differing_funding": [(k, blockfin[k]["fundingRate"], blofin[k]["fundingRate"]) for k in common if k not in same][:5],
                      "BTC_volumeBase_blockfin_blofin": [blockfin["BTC/USDT"]["volumeBase"], blofin["BTC/USDT"]["volumeBase"]],
                      "lastUpdated_blockfin_blofin": [blockfin["BTC/USDT"]["lastUpdated"], blofin["BTC/USDT"]["lastUpdated"]]}))


def repeat() -> None:
    base = "https://openapi.blockfin.com/api/v1"
    plan = {
        f"{base}/market/tickers": 15,
        f"{base}/no-such-path": 15,
        f"{base}/market/instruments?instType=SWAP": 6,
        f"{base}/market/mark-price": 6,
        f"{base}/market/funding-rate": 6,
    }
    passed = collections.Counter()
    for round_no in range(max(plan.values())):
        for url, tries in plan.items():
            if round_no < tries:
                passed[url] += describe(url)
                time.sleep(1)
    print(json.dumps({"tries": plan, "not_refused": passed}))


def ccxt() -> None:
    local = sorted(p.name for p in CCXT_DIR.glob("*.js") if re.search(r"blo|fin", p.name))
    print(json.dumps({"ccxt_4.5.68_files_matching_blo_or_fin": local, "blockfin.js": (CCXT_DIR / "blockfin.js").exists()}))
    head = get_json(GH_HEAD)
    names = [x["name"] for x in get_json(GH_SRC) if x["type"] == "file"]
    print(json.dumps({
        "master": head["sha"], "date": head["commit"]["committer"]["date"], "ts_src_files": len(names),
        "matching_blo_or_fin": [n for n in names if re.search(r"blo|fin", n)], "blockfin.ts": "blockfin.ts" in names,
    }))


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    WORK.mkdir(parents=True, exist_ok=True)
    print(f"blockfin rest probe, mode {mode}, {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    for name, fn in (("access", access), ("cmc", cmc), ("repeat", repeat), ("ccxt", ccxt)):
        if mode in (name, "all"):
            print(f"# {name}")
            fn()


if __name__ == "__main__":
    main()
