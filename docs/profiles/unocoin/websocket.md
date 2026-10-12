# Unocoin WebSocket Profile

**Status:** Done.
The public futures socket is undocumented and was read from the unocoin.com web app bundle.
Every book frame is a forwarded Binance USD-M depth20@100ms frame with prices multiplied by a fixed INR rate.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:14 to 04:31 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada, and the socket handshake carried a `YVR` (Vancouver) Cloudflare ray id.

Unocoin lists perpetuals, so this profile covers the perpetual book.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/unocoin/ws-probe.py), whose second pass run is the one cited unless a line says otherwise.
Fees are in [`fees.md`](./fees.md) and the REST surface is in [`rest.md`](./rest.md).

## 1. Endpoints

| family | public URL | source |
|---|---|---|
| INR-quoted perpetuals (14) | `wss://pi42-stream.unocoin.com/ws/public` | the web app bundle S1, probed |
| private | `wss://pi42-stream.unocoin.com/ws/private`, derived in the bundle by replacing `/ws/public` | S1, not probed |

- Unocoin publishes no API documentation for futures, and no WebSocket page was found on unocoin.com or the support site.
- The URL is hard coded in the futures page chunks of the web app, which subscribe with `{"action":"subscribe","channel":...}` and send `{"action":"ping"}` every 30 s, S1.
- The host name and the terms both name Pi42 as the routing partner, see [`fees.md`](./fees.md) section 1.
- `pi42-stream.unocoin.com` resolves to the same Cloudflare addresses as `api.unocoin.com`, see [`rest.md`](./rest.md) section 1.
- One socket carries all 14 contracts and every channel.
- The socket bundle also references `wss://stream.unocoin.com` through Socket.IO for the spot app, S1.
  It is named only, because spot is not the researched product.

## 2. Channel matrix for public market data

| channel | content | cadence probed |
|---|---|---|
| `<symbol>@depth_<grouping>` | full top 20 bids and asks, Binance `depthUpdate` shape with `ps` naming the Binance symbol | every 500 ms median per contract |
| `<symbol>@markPrice` | mark `p`, a USDT-scale mark `ap`, index `i`, estimated settle `P`, funding rate `r`, next funding `T`, `lr` | 1,000 ms median |
| `<symbol>@marketInfo` | `lastPrice`, `marketPrice`, `upcomingFundingRate`, 24 h change and volumes | 1,000 ms median |
| `<symbol>@ticker` | Binance `24hrTicker` shape in INR | 2,000 ms median |
| `<symbol>@aggTrade` | Binance `aggTrade` shape in INR, plus `nq` | about 1 s, with gaps up to 5 s |
| `allContractDetails` | one object of 561 keys, 216 INR symbols and 345 USDT symbols, with `lastPrice`, `marketPrice` and `upcomingFundingRate` | 1,000 ms median, about 100 KB per frame |
| best bid and ask | Not offered, `btcinr@bookTicker` answers `{"error":"invalid channel format"}` | |

`<symbol>` is the catalog symbol in lower case, such as `btcinr`.
The web app takes `<grouping>` from the catalog's `depth_grouping[0]`, such as `0.1` for BTCINR, S1.
The server ignores it in practice.
`btcinr@depth_1` and the bare `btcinr@depth` were both acknowledged, and in 3 s they carried 7 distinct `u` values, 6 of them on both channels, with the same 0.1 USDT price ladder as `btcinr@depth_0.1`, in `ws-probe.py` mode 1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified, the socket is undocumented | one URL for all 14 contracts and every channel |
| subscribe frame shape | Not publicly specified. The bundle sends `{"action":"subscribe","channel":"btcinr@depth_0.1"}`, one channel per frame, S1 | the same, 19 channels subscribed on one socket in one burst |
| unknown symbol expectation | Not publicly specified | `{"error":"Symbol not allowed: foo"}`, and the same for `sandinr`, a Pi42 contract outside Unocoin's catalog |
| chunk unit and budget | Not publicly specified | one channel per frame. 19 channels on one socket were all served |
| keepalive mechanism | Not publicly specified. The bundle sends `{"action":"ping"}` every 30 s, S1 | `{"action":"ping"}` answers `{"error":"channel required"}`, so the app's ping is not a recognised command |
| connection lifetime and maintenance notice | Not publicly specified | an idle socket with no subscription and no client frames stayed open for 100 s, and no close or notice was seen on any socket |
| handshake and operation rate limits | Not publicly specified | three sockets at once were all served |
| public market data authentication | none | none |
| message parse and routing | Not publicly specified | text JSON `{"channel": ..., "data": ...}`, routed on `channel` |
| subscribe acknowledgement shape | Not publicly specified | `{"success":"Subscribed to btcinr@depth_0.1"}`, and `{"success":"Unsubscribed from btcinr@depth_0.1"}` |
| symbol identifier format | lower case in the channel, S1 | channel lower case, `data.s` upper case `BTCINR`, equal to the catalog `symbol` |
| number representation | Not publicly specified | prices and sizes as strings |
| timestamp representation | Not publicly specified | `E` and `T` in integer ms, equal to Binance's own for the same frame, section 4 |
| size unit | Not publicly specified | base coin, identical to Binance's size at the same level on BTC, section 4 |
| sequence semantics | Not publicly specified | `U`, `u` and `pu` are Binance's ids. `pu` equalled the previous frame's `u` on 34 of 1,628 frames, so it does not chain |
| idle repeat behaviour | Not publicly specified | every contract sent a frame about every 500 ms, and `u` increased on every one of 1,628 consecutive pairs |

## 4. The book channel in detail

### What a frame is

Each `depthUpdate` frame carries a whole top 20 window, 18 to 20 levels per side, so each frame is a snapshot.
There is no separate snapshot message, and the first frame after the ack is already a full window.
A feed resets the book on every frame.

### The frames are Binance's

Mode 2 of `ws-probe.py` ran Binance's `btcusdt@depth20@100ms` and `ethusdt@depth20@100ms` beside Unocoin's `btcinr@depth_0.1` and `ethinr@depth_0.01` for 60 s.

| check | BTCINR | ETHINR |
|---|---|---|
| Unocoin frames matched to a Binance frame by `u` | 119 of 119 | 119 of 119 |
| arrival lag behind Binance's own copy, median, min, max | 185 ms, 106 ms, 388 ms | 195 ms, 135 ms, 376 ms |
| 20 bid and 20 ask sizes equal to Binance's, in order | 119 of 119 | 0 of 119 |
| summed bid and ask size equal to Binance's | 119 of 119 | 103 of 119 |
| levels, Unocoin against Binance | 20 and 20 against 20 and 20 on all | 19 or 20 against 20 and 20 |
| mid price over Binance mid, median | 95.7500 INR per USDT | 95.8002 INR per USDT |
| best bid ratio, best ask ratio, median | 95.74943, 95.75058 | 95.79257, 95.80784 |

So the venue forwards one Binance depth20@100ms frame in five, about every 500 ms, about 190 ms after Binance's copy reaches this host.
Prices are Binance's times a per-contract INR rate, then rounded to the contract's INR tick.
BTCINR's rate was 95.75 on every frame of all three runs.
ETHINR's was 95.8054 in the first run and 95.8002 in the second and third.
On ETHINR, two Binance levels of 0.01 USDT can round to one whole rupee, which explains the 19-level sides and the merged sizes.
The bid and ask ratios sit symmetrically around the mid ratio, so no outward markup was seen, unlike the KoinBX relay.

### Delta semantics and sequence

There are no deltas.
`U`, `u` and `pu` are Binance's update ids, and because four Binance frames in five are dropped, `pu` does not equal the previous frame's `u`.
No gap rule applies, since each frame replaces the book.

### Checksum

None.

### Level order on the wire

Bids and asks are both ascending by price on all 1,642 frames of mode 1, so the best bid is the last bid and the best ask is the first ask.
No frame was crossed.

### Size unit against CCXT `contractSize`

There is no CCXT class.
Sizes are in base coin, identical to Binance's on BTCINR, and the catalog quantity step is in base coin, see [`rest.md`](./rest.md) section 2.
A contract size of 1 fits.

### One-sided and empty books

None of 1,642 frames had an empty side.

### Idle repeats

Every subscribed contract sent about two frames a second during the 60 s, including the quietest such as BCHINR, 113 frames with a largest gap of 2,501 ms.
No frame repeated a `u`.

### Unknown, closed and malformed

| sent | reply |
|---|---|
| `{"action":"subscribe","channel":"foo@depth_0.1"}` | `{"error":"Symbol not allowed: foo"}` |
| `{"action":"subscribe","channel":"sandinr@depth_0.01"}` | `{"error":"Symbol not allowed: sandinr"}` |
| `{"action":"subscribe","channel":"btcinr@bookTicker"}` | `{"error":"invalid channel format"}` |
| `{"action":"subscribe"}` | `{"error":"channel required"}` |
| `{"action":"bogus","channel":"btcinr@ticker"}` | `{"error":"Unknown action"}` |
| `not json` | `{"error":"Invalid message format"}` |

None of these closed the socket.

## 5. Session

- Keepalive: the server needs none that was seen.
  An idle socket stayed open 100 s with no client frames at all, not even protocol pings.
  The subscribed sockets ran 60 s each without the app's ping, while the probe's WebSocket library sent its default protocol ping every 20 s.
  The library answers server pings on its own, and whether the server sent any was not logged.
- The app's `{"action":"ping"}` gets `{"error":"channel required"}`, so sending it is harmless but useless.
- Compression: the probe offered permessage-deflate and the server negotiated none.
- Forced disconnects and maintenance notices: none seen in about seven minutes of sockets over three runs.
- Handshake limits: Not publicly specified, and three parallel sockets were served.
- Throughput: 19 channels on one socket gave 31.6 to 35.9 data frames a second over the three runs.

## 6. Captured frames

The first frame after the handshake:

```json
{"status":"connected_public"}
```

A subscribe acknowledgement:

```json
{"success":"Subscribed to btcinr@depth_0.1"}
```

A book frame, trimmed to three levels per side.
`ps` names the Binance symbol, and the ids are Binance's.

```json
{"channel":"btcinr@depth_0.1","data":{"e":"depthUpdate","E":1791606545607,"T":1791606545606,"s":"BTCINR","ps":"BTCUSDT","U":11780122363375,"u":11780122370261,"pu":11780122363254,"b":[["7912694","0.432"],["7912704","0.094"],["7912714","7.593"]],"a":[["7912819","2.640"],["7912828","0.016"],["7912838","1.504"]]}}
```

A mark frame.
`p` is the INR mark and `ap` a USDT-scale mark, and `p` over `ap` was 95.7500 on the last mark frame of each run.

```json
{"channel":"btcinr@markPrice","data":{"e":"markPriceUpdate","E":1791606367000,"s":"BTCINR","p":"7913703","ap":"82649.63332609","P":"7915707","i":"7916594","r":"0.000015957","T":1791619200000,"st":1,"lr":"0.000048078"}}
```

The reply to the app's ping:

```json
{"error":"channel required"}
```

## 7. Private channels

The bundle derives `wss://pi42-stream.unocoin.com/ws/private` and authenticates REST calls with a bearer token from `/v1/futures/token`, S1.
Not probed.

## 8. Recommended feed shape

Unocoin is not recommended as a leg, see [`rest.md`](./rest.md) section 8.
If it were built, the shape would be this.

- URL plan: one socket to `wss://pi42-stream.unocoin.com/ws/public` for all 14 contracts.
- Subscribe frames: one `{"action":"subscribe","channel":"<symbol lower>@depth_<depth_grouping[0]>"}` per contract.
- Book handling: reset the book on every `depthUpdate`, read bids as ascending, ignore `pu`.
- Keepalive: none was needed in 100 s of silence, and a client protocol ping every 20 s was accepted.
- `maxSilenceMs`: 5,000, which is ten frame intervals and twice the largest gap seen.
- Resync: reconnect and resubscribe, since each frame is a full window.

## 9. Source ledger

| id | source | label |
|---|---|---|
| S1 | unocoin.com web app bundle, the futures page chunk `pages/in/futures/[base_coin]/[pair_coin]-0ec884420d9e43b7.js` and chunk `3498-03134daf8521dab0.js`, downloaded 2026-10-10 | Published, undocumented |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/unocoin/ws-probe.py), three runs from 04:20 to 04:31 UTC on 2026-10-10 | Probed |
| P2 | Binance USD-M `wss://fstream.binance.com/stream` depth20@100ms, in mode 2 of `ws-probe.py` | Probed |
