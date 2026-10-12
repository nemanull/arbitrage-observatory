# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and coverage probe for StakeCube.

Modes, all by default, or name some on the command line:
    pages    the official fee page, the exchange page, the SCC page, the imprint and the terms, with the fee
             sentences, the comparison table row for trading fee and margin trading, the operator and the data clause
    cmc      CoinMarketCap's exchange record, its spot and perpetual pair counts, and its derivatives ranking
    gecko    CoinGecko's derivatives venue list and exchange list
    ccxt     the local CCXT 4.5.68 class folder and exchange map, and the current CCXT master on GitHub

Every request is unauthenticated, one at a time, with at least 1 s between requests.

Run from the repository root:
    uv run scripts/probes/venues/stakecube/fees-probe.py [mode ...]
"""

import html
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js"


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def get(url: str) -> tuple[int, dict, bytes]:
    time.sleep(1.0)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def text_of(body: bytes) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", body.decode("utf-8", errors="replace"), flags=re.S)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", t)).split())


def around(text: str, needle: str, before: int, after: int) -> str | None:
    i = text.find(needle)
    return text[max(0, i - before): i + len(needle) + after] if i >= 0 else None


def table_row(page: str, label: str) -> list[str] | None:
    m = re.search(r"<tr>\s*<td[^>]*>\s*" + re.escape(label) + r"\s*</td>(.*?)</tr>", page, flags=re.S)
    if not m:
        return None
    cells = re.findall(r"<td[^>]*>(.*?)</td>", m.group(1), flags=re.S)
    shown = []
    for c in cells:
        if "fa-check" in c:
            shown.append("check")
        elif "fa-times" in c:
            shown.append("cross")
        else:
            shown.append(" ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split()))
    return shown


def pages_mode() -> None:
    status, hdrs, body = get("https://stakecube.net/app/system/fees")
    title = re.search(r"<title>(.*?)</title>", body.decode(errors="replace"))
    out(mode="pages", page="fee page", url="https://stakecube.net/app/system/fees", status=status,
        server=hdrs.get("server"), cf_mitigated=hdrs.get("cf-mitigated"), title=title.group(1) if title else None)

    status, hdrs, body = get("https://stakecube.net/crypto-exchange")
    page, text = body.decode("utf-8", errors="replace"), text_of(body)
    out(mode="pages", page="crypto-exchange", status=status,
        fee_sentence=around(text, "the 0.2% fee", 140, 60),
        header_row=table_row(page, "Supported coins") and ["StakeCube", "Binance", "Bitfinex", "Kraken"],
        trading_fee_row=table_row(page, "Trading fee"), margin_trading_row=table_row(page, "Margin Trading"),
        base_pairs_sentence=around(text, "base pairs", 10, 120),
        mentions={k: k in text.lower() for k in ("futures", "perpetual", "leverage", "derivative")})

    status, hdrs, body = get("https://stakecube.net/scc")
    text = text_of(body)
    out(mode="pages", page="scc", status=status, zero_fee_sentence=around(text, "trade with zero fee", 60, 40),
        masternode_row=around(text, "Integration type", 0, 120))

    status, hdrs, body = get("https://stakecube.net/imprint")
    text = text_of(body)
    out(mode="pages", page="imprint", status=status, headquarters=around(text, "Headquarters", 0, 110),
        germany=around(text, "Other locations", 0, 200))

    status, hdrs, body = get("https://stakecube.net/terms")
    text = text_of(body)
    out(mode="pages", page="terms", status=status, fee_clause=around(text, "c. Fees", 0, 230),
        us_clause=around(text, "not a United States citizen", 30, 90),
        data_clause=around(text, "It is forbidden to use StakeCube market data", 0, 200),
        mentions={k: k in text.lower() for k in ("futures", "perpetual", "leverage", "margin")})


def cmc_mode() -> None:
    base = "https://api.coinmarketcap.com/data-api/v3/exchange"
    status, hdrs, body = get(f"{base}/detail?slug=stakecube")
    d = json.loads(body)["data"]
    out(mode="cmc", call="detail", status=status, id=d.get("id"), name=d.get("name"), dateLaunched=d.get("dateLaunched"),
        makerFee=d.get("makerFee"), takerFee=d.get("takerFee"), fee_url=(d.get("urls") or {}).get("fee"),
        countries=d.get("countries"), description=(d.get("description") or "")[:200])
    for cat in ("spot", "perpetual", "futures"):
        status, hdrs, body = get(f"{base}/market-pairs/latest?slug=stakecube&category={cat}&start=1&limit=5")
        data = json.loads(body).get("data") or {}
        out(mode="cmc", call=f"market-pairs category={cat}", status=status, numMarketPairs=data.get("numMarketPairs"))
    status, hdrs, body = get(f"{base}/listing?exType=2&start=1&limit=200")
    data = json.loads(body)["data"]
    names = [e["slug"] for e in data["exchanges"]]
    out(mode="cmc", call="listing exType=2", status=status, total=data.get("total"), listed=len(names),
        stakecube_listed=any("stakecube" in n for n in names))


def gecko_mode() -> None:
    status, hdrs, body = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    rows = json.loads(body)
    out(mode="gecko", call="derivatives/exchanges/list", status=status, venues=len(rows),
        stakecube=[r for r in rows if "stake" in (r["id"] + r["name"]).lower()])
    status, hdrs, body = get("https://api.coingecko.com/api/v3/exchanges/list")
    rows = json.loads(body)
    out(mode="gecko", call="exchanges/list", status=status, venues=len(rows),
        stakecube=[r for r in rows if "stake" in (r["id"] + r["name"]).lower()])


def ccxt_mode() -> None:
    src = CCXT / "src"
    classes = sorted(p.name for p in src.glob("*.js"))
    lines = (CCXT / "ccxt.js").read_text().splitlines()
    start = next(i for i, ln in enumerate(lines, 1) if ln.startswith("const exchanges = {"))
    end = next(i for i, ln in enumerate(lines, 1) if i > start and ln.startswith("};"))
    hits = [i for i, ln in enumerate(lines, 1) if start <= i <= end and "stake" in ln.lower()]
    out(mode="ccxt", local_src=str(src.relative_to(ROOT)), classes=len(classes),
        stakecube_files=[c for c in classes if "stake" in c], exchanges_map_lines=[start, end], map_hits=hits)
    status, hdrs, body = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    ids = json.loads(body)["ids"]
    out(mode="ccxt", call="master exchanges.json", status=status, ids=len(ids), stake_ids=[i for i in ids if "stake" in i])
    for path in ("ts/src/stakecube.ts", "js/src/stakecube.js"):
        status, hdrs, body = get(f"https://raw.githubusercontent.com/ccxt/ccxt/master/{path}")
        out(mode="ccxt", call=f"master {path}", status=status)


MODES = {"pages": pages_mode, "cmc": cmc_mode, "gecko": gecko_mode, "ccxt": ccxt_mode}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    out(probe="stakecube fees", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=chosen)
    for name in chosen:
        MODES[name]()
