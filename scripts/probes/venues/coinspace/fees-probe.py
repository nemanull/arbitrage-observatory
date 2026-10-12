# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""COINSPACE fee probe for docs/profiles/coinspace/fees.md.

Public, unauthenticated and read-only.
It reads the fee list CoinMarketCap links as COINSPACE's fee page, the FAQ the web app shows,
the membership tier call the web app makes, and CoinMarketCap's own record of the venue.
It sends six requests, about two seconds apart.
Run from the repository root with: uv run scripts/probes/venues/coinspace/fees-probe.py
"""

import collections
import json
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}


def fetch(url: str):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        status = exc.code
    time.sleep(2)
    return status, body


def main():
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    st, body = fetch("https://www.coinspace.world/proxy/api/v1/fees")
    rows = json.loads(body)
    print(f"\n== /proxy/api/v1/fees: HTTP {st}, {len(rows)} rows, fields {sorted(rows[0].keys())}")
    for field in ("open_market_fee", "close_market_fee", "open_place_fee", "close_place_fee", "deposit_fee", "withdraw_fee"):
        print(f"   {field}: {dict(collections.Counter(r[field] for r in rows))}")
    print("   symbols", sorted(r["symbol"] for r in rows))

    st, body = fetch("https://api.coinspace.world/api/notices")
    faq = json.loads(body)
    print(f"\n== api.coinspace.world/api/notices: HTTP {st}, {len(faq)} entries")
    for n in faq:
        if any(k in n["title"] for k in ("Q7.", "Q9.", "Q13.", "Q14.")):
            print(f"   [{n.get('created_at') or n.get('createdAt')}] {n['title']} {n['content']}")

    st, body = fetch("https://api.coinspace.world/api/membership/tiers")
    print(f"\n== api.coinspace.world/api/membership/tiers: HTTP {st}, {body[:200]}")

    st, body = fetch("https://api.coinspace.world/api/public/symbols")
    syms = json.loads(body)
    print(f"\n== api.coinspace.world/api/public/symbols: HTTP {st}, {len(syms)} symbols, max_leverage "
          f"{ {s['symbol']: s['max_leverage'] for s in syms} }")
    fee_syms = {r["symbol"] for r in rows}
    print("   catalog symbols present in the fee list:", sorted(s["symbol"].replace("/", "") for s in syms if s["symbol"].replace("/", "") in fee_syms))

    st, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinspace")
    d = json.loads(body)["data"]
    print(f"\n== CoinMarketCap exchange detail: HTTP {st}, name {d['name']}, id {d['id']}, launched {d['dateLaunched']}, "
          f"makerFee {d['makerFee']}, takerFee {d['takerFee']}, fee url {d['urls'].get('fee')}, countries {d.get('countries')}")
    usd = d["quote"].get("2781", {})
    print(f"   USD quote: spotVolume24h {usd.get('spotVolume24h')}, perpetualVolume24h {usd.get('perpetualVolume24h')}")
    for sentence in d["description"].split(". "):
        if any(k in sentence for k in ("COINIA", "spot exchange", "derivatives", "KYC")):
            print("   description:", sentence.strip()[:300])

    st, body = fetch("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinspace&category=spot&start=1&limit=100")
    pairs = json.loads(body)["data"]
    print(f"\n== CoinMarketCap market pairs: HTTP {st}, numMarketPairs {pairs.get('numMarketPairs')}, "
          f"categories {sorted({p.get('category') for p in pairs['marketPairs']})}")
    print("probe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
