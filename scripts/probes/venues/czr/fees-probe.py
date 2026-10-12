# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and rules probe for CZR Exchange.

Reads the fee, jurisdiction, compliance and terms pages through the call the site's cms page makes,
counts the per contract fee fields of the futures open API catalog and the web list,
reads CoinMarketCap's exchange detail, and checks CCXT, installed and on GitHub, for a CZR class.
Run from the repository root: uv run scripts/probes/venues/czr/fees-probe.py
"""

import collections
import html
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/czr")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
CMS_LIST = "https://www.czrex.com/fe-ex-api/cms/footer/list/newPc"
CMS_INFO = "https://www.czrex.com/fe-ex-api/cms/info"  # the site's `cmsInfo` call, POST {"fileName": ...}
PAGES = ["fee", "area", "compliance", "terms", "restrictions"]
CONTRACTS = "https://futuresopenapi.czrex.com/fapi/v1/contracts"
WEB_INFO = "https://futures.czrex.com/fe-co-api/common/public_info"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=czr-exchange"
CCXT_SRC = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
GITHUB_SRC = "https://api.github.com/repos/ccxt/ccxt/contents/ts/src"
GITHUB_HEAD = "https://api.github.com/repos/ccxt/ccxt/commits?per_page=1"
TERMS_WORDS = r"(united states|cayman|service provider|panama|swiss|c-zero|holdings)"


def call(url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, bytes]:
    data = None if body is None else json.dumps(body).encode()
    all_headers = {"User-Agent": UA, "Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=all_headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            return reply.status, reply.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def text_of(content: str) -> str:
    content = re.sub(r"</(p|h\d|tr|li|div)>", "\n", content)
    content = re.sub(r"<t[dh][^>]*>", " | ", content)
    text = html.unescape(re.sub(r"<[^>]+>", "", content))
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    web = {"exchange-language": "en_US", "exchange-client": "pc"}

    status, raw = call(CMS_LIST, {}, web)
    entries = json.loads(raw)["data"]
    print(f"\n== POST {CMS_LIST}: {status}, {len(entries)} entries")
    print([(e["fileName"], e["title"]) for e in entries if e["contentType"] == 1])

    for name in PAGES:
        status, raw = call(CMS_INFO, {"fileName": name}, web)
        reply = json.loads(raw)
        data = reply.get("data") or {}
        text = text_of(data.get("content") or "")
        (WORK / f"cms-{name}.txt").write_text(text)
        stamp = lambda key: datetime.fromtimestamp(int(data[key]) / 1000, timezone.utc).date() if data.get(key) else None
        print(f"\n== cms {name}: {status}, code {reply.get('code')}, title {data.get('title')!r}, created {stamp('ctimeLong')}, modified {stamp('mtimeLong')}, {len(text)} chars")
        if name == "fee":
            print(text[:900])
        elif name == "area":
            table = text.split("Restricted Countries and Territories", 1)[-1].split("These are CZR service restrictions", 1)[0]
            cells = [cell.strip() for cell in re.split(r"[|\n]", table)]
            countries = [c for c in cells if c and c[0].isalpha() and len(c) < 60 and c != "Country or territory" and not c.startswith("The following")]
            print(f"{len(countries)} jurisdictions in the table, Canada {'Canada' in countries}, United States {'United States of America' in countries}")
            print(countries)
            print(text[:400])
        elif name == "terms":
            hits = sorted({m.group(0)[:260] for m in re.finditer(r"[^.]{0,120}" + TERMS_WORDS + r"[^.]{0,120}", text, re.I)})
            print(f"{len(hits)} passages name the operator or the United States, first 8:")
            for line in hits[:8]:
                print("  ", line)
        else:
            print(text[:500])

    status, raw = call(CONTRACTS)
    rows = json.loads(raw)
    live = [row for row in rows if row.get("status") == 1 and row.get("type") == "USDT1858"]
    print(f"\n== {CONTRACTS}: {status}, {len(rows)} rows, {len(live)} with type USDT1858 and status 1")
    for field in ["openTakerFee", "closeTakerFee", "openMakerFee", "closeMakerFee"]:
        print(field, collections.Counter(row.get(field) for row in live).most_common())
    print("other rows:", [(r["symbol"], r["type"], r["status"], r["openTakerFee"], r["openMakerFee"]) for r in rows if r not in live])

    status, raw = call(WEB_INFO, {}, {"exchange-language": "en_US"})
    listed = json.loads(raw)["data"]["contractList"]
    perps = [row for row in listed if row["contractType"] == "E"]
    print(f"\n== web list: {status}, {len(listed)} rows, {len(perps)} perpetuals")
    print("feeRateVo taker", collections.Counter((row.get("feeRateVo") or {}).get("openTakerFeeRate") for row in perps).most_common())
    print("capitalFrequency", collections.Counter(row["capitalFrequency"] for row in perps).most_common())
    print("capitalIntervalMax", collections.Counter(row["capitalIntervalMax"] for row in perps).most_common())
    print("capitalRate", collections.Counter(row.get("capitalRate") for row in perps).most_common())
    print("liquidationRate", collections.Counter(row.get("liquidationRate") for row in perps).most_common())

    status, raw = call(CMC)
    data = json.loads(raw)["data"]
    quote = data.get("quote", {}).get("1", {})
    print(f"\n== CoinMarketCap: {status}, id {data.get('id')}, status {data.get('status')}, launched {data.get('dateLaunched')}, makerFee {data.get('makerFee')}, takerFee {data.get('takerFee')}")
    print("urls", data.get("urls"))
    print("spotVolume24h", quote.get("spotVolume24h"), "perpetualVolume24h", quote.get("perpetualVolume24h"), "derivativesOpenInterests", quote.get("derivativesOpenInterests"))

    print("\n== CCXT")
    names = sorted(path.name for path in CCXT_SRC.glob("*.js"))
    print(f"{CCXT_SRC}: {len(names)} .js files, names containing czr: {[n for n in names if 'czr' in n.lower()]}")
    hits = [n for n in names if re.search(r"czr(ex)?\b", (CCXT_SRC / n).read_text(errors="replace"), re.I)]
    print("files containing czr or czrex:", hits)
    status, raw = call(GITHUB_SRC)
    entries = [entry["name"] for entry in json.loads(raw)] if status == 200 else []
    status_h, raw_h = call(GITHUB_HEAD)
    head = json.loads(raw_h)[0] if status_h == 200 else {}
    print(f"GitHub ts/src: {status}, {len(entries)} entries, names containing czr: {[n for n in entries if 'czr' in n.lower()]}, head {head.get('sha')} {head.get('commit', {}).get('committer', {}).get('date')}")


if __name__ == "__main__":
    main()
