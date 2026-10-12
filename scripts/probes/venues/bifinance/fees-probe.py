# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for BiFinance, for docs/profiles/bifinance/fees.md.

It reads the fee tables the web app's Fees page shows, from the web app's own API.
Both tables and the default tier need the web app's request signature, see rest-probe.py.
No account and no token are used.
Run from the repository root with: uv run scripts/probes/venues/bifinance/fees-probe.py
"""

import hashlib
import json
import time
import urllib.error
import urllib.request

API = "https://www.bifinance.com/api"
SIGN_KEY = "mnn#QyrnvLcBbGdX7" + "tWNZImfINb7cTL" + "r"


def post(path: str, body: dict, signed: bool = True) -> dict:
    now_ms = int(time.time() * 1000)
    headers = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 survey-probe", "language": "en_US"}
    if signed:
        fields = dict(body, time=now_ms - 688)
        text = "&".join([f"{k}={fields[k]}" for k in sorted(fields)] + [f"key={SIGN_KEY}"])
        headers.update({"time": str(now_ms), "deviceType": "3", "signature": hashlib.md5(text.encode()).hexdigest()})
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.load(reply)


def ppm(rate: str) -> int:
    return round(float(rate) * 1_000_000)


def table(title: str, rows: list[dict]) -> None:
    print(f"== {title}")
    print("level  30d volume USDT  30d avg BFT  maker ppm  taker ppm")
    for r in rows:
        print(f"{r['levelName']:6} {r['dealAmount']:>16} {r['holdAmount']:>11} {ppm(r['makerFee']):>10} {ppm(r['takerFee']):>10}")
    day = lambda t: time.strftime("%Y-%m-%d", time.gmtime(t))
    print(f"rows created {day(min(r['createTime'] for r in rows))} to {day(max(r['createTime'] for r in rows))}, last updated {day(min(r['updateTime'] for r in rows))} to {day(max(r['updateTime'] for r in rows))}")


if __name__ == "__main__":
    print("probe run", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()))
    table("perpetual tiers, POST /contract/tradeFee/list (signed)", post("/contract/tradeFee/list", {})["data"])
    table("spot tiers, POST /order/get-exchange-fee-levels (signed)", post("/order/get-exchange-fee-levels", {})["data"])
    mine = post("/contract/tradeFee/currentUserTradeFee", {})["data"]
    print("== default perpetual tier with no token, POST /contract/tradeFee/currentUserTradeFee (signed)")
    print({k: mine.get(k) for k in ("uid", "userId", "levelName", "makerFee", "takerFee")}, f"maker {ppm(mine['makerFee'])} ppm, taker {ppm(mine['takerFee'])} ppm")
    for path in ("/contract/tradeFee/list", "/order/get-exchange-fee-levels"):
        unsigned = urllib.request.Request(API + path, data=b"{}", method="POST", headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 survey-probe"})
        try:
            with urllib.request.urlopen(unsigned, timeout=30) as reply:
                print(f"== {path} without the signature: HTTP {reply.status}")
        except urllib.error.HTTPError as error:
            print(f"== {path} without the signature: HTTP {error.code}")
