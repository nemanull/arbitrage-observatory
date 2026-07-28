# Exchange WebSocket Comparison

**Status:** Done.

**Retrieved:** 2026-07-26.

## Purpose

This document compares the WebSocket interfaces of Binance, Bybit, OKX, Coinbase, and Kraken.
The detailed endpoints, schemas, payloads, and limits live in each exchange profile.
This comparison identifies the smallest reliable feed set for an arbitrage observatory.

## Detailed profiles

| Exchange | Source of record |
| --- | --- |
| Binance | [`websocket.md`](../profiles/binance/websocket.md) |
| Bybit | [`websocket.md`](../profiles/bybit/websocket.md) |
| OKX | [`websocket.md`](../profiles/okx/websocket.md) |
| Coinbase | [`websocket.md`](../profiles/coinbase/websocket.md) |
| Kraken | [`websocket.md`](../profiles/kraken/websocket.md) |

## Short answer

A best bid and ask feed is useful for finding candidate spreads.
It is not enough to establish that the spread is executable at a useful size.
The observatory also needs order-book depth, instrument metadata, fees, funding or borrowing costs, balances, and connection health.
A trading system additionally needs authenticated order, fill, balance, and position state.

The recommended pipeline is:

```text
top of book candidate
depth-based volume-weighted price
instrument and fee validation
funding and balance validation
order submission
private fill reconciliation
```

## Research stages

| Stage | Required data | Purpose |
| --- | --- | --- |
| Discovery | Best bid, best ask, best quantities, symbol, source time, and receive time | Find candidate cross-venue spreads cheaply. |
| Validation | Order-book depth, continuity health, instrument state, mark and index prices, funding, fees, balances, and transfer state | Estimate executable size, slippage, total cost, and venue readiness. |
| Execution | Private orders, fills, balances, positions, acknowledgements, and cancel controls | Track both legs and respond to partial or failed execution. |

## Primary endpoint comparison

| Exchange | Spot public | Derivatives public | Private and order path |
| --- | --- | --- | --- |
| Binance | `wss://stream.binance.com:9443` | Routed `wss://fstream.binance.com/public` and `/market`, plus `dstream.binance.com` for COIN-M | Product-specific private streams and separate Spot, USD-M, and COIN-M WebSocket APIs |
| Bybit | `wss://stream.bybit.com/v5/public/spot` | `/v5/public/linear`, `/inverse`, `/option`, `/spread`, and `/rfq` | `/v5/private` for state and `/v5/trade` for supported order operations |
| OKX | `wss://ws.okx.com:8443/ws/v5/public` | Public and business paths on the same regional host | `/ws/v5/private` carries state and order operations |
| Coinbase | `wss://advanced-trade-ws.coinbase.com` or Exchange feed | International uses `wss://ws-md.international.coinbase.com` | Feed-only private channels, with order entry through REST or FIX according to platform |
| Kraken | `wss://ws.kraken.com/v2` | `wss://futures.kraken.com/ws/v1` for international derivatives | Spot authenticated v2 supports orders, while international Futures WebSocket is streaming-only |

Regional hosts matter.
OKX publishes separate US and Australia and EEA WebSocket hosts.
Bybit publishes several regional host replacements.
Coinbase separates Advanced, Exchange, International, and Prime.
Binance separates Binance.com from Binance.US.
Kraken does not publish a United States futures WebSocket contract.

## Best bid and ask comparison

| Exchange | Preferred discovery feed | Important limitation |
| --- | --- | --- |
| Binance | `bookTicker` or eligible Spot SBE `bestBidAsk` | Spot JSON `bookTicker` has no event time and no deeper levels. |
| Bybit | `orderbook.1.<symbol>` for Spot, Linear, and Inverse | Spot ticker has no bid or ask, and standard books exclude RPI liquidity. |
| OKX | `bbo-tbt` | It is one-level snapshot data and organic BBO excludes RPI liquidity. |
| Coinbase | `level2` rather than ticker | Advanced and Exchange ticker are trade-triggered. |
| Kraken | Spot ticker with `event_trigger: "bbo"` or Futures full ticker | Spot quantity-only triggering is unspecified and Futures ticker is throttled to one second. |

Every one of these feeds can screen candidates.
None can calculate a multi-level fill curve.

## Depth and correctness comparison

| Exchange | Depth feed | Continuity | Checksum | Required rebuild |
| --- | --- | --- | --- | --- |
| Binance Spot | Diff depth plus REST snapshot | `U` and `u` alignment followed by consecutive update identifiers | None documented | Any gap, disconnect, or failed snapshot alignment |
| Binance Futures | Diff depth plus REST snapshot | First `U` and `u` alignment followed by `pu` equal to prior `u` | None documented | Any `pu` mismatch or disconnect |
| Bybit standard book | Snapshot and delta | `u` reset marker and cross-sequence `seq`, without a universal consecutive rule | None documented | Service reset, snapshot replacement, disconnect, or detected corruption |
| Bybit full book | REST snapshot plus delta stream | Consecutive session `u` with documented reset handling | None documented | Gap, reset, delisting, or rule change |
| OKX books | Snapshot and incremental updates | `prevSeqId` must equal prior `seqId` outside documented reset cases | Checksum field is fixed to zero since 2026-06-23 | Gap, invalid reset, or disconnect |
| Coinbase Advanced L2 | Snapshot and absolute quantity updates | Guaranteed delivery for the channel | None documented | Disconnect or malformed state |
| Coinbase Exchange L2 | Snapshot and updates | Guaranteed delivery for L2 | None documented | Disconnect |
| Coinbase Exchange L3 | Subscribe, queue, REST snapshot, then replay | Product sequence with gap and out-of-order handling | None documented | Unrecoverable gap or disconnect |
| Coinbase International L2 | Snapshot and absolute updates | Session sequence | None documented | Gap or reconnect |
| Coinbase Prime L2 | Snapshot and updates | Guaranteed delivery | None documented | Disconnect |
| Kraken Spot L2 | Snapshot and absolute updates | No numeric sequence | CRC32 on the top ten levels | Every checksum mismatch or disconnect |
| Kraken Futures L2 | Snapshot and single-level deltas | Sequence exists without a published contiguity algorithm | None documented | Conservative rebuild on disconnect, regression, or suspicious gap |

Order-book code cannot be shared by changing field names alone.
Each venue needs a small protocol-specific state machine.
The normalized output can still use one common book model after validation.

## Quantity semantics

| Exchange | Update quantity meaning | Zero quantity |
| --- | --- | --- |
| Binance | Absolute size at the price | Delete |
| Bybit | Absolute size at the price | Delete |
| OKX | Absolute size at the price | Delete |
| Coinbase | Absolute size for documented L2 channels | Delete |
| Kraken | Absolute size at the price | Delete |

This commonality simplifies the normalized book.
It does not remove the need for venue-specific snapshot and continuity logic.

## Multi-symbol subscription comparison

### Binance

```json
{
  "method": "SUBSCRIBE",
  "params": [
    "ethusdt@bookTicker",
    "btcusdt@bookTicker",
    "ethusdt@depth@100ms",
    "btcusdt@depth@100ms"
  ],
  "id": 1
}
```

Binance also supports combined URL streams.
USD-M requires the correct `/public` or `/market` routed path.

### Bybit

```json
{
  "op": "subscribe",
  "args": [
    "orderbook.50.ETHUSDT",
    "orderbook.50.BTCUSDT",
    "tickers.ETHUSDT",
    "tickers.BTCUSDT"
  ]
}
```

One connection belongs to one public product category.
Spot, Linear, Inverse, Options, Spread, and RFQ use separate endpoints.

### OKX

```json
{
  "id": "books-1",
  "op": "subscribe",
  "args": [
    {
      "channel": "books",
      "instId": "ETH-USDT"
    },
    {
      "channel": "books",
      "instId": "BTC-USDT"
    },
    {
      "channel": "funding-rate",
      "instId": "ETH-USDT-SWAP"
    }
  ]
}
```

Each argument receives its own acknowledgement.
Public, private, and business channels use separate paths.

### Coinbase Advanced

```json
{
  "type": "subscribe",
  "product_ids": [
    "ETH-USD",
    "BTC-USD"
  ],
  "channel": "level2"
}
```

Advanced accepts one channel per subscription message.
Send a separate message for heartbeats, ticker, or a private channel.

### Kraken Spot

```json
{
  "method": "subscribe",
  "params": {
    "channel": "book",
    "symbol": [
      "ETH/USD",
      "BTC/USD"
    ],
    "depth": 100,
    "snapshot": true
  },
  "req_id": 1
}
```

Kraken sends a separate acknowledgement for each symbol.
International Futures uses a `product_ids` array instead.

## Derivatives reference data

| Exchange | Mark and index | Funding | Instrument state |
| --- | --- | --- | --- |
| Binance | Mark-price and index streams | Mark-price stream contains rate and next time | `exchangeInfo` plus contract information stream |
| Bybit | Derivatives ticker contains mark and index | Ticker contains rate, interval, caps, and next time | REST instruments endpoint |
| OKX | Dedicated mark, index, and price-limit channels | Dedicated funding-rate channel | REST bootstrap plus public instruments changes |
| Coinbase | Platform-specific ticker and futures channels | International and eligible futures data | Status or products APIs according to platform |
| Kraken | Futures full ticker contains mark and index | Futures full ticker contains rate, prediction, and next time | Spot instrument stream and Futures REST metadata |

Funding intervals can change.
Use the transmitted next timestamp and interval rather than assuming eight hours.

## Private state coverage

| Exchange | Orders and fills | Balances and positions | Important caveat |
| --- | --- | --- | --- |
| Binance | Spot execution report and derivatives order-trade events | Account and position updates | Listen keys expire and connections have a 24-hour limit. |
| Bybit | Order, full execution, and fast execution | Wallet, position, and Greeks | Wallet has no initial snapshot and misses unrealized-profit-only changes. |
| OKX | Orders and gated fills | Account, positions, and combined balance and position | Fills omits several non-book execution types, so orders is mandatory. |
| Coinbase | Advanced user, Exchange user or full, International limitations, and Prime orders | Platform-specific user and Prime data | No general WebSocket order-entry API exists. |
| Kraken | Spot executions and Futures fills and orders | Spot balances and Futures balances and positions | Futures private sequences have no published replay algorithm. |

Bootstrap private state through REST whenever a channel lacks an initial snapshot.
Reconcile again after every disconnect.

## WebSocket order entry

| Exchange | WebSocket order entry | Required confirmation |
| --- | --- | --- |
| Binance | Spot, USD-M, and COIN-M request and response APIs | Private execution or order-trade event |
| Bybit | Spot, Linear, Inverse, and Options through `/v5/trade` | Private Order and Execution |
| OKX | Place, amend, cancel, and batch operations on private WebSocket | Private `orders` channel |
| Coinbase | No general order-entry WebSocket across the documented feeds | REST or FIX response plus private feed |
| Kraken | Spot v2 trading methods only | Spot `executions` |
| Kraken international Futures | No WebSocket order entry | REST response plus private Futures feeds |

An operation acknowledgement means accepted for processing.
It does not prove that the order is live, filled, or cancelled.

## Heartbeat and lifecycle comparison

| Exchange | Liveness mechanism | Forced lifecycle or idle rule |
| --- | --- | --- |
| Binance Spot | Server ping every 20 seconds | 24-hour maximum connection |
| Binance USD-M | Server ping every three minutes | 24-hour maximum connection |
| Bybit | Application ping recommended every 20 seconds | Default idle disconnect is about ten minutes |
| OKX | Literal text `ping` and `pong` when locally idle below 30 seconds | Planned upgrade notice about 60 seconds before reconnect |
| Coinbase | Heartbeat channels or messages vary by platform | Advanced sparse channels can close after 60 to 90 seconds without heartbeats |
| Kraken Spot | Automatic heartbeat plus application ping | Inactive connection closes after about one minute |
| Kraken Futures | Explicit heartbeat and WebSocket control ping | Ping at least every 60 seconds |

Reconnects must use jitter and venue-specific limits.
Planned connection rotation should overlap feeds only when account and connection limits allow it.

## Connection and subscription limits

| Exchange | Selected current limits |
| --- | --- |
| Binance Spot | 1,024 streams per connection, 5 incoming messages per second, and 300 attempts per 5 minutes per IP |
| Binance USD-M | 1,024 streams per connection and 10 incoming messages per second |
| Bybit | 500 handshakes per 5 minutes per IP per domain and 1,000 category connections per IP |
| OKX | 3 handshakes per second per IP, 480 control operations per hour per connection, and 64 KB combined arguments |
| Coinbase Advanced | Official pages conflict between 8 and 750 connections per second per IP, while both publish 8 unauthenticated messages per second per IP. |
| Coinbase International | 10 connection attempts per 30 seconds |
| Coinbase Prime | 750 connection attempts per 10 seconds per IP |
| Kraken Spot | About 150 reconnects per rolling 10 minutes per IP and no general published simultaneous cap |
| Kraken Futures | 100 concurrent connections and 100 requests per second per connection |

These values are operational ceilings, not targets.
Use fewer subscriptions per connection when message volume could cause backlog.
Use eight Advanced connection attempts per second until the applicable Coinbase account limit is confirmed.

## Symbol normalization

| Exchange | Examples | Main hazard |
| --- | --- | --- |
| Binance | `ETHUSDT`, lowercase stream `ethusdt`, pair `ETHUSDT`, and contract types | Host arrays can now merge USD-M and COIN-M data. |
| Bybit | `ETHUSDT`, option base coin topics, and combo symbols | Topic category changes symbol interpretation. |
| OKX | `ETH-USDT`, `ETH-USDT-SWAP`, dated futures, and option IDs | `instType`, family, and settlement asset must be retained. |
| Coinbase | `ETH-USD` and venue-specific product IDs | Similar product names exist across Exchange, International, CDE, and Prime. |
| Kraken | `BTC/USD`, `PF_XBTUSD`, options, and `BTC/USD:BTNL` | Spot uses BTC while international derivatives uses XBT. |

Never join venues by raw symbol text.
Normalize through instrument metadata and retain the original venue identifier.

## Timestamp normalization

| Exchange | Common source time |
| --- | --- |
| Binance | Milliseconds by default, optional Spot microseconds, and Spot SBE microseconds |
| Bybit | Millisecond system, engine, trade, and creation fields |
| OKX | Millisecond strings in most market and account fields |
| Coinbase | RFC 3339 strings and platform-specific sequence or event times |
| Kraken | Spot RFC 3339 with high precision and Futures epoch milliseconds |

Store source time, local monotonic receive time, and normalized UTC time.
Do not use wall-clock time alone to order messages received on different connections.

## Minimum recommended public feed set

| Exchange | Discovery | Validation additions |
| --- | --- | --- |
| Binance | `bookTicker` | Diff depth, snapshot, instrument rules, mark price, funding, and exact commission |
| Bybit | `orderbook.1` | Deeper order book, REST instruments, derivatives ticker, RPI book when eligible, and exact fee rate |
| OKX | `bbo-tbt` | `books`, instruments, funding, mark, index, price limit, and exact trade fee |
| Coinbase | `level2` | Status or products, heartbeats, futures reference data, and account fee tier |
| Kraken | Spot `ticker` BBO or Futures full ticker | Spot checksum book or Futures book, instruments, funding, and fee tier |

Trades are useful for market diagnostics and last-sale logic.
They are not required to reconstruct a price-level book when the depth protocol is healthy.
Candles are useful for research and monitoring.
They are not required for immediate arbitrage validation.

## Minimum private feed set for execution

| Exchange | Required private state |
| --- | --- |
| Binance | Order or execution events, balances, positions, configuration, and listen-key health |
| Bybit | Order, full Execution, Wallet, Position, and REST bootstrap |
| OKX | Orders, Account, Positions, and combined fast balance and position where needed |
| Coinbase | Platform user or Prime order state plus authenticated account reconciliation |
| Kraken Spot | Executions, Balances, and cancel-on-disconnect where appropriate |
| Kraken Futures | Fills, open orders, open positions, balances, and REST reconciliation |

Use faster reduced-field execution channels only as latency hints.
Retain the full fee-bearing execution channel for authoritative reconciliation.

## Cross-exchange safety rules

1. Reject a book that has not completed its venue-specific snapshot procedure.
2. Reject a book after any required sequence, checksum, or reset rule fails.
3. Reject stale data using source time and measured receive age.
4. Reject a candidate that lacks target-size depth.
5. Reject a candidate with unresolved instrument status, fee, or funding.
6. Do not place orders when the required private stream is unhealthy.
7. Use unique client order identifiers where the venue supports them.
8. Treat request acknowledgement and fill confirmation as different states.
9. Reconcile balances, positions, orders, and fills after reconnect.
10. Stop both-leg execution when one venue enters maintenance, cancel-only, or post-only state.

## Source ledger

| Exchange | Official source | Applies to | Retrieved | Verification |
| --- | --- | --- | --- | --- |
| Binance | [Spot WebSocket streams](https://developers.binance.com/en/docs/products/spot/web-socket-streams) | Spot subscriptions, limits, and depth recovery | 2026-07-26 | Published |
| Binance | [USD-M connection rules](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect) | Routed derivatives endpoints and lifecycle | 2026-07-26 | Published |
| Bybit | [V5 WebSocket connection](https://bybit-exchange.github.io/docs/v5/ws/connect) | Endpoints, authentication, heartbeat, and limits | 2026-07-26 | Published |
| Bybit | [V5 order book](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook) | Snapshot, delta, depth, and sequence fields | 2026-07-26 | Published |
| OKX | [API V5](https://www.okx.com/docs-v5/en/) | Endpoints, channels, orders, limits, and schemas | 2026-07-26 | Published |
| OKX | [2026 checksum change](https://www.okx.com/docs-v5/log_en/) | Checksum fixed to zero | 2026-07-26 | Published |
| Coinbase | [Advanced Trade WebSocket overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview) | Advanced endpoints and subscriptions | 2026-07-26 | Published |
| Coinbase | [Advanced Trade WebSocket rate limits for Coinbase App](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-rate-limits) | Eight-per-second Advanced connection and message limits | 2026-07-26 | Published |
| Coinbase | [Advanced Trade WebSocket rate limits for Coinbase Business](https://docs.cdp.coinbase.com/coinbase-business/advanced-trade-apis/websocket/websocket-rate-limits) | Conflicting 750-per-second Advanced connection limit | 2026-07-26 | Published with a conflict |
| Coinbase | [Exchange WebSocket overview](https://docs.cdp.coinbase.com/exchange/websocket-feed/overview) | Exchange endpoints and protocol | 2026-07-26 | Published |
| Coinbase | [International Exchange WebSocket](https://docs.cdp.coinbase.com/international-exchange/websocket-feed/overview) | International endpoint, authentication, and channels | 2026-07-26 | Published |
| Coinbase | [Prime WebSocket overview](https://docs.cdp.coinbase.com/prime/websocket-feed/overview) | Prime endpoint and connection limit | 2026-07-26 | Published |
| Kraken | [Spot WebSocket introduction](https://docs.kraken.com/exchange/guides/websockets/introduction) | Spot endpoints, symbols, time, and reconnect limits | 2026-07-26 | Published |
| Kraken | [Spot book checksum](https://docs.kraken.com/exchange/guides/websockets/book-checksum-v2) | CRC32 integrity | 2026-07-26 | Published |
| Kraken | [Futures WebSocket guide](https://docs.kraken.com/exchange/guides/futures/websockets) | Futures authentication and keepalive | 2026-07-26 | Published |

## Remaining production validation

- Capture real messages from every production account entity.
- Validate every documented JSON example against live schemas.
- Exercise gap, checksum, reconnect, and snapshot recovery with recorded traffic.
- Measure source-to-receive latency per channel and region.
- Confirm private-feed completeness for every execution type.
- Confirm current rate and connection limits from authenticated responses.
