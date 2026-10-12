# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""SunX (sunx.vip) WebSocket probe for docs/profiles/sunx/websocket.md.

Public, unauthenticated and read-only, at most ten handshakes and about 80 s of socket time.
  1. A plain GET of the socket path on each candidate host, which reaches the socket server without an upgrade.
  2. A WebSocket handshake to every URL the live bundle can pick for the SunX tenant:
     the two SunX tenant configs' ws and oldws, and the page's own origin through the localStorage "ws" override.
     On the first socket that opens, the subscribe frames the bundle sends for the BTC perpetual book,
     index, funding and trades, for both SunX exIds, held 60 s, with replies inflated as the bundle inflates them.
     The book frames are then summarised: level counts, order, and the sequence fields.
  3. A handshake only, opened and closed at once, to every other candidate URL.
  4. The namesake SunX DEX at api.sunx.io, a different venue, held 15 s on its documented incremental book channel.
Run from the repository root with: uv run scripts/probes/venues/sunx/ws-probe.py
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
ORIGIN = "https://sunx.vip"
EX_IDS = ("FaJ6", "Ch3Q")  # the two configs in app.86f4b977.js that carry the SunX invitation image, see rest-probe.py section 3
URLS = [
    "wss://www.31976.me/v1/np/ws",  # FaJ6 config ws, written with a trailing space in the bundle
    "wss://ws.31976.me",  # FaJ6 config oldws
    "wss://www.sun3259.me/v1/np/ws",  # Ch3Q config ws, written as "wss://www.sun3259.mev1/np/ws" in the bundle
    "wss://www.sun3259.me",  # Ch3Q config oldws
    "wss://sunx.vip/v1/np/ws",  # the page's own origin
    "wss://www.sunx.vip/v1/np/ws",
    "wss://sunx.vip/v1/pusher/ws",  # the older socket path
]
HOLD_S = 60


def subs():
    out = []
    for ex in EX_IDS:
        out += [f"market_{ex}.btcusdt_depth_step0", f"market_{ex}.btcusdt_funding_rate", f"market_{ex}.btcusdt_trade_ticker"]
    out += ["market_btcusdt_index_price", "market_FaJ6.nosuchusdt_depth_step0"]
    return out


def text_of(body):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", body.decode("utf-8", "replace"), flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)).strip()


def plain_get():
    print("== 1. Plain GET of the socket path")
    for url in ("https://sunx.vip/v1/np/ws", "https://www.31976.me/v1/np/ws", "https://www.sun3259.me/v1/np/ws"):
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


def summarise_book(frames):
    print(f"  book frames: {len(frames)}")
    if not frames:
        return
    keys = sorted({k for f in frames for k in (f.get("tick") or {}).keys()})
    print(f"  tick keys: {keys}, top keys: {sorted(frames[0].keys())}")
    for i, f in enumerate(frames[:3] + frames[-2:]):
        t = f.get("tick") or {}
        b, a = t.get("bids") or [], t.get("asks") or []
        bo = all(float(b[j][0]) > float(b[j + 1][0]) for j in range(len(b) - 1))
        ao = all(float(a[j][0]) < float(a[j + 1][0]) for j in range(len(a) - 1))
        meta = {k: t.get(k) for k in ("event", "version", "sequence", "price", "symbolName", "mrid", "id", "ts") if k in t}
        print(f"  frame {i}: bids {len(b)} asks {len(a)} bids descending {bo} asks ascending {ao} best {b[:1]} {a[:1]} meta {meta} top ts {f.get('ts')}")
    lens = sorted({(len((f.get('tick') or {}).get('bids') or []), len((f.get('tick') or {}).get('asks') or [])) for f in frames})
    print(f"  distinct (bids, asks) lengths: {lens[:10]}")
    ts = [f.get("ts") or (f.get("tick") or {}).get("ts") for f in frames]
    ts = [x for x in ts if isinstance(x, (int, float))]
    seq = [(f.get("tick") or {}).get("sequence") for f in frames]
    print(f"  sequence values, first 8: {seq[:8]}, distinct {len(set(map(str, seq)))} of {len(seq)}")
    if len(ts) > 1:
        gaps = sorted(b - a for a, b in zip(ts, ts[1:]))
        print(f"  ts gaps ms: min {gaps[0]} median {gaps[len(gaps) // 2]} max {gaps[-1]}")


async def try_url(url):
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, compression=None, open_timeout=15, user_agent_header=UA,
                                      origin=ORIGIN, max_size=None) as ws:
            print(f"{url}: OPEN in {(time.perf_counter() - t0) * 1000:.0f} ms, extensions {ws.response.headers.get('Sec-WebSocket-Extensions')}")
            for ch in subs():
                await ws.send(json.dumps({"event": "sub", "params": {"channel": ch, "cb_id": "10001001"}}))
            end = time.time() + HOLD_S
            n, book, kinds, shown = 0, [], {}, 0
            while time.time() < end:
                try:
                    m = await asyncio.wait_for(ws.recv(), end - time.time())
                except asyncio.TimeoutError:
                    break
                n += 1
                t = inflate(m)
                try:
                    j = json.loads(t)
                except Exception:
                    j = None
                ch = (j or {}).get("channel") or ("ping" if j and "ping" in j else (j or {}).get("event_rep") or "other")
                kinds[ch] = kinds.get(ch, 0) + 1
                if j and "ping" in j:
                    await ws.send(json.dumps({"pong": j["ping"]}))
                if j and "_depth_step0" in str(j.get("channel")) and j.get("tick"):
                    book.append(j)
                if shown < 25 or (j and "ping" in j and kinds[ch] <= 2):
                    shown += 1
                    print(f"  frame {n} {'binary' if isinstance(m, bytes) else 'text'} {len(m)} bytes: {t[:400]}")
            print(f"  {n} frames in {HOLD_S} s, by channel: {kinds}")
            summarise_book(book)
            return True
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        hd = {k: v for k, v in r.headers.raw_items() if k.lower() in ("x-via", "x-ws-request-id", "server", "content-type", "content-length", "cf-ray")}
        msg = text_of(r.body or b"")
        print(f"{url}: HTTP {r.status_code} in {(time.perf_counter() - t0) * 1000:.0f} ms {hd}")
        print(f"  body text: {msg[:220]}")
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {str(e)[:200]} after {(time.perf_counter() - t0) * 1000:.0f} ms")
    return False


async def handshake_only(url):
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, compression=None, open_timeout=15, user_agent_header=UA, origin=ORIGIN) as ws:
            print(f"{url}: OPEN in {(time.perf_counter() - t0) * 1000:.0f} ms, closed again at once")
    except websockets.exceptions.InvalidStatus as e:
        print(f"{url}: HTTP {e.response.status_code} {text_of(e.response.body or b'')[:160]}")
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {str(e)[:160]}")


async def main():
    plain_get()
    print("== 2. WebSocket handshakes, the first socket that opens is held")
    held = None
    for url in URLS:
        if await try_url(url):
            held = url
            break
    print("== 3. Handshake only, every other URL")
    for url in URLS:
        if url != held:
            await handshake_only(url)
    await namesake()


async def namesake():
    print("== 4. Namesake SunX DEX, wss://api.sunx.io/ws/v1/market")
    url = "wss://api.sunx.io/ws/v1/market"
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, compression=None, open_timeout=15, user_agent_header=UA, max_size=None) as ws:
            print(f"{url}: OPEN in {(time.perf_counter() - t0) * 1000:.0f} ms")
            await ws.send(json.dumps({"sub": "market.BTC-USDT.depth.size_20.high_freq", "data_type": "incremental", "id": "p1"}))
            await ws.send(json.dumps({"sub": "market.NOSUCH-USDT.depth.size_20.high_freq", "data_type": "incremental", "id": "p2"}))
            end, n, versions, events = time.time() + 15, 0, [], {}
            while time.time() < end:
                try:
                    m = await asyncio.wait_for(ws.recv(), end - time.time())
                except asyncio.TimeoutError:
                    break
                n += 1
                t = inflate(m)
                j = json.loads(t)
                if "ping" in j:
                    await ws.send(json.dumps({"pong": j["ping"]}))
                tick = j.get("tick") or {}
                if tick:
                    versions.append(tick.get("version"))
                    events[tick.get("event")] = events.get(tick.get("event"), 0) + 1
                if n <= 4 or "err-msg" in t or "ping" in j and n < 40:
                    print(f"  frame {n} {'binary' if isinstance(m, bytes) else 'text'} {len(m)} bytes: {t[:300]}")
            gaps = [b - a for a, b in zip(versions, versions[1:]) if isinstance(a, int) and isinstance(b, int)]
            print(f"  {n} frames, events {events}, version steps {sorted(set(gaps))[:8]}")
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {str(e)[:200]}")


asyncio.run(main())
