# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of FOBLGATE's trading fees and the product facts its web bundle states.

FOBLGATE's fee page at /fees has no fee table of its own.
Its trading fee tab lists the orderFee field of POST /ticker/marketList for every pair with listUse ON, as a percent.

Modes, all by default, or name some on the command line:
    fees     orderFee per pair from /ticker/marketList, grouped, with BTC/USDT and the busiest pairs named
    bundle   the site's main JS and the fee, trade and API management chunks, searched for the fee label, the discount rule,
             any maker or taker word, the API documentation button, the KRW market notes, the foreigner notes, the company name, and any futures words
    cmc      CoinMarketCap's exchange detail for FOBLGATE: maker and taker fee fields and the spot, perpetual and futures pair counts

Run from the repository root:
    uv run scripts/probes/venues/foblgate/fees-probe.py [mode ...]
"""

import collections
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

SITE = "https://www.foblgate.com"
API = "https://api2.foblgate.com"
CMC_DETAIL = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=foblgate"
CMC_PAIRS = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=foblgate&category={}&start=1&limit=500"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}
WORK = Path(".claude/survey-work/foblgate")


def get(url: str, data: bytes | None = None, headers: dict | None = None) -> bytes:
    time.sleep(1.0)
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False))


def mode_fees() -> None:
    rows = json.loads(get(f"{API}/ticker/marketList", b"{}", {"Content-Type": "application/json"}))["data"]
    listed = {k: v for k, v in rows.items() if v["listUse"] == "ON"}
    groups = collections.defaultdict(list)
    for k, v in sorted(listed.items()):
        groups[v["orderFee"]].append(k)
    for fee, pairs in sorted(groups.items(), key=lambda g: float(g[0])):
        out(mode="fees", orderFee_percent=fee, ppm=round(float(fee) * 10_000), count=len(pairs), pairs=pairs)
    for k in ("BTC/USDT", "ETH/USDT", "ZEUS/USDT", "MOBIS/USDT", "CONUT/USDT", "BNB/USDT"):
        v = rows.get(k, {})
        out(mode="fees", pair=k, orderFee=v.get("orderFee"), orderMin=v.get("orderMin"), listUse=v.get("listUse"), tradeUse=v.get("tradeUse"))
    out(mode="fees", listed=len(listed), all_rows=len(rows))


def chunk_names(index_js: str) -> list[str]:
    return sorted(set(re.findall(r"assets/([A-Za-z0-9_-]+\.js)", index_js)))


def mode_bundle() -> None:
    html = get(SITE + "/").decode()
    main = re.search(r'src="/assets/(index-[A-Za-z0-9_-]+\.js)"', html).group(1)
    index_js = get(f"{SITE}/assets/{main}").decode()
    names = chunk_names(index_js)
    out(mode="bundle", main=main, chunks=len(names))
    wanted = [n for n in names if n.split("-")[0] in ("FeesPage", "TradePage", "ApiManagePage")]
    texts = {main: index_js}
    for n in wanted:
        texts[n] = get(f"{SITE}/assets/{n}").decode()
    WORK.mkdir(parents=True, exist_ok=True)
    patterns = {
        "fee label": r"수수료\(부가세 포함\)",
        "discount rule": r'membershipType==="PRIVATE"\|\|[^?]{0,60}',
        "fee formula": r"orderFee/100,V=Wr\(x\),fe=X\*\(1-V\)",
        "fee tab source": r'listUse==="ON"\)\.forEach\(o=>\{r\[o\.marketName\]=o\.orderFee\}',
        "api doc button": r"handlerAttentionPop:\(\)=>\(l\.openAlertPop\(\"\",c\(\"[^\"]+\"\)",
        "krw market note": r"\(원화 마켓 오픈 시 지원 예정\)",
        "foreigner notes": r"\"(외국인 회원은 이용하실수 없습니다\.|외국인은 원화의 입출금이 제한 됩니다\.)\"",
        "company": r"\"(FOBLGATE Co\., Ltd\.|주식회사 포블게이트\(FOBLGATE\))\"",
        "api hosts": r"frontApiUrl:\"[^\"]+\",tradeApiUrl:\"[^\"]+\"",
        "stream": r"rdsUrl:\"wss://[^\"]+\"",
        "stream channels": r"Sl=\[[^\]]+\]",
        "maker or taker": r"(?i)[a-z]{0,12}(maker|taker)[a-z]{0,12}",
        "futures words": r"(?i)\"[^\"]{0,30}(perpetual|futures|선물|무기한|funding|leverage|레버리지)[^\"]{0,30}\"",
    }
    for label, pat in patterns.items():
        hits = collections.Counter()
        for name, text in texts.items():
            for m in re.finditer(pat, text):
                hits[f"{name.split('-')[0]}: {m.group(0)[:120]}"] += 1
        out(mode="bundle", pattern=label, hits=dict(hits) or "none")


def mode_cmc() -> None:
    d = json.loads(get(CMC_DETAIL)).get("data") or {}
    out(mode="cmc", name=d.get("name"), slug=d.get("slug"), makerFee=d.get("makerFee"), takerFee=d.get("takerFee"), spotVolumeUsd=d.get("spotVolumeUsd"),
        derivativeVolumeUsd=d.get("derivativeVolumeUsd"), countries=d.get("countries"), fiats=d.get("fiats"), urls=(d.get("urls") or {}).get("fee"))
    for cat in ("spot", "perpetual", "futures"):
        c = (json.loads(get(CMC_PAIRS.format(cat))).get("data") or {})
        out(mode="cmc", category=cat, numMarketPairs=c.get("numMarketPairs"), pairs=sorted(p["marketPair"] for p in c.get("marketPairs", [])))


MODES = {"fees": mode_fees, "bundle": mode_bundle, "cmc": mode_cmc}

if __name__ == "__main__":
    for m in sys.argv[1:] or list(MODES):
        MODES[m]()
