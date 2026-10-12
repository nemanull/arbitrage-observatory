# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for ListaDao, the venue CoinMarketCap lists at rank 228.

Checks what CoinMarketCap lists for the venue and what the lista.org hosts answer.
Checks whether any exchange style market data path exists on api.lista.org, and what the web app bundle calls.
Reads the public Moolah lending API, the Lista V3 Dex pools the documentation names on BNB Smart Chain, and whether CCXT has a class.
Run from the repository root: uv run scripts/probes/venues/listadao/rest-probe.py
Captures go to .claude/survey-work/listadao/.
"""

import json
import re
import socket
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/listadao")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) survey-probe", "Accept": "application/json, text/html"}
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"
API = "https://api.lista.org"
DOCS = "https://docs.bsc.lista.org"
RPC = "https://bsc-rpc.publicnode.com"  # a public BSC node the lista.org bundle itself lists
CCXT_LOCAL = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")

# Pools from the documentation page for-developer/dex/smart-contract.
V3_POOLS = [
    "0xd50154428912A887d9a405Bb515d2Ef11307228d",
    "0x46eE2C5F2b9De7C6e08Ffe3Bde8Dd88A46D6f568",
    "0x8b94363fbBbBcdae25832807BE39e8e2c60a6e15",
    "0x9f0E53D3aC0dc7aEaAF36866cD1A9EEbE16Bf4a1",
]
SEL = {"token0": "0x0dfe1681", "token1": "0xd21220a7", "fee": "0xddca3f43", "symbol": "0x95d89b41", "liquidity": "0x1a686502"}

# Exchange style paths a spot or perpetual venue would serve, tried once each.
GUESSES = [
    "/api/v1/ticker", "/api/v1/tickers", "/api/v1/depth?symbol=slisBNBx_BNB", "/api/v3/exchangeInfo",
    "/api/v1/symbols", "/api/spot/markets", "/api/dex/pairs", "/api/dex/pools", "/api/swap/pairs",
    "/api/v1/market/orderbook", "/api/futures/contracts", "/api/v1/funding",
]


def get(url: str, timeout: float = 20, headers: dict | None = None, data: bytes | None = None) -> tuple[int, bytes, float, dict]:
    req = urllib.request.Request(url, headers={**UA, **(headers or {})}, data=data)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, body, (time.perf_counter() - t0) * 1000, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), (time.perf_counter() - t0) * 1000, dict(e.headers)
    except Exception as e:  # DNS failure, timeout, TLS error
        return 0, repr(e).encode(), (time.perf_counter() - t0) * 1000, {}


def short(body: bytes, n: int = 160) -> str:
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def section(title: str) -> None:
    print(f"\n== {title}")


def dns() -> None:
    section("DNS")
    for host in ["lista.org", "api.lista.org", "static.lista.org", "docs.bsc.lista.org", "docs.lista.org", "logapi.lista.org"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
            print(f"{host}: {', '.join(addrs)}")
        except socket.gaierror as e:
            print(f"{host}: does not resolve ({e})")


def cmc() -> None:
    section("CoinMarketCap exchange detail and market pairs")
    st, body, ms, _ = get(f"{CMC}/detail?slug=listadao")
    (WORK / "cmc-detail.json").write_bytes(body)
    d = json.loads(body)["data"]
    print(f"detail {st}: id {d['id']} name {d['name']} status {d['status']} makerFee {d['makerFee']} takerFee {d['takerFee']}")
    print(f"  website {d['urls']['website']} fee urls {d['urls']['fee']} tags {[t['slug'] for t in d['tags']]}")
    q = d["quote"]["2781"]
    print(f"  spotVolume24h {q['spotVolume24h']:.0f} perpetualVolume24h {q['perpetualVolume24h']} futuresVolume24h {q['futuresVolume24h']}")
    print(f"  description starts: {d['description'][:110]!r}")
    for cat in ["spot", "perpetual", "futures"]:
        st, body, ms, _ = get(f"{CMC}/market-pairs/latest?slug=listadao&category={cat}&start=1&limit=100")
        (WORK / f"cmc-pairs-{cat}.json").write_bytes(body)
        dd = json.loads(body).get("data", {})
        pairs = dd.get("marketPairs", [])
        print(f"pairs {cat} {st}: numMarketPairs {dd.get('numMarketPairs')}")
        for p in pairs:
            print(f"  {p['marketPair']} price {p['price']} volumeUsd {p['volumeUsd']:.0f} volumeBase {p['volumeBase']} volumeQuote {p['volumeQuote']} marketUrl {p['marketUrl']!r} type {p['type']}")


def hosts() -> str:
    section("Hosts and latency")
    home = b""
    for i in range(3):
        st, body, ms, h = get("https://lista.org/")
        home = body or home
        print(f"GET https://lista.org/ #{i + 1}: {st} {len(body)} bytes {ms:.0f} ms server {h.get('Server')} via {h.get('Via', '')[:40]}")
    for i in range(3):
        st, body, ms, h = get(f"{API}/")
        print(f"GET {API}/ #{i + 1}: {st} {ms:.0f} ms {short(body)}")
        if i == 0:
            try:
                server_ms = json.loads(body)["timestamp"]
                local_ms = time.time() * 1000
                print(f"  body timestamp {server_ms}, local clock minus server about {local_ms - server_ms:.0f} ms (includes the reply's flight)")
            except Exception:
                pass
            print(f"  Date header {h.get('Date')}")
    st, body, ms, _ = get(f"{DOCS}/")
    print(f"GET {DOCS}/: {st} {len(body)} bytes {ms:.0f} ms")
    return home.decode("utf-8", "replace")


def guesses() -> None:
    section("Exchange style paths on api.lista.org")
    for p in GUESSES:
        st, body, ms, _ = get(API + p)
        print(f"GET {p}: {st} {short(body, 90)}")


def bundle(home: str) -> None:
    section("Web app bundle")
    m = re.search(r'src="(https://static\.lista\.org/lista-static/assets/index-[^"]+\.js)"', home)
    if not m:
        print("no index bundle found in the home page")
        return
    st, body, ms, _ = get(m.group(1), timeout=40)
    (WORK / "bundle-index.js").write_bytes(body)
    js = body.decode("utf-8", "replace")
    print(f"{m.group(1)}: {st} {len(body)} bytes")
    for term in ["orderbook", "orderBook", "depth", "perp", "funding", "markPrice", "indexPrice", "websocket", "wss://", "swap", "Swap"]:
        print(f"  {term!r}: {len(re.findall(re.escape(term), js))}")
    words = sorted({m.group(0) for m in re.finditer(r"[A-Za-z]*perp[A-Za-z]*", js, re.I)})
    print(f"  words containing 'perp': {words}")
    entities = sorted(set(re.findall(r"[A-Z][A-Za-z]+ (?:Foundation|Ltd\.?|Limited|Inc\.|LLC|Pte)\b", js)))
    print(f"  company names in the bundle: {entities or 'none'}")
    wss = sorted(set(re.findall(r"wss://[A-Za-z0-9._/-]+", js)))
    print(f"  wss URLs ({len(wss)}): {', '.join(u.split('/')[2] for u in wss)}")
    paths = sorted(set(re.findall(r'"(/api/[A-Za-z0-9/_-]+)', js)))
    prefixes = sorted({"/".join(p.split("/")[:3]) for p in paths})
    print(f"  /api/ paths {len(paths)}, prefixes: {', '.join(prefixes)}")
    swaps = sorted(set(re.findall(r"https://(?:pancakeswap\.finance|thena\.fi)/[A-Za-z0-9/]*", js)))
    print(f"  outbound swap links: {', '.join(swaps)}")


def lending() -> None:
    section("Moolah lending API, public reads")
    st, body, ms, _ = get(f"{API}/api/moolah/overall")
    print(f"GET /api/moolah/overall: {st} {len(body)} bytes {ms:.0f} ms {short(body, 200)}")
    st, body, ms, h = get(f"{API}/api/moolah/borrow/markets?page=1&pageSize=3")
    (WORK / "moolah-markets.json").write_bytes(body)
    print(f"GET /api/moolah/borrow/markets?page=1&pageSize=3: {st} {len(body)} bytes {ms:.0f} ms cache-control {h.get('Cache-Control')}")
    try:
        d = json.loads(body)
        data = d.get("data", {})
        rows = data.get("list", data if isinstance(data, list) else [])
        print(f"  envelope keys {list(d)} total {data.get('total') if isinstance(data, dict) else None}")
        for r in rows[:3]:
            print(f"  market {r.get('loan')}/{r.get('collateral')} rate {r.get('rate')} lltv {r.get('lltv')} termType {r.get('termType')}")
            print(f"    row keys {sorted(r)[:25]}")
    except Exception as e:
        print(f"  parse failed {e!r}")


def rpc(to: str, data: str) -> str:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]}).encode()
    st, body, ms, _ = get(RPC, headers={"Content-Type": "application/json"}, data=payload)
    d = json.loads(body)
    return d.get("result") or f"error {d.get('error')}"


def abi_string(hexdata: str) -> str:
    raw = bytes.fromhex(hexdata[2:])
    if len(raw) >= 96:
        n = int.from_bytes(raw[32:64], "big")
        return raw[64:64 + n].decode("utf-8", "replace")
    return raw.rstrip(b"\0").decode("utf-8", "replace")


def pools() -> None:
    section("Lista V3 Dex pools named in the documentation, read on chain")
    for pool in V3_POOLS:
        t0, t1 = rpc(pool, SEL["token0"]), rpc(pool, SEL["token1"])
        fee, liq = rpc(pool, SEL["fee"]), rpc(pool, SEL["liquidity"])
        if not t0.startswith("0x") or not t1.startswith("0x"):
            print(f"{pool}: {t0} {t1}")
            continue
        a0, a1 = "0x" + t0[-40:], "0x" + t1[-40:]
        s0, s1 = abi_string(rpc(a0, SEL["symbol"])), abi_string(rpc(a1, SEL["symbol"]))
        print(f"{pool}: {s0}/{s1} fee {int(fee, 16)} ppm liquidity {int(liq, 16)}")


def ccxt() -> None:
    section("CCXT")
    local = sorted(p.name for p in CCXT_LOCAL.glob("*.js") if "lista" in p.name.lower())
    print(f"4.5.68 local files matching 'lista': {local or 'none'}")
    st, body, ms, _ = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master", headers={"Accept": "application/vnd.github+json"})
    if st == 200:
        names = [e["name"] for e in json.loads(body)]
        hits = [n for n in names if "lista" in n.lower()]
        print(f"GitHub master ts/src: {len(names)} entries, matching 'lista': {hits or 'none'}")
    else:
        print(f"GitHub master ts/src: {st} {short(body)}")


def docs() -> None:
    section("Documentation pages")
    for page, needles in [
        ("for-developer/dex.md", ["Uniswap V3 fork", "concentrated-liquidity automated market maker"]),
        ("for-developer/clisbnb.md", ["non-transferable certificate"]),
        ("introduction/binance-launchpool-clisbnb.md", ["1:1 ratio", "non-transferable"]),
    ]:
        st, body, ms, _ = get(f"{DOCS}/{page}")
        text = body.decode("utf-8", "replace")
        print(f"{page}: {st} {len(body)} bytes, " + ", ".join(f"{n!r} {'found' if n.lower() in text.lower() else 'missing'}" for n in needles))
    st, body, ms, _ = get(f"{DOCS}/llms.txt")
    text = body.decode("utf-8", "replace")
    for term in ["perpetual futures", "order book", "orderbook", "websocket", "funding rate"]:
        print(f"  llms.txt {term!r}: {len(re.findall(term, text, re.I))}")


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print(f"rest-probe start {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    dns()
    cmc()
    home = hosts()
    guesses()
    bundle(home)
    lending()
    pools()
    ccxt()
    docs()
    print(f"\nrest-probe end {datetime.now(timezone.utc).isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
