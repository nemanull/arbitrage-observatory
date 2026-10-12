# BitGW Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:47 to 04:06 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers BitGW's public spot WebSocket, because BitGW lists no perpetuals, see [`fees.md`](./fees.md) section 3.
BitGW publishes no WebSocket documentation.
The URL and the frames below come from the socket class and the k page chunk of the web app bundle, S1, so the "documented" column says what the web app's code does.
Every probed value comes from [`ws-probe.py`](../../../scripts/probes/venues/bitgw/ws-probe.py), which ran a BitGW socket on three pairs, a second BitGW socket on many pairs, and an OKX public socket on the same three pairs, all at once.
It ran twice, at 03:56 UTC with 40 pairs on the second socket and at 04:01 UTC with all 91, and the numbers below give the first run, then the second.

The socket is a relay of OKX's public spot channels.
Its frames carry OKX's channel names, OKX's `seqId` and OKX's trade ids, and a `_relay` object naming `"from": "program_a"`.
Every BitGW `books5` frame in both runs had a `seqId` that OKX's own `books5` also sent, with identical levels.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot, every pair | `wss://bitgw.com:8443`, `this.url` of the socket class, S1 | 101 in 271 and 233 ms through Cloudflare, edge `YVR`. No `Sec-WebSocket-Extensions` header came back, so frames are uncompressed |
| perpetuals | Not offered | [`fees.md`](./fees.md) section 3 |

One URL serves every pair and every channel.
`bitgw.com` resolves to the Cloudflare addresses in [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

The client joins a group with `{"type":"joinGroup","key":"<pair>"}` and leaves it with `{"type":"leaveGroup","key":"<pair>"}`.
One market group delivers every channel below for that pair, and there is no way to ask for one channel only.

| group | frame | content | probed in the 75 s main socket, two runs |
|---|---|---|---|
| `BTC-USDT` and every other pair | `{"type":"k","data":{"arg":{"channel":"books5",...}}}` | OKX `books5`: 5 levels a side, a full snapshot each frame | 159, 128 and 216 frames on BTC, ETH and SOL, then 284, 257 and 308 |
| the same | `k` with `channel: "trades"` | OKX trades, one per frame | 78 trades, then 101, every trade id also on OKX |
| the same | `k` with `channel: "candle1m"` to `"candle1Mutc"` | ten OKX candle channels | about one frame a second per interval |
| `index` | `{"type":"tickers","data":{...}}` | one pair's `last`, `sodUtc0`, `high`, `low`, `vol24h`, `volCcy24h`, `ts`, `sync` | 936 frames, then 1,402, each time for 78 pairs |

No channel carries a best bid and ask alone, a mark, an index or a funding rate.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL served all pairs |
| subscribe frame shape | `{"type":"joinGroup","key":"BTC-USDT"}`, one pair per frame, S1 | 4 joins on one socket, and 40, then 91, on another were served |
| unknown symbol expectation | Not publicly specified | a join for `FOO-USDT` got no reply and no frame at all |
| chunk unit and budget | Not publicly specified | all 91 groups on one socket, and 78 of them sent `books5` within 100 s, 228 frames a second in all. The 13 silent ones are pairs whose catalog price is stale, see section 4 |
| keepalive mechanism | the app sends the text `heartbeat` every 30 s and expects `{"type":"heart"}`, reconnecting after 60 s without one, S1 | four `heartbeat` texts over the two runs got no `heart` reply. The server sent no ping |
| connection lifetime and maintenance notice | Not publicly specified | a socket that sent nothing after its joins stayed open for 100 s in both runs, and no maintenance frame came |
| handshake and operation rate limits | Not publicly specified | none met at 91 joins in one burst |
| public market data authentication | none, S1 | none |
| message parse and routing | `type`, then `data.arg.channel` and `data.arg.instId`, S1 | as documented. `tickers` frames route on `data.instId` |
| subscribe acknowledgement shape | none in S1 | none. No frame answers a join or a leave |
| symbol identifier format | `BTC-USDT`, the catalog `key` | identical to the catalog `key` and to OKX's `instId` |
| number representation | strings, S1 parses them | strings, levels `[price, size, "0", orders]` as on OKX |
| timestamp representation | `ts` in ms as a string | as documented. The relay adds `send_ms` as a number in `_relay` on trade and candle frames |
| size unit | base coin, S1 shows it as the amount | base coin, identical to OKX's spot `sz` |
| sequence semantics | not used by the app | OKX's `seqId`, rising on every consecutive pair of frames in both runs, 1,346 pairs in all, and not contiguous |
| idle repeat behaviour | not documented | no identical consecutive `books5` frame in 503, then 849 |

## 4. The book channel in detail

`books5` is the only book channel.

### Snapshot on subscribe

Every frame is a full 5 level snapshot, so the first frame after a join is the snapshot.
In the second run the first `books5` frame came 603, 122 and 251 ms after the joins on BTC, ETH and SOL.
The web app also reads a 5 level REST book from `marketDetail` before it joins, see [`rest.md`](./rest.md) section 5.

### Delta semantics

There are no deltas.
Each frame replaces the whole book, as on OKX's `books5`.

### Sequence and gap rule

Each frame carries OKX's `seqId`, which rose on every consecutive pair and skipped values, as OKX's own does.
No gap rule is needed, because every frame is a full snapshot.
BitGW passed on 159 of OKX's 196 BTC frames, 128 of 165 ETH frames and 216 of 270 SOL frames in the first run, and 284 of 362, 257 of 316 and 308 of 385 in the second, 78 % to 81 % each time.
The frame interval had a median of 203, 296 and 156 ms in the first run and 104, 137 and 108 ms in the busier second run.
Its tenth percentile was 98, 90 and 95 ms, then 96, 69 and 87 ms, so the relay mostly keeps about one frame per 100 ms.

### Relay of OKX

Every one of the 503, then 849, `books5` frames had a `seqId` that OKX's socket also sent in the same window, with identical asks and bids.
BitGW's frame arrived a median of 109, 122 and 112 ms after OKX's frame with the same `seqId` in the first run, and 111, 146 and 119 ms in the second.
The 90th percentile was 113, 156 and 129 ms, then 165, 204 and 155 ms.
Every one of the 78, then 101, BitGW trades had a trade id that OKX's trade channel also sent.
The REST `k` call returns trades with the same OKX trade ids, see [`rest.md`](./rest.md) section 5.

### Checksum

None, and OKX's `books5` carries none either.

### Level order on the wire

Asks ascending and bids descending, as on OKX.
The web app reverses the asks for display.

### Size unit

The base coin, the same number OKX publishes.
BitGW's catalog has no contract size, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

None seen.
Every frame had 5 levels a side.

### Idle repeats

None.
No two consecutive `books5` frames were identical in 503, then 849.

### Unknown, stale and left symbols

A join for `FOO-USDT` produced nothing, no error and no frame.
Of all 91 catalog pairs joined in the second run, 13 sent no `books5` in 100 s: `COMP-USDT`, `CTSI-USDT`, `DASH-USDT`, `GALA-USDT`, `KAVA-USDT`, `KNC-USDT`, `PAXG-USDT`, `PEPE-USDT`, `SHIB-USDT`, `STORJ-USDT`, `TFUEL-USDT`, `ZEC-USDT` and `ZEN-USDT`.
The first run had joined 40 pairs and found the 7 of these among them silent.
These 13 are exactly the pairs whose catalog `last` is absent from OKX or 1.3 % to 31 % away from OKX's over the two REST reads, see [`rest.md`](./rest.md) section 2, so their price on BitGW is stale.
The `index` group's tickers covered the other 78 pairs and none of these 13.
After a `leaveGroup` for `SOL-USDT`, no SOL `books5` frame came after 1.5 s.

## 5. Session

| item | probed |
|---|---|
| keepalive | the app's `heartbeat` text got no `heart` reply in four tries, and the server sent no ping |
| silence the server tolerates | 100 s with no client frame after the joins, still open, in both runs |
| forced disconnects | none in 100 s |
| maintenance notices | none seen |
| compression | none negotiated |
| frames before a join | none in the first 3 s |
| join limits | 91 joins in one burst, all served for live pairs |
| a malformed frame | `{not json` drew no reply and did not close the socket |

## 6. Captured frames

From the samples the first run of `ws-probe.py` printed, trimmed.

A `books5` frame:

```json
{"type":"k","data":{"arg":{"channel":"books5","instId":"SOL-USDT"},"data":[{"asks":[["109.71","95.489865","0","8"],["109.72","188.140111","0","11"]],"bids":[["109.7","62.420114","0","7"],["109.69","210.019851","0","12"]],"instId":"SOL-USDT","ts":"1791604591103","seqId":32239540169}],"_relay":{"from":"program_a"}}}
```

A trade frame, with the relay's node and send time:

```json
{"type":"k","data":{"arg":{"channel":"trades","instId":"SOL-USDT"},"data":[{"instId":"SOL-USDT","tradeId":"461616779","px":"109.71","sz":"0.212998","side":"buy","ts":"1791604591000","count":"1","source":"0","seqId":32239540215}],"_relay":{"from":"program_a","node":"srv896332","send_ms":1791604592155}}}
```

A ticker frame from the `index` group:

```json
{"type":"tickers","data":{"instId":"CHZ-USDT","last":"0.01568","sodUtc0":"0.01504","high":"0.01579","low":"0.01496","vol24h":"24160183.7041280000","volCcy24h":"370953.6497075307","ts":"1791604560000","sync":1}}
```

No acknowledgement, keepalive answer or error frame was ever received, so none can be shown.

## 7. Private channels

None on this socket.
The web app reads balances and orders through signed POST calls with a username and token, see [`rest.md`](./rest.md) section 6, and not through the socket.

## 8. Recommended feed shape

None for the engine.
BitGW has no perpetuals, so it cannot be a perpetual leg.

For a future spot leg, the feed would be simple: one socket to `wss://bitgw.com:8443`, one `joinGroup` frame per pair, and each `books5` frame replacing the book.
No keepalive is needed by the evidence, and a `maxSilenceMs` of about 10 s would cover a liquid pair, since the longest gap on BTC, ETH and SOL was 2.7 s.
The 13 stale pairs would have to be dropped, since their groups send nothing.
That leg would be pointless, because the book is OKX's spot book, 110 to 150 ms late at the median and with a fifth of its updates dropped.
A spot leg should read OKX directly.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://www.bitgw.com/assets/index-B2YCeHws.js`, the socket class with `wss://bitgw.com:8443`, `heartbeatInterval` 30000 and `heartbeatTimeoutDuration` 60000, and the k page chunk with the join, leave and frame handlers | 2026-10-09 |
| S2 | OKX public WebSocket `wss://ws.okx.com:8443/ws/v5/public`, channels `books5` and `trades`, used only for comparison | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/bitgw/ws-probe.py) | 2026-10-09 |
| P2 | [`endpoints-probe.py`](../../../scripts/probes/venues/bitgw/endpoints-probe.py), the socket URL and timers from the bundle | 2026-10-09 |
