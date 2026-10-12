# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""BitGW public REST probe for docs/profiles/bitgw/rest.md.

Public, unauthenticated and read-only, at most about two requests a second to BitGW and a handful to OKX.
BitGW publishes no API documentation, so every call here is one its own web app makes for an anonymous visitor.
The app signs every POST with an md5 over the sorted form fields and a client key shipped in its public bundle.
Sections, in order:
  hosts    DNS, a TLS handshake, cold and warm time of the catalog call, and the response headers.
  catalog  the marketInit catalog: count, quote assets, duplicates, and every field name.
  anchor   every field name in the catalog and market detail replies, searched for index, mark and funding.
  book     the market detail book for three markets, then OKX's public spot book and trades for the same pairs.
  match    BitGW's last price for every market against OKX's public spot tickers.
  limits   twenty catalog calls at two a second, error shapes, the GET reply, and the clock offset.
Run from the repository root with: uv run scripts/probes/venues/bitgw/rest-probe.py
Captures land in .claude/survey-work/bitgw/.
"""

import email.utils
import hashlib
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
WORK = ROOT / ".claude" / "survey-work" / "bitgw"
WORK.mkdir(parents=True, exist_ok=True)
API = "https://bitgw.com/api/"
OKX = "https://www.okx.com/api/v5/market/"
CLIENT_KEY = "BCAB2AE64900D83EAC3114768232F868"  # globalData.key in the public web bundle
UA = "arbitrage-observatory-probe/1.0"


def norm(v):
    return str(v).replace(" ", "").replace("\r", "").replace("\n", "").lower()


def signed(params, controller):
    p = dict(params)
    p.update(language=0, platform="H5", system_language="en", version="2.1.2",
             timestamp=int(time.time() * 1000), url=controller)
    base = "&".join(f"{norm(k)}={norm(p[k])}" for k in sorted(p)) + "&key=" + CLIENT_KEY
    p["sign"] = hashlib.md5(norm(base).encode()).hexdigest()
    return p


def post(controller, form, method="POST"):
    data = urllib.parse.urlencode(form).encode() if method == "POST" else None
    req = urllib.request.Request(API + controller, data=data, method=method, headers={
        "content-type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": UA})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw, status, headers = r.read(), r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw, status, headers = e.read(), e.code, dict(e.headers)
    return status, raw, headers, (time.perf_counter() - t0) * 1000


def call(controller, params):
    status, raw, headers, ms = post(controller, signed(params, controller))
    try:
        body = json.loads(raw)
    except ValueError:
        body = raw[:300]
    return status, body, headers, ms, len(raw)


def okx(path):
    req = urllib.request.Request(OKX + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())["data"]


def hosts():
    print("== hosts")
    for h in ["bitgw.com", "www.bitgw.com", "static.bitgw.com"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [repr(e)]
        print(f"{h}: {addrs}")
    ctx = ssl.create_default_context()
    t0 = time.perf_counter()
    with socket.create_connection(("bitgw.com", 443), timeout=10) as s:
        t1 = time.perf_counter()
        with ctx.wrap_socket(s, server_hostname="bitgw.com") as tls:
            t2 = time.perf_counter()
            print(f"bitgw.com:443 peer={tls.getpeername()[0]} tcp_ms={(t1 - t0) * 1000:.0f} tls_ms={(t2 - t1) * 1000:.0f} {tls.version()}")
    times = []
    for i in range(6):
        status, body, headers, ms, size = call("home", {"type": "marketInit"})
        times.append(ms)
        if i == 0:
            print(f"marketInit cold status={status} code={body.get('code')} bytes={size} ms={ms:.0f}")
            print("headers:", {k: v for k, v in headers.items() if k.lower() in (
                "server", "cf-ray", "cf-cache-status", "content-type", "content-encoding", "cache-control",
                "x-ratelimit-limit", "x-ratelimit-remaining", "retry-after", "access-control-allow-origin")})
            print("rate limit headers:", [k for k in headers if "limit" in k.lower() or "retry" in k.lower()] or "none")
        time.sleep(0.6)
    print(f"marketInit warm ms: median={statistics.median(times[1:]):.0f} min={min(times[1:]):.0f} max={max(times[1:]):.0f}")


def catalog():
    print("== catalog")
    status, body, _, ms, size = call("home", {"type": "marketInit"})
    rows = body["data"]
    (WORK / "marketInit.json").write_text(json.dumps(body, indent=1))
    keys = [r["key"] for r in rows]
    quotes = {}
    for k in keys:
        quotes[k.split("-")[1]] = quotes.get(k.split("-")[1], 0) + 1
    print(f"marketInit status={status} bytes={size} ms={ms:.0f} markets={len(rows)} quotes={quotes}")
    print(f"duplicate keys: {len(keys) - len(set(keys))}, duplicate bases: {len(rows) - len({r['currency'] for r in rows})}")
    print("fields:", sorted(rows[0].keys()))
    print("first row:", json.dumps(rows[0]))
    stable = [k for k in keys if k.split("-")[0] in ("USDC", "USDG", "PYUSD", "STETH", "JITOSOL", "PAXG", "LEO")]
    print("pegged or wrapped bases listed:", stable)
    return rows


def anchor(rows):
    print("== anchor")
    status, body, _, _, _ = call("home", {"type": "marketDetail", "id": rows[0]["id"]})
    d = body["data"]
    names = set(rows[0].keys()) | set(d.keys()) | set(d["currency"].keys()) | set(d["books"].keys())
    print(f"all field names ({len(names)}):", sorted(names))
    hits = [n for n in names if any(w in n.lower() for w in ("index", "mark", "fund", "settle", "premium", "basis"))]
    print("index, mark or funding fields:", hits or "none")


def book(rows):
    print("== book")
    ids = {r["key"]: r["id"] for r in rows}
    for key in ["BTC-USDT", "ETH-USDT", "SOL-USDT"]:
        status, body, _, ms, size = call("home", {"type": "marketDetail", "id": ids[key]})
        b = body["data"]["books"]
        (WORK / f"book-{key}.json").write_text(json.dumps(b))
        ok = okx(f"books?instId={key}&sz=5")[0]
        asks, bids = b["asks"], b["bids"]
        print(f"{key} status={status} bytes={size} ms={ms:.0f} asks={len(asks)} bids={len(bids)} "
              f"level_shape={len(asks[0])} instId={b.get('instId')} ts={b.get('ts')} seqId={b.get('seqId')}")
        print(f"  ask order ascending={all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1))} "
              f"bid order descending={all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1))}")
        print(f"  bitgw best bid {bids[0][:2]} ask {asks[0][:2]} at ts {b.get('ts')}")
        print(f"  okx   best bid {ok['bids'][0][:2]} ask {ok['asks'][0][:2]} at ts {ok['ts']}, age gap ms={int(ok['ts']) - int(b.get('ts', 0))}")
        same_px = sum(1 for lv in asks if lv[0] in {x[0] for x in ok["asks"]}) + sum(1 for lv in bids if lv[0] in {x[0] for x in ok["bids"]})
        print(f"  bitgw levels whose price is also an okx level: {same_px} of {len(asks) + len(bids)}")
        time.sleep(1.0)
    status, body, _, ms, size = call("home", {"id": ids["BTC-USDT"], "key": "BTC-USDT", "k_type": "1m", "type": "k"})
    trades = body["data"].get("trade", [])
    ok_trades = okx("trades?instId=BTC-USDT&limit=100")
    ok_ids = {t["tradeId"] for t in ok_trades}
    bit_ids = [t.get("tradeId") for t in trades]
    print(f"k call status={status} bytes={size} candles={len(body['data'].get('data', []))} trades={len(trades)} trade_fields={sorted(trades[0].keys()) if trades else None}")
    print(f"BitGW trade ids also in OKX's last 100 BTC-USDT trades: {sum(1 for i in bit_ids if i in ok_ids)} of {len(bit_ids)}")
    if trades:
        print("first BitGW trade:", json.dumps(trades[0]))
        hit = next((t for t in ok_trades if t["tradeId"] == trades[0].get("tradeId")), None)
        print("same id on OKX:   ", json.dumps(hit))


def match(rows):
    print("== match")
    status, body, _, _, _ = call("home", {"type": "marketInit"})
    tick = {t["instId"]: t for t in okx("tickers?instType=SPOT")}
    eq = near = missing = 0
    worst = []
    for r in body["data"]:
        t = tick.get(r["key"])
        if not t:
            missing += 1
            worst.append((r["key"], "absent on OKX"))
            continue
        a, b = float(r["last"]), float(t["last"])
        if a == b:
            eq += 1
        elif abs(a - b) / b < 0.001:
            near += 1
        else:
            worst.append((r["key"], f"bitgw {r['last']} okx {t['last']} diff {abs(a - b) / b * 100:.2f} %"))
    print(f"markets={len(body['data'])} last equal to OKX last={eq} within 0.1 %={near} other={len(worst) - missing} absent on OKX={missing}")
    for w in worst:
        print("  ", w)
    same_open = sum(1 for r in body["data"] if r["key"] in tick and r["sodUtc0"] == tick[r["key"]]["sodUtc0"])
    print(f"sodUtc0 equal to OKX sodUtc0 on {same_open} markets")


def limits():
    print("== limits")
    codes, remaining = {}, []
    for _ in range(20):
        status, body, headers, ms, _ = call("home", {"type": "marketInit"})
        remaining.append(headers.get("x-ratelimit-remaining"))
        codes[(status, body.get("code") if isinstance(body, dict) else None)] = codes.get((status, body.get("code") if isinstance(body, dict) else None), 0) + 1
        time.sleep(0.5)
    print("20 catalog calls at 2 per second, (http, code) counts:", codes)
    print("x-ratelimit-remaining over those calls:", remaining)
    form = signed({"type": "marketInit"}, "home")
    form["sign"] = "0" * 32
    for label, args in [("bad sign", ("home", form)),
                        ("no sign", ("home", {"type": "marketInit"})),
                        ("unknown type", ("home", signed({"type": "nosuch"}, "home"))),
                        ("unknown market id", ("home", signed({"type": "marketDetail", "id": 999999}, "home"))),
                        ("unknown controller", ("nosuch", signed({"type": "marketInit"}, "nosuch")))]:
        status, raw, headers, ms = post(*args)
        print(f"{label}: http={status} body={raw[:200]!r}")
        time.sleep(0.5)
    status, raw, headers, ms = post("home", {}, method="GET")
    print(f"GET /api/home: http={status} allow={headers.get('allow') or headers.get('Allow')} type={headers.get('content-type') or headers.get('Content-Type')}")
    offsets = []
    for _ in range(3):
        t0 = time.time()
        status, raw, headers, ms = post("home", signed({"type": "more"}, "home"))
        t1 = time.time()
        server = email.utils.parsedate_to_datetime(headers.get("date") or headers.get("Date")).timestamp()
        offsets.append(server - (t0 + t1) / 2)
        time.sleep(0.5)
    print(f"Date header offsets s (1 s resolution): {[round(o, 2) for o in offsets]}")


if __name__ == "__main__":
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    hosts()
    rows = catalog()
    anchor(rows)
    book(rows)
    match(rows)
    limits()
