# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only access probe for SWFT Trade, which CoinMarketCap also calls SWFT Octopus Trade.

Checks the hosts, the CoinMarketCap and CoinGecko records, the published TRADE API pages, and what the market data calls of that API return without a partner channel.
Every request is a single public call, so no published or unpublished limit is approached.
The market data calls are sent once with no channel and once with the documentation's own example channel and a placeholder signature, to show where the gate sits.

Run from the repository root:
    uv run scripts/probes/venues/swft-trade/rest-probe.py
"""

import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "swft-trade"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
API = "https://www.swftc.info"  # the "API HOST" on the documentation's front page
DOCS = "https://docs-swft.en.swft.pro"
CMC_SLUG = "swft-octopus-trade"

HOSTS = [
    "www.swftc.info",
    "swftc.info",
    "www.swft.pro",
    "swft.pro",
    "trade.swft.pro",
    "exchange.swftcoin.com",
    "swap.swftcoin.com",
    "docs-swft.en.swft.pro",
]

TRADE_DOC_PAGES = [
    "master",
    "trade-api/swft-trade-interface",
    "trade-api/generate-signature",
    "trade-api/get-the-support-trade-pair",
    "trade-api/get-market-depth",
    "trade-api/latest-transaction-information",
    "trade-api/historical-transaction-record",
    "trade-api/k-line-data",
]

# Market data calls of the TRADE API. All are documented as POST application/json with channelId, timestamp and sign.
MARKET_CALLS = [
    ("/marketApi/loadPair", {}),
    ("/marketApi/depth", {"tradePair": "BTC/USDT", "depth": "1"}),
    ("/marketApi/history/detail", {"symbol": "BTC/USDT"}),
    ("/marketApi/history/trade", {"symbol": "BTC/USDT"}),
    ("/market/history/kline", {"symbol": "BTC/USDT", "period": "5min"}),
]


def resolve(host: str) -> list[str]:
    try:
        return sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
    except socket.gaierror as e:
        return [f"unresolved: {e.strerror}"]


def call(url: str, body: dict | None = None, timeout: float = 20.0, follow: bool = True) -> dict:
    data = None if body is None else json.dumps(body).encode()
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    t0 = time.perf_counter()
    try:
        with opener.open(req, timeout=timeout) as r:
            raw, status, hdrs = r.read(), r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw, status, hdrs = e.read(), e.code, dict(e.headers)
    except (urllib.error.URLError, OSError) as e:
        return {"url": url, "error": str(getattr(e, "reason", e)), "ms": round((time.perf_counter() - t0) * 1000)}
    return {
        "url": url,
        "status": status,
        "ms": round((time.perf_counter() - t0) * 1000),
        "server": hdrs.get("Server") or hdrs.get("server"),
        "location": hdrs.get("Location") or hdrs.get("location"),
        "content_type": hdrs.get("Content-Type") or hdrs.get("content-type"),
        "bytes": len(raw),
        "_body": raw,
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # report the 3xx itself instead of following it
        return None


def show(r: dict, head: int = 200) -> None:
    out = {k: v for k, v in r.items() if not k.startswith("_")}
    text = r.get("_body", b"").decode("utf-8", "replace")
    title = re.search(r"<title>([^<]*)</title>", text)
    if title:
        out["title"] = " ".join(title.group(1).split())
    elif text:
        out["body_head"] = text[:head]
    print(json.dumps(out, ensure_ascii=False))


def jbody(r: dict):
    return json.loads(r["_body"])


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    print("\n## exit")
    ipinfo = call("https://ipinfo.io/json")
    try:
        info = jbody(ipinfo)
        print({k: info.get(k) for k in ("city", "region", "country", "org")})
    except Exception as e:  # noqa: BLE001
        print("ipinfo", ipinfo.get("status"), e)

    print("\n## DNS")
    for h in HOSTS:
        print(f"{h:26} {' '.join(resolve(h))}")

    print("\n## HTTP front pages, redirects not followed")
    for h in HOSTS:
        show(call(f"https://{h}/", follow=False))

    print("\n## cold and warm time, GET of the API host's web app, three in a row")
    for _ in range(3):
        r = call(f"{API}/swft-v3/swft-v3-pc/index.html")
        print(r.get("status"), r.get("ms"), "ms", r.get("bytes"), "bytes")

    print("\n## CoinMarketCap")
    detail = call(f"https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug={CMC_SLUG}")
    try:
        d = jbody(detail)["data"]
        print("detail", detail["status"], {k: d.get(k) for k in ("id", "name", "slug", "status", "dateLaunched", "makerFee", "takerFee", "countries", "fiats")})
        print("urls", d.get("urls"))
        print("tags", [t.get("slug") for t in d.get("tags", [])])
        print("description", d.get("description"))
        q = d.get("quote", {}).get("2781", {})  # 2781 is USD
        print("quote USD", {k: q.get(k) for k in ("spotVolume24h", "perpetualVolume24h", "futuresVolume24h")})
    except Exception as e:  # noqa: BLE001
        print("detail", detail.get("status"), e)
    for ex_type in (1, 2):  # 1 is the default exchange ranking, 2 the derivatives ranking
        listing = call(f"https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType={ex_type}&start=1&limit=500&sortBy=score&sortType=desc")
        try:
            rows = jbody(listing)["data"]["exchanges"]
            hit = [(i + 1, e) for i, e in enumerate(rows) if e.get("slug") == CMC_SLUG]
            if hit:
                pos, e = hit[0]
                print(f"exType={ex_type}", len(rows), "rows, position", pos, {k: e.get(k) for k in ("score", "numMarkets", "numCoins", "visits", "liquidity", "spotVol24h", "totalVolAdjusted24h")})
            else:
                print(f"exType={ex_type}", len(rows), "rows, SWFT Trade absent")
        except Exception as e:  # noqa: BLE001
            print("listing", ex_type, listing.get("status"), e)
    for cat in ("spot", "perpetual", "futures"):
        r = call(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug={CMC_SLUG}&category={cat}&start=1&limit=100")
        try:
            data = jbody(r)["data"]
            pairs = data.get("marketPairs", [])
            print(cat, r["status"], "numMarketPairs", data.get("numMarketPairs"))
            for p in pairs:
                print("   ", p.get("marketPair"), round(p.get("volumeUsd") or 0), p.get("price"), repr(p.get("marketUrl")), p.get("lastUpdated"))
        except Exception as e:  # noqa: BLE001
            print(cat, r.get("status"), e)

    print("\n## CoinGecko")
    r = call("https://api.coingecko.com/api/v3/exchanges/list")
    if r.get("status") == 429:
        time.sleep(30)  # the public tier answers 429 to a shared exit, one slow retry stays polite
        r = call("https://api.coingecko.com/api/v3/exchanges/list")
    try:
        rows = jbody(r)
        print("exchanges/list", r["status"], len(rows), "rows, SWFT or Octopus matches", [x for x in rows if "swft" in (x["id"] + x["name"]).lower() or "octopus" in x["name"].lower()])
    except Exception as e:  # noqa: BLE001
        print("exchanges/list", r.get("status"), r.get("_body", b"")[:120].decode("utf-8", "replace"), e)

    print("\n## TRADE API documentation pages")
    for page in TRADE_DOC_PAGES:
        r = call(f"{DOCS}/{page}.md")
        text = r.get("_body", b"").decode("utf-8", "replace")
        (WORK / f"doc_{page.replace('/', '_')}.md").write_text(text)
        url = re.search(r"`(https://\{host\}[^`]+)`", text)
        needs_channel = bool(re.search(r"\|\s*channelId\s*\|\s*(Y|yes)\s*\|", text))
        host = re.search(r"\*\*`(https://[^`]+)`\*\*", text)
        print(page, r.get("status"), r.get("bytes"), "url", url.group(1) if url else None, "channelId required", needs_channel, "api host", host.group(1) if host else None)
    idx = call(f"{DOCS}/llms.txt").get("_body", b"").decode("utf-8", "replace")
    pages = re.findall(r"\]\((https://docs-swft\.en\.swft\.pro/[^)]+\.md)\)", idx)
    words = re.compile(r"websocket|wss://|rate limit|frequen|times per|per second|per minute|ip limit", re.I)
    hits = []
    for url in pages:
        time.sleep(0.5)
        text = call(url).get("_body", b"").decode("utf-8", "replace")
        hits += [(url.rsplit("/", 1)[-1], m.group(0)) for m in words.finditer(text)]
    print("llms.txt pages", len(pages), "websocket or rate limit statements", hits)
    iface = (WORK / "doc_trade-api_swft-trade-interface.md").read_text()
    for line in iface.splitlines():
        if line.startswith("* ") or re.match(r"\s*\|\s*(800|900|901|964)\s*\|", line):
            print("   ", line.strip())

    print("\n## market data calls, no channel")
    for path, params in MARKET_CALLS:
        show(call(f"{API}{path}", body=params))
    print("\n## same, GET")
    show(call(f"{API}/marketApi/loadPair"))
    show(call(f"{API}/market/history/kline?symbol=btcusdt&period=5min&size=2"))

    print("\n## market data calls, the documentation's example channelId and a placeholder sign")
    ts = str(int(time.time() * 1000))
    for path, params in MARKET_CALLS:
        show(call(f"{API}{path}", body={"channelId": "swft-channel", "timestamp": ts, "sign": "00", **params}))

    print("\n## server clock, from the millisecond timestamp in the API host's 404 body, three samples")
    for _ in range(3):
        t0 = time.time()
        r = call(f"{API}/no-such-path-probe")
        t1 = time.time()
        m = re.search(r'"timestamp":"([^"]+)"', r.get("_body", b"").decode("utf-8", "replace"))
        if m:
            server = datetime.fromisoformat(m.group(1)).timestamp()
            print(r.get("status"), m.group(1), "offset vs local midpoint", round((server - (t0 + t1) / 2) * 1000), "ms, round trip", round((t1 - t0) * 1000), "ms")
        else:
            show(r)

    print("\n## CCXT")
    src = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js"
    names = sorted(p.stem for p in (src / "src").glob("*.js"))
    print("4.5.68 js/src classes", len(names), "swft or octopus present", [n for n in names if "swft" in n or "octo" in n])
    lines = (src / "ccxt.js").read_text().splitlines()
    for i, ln in enumerate(lines, 1):
        if re.search(r"(from './src/(poloniex|tokocrypto)\.js')|^\s+'(poloniex|tokocrypto)': (poloniex|tokocrypto),", ln):
            print(f"ccxt.js:{i}: {ln.strip()}")
    root = call("https://api.github.com/repos/ccxt/ccxt/git/trees/master")
    try:
        tree = jbody(root)
        ts_tree = next(t for t in tree["tree"] if t["path"] == "ts")
        src_tree = next(t for t in jbody(call(ts_tree["url"]))["tree"] if t["path"] == "src")
        gh = [t["path"] for t in jbody(call(src_tree["url"]))["tree"]]
        print("master", tree["sha"], "ts/src entries", len(gh), "swft or octopus present", [n for n in gh if "swft" in n.lower() or "octo" in n.lower()])
    except Exception as e:  # noqa: BLE001
        print("github", root.get("status"), e)

    print("\n# probe finished", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
