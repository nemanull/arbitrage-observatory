# Tapbit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:22 to 03:37 UTC, from the development host near Seattle.
The socket refused the handshake with HTTP 403 on every attempt, so every value below is documented and none is probed.

This profile covers the public WebSocket of Tapbit for its USDT-margined perpetuals, which is the only perpetual family, see [`fees.md`](./fees.md) section 3.
Tapbit has no CCXT class, so no CCXT Pro source exists either.
Every protocol claim below comes from the API documentation, S2, because [`ws-probe.mjs`](../../../scripts/probes/venues/tapbit/ws-probe.mjs) never got past the handshake.
The probe's `book`, `silence` and `deflate` modes are written for a host on the venue's whitelist and were refused here.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://ws-openapi.tapbit.com/stream/ws` | HTTP 403 at the handshake, 14 of 14 attempts over four runs, answered in 41 to 142 ms |
| spot | the same URL | the same refusal, since the URL is shared |

One URL carries spot and the perpetuals, and the topic prefix `usdt/` or `spot/` picks the market, S2.
`ws-openapi.tapbit.com` is a CNAME of `d1fjnz95msl9sy.cloudfront.net`, which `dig` resolved to four addresses in `18.172.170.0/24` from this host.
The refusal came from the CloudFront edge `SEA73-P3`, not from Tapbit's servers.

The refusal, as the `ws` client saw it in `ws-probe.mjs access`, W1.

```text
HTTP 403
server: CloudFront
x-cache: Error from cloudfront
x-amz-cf-pop: SEA73-P3
content-type: text/html
body: ERROR: The request could not be satisfied 403 ERROR The request could not be satisfied. Request blocked. We can't connect to the server for this app or website at this time. ...
```

The REST host `openapi.tapbit.com` answers the perpetual paths with the same page, while its spot v2 paths answer 200, see [`rest.md`](./rest.md) section 1.
The API changelog of 2024-12-13 reads "Update our firewall rules. All clients should be added into whitelist so that they can visit the API.", S2.
So the 403 is read as the documented whitelist and not as a rate limit, since the first request of each run got it and the documented connection limit is one per second.
Whether the rule also keys on the country of the address cannot be told from one host, and no other route was tried.

## 2. Channel matrix for public market data

| topic | payload | depth and speed | probed |
|---|---|---|---|
| `usdt/orderBook.{instrument_id}.[depth]` | `"usdt/orderBook.BTC-SWAP.5"` | depth 5, 10, 50, 100 or 200, optional. Push speed Not publicly specified | refused |
| `usdt/ticker.{instrument_id}` | `"usdt/ticker.BTC-SWAP"`, or `"usdt/ticker.all"` for every contract | Not publicly specified | refused |
| `spot/orderBook.{instrument_id}.[depth]` | `"spot/orderBook.BTCUSDT.5"` | the same depths | refused |
| `spot/ticker.{instrument_id}` | | | refused |

No trades, best bid and ask, kline, mark, index or funding topic is documented.
The perpetual ticker carries `markPrice`, `indexPrice` and `fundingRate` beside `lastPrice`, `bestBidPrice` and `bestAskPrice`, S2.
It is the only documented bulk source of the index for every contract, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for spot and USDT perpetuals, split by the topic prefix `spot/` or `usdt/`, S2 | refused at the handshake |
| subscribe frame shape | `{"op": "subscribe", "args": ["usdt/orderBook.BTC-SWAP.5", "usdt/orderBook.ETH-SWAP"]}`, several topics in one frame, S2 | refused |
| unknown symbol expectation | Not publicly specified. The error codes include 10503 `unsupported topic` and 10509 `unsupported order book depth`, S25 | refused |
| chunk unit and budget | topics in `args`, and "Subscribution limits 240times / 1hour", with no scope named, S2 | refused |
| keepalive mechanism | "WebSocket server will send a "ping" frame every 5 seconds, and the clients must response "pong"." Two unanswered pings end the connection, and error 10501 is `ping timeout`, S2, S25 | refused |
| connection lifetime and maintenance notice | Not publicly specified | refused |
| handshake and operation rate limits | "Connection limits 1times / 1second", subscriptions 240 per hour, S2 | refused. 14 handshakes over four runs, at least 1.5 s apart, each got 403 |
| public market data authentication | none. "The public interface can be called without authentication", S2. The firewall whitelist of 2024-12-13 applies to every client, S2 | refused before any frame, so the whitelist applies to public topics too |
| message parse and routing | `{"topic", "action", "data": [...]}`, routed on `topic`, S2 | refused |
| subscribe acknowledgement shape | Not publicly specified | refused |
| symbol identifier format | `BTC-SWAP` on the perpetual topics, `BTCUSDT` on the spot topics, S2 | refused |
| number representation | prices and sizes as strings, `version` and `timestamp` as JSON numbers, S2 | refused |
| timestamp representation | `timestamp` in Unix ms, S2 | refused |
| size unit | contracts in the book example, `"18167"` on BTC-SWAP, and one contract is `multiplier` coins in the REST catalog, S2 | refused |
| sequence semantics | "`version` ... This field is strictly increasing value. It can be used to check the continuity of new data.", S2. Whether it steps by one is Not publicly specified | refused |
| idle repeat behaviour | Not publicly specified | refused |

## 4. The book channel in detail

Every row is documented only, from the USDT perpetual order book page, S2.

### Snapshot on subscribe

The first push of a topic has `"action": "insert"` and later pushes have `"action": "update"`: "At the first time , action = insert, then ,action = update, means appended data.", S2.
Whether an `insert` can arrive again later, and whether it carries the full depth, is Not publicly specified.

### Delta semantics

An `update` carries changed levels as `[price, quantity]` string pairs, and the example holds `"0"` quantities, which read as deleted levels.
The documentation does not say so in words.

### Sequence and gap rule

```text
action = insert                          replace the book, last = version
action = update, version > last          apply, last = version
action = update, version <= last         out of order, resync
```

The documentation promises only that `version` strictly increases.
A step larger than one could be a gap or normal, and that can only be settled on the wire.

### Checksum

None is documented, and the example frame carries none.

### Level order on the wire

The example annotates "Bid levels are sorted from highest to lowest price." and "Ask levels are sorted from lowest to highest price.".
The same example lists bids `29953.3`, `29953.0`, `29953.4`, so the update is not sorted, and a feed applies levels by price.

### Size unit against CCXT `contractSize`

No CCXT class exists, so there is no `contractSize` to compare.
The REST catalog gives `multiplier`, for example `"0.001"` on BTC-SWAP and `"0.01"` on ETH-SWAP, with the comment "1 contract = 0.01 ETH", S2.
The book sizes in the examples are whole numbers of contracts.
A hand-written catalog would take `multiplier` as the contract size.

### Topic echo

The request example subscribes `usdt/orderBook.BTC-SWAP.5`, while the response example's `topic` reads `usdt/orderBook.BTC-SWAP` without the depth.
Whether the pushed topic keeps the depth suffix is Not verified, and it decides how a feed routes two depths of one contract.

### One-sided and empty books, idle repeats, unknown and closed symbols

Not publicly specified, and not probed.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | a server `ping` every 5 s that the client answers with `pong`. Whether it is a protocol ping frame or a text frame is Not publicly specified | refused |
| silence the server tolerates | the server disconnects after two pings without a pong, about 10 s | refused |
| forced disconnect | Not publicly specified | refused |
| maintenance notice | Not publicly specified | refused |
| compression | Not publicly specified | refused. A handshake offering permessage-deflate got the same 403, W2 |
| handshake | "Connection limits 1times / 1second" | 403 in 41 to 142 ms, W1 to W4 |
| subscription limits | 240 per hour | refused |

## 6. Captured frames

No frame was captured, because no socket opened.
The only capture is the handshake refusal in section 1.
The documented subscribe frame and book push are quoted in sections 3 and 4.

## 7. Private channels

The WebSocket pages document no private topic.
The error codes 10504 `not login`, 10510 `incorrect token` and 10511 `login timeout` imply a login operation, S25.
The private REST calls live under `/swap/api/v1/usdt/`, such as `/api/v1/usdt/order` and `/api/v1/usdt/position_list`, S2.

## 8. Recommended feed shape

No feed is recommended, because the socket refuses this host and the futures API is granted only to approved accounts, see [`fees.md`](./fees.md) section 1.
If a host is ever put on the whitelist, the following is a draft to verify on the wire, not a decision.

| item | draft | reason |
|---|---|---|
| URL plan | one URL, `wss://ws-openapi.tapbit.com/stream/ws`, for all 116 perpetuals | one URL serves every topic |
| channel | `usdt/orderBook.<rawMarketId>.50` | 50 levels covers the engine's 20, and 200 is also offered |
| markets per connection | all 116 on one socket, to verify | 116 topics fit inside 240 subscriptions per hour whether a frame or a topic counts, but resubscribing every contract twice in one hour would not |
| connections | open one per second at most | documented connection limit |
| keepalive | answer every server `ping` with `pong`, as a protocol pong or the text `pong`, whichever the wire shows | two missed pings close the socket |
| `maxSilenceMs` | 15,000 as a start | the server pings every 5 s, if a ping counts as traffic |
| snapshot | `action === "insert"`: `resetBook` and store `version` | documented |
| delta | apply when `version` is greater than the last, then store it | documented strict increase |
| resync | a `version` not greater than the last, or an `update` before an `insert` | the engine's resync terminates and resubscribes |
| deflate | keep `perMessageDeflate: false` | unknown whether the server negotiates it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S2 | Tapbit USDT Perpetual API: WS General Info, Order Book, Ticker, Base Endpoint, Exchange Information, Interface Type, Change Log | https://www.tapbit.com/openapi-docs/usdt_perpetual/ws/order_book/ | 2026-09-22 | Tapbit, global | URL, topics, frames, limits, heartbeat, the firewall whitelist, sections 1 to 8 |
| S26 | Tapbit Spot API: WS Order Book and Base Endpoint | https://www.tapbit.com/openapi-docs/spot/ws/order_book/ | 2026-09-22 | Tapbit, global | the shared URL and the `spot/` topics, sections 1 and 2 |
| S25 | Tapbit USDT Perpetual Error Codes | https://www.tapbit.com/openapi-docs/usdt_perpetual/usdt_errorcode/ | 2026-09-22 | Tapbit, global | WebSocket error codes, sections 3, 5 and 7 |
| W1 | `ws-probe.mjs access`, three handshakes per run at 03:22, 03:36 and 03:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tapbit/ws-probe.mjs) | 2026-09-22 | this host | the 403 refusal, sections 1 and 5 |
| W2 | `ws-probe.mjs deflate` at about 03:29 and at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tapbit/ws-probe.mjs) | 2026-09-22 | this host | the same 403 with deflate offered, section 5 |
| W3 | `ws-probe.mjs book` at about 03:29 and at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tapbit/ws-probe.mjs) | 2026-09-22 | this host | the same 403 before any subscribe, section 5 |
| W4 | `ws-probe.mjs silence` at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tapbit/ws-probe.mjs) | 2026-09-22 | this host | the same 403, so the silence the server tolerates was not measured, section 5 |

The ids are shared by the three Tapbit profiles, so an id missing here is cited in [`fees.md`](./fees.md) or [`rest.md`](./rest.md).
