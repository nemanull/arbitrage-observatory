# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee, product and CCXT probe for IndoEx.

Reads CoinMarketCap's exchange detail and CoinGecko's derivatives exchange list,
the fee fields of the public API (per asset on `assets/all`, per pair on `getMarketDetails`),
checks whether the site's fee page serves any text without its client signature,
scans the site bundle for futures words, and checks CCXT, installed and on GitHub, for an IndoEx class.
Run from the repository root: uv run scripts/probes/venues/indoex/fees-probe.py
"""

import collections
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/indoex")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=indoex"
CG_DERIVATIVES = "https://api.coingecko.com/api/v3/derivatives/exchanges/list"
ASSETS = "https://api.indoex.io/assets/all"
DETAILS = "https://api.indoex.io/getMarketDetails/"
FEE_PAGE = "https://www.indoex.io/fees"
FEE_CALL = "https://masternode.indoex.io/getVendorinfo/"  # the call the fee page makes, POST {"sessionid": ...}
CCXT_SRC = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
GITHUB_SRC = "https://api.github.com/repos/ccxt/ccxt/contents/ts/src"
GITHUB_HEAD = "https://api.github.com/repos/ccxt/ccxt/commits?per_page=1"


def call(url: str, body: dict | None = None) -> tuple[int | None, bytes]:
    data = None if body is None else json.dumps(body).encode()
    headers = {"User-Agent": UA, "Content-Type": "application/json", "Origin": "https://www.indoex.io"}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=40) as reply:
            return reply.status, reply.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"))

    status, raw = call(CMC)
    data = json.loads(raw)["data"]
    print(f"\n== CoinMarketCap detail: {status}, id {data['id']}, status {data['status']}, launched {data['dateLaunched']}")
    print(f"maker {data.get('makerFee')}, taker {data.get('takerFee')}, fiats {data.get('fiats')}, urls {data.get('urls')}")
    usd = (data.get("quote") or {}).get("2781", {})
    print(f"USD volumes: spot {usd.get('spotVolume24h')}, perpetual {usd.get('perpetualVolume24h')}, futures {usd.get('futuresVolume24h')}, updated {usd.get('updateTime')}")
    print("description:", re.sub(r"\s+", " ", data.get("description", ""))[:600])

    status, raw = call(CG_DERIVATIVES)
    rows = json.loads(raw)
    if isinstance(rows, list):
        hits = [r for r in rows if "indo" in (r["id"] + r["name"]).lower()]
        print(f"\n== CoinGecko derivatives exchange list: {status}, {len(rows)} exchanges, IndoEx entries {hits}")
    else:
        print(f"\n== CoinGecko derivatives exchange list: {status}, {raw[:160]!r}")

    status, raw = call(ASSETS)
    assets = json.loads(raw)["result"]
    pairs = collections.Counter((v["maker_Fee"], v["taker_Fee"]) for v in assets.values())
    print(f"\n== assets/all: {status}, {len(assets)} assets, (maker_Fee, taker_Fee) counts {dict(pairs)}")
    print("assets off the common value:", {k: (v["maker_Fee"], v["taker_Fee"]) for k, v in assets.items() if (v["maker_Fee"], v["taker_Fee"]) != pairs.most_common(1)[0][0]})
    print("BTC, ETH, USDT:", {k: (assets[k]["maker_Fee"], assets[k]["taker_Fee"]) for k in ["BTC", "ETH", "USDT"] if k in assets})

    status, raw = call(DETAILS)
    details = json.loads(raw)["marketdetails"]
    pairs = collections.Counter((r["buyfee"], r["sellfee"]) for r in details)
    print(f"\n== getMarketDetails: {status}, {len(details)} pairs, (buyfee, sellfee) counts {dict(pairs)}")

    status, raw = call(FEE_PAGE)
    page = raw.decode("utf-8", "replace")
    print(f"\n== fee page {FEE_PAGE}: {status}, {len(raw)} bytes, title {re.search(r'<title>(.*?)</title>', page).group(1)!r}, has app-root {'<app-root>' in page}")
    status, raw = call(FEE_CALL, {"sessionid": None})
    print(f"POST {FEE_CALL} without the site's siteauthcode header: {status}, {raw[:200]!r}")

    bundle_name = re.search(r'src="(main\.[0-9a-f]+\.js)"', page).group(1)
    status, raw = call("https://www.indoex.io/" + bundle_name)
    bundle = raw.decode("utf-8", "replace")
    words = {w: len(re.findall(w, bundle)) for w in ["futures", "Futures", "perpetual", "Perpetual", "funding rate", "contract"]}
    print(f"\n== site bundle {bundle_name}: {status}, {len(raw)} bytes, word counts {words}")
    print("socket hosts in the bundle:", sorted(set(re.findall(r'"(https://[a-z]*socket\.indoex\.io/)"', bundle))))
    print("socket URL constants:", re.findall(r'e\.(TRADESOCKET[A-Z_]*_URL)="([^"]+)"', bundle))
    print("socket.io parser protocol:", re.findall(r'n\.protocol=(\d+),n\.types=\["CONNECT"', bundle))
    print("client emits:", sorted(set(re.findall(r'socket\.emit\("([^"]+)"', bundle))))
    print("socket events listened:", sorted(set(re.findall(r'socket\.on\("([^"]+)"', bundle))))
    at = bundle.find("onanalyticsrefresh().subscribe")
    print("analyticsrefresh handler:", re.sub(r"\s+", " ", bundle[at : at + 200]) if at >= 0 else "not found")
    calls = sorted(set(re.findall(r'e\.[A-Z0-9_]+_URL=Bt\+"/?([^"/]+)/?"', bundle)))
    print(f"masternode calls in the bundle: {len(calls)}, of interest {[c for c in calls if re.search(r'refer|mm|stak|ieo|airdrop|vote|fee|level|vip', c, re.I)]}")
    print(f"bundle mentions: 'liveragevendor' {bundle.count('liveragevendor')}, 'LeverageBonus' {bundle.count('LeverageBonus')}, 'siteauthcode' {bundle.count('siteauthcode')}")
    # the Legalities page is compiled into the bundle as text nodes, so its sentences can be read without rendering
    at = bundle.find("HOLDINGS BY G LTD")
    legal = " ".join(re.findall(r'\["([^"]{2,})"\]\)', bundle[at - 3000 : at + 9000])) if at >= 0 else ""
    legal = legal.encode().decode("unicode_escape", "replace") if legal else ""
    print(f"Legalities text from the bundle, {len(legal)} chars:")
    print(re.sub(r"\s+", " ", legal)[:1400])
    for word in ["Canada", "United States", "restricted countr", "prohibited jurisdiction", "Estonia"]:
        print(f"  bundle mentions {word!r}: {len(re.findall(word, bundle))}")

    files = sorted(p.name for p in CCXT_SRC.glob("*.js"))
    named = [f for f in files if "indoex" in f]
    containing = [f for f in files if "indoex" in (CCXT_SRC / f).read_text(errors="replace").lower()]
    print(f"\n== CCXT 4.5.68 at {CCXT_SRC}: {len(files)} .js files, names with indoex {named}, files containing indoex {containing}")
    near = [f for f in files if f.startswith("indo")]
    print("names starting with indo:", near)

    status, raw = call(GITHUB_HEAD)
    head = json.loads(raw)[0]
    print(f"\n== CCXT GitHub master head: {status}, {head['sha']}, {head['commit']['committer']['date']}")
    status, raw = call(GITHUB_SRC)
    entries = [e["name"] for e in json.loads(raw)]
    print(f"ts/src listing: {status}, {len(entries)} entries, with indoex {[e for e in entries if 'indoex' in e.lower()]}, starting with indo {[e for e in entries if e.lower().startswith('indo')]}")


if __name__ == "__main__":
    main()
