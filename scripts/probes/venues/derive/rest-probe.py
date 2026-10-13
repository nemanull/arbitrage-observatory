# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx==0.28.1"]
# ///
"""Public, read-only REST probe of Derive for the venue profile.

Run from the repository root:
    uv run scripts/probes/venues/derive/rest-probe.py <mode>

Modes: host, catalog, anchor, errors, legacy, funding, identity, all.
Every Derive call is an unauthenticated JSON-RPC POST, apart from one GET that checks whether GET works.
Calls are paced to stay under 2 requests a second, well inside the documented public budget of 5 per second per IP.
Mode identity also reads Bybit's public linear tickers once, to compare each index with another venue's.
Captures go to .claude/survey-work/derive/cap/ unless DERIVE_CAP names another folder.
"""

import json
import os
import socket
import statistics
import sys
import time
from pathlib import Path

import httpx

V3 = "https://api.derive.xyz/v3"
V2 = "https://api.lyra.finance"  # the host CCXT 4.5.68 calls
CAP = Path(os.environ.get("DERIVE_CAP", ".claude/survey-work/derive/cap"))
PACE = 0.6  # seconds between two calls outside the anchor loop


def now_ms() -> int:
    return int(time.time() * 1000)


def iso(ms: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + f".{ms % 1000:03d}Z"


def save(name: str, body) -> None:
    CAP.mkdir(parents=True, exist_ok=True)
    (CAP / name).write_text(json.dumps(body, indent=1) if not isinstance(body, str) else body)


def post(client: httpx.Client, base: str, method: str, params: dict | None = None):
    url = f"{base}/{method}"
    t0 = time.perf_counter()
    sent = now_ms()
    r = client.post(url, json=params if params is not None else {})
    ms = (time.perf_counter() - t0) * 1000
    try:
        body = r.json()
    except ValueError:
        body = r.text[:500]
    return r, body, ms, sent


def pct(values, q):
    values = sorted(values)
    if not values:
        return None
    k = max(0, min(len(values) - 1, round(q * (len(values) - 1))))
    return values[k]


def mode_host() -> None:
    print("## host")
    for host in ["api.derive.xyz", "api.lyra.finance"]:
        addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        print(f"dns {host}: {addrs}")
    for base in [V3, V2]:
        with httpx.Client(timeout=15) as client:
            r, body, ms, _ = post(client, base, "public/get_time")
            keep = {k: v for k, v in r.headers.items() if k in ("server", "cf-ray", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "content-encoding", "vary", "allow")}
            print(f"cold {base} get_time: status {r.status_code}, {ms:.0f} ms, headers {keep}, body {json.dumps(body)[:120]}")
            warm = []
            for _ in range(10):
                time.sleep(PACE)
                r, body, ms, _ = post(client, base, "public/get_time")
                warm.append(ms)
            print(f"warm {base} get_time x10: min {min(warm):.0f}, median {statistics.median(warm):.0f}, max {max(warm):.0f} ms")
        time.sleep(PACE)


def mode_catalog() -> None:
    print("## catalog")
    with httpx.Client(timeout=20) as client:
        counts = {}
        for kind in ["perp", "erc20", "option"]:
            r, body, ms, _ = post(client, V3, "public/get_all_instruments", {"expired": False, "instrument_type": kind, "page_size": 1000})
            res = body.get("result", {}) if isinstance(body, dict) else {}
            ins = res.get("instruments", [])
            counts[kind] = (len(ins), sum(1 for i in ins if i.get("is_active")), res.get("pagination"))
            print(f"get_all_instruments {kind}: status {r.status_code}, {ms:.0f} ms, {len(r.content)} bytes, rows {len(ins)}, active {counts[kind][1]}, pagination {res.get('pagination')}, error {body.get('error') if isinstance(body, dict) else None}")
            if kind == "perp":
                save("catalog_perp_v3.json", body)
                perps = ins
            if kind == "option" and ins:
                print(f"  option currencies: {sorted({i['base_currency'] for i in ins})}")
            if kind == "erc20" and ins:
                print(f"  spot names: {sorted(i['instrument_name'] for i in ins)}")
            time.sleep(PACE)
        print("perp rows:")
        for i in sorted(perps, key=lambda i: i["instrument_name"]):
            pd = i.get("perp_details") or {}
            srm = pd.get("srm_perp_margin_requirements")
            print(
                f"  {i['instrument_name']}: base {i['base_currency']}, quote {i['quote_currency']}, active {i['is_active']}, "
                f"tick {i['tick_size']}, step {i['amount_step']}, min {i['minimum_amount']}, max {i['maximum_amount']}, "
                f"taker {i['taker_fee_rate']}, maker {i['maker_fee_rate']}, base_fee {i['base_fee']}, "
                f"index {pd.get('index')}, rate cap {pd.get('max_rate_per_hour')}/{pd.get('min_rate_per_hour')}, "
                f"funding_rate {pd.get('funding_rate')}, srm {srm}, activation {i['scheduled_activation']}, "
                f"deactivation {i['scheduled_deactivation']}, risk_universe_id {i.get('risk_universe_id', 'absent')}"
            )
        names = [i["instrument_name"] for i in perps]
        print(f"names with a universe suffix: {[n for n in names if not n.endswith('-PERP')]}")
        print(f"base currencies listed twice: {sorted({b for b in [i['base_currency'] for i in perps] if [i['base_currency'] for i in perps].count(b) > 1})}")
        print(f"key sets: {sorted({tuple(sorted(i.keys())) for i in perps})}")
        r, body, ms, _ = post(client, V3, "public/get_all_live_instruments")
        live = body.get("result") if isinstance(body, dict) else None
        live_perps = [n for n in (live or []) if isinstance(n, str) and "PERP" in n] if isinstance(live, list) else live
        print(f"get_all_live_instruments: status {r.status_code}, {ms:.0f} ms, type {type(live).__name__}, perps {live_perps if isinstance(live_perps, list) else str(live)[:300]}")
        time.sleep(PACE)
        r, body, ms, _ = post(client, V3, "public/get_risk_universes")
        save("risk_universes_v3.json", body)
        res = body.get("result") if isinstance(body, dict) else None
        unis = res.get("risk_universes", res) if isinstance(res, dict) else res
        print(f"get_risk_universes: status {r.status_code}, {ms:.0f} ms, {len(r.content)} bytes, top keys {list(res.keys()) if isinstance(res, dict) else type(res).__name__}")
        if isinstance(unis, list):
            for u in unis:
                perp_names = set()
                for m in u.get("managers", []) or []:
                    for k in ("instruments", "derivatives", "perps"):
                        for x in m.get(k, []) or []:
                            n = x if isinstance(x, str) else (x.get("instrument_name") or x.get("currency") or x.get("name"))
                            if n:
                                perp_names.add(str(n))
                print(f"  universe {u.get('risk_universe_id', u.get('id'))} {u.get('name')}: managers {[m.get('manager_type', m.get('type')) for m in u.get('managers', []) or []]}, derivatives {sorted(perp_names)[:40]}")
        time.sleep(PACE)
        r, body, ms, _ = post(client, V3, "public/get_instrument", {"instrument_name": "BTC-PERP"})
        res = body.get("result", {}) if isinstance(body, dict) else {}
        print(f"get_instrument BTC-PERP: status {r.status_code}, {ms:.0f} ms, risk_universe_id {res.get('risk_universe_id', 'absent')}, quote {res.get('quote_currency')}")


def mode_anchor(polls: int = 60) -> None:
    print("## anchor")
    with httpx.Client(timeout=10) as client:
        prev = {}
        changes = {}
        ages = {}
        times, sizes = [], []
        first = None
        btc_trace = []  # (poll, age of t at arrival in ms, index) for BTC-PERP
        for n in range(polls):
            start = time.monotonic()
            r, body, ms, sent = post(client, V3, "public/get_tickers", {"instrument_type": "perp"})
            recv = now_ms()
            times.append(ms)
            sizes.append(len(r.content))
            tick = body.get("result", {}).get("tickers", {}) if isinstance(body, dict) else {}
            if first is None:
                first = body
                save("tickers_perp_v3.json", body)
            if "BTC-PERP" in tick:
                btc_trace.append((n, recv - int(tick["BTC-PERP"]["t"]), tick["BTC-PERP"]["I"]))
            for name, t in tick.items():
                ages.setdefault(name, []).append(recv - int(t["t"]))
                c = changes.setdefault(name, {"I": 0, "M": 0, "f": 0, "t": 0, "b": 0, "a": 0})
                if name in prev:
                    for k in c:
                        if t.get(k) != prev[name].get(k):
                            c[k] += 1
                prev[name] = t
            time.sleep(max(0.0, 1.0 - (time.monotonic() - start)))
        print(f"get_tickers perp x{polls}: status {r.status_code}, rows {len(prev)}, bytes min {min(sizes)} max {max(sizes)}, ms min {min(times):.0f} median {statistics.median(times):.0f} p90 {pct(times, 0.9):.0f} max {max(times):.0f}")
        print(f"BTC-PERP age of t at arrival per poll, ms: {[a for _, a, _ in btc_trace]}")
        every = [a for row in ages.values() for a in row]
        print(f"all perps, age of t at arrival: median {statistics.median(every):.0f}, p90 {pct(every, 0.9)}, max {max(every)}, share over 10 s {sum(1 for a in every if a > 10_000) / len(every):.3f}")
        print("per perp, changes over the polls and age of t at arrival in ms:")
        for name in sorted(changes):
            a = ages[name]
            print(f"  {name}: changes {changes[name]}, age min {min(a)} median {statistics.median(a):.0f} max {max(a)}")
        last = prev
        print("last row per perp: I, M, f, b, a, minp, maxp:")
        for name in sorted(last):
            t = last[name]
            print(f"  {name}: I {t['I']} M {t['M']} f {t.get('f')} b {t['b']} a {t['a']} minp {t['minp']} maxp {t['maxp']} mark/index-1 {float(t['M']) / float(t['I']) - 1:+.6f}" if float(t["I"]) else f"  {name}: index 0 {t}")
        time.sleep(PACE)
        r, body, ms, _ = post(client, V3, "public/get_ticker", {"instrument_name": "BTC-PERP"})
        print(f"get_ticker BTC-PERP: status {r.status_code}, {ms:.0f} ms, {len(r.content)} bytes, keys {sorted(body.get('result', {}).keys()) if isinstance(body, dict) else body}")
        time.sleep(PACE)
        r, body, ms, _ = post(client, V3, "public/get_all_instruments", {"expired": False, "instrument_type": "perp"})
        rates = {i["instrument_name"]: i["perp_details"]["funding_rate"] for i in body["result"]["instruments"]}
        print(f"instrument funding_rate against ticker f: {[(k, rates[k], last[k].get('f')) for k in sorted(rates)]}")
        time.sleep(PACE)
        end = now_ms()
        r, body, ms, _ = post(client, V3, "public/get_funding_rate_history", {"instrument_name": "BTC-PERP", "start_timestamp": end - 24 * 3600 * 1000, "end_timestamp": end})
        save("funding_history_btc_v3.json", body)
        res = body.get("result", {}) if isinstance(body, dict) else {}
        rows = res.get("funding_rate_history", []) if isinstance(res, dict) else []
        print(f"get_funding_rate_history BTC-PERP 24 h: status {r.status_code}, {ms:.0f} ms, rows {len(rows)}, keys {sorted(rows[0].keys()) if rows else None}")
        for row in rows[-3:]:
            print(f"  {iso(int(row['timestamp']))} {row}")
        if rows:
            ts = [int(x["timestamp"]) for x in rows]
            steps = sorted({b - a for a, b in zip(ts, ts[1:])})
            print(f"  step between rows ms: {steps[:5]}, on the hour: {sum(1 for t in ts if t % 3_600_000 == 0)} of {len(ts)}")
        time.sleep(PACE)
        r, body, ms, _ = post(client, V3, "public/get_latest_signed_feeds", {"currency": "BTC", "expiry": 0})
        save("signed_feeds_btc_v3.json", body)
        res = body.get("result", {}) if isinstance(body, dict) else {}
        print(f"get_latest_signed_feeds BTC expiry 0: status {r.status_code}, {ms:.0f} ms, {len(r.content)} bytes, top keys {sorted(res.keys()) if isinstance(res, dict) else res}")
        recv = now_ms()
        if isinstance(res, dict):
            for kind, feeds in res.items():
                items = feeds.get("BTC", feeds) if isinstance(feeds, dict) else feeds
                if isinstance(items, dict) and "timestamp" not in items:
                    items = list(items.values())
                if isinstance(items, dict):
                    items = [items]
                for f in (items or [])[:2]:
                    if isinstance(f, dict):
                        sigs = f.get("signatures") or {}
                        stamp = int(f["timestamp"]) if f.get("timestamp") else None
                        stamp_ms = stamp * 1000 if stamp and stamp < 10**11 else stamp  # the feeds stamp whole seconds
                        print(f"  {kind}: keys {sorted(f.keys())}, value {f.get('price', f.get('spot_diff_value', f.get('funding_rate')))}, confidence {f.get('confidence')}, timestamp {stamp}, age ms {recv - stamp_ms if stamp_ms else None}, deadline {f.get('deadline')}, signers {sigs.get('signers') if isinstance(sigs, dict) else None}")


def mode_errors() -> None:
    print("## errors")
    with httpx.Client(timeout=10) as client:
        cases = [
            ("public/get_ticker", {"instrument_name": "NOPE-PERP"}),
            ("public/get_tickers", {"instrument_type": "perp", "currency": "NOPE"}),
            ("public/get_tickers", {"instrument_type": "swap"}),
            ("public/no_such_method", {}),
            ("public/getRateLimits", {}),
        ]
        for method, params in cases:
            r, body, ms, _ = post(client, V3, method, params)
            limit = {k: v for k, v in r.headers.items() if k.startswith("x-ratelimit")}
            print(f"{method} {params}: status {r.status_code}, {ms:.0f} ms, headers {limit}, body {json.dumps(body)[:900 if 'getRateLimits' in method else 300]}")
            time.sleep(PACE)
        for base in [V3, V2]:
            r, body, ms, _ = post(client, base, "public/get_live_incidents")
            print(f"{base} get_live_incidents: status {r.status_code}, body {json.dumps(body)[:300]}")
            time.sleep(PACE)
        r = client.post(f"{V3}/public/get_time", content=b"{not json", headers={"content-type": "application/json"})
        print(f"malformed JSON body: status {r.status_code}, body {r.text[:300]}")
        time.sleep(PACE)
        r = client.get(f"{V3}/public/get_time")
        print(f"GET get_time: status {r.status_code}, body {r.text[:200]}")
        time.sleep(PACE)
        offsets = []
        for _ in range(5):
            t0 = now_ms()
            r, body, ms, _ = post(client, V3, "public/get_time")
            t1 = now_ms()
            offsets.append(int(body["result"]) - (t0 + t1) // 2)
            time.sleep(PACE)
        print(f"server minus local clock at the request midpoint, ms: {offsets}")


def mode_legacy() -> None:
    print("## legacy")
    with httpx.Client(timeout=15) as client:
        r, body, ms, _ = post(client, V2, "public/get_time")
        print(f"v2 get_time: status {r.status_code}, {ms:.0f} ms, server minus local {int(body['result']) - now_ms()} ms")
        time.sleep(PACE)
        r, body, ms, _ = post(client, V2, "public/get_all_instruments", {"expired": False, "instrument_type": "perp"})
        ins = body["result"]["instruments"]
        save("catalog_perp_v2.json", body)
        print(f"v2 perps: {len(ins)}, quotes {sorted({i['quote_currency'] for i in ins})}, names {sorted(i['instrument_name'] for i in ins)}")
        time.sleep(PACE)
        r, body, ms, _ = post(client, V2, "public/get_tickers", {"instrument_type": "perp"})
        print(f"v2 get_tickers perp: status {r.status_code}, body {json.dumps(body)[:200]}")
        time.sleep(PACE)
        for _ in range(3):
            r, body, ms, _ = post(client, V2, "public/get_ticker", {"instrument_name": "BTC-PERP"})
            t = body["result"]
            print(f"v2 get_ticker BTC-PERP: timestamp {t['timestamp']}, index {t['index_price']}, mark {t['mark_price'][:12]}, bid {t['best_bid_price']}, ask {t['best_ask_price']}")
            time.sleep(2)
        last_trades = {}
        for i in sorted(ins, key=lambda i: i["instrument_name"]):
            name = i["instrument_name"]
            r, body, ms, _ = post(client, V2, "public/get_trade_history", {"instrument_name": name, "page_size": 1})
            trades = body.get("result", {}).get("trades", []) if isinstance(body, dict) else []
            last_trades[name] = iso(int(trades[0]["timestamp"])) if trades else None
            time.sleep(PACE)
        print(f"v2 newest trade per perp: {last_trades}")
        print(f"newest of all: {max(v for v in last_trades.values() if v)}")


def mode_funding() -> None:
    print("## funding")
    start = 1791295200000  # 2026-10-06T14:00Z, four hours before the first v3 row
    with httpx.Client(timeout=15) as client:
        r, body, ms, _ = post(client, V3, "public/get_all_instruments", {"expired": False, "instrument_type": "perp"})
        names = sorted(i["instrument_name"] for i in body["result"]["instruments"])
        for name in names:
            time.sleep(PACE)
            r, body, ms, _ = post(client, V3, "public/get_funding_rate_history", {"instrument_name": name, "start_timestamp": start, "end_timestamp": now_ms()})
            rows = body.get("result", {}).get("funding_rate_history", []) if isinstance(body, dict) else []
            if not rows:
                print(f"  {name}: no rows, body {json.dumps(body)[:200]}")
                continue
            static = sum(1 for x in rows if x["open"] == x["close"] == x["high"] == x["low"] == "0.000012500")
            print(
                f"  {name}: rows {len(rows)}, first {iso(int(rows[0]['timestamp']))}, last {iso(int(rows[-1]['timestamp']))}, "
                f"hours at the static 0.000012500 throughout {static}, highest {max(float(x['high']) for x in rows):.9f}, lowest {min(float(x['low']) for x in rows):.9f}"
            )


def mode_identity() -> None:
    # One public Bybit call, to see whether each Derive ticker names the token other venues list under it.
    print("## identity")
    with httpx.Client(timeout=20) as client:
        r, body, ms, _ = post(client, V3, "public/get_tickers", {"instrument_type": "perp"})
        derive = body["result"]["tickers"]
        time.sleep(PACE)
        r = client.get("https://api.bybit.com/v5/market/tickers", params={"category": "linear"})
        rows = {t["symbol"]: t for t in r.json()["result"]["list"]}
        print(f"bybit linear tickers: status {r.status_code}, rows {len(rows)}")
        for name in sorted(derive):
            base = name.removesuffix("-PERP")
            index = float(derive[name]["I"])
            ref = rows.get(f"{base}USDT")
            if ref is None:
                near = sorted(sym for sym in rows if sym.startswith(base) and sym.endswith("USDT"))
                print(f"  {name}: index {index}, no {base}USDT on bybit, symbols starting {base}: {[(sym, rows[sym].get('indexPrice')) for sym in near]}")
                continue
            ref_index = float(ref.get("indexPrice") or 0)
            print(f"  {name}: derive index {index}, bybit {base}USDT index {ref_index}, ratio {index / ref_index if ref_index else float('nan'):.4f}")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"# derive rest-probe {mode} at {iso(now_ms())}")
    modes = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "errors": mode_errors, "legacy": mode_legacy, "funding": mode_funding, "identity": mode_identity}
    for name, fn in modes.items():
        if mode in (name, "all"):
            fn()
            time.sleep(1)
    print(f"# done at {iso(now_ms())}")


if __name__ == "__main__":
    main()
