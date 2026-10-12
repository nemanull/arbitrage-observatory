# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for SWFT Trade.

Reads CoinMarketCap's maker and taker fields for the venue, then searches every page of the SWFT API documentation for a fee, commission or rate statement.
One GET per page, about thirty in all, spaced half a second apart.

Run from the repository root:
    uv run scripts/probes/venues/swft-trade/fees-probe.py
"""

import json
import re
import time
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
FEE_WORDS = re.compile(r"[^\n]{0,80}\b(fee|fees|commission|maker|taker|rate|charge)\b[^\n]{0,80}", re.I)


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read().decode("utf-8", "replace")


def main() -> None:
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    print("\n## CoinMarketCap fee fields")
    status, text = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=swft-octopus-trade")
    d = json.loads(text)["data"]
    print("detail", status, "makerFee", d.get("makerFee"), "takerFee", d.get("takerFee"), "fee urls", d.get("urls", {}).get("fee"))

    print("\n## fee statements in the SWFT API documentation")
    status, index = fetch("https://docs-swft.en.swft.pro/llms.txt")
    pages = re.findall(r"\]\((https://docs-swft\.en\.swft\.pro/[^)]+\.md)\)", index)
    print("llms.txt", status, len(pages), "pages")
    hits = 0
    for url in pages:
        time.sleep(0.5)
        try:
            status, text = fetch(url)
        except Exception as e:  # noqa: BLE001
            print(url, "error", e)
            continue
        found = [m.group(0).strip() for m in FEE_WORDS.finditer(text)]
        hits += len(found)
        print(url.rsplit("/", 1)[-1], status, len(text), "chars, fee lines", len(found))
        for line in found[:4]:
            print("   ", line[:200])
    print("total fee lines", hits)
    print("# probe finished", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
