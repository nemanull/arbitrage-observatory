# Paradex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:26 to 22:43 UTC, first runs and second pass, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket API of Paradex (CCXT id `paradex`), with the book channel in detail.
Since 2026-09-21 every public channel payload is a binary Simple Binary Encoding (SBE) frame, while subscribe requests, acknowledgements and errors stay JSON-RPC text frames, S1 and S2.
So a feed needs an SBE decoder, and section 4 gives the layout of the frames it reads, checked against the wire.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py), which carries its own decoder of the public templates, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC, and the probe runs are listed as P1 to P8 in section 9.
Fees and access are in [`fees.md`](./fees.md), and the REST API, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every market, mainnet | `wss://ws.api.prod.paradex.trade/v1`, S1, with `?sbeSchemaId=1&sbeSchemaVersion=1` appended, S2 | the plain URL is refused at the handshake with HTTP 400 and the JSON body in section 6. With the parameters the socket opened in 96 to 431 ms, P1 to P8 |
| testnet | `wss://ws.api.testnet.paradex.trade/v1`, S1 | not probed |

One socket carries every market and every public channel, and one socket held 66 book subscriptions, P3.
`ws.api.prod.paradex.trade` resolved to `13.248.249.50` and `3.33.130.209`, two AWS Global Accelerator addresses, and the servers sit in AWS `ap-northeast-1`, Tokyo, S11 and [`rest.md`](./rest.md) section 1.
The upgrade reply carried only a `Date` header, so the edge in front of the socket is not visible from here, P1.

## 2. Channel matrix for public market data

Cadences are over 45 to 50 s per run on BTC-USD-PERP unless another market is named.
"Age at arrival" is local arrival minus the frame's `ts`, and the local clock sat within about 50 ms of the server's, see [`rest.md`](./rest.md) section 7.

| channel | payload, SBE template | documented | probed |
|---|---|---|---|
| `order_book.{market}.snapshot@15@50ms` or `@100ms`, optional `@{price_tick}` | `BookEvent`, 3, the API book without RPI orders, 15 levels a side, every frame whole | feed type `snapshot`, depth 15 only, rate 50 or 100 ms, S5 | sent only when the book changed, never an unchanged repeat. 15 levels on BTC, ETH and SOL, and 12 bids with 8 or 9 asks on XRP. Interval min 40.5 ms and p50 100 ms on BTC, age at arrival p50 95 to 116 ms, P2 and P7 |
| `order_book.{market}.deltas` | `BookEvent`, 3, the whole API book once, then changed levels | documented as a feed type of the `@15@{rate}` channel, S5 | the parameters are refused with "no parameters expected for deltas topic.", and the bare name works. Full depth, sequence steps of exactly 1, age at arrival p50 66 to 79 ms, section 4, P2 and P7 |
| `order_book.{market}.interactive@15@100ms` | `BookEvent`, 3, the book with RPI orders, plus `bestBidApi*`, `bestAskApi*` and `relativeSpread` | feed type `interactive`, S5 | 23 to 31 levels a side on BTC although the name says 15, interval p50 201 ms, P2 and P7 |
| `order_book.{market}.interactive_deltas` | `BookEvent`, 3 | feed type `interactive_deltas`, S5 | the parameters are refused as for `deltas`. A first frame of 107 or 112 bids and 39 or 35 asks on ETH, then deltas, P2 and P7 |
| `bbo.{market}` | `BboEvent`, 2, API best bid and ask | "Size on the best bid from API (excluding RPI)", S6 | on change only. Interval p50 34 to 47 ms on BTC, age at arrival p50 72 to 78 ms, and its `seq` is the book's sequence, P2 and P7 |
| `trades.{market}` | `TradeEvent`, 1 | S2 | acknowledged and served, P5 |
| `markets_summary.{market}` | `MarketSummaryEvent`, 4: mark, index, funding rate, best bid and ask, open interest | S7 | one frame a second per market with `ts` on a 1 s grid. Age at arrival 405 to 1,125 ms, P4 and P7 |
| `markets_summary` or `markets_summary.ALL` | the same, for every market including 9,440 dated options | S7 | 131,764 and 138,615 frames in 15 s, of which 902 and 963 were perpetuals, P4 and P7 |
| `funding_data.{market}` or `funding_data.ALL` | `FundingDataEvent`, 5 | S8 | one frame every 5 s per market, age at arrival 422 to 488 ms. `ALL` gave 66 and 132 frames in 8 s, P4 and P7 |
| `funding_rate_comparison.ALL@{rate}` | `FundingRateComparisonEvent`, 6 | S3 | not probed |
| `markets[.{market}]` | market static data, JSON | not in the SBE table of S2 | not probed |

No channel carries the index or the mark alone.
`markets_summary.{market}` is the only per-market channel with both, and section 8 recommends it as the anchor source.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one mainnet URL, S1 | one socket carried books, summaries and funding for many markets, P2 to P4 |
| subscribe frame shape | `{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"<name>"},"id":1}`, one channel per frame, S4 | as documented. A frame without `id` is acknowledged with `"id":0`, P5 |
| unknown symbol expectation | Not publicly specified | a JSON-RPC error `-32600` with `"data":"market does not exist"` and the request's `id`, and the socket stays open and keeps serving its other channels. A lowercase market name gets the same error, P5 |
| chunk unit and budget | no subscription cap is documented. "Subscribing to the same channel more than once will return an error", S4 | 66 subscribe frames sent at once were all acknowledged, P3 and P8. A duplicate subscribe was acknowledged a second time rather than refused, P5 and P8, and its frames did not double: 103 BBO frames carried 103 distinct `seq` values, P8. Checked on 2026-10-12, the acknowledgements and the first frames are paced per socket: the first 20 requests of a burst are served at once and the rest one every 100 ms, so 201 requests on one socket took 17.9 s, while two sockets of 102 requests each took 8.0 s side by side, P9 |
| keepalive mechanism | the server sends a protocol ping every 55 s and closes if no pong comes within 5 s, S1 | server pings at 14.3, 44.4 and 74.5 s in P6 and at 9.7, 39.8 and 69.9 s in P8, so every 30.1 s. A socket that never answered got one ping, at 25.3 s and 17.3 s, and a close frame with code 1001 and reason `shutting down` exactly 45.0 s later in both runs, P6 and P8 |
| connection lifetime and maintenance notice | releases every weekday at 04:30 UTC, about 15 minutes, through `CANCEL_ONLY` and `POST_ONLY`, S14 | no forced close in 75 s, P6 and P8. The release window was not captured |
| handshake and operation rate limits | 20 connections a second or 600 a minute per IP, S10 | the refused upgrade reply carried `X-RateLimit-Limit: 20` and `X-Ratelimit-Window: 1`, P1 and P8, while an accepted one carried only `Date`. Four sockets opened together without refusal, P2 |
| public market data authentication | none for public channels, S1 | none |
| message parse and routing | channel data is binary SBE, everything else JSON-RPC text, S2 | route text frames as acknowledgements or errors, and binary frames by the 2-byte template id at offset 2, then by the `market` string at the end of the frame. A binary frame does not name its channel |
| subscribe acknowledgement shape | `{"jsonrpc":"2.0","result":{"channel":"<name>"},"usIn":…,"usDiff":…,"id":1}`, S4 | as documented, before the first data frame, P1 |
| symbol identifier format | the market symbol, `BTC-USD-PERP`, S5 | exactly CCXT's `market.id` and REST's `symbol`, including the lowercase `k` of `kPEPE-USD-PERP`, P2 to P4 |
| number representation | every price and size is an `int64` mantissa with a constant exponent of -8, and funding at 12 decimals uses -12, null is `INT64_MIN`, S3 | as documented. `82542.1` arrives as the mantissa `8254210000000`, section 6 |
| timestamp representation | `int64` microseconds since the epoch, S3 | book and BBO `ts` values end in `000`, so they carry milliseconds. Summary and funding `ts` sit on whole seconds plus 156 ms, P4 and P7 |
| size unit | base currency, as the markets API says of its order sizes, see [`rest.md`](./rest.md) section 2 | coins of the base, `0.01134` BTC at the touch, and thousands of tokens on `kPEPE`, which matches CCXT `contractSize` 1, section 4 |
| sequence semantics | the schema calls `seq` a "Sequence number" and says "DELTA must be applied in order", S3 | on `deltas` every frame advanced `seq` by exactly 1: 295, 346 and 60 steps in P2 and 425, 275 and 83 in P7 on BTC, ETH and SOL, and 4,506 deltas on 66 markets in P8 broke no step |
| idle repeat behaviour | not documented | no book channel repeats an unchanged book. A quiet market sends nothing, as TSLA, WLFI, XAU, XCU and XPT in P3, and PAXG, TSLA, XAG, XCU and XPT in P8, sent only their first frame in 45 s. Summaries arrive every second regardless |

## 4. The book channel in detail

### SBE frame layout

Every binary frame starts with an 8-byte little-endian header, S3.

| offset | field | type |
|---:|---|---|
| 0 | `blockLength`, the length of the root block that follows | `uint16` |
| 2 | `templateId`, 3 for a book | `uint16` |
| 4 | `schemaId`, 1 | `uint16` |
| 6 | `version`, the negotiated schema version | `uint16` |

A `BookEvent` root block is 89 bytes in every version served, P1, and its fields follow in schema order with no padding, S3.

| offset in the block | field | type | meaning |
|---:|---|---|---|
| 0 | `ts` | `int64` | publish time in µs, with ms resolution on the wire |
| 8 | `seq` | `int64` | the market's book sequence, shared with REST `seq_no` and with `bbo` |
| 16 | `pkgType` | `uint8` | 0 a snapshot, 1 a delta |
| 17 | `bestBidPrice`, `bestBidSize`, `bestAskPrice`, `bestAskSize` | 4 × `int64` | documented as the best with RPI on interactive feeds and null elsewhere, S3. On the wire null on the interactive feeds and sometimes set on the API feeds, see below |
| 49 | `relativeSpread` | `int64` | interactive feeds only |
| 57 | `bestBidApiPrice`, `bestBidApiSize`, `bestAskApiPrice`, `bestAskApiSize` | 4 × `int64` | API best, set on every interactive frame and on no API frame, P2 and P7 |

The bids group follows at offset `8 + blockLength`: a `uint16` entry length, 16 on the wire, a `uint16` entry count, then the entries, each a price and a size as `int64` mantissas at an exponent of -8.
The asks group follows in the same shape, and the frame ends with the market as a `uint8` length and that many UTF-8 bytes.
A size of 0 in a delta removes the level, S3, and no snapshot frame carried a zero size in P2 or P7.
The header, the 89-byte block, two 15-level groups and the 12-byte market name make a 598-byte snapshot, and a one-level delta is 134 bytes, P2 and P7.
On the API feeds the interactive fields were null on every BTC frame, while `bestBidPrice` was set on 8 of 71, 100 of 100 and 23 of 75 ETH snapshot frames and on every SOL snapshot frame in the three runs, equal to the API top bid each time a sample was kept, P2 and P7.
A feed should ignore those fields on the API channels.

### Schema versions

| request | handshake | `BookEvent` block | `MarketSummaryEvent` block | evidence |
|---|---|---:|---:|---|
| no parameters | HTTP 400, JSON code 40301 | | | P1 |
| `sbeSchemaVersion=0` | 101 | 89 | 216 | P1 |
| `sbeSchemaVersion=1`, the documented choice, S2 | 101 | 89 | 240 | P1 |
| `sbeSchemaVersion=2`, the version of the schema file on GitHub, S3 | 101 | 89 | 240 | P1 |
| `sbeSchemaVersion=3`, named by the 400 body | 101 | 89 | 248 | P1 |
| `sbeSchemaVersion=9` or `sbeSchemaId=2` | HTTP 400 with an empty body | | | P1 |

So the server serves a version 3 that the published schema file does not describe yet.
A decoder must take the block length from the header, as S2 says, and read only the fields it knows.
Unknown template ids, such as the heartbeat 40, must be skipped, S3.

### Snapshot on subscribe

`order_book.{market}.deltas` opens with one `pkgType` 0 frame holding the whole API book, 139 entries on BTC and 129 on ETH in P2, and every later frame is a `pkgType` 1 delta, P2, P3 and P7.
`snapshot@15@{rate}` frames are all `pkgType` 0 with up to 15 levels a side, P2 and P7.
So neither channel needs a REST seed.

### Delta semantics and the gap rule

A delta carries absolute sizes for the levels it names, and a size of 0 deletes the level, S3.
Most deltas name one level, and many name none: the median entry count was 1 on BTC and 0 on ETH and SOL, P2 and P7.
A delta that names no level still advances `seq` by 1, which fits RPI order changes that move the shared sequence but are left out of the API book.
The gap rule is therefore `seq == previous + 1` per market, with the first frame of a subscription as the base.
The book built from deltas reached 80 to 103 levels on its deeper side and never crossed, P2 and P7.

Two checks tie the deltas to the other views.

| check | result | evidence |
|---|---|---|
| top 15 of the deltas book against every `snapshot@15@50ms` frame with the same `seq` | equal in 231 of 231 and 276 of 276 comparisons | P2 and P7 |
| top 15 of the deltas book against REST `GET /v1/orderbook/BTC-USD-PERP?depth=15` with the same `seq_no` | equal in 6 of 6 and 6 of 6 | P2 and P7 |

So REST `seq_no` is the socket's `seq`, and a REST book can seed or verify a deltas book.

### Level order on the wire

Snapshot frames list bids from best to worst and asks from best to worst, on every one of the 266 and 243 frames of the two P2 runs and the 289 of P7.
Delta frames name levels in no promised order, so a feed applies them by price.

### Size unit against CCXT `contractSize`

Sizes are base coins: the BTC touch held `0.01134` and `2.43319` BTC, P7.
On `kPEPE-USD-PERP` a size counts thousands of PEPE, because its price of 0.00399 is a thousand times PEPE's, see [`rest.md`](./rest.md) section 2.
CCXT's `contractSize` of 1, at `paradex.js` line 655, is therefore the right unit for the book.

### The API book against the interactive book

RPI orders match only Retail takers and are left out of the API book, S13.
On 2026-10-12 at 22:22 UTC the API books of only BTC and ETH were tighter than 1,000 ppm, and 56 of 66 API books were wider than 10 %, while 48 of 66 interactive books were tighter than 1,000 ppm, see [`rest.md`](./rest.md) section 5.
At 22:40 UTC only BTC's API book was that tight, with 55 wider than 10 % and 44 tight interactive books.
On the socket the XAU interactive book read `4172.7` bid for 6.204 and `4174.6` ask for 6.201, while its API best was `2097.4` and `12585.0`, P7.
The API feeds are the book a Pro order can take, and the interactive feeds the book a Retail order can take, see [`fees.md`](./fees.md) section 9.

### One-sided and empty books

Every perpetual had at least one level on each side of the API book in both REST runs, but 27 and 26 had a single level on one side or both, see [`rest.md`](./rest.md) section 5.
`BboEvent` sends a null price and size for an empty side, S3, which was not seen.

### Unknown, closed and malformed subscriptions

| request | answer | evidence |
|---|---|---|
| `order_book.NOPE-USD-PERP.snapshot@15@50ms` | `-32600`, `"data":"market does not exist"` | P5 |
| `order_book.btc-usd-perp.snapshot@15@50ms` | the same | P5 |
| depth 20 | `-32600`, `"data":"invalid depth '20'. Expecting depth=15"` | P5 |
| rate `10ms` | `-32600`, `"data":"invalid frequency '10ms'. Expecting one of: [50ms 100ms]"` | P5 |
| `deltas@15@50ms` | `-32600`, `"data":"no parameters expected for deltas topic."` | P2 and P5 |
| channel `nope` | `-32600`, `"data":"invalid channel"` | P5 |
| unparsable JSON | `-32700`, `"unable to parse request"`, with `"id":0` | P5 |
| method `foo` | `-32601`, `"method does not exist"` | P5 |
| unsubscribe from a channel never subscribed | `-32600`, `"invalid unsubscribe request"` | P5 |

Every error left the socket open, and its `bbo` and `trades` frames kept arriving, P5.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the server pings every 55 s and needs a pong within 5 s, S1 | server pings every 30.1 s, and a client protocol ping was answered in 100.4 ms with its payload, P6 and P8. An unanswered ping ended the socket 45.0 s later with code 1001 in both runs, P6 and P8 |
| heartbeat frame | `HeartbeatEvent`, template 40, "Server sends every 20s on idle connections", S3 | none in 75 s on two idle sockets, in P6 and in P8 |
| silence the server tolerates | no rule beyond the ping, S1 | a socket that subscribed to nothing and answered pings stayed open for 75 s, P6 and P8 |
| compression | not documented | a client that offered permessage-deflate got `Sec-WebSocket-Extensions: permessage-deflate` back, and a client that did not offer it got none, P1 and P8. Frames are not compressed inside |
| handshake | | 96 to 431 ms to open from this host, P1 to P8 |
| subscription limits | 20 connections a second and 600 a minute per IP, S10 | 66 subscriptions in one burst were all acknowledged, P3 and P8. Checked on 2026-10-12, a socket serves a burst of 20 subscribe requests and then 10 a second, and a market's data starts only when its request is served, P9 |
| throughput, `deltas` on 66 perpetuals | | 64.3 and 101.6 frames a second, 8.1 and 12.5 KiB a second, 128 and 126 bytes a frame, P3 and P8 |
| throughput, `snapshot@15@50ms` on 66 perpetuals | | 31.1 and 49.4 frames a second, 9.8 and 16.0 KiB a second, 324 and 332 bytes a frame, P3 and P8 |
| throughput, `markets_summary.{market}` | | one 263-byte frame a second per market, P4 and P7, which makes about 17 KiB a second for 66 markets by arithmetic |
| maintenance | weekday releases at 04:30 UTC, about 15 minutes, `CANCEL_ONLY` about 2 minutes then `POST_ONLY` about 2 minutes, S14 | not captured. `GET /v1/system/state` read `{"status":"ok"}`, see [`rest.md`](./rest.md) section 6 |

CCXT Pro 4.5.68 connects to the plain URL at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/paradex.js` line 30, which the server refused with HTTP 400 in P1, so CCXT Pro's Paradex public channels could not have opened on 2026-10-12.

## 6. Captured frames

Text frames are verbatim from P1, P2 and P5.
Binary frames are given as hex from P7, each followed by its decoded fields.

The refused handshake on the plain URL, P1.

```json
{"code":40301,"error":"this endpoint requires SBE binary encoding; append ?sbeSchemaId=1\u0026sbeSchemaVersion=3 to the connection URL. See https://docs.paradex.trade/ws/general-information/binary-encoding-sbe","message":"SBE binary encoding required"}
```

A subscribe and its acknowledgement, P2.

```json
{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"order_book.BTC-USD-PERP.deltas"},"id":1}
```

```json
{"jsonrpc":"2.0","id":1,"result":{"channel":"order_book.BTC-USD-PERP.deltas"},"usIn":1791844083317711,"usDiff":173,"usOut":1791844083317884}
```

Errors, P2 and P5.

```json
{"jsonrpc":"2.0","id":8,"error":{"code":-32600,"message":"invalid subscribe request","data":"no parameters expected for deltas topic."},"usIn":1791844083318516,"usDiff":116,"usOut":1791844083318632}
```

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"invalid subscribe request","data":"market does not exist"},"usIn":1791844267580100,"usDiff":155,"usOut":1791844267580255}
```

A `BookEvent` delta on `order_book.BTC-USD-PERP.deltas`, 134 bytes, P7.

```text
5900030001000100e8675455ac5d060065ec5bca010000000100000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008010000100804441d5810700000000000000000000100000000c4254432d5553442d50455250
```

It decodes to header `blockLength` 89, template 3, schema 1, version 1, then `ts` 1791844607617000, `seq` 7689989221 and `pkgType` 1, nine null best fields, one bid at mantissa 8254210000000 with size 0, which deletes the bid at 82542.1, no asks, and the market `BTC-USD-PERP`.
The next frame on the same channel carried `seq` 7689989222 and set the bid at 82543.3 to 0.01134.

A `BboEvent` on `bbo.BTC-USD-PERP`, 69 bytes, P7.

```text
3000020001000100e8675455ac5d060065ec5bca01000000008177d381070000983a000000000000804e275d82070000584f2100000000000c4254432d5553442d50455250
```

It decodes to `ts` 1791844607617000, `seq` 7689989221, bid 82541.8 for 0.00015, ask 82564.9 for 0.02183, and `BTC-USD-PERP`, the same `seq` as the delta above.

A `MarketSummaryEvent` on `markets_summary.kPEPE-USD-PERP` at version 1, 263 bytes, P7.

```text
f000040001000100a04f4858ac5d0600000000000000000018170600000000002d170600000000000072060000000000007077090000000000ee1fb01c660000552600000000000098160600000000006017060000000000c2e759df3db54901ec7db4ffffffffff00000000000000800000000000000080000000000000008000000000000000806cccf505000000000000000000000000000000000000000000000000000000800000000000000080000000000000008000000000000000800000000000000080a316060000000000001cd5a4194e020000c95cf3cd4d020000000000000000800000000000000000566ad905000000000e6b504550452d5553442d50455250
```

It decodes to `ts` 1791844657156000, `seq` 0, `markPrice` 0.00399128 at block offset 16, `indexPrice` 0.00399149 at 24, `fundingRate` 0.00009813 at 56, and `fundingRatePrecise` 0.000098134614 at 232 with an exponent of -12, and the market `kPEPE-USD-PERP`.

A `FundingDataEvent` on `funding_data.kPEPE-USD-PERP`, 89 bytes, P7.

```text
420005000100010020d46658ac5d06000000000000000000552600000000000030da02000000000020d46658ac5d060027000000000000005526000000000000080000000000000000000e6b504550452d5553442d50455250
```

It decodes to `fundingRate` 0.00009813, `fundingIndex` 0.00186928, `fundingRate8h` 0.00009813, `fundingPeriodHours` 8 as an `int16` at block offset 56, and `impactPremiumRate` 0.

## 7. Private channels

Named for a future execution stage, from the channel pages listed in S4 and S2, not probed.

- The account channels are `account`, `balance_events`, `fills`, `funding_payments`, `orders`, `positions`, `tradebusts`, `transaction`, `transfers`, `mmp` and `rfq`.
- They need an `auth` request carrying a bearer JWT from `POST /v1/auth`, as CCXT Pro builds it at `pro/paradex.js` lines 49 to 67.
- Orders can be created, modified and cancelled over the socket, and their payloads stay JSON, S12.
  The observatory never sends one.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws.api.prod.paradex.trade/v1?sbeSchemaId=1&sbeSchemaVersion=1` for every plan | the plain URL is refused, and version 1 is the documented choice whose layouts section 4 checked |
| book channel | `order_book.{market}.deltas` for every perpetual | the full API book, with a snapshot first and a gap rule, at a median age of 66 to 79 ms. Decision 22 of the waves design asks for at least 20 levels, which `snapshot@15` cannot give |
| fallback book | `order_book.{market}.snapshot@15@50ms`, replaced whole on every frame | no sequence logic, 15 levels, 25 to 40 ms older at the median |
| decoder | hand-written in the venue module, reading the header's `blockLength`, skipping unknown templates, and treating `INT64_MIN` as null | three templates are needed, 3, 4 and 5, and no new crate is required for little-endian reads |
| merge | on `pkgType` 0, `reset_book` with the frame's levels. On `pkgType` 1, `set_bid` or `set_ask` per entry, where a size of 0 removes the level, then `publish` | the runtime's `OrderBook` keeps a sorted book of any depth, at `server/src/feeds/order_book.rs` lines 11 to 31 |
| sequence and resync | per market, `seq == previous + 1`, or `resync` | every delta advanced the sequence by exactly 1 in P2, P7 and P8, including deltas that name no level |
| markets per connection | 30 perpetuals per socket, corrected on 2026-10-12 from all 66 on one socket | one socket carried 64.3 to 101.6 frames and 8.1 to 12.5 KiB a second, P3 and P8, but it serves subscribe requests at a burst of 20 then 10 a second, P9. Three requests per market put 66 markets at 17.9 s to fill one socket, and the 61 requests of 30 markets take about 4 s |
| subscribe frames | one frame per channel, `{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"order_book.<symbol>.deltas"},"id":<n>}`, sent in one burst with `funding_data.ALL` first, then every book, then every summary | 66 sent at once were all acknowledged, and the server serves them in the order sent, P9 |
| anchor channel | `markets_summary.<symbol>` for every perpetual on the same socket, through `SocketAnchors`, with the funding period from `funding_data.ALL` | one row a second per market with mark, index and funding, see [`rest.md`](./rest.md) section 8. `funding_data.ALL` sent the 66 perpetuals and nothing else, three frames each in 16 s with `fundingPeriodHours` 8, P9 |
| routing | text frames are acknowledgements or errors, log every error. Binary frames route by template, then by the trailing `market` string | a binary frame does not name its channel |
| keepalive | answer server pings, and set no application ping | the server pings every 30.1 s and closed a socket that never answered. tungstenite 0.29 queues a pong for every ping it reads and writes it on the next read, `tungstenite-0.29.0/src/protocol/mod.rs` lines 284 to 286 in the cargo registry, and the runtime keeps reading, at `server/src/feeds/venue_feed.rs` line 621 |
| `max_silence` | 10 s on a connection that carries the summaries | every market sends a summary a second, while a quiet book sent nothing for the whole 45 s of P3 and P8 |
| catalog guard | subscribe only `asset_kind` `PERP` symbols from the live catalog | an unknown market is refused per subscription, so it costs nothing else, P5 |
| deflate | keep it off | the server negotiates it only when the client offers it |
| receive time | stamp on arrival, and keep `ts` for the book's age | the deltas' `ts` trailed arrival by 53 to 4,510 ms, with medians of 66 to 79 ms, P2 and P7 |

The feed fits the `BookVenue` trait at `server/src/feeds/venue_feed.rs` line 78 without a new runtime piece, because the socket seeds every book itself.
The SBE decoder is the new logic, and decision 12 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) already keeps decoding inside the venue that needs it.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WebSocket API, introduction | https://docs.paradex.trade/ws/general-information/introduction | 2026-10-12 | Paradex, docs | URLs, SBE requirement, ping rule, sections 1, 3 and 5 |
| S2 | Binary Encoding (SBE) | https://docs.paradex.trade/ws/general-information/binary-encoding-sbe | 2026-10-12 | Paradex, docs | negotiation, what stays JSON, template table, versioning, sections 2 to 4 |
| S3 | Paradex SBE schema `paradex_1_0.xml`, schema 1 version 2, released 2026-09-25 | https://github.com/tradeparadex/paradex-py/blob/main/paradex_py/api/sbe/paradex_1_0.xml | 2026-10-12 | Paradex, official SDK | header, field order, exponents, null sentinel, heartbeat, sections 3, 4 and 6 |
| S4 | Subscription Channels | https://docs.paradex.trade/ws/general-information/subscription-channels | 2026-10-12 | Paradex, docs | subscribe and acknowledgement shapes, duplicate rule, section 3 |
| S5 | `order_book.{market_symbol}.{feed_type}@15@{refresh_rate}[@{price_tick}]` | https://docs.paradex.trade/ws/web-socket-channels/order-book-market-symbol-feed-type-15-refresh-rate-price-tick/order-book-market-symbol-feed-type-15-refresh-rate-price-tick | 2026-10-12 | Paradex, docs | feed types, depth 15, rates, section 2 |
| S6 | `bbo.{market_symbol}` | https://docs.paradex.trade/ws/web-socket-channels/bbo-market-symbol/bbo-market-symbol | 2026-10-12 | Paradex, docs | BBO fields, section 2 |
| S7 | `markets_summary[.{market_symbol}]` | https://docs.paradex.trade/ws/web-socket-channels/markets-summary-market-symbol/markets-summary-market-symbol | 2026-10-12 | Paradex, docs | summary fields, section 2 |
| S8 | `funding_data.{market_symbol}` | https://docs.paradex.trade/ws/web-socket-channels/funding-data-market-symbol/funding-data-market-symbol | 2026-10-12 | Paradex, docs | funding fields, section 2 |
| S9 | Error Handling | https://docs.paradex.trade/ws/general-information/error-handling | 2026-10-12 | Paradex, docs | error codes, section 4 |
| S10 | Websocket Rate Limits | https://docs.paradex.trade/ws/general-information/rate-limits | 2026-10-12 | Paradex, docs | connection limits, sections 3 and 5 |
| S11 | Server Location | https://docs.paradex.trade/ws/general-information/server-location | 2026-10-12 | Paradex, docs | Tokyo and Global Accelerator, section 1 |
| S12 | Code Examples | https://docs.paradex.trade/ws/general-information/code-examples | 2026-10-12 | Paradex, docs | SBE required for public channels, private payloads stay JSON, section 7 |
| S13 | Retail Price Improvement | https://docs.paradex.trade/trading/rpi | 2026-10-12 | Paradex, docs | the API book leaves out RPI, section 4 |
| S14 | Maintenance & Releases | https://docs.paradex.trade/docs/maintenance-mode | 2026-10-12 | Paradex, docs | release window and modes, sections 3 and 5 |
| S15 | CCXT Pro 4.5.68 `paradex.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/paradex.js` | 2026-10-12 | CCXT | plain URL at line 30, `snapshot@15@100ms` at line 171, auth at lines 49 to 67, sections 5 and 7 |
| P1 | `ws-probe.py encoding` at 22:26 UTC, and a raw upgrade request by `curl` at 22:34 UTC for the 400 bodies | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 3 to 6 |
| P2 | `ws-probe.py book` at 22:26 UTC, whose deltas subscriptions were refused, and at 22:28 UTC with the bare `deltas` name | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 4 |
| P3 | `ws-probe.py batch` at 22:29 UTC, 66 perpetuals on each of two sockets for 45 s | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3, 5 and 8 |
| P4 | `ws-probe.py anchor` at 22:29 UTC | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 and 5 |
| P5 | `ws-probe.py errors` at 22:31 UTC | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 4 |
| P6 | `ws-probe.py silence` at 22:31 UTC, two idle sockets for 75 s | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 5 |
| P7 | second pass of `book` at 22:36 and `anchor` at 22:37 UTC, which also kept the raw frames of section 6 | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 6 |
| P8 | second pass of `encoding` at 22:40, `batch` at 22:41, `errors` at 22:41 and `silence` at 22:42 UTC, with the upgrade request and the client ping check | [`ws-probe.py`](../../../scripts/probes/venues/paradex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 and 3 to 5 |
| P9 | the adapter's ignored test `capture_frames` in `server/src/venues/paradex/tests.rs`, run by the builder: 201 subscribe requests on one socket at 23:10 UTC, two sockets of 102 side by side at 23:11 UTC, and `funding_data.ALL` for 16 s at 23:15 UTC | `cargo test paradex::tests::capture_frames -- --ignored --nocapture` | 2026-10-12 | this host, Canadian exit | sections 3, 5 and 8 |
