# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""SuperEx public REST probe, read-only and unauthenticated.

SuperEx documents only its Free Market spot zone, at https://docs-api.superex.com/en/quickStart.html, under the REST base https://api.superexchang.com/api.
Every perpetual and main spot path here comes from the web app bundle served at https://www.superex.live, whose config names https://api.superexchang.com as its API base.
The web app sends the headers token (empty when signed out), timestamp, client=1 and nonce on every call, and so does this probe.

Run from the repository root: uv run scripts/probes/venues/superex/rest-probe.py
"""

import collections
import email.utils
import json
import re
import socket
import time
import urllib.error
import urllib.request
import uuid

API = "https://api.superexchang.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"


def web_headers():
    return {
        "token": "",
        "timestamp": str(int(time.time() * 1000)),
        "client": "1",
        "nonce": uuid.uuid4().hex,
        "Accept-Language": "en",
        "User-Agent": UA,
    }


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers if headers is not None else {"User-Agent": UA})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            status, hdrs = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read()
        status, hdrs = e.code, dict(e.headers)
    ms = (time.perf_counter() - t0) * 1000
    return status, hdrs, body, ms


def api(path):
    return get(API + path, web_headers())


def short(body, n=240):
    return body[:n].decode("utf-8", "replace").replace("\n", " ").replace("\t", "")


def section(title):
    print(f"\n=== {title}")


def main():
    section("Published API documentation, docs-api.superex.com")

    for path in ["/en/quickStart.html", "/en/Market.html", "/en/spots.html", "/en/websocket.html"]:
        st, h, b, ms = get("https://docs-api.superex.com" + path)
        text = b.decode("utf-8", "replace")
        title = re.search(r"<title>([^<]*)</title>", text)
        words = {w: len(re.findall(w, text, re.I)) for w in ["swap", "perpetual", "contract", "futures", "freeSpot|free-spot"]}
        print(f"{path} status={st} title={title.group(1) if title else None!r} word counts={words}")
    for path in ["/api/common/v3/public/timestamp", "/api/swap/front/swap"]:
        st, h, b, ms = get(API + path)
        print(f"documented base {path} status={st} body={short(b, 120)!r}")
    st, h, b, ms = get(API + "/api/common/v3/public/timestamp")
    local = time.time() * 1000
    print(f"server time offset, local minus server: {local - ms / 2 - json.loads(b)['data']:.0f} ms (request took {ms:.0f} ms)")

    section("DNS from this host")
    for host in ["api.superexchang.com", "www.superex.com", "www.superex.live", "api.superex.com"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [f"unresolved ({e})"]
        print(f"{host}: {addrs}")

    section("Site access from this exit")
    for url in ["https://www.superex.com/", "https://www.superex.live/", "https://www.superex.live/en/apiKeyHome", "https://api.superex.com/"]:
        st, h, b, ms = get(url)
        text = b.decode("utf-8", "replace")
        blocked = "not allowed in your local area network" in text
        print(f"{url} status={st} bytes={len(b)} regionBlockPage={blocked} body={short(b, 120)!r}")

    section("Header requirement: /swap/front/swap without the web headers")
    st, h, b, ms = get(API + "/swap/front/swap")
    print(f"status={st} body={short(b)!r}")

    section("Perpetual catalog GET /swap/front/swap, cold then warm")
    times = []
    for i in range(4):
        st, h, b, ms = api("/swap/front/swap")
        times.append(round(ms))
        if i == 0:
            cat = json.loads(b)
            print(f"status={st} bytes={len(b)} code={cat.get('code')} content-encoding={h.get('Content-Encoding')}")
            server_date, local_at_reply = h.get("Date"), time.time()
        time.sleep(1)
    print(f"request ms, cold then warm: {times}")
    rows = cat["data"]
    print(f"contracts={len(rows)}")
    for key in ["state", "settlementCurrency", "quoteCurrency", "isDelisting", "contractSize", "ratio", "minVolume"]:
        print(f"  by {key}: {dict(collections.Counter(r[key] for r in rows))}")
    bases = collections.Counter(r["baseCurrency"] for r in rows)
    print(f"  base listed twice: {[b for b, c in bases.items() if c > 1]}")
    print(f"  contractSize 100: {[r['symbol'] for r in rows if r['contractSize'] == 100]}")
    print(f"  symbols: {' '.join(sorted(r['symbol'] for r in rows))}")
    print(f"  first row: {json.dumps(rows[0])}")

    section("Clock offset from the Date header of the catalog reply")
    if server_date:
        srv = email.utils.parsedate_to_datetime(server_date).timestamp()
        print(f"server Date={server_date} local-minus-server={local_at_reply - srv:.1f} s (the header has 1 s resolution)")

    section("Spot catalog GET /spot/spot/symbol/config/rules")
    st, h, b, ms = api("/spot/spot/symbol/config/rules")
    d = json.loads(b)["data"]
    print(f"default page: status={st} items={len(d['items'])} total={d['total']}")
    st, h, b, ms = api("/spot/spot/symbol/config/rules?pageNum=1&pageSize=3000")
    d = json.loads(b)["data"]
    items = d["items"]
    print(f"pageSize=3000: items={len(items)} total={d['total']} by state={dict(collections.Counter(i['state'] for i in items))}")

    section("Fee schedule GET /spot/spot/vip/level/configs")
    st, h, b, ms = api("/spot/spot/vip/level/configs")
    for r in json.loads(b)["data"]:
        print(
            f"VIP{r['level']} platform={r['platform']} spotBtc={r['spotBtc']} swapBtc={r['swapBtc']} "
            f"spotMaker={r['spotMaker']} spotTaker={r['spotTaker']} spotDiscount={r['spotMakerDiscount']}/{r['spotTakerDiscount']} "
            f"swapFrontMaker={r['swapFrontMaker']} swapFrontTaker={r['swapFrontTaker']} "
            f"swapFrontDiscount={r['swapFrontMakerDiscount']}/{r['swapFrontTakerDiscount']} "
            f"swapReverse={r['swapReverseMaker']}/{r['swapReverseTaker']}"
        )

    section("Funding calls")
    for path in [
        "/swap/swap/information/funds-rate?symbol=btc_usdt",
        "/swap/calc/public/posit-calculi",
    ]:
        st, h, b, ms = api(path)
        print(f"{path} status={st} server={h.get('Server')} body={short(b, 200)!r}")
    st, h, b, ms = api("/swap/swap/information/funds-rate-page?symbol=btc_usdt&pageNum=1&pageSize=10")
    hist = json.loads(b)["data"]
    print(f"funds-rate-page btc_usdt status={st} bytes={len(b)} ms={ms:.0f} keys={list(hist)}")
    for it in hist["items"][:6]:
        ts = time.strftime("%Y-%m-%d %H:%M", time.gmtime(it["createTime"] / 1000))
        print(f"  {ts} UTC fundingTime={it['fundingTime']} fundsRate={it['fundsRate']}")
    st, h, b, ms = api("/swap/swap/information/funds-rate-page?symbol=nope_usdt&pageNum=1&pageSize=10")
    print(f"unknown symbol: status={st} body={short(b, 200)!r}")

    section("Error shapes")
    for path in ["/swap/no/such/path", "/swap/v3/user/symbol/config"]:
        st, h, b, ms = api(path)
        print(f"{path} status={st} body={short(b, 200)!r}")

    section("Rate limit headers on the catalog reply")
    st, h, b, ms = api("/swap/front/swap")
    print({k: v for k, v in h.items() if "limit" in k.lower() or "retry" in k.lower()} or "none")

    section("Region flags GET /user/config/areas")
    st, h, b, ms = api("/user/config/areas")
    areas = json.loads(b)["data"]
    ca = [a for a in areas if a["countriesAndRegions"] == "CA"][0]
    print(f"areas={len(areas)} CA={ {k: ca[k] for k in ('allowedAuth', 'allowedLogin', 'allowedRegister', 'areaStatus')} }")
    print(f"allowedRegister=0: {[a['countriesAndRegions'] for a in areas if a['allowedRegister'] == 0]}")
    print(f"allowedAuth=0: {[a['countriesAndRegions'] for a in areas if a['allowedAuth'] == 0]}")


if __name__ == "__main__":
    main()
