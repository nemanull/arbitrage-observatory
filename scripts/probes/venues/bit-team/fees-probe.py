# /// script
# requires-python = ">=3.11"
# dependencies = ["ccxt==4.5.68"]
# ///
"""Read-only public fee and coverage probe for BIT.TEAM, spot only.

Modes, all by default, or name some on the command line:
    pairs     makerFee and takerFee of every pair in /trade/api/ccxt/pairs, grouped by status, and the web app's scale.
    private   the BTT discount endpoints, called without credentials, to record their refusal.
    coverage  CoinMarketCap's exchange record and pair counts by category, CoinGecko's derivatives venue list,
              and the fee page CoinMarketCap names.
    ccxt      the Python ccxt 4.5.68 bitteam class: load_markets without keys and read taker and maker on every market.

Every call is a public GET, about 15 in total.

Run from the repository root:
    uv run scripts/probes/venues/bit-team/fees-probe.py [mode ...]
"""

import json
import socket
import sys
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return None, repr(e).encode()


def pairs():
    print("== pairs")
    status, body = get("https://bit.team/trade/api/ccxt/pairs")
    ps = json.loads(body)["result"]["pairs"]
    print(f"ccxt/pairs HTTP {status}, {len(ps)} pairs")
    groups = {}
    for p in ps:
        groups.setdefault((p["status"], p["makerFee"], p["takerFee"]), []).append(p["name"])
    for (st, mk, tk), names in sorted(groups.items()):
        # The web app reads the fee as new BigNumber(takerFee).shiftedBy(-5), so 200 is 0.002.
        print(f"status {st}: makerFee {mk} takerFee {tk}, fraction {tk / 1e5}, ppm {tk * 10}, pairs {len(names)} {sorted(names)}")


def private():
    print("== private")
    for path in ["/trade/api/discounts", "/trade/api/discount", "/trade/api/user/stats"]:
        status, body = get("https://bit.team" + path)
        print(f"GET {path}: HTTP {status} {body[:200].decode(errors='replace')}")


def coverage():
    print("== coverage")
    status, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bit-team")
    d = json.loads(body)["data"]
    print(f"CMC detail HTTP {status}: id {d['id']}, name {d['name']}, makerFee {d.get('makerFee')}, takerFee {d.get('takerFee')}, "
          f"fee url {d['urls'].get('fee')}, launched {d.get('dateLaunched')}")
    print(f"CMC quote USD: {json.dumps(d['quote'].get('2781'))}")
    desc = d.get("description", "")
    i = desc.find("fee")
    print(f"CMC description, fee sentence: {desc[max(0, desc.rfind('.', 0, i) + 1):desc.find('.', desc.find('BTT'))+1].strip()!r}")
    for cat in ["spot", "perpetual", "futures"]:
        status, body = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bit-team&category={cat}&start=1&limit=100")
        dd = json.loads(body)["data"]
        print(f"CMC market pairs {cat}: HTTP {status}, numMarketPairs {dd.get('numMarketPairs')}, listed {len(dd.get('marketPairs', []))}")
        time.sleep(1)
    status, body = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    lst = json.loads(body)
    hits = [x for x in lst if "team" in (x["id"] + x["name"]).lower()]
    print(f"CoinGecko derivatives list HTTP {status}: {len(lst)} venues, matching team {hits}")
    try:
        socket.getaddrinfo("p2p.bit.team", 443)
        status, body = get("https://p2p.bit.team/pricing")
        print(f"p2p.bit.team/pricing HTTP {status}, {len(body)} bytes")
    except Exception as e:
        print(f"p2p.bit.team/pricing: DNS {e!r}")


def ccxt_mode():
    print("== ccxt")
    import ccxt

    ex = ccxt.bitteam()
    markets = ex.load_markets()
    print(f"ccxt {ccxt.__version__}, {len(markets)} markets, class fees.trading {json.dumps(ex.fees['trading'], default=str)}")
    seen = {}
    for sym, m in markets.items():
        seen.setdefault((m["taker"], m["maker"], m["active"], m["type"], m["swap"]), []).append(sym)
    for k, v in sorted(seen.items(), key=lambda kv: str(kv[0])):
        print(f"taker {k[0]} maker {k[1]} active {k[2]} type {k[3]} swap {k[4]}: {len(v)} markets")
    m = markets.get("BTC/USDT")
    print(f"BTC/USDT: taker {m['taker']}, maker {m['maker']}, precision {m['precision']}, info.takerFee {m['info'].get('takerFee')}")


MODES = {"pairs": pairs, "private": private, "coverage": coverage, "ccxt": ccxt_mode}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    print(f"run at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    for name in chosen:
        MODES[name]()
