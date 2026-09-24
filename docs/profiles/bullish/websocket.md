# Bullish WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, where every production socket was refused with HTTP 403 by location, so the protocol was captured on the SimNext test environment.

This profile covers the public market data WebSockets of Bullish (CCXT id `bullish`) for its one perpetual family, USDC-settled linear perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs), and the capture is quoted beside the documented value.
Production `wss://api.exchange.bullish.com` refused the handshake on every path, so every probed value comes from `wss://api.simnext.bullish-test.com`, which the documentation names as the test environment "with all services reachable", S3.
SimNext runs its own markets, whose books sit far from real prices and mostly stand still, so frame rates, level counts and idle behaviour there are not production numbers.
The protocol, the frame shapes, the sequence rule and the error codes are what SimNext shows, and production is assumed to share them only because the same documentation covers both.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| all public market data, production | `wss://api.exchange.bullish.com` plus a path per channel, S3 | HTTP 403 on `/trading-api/v1/market-data/orderbook`, `/market-data/tick`, `/market-data/tick/BTC-USDC-PERP`, `/market-data/trades` and `/trading-api/v1/index-data`, in 43 to 183 ms over two runs, from Cloudflare colos `SEA` and `YVR`, body "The Bullish platform is not currently available in your location.", P1 |
| production, registered and direct | `wss://registered.api.exchange.bullish.com` for "white-listing", and `wss://prod.access.bullish.com` for a direct connection, S3 | not probed, since both need an arrangement with support and trying them would be a route around the refusal |
| test environment | `wss://api.simnext.bullish-test.com`, S3 | open in 739 to 791 ms on every probe socket, P2 to P4 |
| private data | `wss://api.exchange.bullish.com/trading-api/v1/private-data`, CCXT Pro at `server/node_modules/ccxt/js/src/pro/bullish.js` line 31 | not probed |

The path picks the channel, and every market type shares it.
On SimNext one orderbook socket carried perpetuals, a disabled perpetual and the spot market `BTCUSDC` side by side, P2.
Bullish lists only USDC-settled perpetuals, see [`fees.md`](./fees.md) section 3, so there is no settlement family split.

## 2. Channel matrix for public market data

| path | topic and params | content | probed on SimNext |
|---|---|---|---|
| `/trading-api/v1/market-data/orderbook` | `l2Orderbook`, `symbol` | full book, "Array of size 200 where even indices denote price, odd indices denote absolute quantities", S2 | a full `snapshot` frame on subscribe and every later frame a full `snapshot` too, up to 200 levels per side, recommended |
| same | `l1Orderbook`, `symbol` | best bid and ask with `sequenceNumber`, S1 | one `snapshot`, then an `update` about every second on BTC, 60 frames in 60 s with 0 sequence gaps |
| `/trading-api/v1/market-data/tick` | `tick`, `symbol` | the Get Market Tick model, with `markPrice` and `fundingRate`, S4 | `snapshot` then `update`, about every 2 s on BTC, one frame in 60 s on a quiet perp |
| `/trading-api/v1/market-data/tick/{symbol}` | none, one market per socket, S4 | same | not probed beyond the production refusal |
| `/trading-api/v1/index-data` | `indexPrice`, `assetSymbol` | index price per asset in USD, S5 | `snapshot` then `update` every 2,000 ms median, on BTC and CD20, the documentation mentions no snapshot |
| `/trading-api/v1/market-data/trades` | `anonymousTrades`, `symbol` | public trades, S6 | not probed |
| auction channel | | auction phase and imbalance, S7 | not probed |

No channel carries index, mark and funding together.
The tick carries mark and funding but no index, and the index channel is keyed by asset, not by market.
The documented "Hybrid Order Book WebSocket (unauthenticated)" was scheduled "to be removed June 2025", and the `depth` subscription parameter was removed in 2025-03, S8.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The probed column is SimNext, P2 to P5, because production refused the handshake.

| axis | documented | probed on SimNext |
|---|---|---|
| endpoint split axis | one path per channel on one host, S3 | one orderbook socket served perpetuals and spot together |
| subscribe frame shape | JSON-RPC 2.0: `{"jsonrpc": "2.0", "type": "command", "method": "subscribe", "params": {"topic": "l2Orderbook", "symbol": "BTCUSD"}, "id": "<COMMAND_ID>"}`, one symbol per frame, S1 | as documented, 22 frames for 22 perpetuals, 22 acks |
| unknown symbol expectation | error with code `-32602`, S1 | orderbook: `errorCode` `"29013"`, `"'NOPE-USDC-PERP' is not a valid symbol"`. Tick: `errorCode` `29014`, `INVALID_MARKET_ERROR`. Index: `29014`, `"'NOPE' is not a valid market"` |
| chunk unit and budget | Not publicly specified per connection. 100 unauthenticated connections per IP address, S9 | 22 subscriptions on one socket, all acked and all delivering |
| keepalive mechanism | "An idle WebSocket closes automatically after 5 minutes." Client sends `keepalivePing`, S10 | no server protocol ping on any socket. The application pong came back within 1.5 s |
| connection lifetime and maintenance notice | Not publicly specified | none seen in 120 s |
| handshake and operation rate limits | 100 open unauthenticated connections per IP, S9 | no refusal at 22 subscribe frames sent in one burst |
| public market data authentication | none | none |
| message parse and routing | `type`, `dataType`, `data.symbol`, S1 | route on `dataType` `V1TALevel2` and `data.symbol`. Control frames carry `id` and `result` or `error` and no `dataType` |
| subscribe acknowledgement shape | `{"id", "jsonrpc", "result": {"responseCodeName": "OK", "responseCode": "200", "message": "Successfully subscribed ( BTCUSD 1)"}}`, S1 | as documented, with the trailing `2` for `l2Orderbook` and `1` for `l1Orderbook`. The tick and index acks say only "Successfully subscribed" and send `responseCode` as the number `200` |
| symbol identifier format | `BTC-USDC-PERP` for a perpetual, `BTCUSDC` for spot, S11 | `data.symbol` equals CCXT `market.id` and the REST `symbol` on every frame |
| number representation | strings, S2 | prices and sizes are strings, `sequenceNumberRange` is two JSON integers, the l1 `sequenceNumber` is a string |
| timestamp representation | `timestamp` and `publishedAtTimestamp` as epoch ms strings, `datetime` ISO 8601, S2 | as documented. A quiet book's snapshot carried a `timestamp` about 10 h old |
| size unit | "absolute quantities", S2 | base asset units. CCXT `contractSize` is 1 on every perpetual, section 4 |
| sequence semantics | `sequenceNumberRange` bounds "are equal for initial snapshot", and "this may differ for subsequent snapshots", S2 | lower equal to upper on every frame, and lower equal to the previous upper plus one on every frame, 0 gaps |
| idle repeat behaviour | not documented | a book that did not change was resent about once a second with a new sequence number on some perpetuals, and not at all on others |

## 4. The book channel in detail

`l2Orderbook` on `/trading-api/v1/market-data/orderbook` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each symbol is `"type": "snapshot"` with the whole book, 178 to 354 ms after the subscribe frame and 918 to 1,146 ms after the socket was created, over two runs, P2.
Its `sequenceNumberRange` had lower equal to upper, as the specification says, S2.

### Delta semantics

There are none on the wire.
Every `l2Orderbook` frame on SimNext was a full `snapshot`: 60 of 60 on each of `BTC-USDC-PERP`, `ETH-USDC-PERP` and `CD20-USDC-PERP` in 60 s in both runs, and 190 to 194 frames across 22 perpetuals in each 30 s batch run, with no `update` frame, P2 and P3.
The channel page promises "an initial snapshot followed by incremental updates", S1, while the specification of the same message calls later frames "subsequent snapshots", S2.
CCXT Pro agrees with the wire, with the comment "'l2Orderbook' returns only snapshots while 'l1Orderbook' returns only updates" at `server/node_modules/ccxt/js/src/pro/bullish.js` line 284, and it resets its book on every frame at line 334.
A feed therefore replaces the whole book on every frame.

### Sequence and gap rule

```text
first frame                     replace the book, last = upper
lower = last + 1                replace the book, last = upper
lower > last + 1                replace the book anyway, since the frame is complete, and log the jump
upper <= last                   drop the frame as stale
```

`l1Orderbook` and `l2Orderbook` share one sequence space per symbol: the first l1 `sequenceNumber` on BTC equalled the first l2 range, 24498993 in the first run and 24499705 in the second, P2.
On SimNext every range had lower equal to upper, and the chain held with 0 gaps on every symbol in every run.
A range wider than one number is what the specification describes for a snapshot that covers several book events, and it was never seen, so how often production conflates is Not verified.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `l2Orderbook` snapshot | best first, descending, 0 violations over every frame of every run | best first, ascending, 0 violations |
| REST `orderbook/hybrid` | descending | ascending |

Each side is one flat array that alternates price and size, `["65931.6000","0.02679673","65931.5000",…]`.

### Level window

The specification says "Array of size 200", S2, which is 100 levels.
The wire carried up to 200 levels per side, 400 strings: BTC held 199 or 200 bids and 93 asks, CD20 and CHZ held 200 a side, P2.
The engine keeps 20 levels, so either reading is enough.

### Size unit against CCXT `contractSize`

Sizes are base asset quantities, and `contractMultiplier` is `"1"` on all 47 SimNext perpetuals, which CCXT turns into `contractSize` 1 at `server/node_modules/ccxt/js/src/bullish.js` line 811, see [`rest.md`](./rest.md) section 2.
On `BTC-USDC-PERP` the REST book and the socket at the same sequence number, 24499025 in the first run and 24499737 in the second, agreed on all 40 of the top 40 bid prices and all 40 sizes, and the best bid read `"0.00130728"` BTC on both in the first run, P2.
The engine's size multiplier of 1 therefore converts Bullish sizes correctly.
`SHIB1M-USDC-PERP` quotes one million SHIB per unit, S12, which is a price scale question for the catalog, not a size unit question.

### One-sided and empty books

An empty side arrives as an empty array, `"bids":[]`, P3.
On SimNext 7 of 22 perpetuals sent asks and no bids, and 6 sent neither bids nor asks, `CMWTI`, `ETC`, `FET`, `FIL`, `LINK` and `LTC`, in both batch runs, P3.
The engine's `resetBook` accepts an empty side.

### Idle repeats

The server resent an unchanged book with a new sequence number on some perpetuals: 59 of 60 ETH frames and 59 of 60 CD20 frames repeated the previous levels exactly, in both runs, P2.
BTC changed on every frame, because its SimNext sizes drift.
A quiet book sends one snapshot and then nothing: `CHZ-USDC-PERP` sent 1 frame in 60 s, and 17 of 22 perpetuals sent 1 frame in 30 s, P2 and P3.
So a feed cannot rely on book traffic to keep a socket alive, see section 5.

### Unknown, closed and wrong requests

| request | reply | then |
|---|---|---|
| `l2Orderbook` `NOPE-USDC-PERP` | `{"jsonrpc":"2.0","id":"12","error":{"code":"-32602","errorCode":"29013","errorCodeName":"'NOPE-USDC-PERP' is not a valid symbol"}}` | nothing |
| `l2Orderbook` `FTM-USDC-PERP`, a disabled perpetual | success, "Successfully subscribed ( FTM-USDC-PERP 2)" | one snapshot |
| `l2Orderbook` `BTC-USDC-PERP` a second time | no reply at all | the first subscription keeps delivering |
| `l2Orderbook` with no `symbol` | `errorCode` `"29013"`, `"'' is not a valid symbol"` | |
| topic `abcde` | `errorCode` `"29013"`, `"'abcde' is not a valid topic"` | |
| method `nope` | `errorCode` `"29012"`, `"'nope' is not a valid method"` | |
| text that is not JSON | `{"jsonrpc":"2.0","id":"","error":{"code":"-32602","errorCode":"29012","errorCodeName":"'' is not a valid method"}}` | the socket stays open |
| `l2Orderbook` `BTCUSDC`, spot, on the same socket | success | several snapshots a second |

Because a disabled market is acknowledged and served, the catalog's `marketEnabled`, which CCXT maps to `active`, is what keeps a closed perpetual out of a feed.

## 5. Session

| item | documented | probed on SimNext |
|---|---|---|
| keepalive | `{"jsonrpc": "2.0", "type": "command", "method": "keepalivePing", "params": {}, "id": "<COMMAND_ID>"}`, S10. CCXT Pro sends it and notes "bullish does not support built-in ws protocol-level ping-pong" at `server/node_modules/ccxt/js/src/pro/bullish.js` lines 57 to 68 | pong `{"jsonrpc":"2.0","id":"19","result":{"responseCode":200,"responseCodeName":"OK","message":"Keep alive pong"}}`. No server protocol ping on any socket |
| silence the server tolerates | "An idle WebSocket closes automatically after 5 minutes.", S10. CCXT Pro sets `'keepAlive': 99000` with the comment "disconnect after 100 seconds of inactivity" at line 48 | a socket with nothing sent after the handshake closed at 60.76 and 60.79 s, and a socket subscribed to a quiet book, whose last frame came at 0.93 or 0.94 s, closed at 60.92 and 60.94 s, all with 1006 and no close frame. A socket that sent `keepalivePing` every 30 s, and in the second run a socket subscribed to the busy BTC book with no ping, stayed open for the full 120 s. So about 60 s with no frame closes a socket, and book frames from the server alone keep it open, P4 |
| forced disconnect | Not publicly specified | none in 120 s. When the client closed three sockets with code 1000, two got a 1000 back within 200 ms and one ended with 1006 after 2.2 s, P2 |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it, P5 |
| handshake | | 739 to 791 ms to open from this host |
| subscription limits | 100 open unauthenticated connections per IP address, S9 | a repeated subscription is ignored silently |
| throughput | | 22 perpetuals on one socket over three 30 s runs: median 5 frames per second, 36.9 to 37.7 KB per second, 5,820 to 5,835 bytes per frame, 107 to 124 µs `JSON.parse` per frame, P3 |

The three idle limits disagree: the documentation says 5 minutes, CCXT says 100 s, and SimNext closed at about 60 s.
A ping every 20 s satisfies all three.

## 6. Captured frames

Trimmed, from the SimNext probe runs of 2026-09-22 local time, which the frames stamp as 2026-09-23 UTC.
Level arrays are cut to three levels.

Subscribe.

```json
{"jsonrpc": "2.0", "type": "command", "method": "subscribe", "params": {"topic": "l2Orderbook", "symbol": "BTC-USDC-PERP"}, "id": "1"}
```

Acknowledgement.

```json
{"jsonrpc": "2.0","id": "1","result": {"responseCode": "200","responseCodeName": "OK","message": "Successfully subscribed ( BTC-USDC-PERP 2)"}}
```

Snapshot, the first frame after the acknowledgement.

```json
{"type":"snapshot","dataType":"V1TALevel2","data":{"symbol":"BTC-USDC-PERP","bids":["65931.6000","0.02679673","65931.5000","0.02693164","65931.4000","0.02693169"],"asks":["65931.7000","0.00128077","65948.2000","3.97360380","65967.2000","5.11417202"],"sequenceNumberRange":[24498993,24498993],"datetime":"2026-09-23T01:28:14.741Z","timestamp":"1790126894741","publishedAtTimestamp":"1790126894907"}}
```

Snapshot of a one-sided quiet book, whose `timestamp` is about 10 h older than its `publishedAtTimestamp`.

```json
{"type":"snapshot","dataType":"V1TALevel2","data":{"symbol":"ARB-USDC-PERP","bids":[],"asks":["0.1701","1.304909","0.1702","1.570913","0.1703","1.569528"],"sequenceNumberRange":[182581,182581],"datetime":"2026-09-22T15:18:12.443Z","timestamp":"1790090292443","publishedAtTimestamp":"1790127282836"}}
```

Best bid and ask, snapshot then update.

```json
{"type":"snapshot","dataType":"V1TALevel1","data":{"symbol":"BTC-USDC-PERP","bid":["65931.6000","0.02679673"],"ask":["65931.7000","0.00128077"],"sequenceNumber":"24498993","datetime":"2026-09-23T01:28:14.741Z","timestamp":"1790126894741","publishedAtTimestamp":"1790126894907"}}
```

```json
{"type":"update","dataType":"V1TALevel1","data":{"symbol":"BTC-USDC-PERP","bid":["65931.6000","0.02684193"],"ask":["65931.7000","0.00128077"],"sequenceNumber":"24498994","datetime":"2026-09-23T01:28:15.745Z","timestamp":"1790126895745","publishedAtTimestamp":"1790126895773"}}
```

Keepalive.

```json
{"jsonrpc": "2.0", "type": "command", "method": "keepalivePing", "params": {}, "id": "19"}
```

```json
{"jsonrpc":"2.0","id":"19","result":{"responseCode":200,"responseCodeName":"OK","message":"Keep alive pong"}}
```

Errors.

```json
{"jsonrpc":"2.0","id":"12","error":{"code":"-32602","errorCode":"29013","errorCodeName":"'NOPE-USDC-PERP' is not a valid symbol"}}
```

```json
{"jsonrpc":"2.0","id":"","error":{"code":"-32602","errorCode":"29012","errorCodeName":"'' is not a valid method"}}
```

Tick, with the fields an anchor needs and the long tail cut.
`fundingRate` is in percent here, see [`rest.md`](./rest.md) section 3.

```json
{"type":"snapshot","dataType":"V1TATickerResponse","data":{"bestAsk":"65931.7000","bestBid":"65931.6000","createdAtTimestamp":"1790126895654","publishedAtTimestamp":"1790126895667","symbol":"BTC-USDC-PERP","markPrice":"65923.9773","fundingRate":"-0.006250","openInterest":"3063.86533194"}}
```

Index.

```json
{"type":"snapshot","dataType":"V1TAIndexPrice","data":{"price":"86610.0000","assetSymbol":"BTC","updatedAtDatetime":"2026-09-23T01:28:14.669Z","updatedAtTimestamp":"1790126894669"}}
```

## 7. Private channels

Named for a future execution stage, from the documentation sitemap and CCXT Pro, not probed.
They use `/trading-api/v1/private-data` with a JWT cookie from a REST login, at `server/node_modules/ccxt/js/src/pro/bullish.js` lines 96 to 103.

- Topics `orders`, `trades`, `assetAccounts`, `spotAccounts`, `tradingAccounts`, `derivativesPositions`, `derivativesPositionsV2`, `ammInstructions`, `mmpRequest` and `mmpTrigger`, S13.
- 10 authenticated connections per API key, S9.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only for a host that Bullish serves, see [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.exchange.bullish.com/trading-api/v1/market-data/orderbook` | one path serves every perpetual |
| channel | `l2Orderbook` per `rawMarketId` | a full book of up to 200 levels on every frame |
| markets per connection | every tracked perpetual on one connection, 22 or fewer | 22 ran on SimNext, and no per connection cap is published |
| subscribe frames | one frame per market, `{"jsonrpc": "2.0", "type": "command", "method": "subscribe", "params": {"topic": "l2Orderbook", "symbol": "BTC-USDC-PERP"}, "id": "<n>"}` | the protocol takes one symbol per frame |
| keepalive | `keepalivePing` every 20 s | the server sends no ping, quiet books send nothing, and SimNext closed an idle socket at 60 s |
| `maxSilenceMs` | 45,000 | two missed pongs, and the pong has to count as traffic because a quiet book sends nothing |
| routing | `data.symbol` is the `rawMarketId` on frames whose `dataType` is `V1TALevel2` | |
| every book frame | `resetBook` with both sides, then store the range's upper bound | every frame is a full snapshot |
| sequence | drop a frame whose upper bound is at or below the stored one, and log a lower bound above the stored one plus one | a jump loses nothing when the frame is whole |
| resync | only when a subscription is answered with an error or a tracked market sends no snapshot within 10 s of its ack | there is no delta chain to break |
| receive time | stamp on arrival, never from `timestamp` | a quiet book's snapshot carries a `timestamp` hours old |
| sizes | `Number()` of the string, in base units | `contractSize` 1 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The frame rate of a busy production book, and whether production conflates several events into one wider range, are Not verified, because production refused this host.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bullish WebSocket, Multi-Order Book | https://docs.exchange.bullish.com/websocket/public/market-data/orderbook | 2026-09-22 | global | subscribe, ack, snapshot and update claims, nack, sections 2 to 4 |
| S2 | Multi-Order Book AsyncAPI specification | https://docs.exchange.bullish.com/assets/files/ws-mkt-data-orderbook-994d2943030aaaad03b1294c1f9d95fc.yml | 2026-09-22 | global | "Array of size 200", `sequenceNumberRange` semantics, field types, sections 3 and 4 |
| S3 | Bullish WebSocket, List of Servers | https://docs.exchange.bullish.com/websocket/servers/server | 2026-09-22 | global | six hosts, SimNext, section 1 |
| S4 | Bullish WebSocket, Anonymous Ticks | https://docs.exchange.bullish.com/websocket/public/market-data/ticks | 2026-09-22 | global | tick paths and model, section 2 |
| S5 | Bullish WebSocket, Index Data | https://docs.exchange.bullish.com/websocket/public/index-data | 2026-09-22 | global | `indexPrice` topic, section 2 |
| S6 | Bullish WebSocket, Anonymous Trades | https://docs.exchange.bullish.com/websocket/public/market-data/trades | 2026-09-22 | global | trades topic, section 2 |
| S7 | Bullish WebSocket, Auction | https://docs.exchange.bullish.com/websocket/public/market-data/auction | 2026-09-22 | global | auction channel, section 2 |
| S8 | Bullish REST API changelog | https://docs.exchange.bullish.com/rest/changelog | 2026-09-22 | global | hybrid book socket removal, `depth` removal, section 2 |
| S9 | Bullish WebSocket, Rate Limits | https://docs.exchange.bullish.com/websocket/protocol/rate-limit | 2026-09-22 | global | 100 unauthenticated connections per IP, 10 per API key, sections 3, 5 and 7 |
| S10 | Bullish WebSocket, Keepalive | https://docs.exchange.bullish.com/websocket/protocol/keepalive | 2026-09-22 | global | 5 minute idle close, ping frame, section 5 |
| S11 | Bullish Trading API OpenAPI specification | https://docs.exchange.bullish.com/assets/files/bullish-trading-api-ed81ea9ddf394481dce1122ec500c9bf.yml | 2026-09-22 | global | symbol formats, section 3 |
| S12 | Bullish Help Center, Understanding Multiplied Assets | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/20807684 | 2026-09-22 | Bullish GI | `SHIB1M-USDC-PERP` is one million SHIB, section 4 |
| S13 | Bullish developer docs sitemap, private data operations | https://docs.exchange.bullish.com/sitemap.xml | 2026-09-22 | global | private topic names, section 7 |
| S14 | CCXT Pro 4.5.68 `bullish.js` | `server/node_modules/ccxt/js/src/pro/bullish.js` | 2026-09-22 | CCXT | URLs, keepalive, l2 comment, book reset, sections 1, 4, 5 and 7 |
| P1 | `ws-probe.mjs access`, at 01:27 and 01:39 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs) | 2026-09-22 | this host, production | refusal on every path, section 1 |
| P2 | `ws-probe.mjs book`, at 01:28 and 01:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs) | 2026-09-22 | this host, SimNext | sections 1 to 6 |
| P3 | `ws-probe.mjs batch`, at 01:29, 01:34 and 01:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs) | 2026-09-22 | this host, SimNext | throughput, one-sided books, sections 4 and 5 |
| P4 | `ws-probe.mjs silence`, at 01:28 and 01:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs) | 2026-09-22 | this host, SimNext | idle close, section 5 |
| P5 | `ws-probe.mjs deflate`, at 01:28 and 01:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs) | 2026-09-22 | this host, SimNext | compression, section 5 |
