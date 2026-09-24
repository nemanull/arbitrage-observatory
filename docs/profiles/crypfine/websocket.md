# CrypFine WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 06:39 and 06:45 UTC, from the development host near Seattle through its Canadian VPN exit, and the handshake was refused with HTTP 403 every time.

This profile covers the public WebSocket of the CrypFine USDT perpetual API, which CCXT 4.5.68 and CCXT Pro do not implement.
The socket never opened from this host, so every protocol claim below is the documented value, and the probed column records the refusal.
The probe is [`ws-probe.mjs`](../../../scripts/probes/venues/crypfine/ws-probe.mjs).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-margined perpetuals | `wss://ws-openapi.crypfine.com/backend/exchange/stream/ws`, S2 | HTTP 403 Cloudflare block page on the upgrade, in 51 to 90 ms, on two attempts in each of two runs |
| spot | no WebSocket section in the Spot V2 document, S6 | not probed |

Topics carry a family prefix, `usdt/orderBook.<id>` and `usdt/ticker.<id>`, S3 and S4, so the one documented URL is meant to serve the USDT perpetual family by topic.
`ws-openapi.crypfine.com` is a CNAME to `ws-openapi.crypfine.com.cdn.cloudflare.net` and resolved to `104.18.24.150` and `104.18.25.150`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `usdt/orderBook.{instrument_id}.[depth]` | `{"op": "subscribe", "args": ["usdt/orderBook.BTC-SWAP.5"]}` | depth 5, 10, 50, 100 or 200, optional, speed Not publicly specified | refused, the socket never opened |
| `usdt/ticker.{instrument_id}` | `{"op": "subscribe", "args": ["usdt/ticker.BTC-SWAP"]}`, or `usdt/ticker.all` for every contract | Not publicly specified | refused |
| trades, best bid and ask, kline, mark, index, funding | not documented | | |

The ticker topic is the only documented source of the index price.
Its example carries `markPrice`, `indexPrice`, `fundingRate`, `bestBidPrice`, `bestAskPrice` and their volumes, but no funding interval or next funding time, S4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Every probed cell is the same fact: the upgrade request got HTTP 403 and no frame was exchanged, P1.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, topics prefixed `usdt/`, S2 to S4 | refused |
| subscribe frame shape | `{"op": "subscribe", "args": ["<topic 1>", "<topic 2>"]}`, several topics per frame, S3 | refused |
| unknown symbol expectation | error codes `10503` unsupported topic, `10506` parameter is error, `10509` unsupported order book depth, frame shape Not publicly specified, S5 | refused |
| chunk unit and budget | Not publicly specified per frame. Subscriptions are capped at 240 per hour, S1 | refused |
| keepalive mechanism | the server sends a "ping" frame every 5 s and the client must answer "pong". Whether that is a protocol ping or a text frame is Not publicly specified, S1 | refused |
| connection lifetime and maintenance notice | Not publicly specified. Maintenance is announced in the help center, see [`fees.md`](./fees.md) section 7 | refused |
| handshake and operation rate limits | 1 connection per second and 240 subscriptions per hour, S1. Error `429` "request too much", S5 | refused, two handshakes 2 s apart got 403 in each of two runs |
| public market data authentication | none for public topics, S7. Error codes `10504` not login, `10510` incorrect token and `10511` login timeout exist for private use, S5 | an IP allow list is required in practice, see section 5 |
| message parse and routing | `{"topic": "usdt/orderBook.BTC-SWAP", "action": ..., "data": [ ... ]}`, route on `topic`, S3 | refused |
| subscribe acknowledgement shape | Not publicly specified | refused |
| symbol identifier format | `BTC-SWAP`, the same as `contract_code` on REST, S3 and [`rest.md`](./rest.md) section 2 | refused |
| number representation | prices and sizes as strings, S3 and S4 | refused |
| timestamp representation | `timestamp` integer ms, S3 | refused |
| size unit | Not stated on the socket. The REST depth example reads 30,965 at 27,902.5 on `BTC-SWAP`, whose multiplier is 0.001 BTC, so contracts is the likely unit, S8 | refused |
| sequence semantics | `version`, "strictly increasing value. It can be used to check the continuity of new data.", S3. Whether it steps by exactly 1 is Not publicly specified | refused |
| idle repeat behaviour | Not publicly specified | refused |

## 4. The book channel in detail

Everything in this section is documented and unverified, because no frame was received.

### Snapshot on subscribe

The example says `"action": "update", // At the first time , action = insert, then ,action = update, means appended data.`, S3.
So the first frame of a topic is an `insert` snapshot and later frames are `update` deltas.

### Delta semantics

A delta carries `bids` and `asks` arrays of `[price, size]` strings, and the example shows `"0"` sizes, which reads as a level deletion, S3.
The example delta's bids are not sorted, `29953.3` precedes `29953.4`, although the comment above them says "Bid levels are sorted from highest to lowest price.", S3.
A feed would apply levels by price and never by position.

### Sequence and gap rule

`version` is documented as strictly increasing, S3.
Whether it is per topic or per connection, and whether a gap is `version` not equal to the previous plus one, is Not publicly specified.
A feed would need a probe to settle the rule before it could call `resync` safely.

### Checksum

None documented.

### Level order on the wire

Documented as bids descending and asks ascending, contradicted by the example itself, S3.

### Size unit against CCXT `contractSize`

CCXT has no class, so there is no `contractSize` to compare.
The REST `instruments/list` field `multiplier` is documented as "Contract Value, it means 1 contract = 0.01 ETH" for `ETH-SWAP`, S8, and the HYPE listing notice gives a face value of 0.1 HYPE, S9.
A hand-written catalog would have to set `contractSize` from `multiplier`.

### One-sided and empty books, idle repeats, unknown and closed symbols

Not publicly specified, and not probed.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 5 s, client pong, two unanswered pings close the socket, S1 | refused |
| silence the server tolerates | two ping intervals, about 10 s, S1 | refused |
| forced disconnect | error `10501` ping timeout, S5 | refused |
| maintenance notice | help center announcements only | refused |
| compression | Not publicly specified | refused before any extension was negotiated |
| handshake | 1 per second, S1 | 51 to 90 ms to a 403 from Cloudflare colo `SEA`, P1 |
| subscription limits | 240 per hour, S1 | refused |
| access | "You must apply for a whitelist to access all APIs!", S7, and the change log entry of 2026-05-13, "All clients should be added into whitelist so that they can visit the API.", S10 | refused |

The whole `ws-openapi.crypfine.com` host answered 403 at the edge, the root path included, while the documentation pages on `www.crypfine.com` answered 200 through the same Cloudflare zone, see [`rest.md`](./rest.md) section 1.

## 6. Captured frames

No frame was exchanged.
The refusal of the upgrade, as `ws-probe.mjs` printed it on 2026-09-23 at 06:39 UTC.

```json
{"tag":"result","attempt":1,"opened":false,"ms":72,"status":403,"server":"cloudflare","cfRay":"a3f78bcaed46dee2-SEA","type":"text/html; charset=UTF-8","bytes":4547,"title":"Attention Required! | Cloudflare","blocked":true,"frames":0,"pings":0,"byTopic":{}}
```

The body is Cloudflare's block page, "Sorry, you have been blocked. You are unable to access crypfine.com", which names no reason beyond "The action you just performed triggered the security solution.".

The documented order book frame, trimmed, S3.

```json
{"topic": "usdt/orderBook.BTC-SWAP", "action": "update", "data": [{"bids": [["29953.9", "18167"], ["29953.6", "0"], ["29953.3", "6419"], ["29953.4", "6795"]], "asks": [["29954.2", "18862"], ["29954.5", "0"]], "version": 46165145, "timestamp": 1681273582128}]}
```

The documented ticker frame, trimmed, S4.

```json
{"topic": "usdt/ticker.BTC-SWAP", "data": [{"symbol": "BTC-SWAP", "lastPrice": "29926.5", "markPrice": "29927.9", "bestAskPrice": "29926.7", "bestBidPrice": "29926.4", "timestamp": 1681281991103, "indexPrice": "29927.9", "fundingRate": "0.000298", "openInterest": ""}]}
```

## 7. Private channels

None documented on the socket.
The error codes `10504`, `10510` and `10511` imply a login, S5, but the perpetual document names no private topic.
Order entry is REST only, under `/api/v1/usdt/...`, according to the change log, S10.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Do not build a feed.
The socket refuses this host, access needs a whitelist that the venue grants only to KYC-verified accounts from outside the Excluded Jurisdictions, and both the United States and Canada are excluded, see [`fees.md`](./fees.md) section 1.

If access were ever granted, the unknowns a probe would have to settle first are these.

| item | open question |
|---|---|
| sequence | whether `version` steps by one per topic, so a gap can call `resync` |
| snapshot | whether every subscribe gets an `insert`, and whether a later `insert` replaces the book |
| depth | whether `.200` keeps a 200 level window with explicit `"0"` deletions |
| keepalive | whether the 5 s ping is a protocol ping, which `ws` answers on its own, or a text frame |
| markets per connection | nothing published, and 240 subscriptions per hour caps resubscribe storms |
| compression | whether the server honours a client that refuses permessage-deflate, as [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 does |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WS General Info | https://www.crypfine.com/openapi-docs/usdt_perpetual/ws/ws_general_info/ | 2026-09-22 | Crypfine | limits, heartbeat, sections 3 and 5 |
| S2 | Base Endpoint | https://www.crypfine.com/openapi-docs/usdt_perpetual/general_info/base_endpoint/ | 2026-09-22 | Crypfine | WebSocket URL, section 1 |
| S3 | WebSocket Order Book | https://www.crypfine.com/openapi-docs/usdt_perpetual/ws/order_book/ | 2026-09-22 | Crypfine | topic, depths, frame, `version`, sections 2 to 4 and 6 |
| S4 | WebSocket Ticker | https://www.crypfine.com/openapi-docs/usdt_perpetual/ws/ticker/ | 2026-09-22 | Crypfine | ticker topic and fields, sections 2 and 6 |
| S5 | Error Codes | https://www.crypfine.com/openapi-docs/usdt_perpetual/usdt_errorcode/ | 2026-09-22 | Crypfine | WebSocket error codes, sections 3, 5 and 7 |
| S6 | CrypFine Spot V2 API | https://www.crypfine.com/openapi-docs/spot/ | 2026-09-22 | Crypfine | no spot socket documented, section 1 |
| S7 | CrypFine USDT Perpetual API and Interface Type | https://www.crypfine.com/openapi-docs/usdt_perpetual/ | 2026-09-22 | Crypfine | whitelist notice, public topics need no signature, sections 3 and 5 |
| S8 | Order Book and Exchange Information (REST) | https://www.crypfine.com/openapi-docs/usdt_perpetual/public/depth/ | 2026-09-22 | Crypfine | size unit inference, section 3 and 4 |
| S9 | HYPE Perpetual Trading Available Now | https://crypfine.zendesk.com/hc/en-001/articles/16646375271823 | 2026-09-22, published 2026-06-29 | Crypfine | face value 0.1 HYPE, section 4 |
| S10 | Change Log | https://www.crypfine.com/openapi-docs/usdt_perpetual/usdt_changelog/ | 2026-09-22 | Crypfine | whitelist entry of 2026-05-13, REST order paths, sections 5 and 7 |
| P1 | `ws-probe.mjs`, two runs at 06:39 and 06:45 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/crypfine/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit, Cloudflare colo `SEA` | the refusal, sections 1, 3, 5 and 6 |
