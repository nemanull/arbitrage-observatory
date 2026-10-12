# Bitcoin.me WebSocket Profile

**Status:** Done.
Bitcoin.me lists no perpetuals, and its order book exchange has not traded since 2026-02-11, so the venue is profiled on its spot market as a defunct one.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:53 to 05:06 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the streaming market data of the legacy Bitcoin.me CEX at `cex.bitcoin.me`, formerly Klever Exchange.
Bitcoin.me publishes no WebSocket API.
Its API docs list REST calls only, S3 to S6, and its web app streams the book over gRPC-web, a server streaming HTTP POST, and not over a WebSocket.
That stream host answers 503 on every method from this exit.
Every probed value was captured by [`ws-probe.py`](../../../scripts/probes/venues/bitcoin-me/ws-probe.py), P3.
Source ids are those of the ledger in section 9 and of [`fees.md`](./fees.md) section 10.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| perpetuals | none, the venue offers none, S1 | not applicable |
| spot book and tickers, gRPC-web | `https://events.exchange.klever.io`, service `events.EventsService`, from the bundle, S14 | 503 "Service Temporarily Unavailable" from nginx on every method, P3 |
| documented WebSocket | none in S3 to S6 | not applicable |
| WebSocket upgrade on the events host | `wss://events.exchange.klever.io/`, a guess | HTTP 403 Cloudflare block page, P3 |
| WebSocket upgrade on the API host | `wss://api.exchange.bitcoin.me/`, a guess | HTTP 503 from nginx, P3 |

P3 scanned the main bundle and all 61 lazy chunks of `cex.bitcoin.me`, 62 files.
They hold no `ws://` or `wss://` URL and no `new WebSocket(` call.
They hold three gRPC-web clients: `EventsServiceClient` at `https://events.exchange.klever.io`, `MFAServiceClient` and `NftServiceClient`.

## 2. Channel matrix for public market data

The methods come from the bundle, S14, and none could be opened, P3.

| method | request message | pushes | probed |
|---|---|---|---|
| `SubscribeOrderGroups` | `ConnectOrderGroups`: `keypairId` field 1, `decimals` field 2, `limit` field 3, the web app's defaults being 6 and 70 | `StreamOrderGroupsResponse`: repeated `buyOrders` field 1, repeated `sellOrders` field 2, `eventTime` field 3 | 503 |
| `SubscribeTickers` | `ConnectStreamTicker`: `keypairId` field 1, `timeRange` field 2 | `StreamTickerResponse` | 503 |
| `HealthCheck` | empty | service and node status | 503 |
| `SubscribeOrderbookStatus`, `SubscribeGetKeypairs`, `SubscribeSyncLiquidityPool`, `SubscribeSyncOrders` | not read | not read | not called |
| `SubscribeBalances`, `SubscribeFills`, `SubscribeOrders`, `SubscribeStopOrders` | carry an auth token | private | not called |

There is no trades channel, no best bid and ask channel, and no mark, index or funding channel.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Documented" here means the web bundle, S14, since no stream API is published.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one gRPC-web host for every pair | 503 on every method |
| subscribe frame shape | one HTTP POST per stream, body a base64 gRPC-web frame holding `ConnectOrderGroups` | 503 before any frame |
| unknown symbol expectation | Not publicly specified | not testable |
| chunk unit and budget | one stream per pair, `limit` levels per side | not testable |
| keepalive mechanism | none in the bundle beyond HTTP | not testable |
| connection lifetime and maintenance notice | Not publicly specified | not testable |
| handshake and operation rate limits | Not publicly specified | 6 stream calls and 2 upgrades, no rate refusal, only 403 and 503 |
| public market data authentication | none for `SubscribeOrderGroups` and `SubscribeTickers`, which send no token in the bundle | not testable past the 503 |
| message parse and routing | one protobuf message type per stream, no routing key | not testable |
| subscribe acknowledgement shape | none, the stream starts with data | not testable |
| symbol identifier format | integer `keypairId`, such as 1 for KLV-USDT, from the REST catalog | the catalog maps names to ids, P2 |
| number representation | protobuf `double` for price and quantity | not testable |
| timestamp representation | protobuf `Timestamp` `eventTime` | not testable |
| size unit | `quantity` and `filled` per price group, base asset by the field names | not testable |
| sequence semantics | no sequence field in `StreamOrderGroupsResponse` | not testable |
| idle repeat behaviour | Not publicly specified | not testable |

## 4. The book channel in detail

The only book stream is `SubscribeOrderGroups`, S14.
Each message carries both sides as lists of `OrderGroup` rows and an event time, and the schema has no sequence number, checksum or delta flag.
An `OrderGroup` row holds `keypairId`, `keypairName`, `side`, `price`, `filled`, `quantity`, `feeAmount` and `kind`.
Whether each message is a full snapshot of the grouped book was not observable, since the stream answered 503.
The `decimals` argument groups prices, so the book is aggregated by the server and not raw.

Probed results, P3:

| call | headers | status |
|---|---|---|
| `HealthCheck`, `SubscribeOrderGroups` for keypair 1 with decimals 6 and limit 20, `SubscribeTickers` for keypair 1 | gRPC-web text headers, curl User-Agent, no Referer | 403 Cloudflare "Attention Required!" on all three |
| the same three | the same plus `Referer` and `Origin` of `cex.bitcoin.me` | 503 "Service Temporarily Unavailable" from nginx on all three |

So the Cloudflare rule of [`rest.md`](./rest.md) section 1 also guards the stream host, and behind it the stream service is down.

## 5. Session

Nothing could be measured, since no stream opened.
gRPC-web needs no permessage deflate, but it is not a WebSocket, so the engine's socket feed could not carry it as it stands.

## 6. Captured frames

No frame was received.
The one capture is the refusal body, an nginx page with Cloudflare's challenge script appended, trimmed:

```html
<html>
<head><title>503 Service Temporarily Unavailable</title></head>
<body>
<center><h1>503 Service Temporarily Unavailable</h1></center>
<hr><center>nginx</center>
```

## 7. Private channels

`SubscribeBalances`, `SubscribeFills`, `SubscribeOrders` and `SubscribeStopOrders` on the same `events.EventsService`, with the user's `AuthToken` in the request metadata, S14.
They were not called.

## 8. Recommended feed shape

None.
The venue has no perpetual, publishes no WebSocket, and its gRPC-web book stream is down behind a Cloudflare rule that only admits requests that look like its own web page.
Even with the service up, a feed would need a gRPC-web client in place of the socket feed, and it would get a server-aggregated book with no sequence, so the only resync would be a new stream.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S3 | Bitcoin.me Documentation, Introduction | https://docs.bitcoin.me/docs/intro/ | 2026-10-09 | Bitcoin.me | the docs cover REST only |
| S4 | Market, Symbol | https://docs.bitcoin.me/docs/Market/symbols/ | 2026-10-09 | Bitcoin.me | REST symbol call |
| S5 | Market, Order book | https://docs.bitcoin.me/docs/Market/orderbook/ | 2026-10-09 | Bitcoin.me | REST book call |
| S6 | Market, Tickers | https://docs.bitcoin.me/docs/Market/tickers/ | 2026-10-09 | Bitcoin.me | REST tickers call |
| S14 | CEX web bundle and its lazy chunks | https://cex.bitcoin.me/static/js/main.3ee5ce88.js | 2026-10-09 | Bitcoin.me | gRPC-web clients, `events.EventsService` methods, message fields, `subscribeOrderGroups` defaults |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/bitcoin-me/rest-probe.py) | local | 2026-10-09 | probe | catalog ids |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/bitcoin-me/ws-probe.py) | local | 2026-10-09 | probe | bundle scan, stream calls, WebSocket upgrades |

S1 is in [`fees.md`](./fees.md) section 10.
