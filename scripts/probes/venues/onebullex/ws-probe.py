# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=14"]
# ///
"""Read-only WebSocket probe for OneBullEx futures.

Public, unauthenticated, read-only.
Sockets open without permessage-deflate and without protocol pings, like the engine's book feeds, except in mode deflate.
Two sockets are probed.
The documented open API socket wss://openapi.onebullex.com/fstream/ws/open, whose doc says every channel needs a signed key.
The website's own market socket wss://gateway.onebullex.com/ws/market, undocumented, which pushes protobuf frames.
The protobuf schemas are the ones in the website bundle, decoded here by hand with no protobuf library.

Modes, each printing one JSON line per finding:
    open      the documented socket, a PRICE subscribe with a dummy key and then with an empty key, 40 s.
    book      the website socket on btc_usdt with every public topic, an unknown symbol and a second contract, 45 s, then two bad topics.
              A book rebuilt from depth_update is checked against each depth_full.
    batch     depth_update and depth_full on every listed contract on one socket for 30 s.
    silence   one website socket that subscribes nothing and sends nothing, up to 65 s, and one that sends "ping" every 20 s.
    deflate   asks the website socket for permessage-deflate once and prints what it negotiates.
    all       every mode above in turn, about four minutes of sockets.

Run from the repository root:
    uv run scripts/probes/venues/onebullex/ws-probe.py [open|book|batch|silence|deflate|all]

Recorded in docs/profiles/onebullex/websocket.md.
"""

import asyncio
import collections
import json
import statistics
import sys
import time
import urllib.request

import websockets

OPEN_URL = "wss://openapi.onebullex.com/fstream/ws/open"
GATEWAY_URL = "wss://gateway.onebullex.com/ws/market"
REST = "https://futures-openapi.onebullex.com"
BATCH_S = 30
SILENCE_S = 65


def emit(kind, **fields):
    print(json.dumps({"kind": kind, **fields}, ensure_ascii=False), flush=True)


def varint(buf, i):
    shift = result = 0
    while True:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, i
        shift += 7


def fields(buf):
    """Decode one protobuf message into {field number: [raw values]}."""
    out = collections.defaultdict(list)
    i = 0
    while i < len(buf):
        key, i = varint(buf, i)
        no, wt = key >> 3, key & 7
        if wt == 0:
            v, i = varint(buf, i)
        elif wt == 2:
            n, i = varint(buf, i)
            v, i = bytes(buf[i:i + n]), i + n
        elif wt == 1:
            v, i = bytes(buf[i:i + 8]), i + 8
        elif wt == 5:
            v, i = bytes(buf[i:i + 4]), i + 4
        else:
            raise ValueError(f"wire type {wt}")
        out[no].append(v)
    return out


def s(f, no):
    return f[no][0].decode() if no in f else ""


def n(f, no):
    return f[no][0] if no in f else 0


def levels(f, no):
    return [[x.decode() for x in fields(item)[1]] for item in f.get(no, [])]


def decode(frame):
    """PushMessage {1 channel, 2 event, 3 google.protobuf.Any {1 type_url, 2 value}}."""
    top = fields(frame)
    channel, event = s(top, 1), s(top, 2)
    anyf = fields(top[3][0]) if 3 in top else {}
    type_url = s(anyf, 1)
    v = fields(anyf[2][0]) if 2 in anyf else {}
    if channel == "depth_full":  # DeepFullVO {1 s, 2 id, 3 a, 4 b}
        body = {"s": s(v, 1), "id": s(v, 2), "a": levels(v, 3), "b": levels(v, 4)}
    elif channel == "depth_update":  # DeepVO {1 id, 2 s, 3 ba, 4 p, 5 q, 6 t}
        body = {"id": s(v, 1), "s": s(v, 2), "ba": n(v, 3), "p": s(v, 4), "q": s(v, 5), "t": n(v, 6)}
    elif channel == "fund_rate":  # FundRateVO {1 s, 2 r, 3 t}
        body = {"s": s(v, 1), "r": s(v, 2), "t": n(v, 3)}
    elif channel in ("mark_price", "index_price"):  # PriceVO {1 s, 2 p, 3 t}
        body = {"s": s(v, 1), "p": s(v, 2), "t": n(v, 3)}
    elif channel == "trade":  # DealVO {1 s, 2 p, 3 a, 4 m, 5 t}
        body = {"s": s(v, 1), "p": s(v, 2), "a": s(v, 3), "m": s(v, 4), "t": n(v, 5)}
    else:
        body = {"fields": sorted(v.keys())}
    return channel, event, type_url, body


def listed():
    req = urllib.request.Request(REST + "/v2/public/symbol/list", headers={"User-Agent": "survey-probe/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return [x["symbol"] for x in json.loads(r.read())["data"]]


async def connect(url, **kw):
    t0 = time.perf_counter()
    ws = await websockets.connect(url, compression=kw.pop("compression", None), ping_interval=None, max_size=None, open_timeout=20, **kw)
    ms = round((time.perf_counter() - t0) * 1000)
    hdr = {k: v for k, v in ws.response.headers.raw_items() if k.lower().startswith(("x-ratelimit", "sec-websocket-extensions"))}
    return ws, ms, hdr


async def recv_until(ws, end, closes=None):
    """Yield frames until end, and record a server close in closes instead of raising."""
    t0 = time.monotonic()
    while time.monotonic() < end:
        try:
            m = await asyncio.wait_for(ws.recv(), max(0.05, end - time.monotonic()))
        except asyncio.TimeoutError:
            return
        except websockets.ConnectionClosed as e:
            if closes is not None:
                closes.append({"code": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else None})
            return
        yield m


async def mode_open():
    try:
        ws, ms, hdr = await connect(OPEN_URL)
    except Exception as e:  # noqa: BLE001 the refusal is the finding
        emit("open_connect", url=OPEN_URL, error=repr(e)[:300])
        return
    emit("open_connect", url=OPEN_URL, ms=ms, headers=hdr)
    t0 = time.monotonic()
    frames = []
    sent_dummy = sent_empty = False
    try:
        async for m in recv_until(ws, t0 + 40):
            frames.append([round(time.monotonic() - t0, 1), m if isinstance(m, str) else f"binary {len(m)} bytes"])
            if m == "ping":
                await ws.send("pong")
            if not sent_dummy:
                sent_dummy = True
                await ws.send(json.dumps({"op": "SUBSCRIBE", "channel": "PRICE", "key": "survey-probe", "signature": "0" * 64, "args": [{"symbol": "btc_usdt"}]}))
                frames.append([round(time.monotonic() - t0, 1), "sent PRICE with dummy key"])
            elif not sent_empty and time.monotonic() - t0 > 15:
                sent_empty = True
                await ws.send(json.dumps({"op": "SUBSCRIBE", "channel": "PRICE", "key": "", "signature": "", "args": [{"symbol": "btc_usdt"}]}))
                frames.append([round(time.monotonic() - t0, 1), "sent PRICE with empty key"])
    except websockets.ConnectionClosed as e:
        frames.append([round(time.monotonic() - t0, 1), f"closed code={e.rcvd.code if e.rcvd else None} reason={e.rcvd.reason if e.rcvd else None}"])
    emit("open_frames", frames=frames[:20], total=len(frames))
    await ws.close()


def apply(book, side, p, q):
    if q == "0" or float(q) == 0:
        book[side].pop(p, None)
    else:
        book[side][p] = q


def compare(book, full):
    """Snapshot levels whose size the rebuilt book holds at the same price, plus best bid and ask agreement."""
    same = sum(1 for p, q in full["b"] if book["b"].get(p) == q) + sum(1 for p, q in full["a"] if book["a"].get(p) == q)
    best_b = max(book["b"], key=float) if book["b"] else None
    best_a = min(book["a"], key=float) if book["a"] else None
    top_ok = best_b == full["b"][0][0] and best_a == full["a"][0][0]
    return same, len(full["b"]) + len(full["a"]), top_ok


async def mode_book():
    ws, ms, hdr = await connect(GATEWAY_URL)
    emit("book_connect", url=GATEWAY_URL, ms=ms, headers=hdr)
    events = ["depth_full@btc_usdt", "depth_update@btc_usdt", "fund_rate@btc_usdt", "mark_price@btc_usdt",
              "index_price@btc_usdt", "trade@btc_usdt", "depth_full@nope_usdt", "depth_update@nope_usdt"]
    await ws.send(json.dumps({"events": events, "method": "sub"}))
    t0 = time.monotonic()
    texts, counts, events_seen, samples = [], collections.Counter(), set(), {}
    full_times, full_sizes, upd_ids, upd_ts = [], [], [], []
    book, snap_id, checks, applied, skipped = None, None, [], 0, 0
    sent_variant = sent_unsub = False
    closes, channel_times = [], []
    async for m in recv_until(ws, t0 + 45, closes):
        el = round(time.monotonic() - t0, 2)
        if isinstance(m, str):
            texts.append([el, m[:200]])
            continue
        channel, event, type_url, body = decode(m)
        counts[channel] += 1
        channel_times.append((el, event))
        events_seen.add(event)
        if channel not in samples:
            short = dict(body)
            if channel == "depth_full":
                short["a"], short["b"] = short["a"][:2], short["b"][:2]
                short["levels"] = [len(body["a"]), len(body["b"])]
            samples[channel] = {"event": event, "type_url": type_url, "bytes": len(m), "body": short}
        if channel == "depth_full" and body["s"] == "btc_usdt" and event.endswith(",50"):
            full_times.append(el)
            full_sizes.append([len(body["b"]), len(body["a"])])
            if book is None:
                book = {"b": dict(map(tuple, body["b"])), "a": dict(map(tuple, body["a"]))}
                snap_id = int(body["id"])
            else:
                ok, total, top_ok = compare(book, body)
                checks.append([el, ok, total, top_ok])
        elif channel == "depth_update" and body["s"] == "btc_usdt":
            upd_ids.append(int(body["id"]))
            upd_ts.append(body["t"])
            if book is not None:
                if int(body["id"]) > snap_id:
                    apply(book, "b" if body["ba"] == 1 else "a", body["p"], body["q"])
                    applied += 1
                else:
                    skipped += 1
        if not sent_variant and el > 15:
            sent_variant = True
            await ws.send(json.dumps({"events": ["depth_full@eth_usdt", "depth_update@eth_usdt,1000ms"], "method": "sub"}))
            texts.append([el, "sent sub depth_full@eth_usdt and depth_update@eth_usdt,1000ms"])
        if not sent_unsub and el > 30:
            sent_unsub = True
            await ws.send(json.dumps({"events": ["trade@btc_usdt", "depth_update@eth_usdt,1000ms", "depth_full@eth_usdt"], "method": "unsub"}))
            texts.append([el, "sent unsub trade@btc_usdt and the eth variants"])
    closed_at = round(time.monotonic() - t0, 2) if closes else None
    await ws.close()
    gaps = [b - a for a, b in zip(upd_ids, upd_ids[1:])]
    emit("book_texts", texts=texts, server_close=closes, closed_at_s=closed_at)
    emit("book_counts", counts=dict(counts), events=sorted(events_seen))
    for ch, smp in samples.items():
        emit("book_sample", channel=ch, **smp)
    iv = [b - a for a, b in zip(full_times, full_times[1:])]
    emit("book_depth_full", frames=len(full_times), interval_s_median=statistics.median(iv) if iv else None,
         levels_bid_ask=sorted({tuple(x) for x in full_sizes}))
    emit("book_depth_update", frames=len(upd_ids), ids_increasing=all(g > 0 for g in gaps),
         id_step_1=sum(1 for g in gaps if g == 1), id_step_other=sum(1 for g in gaps if g != 1),
         id_step_median=statistics.median(gaps) if gaps else None,
         t_distinct=len(set(upd_ts)), applied=applied, skipped_older_than_snapshot=skipped)
    emit("book_rebuild_checks", checks=checks[:12], total_checks=len(checks),
         all_levels_match=sum(1 for c in checks if c[1] == c[2]),
         best_bid_ask_match=sum(1 for c in checks if c[3]),
         level_match_share_min=min(c[1] / c[2] for c in checks) if checks else None)
    after_unsub = collections.Counter(c for el, c in channel_times if el > 31)
    emit("book_after_unsub", channels_after_31s=dict(after_unsub))
    for topic in ("depth_full@eth_usdt,20", "bogus"):
        ws, _, _ = await connect(GATEWAY_URL)
        t1 = time.monotonic()
        closes, got = [], []
        await ws.send(json.dumps({"events": [topic], "method": "sub"}) if topic != "bogus" else "{not json")
        async for m in recv_until(ws, t1 + 5, closes):
            got.append(m[:100] if isinstance(m, str) else f"binary {len(m)}")
        emit("book_bad_topic", sent=topic, server_close=closes, closed_after_s=round(time.monotonic() - t1, 2) if closes else None, received=got[:3])
        await ws.close()


async def mode_batch():
    syms = listed()
    ws, ms, hdr = await connect(GATEWAY_URL)
    emit("batch_connect", ms=ms, contracts=len(syms), headers=hdr)
    events = [f"depth_update@{x}" for x in syms] + [f"depth_full@{x}" for x in syms]
    t0 = time.monotonic()
    texts = []
    for i in range(0, len(events), 50):
        await ws.send(json.dumps({"events": events[i:i + 50], "method": "sub"}))
    per_upd, per_full, nbytes, nframes = collections.Counter(), collections.Counter(), 0, 0
    ch_bytes, ch_frames = collections.Counter(), collections.Counter()
    first_full = {}
    closes = []
    async for m in recv_until(ws, t0 + BATCH_S, closes):
        if isinstance(m, str):
            texts.append([round(time.monotonic() - t0, 2), m[:120]])
            continue
        nframes += 1
        nbytes += len(m)
        channel, event, _, body = decode(m)
        ch_bytes[channel] += len(m)
        ch_frames[channel] += 1
        if channel == "depth_update":
            per_upd[body["s"]] += 1
        elif channel == "depth_full":
            per_full[body["s"]] += 1
            first_full.setdefault(body["s"], round(time.monotonic() - t0, 2))
    await ws.close()
    emit("batch_texts", count=len(texts), first=texts[:5], server_close=closes)
    emit("batch", seconds=BATCH_S, frames=nframes, frames_per_s=round(nframes / BATCH_S, 1), kb_per_s=round(nbytes / BATCH_S / 1024, 1),
         contracts_with_updates=len(per_upd), contracts_with_full=len(per_full),
         silent_contracts=sorted(set(syms) - set(per_upd) - set(per_full))[:20],
         updates_per_contract_median=statistics.median(per_upd.values()) if per_upd else None,
         full_per_contract_median=statistics.median(per_full.values()) if per_full else None,
         full_per_contract_min_max=[min(per_full.values()), max(per_full.values())] if per_full else None,
         first_full_s_median=statistics.median(first_full.values()) if first_full else None,
         top_updates=per_upd.most_common(3),
         per_channel_frames_per_s={k: round(v / BATCH_S, 1) for k, v in ch_frames.items()},
         per_channel_kb_per_s={k: round(v / BATCH_S / 1024, 1) for k, v in ch_bytes.items()})


async def silent_socket(label, send_ping):
    ws, ms, _ = await connect(GATEWAY_URL)
    t0 = time.monotonic()
    got = []
    last_ping = -100.0
    try:
        while time.monotonic() - t0 < SILENCE_S:
            if send_ping and time.monotonic() - last_ping >= 20:
                last_ping = time.monotonic()
                await ws.send("ping")
            try:
                m = await asyncio.wait_for(ws.recv(), 1)
                got.append([round(time.monotonic() - t0, 1), m if isinstance(m, str) else f"binary {len(m)}"])
            except asyncio.TimeoutError:
                pass
        emit("silence", socket=label, open_after_s=SILENCE_S, received=got[:10])
    except websockets.ConnectionClosed as e:
        emit("silence", socket=label, closed_after_s=round(time.monotonic() - t0, 1),
             code=e.rcvd.code if e.rcvd else None, reason=e.rcvd.reason if e.rcvd else None, received=got[:10])
    await ws.close()


async def mode_silence():
    await asyncio.gather(silent_socket("quiet", False), silent_socket("text ping every 20 s", True))


async def mode_deflate():
    ws, ms, hdr = await connect(GATEWAY_URL, compression="deflate")
    emit("deflate", requested="permessage-deflate", negotiated=hdr.get("Sec-WebSocket-Extensions") or hdr.get("sec-websocket-extensions"), headers=hdr)
    await ws.close()


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    order = ["open", "book", "batch", "silence", "deflate"] if mode == "all" else [mode]
    for m in order:
        await globals()[f"mode_{m}"]()


if __name__ == "__main__":
    asyncio.run(main())
