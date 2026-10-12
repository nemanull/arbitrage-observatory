# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""BitGW surface probe for docs/profiles/bitgw/fees.md, rest.md and websocket.md.

Public, unauthenticated and read-only, at most about two requests a second.
Sections, in order:
  site     the home page and the hosts the web app names, with status codes.
  bundle   the web app bundle and its page chunks: API host, socket URL, request controllers, page routes, and every derivative word.
  ccxt     whether CCXT 4.5.68 here, or CCXT master on GitHub, has a BitGW class.
  gecko    whether CoinGecko's derivatives exchange list names BitGW.
Run from the repository root with: uv run scripts/probes/venues/bitgw/endpoints-probe.py
Captures land in .claude/survey-work/bitgw/.
"""

import json
import pathlib
import re
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "bitgw"
BUNDLE = WORK / "bundle"
BUNDLE.mkdir(parents=True, exist_ok=True)
UA = "arbitrage-observatory-probe/1.0"
CCXT_LOCAL = ROOT / "node_modules" / ".pnpm" / "ccxt@4.5.68" / "node_modules" / "ccxt" / "js" / "src"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.perf_counter() - t0
    except Exception as e:  # DNS failure, refused, timeout
        return None, repr(e).encode(), time.perf_counter() - t0


def site():
    print("== site")
    for url in ["https://www.bitgw.com/", "https://bitgw.com/", "https://bitgw.com/api/home",
                "https://static.bitgw.com/", "https://api.bitgw.com/", "https://bitgw.io/"]:
        status, body, dt = get(url, timeout=15)
        title = re.search(rb"<title>([^<]*)</title>", body or b"")
        print(f"{url} status={status} bytes={len(body)} ms={dt * 1000:.0f} title={title.group(1).decode() if title else ''}"
              + (f" body={body[:120]!r}" if status != 200 else ""))
        time.sleep(0.5)


def bundle():
    print("== bundle")
    status, home, _ = get("https://www.bitgw.com/")
    main = re.search(rb'src="(/assets/index-[^"]+\.js)"', home).group(1).decode()
    status, js, _ = get("https://www.bitgw.com" + main)
    (BUNDLE / "index.js").write_bytes(js)
    print(f"main chunk {main} status={status} bytes={len(js)}")
    text = js.decode(errors="replace")
    gd = re.search(r'globalData:\{url:"([^"]+)",host:"([^"]+)",img_host:"([^"]+)",key:"([^"]+)"[^}]*?version:"([^"]+)"', text)
    print(f"globalData url={gd.group(1)} host={gd.group(2)} key_present={bool(gd.group(4))} version={gd.group(5)}")
    ws = re.search(r'this\.url="(wss://[^"]+)".{0,400}?heartbeatInterval=(\w+),this\.heartbeatTimeoutDuration=(\w+)', text)
    print(f"socket url={ws.group(1)} heartbeatInterval={ws.group(2)} heartbeatTimeout={ws.group(3)}")
    print("request wrapper is POST form data signed with md5:", 's="POST"' in text and "Ry={sign:" in text)
    chunks = sorted(set(re.findall(r"assets/[A-Za-z0-9_.-]+\.js", text)))
    controllers, types, routes = {}, set(), set()
    deriv = {}
    words = re.compile(r"perpetual|futures|contract|leverage|funding|liquidat|margin.?trad|\bswap\b", re.I)  # bare "margin" is CSS
    for c in chunks:
        s, b, _ = get("https://www.bitgw.com/" + c)
        (BUNDLE / pathlib.Path(c).name).write_bytes(b)
        t = b.decode(errors="replace")
        for m in re.finditer(r'\.ajax\("([A-Za-z]+)"', t):
            controllers[m.group(1)] = controllers.get(m.group(1), 0) + 1
        types.update(re.findall(r'\.ajax\("home",\{type:"([A-Za-z]+)"', t))
        types.update(re.findall(r'type:"([A-Za-z]+)"', t))
        routes.update(re.findall(r'"(/pages/[A-Za-z]+/[A-Za-z]+)', t))
        for m in words.finditer(t):
            deriv.setdefault(m.group(0).lower(), set()).add(pathlib.Path(c).name)
        time.sleep(0.3)
    for m in words.finditer(text):
        deriv.setdefault(m.group(0).lower(), set()).add("index.js")
    print(f"page chunks fetched: {len(chunks)}")
    print("controllers:", json.dumps(dict(sorted(controllers.items()))))
    print("page routes:", " ".join(sorted(routes)))
    print("type values:", " ".join(sorted(types)))
    print("derivative words by chunk:", json.dumps({k: sorted(v) for k, v in sorted(deriv.items())}))
    tab = re.search(r'"tarbar\.item3":"([^"]+)"', text)
    print(f"English bottom tab 3 label: {tab.group(1) if tab else None}, the tab bar routes it to /pages/exchange/exchange")
    route_hits = [r for r in routes if re.search(r"contract|future|swap|perp|deriv", r, re.I)]
    print("derivative page routes:", route_hits or "none")


def ccxt():
    print("== ccxt")
    local = sorted(p.name for p in CCXT_LOCAL.glob("*.js") if "gw" in p.name.lower())
    print(f"local 4.5.68 files with 'gw' in the name: {local or 'none'}")
    hits = [p.name for p in CCXT_LOCAL.glob("*.js") if b"bitgw" in p.read_bytes().lower()]
    print(f"local 4.5.68 files mentioning bitgw: {hits or 'none'}")
    for path in ["ts/src/bitgw.ts", "js/src/bitgw.js"]:
        status, _, _ = get("https://raw.githubusercontent.com/ccxt/ccxt/master/" + path)
        print(f"github master {path}: {status}")
    status, body, _ = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body).get("ids", [])
    print(f"github master exchanges.json ids={len(ids)} with 'gw': {[i for i in ids if 'gw' in i] or 'none'}")


def gecko():
    print("== gecko")
    status, body, _ = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    rows = json.loads(body) if status == 200 else []
    hits = [r for r in rows if "gw" in r["id"].lower() or "gw" in r["name"].lower()]
    print(f"coingecko derivatives exchanges status={status} count={len(rows)} bitgw={hits or 'absent'}")


if __name__ == "__main__":
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    site()
    bundle()
    ccxt()
    gecko()
