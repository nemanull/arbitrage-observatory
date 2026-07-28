# Coinbase WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-07-26.

## Scope

Coinbase exposes different WebSocket protocols for Advanced Trade, Coinbase Exchange, Coinbase International Exchange, and Coinbase Prime.
Coinbase Derivatives Exchange does not document a native WebSocket interface.
Its participant connectivity uses FIX, SBE, UDP, and HTTPS.
Some Coinbase Derivatives products can still appear through an eligible broker interface such as Advanced Trade or Prime.
Coinbase has also published a pre-cutover International Derivatives gateway that is scheduled to go live on 2026-09-09.

This profile covers market data and private account data that can affect arbitrage discovery, validation, or execution.
The executable feeds on the retrieval date distribute data rather than provide a general WebSocket order-entry API.
The planned International Derivatives gateway is the documented exception because it will support JSON-RPC order entry after cutover.
Coinbase publishes no separate WebSocket market-data interface for consumer simple trading, Coinbase One, staking, cards, lending, custody billing, or Coinbase Capital Markets stocks.
The Advanced `user` channel documents beta prediction-market positions, but Coinbase publishes no separate current prediction-market WebSocket market-data channel.

## Direct answer

For Advanced Trade, use this endpoint for public market data:

```text
wss://advanced-trade-ws.coinbase.com
```

Subscribe to two products by putting both product IDs in one `product_ids` array:

```json
{
  "type": "subscribe",
  "product_ids": ["ETH-USD", "BTC-USD"],
  "channel": "level2"
}
```

One Advanced Trade subscription message can contain only one channel.
Send a separate message for `heartbeats`, `ticker`, or a private channel.

The `ticker` channel is not sufficient for reliable best bid and ask discovery.
It emits when a trade matches, so a quote can change without causing a ticker message.
The `ticker_batch` channel is slower and currently omits best bid and ask.
Use `level2` to maintain current best prices and executable depth.

## Platform and endpoint matrix

| Platform | Environment | Endpoint | Authentication |
| --- | --- | --- | --- |
| Advanced Trade market data | Production | `wss://advanced-trade-ws.coinbase.com` | Optional for public channels |
| Advanced Trade user data | Production | `wss://advanced-trade-ws-user.coinbase.com` | JWT required for private channels |
| Coinbase Exchange market data | Production | `wss://ws-feed.exchange.coinbase.com` | Public channels available without authentication |
| Coinbase Exchange direct feed | Production | `wss://ws-direct.exchange.coinbase.com` | Required |
| Coinbase Exchange market data | Sandbox | `wss://ws-feed-public.sandbox.exchange.coinbase.com` | Public channels available without authentication |
| Coinbase Exchange direct feed | Sandbox | `wss://ws-direct.sandbox.exchange.coinbase.com` | Required |
| Coinbase Exchange MiCA market data | Production | `wss://ws-us.dma.prime.coinbase.com` | Depends on channel |
| Coinbase Exchange MiCA direct feed | Production | `wss://ws-us-direct.dma.prime.coinbase.com` | Required |
| Coinbase Exchange MiCA market data | Sandbox | `wss://ws-us.dma.sandbox.prime.coinbase.com` | Depends on channel |
| Coinbase Exchange MiCA direct feed | Sandbox | `wss://ws-us-direct.dma.sandbox.prime.coinbase.com` | Required |
| International Exchange market data | Production | `wss://ws-md.international.coinbase.com` | First subscription must authenticate |
| International Exchange market data | Sandbox | `wss://ws-md.n5e2.coinbase.com` | First subscription must authenticate |
| Coinbase Prime | Production | `wss://ws-feed.prime.coinbase.com` | Every subscription must authenticate |
| Advanced International Derivatives gateway | Pre-live until 2026-09-09 | `wss://drb.coinbase.com/ws/api/v2` | CDP token exchange is documented for cutover |

Coinbase recommends the standard Exchange feed as a failover when the direct feed is primary.
The Advanced user endpoint documentation similarly recommends the market endpoint as a failover.
Failover does not remove the need to reconcile sequence state.
Coinbase does not publish separate Advanced Trade or Prime WebSocket sandbox endpoints.
Do not send production traffic to the pre-live International Derivatives gateway before Coinbase's scheduled cutover.

## Advanced Trade

### Channel matrix

| Channel | Payload | Authentication | Arbitrage use |
| --- | --- | --- | --- |
| `heartbeats` | One-second heartbeat counter and time | No | Keeps sparse subscriptions open and detects liveness |
| `candles` | Five-minute rolling candles | No | Research and monitoring |
| `market_trades` | Market trades batched over 250 milliseconds | No | Trade flow and last sale |
| `status` | Product and currency metadata | No | Symbol state, increments, and product discovery |
| `ticker` | Trade-triggered ticker with best prices | No | Secondary discovery signal only |
| `ticker_batch` | Five-second ticker when changed | No | Low-rate monitoring |
| `level2` | Aggregated book snapshot and updates | No | Best bid, best ask, size, depth, and slippage |
| `user` | Order state with fill aggregates and eligible positions | Yes | Execution state |
| `futures_balance_summary` | Futures balances, margin, and profit or loss | Yes | Capital and risk state |

Most channels can close after 60 to 90 seconds without updates.
Subscribe to `heartbeats` on the connection to keep subscriptions open.
Coinbase recommends authentication even for public channels when practical.

### One product and multiple products

One product:

```json
{
  "type": "subscribe",
  "product_ids": ["ETH-USD"],
  "channel": "level2"
}
```

Two products:

```json
{
  "type": "subscribe",
  "product_ids": ["ETH-USD", "BTC-USD"],
  "channel": "level2"
}
```

Separate heartbeat subscription:

```json
{
  "type": "subscribe",
  "channel": "heartbeats"
}
```

Public subscriptions may omit `jwt`.
A private subscription must include a newly generated JWT.
Coinbase says each WebSocket message should use a different JWT because the token expires after two minutes.
WebSocket JWTs use ES256 and do not include a request method or path.

### Representative ticker response

```json
{
  "channel": "ticker",
  "client_id": "",
  "timestamp": "2023-02-09T20:30:37.167359596Z",
  "sequence_num": 0,
  "events": [
    {
      "type": "snapshot",
      "tickers": [
        {
          "type": "ticker",
          "product_id": "BTC-USD",
          "price": "21932.98",
          "best_bid": "21931.98",
          "best_bid_quantity": "8000.21",
          "best_ask": "21933.98",
          "best_ask_quantity": "8038.07770938"
        }
      ]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `channel` | Logical feed name |
| `timestamp` | Server envelope time in RFC 3339 form |
| `sequence_num` | Sequence value for the feed envelope |
| `events[].type` | Initial `snapshot` or later `update` event |
| `product_id` | Coinbase product identifier |
| `price` | Last matched price |
| `best_bid` and `best_ask` | Best prices carried by this trade-triggered update |
| `best_bid_quantity` and `best_ask_quantity` | Quantities at the reported best prices |

The response contains useful best prices, but the emission trigger is still a match.
Do not interpret it as a guaranteed quote-change feed.

### Level 2 response and book rules

```json
{
  "channel": "l2_data",
  "client_id": "",
  "timestamp": "2023-02-09T20:32:50.714964855Z",
  "sequence_num": 1,
  "events": [
    {
      "type": "update",
      "product_id": "BTC-USD",
      "updates": [
        {
          "side": "bid",
          "event_time": "2023-02-09T20:32:50.714964855Z",
          "price_level": "21921.73",
          "new_quantity": "0.06317902"
        }
      ]
    }
  ]
}
```

The first book event is a snapshot.
Apply later updates by product, side, and price.
`new_quantity` is the full quantity at the price rather than a change amount.
Delete the price level when `new_quantity` is zero.
Coinbase documents `level2` as guaranteeing delivery and as the easiest synchronized book feed.
Track `sequence_num` and heartbeat progression anyway so reconnects and processing failures are visible.
The generic sequence rule is scoped by product.
Coinbase does not document a checksum or replay request for this channel.
After reconnecting, resubscribe and rebuild from the new snapshot before applying updates.

### Advanced private state

The `user` channel sends an initial snapshot followed by order and position updates for the authenticated user.
Its order fields include cumulative quantity, remaining quantity, average price, status, product type, total fees, and value after fees.
The channel expects one connection per user.
If `product_ids` is omitted, the subscription covers all products.
Adding products requires unsubscribing and opening a new connection with the expanded array.
Initial open orders arrive in batches of 50 until a batch contains fewer than 50 orders.
Its beta position fields cover eligible perpetual futures, expiring futures, and prediction markets.
The `futures_balance_summary` channel reports buying power, balances, margin, unrealized profit or loss, and liquidation threshold.
Use both private channels for execution monitoring when futures are in scope.

### Advanced limits and session behavior

| Rule | Published value |
| --- | --- |
| First subscription deadline | Five seconds after connection |
| Channels per subscription message | One |
| Products per subscription message | Multiple through `product_ids` |
| Coinbase App documentation connection rate | 8 per second per IP |
| Coinbase Business documentation connection rate | 750 per second per IP |
| Unauthenticated message rate | 8 per second per IP |
| JWT lifetime | Two minutes |

The official Coinbase App and Coinbase Business documentation surfaces publish conflicting connection limits for the same Advanced Trade feed.
Use the lower limit of eight connection attempts per second until the production account or Coinbase support confirms the applicable limit.

## Coinbase Exchange

### Channel matrix

| Channel | Payload | Authentication | Arbitrage use |
| --- | --- | --- | --- |
| `heartbeat` | Sequence and last trade ID each second | No | Liveness and missed-trade detection |
| `status` | Products and currencies | No | Product state and increments |
| `auctionfeed` | Auction state and indicative book | Depends on access | Auction monitoring |
| `matches` | Trades only | No | Trade flow |
| `rfq_matches` | RFQ trades | Yes | Institutional execution history |
| `ticker` | Trade-triggered ticker with best prices | No | Secondary discovery signal |
| `ticker_batch` | Five-second ticker batch | No | Low-rate monitoring |
| `full` | Order lifecycle and trades | Yes | Level 3 reconstruction |
| `user` | Authenticated user's subset of `full` | Yes | Private order and fill state |
| `level2` | Aggregated book snapshot and updates | Yes | Best bid, best ask, size, depth, and slippage |
| `level2_batch` | Public 50-millisecond batches of Level 2 data | No | Lower-traffic depth |
| `level3` | Compact full-order feed | Yes | Per-order book reconstruction |
| `balance` | Holds and available balances | Yes | Private capital state |

Coinbase documents `level2` as the guaranteed-delivery book channel.
The unauthenticated `level2_batch` channel provides the same data class in 50-millisecond batches.
The `matches` channel can drop messages.
Use `heartbeat.last_trade_id` and the REST trades endpoint to recover missed trades when complete trade history matters.

### One message with multiple products and channels

```json
{
  "type": "subscribe",
  "product_ids": ["ETH-USD", "BTC-USD"],
  "channels": ["level2", "heartbeat", "ticker"]
}
```

Coinbase Exchange allows several channels in one subscription message.
Root `product_ids` apply to every named channel.
A channel object can carry a different `product_ids` array when the product sets differ.

### Exchange authentication

The `full`, `user`, `level2`, `level3`, and `rfq_matches` channels require authentication.
An authenticated subscription carries `signature`, `key`, `passphrase`, and `timestamp`.
The HMAC SHA-256 signature uses the same prehash as a `GET /users/self/verify` request.

### Representative ticker response

```json
{
  "type": "ticker",
  "sequence": 37475248783,
  "product_id": "ETH-USD",
  "price": "1285.22",
  "best_bid": "1285.04",
  "best_bid_size": "0.46688654",
  "best_ask": "1285.27",
  "best_ask_size": "1.56637040",
  "side": "buy",
  "time": "2022-10-19T23:28:22.061769Z",
  "trade_id": 370843401,
  "last_size": "11.4396987"
}
```

The Exchange ticker is also triggered by a match.
The five-second `ticker_batch` response uses the same schema and can include best prices, but it is too slow for executable quote state.
Use Level 2 for current quote state.

### Exchange sequence and recovery

Most messages use a sequence that increases independently for each product.
An increase greater than one indicates a gap.
A lower value can be stale or out of order.
The feed infrastructure can expose gaps even though WebSocket uses TCP.

For `full` or Level 3 reconstruction, subscribe first and queue messages.
Fetch a REST Level 3 snapshot next.
Discard queued messages at or below the snapshot sequence.
Replay the remaining messages in sequence order.
Resnapshot when a gap cannot be repaired.

Authenticated feed messages do not increment the normal market sequence.
Coinbase warns that a dropped authenticated message therefore cannot be detected from that sequence alone.
Reconcile private orders and balances periodically through REST.
The `balance` channel does not track every balance update and also requires REST reconciliation.
The Level 2 messages shown by Coinbase do not carry a sequence or checksum.
Use a fresh Level 2 snapshot after reconnecting rather than applying new updates to an old book.

### Exchange limits

| Rule | Published value |
| --- | --- |
| First subscription deadline | Five seconds after connection |
| Requests | 8 per second per IP with a burst of 20 |
| Client messages | 100 per second per IP |
| Inbound messages | 10 per second with a burst of 1000 |
| Standard subscription count | 10 per product and channel |

Paid accounts can obtain higher subscription limits.
Coinbase recommends spreading high-volume products and verbose channels across connections.
The feed supports `permessage-deflate` compression.

## Coinbase International Exchange

### Channel matrix

| Channel | Payload | Arbitrage use |
| --- | --- | --- |
| `INSTRUMENTS` | Product metadata, increments, limits, state, and contract multiplier | Instrument normalization |
| `MATCH` | Executed trades | Trade flow |
| `FUNDING` | Final and predicted funding rates | Carry cost |
| `RISK` | Index, mark, settlement, limits, and open interest | Derivative validation |
| `LEVEL1` | Real-time best bid and ask | Candidate discovery |
| `LEVEL2` | Aggregated top 20 price levels | Size and slippage |
| `CANDLES_ONE_MINUTE` | One-minute candles | Monitoring |
| `CANDLES_FIVE_MINUTE` | Five-minute candles | Monitoring |
| `CANDLES_THIRTY_MINUTE` | Thirty-minute candles | Monitoring |
| `CANDLES_TWO_HOUR` | Two-hour candles | Monitoring |
| `CANDLES_ONE_DAY` | Daily candles | Monitoring |
| `RFQ_MATCH` | RFQ trades | Institutional trade flow |
| `INDEX` | Index value once per second | Index monitoring |

This WebSocket is an authenticated market-data feed.
The documented channels do not provide private orders, balances, fills, or positions.
Use the International Exchange REST, FIX order entry, and FIX drop-copy interfaces for those functions.

### Multiple products and channels

```json
{
  "type": "SUBSCRIBE",
  "product_ids": ["BTC-PERP", "ETH-PERP"],
  "channels": ["LEVEL1", "LEVEL2", "FUNDING"],
  "time": "1683730727",
  "key": "API_KEY",
  "passphrase": "API_PASSPHRASE",
  "signature": "BASE64_HMAC_SIGNATURE"
}
```

The first subscription must contain valid authentication fields.
The signature is a Base64-encoded HMAC SHA-256 result over `TIMESTAMP + KEY + CBINTLMD + PASSPHRASE`.
The request time is epoch seconds and must be within 30 seconds of the request.
Send the first subscription within three seconds of connection.

### Level 1 response

```json
{
  "sequence": 1,
  "product_id": "BTC-PERP",
  "time": "2023-05-10T14:58:47.547Z",
  "bid_price": "28787.8",
  "bid_qty": "0.466",
  "ask_price": "28788.8",
  "ask_qty": "1.566",
  "channel": "LEVEL1",
  "type": "UPDATE"
}
```

`LEVEL1` is the closest Coinbase International equivalent to Binance `bookTicker`.
It carries both best prices and their quantities when both sides exist.
The initial event is a `SNAPSHOT`.
Later events use `UPDATE`.

### Level 2 response and recovery

```json
{
  "sequence": 2,
  "product_id": "BTC-PERP",
  "time": "2023-05-10T14:58:47.375Z",
  "changes": [
    ["BUY", "28787.7", "6"]
  ],
  "channel": "LEVEL2",
  "type": "UPDATE"
}
```

The snapshot contains `bids` and `asks` arrays for the top 20 levels.
Each update tuple contains side, price, and the new absolute size.
A size of zero removes the level.
Sequence numbers increase by one across the entire session rather than independently by product.
Subscription confirmations do not have sequence numbers.
Coinbase documents no replay request or checksum for this feed.
The safest recovery after a gap is to reconnect and rebuild state from fresh snapshots.
`MATCH` and `RFQ_MATCH` do not provide initial snapshots, so reconcile complete trade history through an authoritative non-WebSocket interface when required.

The server can disconnect slow consumers.
Geofencing applies to the source IP.
The published connection limit is ten attempts in any 30-second interval.

## Planned Advanced International Derivatives gateway

Coinbase marks the Deribit-powered International Derivatives REST and WebSocket gateway as coming soon.
The documented hard cutover is 2026-09-09.
The current International Exchange endpoints stop serving international derivatives at cutover, with no parallel-running window.

The planned gateway uses JSON-RPC 2.0 over HTTP and WebSocket.
Its WebSocket endpoint is:

```text
wss://drb.coinbase.com/ws/api/v2
```

The published AsyncAPI specification covers announcements, block RFQ, block trades, order books, market data, platform state, trades, and private user streams.
It also supports WebSocket order entry and cancel-on-disconnect behavior.
New perpetual identifiers use `{BASE}_USDC-PERPETUAL`, such as `BTC_USDC-PERPETUAL`.
The migration guide requires the new identifiers, while the AsyncAPI examples still show legacy Deribit-style identifiers such as `BTC-PERPETUAL`.
Resolve the production identifier set through instrument discovery at cutover instead of copying the AsyncAPI example literally.
These schemas are integration-planning material on the retrieval date and must not be treated as a live replacement before cutover.

## Coinbase Prime

### Channels

| Channel | Payload | Arbitrage use |
| --- | --- | --- |
| `heartbeats` | Time and message count | Liveness |
| `products` | Prime product metadata, permissions, futures details, funding, and venue | Instrument normalization |
| `orders` | Authenticated order snapshots and updates | Private execution state |
| `l2_data` | Aggregated Smart Order Router book | Best prices, depth, and slippage |

Every subscription request must be signed.
The request includes the access key, service account ID, timestamp, passphrase, signature, portfolio context, and product IDs.
The `orders` channel requires a portfolio ID.
The Prime overview sample uses `heartbeat`, while the newer channels page uses `heartbeats`.
The channels page and subscription acknowledgement should control the implemented name, but this official discrepancy requires an integration check.

### Prime multiple-product Level 2 subscription

```json
{
  "type": "subscribe",
  "channel": "l2_data",
  "access_key": "ACCESS_KEY",
  "api_key_id": "SERVICE_ACCOUNT_ID",
  "timestamp": "TIMESTAMP",
  "passphrase": "PASSPHRASE",
  "signature": "SIGNATURE",
  "venue_filtering": true,
  "portfolio_id": "PORTFOLIO_ID",
  "product_ids": ["BTC-USD", "BIP-20DEC30-CDE"]
}
```

Set `venue_filtering` to true and provide `portfolio_id` when the book must respect the portfolio's venue configuration.
Filtered responses include a `venue_configuration` field.
The same subscription can include spot and eligible Coinbase Derivatives product identifiers.

The first `l2_data` event is a snapshot.
Later events are updates with `side`, `event_time`, `px`, and `qty`.
Coinbase documents the channel as guaranteeing delivery.
The envelope has `timestamp`, `sequence_num`, and `events`.
Prime sequence numbers increase independently by product.
Coinbase does not document a checksum or replay request.
After a gap or reconnect, resubscribe and rebuild the book from the next snapshot.

Prime documentation accepts an ISO 8601 request timestamp but uses epoch seconds in its signing examples.
Use the exact request timestamp and signing convention supported by the current Prime client library or account integration.

Prime disconnects a client that consumes too slowly, sends too quickly, or allows messages to back up.
The first signed subscription is due within five seconds.
Connection attempts are limited to 750 per ten seconds per IP.

## Coinbase Derivatives Exchange

Coinbase Derivatives Exchange does not list WebSocket among its participant protocols.
It provides FIX 4.4 market data, UDP market data, FIX or SBE order entry, FIX drop copy, and an HTTPS REST gateway.
Do not invent a CDE WebSocket endpoint.
An observatory using a retail or Prime broker should consume the broker's documented feed for any CDE products exposed by that broker.
Direct exchange participants should follow the CDE FIX or UDP recovery rules instead of this WebSocket profile.

## Product identifiers and time normalization

| Platform | Product examples | Request time | Event time |
| --- | --- | --- | --- |
| Advanced Trade | `ETH-USD`, `BTC-USD` | JWT claims when authenticated | RFC 3339 envelope and event times |
| Coinbase Exchange | `ETH-USD`, `ETH-EUR` | Epoch seconds when authenticated | RFC 3339 `time` plus per-product sequence |
| International Exchange | `BTC-PERP`, `ETH-PERP` | Epoch seconds within 30 seconds | RFC 3339 `time` plus session sequence |
| Prime | `BTC-USD`, `BIP-20DEC30-CDE` | Signed timestamp | RFC 3339 envelope and event times |

Do not infer product type from a shared base asset.
Load instrument metadata and map each Coinbase identifier to a canonical base, quote, settlement asset, venue, contract size, and expiry.
Advanced public channels normally map `-USDC` aliases to corresponding `-USD` market data.
The `user` channel keeps `-USDC` product IDs distinct.
USDT-USDC and EURC-USDC remain available on all Advanced channels.

Store both exchange event time and local receive time.
Use a monotonic local clock for latency measurements.
Never compare sequence numbers between Coinbase platforms because their sequence scopes differ.

## What the observatory should subscribe to

### Discovery

For Advanced Trade and Coinbase Exchange, derive top of book from `level2` or `level2_batch`.
For International Exchange, subscribe to `LEVEL1`.
For Prime, derive top of book from `l2_data`.
Add the platform heartbeat channel or an application liveness timer.

### Validation

Maintain Level 2 depth for every executable product.
Load product metadata and trading state.
For International perpetuals, add `FUNDING`, `RISK`, and `INSTRUMENTS`.
For Prime futures, read futures details from `products`.
Join this market data with the fee profile, balances, transfer state, and local latency.

### Execution

Advanced Trade should use `user` and `futures_balance_summary`.
Coinbase Exchange should use `user` and `balance`, with REST reconciliation.
Prime should use `orders` and authenticated portfolio data.
International Exchange needs FIX drop copy or authenticated REST reconciliation because its WebSocket is market data only.
Direct Coinbase Derivatives execution needs its documented FIX or SBE interfaces.

## Source ledger

All sources were retrieved on 2026-07-26.

| Official source | Supports |
| --- | --- |
| [Advanced Trade WebSocket overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview) | Endpoints, protocol, subscription deadline, and one-channel messages |
| [Advanced Trade WebSocket channels](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels) | Channels, response schemas, heartbeat behavior, and Level 2 rules |
| [Advanced Trade WebSocket authentication](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-authentication) | JWT requirements and lifetime |
| [Advanced Trade WebSocket rate limits for Coinbase App](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-rate-limits) | Eight-per-second connection and unauthenticated-message rates |
| [Advanced Trade WebSocket rate limits for Coinbase Business](https://docs.cdp.coinbase.com/coinbase-business/advanced-trade-apis/websocket/websocket-rate-limits) | Conflicting 750-per-second connection rate and eight-per-second unauthenticated-message rate |
| [Coinbase Exchange WebSocket overview](https://docs.cdp.coinbase.com/exchange/websocket-feed/overview) | Standard and direct endpoints, subscriptions, compression, and sequences |
| [Coinbase Exchange WebSocket channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels) | Channel inventory, schemas, Level 2, Level 3, and balance behavior |
| [Coinbase Exchange WebSocket authentication](https://docs.cdp.coinbase.com/exchange/websocket-feed/authentication) | Authenticated channels and private sequence limitation |
| [Coinbase Exchange WebSocket rate limits](https://docs.cdp.coinbase.com/exchange/websocket-feed/rate-limits) | Message and subscription limits |
| [Coinbase Exchange systems and operations](https://docs.cdp.coinbase.com/exchange/introduction/systems-operations) | Production and MiCA endpoints |
| [Coinbase Exchange sandbox](https://docs.cdp.coinbase.com/exchange/introduction/sandbox) | Standard and MiCA sandbox endpoints |
| [International Exchange WebSocket overview](https://docs.cdp.coinbase.com/international-exchange/websocket-feed/websocket-overview) | Endpoints, subscriptions, message types, and session sequence |
| [International Exchange WebSocket authentication](https://docs.cdp.coinbase.com/international-exchange/websocket-feed/authentication) | First-message authentication and signature construction |
| [International Exchange WebSocket channels](https://docs.cdp.coinbase.com/international-exchange/websocket-feed/channels) | Channel inventory, schemas, and book semantics |
| [International Exchange rate limits](https://docs.cdp.coinbase.com/international-exchange/introduction/rate-limits-overview) | Connection-attempt limit |
| [Advanced International Derivatives overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/guides/derivatives/overview) | Scheduled cutover, planned endpoint, protocol, identifiers, and order-entry behavior |
| [Advanced International Derivatives AsyncAPI](https://docs.cdp.coinbase.com/api-reference/coinbase-deribit-app-api/adv-starbase-asyncapi.json) | Planned stream channel schemas |
| [Coinbase Prime WebSocket overview](https://docs.cdp.coinbase.com/prime/websocket-feed/overview) | Endpoint, authentication, connection deadline, and rate limit |
| [Coinbase Prime WebSocket channels](https://docs.cdp.coinbase.com/prime/websocket-feed/channels) | Products, orders, heartbeats, Level 2, and venue filtering |
| [Coinbase Derivatives connectivity](https://docs.cdp.coinbase.com/derivatives/introduction/connectivity) | Direct CDE protocol inventory and absence of WebSocket |
