# Figure Markets WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:32 to 04:37 UTC for the first pass and 04:45 to 04:48 UTC for the second pass, from the development host near Seattle, through its Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket of Figure Markets, which carries spot markets only, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
CCXT 4.5.68 has no class for the venue, so CCXT Pro has none either.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/figure-markets/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Trading for BTC, ETH, SOL, LINK, UNI and XRP ends on 2026-09-23 at 12:00 UTC, about seven hours after these probes, see [`fees.md`](./fees.md) section 1.
Source ids are shared across the three files of this profile.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| public market data, every market | `wss://www.figuremarkets.com/service-hft-exchange-websocket/ws/v1`, S3 | open in 134 to 166 ms over 18 sockets in the two passes, no refusal from the Canadian exit |
| public, legacy page spelling | `wss://figuremarkets.com/service-hft-exchange-websocket/ws/v1`, S6 | a plain HTTP upgrade request got `101 Switching Protocols` on both the bare and the `www` host |
| authenticated | `wss://figuremarkets.com/service-hft-exchange-websocket/secure/ws/v1?ticket={TICKET_UUID}`, with a ticket from a cookie session, S6 | not probed |
| sandbox | `wss://www.figuremarkets.dev/service-hft-exchange-websocket/ws/v1`, S3 | not probed |

One socket carries every market of every type, crypto, fund, loan pool and equity, because a subscription names its market in `symbol`.
The host resolved to `34.117.204.231`, a Google load balancer in front of a Kong gateway, and the upgrade answered with `server: kong/3.11.0.13-enterprise-edition` and `via: 1.1 kong/3.11.0.13-enterprise-edition, 1.1 google`, P3.
The Markets API and Trade API customers stream on `trade.figuremarkets.*` with a token, and partners get market data over FIX, S10.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| `ORDER_BOOK` | `{"action": "SUBSCRIBE", "channelUuid": <uuid>, "channel": "ORDER_BOOK", "symbol": "ETH-USD", "tickSize": "0.10"}`, `tickSize` optional | the whole book at the market's default tick, or grouped at `tickSize`, no depth parameter, no speed parameter | a whole book on subscribe, then a whole book again on a tick of about 340 ms when it changed, and about every 5.1 s when it did not, section 4 |
| `MARKET` | same frame with `"channel": "MARKET"` | on change | 102 and 73 frames in 60 s on `BTC-USD-2S` in the two passes, carrying `bestBid`, `bestAsk`, `midMarketPrice`, `indexPrice`, `exchangePrice`, `publishTime` and 24 h figures |
| `TRADES` | same frame with `"channel": "TRADES"` | on trade, no snapshot, S3 | 0 frames in 60 s on `UNI-USD` in both passes. Its last trade was at 2026-09-22 21:27:44 UTC, about seven hours earlier, see [`rest.md`](./rest.md) section 2 |
| `CANDLES` | adds an interval, S3 | on candle close, no snapshot | not probed |

There is no best bid and ask channel apart from `MARKET`, no mark channel and no funding channel.
`MARKET` carries `indexPrice`, which the OpenAPI spec calls "Oracle index price", S9, see [`rest.md`](./rest.md) section 3.
`ORDER_BOOK` on a market that is not `CRYPTO` is dropped without a reply: `FIGR_HELOC-USD` returned nothing in both passes of P2.
In the first cap run, made with an earlier version of the cap mode that asked for every market's book, nine such streams neither delivered nor appeared among the 42 streams `LIST_SUBSCRIPTIONS` returned, P4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S3 | one URL for every market type, section 1 |
| subscribe frame shape | one object per stream: `action`, a client `channelUuid`, `channel`, `symbol`, S3 | one stream per frame. 52 frames sent 50 ms apart on one socket all registered, P4 |
| unknown symbol expectation | error code 3 `Invalid symbol`, S3 | `{"message":"Invalid symbol","code":3}` for `NOPE-USD` and for lowercase `eth-usd`. A known market that is not `CRYPTO` on `ORDER_BOOK` gets no reply at all |
| chunk unit and budget | "Each connection is limited to a maximum of 50 channel subscriptions", error code 6, S3 | not enforced: 52 subscriptions registered, `LIST_SUBSCRIPTIONS` returned 52, and no code 6 came back, P4 |
| keepalive mechanism | "PING the server at least every 30 seconds to keep the session open", S3 | a protocol ping gets a pong in 77 to 93 ms. `{"action":"PING"}` is refused as code 1 `Invalid request`. The server sent no ping on any of 18 sockets |
| connection lifetime and maintenance notice | "Sessions are closed automatically after a maximum of 30 minutes", S3. No maintenance message is documented | not reached, since no socket was held beyond 100 s |
| handshake and operation rate limits | Not publicly specified | no refusal at 18 opens over the two passes, nor at 52 subscriptions in 2.6 s |
| public market data authentication | none, S3 | none |
| message parse and routing | every data frame carries the client's `channelUuid`, S4 | frames also carry an undocumented `channel` key. Routing is by `channelUuid`, which the client chose, so the feed keeps a map from uuid to market |
| subscribe acknowledgement shape | not documented, S3 | none: success is the first data frame, 84 to 135 ms after the subscribe frame. Errors are `{"message": ..., "code": n}` with no uuid, so an error is matched only by order |
| symbol identifier format | the market `symbol` from REST, such as `ETH-USD`, S3 | identical to the REST `symbol`, including the suffix in `BTC-USD-2S` and `BTC-USDC-2S`. The REST `displayName` `BTC-USD` is not the id |
| number representation | strings in the book example, S4. The `MARKET` example spells `tradeCount24h` `"16"` and `pricePrecision` `"2"` as strings, while its field table types `pricePrecision` as Int, S5 | book `price`, `quantity`, `total` and `totalOrders` are strings. `MARKET` sends prices as strings and `percentageChange24h`, `tradeCount24h` and `pricePrecision` as JSON numbers |
| timestamp representation | `publishTime` ISO 8601 on `MARKET`, S5 | `MARKET` `publishTime` with nanoseconds, `2026-09-23T04:32:49.975744686Z`. `ORDER_BOOK` frames carry no time at all |
| size unit | "Total units available at the price point group", S6 | base asset units: BTC on `BTC-USD-2S`, equal to the REST book at the same instant, section 4 |
| sequence semantics | none documented | none on the wire. Every `ORDER_BOOK` frame is the whole book, so there is nothing to chain |
| idle repeat behaviour | not documented | an unchanged book is sent again, identical, about every 5.1 s: 12 of 13 `HASH-USD` frames in 60 s were exact repeats in both passes |

## 4. The book channel in detail

### Snapshot on subscribe

The first `ORDER_BOOK` frame arrived 84 to 94 ms after the subscribe frame on all 17 crypto markets in the first pass, and 104 to 135 ms in the second, P1.
The documentation says "A full snapshot is sent right after a successful subscription. After that, incremental updates are sent when the order book changes", S4.

### Delta semantics

The later frames are not deltas on the wire, whatever "incremental" means in the documentation.
Over 60 s on 17 books, 1,121 frames in the first pass and 1,006 in the second, every frame held its sides from the best level down, with `total` equal to the running sum of `quantity` from the top on every level, and no level ever carried a zero quantity, P1.
The level counts stayed near the book's size, for example 6 to 10 bids and 7 to 10 asks on `BTC-USD-2S` in the first pass, and the socket book equalled the REST book level for level at the 20 s compare in both passes, P1.
The web app replaces its whole book with each frame, `i.latest=s`, in the exchange bundle, S16.
So a feed calls `resetBook` on every frame.

### Sequence and gap rule

```text
every ORDER_BOOK frame   replace the whole book
no frame for 15 s         treat the stream as dead, since an unchanged book is resent every 5.1 s
```

No frame carries a sequence number or an update id, so no gap can be detected and none needs to be.

### Publish tick

The server publishes on one clock for all books.
In the second pass, the 1,006 book frames of the 17 books arrived in 171 bursts, a burst being frames less than 40 ms apart.
Of the 170 gaps between burst starts, 163 fell in the 350 ms bin of a 50 ms histogram, and the rest at about 300, 400, 700 and 1,000 ms, with a minimum of 324 ms and a maximum of 1,017 ms, P1.
The first pass had 172 bursts in the same 60 s.
Per book, the gaps are multiples of the tick: on `UNI-USD`, 112 of 132 gaps fell in the 350 ms bin, 8 near 700 ms and 6 near 1,000 ms, P1.
So a change reaches the socket up to about 340 ms after it happens, plus the network.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket, every frame | best first, descending, on every frame of 17 books | best first, ascending, on every frame |
| REST order book | descending | ascending |
| documentation | "bids by price descending", S4 | "Asks are sorted by price ascending", S4, while the current page's own example lists asks 2010.00 then 2000.00, and the legacy page's example lists them ascending, S6 |

### Level window

There is no depth cap on the socket.
The frame carries every level at the default tick, and the books are thin: the largest side in either pass was 22 levels, the `HASH-USD` asks, `XRP-USD` held up to 15 bids, and `HASH-USDC` 1 bid and 4 asks, P1.
The REST book at `depth=0` held 10 bids and 10 asks on `BTC-USD-2S`, the same as the socket, P1.
A `tickSize` of `"10"` on `BTC-USD-2S` returned 10 bids and 9 asks, then 10 and 10 in the second pass, at prices rounded to 10, such as `87140.0` and `87210.0`, P2.

### Size unit against CCXT `contractSize`

CCXT has no class for the venue, so there is no `contractSize` to compare.
Sizes are base asset units, which is the spot convention the engine's `sizeMul` of 1 would assume.

| market, first pass | socket size at the touch | REST size at the same instant | unit |
|---|---|---|---|
| `BTC-USD-2S` | `"0.78219"` at bid `87180.7` | `0.78219` | BTC |
| `BTC-USD-2S` | `"0.75098"` at ask `87243.1` | `0.75098` | BTC |

All 10 bid levels and 10 ask levels were equal in both passes of P1, the first read 50 ms and the second 2,681 ms after the last socket frame.

### One-sided and empty books

`SOL-USD` sent one frame with `"bids": []` and 8 asks, 339 ms after a frame with 9 bids, and the next frame 342 ms later had 4 bids, in the first pass, P1.
In the second pass `UNI-USD` sent 7 frames with an empty side in 60 s, 4 of them with both sides empty, three of those on consecutive ticks spanning 674 ms, and `UNI-USDC` sent 5, one of them empty on both sides, P1.
So one side or the whole book can be empty for a tick or three while the market maker requotes, and the engine's `resetBook` must accept an empty side and an empty book.

### Idle repeats

An unchanged book is resent about every 5.1 s, with identical content.
`HASH-USD` sent 13 frames in 60 s, 12 of them identical to the one before, and after the first its gaps fell in the 4,750, 5,100 and 5,150 ms bins, in both passes, P1.
`USDC-USD` sent 21 frames with 12 repeats in the first pass and 14 with 12 in the second.
Busy books also repeated: `BTC-USD-2S` 4 and 11 times, and `UNI-USD` 9 and 6 times, in the two passes.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `ORDER_BOOK` `NOPE-USD` | `{"message":"Invalid symbol","code":3}` | |
| `ORDER_BOOK` `eth-usd` | code 3 `Invalid symbol` | |
| `ORDER_BOOK` `FIGR_HELOC-USD`, a `CONNECT` market | nothing | the stream never delivers and is not listed |
| a second `SUBSCRIBE` with a uuid already in use | `{"message":"Duplicate channel UUID","code":2}` | the first stream keeps delivering |
| the same market and channel with a new uuid | a second snapshot, no error | both uuids deliver the same book, so documented code 4 "Already subscribed to channel" did not fire |
| `UNSUBSCRIBE` with an unknown uuid | `{"message":"Not subscribed to any channel with given ID","code":5}` | |
| unknown channel `NOPE` | `{"message":"Invalid request","code":1}` | |
| private channel `ADDRESS_ORDERS` | `{"message":"Connection is not authorized","code":7}` | |
| text that is not JSON | code 1 `Invalid request` | the socket stays open |
| `channelUuid` `"abc"` | code 1 `Invalid request` | |
| no `symbol` | code 1 `Invalid request` | |
| `{"action":"PING"}` | code 1 `Invalid request` | |
| `UNSUBSCRIBE` with a live uuid | `{"message":"UNSUBSCRIBED","channelUuid":"12810102-83cd-434b-b348-642931502820"}` | |

A closed market was not available to probe, since all 29 markets read `status` `OPEN`, see [`rest.md`](./rest.md) section 2.
What the socket sends for BTC, ETH, SOL, LINK, UNI and XRP after trading ends at 12:00 UTC is Not verified.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client pings at least every 30 s, S3 | protocol ping answered in 77 to 93 ms. The server sent no ping of its own on 18 sockets |
| silence the server tolerates | 30 s without a client ping, by the documentation | a socket with no subscription that sent nothing closed at 30.0 s in both passes, with code 1006 and no close frame in the first and 1001 in the second. A socket with no subscription and a protocol ping every 20 s stayed open for the whole run, 100 s and then 60 s. A socket subscribed to the quiet `HASH-USDC` book that sent nothing after the subscribe also stayed open, so the book's 5.1 s repeats seem to count as traffic, P5 |
| forced disconnect | "closed automatically after a maximum of 30 minutes", S3 | not reached |
| maintenance notice | none documented | none seen. The web app configuration has an `EXCHANGE_MAINTENANCE` flag, `false` at the probe, see [`rest.md`](./rest.md) section 6 |
| compression | not documented | the server negotiates `permessage-deflate` when the client offers it, and with `perMessageDeflate: false` it sends plain text frames, P3 |
| handshake | | 134 to 166 ms to open from this host over 18 sockets |
| subscription limits | 50 per connection, code 6, S3 | 52 registered with no error, P4 |
| throughput | | 17 books, 2 `MARKET` streams and one `TRADES` stream: 1.72 MB and 1.47 MB in 61 s in the two passes, 24 to 28 KB per second. The median book frame was 489 bytes on `USDC-USDT` and 2,309 bytes on `HASH-USD` in the second pass |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays are cut to two levels.

Subscribe.

```json
{"action": "SUBSCRIBE", "channelUuid": "7ca84358-062a-4748-85b5-19757744af71", "channel": "ORDER_BOOK", "symbol": "BTC-USD-2S"}
```

First book frame, which is also the acknowledgement.

```json
{"channelUuid":"7ca84358-062a-4748-85b5-19757744af71","asks":[{"price":"87233.4","quantity":"0.74266","total":"0.74266","totalOrders":"0"},{"price":"87272.0","quantity":"0.75391","total":"1.49657","totalOrders":"0"}],"bids":[{"price":"87172.4","quantity":"0.78065","total":"0.78065","totalOrders":"0"},{"price":"87135.6","quantity":"0.75663","total":"1.53728","totalOrders":"0"}],"channel":"ORDER_BOOK"}
```

A whole book with an empty bid side, `SOL-USD`.

```json
{"channelUuid":"f2a81e95-1bf6-4b15-b397-eb9ba556d8bf","asks":[{"price":"119.69","quantity":"9.5230","total":"9.5230","totalOrders":"0"},{"price":"119.73","quantity":"2.4784","total":"12.0014","totalOrders":"0"}],"bids":[],"channel":"ORDER_BOOK"}
```

`MARKET`, which carries the index price.

```json
{"channelUuid":"fba2ba12-6b7c-44c7-bcee-d5f8daf592ca","bestBid":"87172.4","bestAsk":"87233.4","midMarketPrice":"87202.9","priceChange24h":"1705.478367180","percentageChange24h":0.019948,"lastTradedPrice":"86708.300000000000000000","volume24h":"102973.080700000000000000","high24h":"87228.0","low24h":"85091.5","indexPrice":"87201.0","tradeCount24h":21,"exchangePrice":"87201.0","marketId":"BTC-USD-2S","pricePrecision":1,"publishTime":"2026-09-23T04:32:49.975744686Z","inRegularTradingHours":true,"status":"OPEN","channel":"MARKET"}
```

`LIST_SUBSCRIPTIONS` reply, cut to one entry.

```json
[{"channelUuid":"7ca84358-062a-4748-85b5-19757744af71","channel":"ORDER_BOOK","symbol":"BTC-USD-2S","tickSize":"0.1"}]
```

Errors.

```json
{"message":"Invalid symbol","code":3}
```

```json
{"message":"Duplicate channel UUID","code":2}
```

```json
{"message":"Connection is not authorized","code":7}
```

Keepalive is a WebSocket protocol ping, so it has no JSON frame.

## 7. Private channels

Named for a future execution stage, from S6, not probed.
They need the secure URL and a single-use ticket valid for 60 s, fetched from `POST https://www.figuremarkets.com/service-hft-exchange-websocket/secure/api/v1/tickets` with a session cookie from the wallet login.

- `ADDRESS_ORDERS`, `BALANCES`, which is deprecated, and `BALANCES_V2`.
- An authenticated `ORDER_BOOK` adds `myOrders` to each level.
- Order entry is on the Trade API at `trade.figuremarkets.*`, or FIX for partners, S10 and S19.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The venue has no perpetual and no CCXT class, so no feed is recommended for the engine as it stands.
If spot legs were ever admitted, and the venue still listed a market worth reading after 2026-09-23 12:00 UTC, the feed would look like this.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://www.figuremarkets.com/service-hft-exchange-websocket/ws/v1` | one URL serves every market |
| channel | `ORDER_BOOK` with no `tickSize` | the whole book at the market's own tick, and no side held more than 22 levels in either pass |
| markets per connection | all 17 crypto markets on one socket | the documented cap is 50, and 52 streams ran without error |
| subscribe frames | one frame per market, `{"action": "SUBSCRIBE", "channelUuid": <uuid>, "channel": "ORDER_BOOK", "symbol": <rawMarketId>}` | the API takes one stream per frame |
| routing | a map from the `channelUuid` the feed generated to `rawMarketId` | frames carry no symbol |
| keepalive | a WebSocket protocol ping every 20 s | the documented 30 s rule, and an application `PING` is refused |
| `maxSilenceMs` | 15,000 | every book is resent at least every 5.1 s, so three missed repeats is a dead stream |
| snapshot and delta | `resetBook` on every frame | every frame is the whole book |
| resync | none needed for gaps, and a socket that closes is reopened by the existing path | there is no sequence to break |
| unserved stream | log a stream with no frame 2 s after its subscribe frame | a non-crypto market and an error reply both look like silence on the uuid |
| receive time | stamp on arrival | book frames carry no time, and the book itself is up to about 340 ms old on arrival by the publish tick |
| sizes | `Number()` of the string, base units | spot |
| session cap | reconnect before 30 minutes | the documented lifetime |
| deflate | keep `perMessageDeflate: false` | the server would compress if offered, and the engine refuses compression |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S3 | Public API, WebSocket | https://www.figuremarkets.dev/api-docs/public-api/websocket/ | 2026-09-23 UTC | Figure Markets | URL, keepalive, 30 minute sessions, 50 subscriptions, channels, error codes, sections 1 to 5 |
| S4 | Public API, WebSocket, Order book | https://www.figuremarkets.dev/api-docs/public-api/websocket/order-book/ | 2026-09-23 UTC | Figure Markets | subscribe frame, `tickSize`, snapshot then updates, level order and its example, section 4 |
| S5 | Public API, WebSocket, Market | https://www.figuremarkets.dev/api-docs/public-api/websocket/market/ | 2026-09-23 UTC | Figure Markets | `MARKET` fields and `publishTime`, section 3 |
| S6 | Exchange APIs, Websockets, and its Order Book page | https://www.figuremarkets.dev/api-docs/exchange/Websockets/ and https://www.figuremarkets.dev/api-docs/exchange/Websockets/PublicChannels/OrderBook/ | 2026-09-23 UTC | Figure Markets | bare host URL, ticket auth, private channels, code 7, level definitions, sections 1, 4 and 7 |
| S9 | Public API OpenAPI spec, version 1.0.0 | https://storage.googleapis.com/markets-exchange-docs/combined-public-spec.json | 2026-09-23 UTC | Figure Markets | `indexPrice` "Oracle index price", section 2 |
| S10 | WebSocket reference | https://www.figuremarkets.dev/api-docs/reference/websockets/ | 2026-09-23 UTC | Figure Markets | Trade API streaming, FIX for partners, sections 1 and 7 |
| S16 | Exchange web app bundle | https://www.figuremarkets.com/exchange/assets/index-DkaJSetJ.js | 2026-09-23 UTC | Figure Markets | the app replaces its book with each frame and sends no ping, section 4 |
| S19 | Partner API overview | https://www.figuremarkets.dev/api-docs/partner-api/ | 2026-09-23 UTC | Figure Markets | FIX order entry and market data, section 7 |
| P1 | `ws-probe.mjs book`, first pass 04:32 to 04:33 UTC and second pass 04:45 to 04:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/figure-markets/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs errors`, first pass 04:32 UTC and second pass 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/figure-markets/ws-probe.mjs) | 2026-09-23 UTC | this host | error replies, `tickSize`, non-crypto book, sections 2 to 4 and 6 |
| P3 | `ws-probe.mjs deflate`, first pass 04:32 UTC and second pass 04:45 UTC, and one `curl` upgrade per host at 04:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/figure-markets/ws-probe.mjs) | 2026-09-23 UTC | this host | deflate negotiation, gateway headers, bare host upgrade, sections 1 and 5 |
| P4 | `ws-probe.mjs cap`, three runs at 04:34 to 04:35 UTC and second pass 04:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/figure-markets/ws-probe.mjs) | 2026-09-23 UTC | this host | 52 subscriptions, non-crypto streams dropped, sections 2, 3 and 5 |
| P5 | `ws-probe.mjs silence`, first pass for 100 s at 04:35 to 04:37 UTC and second pass for 60 s at 04:47 to 04:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/figure-markets/ws-probe.mjs) | 2026-09-23 UTC | this host | silence and keepalive, section 5 |
