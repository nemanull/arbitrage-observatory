# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""XXKK fee probe for docs/profiles/xxkk/fees.md.

Reads the fee page and contract information page script chunks for the published rates and funding formula, and the website's contract list for the per-contract rates.
Read-only and unauthenticated, 7 requests at 1 per second.
Run from the repository root with: uv run scripts/probes/venues/xxkk/fees-probe.py
"""

import collections
import json
import re
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    time.sleep(1.0)
    return body


def main() -> None:
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    page = fetch("https://www.xxkk.com/en/fee")
    chunk = re.search(r'src="(/_next/static/chunks/pages/%5Blocale%5D/fee-[0-9a-f]+\.js)"', page).group(1)
    print("fee page chunk", chunk)
    js = fetch("https://www.xxkk.com" + chunk)
    strings = re.findall(r'children:(?:\(0,c\.bn\)\()?"([^"]{1,200})"', js)
    for anchor in ["所有现货交易对", "所有永续交易对"]:
        i = strings.index(anchor)
        print(f"table row {anchor!r}: maker {strings[i + 1]!r} taker {strings[i + 2]!r}")
    for s in strings:
        if "%" in s and ("Maker" in s or "Taker" in s or "~" in s or s.startswith("0.0")):
            print("fee text", repr(s))
    for s in strings:
        if "递延" in s or "杠杆" in s:
            print("TradFi formula", repr(s))

    info_page = fetch("https://www.xxkk.com/en/swap-info")
    info_chunk = re.search(r'src="(/_next/static/chunks/pages/%5Blocale%5D/swap-info-[0-9a-f]+\.js)"', info_page).group(1)
    info_js = fetch("https://www.xxkk.com" + info_chunk)
    m = re.search(r'"(资金费率 = [^"]+)",\{rate_1:"([^"]+)",rate_2:"([^"]+)"\}', info_js)
    print("swap-info chunk", info_chunk)
    print("funding formula", repr(m.group(1)) if m else None, "rate_1", m.group(2) if m else None, "rate_2", m.group(3) if m else None)

    info = json.loads(fetch("https://www.xxkk.com/api/swap/public/common/exchangeInfo"))["data"]
    pairs = collections.Counter((r["settleCoin"], r["feeRateMaker"], r["feeRateTaker"], r["liqFeeRate"]) for r in info)
    print("exchangeInfo (settleCoin, feeRateMaker, feeRateTaker, liqFeeRate) counts", dict(pairs))
    print("taker ppm", {round(r["feeRateTaker"] * 1_000_000) for r in info}, "maker ppm", {round(r["feeRateMaker"] * 1_000_000) for r in info})

    vip = fetch("https://www.xxkk.com/en/vip")
    for phrase in ["up to 50% off Futures trading fees", "Up to 60% trading fee discount", "Deposit $50K", "Perpetual trading volume of the last 30 days"]:
        print(f"vip page contains {phrase!r}: {phrase in vip}")
    print("vip page has a numeric tier table:", bool(re.search(r"VIP ?[1-9][^<]{0,40}\d+(\.\d+)?%", vip)))


if __name__ == "__main__":
    main()
