# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6"]
# ///
"""LMAX REST probe for docs/profiles/lmax-digital/rest.md.

Public, unauthenticated and read-only, about 40 requests over about 30 seconds.
  1. DNS for every LMAX host the perpetual futures spec and the LMAX Digital site name.
  2. The perpetual futures REST calls without a token, cold and warm, on production and demo.
  3. The perpetual futures OpenAPI spec: change log, current version, servers, security per path, and the mark, index and funding text.
  4. The perpetual futures instrument list CSV published by LMAX Global MU.
  5. LMAX Digital spot: the instrument CSV, the Broker Market Data API without a token, and the public-data-api host.
  6. Error shapes, rate limit headers and the Date header offset.
  7. CCXT: LMAX in the installed 4.5.68 and in the current ccxt/ccxt master on GitHub.
Run from the repository root with: uv run scripts/probes/venues/lmax-digital/rest-probe.py
"""

import csv
import email.utils
import io
import json
import pathlib
import re
import socket
import time
import urllib.error
import urllib.request

import yaml

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/plain, */*"}
MD = "https://market-data.london-perpetual.lmax.com"
MD_DEMO = "https://market-data.perpetual-demo.lmax.com"
CLIENT = "https://client.london-perpetual.lmax.com"
DOCS = "https://docs.lmax.com"
REPO = pathlib.Path(__file__).resolve().parents[4]
CCXT_SRC = REPO / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"
KEEP_HEADERS = ("server", "content-type", "content-length", "retry-after", "www-authenticate", "date", "cf-cache-status")


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:  # DNS failure, timeout, TLS error
        return None, {}, repr(e).encode(), (time.perf_counter() - t0) * 1000


def headers_of(h, extra=()):
    return {k: v for k, v in h.items() if k.lower() in KEEP_HEADERS or k.lower().startswith(("x-ratelimit", "ratelimit")) or k.lower() in extra}


def show(label, url):
    status, h, body, ms = get(url)
    print(f"{label}: {url}\n   status {status}, {round(ms)} ms, {len(body)} bytes, headers {headers_of(h)}\n   body {body[:300].decode(errors='replace')!r}")
    return status, h, body, ms


def section1():
    print("== 1. DNS")
    hosts = [
        "market-data.london-perpetual.lmax.com", "client.london-perpetual.lmax.com", "trading.london-perpetual.lmax.com",
        "market-data.perpetual-demo.lmax.com", "client.perpetual-demo.lmax.com", "trading.perpetual-demo.lmax.com",
        "auth.lmax.com", "docs.lmax.com", "www.lmax.com", "www.lmaxdigital.com", "assets.lmaxstatic.com",
        "market-data-api.london-digital.lmax.com", "public-data-api.london-digital.lmax.com", "web-order.london-digital.lmax.com",
    ]
    for h in hosts:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [f"no address ({e})"]
        print(f"   {h}: {addrs}")


def section2():
    print("\n== 2. perpetual futures REST without a token, three rounds")
    paths = [
        (MD, "/instrument/v1/instruments"),
        (MD, "/instrument/v1/instruments/funding"),
        (MD, "/instrument/v1/instruments/BTCUSDPERP/funding"),
        (CLIENT, "/v1/balance"),
        (MD_DEMO, "/instrument/v1/instruments"),
    ]
    for rnd in range(3):
        for base, path in paths:
            status, h, body, ms = get(base + path)
            if rnd == 0:
                print(f"   {base}{path}: status {status}, {round(ms)} ms, headers {headers_of(h)}, body {body[:200].decode(errors='replace')!r}")
            else:
                print(f"   round {rnd + 1} {base}{path}: status {status}, {round(ms)} ms")
        time.sleep(1)


def section3():
    print("\n== 3. perpetual futures OpenAPI spec")
    status, _, body, ms = get(f"{DOCS}/perps-client-api/change-log.json")
    versions = json.loads(body)["versions"]
    print(f"   change-log.json status {status}, versions {len(versions)}, first {versions[0]['version']} {versions[0]['releaseDate']}, last {versions[-1]['version']} {versions[-1]['releaseDate']}")
    for v in versions[-3:]:
        for g in v["changeGroups"]:
            for c in g["changes"]:
                print(f"     {v['version']} {v['releaseDate']}: {c['description']}")
    last = versions[-1]["version"]
    status, _, body, ms = get(f"{DOCS}/perps-client-api/rest/{last}/openapi.yaml")
    print(f"   openapi.yaml {last}: status {status}, {len(body)} bytes")
    spec = yaml.safe_load(body)
    print("   info.version", spec["info"]["version"], "servers", [s["url"] for s in spec.get("servers", [])])
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            if isinstance(op, dict) and "responses" in op:
                print(f"     {method.upper()} {path.strip()}: security {op.get('security')}")
    intro = spec["info"]["description"]
    for line in intro.splitlines():
        if re.search(r"(?i)mark price|premium index|time-weighted|variance buffer|cap limits|debit rate|index price is|8 hours|maintenance", line):
            print("     intro:", line.strip()[:300])
    schemas = spec["components"]["schemas"]
    print("   InstrumentFundingHistoryResponse fields", sorted(schemas["InstrumentFundingHistoryResponse"]["properties"]))
    print("   FundingRateWebsocketResponse fields", sorted(schemas["FundingRateWebsocketResponse"]["properties"]))
    print("   ClientInstrumentDefinition fields", sorted(schemas["ClientInstrumentDefinition"]["properties"]))
    print("   tradingBandwidth description", schemas["ClientInstrumentDefinition"]["properties"]["tradingBandwidth"]["description"].strip())
    print("   fundingRatePremiumPercentage description", schemas["ClientInstrumentDefinition"]["properties"]["fundingRatePremiumPercentage"]["description"].strip())
    snap_ts = schemas["ClientMarketDataSnapshotResponse"]["properties"]["timestampMicros"]
    print("   snapshot timestampMicros schema", snap_ts, "resolves to", schemas["Timestamp"])
    words = json.dumps(spec)
    for w in ("markPrice", "indexPrice", "nextFunding", "rateLimit", "X-RateLimit", "Retry-After"):
        print(f"   occurrences of {w!r} in the spec: {words.count(w)}")


def section4():
    print("\n== 4. perpetual futures instrument CSV, LMAX Global MU")
    status, _, body, ms = get("https://assets.lmaxstatic.com/csv/LMAXGlobal-mu-Instruments-Perpetual-Futures.csv")
    rows = list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))
    print(f"   status {status}, rows {len(rows)}, columns {list(rows[0]) if rows else None}")
    print("   symbols", [r["Instrument Name"] for r in rows])
    print("   contract sizes", sorted({r["Contract Size"] for r in rows}), "quoted", sorted({r["Quoted CCY"] for r in rows}), "bandwidth", sorted({r["Trading Bandwidth (%)"] for r in rows}))


def section5():
    print("\n== 5. LMAX Digital spot")
    status, _, body, ms = get("https://assets.lmaxstatic.com/csv/LMAXDigital-Instruments.csv")
    rows = list(csv.DictReader(io.StringIO(body.decode("cp1252"))))  # the file carries Windows-1252 bytes such as 0xA0
    rows = [r for r in rows if (r.get("Instrument Name") or "").strip()]
    quotes = {}
    for r in rows:
        quotes[r["Quoted CCY"]] = quotes.get(r["Quoted CCY"], 0) + 1
    print(f"   LMAXDigital-Instruments.csv status {status}, rows {len(rows)}, by quote currency {quotes}")
    print("   first row", {k.strip(): v for k, v in rows[0].items()})
    base = "https://market-data-api.london-digital.lmax.com"
    show("   Broker Market Data API time", base + "/v1/time")
    show("   Broker Market Data API version", base + "/v1/version")
    show("   Broker Market Data API book for instrument 5004 (BTC/USD)", base + "/v1/marketdata/5004")
    show("   public-data-api root", "https://public-data-api.london-digital.lmax.com/")


def section6():
    print("\n== 6. error shapes, rate limit headers, clock")
    show("   unknown path on the perpetual market data host", MD + "/instrument/v1/nothing-here")
    show("   unknown symbol funding without a token", MD + "/instrument/v1/instruments/NOPE/funding")
    offsets = []
    for _ in range(3):
        t0 = time.time()
        status, h, body, ms = get("https://market-data-api.london-digital.lmax.com/v1/time")
        t1 = time.time()
        offsets.append(round(int(json.loads(body)["epoch_millis"]) - (t0 + t1) * 500))
        time.sleep(1)
    print("   LMAX Digital /v1/time epoch_millis minus host midpoint, ms:", offsets, "(the perpetual API has no time call)")


def section7():
    print("\n== 7. CCXT")
    files = sorted(p.name for p in CCXT_SRC.glob("*.js"))
    print(f"   installed 4.5.68 js/src files: {len(files)}, names containing lmax: {[f for f in files if 'lmax' in f.lower()]}")
    hits = [p.name for p in CCXT_SRC.glob("*.js") if re.search(r"\blmax\b", p.read_text(errors="replace"), re.I)]
    print(f"   files whose text has the word lmax: {hits}")
    status, _, body, ms = get("https://api.github.com/repos/ccxt/ccxt/commits/master")
    if status == 200:
        c = json.loads(body)
        print(f"   ccxt/ccxt master head {c['sha'][:12]} committed {c['commit']['committer']['date']}")
    status, _, body, ms = get("https://api.github.com/repos/ccxt/ccxt/contents/ts/src")
    if status == 200:
        names = [x["name"] for x in json.loads(body) if x["type"] == "file"]
        print(f"   master ts/src files: {len(names)}, names containing lmax: {[n for n in names if 'lmax' in n.lower()]}")
    else:
        print(f"   GitHub contents call status {status}: {body[:200]!r}")


section1()
section2()
section3()
section4()
section5()
section6()
section7()
