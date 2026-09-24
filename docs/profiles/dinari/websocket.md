# Dinari WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:48 to 04:58 UTC, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

This profile covers Dinari's documented WebSocket, which carries market data for dShares spot and order updates for partners.
Dinari lists no perpetuals, so the book channel recorded here is the spot one, per template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
The documentation page is titled "Websockets for Order Data (DRAFT)" and says the feature "is currently in **beta** and the implementation may change", S1.
Every market data subscription requires an `authenticate` command with a partner API key and secret, S1, and the probe never sent one.
So every book claim below is documented only, and the probe recorded what the socket answers to a client without keys, in [`ws-probe.mjs`](../../../scripts/probes/venues/dinari/ws-probe.mjs).
Access results are from a Canadian VPN exit, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| environment | documented URL | probed |
|---|---|---|
| production | `wss://ws.api.dinari.com` | status 101 after 101 to 1,841 ms, 178 ms or less on 5 of 8 sockets, then a `welcome` frame |
| sandbox | `wss://ws.api.sandbox.dinari.com`, documented "(coming soon)" | status 101 after 95 and 183 ms, then the same `welcome` frame |

There is one URL per environment and no product split, because the venue has one product.
Both hostnames resolved to the three Cloudflare addresses in [`rest.md`](./rest.md) section 1, and the upgrade reply named `server: cloudflare`, with a `SEA` edge in the first runs and a `YVR` edge on four of five sockets of the rerun.

## 2. Channel matrix for public market data

| data type | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `stock_dfn_l2` | `{"command": "market_data_subscribe", "data": {"stock_dfn_l2": ["<stock_id>" or "*"]}}` | "DFN Level 2 order book data", the example shows `"MaxDepth": 30`, speed Not publicly specified | refused, `Authentication required` |
| `stock_dfn_quotes` | same command, key `stock_dfn_quotes` | "DFN top-of-book quotes", speed Not publicly specified | refused, `Authentication required` |
| trades, ticker, mark, index, funding | none | none | none exists |

The names and payloads are from S1.
DFN is not expanded in S1.
The order samples in S1 carry `chain_id` `eip155:202110`, one of the chains in the catalog of [`rest.md`](./rest.md) section 2, and the trading hours pages say a weekend order may rest "on the Dinari order book", S2.
So the L2 data is most likely Dinari's own book rather than a US exchange book, which is an inference.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per environment, S1 | the same, section 1 |
| subscribe frame shape | `{"command": "market_data_subscribe", "data": {<type>: [<stock_id>, …]}}`, and a reissued command replaces the whole subscription, "All requested `stock_ids` must be listed.", S1 | without authentication every subscribe answered `{"event_type":"error","data":{"msg":"Authentication required"}}` 17 to 29 ms after it was sent, in both runs |
| unknown symbol expectation | Not publicly specified | not reachable without keys |
| chunk unit and budget | Not publicly specified. `*` subscribes every stock, S1 | not reachable without keys |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping about every 20 s, first at 20.1 to 21.6 s after open and then 19.2 to 20.0 s apart, and the client library answers it. A client protocol ping got its pong in 17 and 18 ms on 3 of the 6 pings timed in the rerun, and in 829, 1,049 and 1,789 ms on the other 3 |
| connection lifetime and maintenance notice | Not publicly specified | no close in 90 s on a socket that sent nothing, nor on one that also pinged every 15 s, in either run. No maintenance frame seen |
| handshake and operation rate limits | Not publicly specified | none reached, with two sockets open at once at most and 10 sockets over the two runs |
| public market data authentication | required: `{"command": "authenticate", "data": {"api_key": …, "api_secret": …}}`, S1 | confirmed, every market data command refused without it |
| message parse and routing | `{"event_type": …, "data": {…}}`, with `market_data:l2_data` and `market_data:dfn_quote` for market data, S1 | the same envelope on every frame received |
| subscribe acknowledgement shape | none documented for market data. `order_data_subscribe` answers `{"event_type":"order_data_subscription","data":{"status":"subscribed"}}`, S1 | not reachable without keys |
| symbol identifier format | subscribe by the stock `id` UUID, and the frame names the ticker in `Symbol`, such as `"AAPL"`, S1 | not reachable without keys |
| number representation | `Price`, `Size`, `BidPrice`, `AskSize` as JSON numbers, S1 | not reachable without keys |
| timestamp representation | ISO 8601 strings with nanoseconds, `"2025-12-12T17:54:44.382483808Z"`, in `Timestamp` for L2 and `TimeStamp` for quotes, S1 | not reachable without keys |
| size unit | shares, the unit of the REST quote's `bid_size` "in shares", see [`rest.md`](./rest.md) section 5 | not reachable without keys |
| sequence semantics | none: the L2 example carries no update id, sequence or checksum, S1 | not reachable without keys |
| idle repeat behaviour | Not publicly specified | not reachable without keys |

## 4. The book channel in detail

`stock_dfn_l2` is the only depth channel, and none of it could be observed here.

| item | what S1 shows | status |
|---|---|---|
| snapshot on subscribe | each `market_data:l2_data` frame carries whole `Bids` and `Asks` arrays with a `Depth` index per level and `MaxDepth`, which reads like a full book per frame rather than deltas | an inference, Not verified |
| delta semantics | none documented | Not verified |
| sequence and gap rule | no id in the frame | a feed could only reset the book on every frame |
| checksum | none | none |
| level order | `Depth` 1 is the first level in the example | Not verified |
| depth | `"MaxDepth": 30` in the example, above the engine's 20 | Not verified |
| size unit | shares | Not verified |
| one-sided and empty books | the example has `"Asks": []`, and the quote example has `"AskPrice": 0, "AskSize": 0` | an empty side is legal on the wire |
| unknown or closed symbol | Not publicly specified | not reachable without keys |

The example prices are `0.01` for AAPL, so S1's samples are placeholders and not market data.

## 5. Session

| item | documented | probed |
|---|---|---|
| first frame | none | `{"event_type":"welcome","data":{"msg":"Welcome to Dinari websockets stream!"}}` within 2 ms of open |
| keepalive | Not publicly specified | server protocol ping about every 20 s, no application ping |
| silence the server tolerates | Not publicly specified | a socket that sent no frame, apart from the automatic pong, stayed open for 90 s |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | not forced: a client with `perMessageDeflate: false` got no `sec-websocket-extensions` header. A client that offered it got `permessage-deflate` back, on both hosts |
| handshake | none | status 101 after 95 to 1,841 ms, 183 ms or less on 7 of 10 sockets |
| unknown command | Not publicly specified | `{"event_type":"error","data":{"msg":"Invalid command"}}` and the socket stays open |
| text that is not JSON | Not publicly specified | `{"event_type":"error","data":{"msg":"Invalid command - JSON parse error"}}` and the socket stays open |
| subscription limits | none published | not reachable without keys |

The engine refuses permessage-deflate at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81, and Dinari accepts that.

## 6. Captured frames

From the probe runs of 2026-09-23, not trimmed.

Welcome, sent by the server on open.

```json
{"event_type":"welcome","data":{"msg":"Welcome to Dinari websockets stream!"}}
```

Subscribe without authentication, and its answer.

```json
{"command":"market_data_subscribe","data":{"stock_dfn_quotes":["0196ea6d-b6de-70d5-ae41-9525959ef309"]}}
```

```json
{"event_type":"error","data":{"msg":"Authentication required"}}
```

Unknown command, and text that is not JSON.

```json
{"event_type":"error","data":{"msg":"Invalid command"}}
```

```json
{"event_type":"error","data":{"msg":"Invalid command - JSON parse error"}}
```

No snapshot, delta or quote frame could be captured without keys.
The documented shapes are in S1.

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- `authenticate` with `api_key` and `api_secret`, answered by `event_type` `authentication` with `status` `authenticated` and the `entity_id`.
- `order_data_subscribe` with an empty `data`, which pushes `order_data` events for order requests, orders and order fulfillments of the partner's accounts.

## 8. Recommended feed shape

None.
The socket serves market data only to an authenticated partner, and API access starts at $2,000 a month after KYB, see [`fees.md`](./fees.md) sections 1 and 4.
The product is tokenized US stocks with no perpetual, so there is no leg for the engine to pair it with.
If a partner key ever existed, the documented shape would be one socket per environment, `authenticate` first, one `market_data_subscribe` that lists every stock id, a reset of the book on every `market_data:l2_data` frame because no sequence is documented, and a `maxSilenceMs` above the 20 s server ping, all Not verified.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Websockets for Order Data (DRAFT), updated 2025-12-15 | https://docs.dinari.com/docs/websockets.md | 2026-09-22 | Dinari, Inc. | URLs, authentication, market data types and frames, order data, sections 1 to 7 |
| S2 | Order Types and Behaviors, and Trading Hours | https://docs.dinari.com/docs/order-type.md and https://docs.dinari.com/docs/trading-hours.md | 2026-09-22 | Dinari, Inc. | the Dinari order book, section 2 |
| P1 | `ws-probe.mjs probe` at 04:48 UTC, and `all` in the second pass at 04:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dinari/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | welcome, refusals, error frames, pings, sections 1, 3, 5 and 6 |
| P2 | `ws-probe.mjs deflate` at 04:49 UTC, and `all` in the second pass at 04:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dinari/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | deflate negotiation and the sandbox host, sections 1 and 5 |
| P3 | `ws-probe.mjs silence` at 04:49 UTC, and `all` in the second pass at 04:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dinari/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | server ping interval, 90 s idle, sections 3 and 5 |
