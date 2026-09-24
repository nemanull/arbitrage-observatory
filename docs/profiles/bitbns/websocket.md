# BitBNS WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (04:51 to 05:15 UTC on 2026-09-23), from the development host near Seattle, through its Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public streams of BitBNS (CCXT id `bitbns`) for its one perpetual family, USDT-settled linear perpetuals.
BitBNS documents no public perpetual stream.
The perpetual book and index below are the Socket.IO endpoints the BitBNS web app opens, read out of its bundles, S2, and captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs).
The documented public streams are spot only, S1, and appear here only where they share the protocol or show a trap.
CCXT 4.5.68 has no BitBNS class under `pro/`, so CCXT offers no stream at all.
Every socket opened with `perMessageDeflate: false`, like [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81.

## 1. Endpoints

| stream | URL | source | probed |
|---|---|---|---|
| USDT-M perpetual books | `wss://socket.bitbns.com/bnsFuturesSocket/?EIO=4&transport=websocket`, Socket.IO path `/bnsFuturesSocket` | S2 | open in 597 to 848 ms over 17 sockets, 20 of 20 rooms delivered a book |
| perpetual index, every instrument | `wss://socket.bitbns.com/bnsIndexSocket/?coin=all&EIO=4&transport=websocket`, path `/bnsIndexSocket` | S2 | open in 667 and 683 ms, one frame every 5 s burst |
| spot books, documented | `https://ws{inr,usdt}mv2.bitbns.com/` with query `coin=<COIN>`, Socket.IO default path | S1 | open in 570 to 710 ms |
| spot ticker, documented | the same hosts with `withTicker=true&onlyTicker=true` | S1 | 4 `ticker` frames in 45 s and in 60 s |
| options | `https://socket.bitbns.com/?expiry=<e>` with path `bnsOptionsSocket` | S2 | not probed |
| executed orders, private | `https://wsorderv2.bitbns.com/?token=<token>` | S1 | not probed |

Every host resolved to the Cloudflare addresses `104.26.8.241`, `104.26.9.241` and `172.67.73.158`, see [`rest.md`](./rest.md) section 1.
There is one perpetual family, so the split axis is the Socket.IO room and not the URL.
The handshake packet on the futures host is `0{"sid":…,"upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}`, and the spot hosts send the same without `maxPayload`, P1 to P6.

## 2. Channel matrix for public market data

| channel | how to join | payload | probed on 2026-09-23 UTC |
|---|---|---|---|
| perpetual book and trades | emit `42["switchRoom","news_<coin_name>"]`, for example `news_BTCUSDTP` | event `news`, three frames: `buyList`, `sellList`, `tradeList` | 20 of 20 rooms answered with exactly three frames, in both runs |
| perpetual index | connect to `/bnsIndexSocket` with `coin=all` | event `index_price_all`, a map from `coin_id` to index price for 20 coins | 199 and 167 frames in 30 s, in bursts every 5.0 s |
| perpetual best bid and ask | none, the top of `buyList` and `sellList` | | |
| perpetual mark | none, "the Mark price used for funding rate calculations is same as the Index Price" | | S3 |
| perpetual funding | none on a socket, see [`rest.md`](./rest.md) section 3 | | |
| spot book, one coin | connect with `coin=BTC` | event `news`, the same three frames | 15 levels per side on every busy book |
| spot book, whole market | connect with `coin=ALL` | event `news`, three frames of `{<coin>: <frame>}` for 183 INR coins, then `{coin, data}` updates | about 400 KB in the first three frames |
| spot ticker | `withTicker=true&onlyTicker=true` | event `ticker`, `{<COIN>: {coin, rate}}` for 177 coins | |

The room name is `news_` plus the instrument's `coin_name` from the instrument list, and the web app builds it from the upper-case coin with `USDTP` appended on mainnet and `USDTPERP` on testnet, S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty where BitBNS publishes nothing for the perpetual stream, and it then says what the web app does.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified, the web app uses one host and a room per instrument, S2 | one URL for all 20 perpetuals, a room per instrument |
| subscribe frame shape | Not publicly specified, the web app emits `switchRoom` with `news_<coin_name>`, S2 | `42["switchRoom","news_BTCUSDTP"]` after the Socket.IO connect `40` |
| unknown symbol expectation | Not publicly specified | `news_NOPEUSDTP` answered three `42["news",null]` frames and nothing else in 20 s, both runs |
| chunk unit and budget | Not publicly specified | one room per `switchRoom` emit, 20 emits 1.5 s apart on one socket were all served |
| keepalive mechanism | Socket.IO 4: the server pings, S2 | server `2` every 25 s, the client answers `3` |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 60 s on either host, and 110 s on a spot socket in an earlier run |
| handshake and operation rate limits | Not publicly specified | none met, 12 sockets opened at once in each `errors` run and 10 in each `all` run |
| public market data authentication | none, S1 | none |
| message parse and routing | Not publicly specified | the Socket.IO event array, then `JSON.parse` of the payload string, then `JSON.parse` again of `data` for the two book lists |
| subscribe acknowledgement shape | none | no acknowledgement for `switchRoom`, the snapshot arrives 180 to 217 ms after the emit |
| symbol identifier format | `BTCUSDT Perpetual` in `name`, `BTCUSDTP` in `coin_name`, S4 | the book frame names no instrument, so routing is by socket or by arrival order |
| number representation | none | perpetual `rate` and `btc` are JSON numbers. Spot `USDT/INR` sends `rate` as a string with a `count` field |
| timestamp representation | none | book frames carry no time. Trade rows carry `time` as ISO 8601 with `Z` on perpetuals, and as `2026-09-23 03:08:02.562` with no zone on spot `USDT/INR` |
| size unit | Not publicly specified | perpetual `btc` is in base coins, section 4. Spot `BTC/INR` alone sends satoshis |
| sequence semantics | none | no id, sequence or version field on any book frame |
| idle repeat behaviour | none | a quiet room sends nothing after its snapshot, 38 s on `BTCUSDTP` in both runs |

## 4. The book channel in detail

This section is about the perpetual room unless a row says spot.

### Snapshot on subscribe

A `switchRoom` emit is answered by one `buyList`, one `sellList` and one `tradeList` frame for that room.
The first of the three arrived 180 to 217 ms after the emit over 20 rooms in the first run, and 184 to 202 ms in the second.
A socket that connects and joins no room gets three `42["news",null]` frames at connect, and nothing after.

### Update semantics

Every `buyList` or `sellList` frame is a whole side, not a delta.
The `BTCUSDTP` room sent no update in the 38 s after its snapshot in either run, and the other rooms were each watched for 1.5 s, so a perpetual update was not observed.
The spot stream, whose frames have the same shape, sent whole-side updates of 3 to 15 levels, 21 of them on 6 coins in 75 s and 13 on 3 coins in 45 s, each preceded by an empty frame, `42["news",{"coin":"USDT","data":""}]` on `coin=ALL` and `42["news",""]` on a single coin socket, P2.
The web app replaces its side on each frame and keeps no sequence, S2.

### Sequence and gap rule

There is none.
No book frame carries an id, a sequence number or a timestamp, so a gap cannot be detected.
A feed can only replace each side on each frame and reconnect when the socket drops.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| perpetual snapshot | best first, descending, 0 out of order in 40 room snapshots | best first, ascending, 0 out of order |
| spot snapshot and update | descending, 0 out of order on 8 pairs and on every `coin=ALL` update | ascending, 0 out of order |

### Level window

The spot stream holds 15 levels per side on every book deep enough, on 8 pairs in the rerun and 3 in the first run, while the REST route `exchangeData/orderbook` returned up to 333 bids for `BTC/INR`, see [`rest.md`](./rest.md) section 5.
No perpetual book had more than 11 levels on a side, so its window was not reached.
Fifteen levels is below the engine's 20, at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61.

### Size unit

| room | best level on the wire | reading |
|---|---|---|
| `news_BTCUSDTP` | `{"rate":64715.2075,"btc":0.0226}` | 0.0226 BTC, above the instrument's `min_allowed` of 0.0003 |
| `news_ETHUSDTP` | `{"rate":2764.03,"btc":0.904}` | 0.904 ETH, `min_allowed` 0.005 and `qnty_prec` 3 |
| `news_DOGEUSDTP` | `{"rate":0.07698,"btc":32478}` | 32,478 DOGE, about 2,500 USDT, `min_allowed` 100 and `qnty_prec` 0 |
| spot `BTC/INR` | `{"rate":3955011,"btc":409240}` | satoshis: the REST book shows `0.0040924` at the same price |

The perpetual size is in base coins, an inference from its magnitudes and the instrument's `min_allowed` and `qnty_prec`, since no page states the unit.
The instrument's `factor` is not a contract size: it is `100000000` for BTC and `1` for DOGE while both sizes read as coins, P7.
CCXT has no perpetual market, so there is no `contractSize` to compare.
On spot, the `BTC/INR` socket size equalled the REST size times 100,000,000 on 10 of 10 bids and asks in the rerun.
`ETH`, `SOL`, `XRP`, `DOGE` and `LTC` on INR matched the REST size one to one on 10 of 10 levels per side, and `BTC/USDT` did on its bids, while its REST asks came from a Cloudflare copy 86 minutes old, P1.

### One-sided and empty books

| state | rooms, both runs |
|---|---|
| two-sided | 7: `BTCUSDTP`, `BNBUSDTP`, `SOLUSDTP`, `ADAUSDTP`, `XRPUSDTP`, `DOGEUSDTP`, `1000SHIBUSDTP` |
| bids only | 5: `ETHUSDTP`, `MATICUSDTP`, `DOTUSDTP`, `AVAXUSDTP`, `TRXUSDTP` |
| asks only | 2: `IC15USDTP`, `BNSUSDTP` |
| empty | 6: `UNIUSDTP`, `XLMUSDTP`, `LTCUSDTP`, `LINKUSDTP`, `ATOMUSDTP`, `AAVEUSDTP` |

An empty side arrives as `{"type":"sellList","data":"[]"}`.
The newest trade in the six empty rooms is from 2022 or 2023.
The `BTCUSDTP` book was 11 bids from 7,841.26 down to 0.12 and one ask at 64,715.2075, against an index near 86,900, see [`rest.md`](./rest.md) section 4.

### Unknown and closed rooms

| request | reply | then |
|---|---|---|
| `switchRoom` `news_NOPEUSDTP` | `42["news",null]` three times | nothing in 20 s |
| no room | `42["news",null]` three times at connect | nothing |
| unknown event `42["nope","x"]` | nothing | the socket stays open |
| text that is not a Socket.IO packet, `hello` | the server closes the socket 193 to 208 ms later with code 1005, on both hosts | |
| spot `coin=NOPE`, `coin=btc`, or no `coin` | `42["news",null]` three times | nothing |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Socket.IO 4, S2 | the server sends `2` every 25 s and expects `3` |
| silence the server tolerates | Not publicly specified | a socket that connects and never answers `2` closed at 45.6 to 45.9 s with 1005, on both hosts and in both runs, which is `pingInterval` plus `pingTimeout` |
| missing Socket.IO connect | Not publicly specified | a socket that answered pings but never sent `40` also closed at 45.6 to 45.9 s |
| forced disconnect | Not publicly specified | none in 60 s on a socket that connected and answered pings |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header on either host, so the server does not negotiate it |
| engine versions | | the spot host also accepts `EIO=3`, connects the namespace itself and answers a client `2` with `3` |
| handshake | | 570 to 848 ms to open over 68 sockets, and the connect answer `40{"sid":…}` 179 to 225 ms later |
| subscription limits | Not publicly specified | 20 rooms joined in turn on one socket, all served |
| throughput | | the 20 room walk was 66 frames and 25.8 KB. A spot `coin=ALL` socket carried 393 to 410 KB in 20 to 75 s, almost all in its first three frames |

## 6. Captured frames

Handshake and connect answer on the futures host, run 2, `ws-probe.mjs futures`.

```text
0{"sid":"b70fIzBl27YfjCx0AAAH","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40{"sid":"cjhZwyU4lagC45GTAAAI"}
42["news",null]
```

Snapshot of `news_BTCUSDTP`, about 190 ms after the `switchRoom` emit, trimmed to three levels and three trades.

```text
42["news","{\"type\":\"buyList\",\"data\":\"[{\\\"rate\\\":7841.26,\\\"btc\\\":0.00160001},{\\\"rate\\\":20.01,\\\"btc\\\":0.6701},{\\\"rate\\\":20,\\\"btc\\\":0.1274}]\"}"]
42["news","{\"type\":\"sellList\",\"data\":\"[{\\\"rate\\\":64715.2075,\\\"btc\\\":0.0226}]\"}"]
42["news","{\"type\":\"tradeList\",\"data\":[{\"btc\":0.0003,\"rate\":7841.26,\"time\":\"2026-09-23T02:54:20.000Z\"},{\"btc\":0.0003,\"rate\":64715.2075,\"time\":\"2026-09-23T01:58:35.000Z\"},{\"btc\":0,\"rate\":64095.68,\"time\":\"2026-07-18T00:07:06.000Z\"}]}"]
```

A whole-side update on the spot `coin=ALL` socket, trimmed to two levels, with the empty frame that precedes it.

```text
42["news",{"coin":"USDT","data":""}]
42["news",{"coin":"USDT","data":"{\"type\":\"buyList\",\"data\":\"[{\\\"btc\\\":103.89,\\\"rate\\\":\\\"76.66\\\",\\\"count\\\":2},{\\\"btc\\\":17,\\\"rate\\\":\\\"76.50\\\",\\\"count\\\":1}]\"}"}]
```

Index, first frame of `ws-probe.mjs index`, run 2, trimmed to five coins.

```text
42["index_price_all",{"0":86928.8025,"1":1.6213525,"4":0.2218,"6":2770.92,"77":"0.00002881"}]
```

Keepalive, 25.6 s after the socket was created, answered by the client with `3`.

```text
2
```

## 7. Private channels

Named for a future execution stage, not probed.

- Spot executed orders on `https://wsorderv2.bitbns.com/?token=<token>`, event `delta_data`, with the token from `POST /api/trade/v1/getOrderSocketToken/USAGE`, S1 and `server/node_modules/ccxt/js/src/bitbns.js` line 111.
- The perpetual API is REST only: `futuresInstList`, `futuresPlaceOpenOrder`, `futuresOpenPositions` and the rest under `https://api.bitbns.com/api/trade/v1/`, all signed, S4.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It is not recommended to build this feed, because the perpetual books are mostly empty or stale and the stream is undocumented, see [`fees.md`](./fees.md) section 9.
If it is ever built, this is the shape the probes support.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://socket.bitbns.com/bnsFuturesSocket/?EIO=4&transport=websocket` | the only perpetual book source |
| framing | Socket.IO 4 by hand: send `40` after `0`, answer `2` with `3`, parse `42` arrays | the server speaks Socket.IO, not plain JSON |
| markets per connection | 1 | a book frame names no instrument, and whether `switchRoom` leaves the previous room was not determined |
| subscribe frame | `42["switchRoom","news_<coin_name>"]` after `40` | the web app's emit |
| keepalive | answer every `2` with `3`, no client ping | the server drives the ping |
| `maxSilenceMs` | 60,000 | the server pings every 25 s, and a quiet room sends nothing else |
| snapshot | each `buyList` or `sellList` frame: `resetBook` of that side and `publish` | every frame is a whole side |
| resync | none by sequence, reconnect on close or on a frame that fails to parse | the stream has no sequence |
| receive time | stamp on arrival | book frames carry no time |
| depth | at most 15 levels per side, below the engine's 20 | the spot window, section 4 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbns API docs, WebSockets: Introduction, Live order book, Live ticker data | https://docs.bitbns.com/bitbns/websockets/introduction | 2026-09-22 | BitBNS | spot socket URLs, `news` and `ticker` events, private socket, sections 1, 2 and 7 |
| S2 | Bitbns web app bundles `index.90dda0f6.js`, `index.c7bf753d.js`, `chartHeader.51f4291a.js` | https://bitbns.com/trade/assets/ | 2026-09-22 | BitBNS | `/bnsFuturesSocket`, `switchRoom`, `news_<coin>USDTP`, `/bnsIndexSocket` and `index_price_all`, options socket, sections 1 to 4 |
| S3 | Bitbns Beginner's Guide, Index Price Calculations | https://docs.bitbns.com/bitbns-beginners-guide/guides/bitbns-futures-beginners-guide/what-are-perpetual-futures-contracts/index-price-calculations | 2026-09-22 | BitBNS | mark equals index, section 2 |
| S4 | Bitbns API docs, Futures, Active Markets | https://docs.bitbns.com/bitbns/futures/active-markets | 2026-09-22 | BitBNS | instrument names, signed futures API, sections 3 and 7 |
| P1 | `ws-probe.mjs book` at 05:11 UTC, 45 s, and an earlier revision at 04:51 UTC, 60 s, 3 pairs | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | spot snapshot, 15 level window, size unit, ticker, sections 2 and 4 |
| P2 | `ws-probe.mjs all` at 05:01 UTC, 75 s, and 05:11 UTC, 45 s | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | whole-side updates, empty prelude frames, level shapes, sections 4 and 6 |
| P3 | `ws-probe.mjs futures` at 05:04 and 05:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | 20 rooms, snapshot timing, one-sided and empty books, sections 1 to 4 and 6 |
| P4 | `ws-probe.mjs index` at 05:08 and 05:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | index burst every 5.0 s, sections 1, 2 and 6 |
| P5 | `ws-probe.mjs silence` at 05:05 and 05:14 UTC, 60 s, and a spot-only revision at 04:58 UTC, 110 s | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | ping cadence, 45.6 to 45.9 s closes, section 5 |
| P6 | `ws-probe.mjs errors` at 05:06 and 05:15 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | unknown room and coin, not-a-packet close, deflate refusal, `EIO=3`, sections 3 to 5 |
| P7 | `rest-probe.mjs catalog` at 04:56 and 05:09 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `coin_name`, `factor`, `min_allowed`, section 4 |
