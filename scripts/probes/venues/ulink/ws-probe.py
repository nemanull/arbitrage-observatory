# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Ulink (ulinkex.com) WebSocket probe for docs/profiles/ulink/websocket.md.

Public, unauthenticated and read-only, at most eight handshakes and about 75 s of socket time.
  1. A plain GET of the socket path on each candidate host, which reaches the socket server without an upgrade.
  2. A WebSocket handshake to the default Ulink config's ws, wss://www.yyy23hjkk.com/v1/np/ws, see rest-probe.py section 3.
     It sends the subscribe frames the bundle sends for the BTC perpetual book at each aggregation level,
     index, mark, funding and trades, the spot book, an unknown symbol and the other Ulink exId, held 60 s,
     with replies inflated as the bundle inflates them.
     The book frames of each channel are then summarised: level counts, order, and the sequence fields.
  3. A handshake only, opened and closed at once, to the page's own origin and the config's oldws.
Run from the repository root with: uv run scripts/probes/venues/ulink/ws-probe.py
"""

import asyncio
import json
import re
import time
import urllib.error
import urllib.request
import zlib

import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
ORIGIN = "https://ulinkex.com"
MAIN = "wss://www.yyy23hjkk.com/v1/np/ws"  # module 696 config ws, exId Pu8g
OTHERS = [
    "wss://ulinkex.com/v1/np/ws",  # the page's own origin, what a stored localStorage "ws" of ulinkex.com would give
    "wss://www.ulinkex.com/v1/np/ws",
    "wss://www.yyy23hjkk.com/pusher/ws",  # module 696 config oldws
    "wss://ulinkex.com/v1/pusher/ws",  # the older socket path the bundle builds from localStorage
]
HOLD_S = 60
SUBS = [
    "market_Pu8g.btcusdt_depth_level0",  # the bundle's perpetual book, level index 0 to 2 of orderBookLevel [0.1, 1, 10]
    "market_Pu8g.btcusdt_depth_level1",
    "market_Pu8g.btcusdt_depth_level2",
    "market_Pu8g.btcusdt_depth_step0",  # the option module's book channel, sent for comparison
    "market_Pu8g.btcusdt_funding_rate",
    "market_Pu8g.btcusdt_trade_ticker",
    "market_btcusdt_index_price",
    "market_btcusdt_mark_price",
    "market_Pu8g.spot.btcusdt_depth_level0",
    "market_Pu8g.nosuchusdt_depth_level0",
    "market_GjFt.btcusdt_depth_level0",  # the other exId of the Ulink configs
]


def text_of(body):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", body.decode("utf-8", "replace"), flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)).strip()


def plain_get():
    print("== 1. Plain GET of the socket path")
    for url in ("https://ulinkex.com/v1/np/ws", "https://www.yyy23hjkk.com/v1/np/ws"):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                st, hd, body = r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            st, hd, body = e.code, dict(e.headers), e.read()
        except Exception as e:
            st, hd, body = None, {}, f"{type(e).__name__}: {e}".encode()
        keep = {k: v for k, v in hd.items() if k.lower() in ("sec-websocket-version", "x-envoy-upstream-service-time", "x-via", "server", "content-type")}
        print(f"{url}: {st} {keep} body={body[:60]!r}")


def inflate(m):
    if isinstance(m, str):
        return m
    for wbits in (15, -15, 31):
        try:
            return zlib.decompress(m, wbits).decode("utf-8", "replace")
        except zlib.error:
            pass
    return "undecoded " + m[:40].hex()


def summarise_book(name, frames):
    print(f"  {name}: {len(frames)} book frames")
    if not frames:
        return
    keys = sorted({k for f in frames for k in (f.get("tick") or {}).keys()})
    print(f"    tick keys: {keys}, top keys: {sorted(frames[0].keys())}")
    for i, f in enumerate(frames[:3] + frames[-2:]):
        t = f.get("tick") or {}
        b, a = t.get("bids") or [], t.get("asks") or []
        bo = all(float(b[j][0]) > float(b[j + 1][0]) for j in range(len(b) - 1))
        ao = all(float(a[j][0]) < float(a[j + 1][0]) for j in range(len(a) - 1))
        steps = sorted({round(float(b[j][0]) - float(b[j + 1][0]), 6) for j in range(min(len(b) - 1, 10))})
        meta = {k: t.get(k) for k in ("event", "version", "sequence", "price", "symbolName", "ts") if k in t}
        print(f"    frame {i}: bids {len(b)} asks {len(a)} bids descending {bo} asks ascending {ao} best {b[:1]} {a[:1]}"
              f" top bid steps {steps} meta {meta} channel {f.get('channel')}")
    lens = sorted({(len((f.get('tick') or {}).get('bids') or []), len((f.get('tick') or {}).get('asks') or [])) for f in frames})
    print(f"    distinct (bids, asks) lengths: {lens[:10]}")
    seq = [(f.get("tick") or {}).get("sequence") for f in frames]
    steps = [b - a for a, b in zip(seq, seq[1:]) if isinstance(a, int) and isinstance(b, int)]
    print(f"    sequence first 6: {seq[:6]}, distinct {len(set(map(str, seq)))} of {len(seq)}, steps min {min(steps) if steps else None} max {max(steps) if steps else None}")
    # How many of the top ten bid sizes change between consecutive frames at the same price.
    changed = []
    for p, q in zip(frames, frames[1:]):
        pb = {lv[0]: lv[1] for lv in (p.get("tick") or {}).get("bids", [])[:10]}
        qb = {lv[0]: lv[1] for lv in (q.get("tick") or {}).get("bids", [])[:10]}
        same = [k for k in pb if k in qb]
        if same:
            changed.append(sum(pb[k] != qb[k] for k in same) / len(same))
    if changed:
        print(f"    share of top ten bid sizes that changed at an unchanged price: median {sorted(changed)[len(changed) // 2]:.2f}")
    ts = [f.get("ts") for f in frames if isinstance(f.get("ts"), (int, float))]
    if len(ts) > 1:
        gaps = sorted(b - a for a, b in zip(ts, ts[1:]))
        print(f"    ts gaps ms: min {gaps[0]} median {gaps[len(gaps) // 2]} max {gaps[-1]}")


async def hold_main():
    print(f"== 2. {MAIN}, held {HOLD_S} s")
    t0 = time.perf_counter()
    try:
        async with websockets.connect(MAIN, compression=None, open_timeout=15, user_agent_header=UA, origin=ORIGIN, max_size=None) as ws:
            print(f"{MAIN}: OPEN in {(time.perf_counter() - t0) * 1000:.0f} ms, extensions {ws.response.headers.get('Sec-WebSocket-Extensions')}")
            for ch in SUBS:
                await ws.send(json.dumps({"event": "sub", "params": {"channel": ch, "cb_id": "10001001"}}))
            end = time.time() + HOLD_S
            n, books, kinds, shown, index, binary = 0, {}, {}, {}, [], 0
            while time.time() < end:
                try:
                    m = await asyncio.wait_for(ws.recv(), end - time.time())
                except asyncio.TimeoutError:
                    break
                n += 1
                binary += isinstance(m, bytes)
                t = inflate(m)
                try:
                    j = json.loads(t)
                except Exception:
                    j = None
                ch = (j or {}).get("channel") or ("ping" if j and "ping" in j else "other")
                rep = (j or {}).get("event_rep")
                key = f"{ch} {rep}" if rep else ch
                kinds[key] = kinds.get(key, 0) + 1
                if j and "ping" in j:
                    await ws.send(json.dumps({"pong": j["ping"]}))
                if j and "_depth_" in str(j.get("channel")) and j.get("tick"):
                    books.setdefault(j["channel"], []).append(j)
                if j and "_index_price" in str(j.get("channel")) and j.get("data"):
                    index.append(j["data"].get("ip"))
                if shown.get(key, 0) < 2:
                    shown[key] = shown.get(key, 0) + 1
                    print(f"  frame {n} {'binary' if isinstance(m, bytes) else 'text'} {len(m)} bytes: {t[:360]}")
            print(f"  {n} frames in {HOLD_S} s, {binary} binary, by channel and event_rep:")
            for k, v in sorted(kinds.items()):
                print(f"    {k}: {v}")
            for name, frames in books.items():
                summarise_book(name, frames)
            lv0 = books.get("market_saas.btcusdt_depth_level0") or next(iter(books.values()), [])
            if lv0 and index:
                bid = lv0[0]["tick"]["bids"][0][0]
                print(f"  first level0 best bid {bid} against first index {index[0]}: {(bid / index[0] - 1) * 1e4:.2f} bp")
    except websockets.exceptions.InvalidStatus as e:
        print(f"{MAIN}: HTTP {e.response.status_code} {text_of(e.response.body or b'')[:200]}")
    except Exception as e:
        print(f"{MAIN}: {type(e).__name__}: {str(e)[:200]}")


async def handshake_only(url):
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, compression=None, open_timeout=15, user_agent_header=UA, origin=ORIGIN):
            print(f"{url}: OPEN in {(time.perf_counter() - t0) * 1000:.0f} ms, closed again at once")
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        hd = {k: v for k, v in r.headers.raw_items() if k.lower() in ("x-via", "server", "content-type", "content-length")}
        print(f"{url}: HTTP {r.status_code} in {(time.perf_counter() - t0) * 1000:.0f} ms {hd} body text: {text_of(r.body or b'')[:200]}")
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {str(e)[:160]}")


async def main():
    plain_get()
    await hold_main()
    print("== 3. Handshake only")
    for url in OTHERS:
        await handshake_only(url)


asyncio.run(main())
