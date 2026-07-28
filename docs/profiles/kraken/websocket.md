# Kraken WebSocket Profile

Status: Done.

Retrieved: 2026-07-26.

This profile covers Kraken Spot WebSocket v2, Spot level three, authenticated Spot trading and account feeds, international derivatives, and the documented gap for United States futures.
It separates verified protocol behavior from conservative recovery decisions needed by an arbitrage observatory.

## Direct answer

Kraken Spot v2 can subscribe to two pairs in one request:

```json
{
  "method": "subscribe",
  "params": {
    "channel": "ticker",
    "symbol": [
      "BTC/USD",
      "ETH/USD"
    ],
    "event_trigger": "bbo",
    "snapshot": true
  },
  "req_id": 1
}
```

Use `event_trigger: "bbo"` for top-of-book price changes.
The default trigger is `trades`.
The documentation does not clearly guarantee an update for a quantity-only change at an unchanged best price.
Do not treat ticker as an authoritative size feed.

For executable arbitrage, subscribe to `book`:

```json
{
  "method": "subscribe",
  "params": {
    "channel": "book",
    "symbol": [
      "BTC/USD",
      "ETH/USD"
    ],
    "depth": 100,
    "snapshot": true
  },
  "req_id": 2
}
```

Best bid and offer is enough to screen a possible spread.
It is not enough to calculate trade-sized slippage or validate executable profit.
Use checksum-validated Spot L2 or the international Futures `book` feed for depth.
Also use fees, instrument rules, funding, balances, positions, and private execution events.

## Connection matrix

| Product | Production endpoint | Beta or demo endpoint | Purpose |
| --- | --- | --- | --- |
| Spot public v2 | `wss://ws.kraken.com/v2` | `wss://beta-ws.kraken.com/v2` | Public ticker, book, trade, candles, instruments, status, and heartbeat |
| Spot authenticated v2 | `wss://ws-auth.kraken.com/v2` | `wss://beta-ws-auth.kraken.com/v2` | Private executions, balances, and trading methods |
| Spot level three v2 | `wss://ws-l3.kraken.com/v2` | Not documented | Individual visible orders and queue state |
| International derivatives | `wss://futures.kraken.com/ws/v1` | `wss://demo-futures.kraken.com/ws/v1` | Public and private streaming only |
| United States futures | Not publicly documented | Not publicly documented | No current official WebSocket contract was found |

The beta Spot endpoints still reach the production trading engine.
They are not paper trading.
The international derivatives demo endpoint is still in the API introduction, but a support-page banner says the existing demo would be decommissioned.
Its current operational status must be health-checked before use.

## Spot v2 wire conventions

Spot v2 uses JSON over TLS with Server Name Indication.
Symbols use human-readable forms such as `BTC/USD`.
Spot v1 forms such as `XBT/USD` must not be copied into v2 without instrument discovery.

Timestamps use RFC 3339 strings.
Examples can include nanosecond precision.
Timestamps are not unique identifiers and do not prove update cadence.

Prices and quantities are JSON numbers in the published payloads.
Kraken recommends a decoder that preserves full decimal precision.
The observatory should convert them directly into an exact decimal representation.

An inactive connection is normally closed after about one minute.
Any valid request such as an application ping keeps it active.
A private endpoint needs at least one private subscription to remain open.
Cloudflare permits about 150 reconnection attempts per rolling ten minutes per IP before a temporary ban.
Kraken recommends no faster than one reconnect every five seconds during maintenance or downtime.

## Spot public channels

| Channel | Purpose | Snapshot | Update trigger |
| --- | --- | --- | --- |
| `ticker` | Best bid and offer, last trade, and 24-hour statistics | Optional and true by default | Best-price change or trade, according to `event_trigger` |
| `book` | Aggregated level-two order book | Optional and true by default | Changed price levels |
| `level3` | Individual visible resting orders | Optional and true by default | Add, modify, and delete |
| `trade` | Matched trades | Latest 50 only when requested | Match |
| `ohlc` | Trade-based candles | Optional and true by default | Trade |
| `instrument` | Assets, pairs, precision, increments, minima, statuses, and limits | Full snapshot | Instrument change |
| `heartbeat` | Connection liveness | Not subscribed directly | Once per idle second |
| `status` | Exchange and API state | Automatic on connect | State change |

## Spot ticker

A single-symbol request is:

```json
{
  "method": "subscribe",
  "params": {
    "channel": "ticker",
    "symbol": [
      "BTC/USD"
    ],
    "event_trigger": "bbo",
    "snapshot": true
  },
  "req_id": 10
}
```

Kraken sends one subscription acknowledgement per symbol.
A representative snapshot or update is:

```json
{
  "channel": "ticker",
  "type": "update",
  "data": [
    {
      "symbol": "BTC/USD",
      "bid": 63500.1,
      "bid_qty": 1.25,
      "ask": 63500.2,
      "ask_qty": 0.84,
      "last": 63500.2,
      "volume": 4210.42,
      "vwap": 62980.7,
      "low": 61800.0,
      "high": 64120.0,
      "change": 880.2,
      "change_pct": 1.41,
      "timestamp": "2026-07-26T12:00:00.123456789Z"
    }
  ]
}
```

`event_trigger` accepts `bbo` or `trades`.
The default is `trades`.
The ticker page defines `bbo` as a change in best bid or offer price levels.
It does not explicitly promise a quantity-only update when those prices do not change.
Use `book` when size freshness matters.

## Spot level-two book

Supported depths are 10, 25, 100, 500, and 1,000.
The default depth is 10.

A representative snapshot is:

```json
{
  "channel": "book",
  "type": "snapshot",
  "data": [
    {
      "symbol": "BTC/USD",
      "bids": [
        {
          "price": 63500.1,
          "qty": 1.25
        }
      ],
      "asks": [
        {
          "price": 63500.2,
          "qty": 0.84
        }
      ],
      "checksum": 138531403,
      "timestamp": "2026-07-26T12:00:00.123456789Z"
    }
  ]
}
```

An update contains only changed levels:

```json
{
  "channel": "book",
  "type": "update",
  "data": [
    {
      "symbol": "BTC/USD",
      "bids": [
        {
          "price": 63500.1,
          "qty": 1.1
        }
      ],
      "asks": [
        {
          "price": 63500.2,
          "qty": 0.0
        }
      ],
      "checksum": 144467018,
      "timestamp": "2026-07-26T12:00:00.223456789Z"
    }
  ]
}
```

Quantities are absolute.
A zero quantity deletes a level.
When one message updates the same price more than once, apply those entries in message order.
The protocol does not expose a numeric book sequence.

### Spot checksum

Every snapshot and update carries an unsigned CRC32 checksum of the top ten levels on each side.
The checksum covers ten levels even when the subscription depth is larger.

Apply the checksum in this order:

1. Apply every update in the message.
2. Delete zero-quantity levels.
3. Truncate the local book to the subscribed depth.
4. Sort asks from lowest to highest.
5. Sort bids from highest to lowest.
6. Take the top ten asks followed by the top ten bids.
7. Remove decimal points and leading zeroes from each price and quantity according to Kraken's checksum format.
8. Concatenate each price and quantity string.
9. Calculate unsigned CRC32.
10. Compare the result with the event checksum.

Preserve source decimal precision during this process.
Binary floating-point reformatting can create a false checksum mismatch.

On a mismatch, discard the book and unsubscribe and resubscribe to force a fresh snapshot.
After any disconnect, discard the old book and rebuild from a fresh snapshot.

## Spot level three

Spot level three uses its own authenticated endpoint.
It exposes individual visible resting orders.
It excludes unmatched market orders, untriggered stop and take-profit orders, and hidden iceberg quantity.

A multi-symbol request is:

```json
{
  "method": "subscribe",
  "params": {
    "channel": "level3",
    "symbol": [
      "BTC/USD",
      "ETH/USD"
    ],
    "depth": 100,
    "snapshot": true,
    "token": "TOKEN"
  },
  "req_id": 20
}
```

Supported depths are 10, 100, and 1,000.
Only one depth subscription is allowed per symbol.
Updates are real-time `add`, `modify`, and `delete` events.
Snapshot orders contain `order_id`, `limit_price`, `order_qty`, and `timestamp`.
The documentation states that no numeric sequencing is required.

The level-three checksum covers individual orders at the top ten price levels.
It preserves queue order within each price level.
It therefore validates both the visible book and priority order.

The limit is 200 symbols per connection.
The subscription counter is 200 per second for Standard access and 500 per second for Pro access.
A symbol costs 5, 25, or 100 counter units for depth 10, 100, or 1,000.

Level three is not required for ordinary cross-venue taker arbitrage.
It is valuable for maker queue and priority analysis.

## Spot trades and candles

A multi-symbol trade request is:

```json
{
  "method": "subscribe",
  "params": {
    "channel": "trade",
    "symbol": [
      "BTC/USD",
      "ETH/USD"
    ],
    "snapshot": false
  },
  "req_id": 30
}
```

The trade channel can batch matches that do not belong to one taker order.
Each entry includes symbol, taker side, quantity, price, order type, a unique per-book `trade_id`, and an RFC 3339 timestamp.
Setting `snapshot` to true returns the latest 50 trades.

The `ohlc` channel supports intervals of 1, 5, 15, 30, 60, 240, 1,440, 10,080, and 21,600 minutes.
It is trade-triggered.
Use `interval_begin` as the candle key.
The older `timestamp` candle field is deprecated.

## Spot instruments

The instrument feed is the Spot control-plane source.
A representative request is:

```json
{
  "method": "subscribe",
  "params": {
    "channel": "instrument",
    "execution_venue": "international",
    "include_tokenized_assets": false,
    "snapshot": true
  },
  "req_id": 40
}
```

The `execution_venue` value is `international` or `bitnomial-exchange`.
Setting `include_tokenized_assets` to true adds xStocks.
The feed supplies active assets and pairs, precision, price and quantity increments, minima, status, margin eligibility, and position limits.

United States retail margin routed through Bitnomial uses pair suffixes such as `BTC/USD:BTNL`.
This is Spot margin routing.
It does not prove that the international derivatives WebSocket carries United States futures.

## Spot heartbeat, status, and ping

`heartbeat` is automatic after any channel subscription.
It cannot be directly subscribed.
It arrives once per second when no other channel update was sent.

```json
{
  "channel": "heartbeat"
}
```

`status` is automatic on connection and on state changes.
It cannot be directly subscribed.
States include `online`, `cancel_only`, `maintenance`, and `post_only`.
The payload also carries API version, software version, and connection identifier.

An application ping is:

```json
{
  "method": "ping",
  "req_id": 123
}
```

A successful response is:

```json
{
  "method": "pong",
  "success": true,
  "req_id": 123,
  "time_in": "2026-07-26T12:00:00.123456789Z",
  "time_out": "2026-07-26T12:00:00.123556789Z"
}
```

## Spot authentication

Create a token with signed REST `POST https://api.kraken.com/0/private/GetWebSocketsToken`.
The API key needs WebSocket interface permission.

A representative REST result is:

```json
{
  "error": [],
  "result": {
    "token": "TOKEN",
    "expires": 900
  }
}
```

The token must be used within 15 minutes.
The authoritative endpoint page says that it remains valid after a maintained private subscription succeeds.
Other reconnection guidance loosely says that the token expires after 15 minutes.
The safest rule is to request a fresh token for every new private connection.
Do not rotate a healthy private connection only because 15 minutes elapsed.

Include the token in every private subscription and trading request.

## Spot private channels

| Channel | Purpose | Initial state |
| --- | --- | --- |
| `executions` | Orders, fills, status, fees, liquidity role, and optional rate counter | Order snapshot by default |
| `balances` | Wallet balances and ledger deltas | Balance snapshot |

`executions` replaces the combined purpose of v1 `openOrders` and `ownTrades`.
It can include the latest 50 trades when requested.
It exposes sequence, order, and fill identifiers.

`balances` exposes wallet snapshots and deltas with a sequence field.
The Spot v2 documentation does not publish a complete replay or gap-recovery algorithm for these private sequences.
After reconnect, resubscribe for snapshots and reconcile against REST.

## Spot WebSocket trading

Spot WebSocket methods include add, edit, amend, cancel, cancel-all, batch add, batch cancel, and cancel-on-disconnect.

A representative order request is:

```json
{
  "method": "add_order",
  "params": {
    "order_type": "limit",
    "side": "buy",
    "order_qty": 0.001,
    "symbol": "BTC/USD",
    "limit_price": 50000,
    "time_in_force": "ioc",
    "deadline": "2026-07-26T12:00:01.000000000Z",
    "cl_ord_id": "arb-1",
    "token": "TOKEN"
  },
  "req_id": 42
}
```

The `deadline` offset accepts 500 milliseconds through 60 seconds.
The default is five seconds.
Use a unique client order identifier for reconciliation.
Treat the method response as request acceptance.
Use `executions` for order and fill truth.

The trading-rate counter is shared across REST, WebSocket, and the user interface.
It is maintained separately per pair.
The maximum is 125 for Standard access and 180 for higher tiers.
The documented decay is 2.34 per second and 3.75 per second.
Placing costs one counter unit.
Cancellation cost depends on order age.

Kraken does not publish a general numeric Spot simultaneous-connection cap.
Capacity and message-rate errors can occur.
A connection can carry multiple or all-pair subscriptions.
Per-connection throughput still depends on load.

## International derivatives

International derivatives WebSocket is streaming-only.
Order entry uses the REST derivatives API.
The production REST base is `https://futures.kraken.com/derivatives/api/v3`.

Product identifiers use these prefixes:

| Prefix | Product |
| --- | --- |
| `FI_` | Fixed-maturity inverse future |
| `PI_` | Perpetual inverse future |
| `FF_` | Fixed-maturity linear future |
| `PF_` | Perpetual linear Multi-M contract |
| `IN_` | Index |
| `RR_` | Reference rate |
| `OF_` | Option |

International derivatives uses `XBT` in product identifiers.
An option follows a form such as `OF_XBTUSD_YYMMDD_STRIKE_C`.
WebSocket timestamps are generally Unix epoch milliseconds.
This differs from Spot v2 RFC 3339 time.

## International derivatives public feeds

| Feed | Purpose | Cadence |
| --- | --- | --- |
| `ticker` | BBO, size, last, volume, index, mark, funding, open interest, and state | At most once per second |
| `ticker_lite` | Compact prices and summary without BBO sizes | At most once per second |
| `book` | Aggregated level-two snapshot and deltas | Event-driven |
| `trade` | Trades, liquidations, terminations, and blocks | Event-driven |
| `heartbeat` | Liveness | Timed interval |

The current Futures WebSocket family does not document L3, OHLC, instrument, or WebSocket order-entry methods.
Use REST to discover tradeable contracts and specifications.

### Futures multi-product ticker

```json
{
  "event": "subscribe",
  "feed": "ticker",
  "product_ids": [
    "PF_XBTUSD",
    "PF_ETHUSD"
  ]
}
```

A representative update is:

```json
{
  "time": 1785076800123,
  "product_id": "PF_XBTUSD",
  "feed": "ticker",
  "bid": 63500.0,
  "ask": 63500.5,
  "bid_size": 2536.0,
  "ask_size": 13948.0,
  "last": 63500.5,
  "volume": 31403908.0,
  "index": 63502.12,
  "markPrice": 63501.46,
  "funding_rate": 0.0001,
  "funding_rate_prediction": 0.00008,
  "next_funding_rate_time": 1785080400000,
  "openInterest": 1580000.0,
  "suspended": false,
  "post_only": false
}
```

The full ticker sends complete state even when only one field changed.
Options add relevant Greeks.
Use the full ticker for funding, mark, index, open interest, and BBO context.
Do not use `ticker_lite` when quantities matter because it omits `bid_size` and `ask_size`.
The one-second throttle is too slow to replace the book feed for executable pricing.

### Futures multi-product book

```json
{
  "event": "subscribe",
  "feed": "book",
  "product_ids": [
    "PF_XBTUSD",
    "PF_ETHUSD"
  ]
}
```

A representative snapshot is:

```json
{
  "feed": "book_snapshot",
  "product_id": "PF_XBTUSD",
  "timestamp": 1785076800123,
  "seq": 326072249,
  "tickSize": null,
  "bids": [
    {
      "price": 63500.0,
      "qty": 6385.0
    }
  ],
  "asks": [
    {
      "price": 63500.5,
      "qty": 20598.0
    }
  ]
}
```

A representative delta is:

```json
{
  "feed": "book",
  "product_id": "PF_XBTUSD",
  "side": "sell",
  "seq": 326094134,
  "price": 63501.0,
  "qty": 0.0,
  "timestamp": 1785076800223
}
```

A zero quantity deletes the level.
The feed exposes a sequence.
Kraken does not document whether every sequence must be consecutive, how resets appear, or how a missed event can be replayed.
It does not publish a Futures book checksum.

The conservative policy is to discard the book after a disconnect, sequence regression, or suspicious gap.
Resubscribe and require a fresh `book_snapshot`.
This recovery policy is an engineering inference because the official gap algorithm is absent.

### Futures trades

The `trade` subscription uses the same `product_ids` array.
The first response is `trade_snapshot`.
Later events use `trade`.
Each trade includes a unique identifier, taker side, quantity, price, sequence, time, and a type.
Types include `fill`, `liquidation`, `termination`, and `block`.

### Futures heartbeat

Futures heartbeat must be explicitly subscribed:

```json
{
  "event": "subscribe",
  "feed": "heartbeat"
}
```

A representative event is:

```json
{
  "feed": "heartbeat",
  "time": 1785076800123
}
```

The documentation says that it arrives at timed intervals but does not define the exact cadence.
Send a WebSocket control ping at least every 60 seconds.
Kraken's official sample uses 30 seconds.
No JSON Futures application-ping schema is documented.

## International derivatives authentication

Request a challenge:

```json
{
  "event": "challenge",
  "api_key": "API_KEY"
}
```

The response contains a UUID in `message`.
Hash the challenge bytes with SHA-256.
Sign that digest with HMAC-SHA512 using the base64-decoded API secret.
Base64-encode the signature.

Include `api_key`, `original_challenge`, and `signed_challenge` in every private subscribe or unsubscribe request.

```json
{
  "event": "subscribe",
  "feed": "open_orders",
  "api_key": "API_KEY",
  "original_challenge": "CHALLENGE",
  "signed_challenge": "SIGNATURE"
}
```

Futures API credentials are separate from Spot credentials.
The documented maximum is 50 API keys per account.

## International derivatives private feeds

| Feed | Purpose |
| --- | --- |
| `balances` | Wallet and collateral snapshot and deltas |
| `fills` | Fill snapshot and updates with optional product filter |
| `open_orders` | Current order state |
| `open_orders_verbose` | Detailed state including failed post-only orders |
| `open_positions` | Position state |
| `account_log` | Account ledger events |
| `notifications_auth` | Authenticated notifications |

Most private feeds expose a `seq` value.
The current documentation does not define continuity, reset, replay, or snapshot alignment rules for those sequences.
After reconnect, resubscribe to snapshot-producing feeds and reconcile balances, positions, orders, and fills through REST.

The Futures limit is 100 concurrent WebSocket connections.
Each connection accepts at most 100 WebSocket requests per second.
The request bucket replenishes each second.

## United States futures gap

Kraken Derivatives US carries CME, CBOT, NYMEX, COMEX, and Bitnomial products.
Level I means last trade and BBO.
Level II means depth.
CME Level I can be free for funded non-professional clients.
CME Level II can be paid market data.
The current market-data article says Bitnomial perpetual Level II is not available.

United States product identifiers differ from international identifiers such as `PF_XBTUSD`.
The current API Center does not publish a Kraken Derivatives US WebSocket endpoint, authentication contract, subscription schema, or payload schema.
Do not assume that `wss://futures.kraken.com/ws/v1` carries United States products.
Treat programmatic United States futures market data as not publicly specified until Kraken supplies account documentation.

## Symbol and time normalization

| Product | Example symbol | Time form |
| --- | --- | --- |
| Spot v2 | `BTC/USD` | RFC 3339 |
| Spot Bitnomial-routed margin | `BTC/USD:BTNL` | RFC 3339 |
| International perpetual | `PF_XBTUSD` | Unix epoch milliseconds |
| International fixed future | Prefix plus pair and expiry | Unix epoch milliseconds |
| International option | `OF_XBTUSD_YYMMDD_STRIKE_C` | Unix epoch milliseconds |
| United States future | Product-specific CME or Bitnomial identifier | Not covered by a public WS schema |

Load Spot identifiers from `instrument`.
Load derivatives contracts and multipliers from REST.
Do not normalize `BTC` and `XBT` by string replacement without product metadata.
Store the source identifier, normalized base and quote, settlement asset, contract multiplier, expiry, and execution venue.

## What the observatory needs

### Candidate discovery

For Spot, `ticker` with `event_trigger: "bbo"` can screen price-level changes.
For international derivatives, the full `ticker` can screen BBO and supplies mark, index, funding, and open interest.
Both have limitations for quantity freshness or cadence.

### Opportunity validation

For Spot, maintain `book` at a depth that covers the target notional.
Validate every event checksum.
Depth 10 can be too shallow for larger trades.

For international derivatives, maintain `book` and combine it with the full `ticker`.
Rebuild conservatively on a disconnect or suspicious sequence.
Use REST contract metadata because Futures has no instrument WebSocket.

For every route, include:

- Exact maker and taker fees for the account.
- Price and quantity increments and minimum order size.
- Contract multiplier, margin mode, collateral, and expiry.
- Funding rate and next funding time.
- Expected volume-weighted average execution price.
- Available balance, collateral, and position capacity.
- Measured feed age and order-path latency.

### Execution and reconciliation

For Spot, subscribe to `executions` and `balances`.
Use cancel-on-disconnect when appropriate.
Use a unique `cl_ord_id` and a short valid deadline.

For international derivatives, subscribe to `fills`, `open_orders`, `open_positions`, and `balances`.
Place orders through REST because the Futures WebSocket is streaming-only.
Reconcile all private state through REST after reconnect.

## Why BBO is not enough

BBO exposes one price and at most one displayed quantity per side.
It cannot calculate volume-weighted price across the target size.
It cannot reveal deeper liquidity depletion.
It does not show queue priority, fees, minimums, multipliers, funding, balances, or transfer constraints.

Kraken Spot ticker has ambiguous quantity-only trigger behavior.
Kraken Futures ticker is throttled to at most one update per second.
Futures `ticker_lite` omits BBO sizes.

Use BBO only to screen.
Use L2 to validate.
Use private order and fill state to reconcile execution.

## Recovery state machine

1. Connect to the correct Spot or derivatives endpoint.
2. Load instrument metadata before accepting opportunities.
3. Subscribe to books, prices, funding state, and required private feeds.
4. Build Spot books from snapshots and validate every CRC32.
5. Build Futures books only after `book_snapshot`.
6. Discard Spot state on checksum failure or disconnect.
7. Discard Futures state on disconnect, sequence regression, or suspicious gap.
8. Request a fresh Spot token for every new authenticated connection.
9. Re-run the Futures challenge for every new authenticated connection.
10. Reconcile balances, positions, orders, and fills after reconnect.
11. Resume opportunity validation only after public and private state is healthy.

Spot and Futures do not publish a general replay token.
Reconstruction is required after disconnect.

## Documented conflicts and limitations

| Topic | Conflict or gap | Required treatment |
| --- | --- | --- |
| Spot L3 endpoint | The general introduction omits the endpoint change. | Use `wss://ws-l3.kraken.com/v2` from the official changelog. |
| Spot ticker trigger | One page offers BBO while overview prose emphasizes trade generation. | Use BBO for screening and `book` for authoritative size. |
| Spot token lifetime | Endpoint and reconnection prose differ. | Request a fresh token for each new connection. |
| Spot reconnection guide | Parts still describe v1 subscriptions and sequences. | Follow current v2 channel pages. |
| Futures demo | API introduction lists it while a support banner announces decommissioning. | Health-check and confirm before relying on it. |
| Futures sequences | No public continuity or replay algorithm exists. | Rebuild conservatively. |
| Futures checksum | No checksum is documented. | Do not invent one. |
| United States futures | No public WebSocket contract exists. | Keep the adapter unsupported until official account documentation exists. |

## Source ledger

Every source below was retrieved on 2026-07-26.

| Official source | Applies to | Supports |
| --- | --- | --- |
| [Spot and Futures WebSocket introduction](https://docs.kraken.com/exchange/guides/websockets/introduction) | Kraken Spot and Futures | Production endpoints, symbols, time, and reconnect guidance |
| [Kraken API changelog](https://docs-legacy.kraken.com/api/docs/change-log/) | Kraken APIs | Protocol changes and retired behavior |
| [Spot ticker](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker) | Kraken Spot v2 | BBO subscription, trigger, and response schema |
| [Spot level-two book](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/book) | Kraken Spot v2 | Snapshot, absolute updates, depth, and checksum field |
| [Spot level-two checksum](https://docs.kraken.com/exchange/guides/websockets/book-checksum-v2) | Kraken Spot v2 | CRC32 construction and recovery |
| [Spot reconnection](https://docs.kraken.com/exchange/guides/websockets/reconnection) | Kraken Spot | Backoff, reconnect limits, and state rebuild |
| [Spot level three](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/level3) | Kraken Spot v2 | Authenticated order-level book schema |
| [Spot level-three checksum](https://docs.kraken.com/exchange/guides/websockets/l3-checksum-v2) | Kraken Spot v2 | Level-three CRC32 construction |
| [Spot trades](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/trade) | Kraken Spot v2 | Trade subscription and payload |
| [Spot candles](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ohlc) | Kraken Spot v2 | OHLC subscription and payload |
| [Spot instruments](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/instrument) | Kraken Spot v2 | Symbol, status, precision, and fee metadata |
| [Spot heartbeat](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/heartbeat) | Kraken Spot v2 | Automatic liveness messages |
| [Spot status](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/status) | Kraken Spot v2 | Trading-system status |
| [Spot ping](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ping) | Kraken Spot v2 | Application liveness request |
| [WebSocket token](https://docs.kraken.com/api-reference/trading/get-websockets-token) | Kraken Spot private | Token acquisition and lifetime |
| [Spot WebSocket authentication](https://docs.kraken.com/exchange/guides/websockets/authentication) | Kraken Spot private | Token use and authenticated subscriptions |
| [Spot executions](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/executions) | Kraken Spot private | Orders, fills, fees, and snapshots |
| [Spot balances](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/balances) | Kraken Spot private | Balance snapshots and updates |
| [Spot add order](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/add_order) | Kraken Spot trading | WebSocket order entry and acknowledgement |
| [Spot trading rate limits](https://support.kraken.com/articles/360045239571-trading-rate-limits) | Kraken Spot trading | Shared trading counters and limits |
| [Spot WebSocket FAQ](https://support.kraken.com/articles/360022326871-kraken-websocket-api-frequently-asked-questions) | Kraken Spot | Idle closure, heartbeat, and operational behavior |
| [Futures introduction](https://docs.kraken.com/exchange/guides/futures/introduction) | Kraken international Futures | REST and WebSocket product boundary |
| [Futures WebSocket guide](https://docs.kraken.com/exchange/guides/futures/websockets) | Kraken international Futures | Endpoint, authentication, feeds, and keepalive |
| [Futures ticker](https://docs.kraken.com/exchange/api-reference/futures-websocket/ticker) | Kraken international Futures | Full ticker, mark, index, funding, and open interest |
| [Futures ticker lite](https://docs.kraken.com/exchange/api-reference/futures-websocket/ticker_lite) | Kraken international Futures | Reduced ticker schema |
| [Futures book](https://docs.kraken.com/exchange/api-reference/futures-websocket/book) | Kraken international Futures | Snapshot, delta, and sequence fields |
| [Futures trades](https://docs.kraken.com/exchange/api-reference/futures-websocket/trade) | Kraken international Futures | Trade subscription and payload |
| [Futures heartbeat](https://docs.kraken.com/exchange/api-reference/futures-websocket/heartbeat) | Kraken international Futures | Server liveness behavior |
| [Futures challenge](https://docs.kraken.com/exchange/api-reference/futures-websocket/challenge) | Kraken international Futures private | Challenge and signature authentication |
| [Futures balances](https://docs.kraken.com/exchange/api-reference/futures-websocket/balances) | Kraken international Futures private | Wallet and collateral state |
| [Futures fills](https://docs.kraken.com/exchange/api-reference/futures-websocket/fills) | Kraken international Futures private | Execution, fee, and sequence state |
| [Futures open orders](https://docs.kraken.com/exchange/api-reference/futures-websocket/open_orders) | Kraken international Futures private | Open-order snapshots and updates |
| [Futures verbose orders](https://docs.kraken.com/exchange/api-reference/futures-websocket/open_orders_verbose) | Kraken international Futures private | Expanded order state |
| [Futures positions](https://docs.kraken.com/exchange/api-reference/futures-websocket/open_position) | Kraken international Futures private | Open-position state |
| [Futures account log](https://docs.kraken.com/exchange/api-reference/futures-websocket/account_log) | Kraken international Futures private | Account activity and ledger state |
| [Futures authenticated notifications](https://docs.kraken.com/exchange/api-reference/futures-websocket/notifications) | Kraken international Futures private | Account and system notices |
| [Futures rate limits](https://docs.kraken.com/exchange/guides/futures/ratelimits) | Kraken international Futures | Connection and request limits |
| [Derivatives product symbols](https://support.kraken.com/articles/360022835891-ticker-symbols-derivatives) | Kraken derivatives | Symbol family and identifier rules |
| [Options contract specifications](https://support.kraken.com/articles/options-contract-specifications) | Kraken Options | Contract identifiers and settlement rules |
| [United States futures market data](https://support.kraken.com/articles/market-data) | Kraken Derivatives US | Level 1, Level 2, and entitlement boundary |
| [United States perpetual futures](https://support.kraken.com/articles/us-perpetual-futures) | Kraken Derivatives US | Bitnomial product scope and data availability |
| [United States contract specifications](https://support.kraken.com/articles/contract-specifications) | Kraken Derivatives US | CME and Bitnomial contract identifiers |
| [Bitnomial-routed Spot margin suffix](https://support.kraken.com/articles/360001491786-api-error-messages) | Kraken Derivatives US Spot margin | `:BTNL` symbol suffix |
| [Derivatives demo environment](https://support.kraken.com/articles/360024809011-api-testing-environment-derivatives) | Kraken international Futures demo | Demo environment boundary |

## Production validation

The following work requires live connections, captured messages, or additional official documentation and remains outside this documentation-only research:

- Verify Spot CRC32 against captured official messages.
- Test Spot quantity-only BBO behavior without relying on it.
- Confirm the operational status of the Futures demo endpoint.
- Exercise Futures sequence and reconnect behavior with recorded traffic.
- Obtain Kraken documentation for United States futures programmatic market data.
