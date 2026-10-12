# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for ChangeNOW, an instant swap service with no order book.

Checks DNS and latency of the API host, which documented calls answer without an API key, the size of the currency and pair catalogs, the server clock, the CoinMarketCap and CoinGecko records, and whether CCXT master holds a class.
The documented public limit is 30 calls per second and 1,800 per minute, and this probe sends about 40 calls in total, one at a time.

Run from the repository root:
    uv run scripts/probes/venues/changenow/rest-probe.py
"""

import json
import socket
import time
import urllib.error
import urllib.request
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "changenow"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
API = "https://api.changenow.io"
CMC = "https://api.coinmarketcap.com/data-api/v3"
HOSTS = ["api.changenow.io", "changenow.io", "vip-api.changenow.io", "notifier.changenow.io", "content-api.changenow.io"]

# Documented calls, each sent once without any API key.
KEYLESS = [
    "/v1/currencies?active=true",
    "/v1/currencies-to/btc",
    "/v1/currencies/btc",
    "/v1/market-info/available-pairs/?includePartners=false",
    "/v1/exchange-amount/0.01/btc_usdttrc20",
    "/v1/min-amount/btc_usdttrc20",
    "/v1/exchange-range/btc_usdttrc20",
    "/v1/exchange-amount/0.01/btc_usdt",
    "/v1/exchange-amount/0.01/btc_nosuchcoin",
    "/v1/market-info/fixed-rate/x",
    "/v1/exchange-amount/fixed-rate/0.01/btc_usdttrc20",
    "/v2/exchange/currencies?active=true&flow=standard",
    "/v2/exchange/available-pairs?fromCurrency=btc&fromNetwork=btc&flow=standard",
    "/v2/exchange/min-amount?fromCurrency=btc&toCurrency=usdt&fromNetwork=btc&toNetwork=trx&flow=standard",
    "/v2/exchange/range?fromCurrency=btc&toCurrency=usdt&fromNetwork=btc&toNetwork=trx&flow=standard",
    "/v2/exchange/estimated-amount?fromCurrency=btc&toCurrency=usdt&fromAmount=0.01&fromNetwork=btc&toNetwork=trx&flow=standard",
    "/v2/exchange/network-fee?fromCurrency=btc&toCurrency=usdt&fromNetwork=btc&toNetwork=trx&fromAmount=0.01&convertedCurrency=usd&convertedNetwork=usd",
    "/v2/markets/estimate?fromCurrency=btc&toCurrency=usdt&fromAmount=0.01&type=direct",
    "/v1/nosuchpath",
]


def get(url: str, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            status, headers = r.status, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        body, status, headers = e.read(), e.code, {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:  # network failure is a fact to record, not a crash
        return {"status": None, "error": repr(e), "ms": round((time.time() - t0) * 1000)}
    t1 = time.time()
    return {"status": status, "ms": round((t1 - t0) * 1000), "t0": t0, "t1": t1, "headers": headers, "body": body}


def short(body: bytes, n: int = 160) -> str:
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def resolve(host: str) -> list[str]:
    try:
        return sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
    except socket.gaierror as e:
        return [f"unresolved: {e.strerror}"]


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("== exit")
    r = get("https://ipinfo.io/json")
    if r.get("body"):
        info = json.loads(r["body"])
        print(f"  {info.get('ip')} {info.get('city')} {info.get('country')} {info.get('org')}")

    print("== DNS")
    for h in HOSTS:
        print(f"  {h}: {', '.join(resolve(h))}")

    print("== latency, GET /v1/min-amount/btc_eth five times")
    for _ in range(5):
        r = get(API + "/v1/min-amount/btc_eth")
        print(f"  {r['status']} {r['ms']} ms {short(r.get('body', b''))} cf-ray={r.get('headers', {}).get('cf-ray')}")
        time.sleep(0.3)

    print("== keyless calls")
    for path in KEYLESS:
        r = get(API + path)
        body = r.get("body", b"")
        extra = ""
        if r["status"] == 200 and body[:1] == b"[":
            extra = f" array of {len(json.loads(body))}"
        print(f"  {r['status']} {len(body)} B {r['ms']} ms {path}{extra}")
        print(f"      {short(body)}")
        limit_headers = {k: v for k, v in r.get("headers", {}).items() if "limit" in k.lower() or k.lower() == "retry-after"}
        if limit_headers:
            print(f"      limit headers {limit_headers}")
        time.sleep(0.3)

    print("== catalog")
    v1 = json.loads(get(API + "/v1/currencies?active=true")["body"])
    v2 = json.loads(get(API + "/v2/exchange/currencies?active=true&flow=standard")["body"])
    pairs = json.loads(get(API + "/v1/market-info/available-pairs/?includePartners=false")["body"])
    (WORK / "v1-currencies.json").write_text(json.dumps(v1))
    (WORK / "v2-currencies.json").write_text(json.dumps(v2))
    print(f"  v1 active currencies {len(v1)}, fiat {sum(1 for c in v1 if c.get('isFiat'))}, fixed-rate {sum(1 for c in v1 if c.get('supportsFixedRate'))}")
    print(f"  v2 active currency rows {len(v2)}, networks {len({c.get('network') for c in v2})}, distinct tickers {len({c.get('ticker') for c in v2})}")
    print(f"  v1 available pairs {len(pairs)}, sample {pairs[:3]}")
    print(f"  v1 row keys {sorted(v1[0].keys())}")
    print(f"  v2 row keys {sorted(v2[0].keys())}")
    print(f"  rows whose name contains perpetual or futures: {[(c['ticker'], c['name']) for c in v2 if any(w in (c.get('name') or '').lower() for w in ('perpetual', 'futures'))]}")

    print("== server time from the Date header, three samples")
    for _ in range(3):
        r = get(API + "/v1/min-amount/btc_eth")
        server = parsedate_to_datetime(r["headers"]["date"]).timestamp()
        mid = (r["t0"] + r["t1"]) / 2
        print(f"  server minus local midpoint {round((server - mid) * 1000)} ms, round trip {r['ms']} ms, Date has 1 s resolution")
        time.sleep(1.1)

    print("== CoinMarketCap")
    d = json.loads(get(f"{CMC}/exchange/detail?slug=changenow")["body"])["data"]
    print(f"  id {d['id']} name {d['name']} status {d['status']} launched {d['dateLaunched']} countries {d['countries']} fiats {d['fiats']}")
    print(f"  makerFee {d['makerFee']} takerFee {d['takerFee']} tags {[t['slug'] for t in d['tags']]}")
    print(f"  urls {d['urls']}")
    q = d["quote"]["2781"]
    print(f"  quote USD spot {q['spotVolume24h']:.0f} perpetual {q['perpetualVolume24h']} futures {q['futuresVolume24h']} at {q['updateTime']}")
    for cat in ("spot", "perpetual", "futures"):
        m = json.loads(get(f"{CMC}/exchange/market-pairs/latest?slug=changenow&category={cat}&start=1&limit=100")["body"])["data"]
        rows = m.get("marketPairs", [])
        urls = {p.get("marketUrl") for p in rows}
        quotes = {}
        for p in rows:
            quotes[p["marketPair"].split("/")[1]] = quotes.get(p["marketPair"].split("/")[1], 0) + 1
        print(f"  category {cat}: numMarketPairs {m.get('numMarketPairs')}, first page {len(rows)} rows, quote assets on first page {quotes}, marketUrl values {urls}")
        time.sleep(0.5)
    for ex_type in (1, 2):
        lst = json.loads(get(f"{CMC}/exchange/listing?exType={ex_type}&start=1&limit=500&sortBy=score&sortType=desc")["body"])["data"]
        rows = lst["exchanges"]
        pos = [i + 1 for i, e in enumerate(rows) if e.get("slug") == "changenow"]
        print(f"  listing exType={ex_type}: {len(rows)} rows, ChangeNOW at {pos or 'absent'}")
        time.sleep(0.5)

    print("== CoinGecko")
    r = get("https://api.coingecko.com/api/v3/exchanges/list")
    if r["status"] == 200:
        rows = json.loads(r["body"])
        print(f"  {len(rows)} rows, matching changenow: {[x for x in rows if 'changenow' in (x['id'] + x['name']).lower().replace(' ', '')]}")
    else:
        print(f"  {r['status']} {short(r.get('body', b''))}")

    print("== CCXT master on GitHub")
    head = json.loads(get("https://api.github.com/repos/ccxt/ccxt/commits/master")["body"])
    tree = json.loads(get(f"https://api.github.com/repos/ccxt/ccxt/git/trees/{head['sha']}")["body"])
    ts = next(t for t in tree["tree"] if t["path"] == "ts")
    ts_tree = json.loads(get(ts["url"])["body"])
    src = next(t for t in ts_tree["tree"] if t["path"] == "src")
    src_tree = json.loads(get(src["url"])["body"])
    names = [t["path"] for t in src_tree["tree"]]
    print(f"  master {head['sha']} at {head['commit']['committer']['date']}, ts/src has {len(names)} entries")
    print(f"  entries containing change or now: {[n for n in names if 'change' in n.lower() or 'now' in n.lower()]}")


if __name__ == "__main__":
    main()
