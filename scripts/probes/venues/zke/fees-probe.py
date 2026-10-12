# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for ZKE.

Reads the published fee page, the support centre's legal articles, the per contract fee fields of the futures catalog and the web list,
CoinMarketCap's exchange detail, and checks CCXT, installed and on GitHub, for a ZKE class.
Run from the repository root: uv run scripts/probes/venues/zke/fees-probe.py
Captures go to .claude/survey-work/zke/.
"""

import collections
import html
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/zke")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
FEE_LINK = "https://support.zke.com/fee/"  # CoinMarketCap's fee URL, which redirects to the fee page
SUPPORT = "https://support.zke.com"
FOOTER = "https://www.zke.com/fe-ex-api/cms/footer/list"
FAPI = "https://futuresopenapi.zke.com/fapi/v1"
WEB_INFO = "https://futures.zke.com/fe-co-api/common/public_info"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=zke"
CCXT_SRC = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
GITHUB_SRC = "https://api.github.com/repos/ccxt/ccxt/contents/ts/src"
GITHUB_HEAD = "https://api.github.com/repos/ccxt/ccxt/commits?per_page=1"
ARTICLES = ["about-us", "license", "service-agreement", "disclaimer", "minimaxusdt", "rwa260630", "231230"]


def fetch(url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, str, str]:
    data = None if body is None else json.dumps(body).encode()
    all_headers = {"User-Agent": UA, **({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=all_headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            return reply.status, reply.geturl(), reply.read().decode(errors="replace")
    except urllib.error.HTTPError as error:
        return error.code, url, error.read().decode(errors="replace")
    except (urllib.error.URLError, TimeoutError) as error:
        return 0, url, str(error)


def text_of(page: str) -> str:
    page = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page))).strip()


def english(value):
    return value.get("en_US") if isinstance(value, dict) else value


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"))

    print("\n== fee page")
    status, final, page = fetch(FEE_LINK)
    (WORK / "fee-page.html").write_text(page)
    text = text_of(page)
    title = re.search(r"<title>(.*?)</title>", page, re.S)
    print(f"GET {FEE_LINK}: {status}, landed on {final}, {len(page)} bytes, title {title.group(1).strip() if title else None!r}")
    for label in ["Spot Trading", "U-Based Contracts"]:
        at = text.find(label + " Standard Rate") if label == "Spot Trading" else text.find(label + " Derivatives")
        print(f"{label}: {text[at:at + 260]!r}")
    print("tier words on the page:", {word: text.count(word) for word in ["VIP", "Tier", "30-day", "volume", "Coin-Margined", "Coin-Based"]})

    print("\n== footer and support articles")
    status, _, body = fetch(FOOTER, {}, {"exchange-language": "en_US"})
    rows = json.loads(body).get("data") or []
    print(f"POST {FOOTER}: {status}, {[(row['fileName'], row['title'], row['url']) for row in rows if re.match(r'[A-Za-z]', row['title'])]}")
    for row in rows:
        if row["fileName"] in ("fee", "agreement") and row["url"].startswith("https://support.zke.com/article/"):
            code, _, page = fetch(row["url"])
            print(f"footer link {row['url']}: {code}, {page[:40]!r}")
    status, _, body = fetch(f"{SUPPORT}/api/public/cms/data")
    data = json.loads(body)
    articles = data["cms_articles"] if isinstance(data["cms_articles"], list) else json.loads(data["cms_articles"])
    categories = data["cms_categories"] if isinstance(data["cms_categories"], list) else json.loads(data["cms_categories"])
    print(f"GET {SUPPORT}/api/public/cms/data: {status}, {len(articles)} articles, {len(categories)} categories")
    titles = [(a["slug"], english(a["title"])) for a in articles]
    fee_like = [t for t in titles if re.search(r"\bfee|funding|index price|mark price|restricted|countr", str(t[1]), re.I)]
    print("articles about fees, funding, index, mark or regions:", fee_like)
    print("perpetual listing and delisting articles:", sum(bool(re.search(r"perpetual", str(t), re.I)) for _, t in titles))
    for slug in ARTICLES:
        code, _, body = fetch(f"{SUPPORT}/api/public/articles/{slug}")
        article = json.loads(body) if code == 200 else {}
        content = text_of(english(article.get("content")) or "")
        (WORK / f"article-{slug}.txt").write_text(content)
        print(f"\narticle {slug}: {code}, created {article.get('created_at')}, {len(content)} characters")
        if slug == "service-agreement":
            for word in ["countr", "region", "territor", "United States", "Canada", "Bahamas", "futures", "derivativ", "sanction"]:
                print(f"  '{word}' appears {len(re.findall(word, content, re.I))} times")
        else:
            print("  ", content[:900])

    print("\n== per contract fee fields")
    with urllib.request.urlopen(urllib.request.Request(f"{FAPI}/contracts", headers={"User-Agent": UA}), timeout=30) as reply:
        contracts = json.loads(reply.read())
    live = [r for r in contracts if r["type"] == "E" and r["side"] == 1 and r["status"] == 1 and r["marginCoin"] == "USDT"]
    inverse = [r for r in contracts if r["side"] == 0 and r["status"] == 1]
    for name, rows_ in [("USDT linear trading", live), ("coin margined trading", inverse)]:
        print(f"{name} {len(rows_)}: openTakerFee {collections.Counter(r['openTakerFee'] for r in rows_)}, openMakerFee {collections.Counter(r['openMakerFee'] for r in rows_)}, "
              f"closeTakerFee {collections.Counter(r['closeTakerFee'] for r in rows_)}")
    status, _, body = fetch(WEB_INFO, {}, {"exchange-language": "en_US"})
    listed = json.loads(body)["data"]["contractList"]
    print("web list feeRateVo:", collections.Counter(json.dumps({k: v for k, v in r["feeRateVo"].items() if k.endswith("Rate")}) for r in listed))
    print("web list liquidationRate:", collections.Counter(r["liquidationRate"] for r in listed), "capitalRate:", collections.Counter(r["capitalRate"] for r in listed))
    print("web list (capitalFrequency, capitalIntervalMax):", collections.Counter((r["capitalFrequency"], r["capitalIntervalMax"]) for r in listed).most_common(10))
    print("MINIMAX row:", [(r["contractName"], r["capitalFrequency"], r["capitalIntervalMax"], r["capitalIntervalMin"], r["maxLever"]) for r in listed if r["base"] == "MINIMAX"])

    print("\n== CoinMarketCap")
    status, _, body = fetch(CMC)
    detail = json.loads(body)["data"]
    print(f"GET {CMC}: {status}")
    print({k: detail.get(k) for k in ["id", "name", "slug", "status", "dateLaunched", "makerFee", "takerFee", "spotVolumeUsd", "countries", "fiats"]})
    print("urls:", detail.get("urls"))
    print("description:", (detail.get("description") or "")[:400])

    print("\n== CCXT")
    names = sorted(path.name for path in CCXT_SRC.glob("*.js"))
    print(f"{CCXT_SRC}: {len(names)} .js files, names containing zke: {[n for n in names if 'zke' in n.lower()]}")
    hits = [n for n in names if re.search(r"\bzke\b", (CCXT_SRC / n).read_text(errors="replace"), re.I)]
    print("files whose text contains the word zke:", hits)
    status, _, body = fetch(GITHUB_HEAD)
    head = json.loads(body)[0] if status == 200 else {}
    print(f"GitHub master head: {status}, {head.get('sha')}, {head.get('commit', {}).get('committer', {}).get('date')}")
    time.sleep(1)
    status, _, body = fetch(GITHUB_SRC)
    entries = [entry["name"] for entry in json.loads(body)] if status == 200 else []
    print(f"GitHub ts/src listing: {status}, {len(entries)} entries, containing zke: {[e for e in entries if 'zke' in e.lower()]}")


if __name__ == "__main__":
    main()
