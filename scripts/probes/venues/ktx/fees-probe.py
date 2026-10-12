# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""KTX fee and terms probe for docs/profiles/ktx/fees.md.

Read-only and unauthenticated.
It reads the public rate list page and the script chunk that holds its tier tables, a few help center articles through the public Zendesk API, and one catalog call.
It sends about 60 requests, most of them for the page's script chunks, at no more than 2 per second.
Run from the repository root with: uv run scripts/probes/venues/ktx/fees-probe.py
"""

import html
import json
import re
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}
ARTICLES = {
    "fee structure": 4662605130654,
    "USDT-margined perpetual contracts": 4781242650654,
    "funding rate": 4782607314078,
    "mark price": 4775423250462,
    "MINI contract": 4962860007710,
    "forced liquidation": 5378989010462,
    "terms of service": 4733818896670,
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", "replace")
    time.sleep(0.5)
    return body


def text_of(body_html: str) -> str:
    t = re.sub(r"</(p|h\d|li|tr|div)>", "\n", body_html)
    t = re.sub(r"<(td|th)[^>]*>", " | ", t)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\n\s*\n+", "\n", html.unescape(t))


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def tier_tables() -> None:
    section("tier tables in the script chunk behind https://www.ktx.com/en/rate-list")
    page = fetch("https://www.ktx.com/en/rate-list")
    chunks = sorted(set(re.findall(r"https://res\.camelhash\.com/ktx-web-ssr/[A-Za-z0-9_.-]+\.js", page)))
    print(f"page {len(page)} bytes, {len(chunks)} script chunks linked")
    for url in chunks:
        js = fetch(url)
        if "rate-list-container" not in js:
            continue
        print(f"chunk {url}, {len(js)} bytes")
        labels = re.findall(r'\$t\("([^"]+)"\)', js)
        print(f"tab and column labels: {labels}")
        for name, block in re.findall(r"(\w+)=(?:A\(\(\)=>|v\()(\[\{level:0.*?\}\])\)", js):
            rows = re.findall(r"\{level:(\d+),tradeAmount:\"([^\"]+)\"(?:,assetAmount:\"([^\"]+)\")?[^}]*?maker:\"([^\"]+)\",taker:\"([^\"]+)\"\}", block)
            print(f"table {name}: {len(rows)} rows")
            for level, trade, asset, maker, taker in rows:
                extra = f", total assets {asset}" if asset else ""
                print(f"  VIP {level}: 30 day volume {trade}{extra}, maker {maker}, taker {taker}")
        return
    print("no chunk holds rate-list-container")


def articles() -> None:
    for label, aid in ARTICLES.items():
        data = json.loads(fetch(f"https://support.ktx.com/api/v2/help_center/en-001/articles/{aid}.json"))["article"]
        body = text_of(data["body"])
        section(f"{label}: {data['title']}, updated {data['updated_at']}, {data['html_url']}")
        if label == "fee structure":
            m = re.search(r"Spot Trading Fees.*?Taker Fee\s*\|\s*([\d.]+%).*?Futures Trading Fees.*?Maker Fee\s*\|\s*([\d.]+%).*?Taker Fee\s*\|\s*([\d.]+%)", body, re.S)
            spot_maker = re.search(r"Spot Trading Fees.*?Maker Fee\s*\|\s*([\d.]+%)", body, re.S)
            print(f"spot maker {spot_maker.group(1) if spot_maker else None}, spot taker {m.group(1) if m else None}, futures maker {m.group(2) if m else None}, futures taker {m.group(3) if m else None}")
            for line in body.splitlines():
                if "platform tokens" in line or "Trading Fee Discounts" in line:
                    print(f"discount line: {line.strip()[:300]}")
        elif label == "USDT-margined perpetual contracts":
            rows = re.findall(r"\|\s*([A-Z0-9]+USDT)\s*\n\s*\|\s*([\d-]+)\s*\n.*?\|\s*([-\d.%]+ to [-\d.%]+)\s*\n\s*\|\s*([-\d.%]+ to [-\d.%]+)", body, re.S)
            print(f"{len(rows)} contract rows, distinct maker ranges {sorted(set(r[2] for r in rows))}, distinct taker ranges {sorted(set(r[3] for r in rows))}")
        elif label == "terms of service":
            for line in body.splitlines():
                if "Excluded Jurisdictions" in line and "including" in line:
                    print(line.strip())
        else:
            for line in body.splitlines():
                if re.search(r"Funding Fee =|Position Value =|every 8 hours|every 4 hours|basket|volume weighted|Order types|charged taker|Insurance Fund|liquidation fee", line, re.I):
                    print(line.strip()[:300])


def catalog_fees() -> None:
    section("fee fields in the public catalog, GET https://api.ktx.com/api/v1/products")
    for market in ("lpc", "spot"):
        rows = json.loads(fetch(f"https://api.ktx.com/api/v1/products?market={market}"))["result"]
        pairs: dict[tuple[str, str], int] = {}
        for r in rows:
            key = (r["makerFee"], r["takerFee"])
            pairs[key] = pairs.get(key, 0) + 1
        print(f"market={market}: {len(rows)} rows, (makerFee, takerFee) counts {pairs}")


def main() -> None:
    print(f"probe start {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    tier_tables()
    articles()
    catalog_fees()


if __name__ == "__main__":
    main()
