# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for Binance TH spot, for docs/profiles/binance-th/fees.md.

Reads the public VIP tier table that the VIP landing page loads, the platform fee FAQ text,
and the answer of the signed trade fee call without credentials.
Run from the repository root: uv run scripts/probes/venues/binance-th/fees-probe.py
Captures go to .claude/survey-work/binance-th/.
"""

import html
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

WORK = Path(".claude/survey-work/binance-th")
VIP_INFO = "https://www.binance.th/bapi/accounts/v1/public/account/vip-info/get"
FEE_FAQ = "https://www.binance.th/en/faq/spot-trading/91605c2481714f41becb6951906d6927"
TRADE_FEE = "https://api.binance.th/api/v1/asset/tradeFee"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


def get(url: str, headers: dict | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            return reply.status, reply.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def ppm(fraction: float) -> int:
    return round(fraction * 1_000_000)


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print(f"probe start {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")

    status, raw = get(VIP_INFO, {"clienttype": "web"})
    doc = json.loads(raw)
    (WORK / "vip-info.json").write_text(json.dumps(doc, indent=1))
    print(f"GET {VIP_INFO}: {status}, code {doc.get('code')}, success {doc.get('success')}, userVipLevel {doc['data'].get('userVipLevel')}")
    print("level | 30 day volume USD | broker maker ppm | broker taker ppm | exchange maker ppm | exchange taker ppm")
    for row in doc["data"]["vipInfoList"]:
        print(f"VIP {row['vipLevel']} | {row['tradingVolume']:,} | {ppm(row['brokerMakerCommission'])} | {ppm(row['brokerTakerCommission'])} | "
              f"{ppm(row['exchangeMakerCommission'])} | {ppm(row['exchangeTakerCommission'])}")
    print("row keys", sorted(doc["data"]["vipInfoList"][0]))

    status, raw = get(FEE_FAQ)
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", raw.decode("utf-8", "ignore"), flags=re.S)
    text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)))
    print(f"GET fee FAQ: {status}")
    for pattern in (r"For regular users, each crypto trading pair carries a standard fee of [0-9.]+% of transaction value \(inclusive of VAT\)",
                    r"We may stipulate the condition and applicable trading fee for the VIP customers[^.]*\."):
        for match in re.findall(pattern, text):
            print(f"  FAQ: {match}")
    heads = re.findall(r"(\d\. (?:THB|Crypto) Trading Pairs)", text)
    print(f"  FAQ section heads in order: {heads}")

    status, raw = get(TRADE_FEE + "?timestamp=0")
    print(f"GET {TRADE_FEE} without key: {status} {raw[:160]!r}")


if __name__ == "__main__":
    main()
