# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CRMClick fee probe for docs/profiles/crmclick/fees.md.

Public, unauthenticated and read-only.
It reads the fee article CoinMarketCap links, a few related help center articles, CoinMarketCap's exchange record and the fee fields of CRMClick's own catalogs.
It also checks CCXT 4.5.68 and CCXT master for a CRMClick class.
About 15 requests, one a second.
Run from the repository root with: uv run scripts/probes/venues/crmclick/fees-probe.py
"""

import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT_SRC = ROOT / "node_modules" / ".pnpm" / "ccxt@4.5.68" / "node_modules" / "ccxt" / "js" / "src"
ZD = "https://crmclickcs.zendesk.com/api/v2/help_center/zh-cn/articles/{}.json"
ARTICLES = {
    50541961952281: "fee article CoinMarketCap links",
    50542239094425: "withdrawal limits and fees",
    38712658869529: "funding fee mechanism",
    33696063772825: "perpetual contract trading rules",
    44326732549913: "App Store launch, 100% fee rebate",
}
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json", "XX-Device-Type": "web"}


def get(url: str, data: bytes | None = None):
    r = urllib.request.Request(url, data=data, headers=UA)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            out = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        out = exc.code, exc.read().decode("utf-8", "replace")
    time.sleep(1)
    return out


def text_of(body: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body))).strip()


def main():
    print("== help center articles")
    for aid, label in ARTICLES.items():
        status, body = get(ZD.format(aid))
        if status != 200:
            print(f"{aid} {label}: HTTP {status}")
            continue
        a = json.loads(body)["article"]
        txt = text_of(a["body"])
        print(f"\n{aid} {label}: '{a['title']}', created {a['created_at']}, updated {a['updated_at']}")
        if aid == 50541961952281:
            print("  full text:", txt)
        elif aid == 50542239094425:
            m = re.search(r"USDT[^A-Z]{0,80}", txt)
            print("  first 300 chars:", txt[:300])
            print("  USDT row:", m.group(0) if m else "not found")
        elif aid == 44326732549913:
            print("  text:", txt[:700])
        else:
            for kw in ("8小时", "结算", "综合利率", "200倍", "0.06%", "币本位", "USDT本位"):
                i = txt.find(kw)
                if i >= 0:
                    print(f"  [{kw}] ...{txt[max(0, i - 60):i + 120]}...")

    print("\n== CoinMarketCap exchange record")
    status, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=crmclick")
    d = json.loads(body)["data"]
    print(f"id {d['id']}, launched {d['dateLaunched']}, makerFee {d['makerFee']}, takerFee {d['takerFee']}, fee url {d['urls']['fee']}")
    print(f"website {d['urls']['website']}, countries {d['countries']}, fiats {d['fiats']}")
    q = d["quote"]["2781"]
    print(f"USD volume 24h spot {q['spotVolume24h']:.0f}, perpetual {q['perpetualVolume24h']}, futures {q['futuresVolume24h']}")

    print("\n== catalog fee fields")
    status, body = get("https://api.crmclick.io/spot/market?lang=en-us")
    rows = json.loads(body)["data"]["list"]
    fees = sorted({(r["maker_fee"], r["taker_fee"]) for r in rows})
    print(f"spot/market rows {len(rows)}, distinct (maker_fee, taker_fee): {fees}")
    status, body = get("https://api.crmclick.io/futures/market?lang=en-us")
    frows = json.loads(body)["data"]["list"]
    print(f"futures/market rows {len(frows)}, fee keys: {[k for k in frows[0] if 'fee' in k.lower()] or 'none'}")

    print("\n== account-gated fee calls")
    for path in ("futuresAccount/futuresLeverage", "profile/userInfo"):
        status, body = get(f"https://api.crmclick.io/{path}?lang=en-us", data=b"symbol=BTCUSDT")
        print(f"POST {path}: HTTP {status} {body[:120]}")

    print("\n== CCXT")
    files = sorted(CCXT_SRC.glob("*.js"))
    hits = [f.name for f in files if re.search(r"crmclick|cerram", f.read_text(errors="replace"), re.I)]
    print(f"{CCXT_SRC.relative_to(ROOT)}: {len(files)} .js files, files mentioning crmclick or cerram: {hits or 'none'}")
    print(f"htx.js present: {(CCXT_SRC / 'htx.js').exists()}")
    status, _ = get("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/crmclick.ts")
    print(f"ccxt master ts/src/crmclick.ts: HTTP {status}")
    status, body = get("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts")
    print(f"ccxt master ts/ccxt.ts mentions crmclick: {bool(re.search('crmclick', body, re.I))}")
    status, body = get("https://api.github.com/repos/ccxt/ccxt/commits/master")
    if status == 200:
        c = json.loads(body)
        print(f"ccxt master commit {c['sha'][:7]} of {c['commit']['committer']['date']}")


if __name__ == "__main__":
    main()
