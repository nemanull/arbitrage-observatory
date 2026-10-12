# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Cryptomus spot fee probe, read-only and unauthenticated.

The fee page https://cryptomus.com/fees/trading renders its tier table in the browser.
Its bundle calls GET https://api-app.cryptomus.com/v1/exchange/tariff/default and maps step, from_turnover, maker_percent and taker_percent to the Level, Monthly turnover, Maker fee and Taker fee columns.
This probe reads that call, checks that the served page carries no tier numbers of its own, and records what the signed per-account tariff call answers without credentials.

Run from the repository root: uv run scripts/probes/venues/cryptomus/fees-probe.py
It sends four requests.
"""

import json
import re
import time
import urllib.error
import urllib.request
from decimal import Decimal

UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def ppm(percent):
    return int((Decimal(percent) * 10000).to_integral_value())


def main():
    status, body = get("https://api-app.cryptomus.com/v1/exchange/tariff/default")
    print(f"GET /v1/exchange/tariff/default status={status} bytes={len(body)}")
    steps = json.loads(body, parse_float=lambda s: str(round(Decimal(s), 6).normalize()))["result"]
    print("level  from_turnover_usd  maker_%  maker_ppm  taker_%  taker_ppm")
    for s in steps:
        print(f"{s['step'] + 1:>5}  {s['from_turnover']:>17}  {s['maker_percent']:>7}  {ppm(s['maker_percent']):>9}  "
              f"{s['taker_percent']:>7}  {ppm(s['taker_percent']):>9}")
    raw = re.findall(r'"maker_percent":([0-9.]+)', body.decode())
    print(f"raw maker_percent literals on the wire={raw[:2]}")
    time.sleep(1)

    status, page = get("https://cryptomus.com/fees/trading")
    text = page.decode("utf-8", "replace")
    print(f"GET https://cryptomus.com/fees/trading status={status} bytes={len(page)}")
    print(f"column header present={'Maker fee, %' in text} 'level is updated' sentence present={'updated once every 24 hours' in text}")
    print(f"page carries a 0.1 or 0.08 tier literal next to 'taker'={bool(re.search(r'taker[^<]{0,40}0\\.(1|08)', text, re.I))}")
    time.sleep(1)

    status, body = get("https://api.cryptomus.com/v2/user-api/exchange/account/tariffs")
    print(f"GET /v2/user-api/exchange/account/tariffs without credentials status={status} body={body[:200].decode()}")
    time.sleep(1)

    status, body = get("https://cryptomus.com/tariffs")
    print(f"GET https://cryptomus.com/tariffs status={status} body={body[:60]!r}")


if __name__ == "__main__":
    main()
