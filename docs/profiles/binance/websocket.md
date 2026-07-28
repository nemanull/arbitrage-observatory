# Binance WebSocket Profile

Status: Done.

Retrieved: 2026-07-26.

This profile covers Binance.com Spot JSON and SBE streams, Spot WebSocket API, USD-M futures, COIN-M futures, TradFi perpetuals, Options, Margin, Portfolio Margin, Alpha, Stocks Trading, and Binance.US.
It separates public market data, private account events, and request and response order APIs.

## Direct answer

The user's ETHUSDT example uses the current integrated derivatives `bookTicker` schema:

```json
{
  "e": "bookTicker",
  "u": 11139947831981,
  "s": "ETHUSDT",
  "ps": "ETHUSDT",
  "b": "1943.64",
  "B": "113.445",
  "a": "1943.65",
  "A": "182.433",
  "T": 1785121247583,
  "E": 1785121247584,
  "st": 1
}
```

The fields mean:

| Field | Meaning |
| --- | --- |
| `e` | Event type. |
| `u` | Order book update identifier. |
| `s` | Contract symbol. |
| `ps` | Underlying pair. |
| `b` | Best bid price. |
| `B` | Best bid quantity. |
| `a` | Best ask price. |
| `A` | Best ask quantity. |
| `T` | Matching-engine transaction time in milliseconds. |
| `E` | Event generation time in milliseconds. |
| `st` | Integrated stream type, where `1` identifies USD-M and `2` identifies COIN-M. |

This event is USD-M because `st` is `1`.
A COIN-M event uses `st` value `2` and a COIN-M contract symbol such as `ETHUSD_PERP`.

The direct one-symbol USD-M URL is:

```text
wss://fstream.binance.com/public/ws/ethusdt@bookTicker
```

A direct two-symbol combined URL is:

```text
wss://fstream.binance.com/public/stream?streams=ethusdt@bookTicker/btcusdt@bookTicker
```

The same two streams can be added after connecting to the public endpoint:

```json
{
  "method": "SUBSCRIBE",
  "params": [
    "ethusdt@bookTicker",
    "btcusdt@bookTicker"
  ],
  "id": 1
}
```

`bookTicker` is enough to discover a possible top-of-book spread.
It is not enough to decide that an arbitrage is executable.
Use a sequenced depth book to estimate fill size and slippage.
Also use instrument rules, exact account fees, current funding or borrowing, balances, and private execution events.

## Connection matrix

| Product | Production endpoint | Test or demo endpoint | Purpose |
| --- | --- | --- | --- |
| Spot JSON raw | `wss://stream.binance.com:9443/ws/<stream>` | `wss://stream.testnet.binance.vision/ws/<stream>` | One public stream without an envelope. |
| Spot JSON combined | `wss://stream.binance.com:9443/stream?streams=<a>/<b>` | `wss://stream.testnet.binance.vision/stream?streams=<a>/<b>` | Multiple public streams with a stream envelope. |
| Spot market-only mirror | `wss://data-stream.binance.vision/ws/<stream>` | Not documented | Public market data without user data. |
| Spot SBE raw | `wss://stream-sbe.binance.com/ws/<stream>` | Not documented | Authenticated binary market data. |
| Spot WebSocket API | `wss://ws-api.binance.com:443/ws-api/v3` | `wss://ws-api.testnet.binance.vision/ws-api/v3` | Request and response market, account, and order methods. |
| USD-M public book | `wss://fstream.binance.com/public/ws/<stream>` | `wss://demo-fstream.binance.com/public/ws/<stream>` | High-frequency book data. |
| USD-M regular market | `wss://fstream.binance.com/market/ws/<stream>` | `wss://demo-fstream.binance.com/market/ws/<stream>` | Trades, prices, funding, candles, and liquidations. |
| USD-M private | `wss://fstream.binance.com/private/ws?<parameters>` | `wss://demo-fstream.binance.com/private/ws?<parameters>` | Account and order events. |
| USD-M WebSocket API | `wss://ws-fapi.binance.com/ws-fapi/v1` | `wss://testnet.binancefuture.com/ws-fapi/v1` | Order and account request and response methods. |
| COIN-M market | `wss://dstream.binance.com/ws/<stream>` | Product test endpoint in current documentation | Public COIN-M streams. |
| COIN-M WebSocket API | `wss://ws-dapi.binance.com/ws-dapi/v1` | `wss://testnet.binancefuture.com/ws-dapi/v1` | COIN-M order and account requests. |
| Options public | Routed `fstream` public and market paths | `wss://demo-fstream.binance.com/public/` and `/market/` | Options books and market state. |
| Options private | `wss://fstream.binance.com/private/ws/<listenKey>` | `wss://demo-fstream.binance.com/private/ws/<listenKey>` | Options account, order, balance, and risk events. |
| Cross Margin risk | `wss://margin-stream.binance.com/ws/<listenKey>` | Not documented | Margin level and liability events. |
| Portfolio Margin | `wss://fstream.binance.com/pm/ws/<listenKey>` | Not documented | Portfolio Margin private events. |
| Portfolio Margin Pro | `wss://fstream.binance.com/pm-classic/ws/<listenKey>` | Not documented | Portfolio Margin Pro risk and account events. |
| Alpha | `wss://nbstream.binance.com/w3w/wsa/stream` | Not documented | Alpha books, trades, tickers, and candles. |
| Stocks Trading | `wss://nbstream.binance.com/equity` | Not documented | Equity quotes, prices, calendars, status, and orders. |
| Binance.US market | `wss://stream.binance.us:9443/ws/<stream>` | No official testnet documented | Binance.US public and listen-key streams. |
| Binance.US WebSocket API | `wss://ws-api.binance.us:443/ws-api/v3` | No official testnet documented | Binance.US request and response API. |

Ports `443` and `9443` are available for the documented Binance.com Spot hosts.
Spot, Futures, Alpha, and Binance.US stream symbols are lowercase.
Stocks Trading uses uppercase bare equity symbols.

## Spot JSON market streams

### Raw and combined framing

A raw stream sends the event object directly.
A combined stream wraps it:

```json
{
  "stream": "ethusdt@bookTicker",
  "data": {
    "u": 400900217,
    "s": "ETHUSDT",
    "b": "1943.64",
    "B": "113.445",
    "a": "1943.65",
    "A": "182.433"
  }
}
```

Spot JSON `bookTicker` does not include an event time.
The `u` field is an order book update identifier.

Append `timeUnit=MICROSECOND` or `timeUnit=microsecond` to request microsecond timestamp fields where the stream supplies timestamps.
The default is milliseconds.

### Spot channel inventory

| Stream | Purpose | Typical push |
| --- | --- | --- |
| `<symbol>@bookTicker` | Best bid, best ask, and displayed quantities | Real time |
| `<symbol>@depth@100ms` | Incremental order book updates | 100 ms |
| `<symbol>@depth` | Incremental order book updates | 1 second |
| `<symbol>@depth5@100ms` | Top five snapshot | 100 ms |
| `<symbol>@depth10@100ms` | Top ten snapshot | 100 ms |
| `<symbol>@depth20@100ms` | Top twenty snapshot | 100 ms |
| `<symbol>@trade` | Every raw trade | Real time |
| `<symbol>@aggTrade` | Aggregated trades | Real time |
| `<symbol>@blockTrade` | Block trade events | Event-driven |
| `<symbol>@kline_<interval>` | UTC candle state | 1 or 2 seconds |
| `<symbol>@kline_<interval>@+08:00` | UTC+8 candle state | 1 or 2 seconds |
| `<symbol>@miniTicker` | One-symbol 24-hour rolling statistics | 1 second |
| `!miniTicker@arr` | Changed mini tickers for all symbols | 1 second |
| `<symbol>@ticker` | One-symbol full 24-hour statistics | 1 second |
| `<symbol>@ticker_<window>` | One-symbol rolling-window statistics | 1 second |
| `!ticker_<window>@arr` | Changed rolling-window tickers | 1 second |
| `<symbol>@avgPrice` | Average price | 1 second |
| `<symbol>@referencePrice` | Reference price state | Product-defined |

Supported candle intervals are `1s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `3d`, `1w`, and `1M`.
Rolling ticker windows are `1h`, `4h`, and `1d`.

### Spot single-symbol subscription

```json
{
  "method": "SUBSCRIBE",
  "params": [
    "ethusdt@bookTicker"
  ],
  "id": 1
}
```

The acknowledgement is:

```json
{
  "result": null,
  "id": 1
}
```

### Spot multi-symbol subscription

```json
{
  "method": "SUBSCRIBE",
  "params": [
    "ethusdt@bookTicker",
    "btcusdt@bookTicker",
    "ethusdt@depth@100ms",
    "btcusdt@depth@100ms"
  ],
  "id": 2
}
```

Subscriptions can be changed without reconnecting.
The supported control methods are `SUBSCRIBE`, `UNSUBSCRIBE`, `LIST_SUBSCRIPTIONS`, `SET_PROPERTY`, and `GET_PROPERTY`.
The `combined` property changes response framing.

### Spot depth payload

```json
{
  "e": "depthUpdate",
  "E": 1672515782136,
  "s": "ETHUSDT",
  "U": 157,
  "u": 160,
  "b": [
    [
      "1943.64",
      "113.445"
    ]
  ],
  "a": [
    [
      "1943.65",
      "0.000"
    ]
  ]
}
```

`U` is the first update identifier in the event.
`u` is the last update identifier.
Quantities are absolute values.
A zero quantity deletes the price level.

### Spot local order book recovery

1. Open the incremental depth stream and buffer events.
2. Request `GET /api/v3/depth?symbol=ETHUSDT&limit=5000`.
3. Restart the snapshot request while its `lastUpdateId` is lower than the first buffered `U`.
4. Discard buffered events where `u` is at or below the snapshot `lastUpdateId`.
5. Require the first accepted event to contain the snapshot identifier inside the inclusive `U` and `u` range.
6. Set each reported bid and ask quantity to the absolute value in the event.
7. Delete a level when the quantity is zero.
8. Require each later `U` to equal the prior local update identifier plus one.
9. Discard the book and restart when continuity fails.

The REST snapshot contains at most 5,000 levels on each side.
A level outside the snapshot remains unknown until a stream update changes it.
The Spot JSON protocol does not document a checksum.

### Spot session limits

| Rule | Current value |
| --- | --- |
| Maximum connection lifetime | 24 hours |
| Server ping interval | 20 seconds |
| Required matching pong deadline | 1 minute |
| Incoming messages | 5 per second |
| Streams per connection | 1,024 |
| Connection attempts | 300 per 5 minutes per IP |

The incoming-message count includes ping, pong, and subscription control frames.
An unsolicited pong does not keep the connection alive.
Binance can send `serverShutdown` before a planned close.

## Spot SBE market data

Spot SBE is a binary alternative for eligible clients.
The handshake requires an Ed25519 API key in the `X-MBX-APIKEY` header.
It does not require a request signature or timestamp.
The key's IP allowlist applies.

| Stream | Purpose | Push |
| --- | --- | --- |
| `<symbol>@bestBidAsk` | Best bid and ask with event time | Real time |
| `<symbol>@depth` | Incremental depth | 25 ms through 2026-08-03 and 20 ms from about 2026-08-04 |
| `<symbol>@depth20` | Top twenty book | 50 ms |
| `<symbol>@trade` | Individual trades | Real time |

The stream page already states 20 ms, but the 2026-07-17 change log schedules that reduction from 25 ms for 2026-08-04.
Before that effective time, treat 25 ms as current and verify live behavior during the rollout.

Market frames are SBE binary data.
Control acknowledgements and `serverShutdown` remain JSON.
Timestamps use microseconds.
The `bestBidAsk` stream can intentionally discard stale intermediate updates under load.
That behavior makes it useful for discovery, but it does not make it a depth feed.

Spot SBE uses the same 24-hour connection, ping, five-message, 1,024-stream, and connection-attempt limits as Spot JSON.

## Spot WebSocket API

The Spot WebSocket API is request and response oriented.
It supports market queries, account queries, order placement, order changes, sessions, and private event subscriptions.

A public request has this shape:

```json
{
  "id": "depth-1",
  "method": "depth",
  "params": {
    "symbol": "ETHUSDT",
    "limit": 100
  }
}
```

A response has `id`, `status`, `result` or `error`, and optional `rateLimits`.
Signed methods support HMAC, RSA, and Ed25519 keys.
Only Ed25519 supports `session.logon`.

An order timeout after ten seconds means that execution status is unknown.
The client must reconcile the private execution event and then query the order.

The endpoint has a 24-hour connection lifetime.
It uses the Spot 20-second ping and one-minute pong rule.
Connection establishment costs request weight.
The current request pools are returned by `exchangeInfo` and response `rateLimits`.
The displayed 6,000 weight per minute is an example rather than a permanent contract.

## Spot private user events

Current WebSocket API subscription methods are `userDataStream.subscribe`, `userDataStream.subscribe.signature`, `session.subscriptions`, and `userDataStream.unsubscribe`.
Private events are wrapped with a subscription identifier:

```json
{
  "subscriptionId": 0,
  "event": {
    "e": "executionReport",
    "E": 1499405658658,
    "s": "ETHUSDT",
    "c": "client-order-1",
    "S": "BUY",
    "o": "LIMIT",
    "q": "1.00000000",
    "p": "1940.00000000",
    "x": "TRADE",
    "X": "PARTIALLY_FILLED",
    "l": "0.25000000",
    "L": "1939.90000000",
    "n": "0.00025000",
    "N": "ETH",
    "T": 1499405658657
  }
}
```

Relevant event types are:

| Event | Purpose |
| --- | --- |
| `executionReport` | Order lifecycle, fills, commission, and rejection state |
| `outboundAccountPosition` | Changed balances after an account event |
| `balanceUpdate` | Deposit, withdrawal, or internal transfer delta |
| `listStatus` | Order-list state |
| `externalLockUpdate` | Externally locked balance state |
| `eventStreamTerminated` | Subscription termination |

The current documentation does not publish the legacy fixed user-subscription count as a current contract.

## USD-M public market data

Binance now routes USD-M traffic by data class.
The unrouted `fstream` URL receives public book data only.
The older unrouted architecture was decommissioned on 2026-04-23.

### USD-M public book channels

| Stream | Purpose |
| --- | --- |
| `<symbol>@bookTicker` | One-symbol best bid and ask |
| `!bookTicker` | All-symbol best bid and ask |
| `<symbol>@depth@<speed>` | Incremental depth |
| `<symbol>@depth<levels>@<speed>` | Partial depth |
| `<symbol>@rpiDepth@500ms` | Retail price-improvement depth |

### USD-M regular market channels

| Stream | Purpose |
| --- | --- |
| `<symbol>@aggTrade` | Aggregated executions |
| `<symbol>@markPrice` | Mark price, index price, funding rate, and next funding time |
| `!markPrice@arr` | All-symbol mark and funding state |
| `<pair>_<contractType>@continuousKline_<interval>` | Continuous-contract candle |
| `<symbol>@kline_<interval>` | Contract candle |
| `<symbol>@miniTicker` | One-symbol 24-hour compact ticker |
| `!miniTicker@arr` | All changed compact tickers |
| `<symbol>@ticker` | One-symbol full 24-hour ticker |
| `!ticker@arr` | All changed full tickers |
| `<symbol>@forceOrder` | One-symbol forced liquidation |
| `!forceOrder@arr` | All-market forced liquidations |
| `<symbol>@compositeIndex` | Composite index components |
| `!contractInfo` | Contract listing and rule state |
| `!assetIndex@arr` | Asset Index state, including COIN-M settlement-asset entries |
| `tradingSession` | TradFi and session state |

The mark-price stream is required to observe funding and liquidation reference state.
TradFi perpetuals use the USD-M endpoints.
Their trading-session and index behavior should be normalized separately.

### USD-M mark-price example

```json
{
  "e": "markPriceUpdate",
  "E": 1562305380000,
  "s": "ETHUSDT",
  "p": "1943.65000000",
  "ap": "1943.62000000",
  "i": "1943.59000000",
  "P": "1943.61000000",
  "r": "0.00010000",
  "T": 1562306400000,
  "st": 1
}
```

`p` is mark price.
`ap` is the mark-price moving average.
`i` is index price.
`P` is estimated settlement price when applicable.
`r` is the current funding rate.
`T` is the next funding time in milliseconds.
`st` identifies USD-M or COIN-M after the integration.

### USD-M local order book recovery

1. Open the diff-depth stream and buffer events.
2. Request `GET /fapi/v1/depth?symbol=ETHUSDT&limit=1000`.
3. Discard events whose final `u` is below the snapshot identifier.
4. Require the first accepted event to span the snapshot identifier inside `U` and `u`.
5. Set quantities as absolute values and delete zero levels.
6. Require every later event's `pu` to equal the prior event's `u`.
7. Discard and rebuild on any mismatch.

The futures JSON book does not document a checksum.

### USD-M session limits

| Rule | Current value |
| --- | --- |
| Maximum connection lifetime | 24 hours |
| Server ping interval | 3 minutes |
| Pong deadline | 10 minutes |
| Incoming messages | 10 per second |
| Streams per connection | 1,024 |

## USD-M private data and WebSocket API

A private stream can select event classes:

```text
wss://fstream.binance.com/private/ws?listenKey=<key>&events=ORDER_TRADE_UPDATE/ACCOUNT_UPDATE
```

The listen key lasts 60 minutes and must be renewed.
The WebSocket connection lasts no more than 24 hours.

Relevant events are:

| Event | Purpose |
| --- | --- |
| `ORDER_TRADE_UPDATE` | Order state, fill state, role, prices, quantities, and commission context |
| `TRADE_LITE` | Lower-payload execution signal |
| `ACCOUNT_UPDATE` | Wallet, balance, margin, and position changes |
| `MARGIN_CALL` | Risk warning |
| `ACCOUNT_CONFIG_UPDATE` | Leverage and configuration changes |
| `ALGO_UPDATE` | Conditional and algo order state plus rejection context |
| `STRATEGY_UPDATE` | Strategy state |
| `listenKeyExpired` | Private stream expiry |

`CONDITIONAL_ORDER_TRIGGER_REJECT` was deprecated effective 2025-12-15.

Use `wss://ws-fapi.binance.com/ws-fapi/v1` for request and response order operations.
The WebSocket API is separate from the private event connection.
The connection lasts 24 hours.
The handshake costs five request-weight units.
Current displayed pools include 2,400 weight per minute, 300 orders per 10 seconds, and 1,200 orders per minute.
The client must inspect returned limits instead of treating those examples as permanent.

An acknowledgement does not replace `ORDER_TRADE_UPDATE`.
The private event is authoritative for the order lifecycle.

## COIN-M market data

COIN-M uses `dstream.binance.com`.
Raw and combined routes use the same `/ws/<stream>` and `/stream?streams=<a>/<b>` forms.

| Stream | Purpose |
| --- | --- |
| `<symbol>@bookTicker` | One-symbol best bid and ask |
| `!bookTicker` | All-symbol best bid and ask |
| `<symbol>@depth@<speed>` | Incremental depth |
| `<symbol>@depth<levels>@<speed>` | Partial depth |
| `<symbol>@aggTrade` | Aggregated trades |
| `<symbol>@forceOrder` | Forced liquidation |
| `!forceOrder@arr` | All forced liquidations |
| `<symbol>@miniTicker` | Compact ticker |
| `!miniTicker@arr` | All compact tickers |
| `<symbol>@ticker` | Full ticker |
| `!ticker@arr` | All full tickers |
| `<pair>_<contractType>@continuousKline_<interval>` | Continuous-contract candle |
| `!contractInfo` | Contract metadata changes |
| `<pair>@indexPriceKline_<interval>` | Index candle |
| `<pair>@indexPrice` | Index price at 1,000 ms |
| `<symbol>@kline_<interval>` | Contract candle |
| `<symbol>@markPriceKline_<interval>` | Mark-price candle |
| `<pair>@markPrice@<speed>` | Pair mark and funding state |
| `<symbol>@markPrice@<speed>` | Contract mark and funding state |

The June 2026 USD-M and COIN-M integration merges all-market arrays across both product types.
Selected single-symbol streams expose `ps`.
The `st` field distinguishes USD-M value `1` from COIN-M value `2`.
Consumers must not assume that an all-market array from one host contains only that host's legacy product family.
Both hosts accept the documented USD-M and COIN-M mark-price and kline families after integration.

COIN-M local book recovery uses `GET /dapi/v1/depth`.
It uses the futures `U`, `u`, and `pu` chain.
The client must rebuild when `pu` does not equal the prior `u`.

The documented private legacy path is `wss://dstream.binance.com/ws/<listenKey>`.
The key lasts 60 minutes and the connection lasts 24 hours.
For the same event type on one connection, both `T` and `E` are ordered.
Use `E` when comparing different event types or services.
Private events include margin, account, order, configuration, algo, strategy, and expiry events.

Use `wss://ws-dapi.binance.com/ws-dapi/v1` for COIN-M request and response operations.
REST and WebSocket API requests on USD-M and COIN-M share the documented 2,400 weight per minute, 300 orders per 10 seconds, and 1,200 orders per minute pools.
The current generated COIN-M market-stream catalog does not separately state fixed connection message or stream-count limits.
Do not infer the USD-M market-stream limits for COIN-M.

## Options

Options uses the routed `fstream` architecture for public, market, and private traffic.

| Stream | Purpose |
| --- | --- |
| `!index@arr` | All underlying index prices |
| `<symbol>@kline_<interval>` | Option candle |
| `<underlying>@optionMarkPrice` | Mark price and Greeks |
| `!optionSymbol` | Option symbol state |
| `<underlying>@openInterest@<expiry>` | Open interest |
| `<symbol>@depth@<speed>` | Incremental depth |
| `<symbol>@depth<level>@<speed>` | Partial depth |
| `<symbol>@bookTicker` | Best bid and ask |
| `<symbol>@optionTicker<expiry>` | Option ticker |
| `<symbol>@optionTrade` | Option trades |

Private events include `ACCOUNT_UPDATE`, `BALANCE_POSITION_UPDATE`, `ORDER_TRADE_UPDATE`, `GREEK_UPDATE`, `RISK_LEVEL_CHANGE`, and `listenKeyExpired`.
The private listen key lasts 60 minutes.
The connection lasts 24 hours.
The current Options catalog exposes REST plus streams and does not expose a separate request and response order WebSocket API.
Current generated pages do not state a separate fixed Options stream-count or message-rate limit.

## Margin and Portfolio Margin private feeds

The old Margin listen-key trade stream is deprecated.
The replacement flow creates a listen token through `POST /sapi/v1/userListenToken`.
The token can represent cross or isolated margin and lasts up to 24 hours.
Subscribe through the Spot WebSocket API method `userDataStream.subscribe.listenToken`.
Renew the token before expiry.

The Cross Margin risk stream emits:

| Event | Purpose |
| --- | --- |
| `MARGIN_LEVEL_STATUS_CHANGE` | Risk level transition |
| `USER_LIABILITY_CHANGE` | Borrow, repayment, and hourly interest changes |

Portfolio Margin uses the `/pm/ws/<listenKey>` path.
Its listen key lasts 60 minutes and its connection lasts 24 hours.
Portfolio Margin publishes `ACCOUNT_UPDATE`, `ORDER_TRADE_UPDATE`, `ACCOUNT_CONFIG_UPDATE`, `CONDITIONAL_ORDER_TRADE_UPDATE`, `balanceUpdate`, `executionReport`, `outboundAccountPosition`, `liabilityChange`, `openOrderLoss`, `RISK_LEVEL_CHANGE`, `ALGO_UPDATE`, and `listenKeyExpired`.
Portfolio Margin Pro uses `/pm-classic/ws/<listenKey>`.
The Pro feed adds `RISK_LEVEL_CHANGE` and `PM_PRO_ACCOUNT_UPDATE`.
The latter is documented at about five-second cadence.

## Alpha

Alpha uses a separate `nbstream` service.
It supports raw paths, combined paths, and control-message subscriptions.

| Stream | Purpose |
| --- | --- |
| `<symbol>@bookTicker` | One-symbol best bid and ask |
| `!bookTicker` | All-symbol best bid and ask |
| `<symbol>@depth<5,10,20>@<speed>` | UI-visible partial book |
| `<symbol>@fulldepth@<speed>` | UI and API full-depth changes |
| `<symbol>@trade` | Raw trade |
| `<symbol>@aggTrade` | Aggregated trade |
| `<symbol>@kline_<interval>` | Symbol candle |
| `came@<contractAddress>@<chainId>@kline_<interval>` | Contract-address candle |
| `<symbol>@miniTicker` | Compact ticker |
| `!miniTicker@arr` | All compact tickers |
| `<symbol>@ticker` | Full ticker |
| `!ticker@arr` | All full tickers |
| `came@allTokens@ticker24` | All-token 24-hour ticker |

Alpha depth exposes `U`, `u`, and `pu`.
The current Alpha documentation does not publish a complete snapshot recovery algorithm, checksum, lifecycle, fixed limits, authentication rule, or testnet.
Treat those properties as unresolved instead of inheriting Spot limits.

## Stocks Trading

Stocks Trading uses the `/equity` service.
This service is one-way push and does not support control-message subscriptions.

| Path | Purpose |
| --- | --- |
| `/ws/price` | General price stream |
| `/ws/<symbol>@quote` | Equity quote |
| `/ws/<symbol>@kline_<interval>` | Equity candle |
| `/ws/calendar` | Market calendar |
| `/ws/<symbol>@tradability` | Symbol eligibility |
| `/ws/<symbol>@tradingStatus` | Trading state |
| `/ws/<listenKey>@orderReport` | Private order report |

An official combined two-symbol URL is:

```text
wss://nbstream.binance.com/equity/stream?streams=AAPL@quote/NVDA@quote/price
```

Create and renew the order-report key with `/sapi/v1/equity/listenKey`.
The order-report listen key lasts 60 minutes and must be renewed.
The server uses standard ping and pong frames but publishes no fixed ping interval.
The current documentation does not publish a fixed maximum socket lifetime, message-rate limit, stream-count limit, or testnet.

## Binance.US

Binance.US market streams use the same raw and combined URL model as legacy Binance Spot.
Stream names are lowercase.

| Stream | Purpose |
| --- | --- |
| `<symbol>@bookTicker` | Individual best bid and ask |
| `<symbol>@depth@100ms` | Incremental depth |
| `<symbol>@depth` | One-second incremental depth |
| `<symbol>@depth5`, `@depth10`, `@depth20` | Partial depth |
| `<symbol>@trade` | Raw trade |
| `<symbol>@aggTrade` | Aggregated trade |
| `<symbol>@kline_<interval>` | Candle |
| `<symbol>@ticker` | Full 24-hour ticker |
| `!ticker@arr` | All changed full tickers |
| `<symbol>@miniTicker` | Compact ticker |
| `!miniTicker@arr` | All changed compact tickers |
| `<symbol>@ticker_<window>` | Rolling ticker |
| `!ticker_<window-size>@arr` | Changed rolling tickers for all symbols |

The all-symbol `!bookTicker` stream was removed.
Subscribe to individual `bookTicker` streams.
Rolling ticker windows are `1h` and `4h`.

The connection lasts 24 hours.
The server pings every three minutes and expects a pong within ten minutes.
The incoming limit is five messages per second.
The stream limit is 1,024 per connection.

To recover a Binance.US local book, buffer diff-depth events and request `https://www.binance.us/api/v1/depth?symbol=<symbol>&limit=1000`.
Discard events whose `u` is at or below `lastUpdateId`, then require the first event to span `lastUpdateId + 1`.
Each later `U` must equal the prior `u + 1`, and any mismatch requires a rebuild.

Private streams use a 60-minute REST listen key.
Renewal is recommended every 30 minutes.
Private events include `executionReport`, `outboundAccountPosition`, `balanceUpdate`, and `listStatus`.

The request and response API is `wss://ws-api.binance.us:443/ws-api/v3`.
Its rate limits are dynamic and should be read from `exchangeInfo`.
No official Binance.US testnet or derivatives feed is documented.

## Symbols, clocks, and numerical types

Spot, Futures, Alpha, and Binance.US stream symbols use lowercase.
Stocks Trading uses uppercase bare equity symbols.
Payload symbols are normally uppercase.
Do not derive a contract family only from string suffixes when metadata is available.
Use Spot `exchangeInfo`, futures `exchangeInfo`, and contract information streams.

Preserve all prices, quantities, rates, commissions, and contract multipliers as decimal strings.
Do not convert them through binary floating point.

| Field family | Meaning |
| --- | --- |
| `E` | Event generation time |
| `T` | Transaction, trade, or next funding time according to the event schema |
| `u` | Final update identifier or current update identifier |
| `U` | First update identifier in a depth event |
| `pu` | Previous event's final update identifier in futures and selected Alpha streams |
| `ps` | Underlying pair on integrated derivatives events |
| `st` | USD-M or COIN-M stream type on integrated events |

Timestamp units default to milliseconds on JSON APIs unless the endpoint documents a different unit or the Spot microsecond option is enabled.
SBE market timestamps use microseconds.
Clock synchronization and measured receive time are required for latency analysis.

## What the observatory needs

### Candidate discovery

Use one top-of-book source per product.
JSON `bookTicker` is the simplest default.
Spot SBE `bestBidAsk` is a lower-latency option for eligible clients.
Also ingest mark price, index price, and funding state for perpetuals.

This layer can answer only whether a visible top-level spread might exist.

### Opportunity validation

Maintain a sequenced local depth book for each candidate symbol.
Calculate a volume-weighted executable price for the intended size.
Reject the book after a gap, reset, stale timestamp, crossed state, or failed snapshot alignment.

Also load:

- Instrument status, tick size, step size, minimum notional, and contract multiplier.
- Authenticated maker and taker commission for the exact account and symbol.
- Current promotion and BNB fee-payment state.
- Current funding interval, funding rate, borrow rate, and liquidation parameters.
- Available account balances and collateral.
- Deposit, withdrawal, and network constraints for transfer-based strategies.

### Execution and reconciliation

Use the product's request and response order API where available.
Use deterministic client order identifiers.
Treat a request acknowledgement as transport acceptance rather than a fill.
Reconcile every order through the private order and execution stream.
Record actual fill price, quantity, maker or taker role, commission amount, and commission asset.

After an unknown timeout, inspect private events and query the order before retrying.
Stop execution when the public book has a gap or the private stream is unavailable.
Options currently needs REST order entry plus private streams.

## Why top of book is not enough

`bookTicker` contains only one price and displayed quantity per side.
It cannot show the executable curve behind that level.
It cannot estimate multi-level slippage.
It cannot reveal queue position or whether the displayed size will still exist after network and matching latency.
It cannot validate instrument filters, account fees, funding, borrow cost, balances, or transfer costs.
It cannot reconcile an order or fill.
USD-M `bookTicker` and normal depth omit RPI orders.
Use `rpiDepth@500ms` separately when RPI liquidity matters.

The update identifier is useful freshness metadata.
It cannot reconstruct a full book by itself.
The documented Spot and futures JSON book streams do not publish a checksum.

Use top of book to reduce the search space.
Use depth and account state to decide.
Use private execution events to know what happened.

## Recovery state machine

1. Connect to the correct product and routing path.
2. Subscribe to the required book, trade, price, and private channels.
3. Buffer public depth deltas while requesting the correct REST snapshot.
4. Align the snapshot with the product's documented update identifiers.
5. Apply absolute quantities and delete zero levels.
6. Reject any continuity failure.
7. Reconnect before the 24-hour limit with connection overlap where permitted.
8. Renew listen keys before expiry.
9. Bootstrap balances, positions, and open orders through REST after reconnect.
10. Reconcile buffered private events with the bootstrap state.
11. Resume opportunity validation only after every required feed is healthy.

There is no documented general replay token.
A disconnect requires a new subscription and state reconstruction.

## Source ledger

Every source below was retrieved on 2026-07-26.

| Official source | Applies to | Supports |
| --- | --- | --- |
| [Spot WebSocket streams](https://developers.binance.com/en/docs/products/spot/web-socket-streams) | Binance.com Spot JSON | Endpoints, framing, channels, limits, payloads, and depth recovery |
| [Spot change log](https://developers.binance.com/en/docs/products/spot/CHANGELOG) | Binance.com Spot | Current stream removals, SBE timing, and user-event changes |
| [Spot testnet WebSocket streams](https://developers.binance.com/zh-CN/docs/products/spot/testnet/web-socket-streams) | Binance Spot testnet | Test endpoints and protocol parity |
| [Spot SBE market data streams](https://developers.binance.com/en/docs/products/spot/sbe-market-data-streams) | Binance.com Spot SBE | Authentication, schema, timing, and channel inventory |
| [Spot WebSocket API](https://developers.binance.com/en/docs/products/spot/web-socket-api) | Binance.com Spot request API | Request, account, order, and subscription methods |
| [Spot user data stream](https://developers.binance.com/en/docs/products/spot/user-data-stream) | Binance.com Spot private state | Account, order, balance, and list events |
| [USD-M stream connection rules](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect) | Binance.com USD-M | Routed endpoints, framing, lifecycle, and limits |
| [USD-M and derivatives change log](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/change-log) | Binance.com USD-M and Options | Current events, integration dates, and deprecations |
| [USD-M routed architecture notice](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice) | Binance.com USD-M | Public and market route split |
| [USD-M local order book](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly) | Binance.com USD-M | Snapshot alignment, sequence chain, and rebuild rules |
| [USD-M WebSocket API](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-api-general-info) | Binance.com USD-M order API | Order operations, connection rules, and returned limits |
| [COIN-M market stream catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-coin-m-futures/api/ws-streams/~) | Binance.com COIN-M | Endpoint and public channel catalog |
| [USD-M and COIN-M integration notice](https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/Important-CM-UM-Integration-Notice) | Binance.com Futures | Merged arrays, supported streams, `ps`, and `st` |
| [COIN-M private streams](https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/user-data-streams) | Binance.com COIN-M | Listen-key path, lifecycle, and event ordering |
| [COIN-M WebSocket API](https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/websocket-api-general-info) | Binance.com COIN-M order API | Request and response operations |
| [Options general information](https://developers.binance.com/en/docs/products/derivatives-trading-options/general-info) | Binance.com Options | Routed public endpoints and session behavior |
| [Options user data streams](https://developers.binance.com/en/docs/products/derivatives-trading-options/user-data-streams) | Binance.com Options | Private balance, order, position, and risk events |
| [Deprecated Margin trade stream](https://developers.binance.com/en/docs/products/margin-trading/trade-data-stream) | Binance.com Margin | Legacy stream boundary |
| [Margin listen-token data stream](https://developers.binance.com/en/docs/products/margin-trading/listen-token-data-stream) | Binance.com Margin | Current private listen-token state |
| [Cross Margin risk stream](https://developers.binance.com/en/docs/products/margin-trading/risk-data-stream) | Binance.com Cross Margin | Risk endpoint and liability events |
| [Portfolio Margin user stream](https://developers.binance.com/en/docs/products/derivatives-trading-portfolio-margin/user-data-streams) | Binance.com Portfolio Margin | Private endpoint and event inventory |
| [Portfolio Margin Pro user stream](https://developers.binance.com/en/docs/products/derivatives-trading-portfolio-margin-pro/user-data-streams) | Binance.com Portfolio Margin Pro | Private endpoint and event inventory |
| [Alpha market streams](https://developers.binance.com/en/docs/catalog/advanced-trading-alpha-trading/api/ws-streams/~) | Binance Alpha | Endpoint, subscriptions, and channel inventory |
| [Stocks Trading WebSocket general information](https://developers.binance.com/en/docs/products/stocks/websocket-streams-general-info) | Binance Stocks Trading | Endpoint, symbols, state, and order events |
| [Binance developer catalog](https://developers.binance.com/en/docs/catalog) | Binance products | Current product and API inventory |
| [Binance machine-readable documentation](https://developers.binance.com/en/docs/llms.txt) | Binance products | Documentation inventory used to check coverage |
| [Binance.US API documentation](https://docs.binance.us/) | Binance.US | Endpoint, streams, limits, and recovery rules |

## Production validation

The following work requires live connections or production accounts and remains outside this documentation-only research:

- Confirm production endpoint reachability from the deployment region.
- Confirm current routed paths with production accounts.
- Verify every symbol's instrument metadata and contract family.
- Exercise snapshot and gap recovery on recorded streams.
- Confirm private listen-key renewal and reconnect behavior.
