# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Crypton Exchange fee evidence probe for docs/profiles/crypton/fees.md.

Read-only and unauthenticated, about ten requests.
It looks for a published trading fee in every public place the venue and its listings expose one.
It also reads the venue's own deposit and withdrawal fees from the public currency list.
Run from the repository root with: uv run scripts/probes/venues/crypton/fees-probe.py
"""

import json
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}


def fetch(url: str, data: bytes | None = None):
    req = urllib.request.Request(url, data=data, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main():
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    # The /fees page is a route of the single page app, so the HTML shell carries no numbers.
    status, shell = fetch("https://crp.is/fees")
    print(f"\nGET https://crp.is/fees: HTTP {status}, {len(shell)} bytes, contains a percent sign: {'%' in shell}")
    bundle_path = re.search(r'src="(/static/js/main\.[0-9a-f]+\.chunk\.js)"', shell).group(1)
    status, bundle = fetch("https://crp.is" + bundle_path)
    print(f"GET {bundle_path}: HTTP {status}, {len(bundle)} bytes")
    for pattern in (r'forDeal:"Trading fee[^"]*"', r'config:\{commission:0\}', r'config:a\.config', r'fee:Object\(q\.f\)\(e\)\.commission'):
        hits = re.findall(pattern, bundle)
        print(f"   {pattern!r}: {len(hits)} hit(s), first {hits[:1]}")

    # Public calls that could carry a fee: the session check without a token, the pair list, the currency list.
    status, text = fetch("https://crp.is:8182/user/session/check")
    print(f"\nGET /user/session/check without a token: HTTP {status} {text}")
    status, text = fetch("https://crp.is:8182/market/pairs")
    pair_keys = sorted(json.loads(text)["result"]["pairs"][0]["pair"].keys())
    print(f"GET /market/pairs: HTTP {status}, pair keys {pair_keys}, any fee key: {any('fee' in k for k in pair_keys)}")
    status, text = fetch("https://crp.is:8182/market/curlist")
    print(f"GET /market/curlist: HTTP {status}")
    for name, c in json.loads(text)["result"].items():
        print(f"   {name:<5} deposit_fee={c['deposit_fee']} deposit_min={c['deposit_min']} withdraw_fee={c['withdraw_fee']} "
              f"withdraw_fee_pro={c.get('withdraw_fee_pro')} withdraw_min={c['withdraw_min']} enable={c['enable']}")

    # The API reference, searched for a trading fee.
    status, doc = fetch("https://crp.is/api-doc/")
    text = re.sub(r"<[^>]+>", " ", doc)
    print(f"\nGET https://crp.is/api-doc/: HTTP {status}, {len(doc)} bytes")
    print("   'commission', 'maker' or 'taker' in context:", [" ".join(m.group(0).split()) for m in re.finditer(r".{0,60}(commission|maker|taker).{0,60}", text, re.I)])
    print("   percent signs:", text.count("%"))

    # The launch thread that CoinMarketCap links as the venue's chat.
    status, forum = fetch("https://talk.u.is/viewtopic.php?pid=212")
    flat = " ".join(re.sub(r"<[^>]+>", " ", forum).split())
    print(f"\nGET https://talk.u.is/viewtopic.php?pid=212: HTTP {status}, {len(forum)} bytes")
    print("   trading fee percent statements:", re.findall(r"[^.]{0,80}trad[^.]{0,40}\d+(?:\.\d+)?\s?%[^.]{0,40}", flat)[:3])

    # CoinMarketCap's listing for the venue.
    status, cmc = fetch("https://coinmarketcap.com/exchanges/crypton-exchange/")
    print(f"\nGET coinmarketcap.com/exchanges/crypton-exchange/: HTTP {status}")
    for key in ("makerFee", "takerFee", "spotVolume24h", "perpetualVolume24h", "futuresVolume24h", "dateLaunched"):
        m = re.search(rf'"{key}":("?[^,"]*"?)', cmc)
        print(f"   {key}: {m.group(1) if m else None}")
    m = re.search(r'"urls":\{[^}]*\}', cmc)
    print("   urls:", m.group(0) if m else None)

    # CoinGecko's derivatives venue list, searched for the venue.
    status, text = fetch("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    names = json.loads(text) if status == 200 else []
    hits = [n for n in names if re.search(r"crypton|crp|utopia", n.get("id", "") + n.get("name", ""), re.I)]
    print(f"\nGET coingecko /derivatives/exchanges/list: HTTP {status}, {len(names)} venues, matches {hits}")

    # The 2021 launch press release that third-party listings quote for a 0.1% fee.
    for url in ("https://ambcrypto.com/crypton-exchange-trade-crp-with-no-kyc-or-limits-on-utopia-p2p/",
                "https://blockonomi.com/crypton-exchange-trade-crp-with-no-kyc-or-limits-only-in-utopia-p2p/"):
        status, body = fetch(url)
        hit = re.findall(r"[^.<>]{0,80}0\.1\s?%[^.<>]{0,80}", body)
        print(f"\nGET {url}: HTTP {status}, 0.1% statements {hit[:2]}")
    print("probe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
