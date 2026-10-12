# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for AEGET: the help center fee articles, the catalog's per contract fees and CoinMarketCap's fee fields.

Run from the repository root: uv run scripts/probes/venues/aeget/fees-probe.py
Captures go to .claude/survey-work/aeget/.
"""

import collections
import html
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/aeget")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
HELP = "https://aeget25doc.com/api/v2/help_center/en-001/articles/{id}.json"
ARTICLES = {
    46899657787417: "AEGET Platform Fee Schedule",
    46934316427417: "AEGET Perpetual Contract Parameters & Fees",
    47058256228377: "Spot Trading Parameters and Fee Structure",
    46912814315929: "AEGET Perpetual Contract Essentials Guide",
    46956795338649: "Perpetual Contract Trading Glossary",
}
SEARCH = "https://aeget25doc.com/api/v2/help_center/articles/search.json?query={q}&per_page=50"
CATALOG = "https://aeget.io/futures/fapi/market/v1/public/symbol/list"
SPOT = "https://aeget.io/pro/p/symbol/list"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=aeget"


def get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.loads(reply.read())


def plain(body: str) -> str:
    text = re.sub(r"<(tr|p|br|li|h\d)[^>]*>", "\n", body)
    text = re.sub(r"<t[dh][^>]*>", " | ", text)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r"\s*\n\s*\|", " |", text)  # table cells arrive one per line
    return re.sub(r"\n\s*\n+", "\n", text)


def main() -> None:
    print(f"aeget fee probe, {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    WORK.mkdir(parents=True, exist_ok=True)
    for article_id, title in ARTICLES.items():
        article = get_json(HELP.format(id=article_id))["article"]
        text = plain(article["body"])
        (WORK / f"article-{article_id}.txt").write_text(text)
        print(f"## {article['title']} ({article['locale']}, updated {article['updated_at']}, {article['html_url']})")
        rates = collections.Counter(re.findall(r"0\.0004\b|0\.04%", text))
        print(f"  fee tokens: {dict(rates)}")
        for pattern in [r"Maker: [^\n]*", r"Taker: [^\n]*", r"Spot trading is[^\n]*", r"Settlement times:[^\n]*", r"\| Mark Price \|[^|]*", r"\| Index Price \|[^|]*", r"\| Funding Rate \|[^|]*", r"Fee = [^\n]*"]:
            for match in re.findall(pattern, text)[:2]:
                print(f"  {match.strip()}")
        pairs = re.findall(r"\| ([A-Z0-9]+) \| [0-9.]+ ?\| [0-9.]+ ?\| 1-(\d+) \| ([0-9.]+) ?\| ([0-9.]+)", text)
        if pairs:
            print(f"  contract rows {len(pairs)}, taker and maker values {collections.Counter((p[2], p[3]) for p in pairs)}, leverage caps {collections.Counter(p[1] for p in pairs)}")
        time.sleep(0.5)
    for query in ["API", "VIP", "websocket"]:
        results = get_json(SEARCH.format(q=query))
        print(f"help center search {query!r}: {results['count']} hits, {[r['title'] for r in results['results']]}")
        time.sleep(0.5)
    rows = get_json(CATALOG)["data"]
    fees = collections.Counter((r["contractType"], r.get("makerFee"), r.get("takerFee")) for r in rows)
    print(f"catalog makerFee and takerFee by contract type: {fees.most_common()}")
    spot = get_json(SPOT)["data"]
    spot_fee_keys = sorted({k for r in spot for k in r if "fee" in k.lower()})
    print(f"spot catalog rows {len(spot)}, fee fields {spot_fee_keys}")
    detail = get_json(CMC)["data"]
    print(f"CoinMarketCap makerFee {detail['makerFee']}, takerFee {detail['takerFee']}, countries {detail['countries']}, launched {detail['dateLaunched']}, fee url {detail['urls']['fee']}, website {detail['urls']['website']}")


if __name__ == "__main__":
    main()
