# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Tebbit public REST probe for docs/profiles/tebbit/rest.md and fees.md.

Public, unauthenticated and read-only, at most about three requests a second.
Sections, in order:
  hosts    DNS and a TLS handshake for every Tebbit name, then cold and warm time of the time call.
  catalog  the futures catalogs on /fapi and /dapi, the partitions and the spot catalog.
  anchor   the bulk index, mark and agg-ticker calls, three reads each, with coverage and the mark against index and last.
  extref   one read each of XT's and OKX's public index calls, compared with Tebbit's index on shared symbols.
  funding  the per contract funding call on 60 contracts spread over the catalog, and the funding history on 10.
  polls    40 one second polls of the bulk mark and index calls, counting BTC and ETH changes.
  book     the REST book at several levels, level order, update id, and two reads 300 ms apart.
  limits   rate limit headers, error shapes and the server time offset.
Run from the repository root with: uv run scripts/probes/venues/tebbit/rest-probe.py
Captures land in .claude/survey-work/tebbit/.
"""

import concurrent.futures
import gzip
import json
import pathlib
import socket
import ssl
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "tebbit"
WORK.mkdir(parents=True, exist_ok=True)
HOST = "https://tebbit.io"
FAPI = HOST + "/futures/fapi/market"
DAPI = HOST + "/futures/dapi/market"
UA = "arbitrage-observatory-probe/1.0"


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            status, headers = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        status, headers = e.code, dict(e.headers)
    ms = (time.perf_counter() - t0) * 1000
    wire = len(raw)
    if headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    try:
        body = json.loads(raw)
    except ValueError:
        body = raw[:300].decode("utf-8", "replace")
    return status, body, ms, wire, len(raw), headers


def ppm(a, b):
    return (a / b - 1) * 1e6


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def hosts():
    print("== hosts")
    for name in ["tebbit.io", "www.tebbit.io", "tebbit.vip", "www.tebbit.vip", "tebbit.com", "www.tebbit.com"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443, socket.AF_INET)})
        except OSError as e:
            print(f"  {name}: DNS error {e}")
            continue
        try:
            cname = socket.gethostbyname_ex(name)[0]
        except OSError:
            cname = "?"
        ctx = ssl.create_default_context()
        try:
            with socket.create_connection((name, 443), timeout=10) as s:
                with ctx.wrap_socket(s, server_hostname=name) as t:
                    tls = f"TLS ok {t.version()}"
        except Exception as e:  # noqa: BLE001 - the error text is the finding
            tls = f"TLS failed {type(e).__name__}: {e}"
        print(f"  {name}: canonical {cname}, {len(addrs)} IPv4 {addrs[:4]}, {tls}")
    for url in ("http://tebbit.com/", "http://www.tebbit.com/"):
        try:
            st, body, ms, *_ = get(url, timeout=10)
            print(f"  {url}: HTTP {st} in {ms:.0f} ms")
        except Exception as e:  # noqa: BLE001 - the failure is the finding
            print(f"  {url}: failed {type(e).__name__}: {e}")
    times = []
    for i in range(6):
        st, body, ms, *_ = get(FAPI + "/v1/public/time")
        times.append(round(ms))
    print(f"  time call: first {times[0]} ms, then {times[1:]} ms, median of warm {statistics.median(times[1:])} ms")


def catalog():
    print("== catalog")
    st, body, ms, wire, size, _ = get(FAPI + "/v1/public/symbol/list")
    rows = body["data"]
    (WORK / "fapi-symbol-list.json").write_text(json.dumps(rows))
    print(f"  fapi symbol/list: HTTP {st}, {len(rows)} rows, {size} bytes, {wire} on the wire, {ms:.0f} ms")
    kinds = {}
    for r in rows:
        k = (r["contractType"], r["underlyingType"], r["quoteCoin"], r["state"], r["tradeSwitch"])
        kinds[k] = kinds.get(k, 0) + 1
    for k, n in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"    {n} x contractType {k[0]}, underlyingType {k[1]}, quote {k[2]}, state {k[3]}, tradeSwitch {k[4]}")
    perps = [r for r in rows if r["contractType"] == "PERPETUAL"]
    events = [r["symbol"] for r in rows if r["contractType"] != "PERPETUAL"]
    print(f"  non perpetual rows: {events}")
    sizes = {}
    for r in perps:
        sizes[r["contractSize"]] = sizes.get(r["contractSize"], 0) + 1
    print(f"  contractSize values: {dict(sorted(sizes.items(), key=lambda x: -x[1])[:10])}")
    for field in ("takerFee", "makerFee"):
        c = {}
        for r in perps:
            c[r[field]] = c.get(r[field], 0) + 1
        print(f"  perpetual {field}: {c}")
    odd = [(r["symbol"], r["makerFee"], r["takerFee"]) for r in perps if r["takerFee"] != "0.0004"]
    print(f"  perpetuals whose taker is not 0.0004: {odd}")
    zero_maker = [r["symbol"] for r in perps if r["makerFee"] == "0"]
    print(f"  perpetuals with maker 0: {len(zero_maker)}, first {zero_maker[:8]}")
    bases = {}
    for r in perps:
        bases.setdefault(r["baseCoin"], []).append(r["symbol"])
    print(f"  base coins listed twice: {[v for v in bases.values() if len(v) > 1]}")
    upper = [r["symbol"] for r in perps if r["symbol"] != r["symbol"].lower()]
    print(f"  symbols not lower case: {upper}")
    non_ascii = [r["symbol"] for r in perps if not r["symbol"].isascii()]
    print(f"  symbols with non ASCII characters: {len(non_ascii)}, {non_ascii}")
    st, prt, *_ = get(FAPI + "/v1/public/symbol/partition")
    names = {p["id"]: p["nameEn"] for p in prt["data"]}
    counts = {}
    for r in perps:
        for pid in r.get("partitionId") or []:
            counts[names.get(pid, pid)] = counts.get(names.get(pid, pid), 0) + 1
    print(f"  partitions: {names}")
    print(f"  perpetuals per partition: {counts}")
    st, body, ms, *_ = get(DAPI + "/v1/public/symbol/list")
    print(f"  dapi symbol/list: HTTP {st}, body {json.dumps(body)[:120]}")
    st, body, ms, *_ = get(HOST + "/pro/p/symbol/list")
    spot = body["data"]
    print(f"  spot /pro/p/symbol/list: HTTP {st}, {len(spot)} pairs, quotes {sorted({s['buyCoin'] for s in spot})}, takerFee values {sorted({s['takerFee'] for s in spot})}")
    return perps


def anchor(perps):
    print("== anchor")
    live = {r["symbol"] for r in perps}
    last = {}
    arrived = {}
    for name in ("index-price", "mark-price", "agg-tickers"):
        reads = []
        for _ in range(3):
            st, body, ms, wire, size, _ = get(FAPI + "/v1/public/q/" + name)
            reads.append((ms, wire, size, body, time.time() * 1000))
            time.sleep(0.4)
        rows = reads[-1][3]["data"]
        last[name] = rows
        arrived[name] = reads[-1][4]
        syms = {r["s"] for r in rows}
        print(f"  q/{name}: {len(rows)} rows, {reads[-1][2]} bytes, {reads[-1][1]} on the wire, times {[round(r[0]) for r in reads]} ms, missing perpetuals {sorted(live - syms)[:10]}, extra {sorted(syms - live)[:10]}")
    (WORK / "anchor-last.json").write_text(json.dumps(last))
    for name in ("index-price", "mark-price"):
        ages = sorted((arrived[name] - r["t"]) / 1000 for r in last[name] if r["s"] in live)
        print(f"  {name} age on arrival, local clock: median {statistics.median(ages):.1f} s, max {ages[-1]:.1f} s, rows older than 60 s {sum(a > 60 for a in ages)}")
    agg = {r["s"]: r for r in last["agg-tickers"] if r["s"] in live}
    eq_im = sum(r["i"] == r["m"] for r in agg.values())
    eq_mc = sum(r["m"] == r["c"] for r in agg.values())
    eq_ic = sum(r["i"] == r["c"] for r in agg.values())
    inside = sum(float(r["bp"]) <= float(r["m"]) <= float(r["ap"]) for r in agg.values() if r.get("bp") and r.get("ap"))
    dev = [abs(ppm(float(r["m"]), float(r["i"]))) for r in agg.values() if float(r["i"]) > 0]
    print(f"  agg-tickers on {len(agg)} perpetuals: index equals mark {eq_im}, mark equals last {eq_mc}, index equals last {eq_ic}, mark inside own bid and ask {inside}")
    sizes = {r["symbol"]: float(r["contractSize"]) for r in perps}
    ratios = [float(r["v"]) / (float(r["a"]) * sizes[s] * float(r["c"])) for s, r in agg.items() if float(r["a"]) > 0 and float(r["c"]) > 0]
    near = sum(0.8 <= x <= 1.25 for x in ratios)
    b = agg["btc_usdt"]
    print(f"  turnover v over a times contractSize times last: median {statistics.median(ratios):.3f}, within 0.8 to 1.25 on {near} of {len(ratios)}, btc a {b['a']} v {b['v']} c {b['c']}")
    print(f"  abs(mark/index - 1): median {statistics.median(dev):.0f} ppm, p90 {pct(dev, 0.9):.0f}, max {max(dev):.0f}")
    big = sorted(((ppm(float(r['m']), float(r['i'])), s) for s, r in agg.items() if float(r["i"]) > 0), key=lambda x: -abs(x[0]))[:5]
    print(f"  largest mark against index: {[(s, round(d)) for d, s in big]}")
    idx = {r["s"]: r for r in last["index-price"]}
    mrk = {r["s"]: r for r in last["mark-price"]}
    same = sum(1 for s in live if s in idx and s in mrk and idx[s]["p"] == mrk[s]["p"])
    print(f"  index-price p equals mark-price p on {same} of {len(live)} perpetuals")
    for s in ("btc_usdt", "eth_usdt", "sol_usdt", "xau_usdt", "tsla_usdt"):
        if s in agg:
            r = agg[s]
            print(f"    {s}: last {r['c']}, index {r['i']}, mark {r['m']}, bid {r['bp']}, ask {r['ap']}, index call {idx.get(s, {}).get('p')}, mark call {mrk.get(s, {}).get('p')}")
    return idx


def extref(idx):
    print("== extref")
    st, body, ms, *_ = get("https://fapi.xt.com/future/market/v1/public/q/index-price")
    rows = body.get("result") or body.get("data") or []
    xt = {r["s"]: float(r["p"]) for r in rows}
    st2, idx2, *_ = get(FAPI + "/v1/public/q/index-price")
    tb = {r["s"]: float(r["p"]) for r in idx2["data"]}
    shared = [s for s in tb if s in xt and xt[s] > 0]
    d = [abs(ppm(tb[s], xt[s])) for s in shared]
    print(f"  XT q/index-price HTTP {st}, {len(xt)} rows, shared symbols {len(shared)}")
    print(f"  abs(Tebbit index / XT index - 1): median {statistics.median(d):.0f} ppm, p90 {pct(d, 0.9):.0f}, over 1 % {sum(x > 10000 for x in d)}")
    for s in ("btc_usdt", "eth_usdt", "sol_usdt", "xrp_usdt", "doge_usdt"):
        if s in shared:
            print(f"    {s}: Tebbit {tb[s]}, XT {xt[s]}, {ppm(tb[s], xt[s]):.0f} ppm")


def okx_ref():
    try:
        st, body, *_ = get("https://www.okx.com/api/v5/market/index-tickers?quoteCcy=USDT")
        okx = {r["instId"].split("-")[0].lower() + "_usdt": float(r["idxPx"]) for r in body["data"]}
    except Exception as e:  # noqa: BLE001
        print(f"  OKX index-tickers failed: {e}")
        return
    st2, idx2, *_ = get(FAPI + "/v1/public/q/index-price")
    tb = {r["s"]: float(r["p"]) for r in idx2["data"]}
    shared = [s for s in tb if s in okx and okx[s] > 0]
    d = [ppm(tb[s], okx[s]) for s in shared]
    print(f"  OKX index-tickers HTTP {st}, shared symbols {len(shared)}, Tebbit over OKX: median {statistics.median(d):.0f} ppm, median of abs {statistics.median([abs(x) for x in d]):.0f}, p90 of abs {pct([abs(x) for x in d], 0.9):.0f}")
    for s in ("btc_usdt", "eth_usdt", "sol_usdt", "xrp_usdt", "doge_usdt"):
        if s in shared:
            print(f"    {s}: Tebbit {tb[s]}, OKX {okx[s]}, {ppm(tb[s], okx[s]):.0f} ppm")


def funding(perps):
    print("== funding")
    step = max(1, len(perps) // 60)
    sample = [r["symbol"] for r in perps[::step]][:60]
    seen = {}
    for s in sample:
        st, body, *_ = get(FAPI + "/v1/public/q/funding-rate?symbol=" + urllib.parse.quote(s))
        d = body.get("data") or {}
        key = (st, body.get("code"), d.get("fundingRate"), d.get("collectionInterval"), d.get("nextCollectionTime"))
        seen[key] = seen.get(key, 0) + 1
        time.sleep(0.34)
    print(f"  q/funding-rate on {len(sample)} contracts, (status, code, fundingRate, collectionInterval, nextCollectionTime): {seen}")
    st, body, *_ = get(FAPI + "/v1/public/q/funding-rate")
    print(f"  q/funding-rate without symbol: HTTP {st}, {json.dumps(body)}")
    hist = {}
    for s in sample[:10]:
        st, body, *_ = get(FAPI + "/v1/public/q/funding-rate-record?symbol=" + urllib.parse.quote(s))
        n = len((body.get("data") or {}).get("items") or [])
        hist[n] = hist.get(n, 0) + 1
        time.sleep(0.34)
    print(f"  q/funding-rate-record on 10 contracts, item counts: {hist}")
    st, body, *_ = get(HOST + "/futures/fapi/user/v1/balance/funding-rate-list")
    print(f"  private balance/funding-rate-list without a token: HTTP {st}, {json.dumps(body)[:160]}")


def polls():
    print("== polls")
    pool = concurrent.futures.ThreadPoolExecutor(2)
    hist = {("index", "btc_usdt"): [], ("index", "eth_usdt"): [], ("mark", "btc_usdt"): [], ("mark", "eth_usdt"): []}
    times = {"index": [], "mark": []}
    for _ in range(40):
        t0 = time.time()
        fi = pool.submit(get, FAPI + "/v1/public/q/index-price")
        fm = pool.submit(get, FAPI + "/v1/public/q/mark-price")
        for name, f in (("index", fi), ("mark", fm)):
            st, body, ms, *_ = f.result()
            times[name].append(ms)
            rows = {r["s"]: r for r in body["data"]}
            for s in ("btc_usdt", "eth_usdt"):
                hist[(name, s)].append((rows[s]["p"], rows[s]["t"]))
        time.sleep(max(0, 1 - (time.time() - t0)))
    for name in times:
        print(f"  {name} call over 40 polls: median {statistics.median(times[name]):.0f} ms, p90 {pct(times[name], 0.9):.0f}, max {max(times[name]):.0f}")
    for (name, s), seq in hist.items():
        pch = sum(seq[i][0] != seq[i - 1][0] for i in range(1, len(seq)))
        tch = sum(seq[i][1] != seq[i - 1][1] for i in range(1, len(seq)))
        print(f"  {name} {s}: value changed on {pch} of 39 polls, stamp changed on {tch}")


def book():
    print("== book")
    for level in (5, 20, 50, 100, 500, 1000):
        st, body, ms, wire, size, _ = get(f"{FAPI}/v1/public/q/depth?symbol=btc_usdt&level={level}")
        d = body.get("data") if isinstance(body, dict) else None
        if isinstance(d, dict):
            b, a = d["b"], d["a"]
            bdesc = all(float(b[i][0]) > float(b[i + 1][0]) for i in range(len(b) - 1))
            aasc = all(float(a[i][0]) < float(a[i + 1][0]) for i in range(len(a) - 1))
            print(f"  level {level}: HTTP {st}, {len(b)} bids descending {bdesc}, {len(a)} asks ascending {aasc}, u {d['u']}, {size} bytes, {ms:.0f} ms, first bid {b[0]}, first ask {a[0]}")
        else:
            print(f"  level {level}: HTTP {st}, {json.dumps(body)[:120]}")
        time.sleep(0.34)
    st, b1, *_ = get(f"{FAPI}/v1/public/q/depth?symbol=btc_usdt&level=50")
    time.sleep(0.3)
    st, b2, *_ = get(f"{FAPI}/v1/public/q/depth?symbol=btc_usdt&level=50")
    print(f"  two reads 300 ms apart: u {b1['data']['u']} then {b2['data']['u']}, t {b1['data']['t']} then {b2['data']['t']}, books equal {b1['data']['b'] == b2['data']['b'] and b1['data']['a'] == b2['data']['a']}")
    sci = sum("E" in x[1] for x in b1["data"]["b"] + b1["data"]["a"])
    print(f"  sizes in E notation on the REST book: {sci} of {len(b1['data']['b']) + len(b1['data']['a'])}")
    st, body, *_ = get(f"{FAPI}/v1/public/q/depth?symbol=nope_usdt&level=50")
    print(f"  unknown symbol: HTTP {st}, {json.dumps(body)[:160]}")
    st, body, *_ = get(f"{FAPI}/v1/public/q/depth?symbol=BTC_USDT&level=50")
    print(f"  upper case symbol: HTTP {st}, {json.dumps(body)[:160]}")


def limits():
    print("== limits")
    st, body, ms, wire, size, h = get(FAPI + "/v1/public/time")
    print(f"  headers: { {k: v for k, v in h.items() if 'rate' in k.lower() or 'retry' in k.lower()} }")
    st, body, *_ = get(FAPI + "/v1/public/q/nonexistent")
    print(f"  unknown path under /market: HTTP {st}, {json.dumps(body)[:200]}")
    st, body, *_ = get(HOST + "/futures/fapi/v1/public/symbol/list")
    print(f"  unknown path under /futures: HTTP {st}, {json.dumps(body)[:200]}")
    st, body, *_ = get(HOST + "/fapi/v1/public/symbol/list")
    print(f"  unknown path at the root: HTTP {st}, {str(body)[:60]}")
    offs = []
    for _ in range(5):
        t0 = time.time() * 1000
        st, body, ms, *_ = get(FAPI + "/v1/public/time")
        t1 = time.time() * 1000
        offs.append(body["data"] - (t0 + t1) / 2)
        time.sleep(0.4)
    print(f"  server time minus local midpoint: {[round(o) for o in offs]} ms, median {statistics.median(offs):.0f} ms")


def main():
    print(f"tebbit rest probe at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    hosts()
    perps = catalog()
    idx = anchor(perps)
    extref(idx)
    okx_ref()
    funding(perps)
    polls()
    book()
    limits()


if __name__ == "__main__":
    main()
