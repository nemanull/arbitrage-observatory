# Bybit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-07-26.

## Scope

Bybit V5 separates public WebSocket connections by market family.
It uses separate connections for private account state, WebSocket order entry, Spread Trading, Request for Quote data, and system status.
Regional platforms can require a regional hostname.
The instrument catalog and several recovery snapshots remain REST resources rather than WebSocket channels.

This profile covers public and private data needed for arbitrage discovery, validation, execution, and recovery.
It also covers the optional Simple Binary Encoding interfaces that Bybit limits to eligible market makers and gateway users.

## Direct answer

Use the market-family endpoint that owns the product.
For example, global USDT and USDC linear products use the following endpoint.

```text
wss://stream.bybit.com/v5/public/linear
```

The following valid JSON message subscribes to one symbol.

```json
{
  "req_id": "linear-one-001",
  "op": "subscribe",
  "args": ["orderbook.50.BTCUSDT"]
}
```

The following valid JSON message subscribes to multiple symbols by putting every complete topic in the same `args` array.

```json
{
  "req_id": "linear-many-001",
  "op": "subscribe",
  "args": [
    "orderbook.50.BTCUSDT",
    "orderbook.50.ETHUSDT",
    "publicTrade.BTCUSDT",
    "publicTrade.ETHUSDT",
    "tickers.BTCUSDT",
    "tickers.ETHUSDT"
  ]
}
```

The topics in one public connection must belong to that connection's market family.
A Spot topic belongs on the Spot endpoint.
An inverse topic belongs on the inverse endpoint.

### Best bid and ask compared with Level 2

`orderbook.1.{symbol}` is Bybit's ordinary best-bid-and-ask feed.
It is sufficient to detect a candidate spread because it supplies the current top price and size on each side.
It is not sufficient to prove executable profit beyond the displayed top quantity.
Use `orderbook.50`, `orderbook.200`, or another supported depth to estimate fillable size, slippage, and the effect of simultaneous orders.

The Spot ticker does not publish bid and ask fields.
The derivatives ticker does publish a Level 1 quote, but the order-book feed has explicit snapshot and update semantics and is the better quote-state source.
The ordinary order book excludes Retail Price Improvement orders.
Use the RPI book when those orders are part of the intended liquidity view and the account has access.

## Connection matrix

### Global production

| Purpose | Endpoint | Authentication |
| --- | --- | --- |
| Spot public data | `wss://stream.bybit.com/v5/public/spot` | No |
| Linear USDT and USDC public data | `wss://stream.bybit.com/v5/public/linear` | No |
| Inverse public data | `wss://stream.bybit.com/v5/public/inverse` | No |
| Options public data | `wss://stream.bybit.com/v5/public/option` | No |
| Spread public data | `wss://stream.bybit.com/v5/public/spread` | No |
| Request for Quote public data | `wss://stream.bybit.com/v5/public/rfq` | No |
| Private account data | `wss://stream.bybit.com/v5/private` | Yes |
| WebSocket order entry | `wss://stream.bybit.com/v5/trade` | Yes |
| System status | `wss://stream.bybit.com/v5/public/misc/status` | No |

The English connection page currently prints the testnet host in its mainnet Request for Quote row.
The corresponding official Chinese and Taiwanese pages show `stream.bybit.com`.
The global mainnet Request for Quote endpoint above follows the internally consistent official regional-language rows.
Production code should still validate the endpoint during deployment.

### Testnet and demo

| Environment and purpose | Endpoint | Important boundary |
| --- | --- | --- |
| Testnet Spot | `wss://stream-testnet.bybit.com/v5/public/spot` | Testnet instruments and data |
| Testnet Linear | `wss://stream-testnet.bybit.com/v5/public/linear` | Testnet instruments and data |
| Testnet Inverse | `wss://stream-testnet.bybit.com/v5/public/inverse` | Testnet instruments and data |
| Testnet Options | `wss://stream-testnet.bybit.com/v5/public/option` | Testnet instruments and data |
| Testnet Spread | `wss://stream-testnet.bybit.com/v5/public/spread` | Testnet instruments and data |
| Testnet private | `wss://stream-testnet.bybit.com/v5/private` | Testnet credentials |
| Testnet order entry | `wss://stream-testnet.bybit.com/v5/trade` | Testnet credentials |
| Demo private | `wss://stream-demo.bybit.com/v5/private` | Demo credentials |

Demo public data uses the production public feeds.
WebSocket order entry is not supported in Demo Trading.

### Regional production hostnames

| Platform | WebSocket hostname |
| --- | --- |
| Bybit Türkiye | `stream.bybit.tr` |
| Bybit Indonesia | `stream.bybit.id` |
| Bybit Kazakhstan | `stream.bybit.kz` |
| Bybit Georgia | `stream.bybitgeorgia.ge` |
| Bybit Japan | `stream.manepa.jp` |
| Bybit EU system status | `stream.bybit.eu` |

The V5 connection page documents the first five host replacements.
The system-status page separately documents the Bybit EU host.
The global connection page does not document every general Bybit EU path.
An implementation must not manufacture unsupported EU endpoints by hostname substitution alone.

## Endpoint selection

The Linear endpoint covers USDT and USDC perpetual products and the documented linear futures products.
The inverse endpoint covers inverse perpetuals and inverse futures.
Options use their own endpoint and subscription limits.
Spread Trading combinations use the Spread endpoint.
Request for Quote public trades use the Request for Quote endpoint.

One connection cannot move a Spot topic into a Linear session.
Use a connection pool keyed by environment, entity hostname, protocol, and market family.

## Public channel matrix

| Channel pattern | Market family | Payload class | Primary use |
| --- | --- | --- | --- |
| `orderbook.{depth}.{symbol}` | Spot, Linear, Inverse, Options | Snapshot and delta or repeated Level 1 snapshot | Best quote, depth, and slippage |
| `orderbook.rpi.{symbol}` | Spot, perpetuals, futures | RPI-aware depth 50 | Retail-price-improvement liquidity |
| `orderbook.full.{symbol}` | Released products only | Full-depth delta without initial WebSocket snapshot | Deep book reconstruction |
| `tickers.{symbol}` | Spot, Linear, Inverse, Options | Product-specific ticker | Mark, index, funding, open interest, and summary data |
| `publicTrade.{symbol}` | Spot, Linear, Inverse, Options | Matched trades | Last sale and trade flow |
| `kline.{interval}.{symbol}` | Spot, Linear, Inverse | Trade-price candles | Monitoring and historical state |
| `allLiquidation.{symbol}` | Linear and Inverse | All liquidations | Forced-flow monitoring |
| `insurance.{settlement}` | Derivatives | Insurance-pool state | Risk monitoring |
| `adlAlert.{settlement}` | Derivatives | Auto-deleveraging alert | Risk monitoring |
| `priceLimit.{symbol}` | Derivatives | Current order-price limits | Order validation |
| `system.status` | System endpoint | Maintenance and incident state | Operational gating |

Bybit does not document a separate public instrument-definition WebSocket topic.
Instrument metadata must come from REST.

## Session authentication

Public market data does not require authentication.
Private state and WebSocket order entry require an API key and signature.

```json
{
  "req_id": "private-auth-001",
  "op": "auth",
  "args": [
    "API_KEY",
    1785090000000,
    "HEX_HMAC_SHA256_SIGNATURE"
  ]
}
```

The signature input is `GET/realtime` followed directly by the expiry timestamp.
The signature is an HMAC SHA-256 digest produced with the API secret.
The expiry value is a future epoch-millisecond timestamp.
Use a clock synchronized against Bybit server time.

An authentication response is an acknowledgment rather than an account snapshot.
Subscribe to private topics only after authentication succeeds.

## Subscribe, unsubscribe, and heartbeat messages

### Multiple topics on one symbol

```json
{
  "req_id": "linear-btc-001",
  "op": "subscribe",
  "args": [
    "orderbook.50.BTCUSDT",
    "publicTrade.BTCUSDT",
    "tickers.BTCUSDT",
    "allLiquidation.BTCUSDT",
    "priceLimit.BTCUSDT"
  ]
}
```

### Multiple private topics

```json
{
  "req_id": "private-subscribe-001",
  "op": "subscribe",
  "args": [
    "order.linear",
    "execution.linear",
    "execution.fast.linear",
    "position.linear",
    "wallet"
  ]
}
```

An all-category private topic and its category-specific form cannot be mixed in the same subscription.
For example, choose `order` or `order.linear`.

### Unsubscribe

```json
{
  "req_id": "linear-unsubscribe-001",
  "op": "unsubscribe",
  "args": [
    "publicTrade.BTCUSDT",
    "tickers.BTCUSDT"
  ]
}
```

### Application ping

```json
{
  "req_id": "ping-001",
  "op": "ping"
}
```

Bybit recommends an application ping every 20 seconds.
The client must also process protocol-level WebSocket ping and pong frames.

### Ordinary subscription acknowledgment

```json
{
  "success": true,
  "ret_msg": "",
  "conn_id": "ce3dpomvha7dha97tvp0-2xh",
  "req_id": "linear-many-001",
  "op": "subscribe"
}
```

Options and Spread can use a command-response shape with `successTopics` and `failTopics`.
The consumer must support both documented acknowledgment families.

## Connection and subscription limits

| Rule | Published limit |
| --- | --- |
| Connection establishment | At most 500 connections per five minutes per IP per WebSocket domain |
| Concurrent market-data connections | At most 1,000 per IP for each of Spot, Linear, Inverse, and Options |
| Public argument string length | At most 21,000 characters per connection |
| Spot arguments per subscribe request | At most 10 |
| Options arguments per connection | At most 2,000 |
| Futures argument count | No separate count published beyond string and connection limits |
| Spread argument count | No separate count published beyond string and connection limits |
| Private custom active time | From 30 seconds through 600 seconds |
| Default inactive disconnect | About ten minutes without server data or ping and pong activity |

The inactivity scan runs every 30 seconds.
A custom active-time value is therefore not a millisecond-precise deadline.
Avoid connection churn even when total concurrent connections remain below the cap.

## Standard order book

### Depth and push frequency

| Market | Depth | Push frequency |
| --- | ---: | ---: |
| Spot, Linear, and Inverse | 1 | 10 milliseconds |
| Spot, Linear, and Inverse | 50 | 20 milliseconds |
| Spot, Linear, and Inverse | 200 | 100 milliseconds |
| Spot, Linear, and Inverse | 1,000 | 200 milliseconds |
| Options | 25 | 20 milliseconds |
| Options | 100 | 100 milliseconds |

RPI orders are excluded.
A prelaunch product does not publish its order book until the `ContinuousTrading` phase.

### Representative snapshot

```json
{
  "topic": "orderbook.50.BTCUSDT",
  "type": "snapshot",
  "ts": 1785088800123,
  "data": {
    "s": "BTCUSDT",
    "b": [
      ["118000.00", "1.250"],
      ["117999.90", "0.800"]
    ],
    "a": [
      ["118000.10", "0.700"],
      ["118000.20", "2.100"]
    ],
    "u": 81234567,
    "seq": 9123456789,
    "cts": 1785088800120
  }
}
```

| Field | Meaning |
| --- | --- |
| `topic` | Subscribed depth and symbol |
| `type` | `snapshot` or `delta` |
| `ts` | Bybit system generation time in milliseconds |
| `data.s` | Bybit symbol |
| `data.b` | Bid price and absolute size pairs |
| `data.a` | Ask price and absolute size pairs |
| `data.u` | Order-book update identifier |
| `data.seq` | Cross-sequence for comparing generation order |
| `data.cts` | Matching-engine timestamp in milliseconds |

### Representative delta

```json
{
  "topic": "orderbook.50.BTCUSDT",
  "type": "delta",
  "ts": 1785088800143,
  "data": {
    "s": "BTCUSDT",
    "b": [
      ["118000.00", "1.100"],
      ["117999.90", "0"]
    ],
    "a": [
      ["118000.10", "0.650"],
      ["118000.30", "1.400"]
    ],
    "u": 81234568,
    "seq": 9123456790,
    "cts": 1785088800140
  }
}
```

A zero size deletes a price.
A previously absent price with positive size inserts a level.
A present price with positive size replaces the absolute size.
The update is not a size difference.

### Snapshot and delta recovery

1. Subscribe to the required book topic.
2. Treat the first snapshot as a complete replacement for that subscribed depth.
3. Apply later deltas by side and price.
4. Replace the entire local book whenever Bybit sends another snapshot.
5. Reset the book when `u` is 1 because that value identifies a service restart.
6. Treat a reconnect as a new session and wait for a new snapshot.
7. Periodically compare important top levels with the REST order-book snapshot.

Bybit documents `seq` as a cross-sequence that can compare messages across depths.
A smaller `seq` was generated earlier.
The standard partial-book documentation does not promise that every `u` value is consecutive.
Do not invent a universal partial-book gap rule from the stricter Full Order Book rules.
No checksum is documented for the ordinary JSON book.

### Level 1 behavior

Depth 1 is snapshot-only for Spot, Linear, and Inverse.
When the quote does not change for three seconds, Bybit can repeat the same snapshot with the same `u`.
The repeated identifier is therefore not automatically an error.

## RPI order book

The topic is `orderbook.rpi.{symbol}`.
It publishes depth 50 every 100 milliseconds for documented Spot, perpetual, and futures products.

```json
{
  "topic": "orderbook.rpi.BTCUSDT",
  "type": "snapshot",
  "ts": 1785088800200,
  "data": {
    "s": "BTCUSDT",
    "b": [
      ["118000.00", "1.250", "0.200"]
    ],
    "a": [
      ["118000.10", "0.700", "0.150"]
    ],
    "u": 42001,
    "seq": 9123456800,
    "cts": 1785088800198
  }
}
```

Every price level contains price, non-RPI size, and RPI size.
Bybit hides RPI size when it would cross opposing non-RPI liquidity.
The channel uses the same snapshot, delta, update identifier, cross-sequence, and engine-time concepts as the standard book.
The REST RPI order-book endpoint provides a recovery snapshot with up to 50 levels.

## Full Order Book

The topic is `orderbook.full.{symbol}`.
It publishes full-depth deltas every 200 milliseconds.
It does not send an initial WebSocket snapshot.
It excludes RPI orders.

The consumer must initialize from `GET /v5/market/full_orderbook`, which returns up to 10,000 levels on each side.
The official release matrix on 2026-07-26 lists Spot on testnet and mainnet.
It lists futures testnet with an estimated 2026-07-13 release and leaves futures mainnet undetermined.
The release matrix controls even though the introductory text refers more broadly to contracts.

Full-book `u` is consecutive within one session.
Full-book `seq` is monotonic but can skip.

1. Subscribe and buffer Full Order Book deltas.
2. Fetch the REST Full Order Book snapshot.
3. Align buffered messages against the snapshot sequence and update identifier.
4. Discard buffered messages that are not newer than the snapshot.
5. Replay newer messages in order.
6. Resnapshot when `u` jumps beyond the local value plus one.
7. Discard a message with a decreasing `seq`.
8. Resnapshot when `u` becomes 1.

Delisting, pre-auction, transition to continuous trading, and tick-size or lot-size changes can produce a reset with `u` equal to 1.
An empty reset must not be interpreted as a healthy empty market without checking instrument state.
The REST snapshot limit means a local view beyond 10,000 levels cannot be proven complete at initialization.

## Ticker

The topic is `tickers.{symbol}`.
Derivatives and Options publish every 100 milliseconds.
Spot publishes every 50 milliseconds.

Derivatives begin with a snapshot and then use deltas.
An omitted derivatives field remains unchanged.
Spot and Options use snapshot messages.

### Representative linear ticker

```json
{
  "topic": "tickers.BTCUSDT",
  "type": "delta",
  "ts": 1785088800300,
  "cs": 9123456900,
  "data": {
    "symbol": "BTCUSDT",
    "lastPrice": "118000.00",
    "markPrice": "117998.50",
    "indexPrice": "117997.90",
    "bid1Price": "117999.90",
    "bid1Size": "1.100",
    "ask1Price": "118000.10",
    "ask1Size": "0.650",
    "openInterest": "12500.50",
    "fundingRate": "0.000100",
    "nextFundingTime": "1785110400000",
    "fundingIntervalHour": "8"
  }
}
```

Derivatives fields include last, mark, index, best quote, open interest, turnover, volume, funding, delivery, basis, price change, and pre-market state where applicable.
Current ticker fields also expose the funding interval and cap values for applicable products.

Options fields include bid and ask prices, quantities, and implied volatility.
They also include last, mark, index, underlying, open interest, volume, turnover, delta, gamma, vega, theta, and predicted delivery values.

Spot fields include last price, daily and hourly references, high, low, volume, turnover, and an optional USD index price.
Spot ticker does not include bid or ask.

## Public trades

The topic is `publicTrade.{symbol}`.
Options subscriptions use a base coin such as `publicTrade.BTC`.
The messages use `type` equal to `snapshot` even though they deliver real-time trades.
Spot and futures messages can contain up to 1,024 trades.
Several trades in one message can share a sequence.

```json
{
  "topic": "publicTrade.BTCUSDT",
  "type": "snapshot",
  "ts": 1785088800400,
  "data": [
    {
      "T": 1785088800398,
      "s": "BTCUSDT",
      "S": "Buy",
      "v": "0.025",
      "p": "118000.10",
      "L": "PlusTick",
      "i": "trade-id-001",
      "BT": false,
      "RPI": false,
      "seq": 9123457000
    }
  ]
}
```

`S` is the taker side.
`T` is matching time in milliseconds.
Trades within the data array are sorted by matching time in ascending order.
Options trades add mark price, index price, mark implied volatility, and trade implied volatility.

## Klines

The topic is `kline.{interval}.{symbol}`.
Supported intervals are `1`, `3`, `5`, `15`, `30`, `60`, `120`, `240`, `360`, `720`, `D`, `W`, and `M`.
The push interval ranges from one second through 60 seconds.

```json
{
  "topic": "kline.1.BTCUSDT",
  "type": "snapshot",
  "ts": 1785088859000,
  "data": [
    {
      "start": 1785088800000,
      "end": 1785088859999,
      "interval": "1",
      "open": "117990.00",
      "close": "118000.10",
      "high": "118010.00",
      "low": "117980.00",
      "volume": "12.500",
      "turnover": "1475000.00",
      "confirm": false,
      "timestamp": 1785088858998
    }
  ]
}
```

`confirm` becomes true when the candle closes.
The candle timestamp is the last matched trade time.
The envelope `ts` is the Bybit system generation time.
The WebSocket channel covers trade-price candles.
Historical mark-price, index-price, and premium-index candles use separate REST endpoints.

## Liquidations and derivatives risk channels

### All Liquidation

The topic is `allLiquidation.{symbol}`.
It covers Linear, USDC, and Inverse derivatives.
It pushes every 500 milliseconds.

```json
{
  "topic": "allLiquidation.BTCUSDT",
  "type": "snapshot",
  "ts": 1785088800500,
  "data": [
    {
      "T": 1785088800495,
      "s": "BTCUSDT",
      "S": "Buy",
      "v": "0.500",
      "p": "117500.00"
    }
  ]
}
```

Bybit explicitly defines `Buy` as a long position being liquidated.
The side label is therefore counterintuitive and must not be reinterpreted as ordinary taker side.
`p` is the bankruptcy price.
The old `liquidation` topic is deprecated and publishes at most one liquidation each second.
Use `allLiquidation`.

### Insurance pool

The topics are `insurance.USDT`, `insurance.USDC`, and `insurance.inverse`.
They publish isolated insurance-pool balances every second when a change occurs.
The payload includes coin, symbols, balance, and update time.
Shared insurance pools are not pushed.
Use the corresponding REST resource for shared pools.

### Auto-deleveraging alert

The topics are `adlAlert.USDT`, `adlAlert.USDC`, and `adlAlert.inverse`.
They publish each second.
The payload includes coin, symbol, balance, and trigger thresholds.
The `mb` field is deprecated and empty.
Shared balance data updates on a next-day basis around 00:00 UTC.

### Order price limit

The topic is `priceLimit.{symbol}`.
It publishes every 300 milliseconds.
`buyLmt` is the highest allowed bid.
`sellLmt` is the lowest allowed ask.
Use these values with instrument tick sizes before submitting an order.

## System status

Subscribe to `system.status` on the separate system endpoint.

```json
{
  "op": "subscribe",
  "args": ["system.status"]
}
```

Events contain an incident or maintenance identifier, title, state, begin time, end time, link, service types, product, environment, user-identifier suffix, and maintenance type.
Bybit does not promise an event for interruptions shorter than ten seconds.
It also does not promise an event for every disconnection that permits immediate reconnection.
Operational gating therefore needs both this feed and local liveness checks.

## Spread Trading WebSocket

Spread public data uses `wss://stream.bybit.com/v5/public/spread`.
A combination symbol can resemble `SOLUSDT_SOL/USDT`.

| Topic | Frequency | Payload |
| --- | ---: | --- |
| `orderbook.25.{comboSymbol}` | 20 milliseconds | Snapshot and delta with `u`, `seq`, and `cts` |
| `publicTrade.{comboSymbol}` | Real time | Combination trade, taker side, price, quantity, tick direction, trade ID, and sequence |
| `tickers.{comboSymbol}` | 100 milliseconds | Snapshot with bid, ask, last, high, low, previous price, and volume |

Private Spread topics use the ordinary private endpoint.
`spread.order` publishes combination and leg category, parent and order identifiers, status, quantity, price, and timing.
`spread.execution` distinguishes combination, Spot leg, and futures leg executions.
Its `parentExecId` links component executions to the combination.
It also includes fees, maker state, and sequence.

WebSocket order entry does not support Spread.
Use the documented REST Spread endpoints for creation, amendment, and cancellation.

## Request for Quote WebSocket

The public topic is `rfq.open.public.trades`.
It publishes a completed block transaction with all legs together.
The payload includes creation time, Request for Quote identifier, strategy, update time, and legs.
Every leg includes category, symbol, side, price, quantity, mark price, and index price where applicable.

Private Request for Quote topics use the ordinary private endpoint.

| Topic | Payload |
| --- | --- |
| `rfq.open.rfqs` | Request for Quote lifecycle, status, counterparties, and legs |
| `rfq.open.quotes` | Quote lifecycle, price, quantity, status, and legs |
| `rfq.open.trades` | Private completed block transactions and linked legs |

## Private channel matrix

| Topic | Payload | Snapshot behavior | Arbitrage use |
| --- | --- | --- | --- |
| `order` or category-specific form | Order lifecycle and cumulative state | Event stream | Order state |
| `execution` or category-specific form | Full fills and fees | Event stream | Authoritative fill reconciliation |
| `execution.fast` or category-specific form | Reduced low-latency fill | Event stream | Early execution signal |
| `position` or derivatives category-specific form | Derivatives position state | Event stream | Exposure and margin |
| `wallet` | Unified and coin balances | No initial snapshot | Capital and liability updates |
| `greeks` | Aggregate option Greeks by base coin | Event stream | Options risk |
| `dcp.future`, `dcp.spot`, or `dcp.option` | Disconnect Cancel All trigger state | Event stream | Institutional fail-safe |
| `strategy` | TWAP, Iceberg, Chase, and POV strategy lifecycle | Event stream | Strategy monitoring |
| `spread.order` | Spread order lifecycle | Event stream | Spread execution |
| `spread.execution` | Spread and leg executions | Event stream | Spread fill and fee reconciliation |
| `rfq.open.rfqs` | Private Request for Quote lifecycle | Event stream | Block workflow |
| `rfq.open.quotes` | Private quote lifecycle | Event stream | Block workflow |
| `rfq.open.trades` | Private completed Request for Quote trades | Event stream | Block execution |

## Private order state

Subscribe to `order` for all documented categories or to `order.spot`, `order.linear`, `order.inverse`, and `order.option`.
Do not mix the all-category and category-specific forms in one request.

```json
{
  "id": "private-message-001",
  "topic": "order.linear",
  "creationTime": 1785088800600,
  "data": [
    {
      "category": "linear",
      "symbol": "BTCUSDT",
      "orderId": "order-id-001",
      "orderLinkId": "arb-open-001",
      "side": "Buy",
      "orderType": "Limit",
      "price": "118000.00",
      "qty": "0.010",
      "timeInForce": "PostOnly",
      "orderStatus": "Filled",
      "avgPrice": "118000.00",
      "cumExecQty": "0.010",
      "leavesQty": "0",
      "reduceOnly": false,
      "cancelType": "UNKNOWN",
      "rejectReason": "EC_NoError",
      "createdTime": "1785088799000",
      "updatedTime": "1785088800598"
    }
  ]
}
```

A cancel and fill race can produce two messages with `orderStatus` equal to `Filled`.
Inspect `rejectReason` and `cancelType` before treating the second message as a duplicate business event.
The older `cumExecFee` field is deprecated for Linear and Spot.
Use cumulative fee detail where present and the full Execution stream for per-fill accounting.

## Full and fast execution

The full topic is `execution` or a category-specific form.
One message can contain several fills for one order.
Important fields include execution identifier, order identifier, link identifier, price, quantity, value, time, maker flag, fee rate, fee amount, fee currency, execution type, and sequence.

```json
{
  "id": "private-message-002",
  "topic": "execution.linear",
  "creationTime": 1785088800610,
  "data": [
    {
      "category": "linear",
      "symbol": "BTCUSDT",
      "orderId": "order-id-001",
      "orderLinkId": "arb-open-001",
      "execId": "execution-id-001",
      "side": "Buy",
      "execPrice": "118000.00",
      "execQty": "0.010",
      "execValue": "1180.00",
      "execFee": "0.236",
      "feeRate": "0.0002",
      "feeCurrency": "USDT",
      "isMaker": true,
      "execType": "Trade",
      "execTime": "1785088800595",
      "seq": 9123457100
    }
  ]
}
```

Use the pair of `seq` and symbol as the documented cross-topic association key.
The `extraFees` field appears only in applicable India, Indonesia, and European contexts.

The fast topic is `execution.fast` or a category-specific form.
It has lower latency and includes only `Trade` executions.
It carries category, symbol, order identifier, link identifier, execution identifier, price, quantity, side, maker flag, time, and sequence.
It omits the complete fee detail.
Use it as an early signal while retaining full Execution as the accounting source.

## Position

Subscribe to `position` or `position.linear`, `position.inverse`, and `position.option`.
Spot does not have a position topic.
Create, amend, and cancel operations can trigger a position message even when economic exposure did not change.

Important fields include symbol, side, size, position index, entry and mark price, leverage, value, risk identifiers, initial margin, maintenance margin, liquidation price, unrealized profit or loss, realized profit or loss, position status, and auto-deleveraging rank.
The documented `seq` and symbol can associate the position update with an execution.
A `seq` of -1 means that the position has never traded.

## Wallet

The Wallet topic does not send an initial snapshot.
An unrealized-profit-or-loss-only change does not trigger it.
Bootstrap balances from REST before processing Wallet deltas.

```json
{
  "id": "private-message-003",
  "topic": "wallet",
  "creationTime": 1785088800700,
  "data": [
    {
      "accountType": "UNIFIED",
      "totalEquity": "25000.00",
      "totalWalletBalance": "24990.00",
      "totalAvailableBalance": "20000.00",
      "totalInitialMargin": "4990.00",
      "totalMaintenanceMargin": "250.00",
      "coin": [
        {
          "coin": "USDT",
          "equity": "25000.00",
          "walletBalance": "24990.00",
          "borrowAmount": "0",
          "accruedInterest": "0",
          "locked": "0",
          "totalOrderIM": "0",
          "totalPositionIM": "4990.00"
        }
      ]
    }
  ]
}
```

The old `availableToWithdraw` field is deprecated.
Use the authenticated REST transferable-amount resource.
Periodically reconcile wallet totals and liabilities through REST because the WebSocket is not a complete accounting ledger.

## Greeks, Disconnect Cancel All, and strategy state

The `greeks` topic aggregates total delta, gamma, vega, and theta by options base coin.
It does not replace per-position option state.

Disconnect Cancel All topics are available to eligible institutional users.
The trigger occurs only after every subscribing private connection has been dead for the configured window.
The default is ten seconds.
The documented configurable range is three through 300 seconds.
Enablement can require Bybit support or institutional access.

The `strategy` topic reports strategy identifier, type, category, symbol, side, size, status, termination reason, execution progress, and controls.
It covers documented TWAP, Iceberg, Chase, and Percentage of Volume workflows.

## WebSocket order entry

The order-entry endpoint supports Spot, Linear, USDC, Inverse, and Options.
It does not support Spread or Demo Trading.
The principal operations are `order.create`, `order.amend`, and `order.cancel`.

```json
{
  "reqId": "create-linear-001",
  "header": {
    "X-BAPI-TIMESTAMP": "1785088800800",
    "X-BAPI-RECV-WINDOW": "5000"
  },
  "op": "order.create",
  "args": [
    {
      "category": "linear",
      "symbol": "BTCUSDT",
      "side": "Buy",
      "orderType": "Limit",
      "qty": "0.010",
      "price": "117900.00",
      "timeInForce": "PostOnly",
      "orderLinkId": "arb-create-001"
    }
  ]
}
```

An ordinary request contains one order item.
`reqId` can contain at most 36 characters.
It must be unique within the session.
A duplicate returns error 20006.

The server applies this timestamp rule.

```text
server time - receive window ≤ client timestamp < server time + 1,000 milliseconds
```

The default receive window is 5,000 milliseconds.
An accepted response means that the request entered asynchronous processing.
It does not prove that an order was created, amended, canceled, or filled.
Use private Order and Execution messages to determine final state.

Batch operations allow at most 20 items for Options, Inverse, and Linear.
Spot batch operations allow at most ten items.
WebSocket and HTTP order operations share account rate limits.
The response headers expose the current limit, remaining amount, and reset timestamp.
The documented IP ceiling is 3,000 order-entry requests each second.

| Error | Meaning and handling |
| --- | --- |
| 10403 | IP request ceiling reached |
| 10404 | Operation or category is not supported |
| 10429 | System frequency protection |
| 10003 | Too many sessions under the same user identifier |
| 10016 | Internal error or service restart |
| 10019 | Trade service is restarting and a new connection is required |
| 20003 | Session-level request frequency |
| 20006 | Duplicate `reqId` |

## REST resources required beside WebSocket

| Requirement | REST resource | Reason |
| --- | --- | --- |
| Instrument catalog | `GET /v5/market/instruments-info` | No instrument-definition WebSocket topic exists |
| Server clock | `GET /v5/market/time` | Authentication and latency normalization |
| Current account fees | `GET /v5/account/fee-rate` | Trading cost is account specific |
| Current fee groups | `GET /v5/market/fee-group-info` | Pro and market-maker group membership can change |
| Standard book comparison | `GET /v5/market/orderbook` | Initial or periodic reconciliation |
| RPI book snapshot | `GET /v5/market/rpi_orderbook` | RPI recovery |
| Full-book snapshot | `GET /v5/market/full_orderbook` | Full Book has no initial WebSocket snapshot |
| Wallet bootstrap | Authenticated wallet balance | Wallet has no initial snapshot |
| Position bootstrap | Authenticated positions | Reconnect reconciliation |
| Open-order bootstrap | Authenticated open orders | Reconnect reconciliation |
| Execution bootstrap | Authenticated recent executions | Fill and fee reconciliation |

Instrument Information defaults to 500 rows and supports up to 1,000 rows per page.
Bybit has more than 500 Linear symbols.
Follow the cursor until all pages are loaded.
The response supplies category, symbol, status, base, quote, settlement asset, contract type, tick size, quantity step, minimum notional, limits, funding interval and caps, delivery data, and prelisting phase.

The ticker supplies current mark, index, funding, and open interest for derivatives.
There is no separate documented mark-price book or index-price book.
Mark-price, index-price, and premium-index historical candles are REST resources.

## Symbols, numbers, and time

Bybit public symbols are normally uppercase concatenated identifiers such as `BTCUSDT`.
Options public trades use a base coin subscription rather than one full option symbol.
Spread combinations use a venue-defined combination identifier.
Never derive contract economics from the symbol text alone.
Load instrument metadata and normalize base, quote, settlement asset, contract type, multiplier, expiry, tick, quantity step, minimum notional, and market phase.

Prices, quantities, fees, balances, rates, and most identifiers arrive as JSON strings.
Use decimal arithmetic rather than binary floating point.

| Field | Clock meaning |
| --- | --- |
| Public `ts` | Bybit system message-generation time in milliseconds |
| Order-book `cts` | Matching-engine time in milliseconds |
| Public-trade `T` | Match time in milliseconds |
| Private `creationTime` | Private message generation time in milliseconds |
| Execution `execTime` | Fill time represented as a millisecond string |
| Local receive time | Observatory timestamp captured on receipt |

Preserve exchange time and local receive time.
Use a monotonic local clock for latency.
Synchronize wall-clock authentication against the Bybit time endpoint.
Do not compare `seq` across unrelated sequence domains.
Do not rely on JSON object member order because the official product examples use different key ordering.

## Reconnect and recovery policy

Bybit does not document a replay token or session-resume cursor.
A disconnected consumer must create a new connection, authenticate when needed, subscribe again, and rebuild state.

### Public books

Wait for a fresh standard-book snapshot after reconnect.
Rebuild RPI state from its snapshot semantics or REST snapshot.
Rebuild Full Order Book through the documented subscribe, buffer, REST snapshot, align, and replay process.
Discard all book state tied to the old connection when sequence continuity cannot be established.

### Public non-book channels

Ticker and candle messages can establish current state after resubscription.
Trade and liquidation channels do not replay the disconnected interval.
Use REST trade history or other official historical endpoints when gap recovery matters.
Treat system status as advisory and retain local timers.

### Private state

Fetch current wallet, positions, open orders, and recent executions before trusting the new delta stream.
Subscribe to Order, full Execution, Position, and Wallet.
Deduplicate orders and fills by stable exchange identifiers.
Use `seq` and symbol for documented execution and position association.
Reconcile again after the first live batch because REST and subscription timing can race.

The private bootstrap sequence is an engineering inference based on the documented absence of a Wallet snapshot and the lack of replay.
It does not claim that Bybit offers atomic REST and WebSocket cutover.

## Recommended arbitrage feed set

### Discovery

Use `orderbook.1` when only top price and top quantity are needed for fast candidate detection.
Use `orderbook.50` directly when maintaining one book implementation is simpler than mixing Level 1 and deeper feeds.
Add an application heartbeat and connection timer.
Use `system.status` as an additional operational signal.

### Validation

Maintain at least depth 50 for each executable product.
Load and refresh Instrument Information.
Join the book with the exact account fee rate.
For derivatives, add ticker fields for mark, index, funding, open interest, funding interval, and caps.
Add `priceLimit` before order submission.
Include RPI depth only when it is available and relevant to the account's executable liquidity.

### Execution

Use private Order, full Execution, Position, and Wallet.
Use fast Execution only as a latency supplement.
Bootstrap and reconcile through REST.
Use WebSocket order entry only with unique request identifiers, current rate-limit headers, clock checks, and asynchronous final-state handling.
Add Spread or Request for Quote private topics only for those workflows.

Best bid and ask can discover a candidate.
Level 2 depth is required to estimate executable size and slippage.
Instrument, fee, funding, price-limit, and account data are required to validate the candidate.
Private order and fill data are required to manage live execution.

## Optional institutional Simple Binary Encoding

Simple Binary Encoding is available only through the eligible Market Maker WebSocket or Gateway program.
It is not the default public integration.

| Purpose | Path |
| --- | --- |
| Spot public Simple Binary Encoding | `/v5/public-sbe/spot` |
| Linear public Simple Binary Encoding | `/v5/public-sbe/linear` |
| Inverse public Simple Binary Encoding | `/v5/public-sbe/inverse` |
| Simple Binary Encoding order entry | `/v5/trade-sbe` |
| Simple Binary Encoding private data | `/v5/private-sbe` |

The wire format is little-endian and uses fixed schemas.
Timestamps can use microsecond precision.
Documented feeds include best bid and ask with RPI, Level 50 snapshot and delta, and public trades.
The program also supports order entry and fast order response.
The dedicated-host limits are 1,500 Spot connections and 3,000 combined futures connections.
An excess connection attempt can receive HTTP 429.
Prelaunch products do not publish until continuous trading.
The official changelog records Options fast order response support on 2026-07-21.

## Source ledger

All sources were retrieved on 2026-07-26.

| Official source | Supports |
| --- | --- |
| [V5 WebSocket Connect](https://bybit-exchange.github.io/docs/v5/ws/connect) | Global, testnet, regional endpoints, authentication, heartbeat, argument limits, and active time |
| [Demo Trading Service](https://bybit-exchange.github.io/docs/v5/demo) | Demo endpoint and unsupported WebSocket order entry |
| [WebSocket and API Rate Limits](https://bybit-exchange.github.io/docs/v5/rate-limit) | Connection, IP, account, and order-operation limits |
| [WebSocket Trade Guideline](https://bybit-exchange.github.io/docs/v5/websocket/trade/guideline) | Order entry, timestamps, batches, acknowledgments, limits, and errors |
| [Order Book](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook) | Standard depths, frequencies, snapshots, deltas, update identifiers, and cross-sequences |
| [RPI Order Book](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook-rpi) | RPI topic, schema, visibility, and timing |
| [RPI Order Book REST](https://bybit-exchange.github.io/docs/v5/market/rpi-orderbook) | RPI recovery snapshot |
| [Full Order Book](https://bybit-exchange.github.io/docs/v5/websocket/public/full-ob) | Release matrix, delta semantics, sequence rules, and synchronization |
| [Full Order Book REST](https://bybit-exchange.github.io/docs/v5/market/full-ob) | Full-depth snapshot and 10,000-level limit |
| [Ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker) | Product ticker frequencies and schemas |
| [Public Trade](https://bybit-exchange.github.io/docs/v5/websocket/public/trade) | Trade topic, batching, side, flags, time, and sequence |
| [Kline](https://bybit-exchange.github.io/docs/v5/websocket/public/kline) | Intervals, payload, close flag, and timing |
| [All Liquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation) | Current liquidation channel, side meaning, and deprecated predecessor |
| [Insurance Pool](https://bybit-exchange.github.io/docs/v5/websocket/public/insurance-pool) | Isolated insurance balances and shared-pool limitation |
| [Auto-Deleveraging Alert](https://bybit-exchange.github.io/docs/v5/websocket/public/adl-alert) | Alert topic, schema, and shared-balance timing |
| [Order Price Limit](https://bybit-exchange.github.io/docs/v5/websocket/public/order-price-limit) | Buy and sell limit topic and schema |
| [System Status](https://bybit-exchange.github.io/docs/v5/websocket/system/system-status) | System endpoint, event schema, EU host, and exclusions |
| [Spread Order Book](https://bybit-exchange.github.io/docs/v5/spread/websocket/public/orderbook) | Spread depth, timing, snapshot, and delta |
| [Spread Public Trade](https://bybit-exchange.github.io/docs/v5/spread/websocket/public/trade) | Spread trade schema |
| [Spread Ticker](https://bybit-exchange.github.io/docs/v5/spread/websocket/public/ticker) | Spread summary quote |
| [Request for Quote Public Transactions](https://bybit-exchange.github.io/docs/v5/rfq/websocket/public/public-transaction) | Public block-trade topic and legs |
| [Request for Quote Private Quotes](https://bybit-exchange.github.io/docs/v5/rfq/websocket/private/quote) | Private quote topic |
| [Request for Quote Private Transactions](https://bybit-exchange.github.io/docs/v5/rfq/websocket/private/transaction) | Private transaction topic |
| [Request for Quote Private Inquiries](https://bybit-exchange.github.io/docs/v5/rfq/websocket/private/inquiry) | Private Request for Quote topic |
| [Private Order](https://bybit-exchange.github.io/docs/v5/websocket/private/order) | Order topic, categories, race behavior, and fields |
| [Private Execution](https://bybit-exchange.github.io/docs/v5/websocket/private/execution) | Full fill, fee, sequence, and regional extra-fee fields |
| [Fast Execution](https://bybit-exchange.github.io/docs/v5/websocket/private/fast-execution) | Reduced low-latency fill schema |
| [Private Position](https://bybit-exchange.github.io/docs/v5/websocket/private/position) | Position topic, fields, emissions, and sequence |
| [Private Wallet](https://bybit-exchange.github.io/docs/v5/websocket/private/wallet) | Wallet schema, missing snapshot, and deprecated field |
| [Private Greeks](https://bybit-exchange.github.io/docs/v5/websocket/private/greek) | Aggregate options Greeks |
| [Disconnect Cancel All](https://bybit-exchange.github.io/docs/v5/websocket/private/dcp) | Institutional cancellation trigger |
| [Strategy](https://bybit-exchange.github.io/docs/v5/websocket/private/strategy) | Algorithmic strategy lifecycle |
| [Instrument Information](https://bybit-exchange.github.io/docs/v5/market/instrument) | REST metadata, pagination, symbols, and trading phase |
| [Server Time](https://bybit-exchange.github.io/docs/v5/market/time) | Clock synchronization |
| [Account Fee Rate](https://bybit-exchange.github.io/docs/v5/account/fee-rate) | Authenticated maker and taker rate |
| [Fee Group Information](https://bybit-exchange.github.io/docs/v5/market/fee-group-info) | Current Pro and market-maker groups |
| [Simple Binary Encoding Overview](https://bybit-exchange.github.io/docs/v5/sbe/sbe-basic-info) | Institutional endpoints, format, feeds, and limits |
| [V5 API Changelog](https://bybit-exchange.github.io/docs/changelog/v5) | Full Order Book launch, RPI history, fast execution, regional hosts, and Simple Binary Encoding changes |

## Known official documentation issues

The English connection page places the testnet hostname in the mainnet Request for Quote row.
The official Chinese and Taiwanese pages use the production hostname.

The Full Order Book introduction mentions Spot and contracts.
Its release matrix lists Spot production support but does not list futures production support on the retrieval date.

The ordinary partial-book page defines `u` and reset behavior without promising a consecutive update sequence.
Only the Full Order Book page explicitly defines its `u` as consecutive within a session.

The standard JSON order books publish no checksum.
Recovery must use the documented snapshot and sequence behavior rather than an invented checksum.
