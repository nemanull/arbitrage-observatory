# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee probe for ChangeNOW.

ChangeNOW publishes no maker or taker rate, and its FAQ says every fee is folded into the quoted amount.
So this probe reads the published fee statements, then measures the all-in cost the keyless floating-rate quote implies.
It compares GET /v1/exchange-amount quotes for BTC and ETH against USDT on Tron with the best bid and ask of Coinbase Exchange and Kraken, read in the same second.
Three rounds of 14 quotes, 10 s apart, stay far below the documented 30 calls per second.

Run from the repository root:
    uv run scripts/probes/venues/changenow/fees-probe.py
"""

import html
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "changenow"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
API = "https://api.changenow.io"
PAGES = {
    "faq": "https://changenow.io/faq/what-fees-are-there-during-an-exchange",
    "pro": "https://changenow.io/pro",
    "api": "https://changenow.io/api",
    "crypto-trading": "https://changenow.io/crypto-trading",
    "terms": "https://changenow.io/terms-of-use/changenow-terms",
}
PHRASES = [
    r"various fees are charged",
    r"trading fees that our liquidity providers charge",
    r"include them in the estimate",
    r"All fees are already included in the rate you see",
    r"cashback for exchange transaction",
    r"Start from 0\.4%[^.]*",
    r"Perpetuals soon",
    r"99\.99% Availability Percent 10 min Accident Warning Time 350 ms Response Time",
    r"VIP \$ 0 per month.{0,700}?Unlimited crypto loans Own private webpages",
    r"CHN Group LLC[^.]*\.[^.]*\.",
    r"Registered address[^.]*\.",
    r"18\+ and only where such access is permitted[^.]*",
    r"Last updated at [^\u2022]*\u2022 [A-Z][a-z]+ \d+, \d{4}",
    r"Kindly note that if you are located in.{0,200}changenow-pro",
    r"5\.6\. Please note that for blockchain technology[^.]*\.[^.]*\.",
    r"increase your cashback limit up to 5 000 NOW[^.]*\.[^.]*\.",
    r"Market, Fixed and Limit orders for any strategy",
    r"Log in to your ChangeNOW Pro account, open Balance[^.]*\.",
    r"5\.3\. For normal orders[^.]*\.",
    r"5\.4\. The ChangeNOW's interest[^.]*\.[^.]*\.",
    r"11\.1\. By accessing[^.]*\.",
    r"3\.2\. If you are a user whose country[^.]*\.",
    r"11\.6\. ChangeNOW has the right to obtain your IP-address[^.]*\.[^.]*\.",
]
COINS = {"btc": ("BTC-USDT", "XBTUSDT", [0.01, 0.1, 1.0]), "eth": ("ETH-USDT", "ETHUSDT", [0.3, 3.0, 30.0])}
USDT = "usdttrc20"


def get(url: str) -> tuple[int | None, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # recorded, not fatal
        return None, repr(e).encode()


def text_of(page: bytes) -> str:
    t = page.decode("utf-8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))


def quote(amount: float, pair: str) -> float | None:
    status, body = get(f"{API}/v1/exchange-amount/{amount}/{pair}")
    if status != 200:
        print(f"    {pair} {amount}: {status} {body[:120]!r}")
        return None
    return float(json.loads(body)["estimatedAmount"])


def refs(cb_id: str, kr_id: str) -> dict:
    out = {}
    s, b = get(f"https://api.exchange.coinbase.com/products/{cb_id}/book?level=1")
    if s == 200:
        j = json.loads(b)
        out["coinbase"] = (float(j["bids"][0][0]), float(j["asks"][0][0]))
    s, b = get(f"https://api.kraken.com/0/public/Ticker?pair={kr_id}")
    if s == 200:
        j = json.loads(b)["result"]
        row = next(iter(j.values()))
        out["kraken"] = (float(row["b"][0]), float(row["a"][0]))
    return out


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("== published fee statements")
    for name, url in PAGES.items():
        status, body = get(url)
        (WORK / f"fees-{name}.html").write_bytes(body)
        t = text_of(body)
        print(f"  {name} {status} {len(body)} B {url}")
        for key in re.findall(rb'"HEADER\.V2\.GROUPS\.0\.ITEMS\.(?:MAIN\.1|ADDITIONAL\.0\.ITEMS\.2|ADDITIONAL\.0)\.(?:TITLE|TEXT|LINK)":"[^"]*"', body)[:6] if name == "faq" else []:
            print(f"    menu entry: {key.decode()}")
        for ph in PHRASES:
            m = re.search(ph, t)
            if m:
                print(f"    found: {t[max(0, m.start() - 60):m.end() + 60]!r}")
        time.sleep(0.5)

    print("== implied all-in cost of the floating-rate quote, against the best bid and ask of two order books")
    print("   sell cost = 1 - (USDT out / coin in) / best bid, buy cost = (USDT in / coin out) / best ask - 1, in ppm")
    for rnd in range(3):
        print(f"  round {rnd + 1} at {time.strftime('%H:%M:%S', time.gmtime())} UTC")
        for coin, (cb_id, kr_id, sizes) in COINS.items():
            r = refs(cb_id, kr_id)
            if "coinbase" not in r:
                print(f"    {coin}: no Coinbase reference {r}")
                continue
            bid, ask = r["coinbase"]
            kb, ka = r.get("kraken", (float("nan"), float("nan")))
            print(f"    {coin} Coinbase bid {bid} ask {ask}, Kraken bid {kb} ask {ka}")
            for size in sizes:
                out = quote(size, f"{coin}_{USDT}")
                usdt_in = round(size * ask, 2)
                back = quote(usdt_in, f"{USDT}_{coin}")
                if out is None or back is None:
                    continue
                sell_ppm = (1 - (out / size) / bid) * 1e6
                buy_ppm = ((usdt_in / back) / ask - 1) * 1e6
                sell_kr = (1 - (out / size) / kb) * 1e6
                buy_kr = ((usdt_in / back) / ka - 1) * 1e6
                print(f"      {size} {coin} to USDT: {out:.4f}, sell cost {sell_ppm:.0f} ppm vs Coinbase, {sell_kr:.0f} vs Kraken")
                print(f"      {usdt_in} USDT to {coin}: {back:.8f}, buy cost {buy_ppm:.0f} ppm vs Coinbase, {buy_kr:.0f} vs Kraken")
                time.sleep(0.2)
        if rnd < 2:
            time.sleep(10)


if __name__ == "__main__":
    main()
