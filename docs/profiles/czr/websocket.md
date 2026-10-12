# CZR Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:57 to 03:09 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures WebSocket of CZR Exchange, which has no CCXT class, for its USDT margined perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) unless a source id says otherwise.
Source ids are shared with [`fees.md`](./fees.md) and [`rest.md`](./rest.md).
The socket is the ChainUp kline-api socket, the same protocol the engine already reads for FameEX, x.me and Koinbay in [`chainup.rs`](../../../server/src/venues/chainup.rs).
The one difference from those venues is the contract spelling, `usdt1858_btcusdt` where they write `e_btcusdt`.
Nothing was refused from the Canadian exit.

## 1. Endpoints

| family | URL | where it is named | probed |
|---|---|---|---|
| USDT margined perpetuals | `wss://futuresws.czr.global/kline-api/ws` | `wsUrl` of the futures web list, P3 | 101 and open in 395 to 530 ms on every open in two passes, P7 to P10 |
| the same, on the main domain | `wss://futuresws.czrex.com/kline-api/ws` | the ChainUp host pattern, S9 | 101 in 417 and 443 ms, and it carried the same BTC book and mark channels, P7 |
| spot | `wss://ws.czr.global/kline-api/ws` | `wsUrl` of the web config, S8 | 101, and `market_btc1858usdt1858_depth_step0` sent a book, P7, not detailed |

One socket carries every perpetual, and the symbol in the channel name selects the contract.
Every socket host resolves to the same two AWS addresses in Tokyo, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | probed |
|---|---|---|
| `market_<sub>_depth_step0` | the unaggregated book, 30 levels per side, `asks` and `buys` | 63 and 76 BTC frames in 35 s in two runs, recommended, P7 |
| `market_<sub>_depth_step1` | the same 30 level book on a whole dollar step on BTC | 63 and 75 BTC frames in 35 s, P7 |
| `market_<sub>_ticker` | 24 h `vol`, `rose`, `open`, `low`, `high`, `close`, `amount`, and no bid or ask | 35 and 36 BTC frames in 35 s, P7 |
| `mark_price_<sub>` | `tagPrice`, `indexPrice`, `currentFundRate`, `nextFundRate`, `nextSettlementTime`, `symbol`, all strings | 23 and 54 frames per contract in 60 s on all 50 in two runs, P8 |
| `market_<sub>_trade_ticker` | trades with price, size, side and ms time | 28 and 26 BTC frames in 35 s, P7 |
| `market_<sub>` with no suffix | none | no frame, P7 |

No best bid and ask channel exists, S9.
`mark_price_usdt1858_solusdt` sent a frame on a socket that subscribed only the SOL depth channel, so the mark rides along with a depth subscription, P7.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | `wss://ws.<domain>/kline-api/ws` in the document, S9, and a separate futures host in the web list, P3 | one futures URL for all 50 contracts |
| subscribe frame shape | `{"event":"sub","params":{"channel":"...","cb_id":"..."}}`, one channel per frame, S9 | 100 frames in one burst, every one delivered, in two runs, P8 |
| unknown symbol expectation | Not publicly specified | `market_usdt1858_nopeusdt_depth_step0`, `mark_price_usdt1858_nopeusdt` and the REST spelling `market_USDT1858-ETH-USDT_depth_step0` got no frame in 35 s, P7 |
| chunk unit and budget | Not publicly specified | 100 subscriptions on one socket, no refusal and no close in 60 s, in two runs, P8 |
| keepalive mechanism | the server pushes `{"ping": <seconds>}` every 10 s, and a reply of `{"pong": <seconds>}` is recommended, S9 | `{"ping":1791601197}` as a gzip binary frame on a 10 s beat, with some beats skipped, P9 and P10 |
| connection lifetime and maintenance notice | Not publicly specified | a socket that never answered a ping stayed open for the whole 90 s test, in two runs, P9 |
| handshake and operation rate limits | Not publicly specified | about twelve opens over the session, no refusal |
| public market data authentication | none, S9 | none |
| message parse and routing | `channel` names the stream, S9 | envelope `{event_rep, channel, data, tick, ts, status, timezone}`, route by `channel` |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement for any `sub` |
| symbol identifier format | `market_$symbol_depth_step0`, S9 | `usdt1858_btcusdt`, the web list's `subSymbol`, which is the REST name `USDT1858-BTC-USDT` lower cased with the first dash turned into `_` and the others removed, on all 51 rows, P3 |
| number representation | Not publicly specified | depth levels `[price, size]` as JSON numbers, `mark_price_` and ticker values as strings |
| timestamp representation | Not publicly specified | envelope `ts` in ms rounded to the whole second, ping value in seconds |
| size unit | Not publicly specified | contracts, the same integers as REST `/fapi/v1/depth`, P7, and one contract is `multiplier` of the base, see section 4 |
| sequence semantics | none documented | none on the wire, every frame is a whole book |
| idle repeat behaviour | Not publicly specified | BTC repeated the previous book on 8 of 63 and 13 of 76 frames, and every one of 50 contracts sent at least 98 book frames in 60 s, P7 and P8 |

## 4. The book channel in detail

`market_<sub>_depth_step0` is the channel this profile recommends.

### Snapshot on subscribe

All 50 contracts delivered their first book within 0.4 s of the subscribe burst, in two runs, P8.
Every frame is a whole book, so there is no delta stream.

### Delta semantics

None.
Each `tick` replaces the book.

### Sequence and gap rule

No sequence field exists, so no gap can be detected and no resync on gap is needed.
The envelope `ts` has whole second resolution, 35 distinct values over 63 BTC frames and 35 over 76, so it cannot order two frames within one second, P7.

### Checksum

None.

### Level order on the wire

`asks` ascending and `buys` descending on every BTC frame of two runs, P7.
Bids are named `buys` on the socket and `bids` on REST.

### Level window

30 levels per side on every BTC frame of two runs, P7.
Over all 50 contracts, 6,130 of 6,904 and 6,140 of 6,966 depth frames in 60 s had 30 levels on their smaller side, and the rest had 11 to 24, P8.
So a few thin contracts sit below the engine's 20 levels, and the engine takes what is there.
REST gives up to 100, see [`rest.md`](./rest.md) section 5.

### Size unit

There is no CCXT market, so the unit comes from the catalog.
The socket's top three bids and asks had the same prices as a REST read made during the run, in both runs, and sizes within 4 % of it, P7.
So sizes are integer contracts, and one contract is `multiplier` units of `multiplierCoin`, 0.001 BTC on `USDT1858-BTC-USDT`, see [`rest.md`](./rest.md) section 2.
That reading is an inference, since no document states the unit.

### One-sided and empty books

None seen among the 50 contracts on the socket, P8.
`USDT1858-LAB-USDT`, at `status` 0 in the open API catalog and absent from the web list, was not subscribed.

### Idle repeats

A BTC frame came every 528 and 457 ms at the median in two runs, and 8 of 63 and 13 of 76 repeated the previous book, P7.
In 60 s every contract sent between 98 and 153 book frames, median 142, and between 110 and 161, median 142, in the rerun, P8.
So a silent contract on CZR means a lost subscription, unlike Koinbay, where a static book sends nothing, as the adapter notes at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 293.

### Unknown, closed and other tenants' symbols

No error is returned for an unknown or wrongly spelled channel, P7.
An unknown `event`, such as `{"event":"nope",...}`, is echoed back unchanged as a plain JSON binary frame, not gzip, P7.
`market_e_btcusdt_depth_step0` and `mark_price_e_btcusdt`, the spelling of other ChainUp venues, did return a book and a mark on CZR's socket in both runs, with a different book and a funding rate of 0.000028 against 0.00001 on `usdt1858_btcusdt`, but the same index, P7.
So the socket serves contracts that are not in CZR's catalog, which reads as a socket shared between ChainUp tenants, and that is an inference.
A feed must subscribe only the `subSymbol` values of CZR's own catalog.

## 5. Session

- Keepalive: the server sends `{"ping": <seconds>}` on a 10 s beat, gzip compressed like every other frame, P9 and P10.
  The first 90 s silence run got all 9 beats, and the second got 5, with gaps of 20 s and a last stretch of 28 s with none, while book frames kept arriving.
  The pong run answered each ping with `{"pong": n}` and the pings went on, and a client `{"ping": ms}` got no answer of its own beyond the next scheduled ping, P10.
  So the engine's `AnswerPing` mode fits, where the client answers each server ping with `{"pong": n}`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 77.
- Silence tolerated: a subscribed socket that never sent anything after the subscription stayed open for the whole 90 s, in two runs, P9.
- Forced disconnects and maintenance notices: none seen and none documented.
- Compression: every data frame is binary gzip inside the WebSocket frame, as S9 says.
  The handshake reply carried no `Sec-WebSocket-Extensions` header, so permessage deflate was not negotiated.
  The adapter gunzips a frame that starts with the gzip magic and parses any other frame as JSON, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 384, which covers the echoed plain frame.
- Handshake and subscription limits: none documented and none hit.

## 6. Captured frames

The subscribe frame sent, as in S9:

```json
{"event": "sub", "params": {"channel": "market_usdt1858_btcusdt_depth_step0", "cb_id": "market_usdt1858_btcusdt_depth_step0"}}
```

No acknowledgement arrives.
The first SOL depth frame, gunzipped and cut to three levels per side:

```json
{"event_rep": "", "channel": "market_usdt1858_solusdt_depth_step0", "data": null, "tick": {"asks": [[109.85, 77976], [109.86, 65940], [109.87, 48052]], "buys": [[109.8, 25326], [109.79, 58725]]}, "ts": 1791601071000, "status": "ok", "timezone": ""}
```

The mark and funding frame:

```json
{"event_rep": "", "channel": "mark_price_usdt1858_btcusdt", "data": null, "tick": {"tagPrice": "82610.3", "indexPrice": "82632.63333333332874610", "currentFundRate": "0.0000100000000000", "nextFundRate": "0.000010", "nextSettlementTime": "1791619200000", "symbol": "usdt1858_btcusdt"}, "ts": 1791601071000, "status": "ok", "timezone": ""}
```

The keepalive, received as a gzip binary frame:

```json
{"ping": 1791601076}
```

The echo of an unknown event, received as a plain binary frame:

```json
{"event": "nope", "params": {"channel": "market_usdt1858_btcusdt_depth_step0"}}
```

## 7. Private channels

The ChainUp document lists private socket pages for asset changes, orders and positions, S9.
They were not probed.

## 8. Recommended feed shape

The engine's ChainUp family adapter already has this shape, as its Koinbay profile, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 142 to 162.

- URL plan: one URL, `wss://futuresws.czr.global/kline-api/ws`, the one the web list names, for every perpetual.
- Markets per connection: all 50 with their depth and their mark ran on one socket, so one socket is enough.
- Subscribe frames: one `sub` per contract for `market_<sub>_depth_step0`, with `Depth::Step0`, and `mark_price_<sub>` for the `MarkPrice` anchor.
- Decoding: gunzip a frame that starts with the gzip magic, else parse it as JSON.
- Keepalive: `Keepalive::AnswerPing`.
- `maxSilenceMs`: 10 s would do, since every contract pushes about twice a second, and a skipped ping does not leave the socket silent while books flow.
- Resync rule: none needed, since every frame is a whole book, and on a close the adapter reopens and resubscribes.
- Catalog: the raw id `usdt1858_btcusdt` comes out of the adapter's `socket_name` rule unchanged, but the catalog filter drops every CZR contract today, see [`rest.md`](./rest.md) section 2.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| S8 | CZR web config | https://www.czrex.com/fePublicInfo/en_US | 2026-10-09 | the spot `wsUrl` and `openApiDocUrl` |
| S9 | ChainUp Open API v2, WebSocket | https://exchangedocsv2.gitbook.io/open-api-doc-v2/websocket | 2026-10-09 | subscribe shape, channels, ping, gzip, private pages |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `catalog` | | 2026-10-09 | the futures `wsUrl` and `subSymbol` |
| P7 | [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) modes `hosts` and `basic`, 10 s and 35 s | | 2026-10-09 | hosts, channels, frames, order, size against REST, unknown symbols |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) mode `all`, 60 s | | 2026-10-09 | 50 contracts on one socket, mark frames |
| P9 | [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) mode `silence`, 90 s | | 2026-10-09 | server pings, silence tolerated |
| P10 | [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) mode `pong`, 50 s | | 2026-10-09 | answered pings and a client ping |
