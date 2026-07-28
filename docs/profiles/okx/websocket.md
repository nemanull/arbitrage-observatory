# OKX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-07-26.

## Scope

OKX separates WebSocket traffic into public, private, and business paths.
It also publishes different production and demo hosts for global, United States and Australia, and EEA account stacks.
This profile covers market data, account data, and WebSocket order entry that can affect arbitrage discovery, validation, execution, and recovery.

The profile uses the current API V5 documentation and changelog.
Older SDK examples can contain obsolete checksum logic, obsolete VIP gates, legacy order identifiers, or older connection limits.

## Direct answer

The fastest documented public best bid and ask channel is `bbo-tbt`.
It sends one book level on change with a nominal 10 millisecond cadence.
The richer `tickers` channel also carries best prices and sizes, but it can update at a nominal 100 millisecond cadence and includes trade and 24-hour statistics.

A BBO feed is sufficient to discover a candidate spread.
A BBO feed is not sufficient to estimate executable profit for more than the displayed top-level quantity.
An arbitrage validator needs Level 2 depth to calculate size-weighted execution price, slippage, and book exhaustion.
Use `books` when public 400-level depth at 100 milliseconds is sufficient.
Use `books50-l2-tbt` or `books-l2-tbt` when the account is VIP4 or higher and needs 10 millisecond depth.
Use `books-rpi` only when the strategy understands RPI access, hidden liquidity, organic priority, and the five millisecond RPI taker speed bump.

## Regional endpoint matrix

Every host uses one of the paths `/ws/v5/public`, `/ws/v5/private`, or `/ws/v5/business`.

| Account stack | Environment | Public endpoint | Private endpoint | Business endpoint |
| --- | --- | --- | --- | --- |
| Global | Production | `wss://ws.okx.com:8443/ws/v5/public` | `wss://ws.okx.com:8443/ws/v5/private` | `wss://ws.okx.com:8443/ws/v5/business` |
| Global | Demo | `wss://wspap.okx.com:8443/ws/v5/public` | `wss://wspap.okx.com:8443/ws/v5/private` | `wss://wspap.okx.com:8443/ws/v5/business` |
| United States and Australia | Production | `wss://wsus.okx.com:8443/ws/v5/public` | `wss://wsus.okx.com:8443/ws/v5/private` | `wss://wsus.okx.com:8443/ws/v5/business` |
| United States and Australia | Demo | `wss://wsuspap.okx.com:8443/ws/v5/public` | `wss://wsuspap.okx.com:8443/ws/v5/private` | `wss://wsuspap.okx.com:8443/ws/v5/business` |
| EEA | Production | `wss://wseea.okx.com:8443/ws/v5/public` | `wss://wseea.okx.com:8443/ws/v5/private` | `wss://wseea.okx.com:8443/ws/v5/business` |
| EEA | Demo | `wss://wseeapap.okx.com:8443/ws/v5/public` | `wss://wseeapap.okx.com:8443/ws/v5/private` | `wss://wseeapap.okx.com:8443/ws/v5/business` |

The Turkey API documentation currently shows the global `ws.okx.com` WebSocket host even though its REST host is regional.
No undocumented regional WebSocket host should be inferred.
An implementation should use the host shown by the documentation and account environment for its own legal entity.

## Endpoint guide

The public path carries unauthenticated market data.
Some premium public-path channels require login before subscription.
The private path carries account, order, fill, balance, position, and risk state.
The business path carries candles, all-trades data, and some authenticated strategy channels.

| Path | Typical use | Login |
| --- | --- | --- |
| `/ws/v5/public` | Books, tickers, trades, instruments, funding, mark, index, open interest, limits, liquidations, and status | Not normally required. |
| `/ws/v5/private` | Orders, fills, account, positions, combined balances and positions, Greeks, and liquidation warnings | Required. |
| `/ws/v5/business` | Candles, unaggregated trades, and strategy or algo channels | Depends on the channel. |

## Instrument identifiers

| Product | Example |
| --- | --- |
| Spot | `BTC-USDT` |
| Perpetual swap | `BTC-USDT-SWAP` |
| Expiry future | `BTC-USD-261225` |
| Option | `BTC-USD-261225-50000-C` |
| Event contract | The current event market identifier from the instruments endpoint. |

Instrument types include `SPOT`, `MARGIN`, `SWAP`, `FUTURES`, `OPTION`, `EVENTS`, and `ANY` where the channel permits them.
Futures, swaps, and options can use `instFamily`.
Event instruments can require `seriesId`.
Order entry now uses the numeric `instIdCode` mapping published by the instruments interface.
The 2026-03-26 changelog says `instId` is ignored for WebSocket place-order and batch-place-order requests.

## Connection lifecycle

### Open and subscribe

OKX permits three WebSocket connection handshakes per second per IP.
The client should send login when the selected channel requires it.
The client should then send one or more subscription requests.
Each subscription argument receives its own acknowledgement.

### Heartbeat

If no message arrives before a local timer shorter than 30 seconds, send the literal text frame `ping`.
The server should answer with the literal text frame `pong`.
Reconnect when the expected response does not arrive.
Receiving normal data should reset the local inactivity timer.

### Planned maintenance

The server can send an event named `notice`.
Code `64008` announces a service upgrade about 60 seconds before interruption.
The client should open a replacement connection, authenticate it, rebuild subscriptions, verify snapshots, and retire the old connection only after the replacement is ready.

### Reconnect

A new connection has no inherited authentication, subscriptions, order-book state, or private state.
Authenticate again when required.
Resubscribe to every channel.
Rebuild every order book from a new snapshot.
Reconcile orders, positions, and balances through authenticated REST before resuming automated execution.

## Authentication

Login uses the API key, passphrase, epoch-seconds timestamp, and a Base64-encoded HMAC SHA-256 signature.

```text
prehash = timestamp + "GET" + "/users/self/verify"
sign = Base64(HMAC-SHA256(secret, prehash))
```

The login request expires 30 seconds after its timestamp.
The client should obtain server time when local clock error can exceed that window.

```json
{
  "op": "login",
  "args": [
    {
      "apiKey": "API_KEY",
      "passphrase": "PASSPHRASE",
      "timestamp": "1785096000",
      "sign": "BASE64_HMAC_SIGNATURE"
    }
  ]
}
```

A successful login acknowledgement uses `event` equal to `login` and `code` equal to `0`.
Login failure can use code `60009`.
Only a successful login counts as API-key activity for the inactivity rule.
An unbound trade or withdrawal key can expire after 14 days without qualifying activity.
Demo keys do not use that inactivity expiry.

## Subscription protocol

### One-symbol subscription

```json
{
  "id": "book-one",
  "op": "subscribe",
  "args": [
    {
      "channel": "books",
      "instId": "BTC-USDT"
    }
  ]
}
```

### Multi-symbol subscription

OKX represents multiple symbols as multiple argument objects in one request.

```json
{
  "id": "book-many",
  "op": "subscribe",
  "args": [
    {
      "channel": "books",
      "instId": "BTC-USDT"
    },
    {
      "channel": "books",
      "instId": "ETH-USDT"
    },
    {
      "channel": "funding-rate",
      "instId": "BTC-USDT-SWAP"
    },
    {
      "channel": "funding-rate",
      "instId": "ETH-USDT-SWAP"
    }
  ]
}
```

### Unsubscribe

Unsubscribe with the same argument identity.

```json
{
  "id": "book-stop",
  "op": "unsubscribe",
  "args": [
    {
      "channel": "books",
      "instId": "BTC-USDT"
    }
  ]
}
```

### Subscription acknowledgement

```json
{
  "id": "book-one",
  "event": "subscribe",
  "arg": {
    "channel": "books",
    "instId": "BTC-USDT"
  },
  "connId": "a4d3ae55"
}
```

The optional request `id` is case-sensitive alphanumeric text with a maximum of 32 characters.
The server can return `event` equal to `error` with `code`, `msg`, and `connId`.
The combined subscription argument payload cannot exceed 64 KB.

## Request and connection limits

| Rule | Current published value |
| --- | --- |
| Connection handshakes | Three per second per IP. |
| Subscribe, unsubscribe, and login operations | 480 per connection per hour. |
| Subscription payload | 64 KB total argument length. |
| Specified private-channel connections | 30 connections per channel per subaccount in the current documentation. |
| Recommended high-depth subscriptions | Fewer than 30 per connection. |

The connection-count limit applies separately to `orders`, `account`, `positions`, `balance_and_position`, `liquidation-warning`, and `account-greeks`.
Several arguments for the same channel on one connection count as one connection.
Different channel names count separately.

The server reports the current number through `channel-conn-count`.
When the limit is exceeded, it can acknowledge the subscription and then terminate it with `channel-conn-count-error`.
The latest connection is normally rejected.
The server can terminate an existing connection in exceptional conditions.

An older changelog section says the private-channel limit is 20.
The current API reference says 30.
The current reference should govern while the implementation remains ready for a lower server-enforced limit.

## Relevant channel matrix

### Public market channels

| Channel | Filter | Payload class | Arbitrage use |
| --- | --- | --- | --- |
| `instruments` | `instType`, optional `instFamily` or `seriesId` | Instrument changes | Symbol metadata, state, sizes, ticks, contract values, expiry, and RPI eligibility. |
| `tickers` | `instId` | Snapshot-style ticker updates | Last price, BBO, size, and 24-hour statistics. |
| `trades` | `instId` | Aggregated public trades | Taker flow and last execution. |
| `books` | `instId` | 400-level snapshot and updates | Public Level 2 depth at 100 milliseconds. |
| `books5` | `instId` | Five-level snapshots | Small public depth at 100 milliseconds. |
| `bbo-tbt` | `instId` | One-level snapshots | Fast candidate discovery at 10 milliseconds. |
| `books50-l2-tbt` | `instId` | 50-level snapshot and updates | VIP4 10 millisecond depth. |
| `books-l2-tbt` | `instId` | 400-level snapshot and updates | VIP4 10 millisecond depth. |
| `books-rpi` | `instId` | Consolidated organic and RPI depth | RPI-aware execution analysis. |
| `funding-rate` | `instId` | Funding state | Current, settled, and next funding information. |
| `mark-price` | `instId` | Mark price | Margin, funding, and liquidation validation. |
| `index-tickers` | `instId` | Index price and statistics | External reference-price validation. |
| `open-interest` | `instId` | Open interest | Derivative liquidity and risk context. |
| `price-limit` | `instId` | Current buy and sell limits | Order validation. |
| `liquidation-orders` | Product filters | Public liquidation events | Market stress context. |
| `opt-summary` | Option family filters | Option Greeks and summary | Option valuation context. |
| `estimated-price` | Product filters | Estimated delivery or exercise price | Expiry validation. |
| `status` | No instrument or service filters as documented | Platform maintenance status | Service availability. |

### Business market channels

| Channel | Filter | Payload class | Arbitrage use |
| --- | --- | --- | --- |
| `trades-all` | `instId` | One public trade per update | Unaggregated trade analysis. |
| `candle{bar}` | `instId` | Trade-price OHLCV | Monitoring and research. |
| `mark-price-candle{bar}` | `instId` | Mark-price OHLC | Derivative monitoring. |
| `index-candle{bar}` | `instId` | Index-price OHLC | Reference monitoring. |

The candle suffix selects a documented bar interval.
Common intervals include one, three, five, fifteen, and thirty minutes plus hourly, daily, weekly, and monthly families.
The current API reference should be used for the complete interval enum because timezone variants differ.

### Private and authenticated channels

| Channel | Path | Initial data | Arbitrage use |
| --- | --- | --- | --- |
| `orders` | Private | No initial snapshot | Authoritative order lifecycle and every supported fill category. |
| `fills` | Private | No initial snapshot | Low-latency order-book fills for VIP4 accounts. |
| `account` | Private | Initial and regular snapshots | Equity, balances, margin, and risk. |
| `positions` | Private | Initial and regular snapshots | Positions, mark, margin, profit or loss, and Greeks. |
| `balance_and_position` | Private | Initial snapshot | Fast combined balance and position changes. |
| `liquidation-warning` | Private | Event-driven warnings | Account risk warning only. |
| `account-greeks` | Private | Initial, event, and regular data | Option and portfolio Greeks. |
| `orders-algo` | Business with login | No initial snapshot | Trigger, conditional, OCO, iceberg, and TWAP order state. |

## Ticker schema

The `tickers` channel can push at most every 100 milliseconds when relevant market fields change.

```json
{
  "arg": {
    "channel": "tickers",
    "instId": "BTC-USDT"
  },
  "data": [
    {
      "instType": "SPOT",
      "instId": "BTC-USDT",
      "last": "67500.1",
      "lastSz": "0.01",
      "askPx": "67500.2",
      "askSz": "1.20",
      "bidPx": "67500.1",
      "bidSz": "0.95",
      "open24h": "66000",
      "high24h": "68000",
      "low24h": "65000",
      "volCcy24h": "125000000",
      "vol24h": "1875",
      "sodUtc0": "66250",
      "sodUtc8": "66400",
      "ts": "1785096000123"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `last` and `lastSz` | Last execution price and size. |
| `askPx` and `askSz` | Best ask and its displayed quantity. |
| `bidPx` and `bidSz` | Best bid and its displayed quantity. |
| `volCcy24h` | 24-hour volume in the channel-defined currency unit. |
| `vol24h` | 24-hour volume in the instrument unit. |
| `sodUtc0` and `sodUtc8` | Start-of-day reference prices for the named UTC boundaries. |
| `ts` | Exchange generation time in Unix milliseconds. |

The ticker BBO is useful for monitoring.
Use an order-book channel when every quote change, depth, or recovery rule matters.

## Public trades

The `trades` channel can aggregate executions that share a taker order, fill price, and source.
Its important fields are `instId`, `tradeId`, `px`, `sz`, `side`, `ts`, `count`, `source`, and `seqId`.
The `side` field is the taker side.
The same `seqId` can appear in more than one pushed trade.
Use `trades-all` on the business path when one execution per update is required.

Public trade messages do not prove that the displayed book quantity remains available.
Trade processing must remain separate from order-book continuity.

## Order-book channel comparison

| Channel | Levels | Message form | Nominal cadence | Authentication |
| --- | ---: | --- | ---: | --- |
| `bbo-tbt` | 1 | Snapshot on change | 10 milliseconds | No. |
| `books5` | 5 | Snapshot on change | 100 milliseconds | No. |
| `books` | 400 | Snapshot then incremental updates | 100 milliseconds | No. |
| `books50-l2-tbt` | 50 | Snapshot then incremental updates | 10 milliseconds | VIP4 login. |
| `books-l2-tbt` | 400 | Snapshot then incremental updates | 10 milliseconds | VIP4 login. |
| `books-rpi` | 400 | Snapshot then incremental updates | 100 milliseconds | Public data with separate RPI execution eligibility. |

The standard price-level tuple is `[price, quantity, "0", orderCount]`.
Spot and margin quantity is in base currency.
Derivative quantity is in contracts.

### Representative snapshot

```json
{
  "arg": {
    "channel": "books",
    "instId": "BTC-USDT"
  },
  "action": "snapshot",
  "data": [
    {
      "asks": [
        ["67500.2", "1.20", "0", "3"],
        ["67500.3", "0.80", "0", "2"]
      ],
      "bids": [
        ["67500.1", "0.95", "0", "4"],
        ["67500.0", "2.10", "0", "5"]
      ],
      "ts": "1785096000123",
      "checksum": 0,
      "prevSeqId": -1,
      "seqId": 450001
    }
  ]
}
```

### Representative incremental update

```json
{
  "arg": {
    "channel": "books",
    "instId": "BTC-USDT"
  },
  "action": "update",
  "data": [
    {
      "asks": [
        ["67500.2", "0", "0", "0"],
        ["67500.4", "1.50", "0", "1"]
      ],
      "bids": [
        ["67500.1", "1.25", "0", "5"]
      ],
      "ts": "1785096000130",
      "checksum": 0,
      "prevSeqId": 450001,
      "seqId": 450002
    }
  ]
}
```

## Order-book reconstruction

1. Create no local book until an `action` equal to `snapshot` arrives.
2. Replace both local sides with the snapshot.
3. Store the snapshot `seqId`.
4. Require each normal update `prevSeqId` to equal the last accepted `seqId`.
5. Replace or insert a price when its new quantity is nonzero.
6. Delete a price when its new quantity is zero.
7. Sort bids from highest to lowest.
8. Sort asks from lowest to highest.
9. Store the accepted update `seqId`.
10. Publish a local BBO only after the complete message is applied.

An incremental update carries the full new quantity at each changed price.
It does not carry a quantity delta.

When there is no change for about 60 seconds, snapshot-form channels can send another snapshot.
Incremental channels can send empty bid and ask arrays with `seqId` equal to `prevSeqId`.
That empty update is a liveness event and not a gap.

During maintenance, OKX can reset sequence state with a `seqId` lower than `prevSeqId`.
Treat that documented case as a reset and rebuild from the new snapshot sequence.
For every other mismatch, discard the local book and resubscribe.
Do not continue from a gapped book.

Sequences for the same instrument and channel are consistent across connections.
Do not compare sequences across unrelated instruments or channel families.

## Checksum status

The `checksum` field is deprecated for `books`, `books-l2-tbt`, and `books50-l2-tbt`.
It remains in messages but is fixed to numeric zero.
Do not calculate or validate the old CRC checksum.
Use `seqId`, `prevSeqId`, snapshot replacement, and TLS for continuity and transport integrity.

`books5` and `bbo-tbt` do not contain a checksum field.
`books-rpi` also relies on sequence continuity rather than the deprecated checksum.
Older official examples and SDKs that require CRC validation are stale after 2026-06-23.

## Depth subscription restrictions

One connection cannot subscribe to `books-l2-tbt` and either `books50-l2-tbt` or `books` for the same instrument.
The server retains the higher-priority existing subscription and can reject the conflicting subscription with code `64004`.

For one instrument on one connection, the fixed documented push order is:

```text
bbo-tbt
books-l2-tbt
books50-l2-tbt
books
books5
```

This order does not establish atomicity between the channels.
Use one selected depth channel as the source of record for a local book.

## RPI book behavior

An RPI level uses `[price, totalQuantity, nonRpiQuantity, orderCount]`.
The difference between total quantity and non-RPI quantity is displayed RPI quantity.
Organic books omit RPI liquidity.

RPI liquidity can execute outside the organic best bid and ask.
Organic orders have priority.
Eligible API takers must enable `rpiTakerAccess`.
Eligible taker flow has a five millisecond speed bump.
RPI executions affect last trade and candles.
They do not change organic BBO or mark price.

Instrument field `rpi` equal to `0` means RPI is disabled.
Value `1` means RPI is enabled without maker permission.
Value `2` means RPI is enabled with maker permission.
Eligible RPI takers can use limit, market, fill-or-kill, and immediate-or-cancel instructions.
RPI users must migrate the documented fields, order type, and channel behavior by 2026-10-31.

A strategy without RPI taker access must not count the RPI portion as executable.
A strategy with access still must model the speed bump, queue priority, and the possibility of hidden tradeable RPI liquidity.

## Instruments channel

The `instruments` channel does not send the complete current instrument list when first subscribed.
Bootstrap each supported type through the public instruments REST endpoint.
Then use the WebSocket channel for listings, delistings, state changes, tick-size changes, and other updates.

Important fields include:

- Identity fields include `instType`, `instId`, `instFamily`, and `seriesId`.
- Currency fields include `baseCcy`, `quoteCcy`, and `settleCcy`.
- Contract fields include `ctVal`, `ctValCcy`, `ctMult`, and `ctType`.
- Size fields include `tickSz`, `lotSz`, and `minSz`.
- Lifecycle fields include `listTime`, `expTime`, `state`, and `ruleType`.
- Order entry uses the `instIdCode` field.
- RPI eligibility uses the `rpi` field.

A listing announcement can first push only identity, list time, and state.
Other fields can remain empty until at least five minutes before trading.
The client must not enable execution until required metadata is complete.

## Funding-rate channel

Subscribe on the public path.

```json
{
  "id": "funding-one",
  "op": "subscribe",
  "args": [
    {
      "channel": "funding-rate",
      "instId": "BTC-USDT-SWAP"
    }
  ]
}
```

Representative schema:

```json
{
  "arg": {
    "channel": "funding-rate",
    "instId": "BTC-USDT-SWAP"
  },
  "data": [
    {
      "instType": "SWAP",
      "instId": "BTC-USDT-SWAP",
      "fundingRate": "0.0001",
      "fundingTime": "1785110400000",
      "nextFundingRate": "0.00008",
      "nextFundingTime": "1785139200000",
      "premium": "0.00005",
      "interestRate": "0.0001",
      "impactValue": "200000",
      "formulaType": "withRate",
      "method": "current_period",
      "maxFundingRate": "0.00375",
      "minFundingRate": "-0.00375",
      "settFundingRate": "",
      "settState": "",
      "ts": "1785096000123"
    }
  ]
}
```

The channel supports perpetual swaps and documented X-Perps futures.
The current interval can be one, two, four, or eight hours under the funding mechanism article.
Older API wording also mentions six hours.
Use `fundingTime` and `nextFundingTime` rather than a fixed local interval.
Interpret `settFundingRate` together with `settState`.

## Mark, index, open interest, and limits

The `mark-price` channel carries `instType`, `instId`, `markPx`, and `ts`.
The `index-tickers` channel carries `instId`, `idxPx`, 24-hour index statistics, and `ts`.
The `open-interest` channel carries `instType`, `instId`, `oi`, `oiCcy`, `oiUsd`, and `ts`.
The `price-limit` channel carries the current upper and lower order-price limits with its timestamp.

Use mark price for derivative margin and liquidation validation.
Use index price to detect mark divergence and reference-price problems.
Use price limits before constructing an executable order.
Open interest is contextual data and is not a substitute for order-book liquidity.

## Liquidation channels

The public `liquidation-orders` channel reports market liquidation events.
It is useful for stress and flow monitoring.
It does not guarantee a complete venue-wide liquidation history for accounting.

The private `liquidation-warning` channel reports account risk.
OKX warns that liquidation can occur at the same time as the warning push.
The channel must not be the only liquidation control.
Use positions, account risk fields, mark prices, local risk limits, and REST reconciliation.

## Candle schema

Trade-price candles use the business path and `candle{bar}` channel name.
Index and mark candles use `index-candle{bar}` and `mark-price-candle{bar}`.
The maximum nominal candle update rate is one message per second.

```json
{
  "arg": {
    "channel": "candle1m",
    "instId": "BTC-USDT"
  },
  "data": [
    [
      "1785096000000",
      "67500.0",
      "67510.0",
      "67490.0",
      "67505.0",
      "12.5",
      "843812.5",
      "843812.5",
      "0"
    ]
  ]
}
```

The array fields are timestamp, open, high, low, close, volume, currency volume, quote volume, and confirmation state.
Confirmation `0` means the candle is still open.
Confirmation `1` means the candle is closed.

## Account channel

The `account` channel sends an initial snapshot.
It also sends event-driven and regular snapshots unless configured otherwise.
Important top-level fields are `eventType`, `curPage`, and `lastPage`.
`curPage` and `lastPage` appear only for snapshot pagination.

Account data includes total equity, adjusted equity, isolated equity, available equity, margin ratios, and per-currency details.
The exact fields depend on account mode and product eligibility.
Apply all pages before publishing a complete snapshot.

Event-only subscription example:

```json
{
  "id": "account-events",
  "op": "subscribe",
  "args": [
    {
      "channel": "account",
      "extraParams": "{\"updateInterval\":\"0\"}"
    }
  ]
}
```

`extraParams` is a JSON-encoded string rather than a nested object.

## Positions channel

The `positions` channel sends an initial snapshot and later event or regular updates.
It requires `instType`.
It can also filter by `instFamily` or `instId`.
When both are present, `instId` takes precedence.

```json
{
  "id": "positions-all",
  "op": "subscribe",
  "args": [
    {
      "channel": "positions",
      "instType": "ANY",
      "extraParams": "{\"updateInterval\":\"0\"}"
    }
  ]
}
```

Valid position update intervals are event-only `0` or 2000, 3000, and 4000 milliseconds.
Other values and omission produce event updates plus regular data around every five seconds.
Important fields include instrument, margin mode, position side, position quantity, average price, mark price, liquidation price, leverage, unrealized profit or loss, margin, maintenance margin, Greeks, and update time.

Apply every page of a snapshot before treating it as complete.
Treat `event_update` as an update to the affected position rather than a replacement for all positions.

## Combined balance and position channel

`balance_and_position` sends an initial snapshot and fast changes after balance or position events.
Its envelope includes `pTime`, `eventType`, `balData`, and `posData`.
It is useful for fast capital reservation and exposure updates.
It does not remove the need for the full account and position snapshots.

## Orders channel

The `orders` channel sends no initial snapshot.
It pushes new orders and later state changes.
Bootstrap open orders through authenticated REST before enabling execution.

```json
{
  "id": "orders-all",
  "op": "subscribe",
  "args": [
    {
      "channel": "orders",
      "instType": "ANY"
    }
  ]
}
```

Representative update:

```json
{
  "arg": {
    "channel": "orders",
    "instType": "SPOT",
    "instId": "BTC-USDT",
    "uid": "614488474791936"
  },
  "data": [
    {
      "instType": "SPOT",
      "instId": "BTC-USDT",
      "ordId": "2510789768709120",
      "clOrdId": "arb1001",
      "side": "buy",
      "ordType": "limit",
      "px": "67500.0",
      "sz": "0.01",
      "fillPx": "67500.0",
      "fillSz": "0.004",
      "accFillSz": "0.004",
      "avgPx": "67500.0",
      "state": "partially_filled",
      "execType": "T",
      "fee": "-0.27",
      "feeCcy": "USDT",
      "rebate": "0",
      "pnl": "0",
      "category": "normal",
      "cancelSource": "",
      "cTime": "1785096000100",
      "uTime": "1785096000123"
    }
  ]
}
```

Important fields include:

- Identifier fields cover the instrument, order, client order, strategy, and algorithm.
- Position fields cover trading mode, margin currency, side, position side, and reduce-only state.
- Instruction fields cover order type, price, size, target currency, and attached strategies.
- Last-fill fields cover price, size, time, trade identifier, and maker or taker role.
- Cumulative execution fields cover accumulated fill size and average price.
- Cost fields cover fee, fee currency, rebate, and profit or loss.
- Lifecycle fields cover order state, category, source, cancellation source, and amendment result.
- Time fields cover creation and update timestamps.

`accFillSz` is cumulative rather than the increment since the prior push.
Deduplicate order state by order identifier and update time.
Use trade identifiers and accumulated size to make fill processing idempotent.

An acknowledgement from an order-entry operation is not an execution confirmation.
The `orders` channel and authenticated REST state are authoritative.

## Fills channel

The `fills` channel is available to VIP4 and higher accounts.
Other accounts receive error code `64003`.
It sends only order-book fills with a positive `tradeId`.
It omits block trading, Nitro Spreads, liquidation, ADL, and some other non-book events.
Subscribe to `orders` even when `fills` is available.

Fields include `instId`, `fillSz`, `fillPx`, `side`, `ts`, `ordId`, `clOrdId`, `tradeId`, `execType`, and `count`.
Taker fills can be aggregated by price.
Maker fills are not aggregated.
Account balance, margin, and position state can lag the fill event.

The channel returns `clOrdId` only when the supplied value is a positive signed 64-bit integer.
It returns `0` when the value is missing or does not meet that format.

## WebSocket order entry

Current place-order requests use `instIdCode`.
The code must come from the current instruments response.
The numeric value below is representative and must be replaced with the code for the intended instrument.

```json
{
  "id": "place-one",
  "op": "order",
  "args": [
    {
      "instIdCode": 1000000000,
      "tdMode": "cash",
      "clOrdId": "1000001",
      "side": "buy",
      "ordType": "limit",
      "px": "67500.0",
      "sz": "0.01"
    }
  ]
}
```

Representative operation acknowledgement:

```json
{
  "id": "place-one",
  "op": "order",
  "code": "0",
  "msg": "",
  "data": [
    {
      "clOrdId": "1000001",
      "ordId": "2510789768709120",
      "tag": "",
      "sCode": "0",
      "sMsg": ""
    }
  ],
  "inTime": "1785096000100123",
  "outTime": "1785096000101456"
}
```

Representative batch request:

```json
{
  "id": "place-many",
  "op": "batch-orders",
  "args": [
    {
      "instIdCode": 1000000000,
      "tdMode": "cash",
      "clOrdId": "1000002",
      "side": "buy",
      "ordType": "post_only",
      "px": "67490.0",
      "sz": "0.01"
    },
    {
      "instIdCode": 1000000001,
      "tdMode": "cash",
      "clOrdId": "1000003",
      "side": "sell",
      "ordType": "post_only",
      "px": "3600.0",
      "sz": "0.10"
    }
  ]
}
```

Supported operation names are `order`, `batch-orders`, `amend-order`, `batch-amend-orders`, `cancel-order`, and `batch-cancel-orders`.

Single place, amend, and cancel operations are limited to 60 requests per two seconds under the standard rule.
A batch can contain at most 20 orders.
The standard batch limit is 300 orders per two seconds.
REST and WebSocket share the applicable trading limit.
Options limits use user and instrument family.
Most other products use user and instrument.
The baseline subaccount cap is 1,000 new or amended orders per two seconds.

The optional `expTime` is an epoch-millisecond deadline for place, batch-place, amend, and batch-amend operations.
Use it to prevent the server from processing an order after the strategy's opportunity window.

## Post-only and RPI live-state announcement

OKX announced a change on 2026-07-16 for post-only, `mmp_and_post_only`, and RPI orders.
The announced behavior delays `state` equal to `live` by about one millisecond until the order enters the book.
A crossing order that is canceled should emit only `canceled` and no intermediate `live`.
The announcement uses rollout language.
Confirm deployment in the current changelog or observed account environment before relying on the new event ordering.

Regardless of rollout state, the client must treat `canceled` as terminal and make updates idempotent.
It must not assume that an earlier `live` event guarantees the order will remain live.

## Private-state recovery

1. Stop new automated orders after a private connection loss.
2. Open and authenticate a replacement private connection.
3. Subscribe to `orders`, `account`, `positions`, and any additional private channel.
4. Fetch open orders, recent fills, balances, and positions through authenticated REST.
5. Merge REST state with queued WebSocket events by identifiers and update times.
6. Recalculate reserved balances, exposure, and pending hedge quantity.
7. Resume execution only after the reconciled state passes local risk checks.

Private channel pushes can be paginated.
The client must apply every page before publishing a complete snapshot.
No private sequence field provides a universal replay log across all channels.
Periodic REST reconciliation remains necessary.

## Timestamp and unit normalization

Most market and private timestamps are Unix milliseconds carried as decimal strings.
Authentication uses epoch seconds.
`expTime` uses epoch milliseconds.
Store the exchange timestamp and local receive timestamp separately.
Use a monotonic local clock for latency and timeout measurement.

Spot book size is base currency.
Derivative book size is contracts.
Contract value, multiplier, settlement currency, and tick size come from instrument metadata.
Funding rates and fee rates are decimal proportions unless the specific field says otherwise.
Do not apply a percentage conversion twice.

## What the observatory should subscribe to

### Discovery

Subscribe to `bbo-tbt` for the fastest documented candidate BBO.
Use `tickers` when 24-hour statistics and last price are also needed.
Run the application heartbeat timer on every connection.

### Validation

Maintain `books`, `books50-l2-tbt`, or `books-l2-tbt` for executable depth.
Subscribe to `instruments` after a REST instrument bootstrap.
For derivatives, add `mark-price`, `index-tickers`, `funding-rate`, `price-limit`, and optionally `open-interest`.
Join the market state with the account-specific fee response from the fee profile.
Use `books-rpi` only for an explicitly RPI-aware strategy.

### Execution

Subscribe to `orders`, `account`, `positions`, and `balance_and_position`.
Use `fills` as an additional low-latency signal when the account is VIP4 or higher.
Keep `orders` because `fills` omits important execution categories.
Use `liquidation-warning` as a supplemental warning rather than a primary control.
Reconcile every private state through REST after a reconnect.

## Arbitrage limitations

OKX does not provide atomic execution across another exchange.
No public book proves that the account can execute all displayed quantity.
Latency, queue position, self-trade prevention, price limits, account eligibility, and concurrent takers can change the result.

The public `trades` feed can aggregate prints.
RPI can expose or hide liquidity differently from the organic BBO.
RPI execution can require account access and a five millisecond speed bump.
Funding intervals and rates can change.
Fee tiers and pair groups can change.
Instrument metadata can arrive in stages before listing.
Private `fills` omits several execution categories.
Every book gap requires a new snapshot.

The observatory can detect a spread with BBO.
It can estimate executable profit only after applying depth, fees, funding, contract units, balances, transfer constraints, price limits, and measured latency.

## Known official-source conflicts

Current documentation says the premium TBT book channels require VIP4.
Older material mentions VIP5 or VIP6.
The current VIP4 gate should govern.

Current documentation says the selected private channels permit 30 connections per channel per subaccount.
An older changelog section says 20.
The client should respect the lower observed server limit.

The funding mechanism article lists one, two, four, and eight-hour intervals.
Older API wording also mentions six hours.
The live funding timestamps should govern.

The order-book schema still includes `checksum`.
The 2026-06-23 changelog fixes it to zero and instructs clients to stop validation.

The 2026-07-16 order-state announcement describes a planned behavior change.
The current changelog or account environment must confirm rollout.

Legacy order examples use `instId`.
The 2026-03-26 changelog says WebSocket place-order and batch-place-order requests now use `instIdCode` and ignore `instId`.

## Source ledger

Every source below is an official OKX source retrieved on 2026-07-26.

| Official source | Account stack or subject | Supports |
| --- | --- | --- |
| [Global API V5 documentation](https://www.okx.com/docs-v5/en/) | Global | Endpoints, authentication, subscriptions, channels, schemas, order entry, limits, and recovery semantics. |
| [Global API V5 changelog](https://www.okx.com/docs-v5/log_en/) | Global | Current checksum, VIP, instrument, order identifier, pagination, notice, and channel changes. |
| [United States and Australia API V5 documentation](https://app.okx.com/docs-v5/en/) | United States and Australia | Regional production and demo hosts and regional schemas. |
| [EEA API V5 documentation](https://my.okx.com/docs-v5/) | EEA | EEA production and demo hosts and regional schemas. |
| [Turkey API V5 documentation](https://tr.okx.com/docs-v5/) | Turkey | Turkey REST boundary and documented WebSocket host. |
| [WebSocket URL and parameter change notice](https://www.okx.com/en-us/help/changes-to-v5-api-websocket-subscription-parameter-and-url) | Historical endpoint context | Legacy URL changes and subscription parameters. |
| [Order-book checksum deprecation changelog](https://www.okx.com/docs-v5/log_en/) | Order books | 2026-06-23 checksum deprecation and TLS requirement. |
| [RPI program](https://www.okx.com/en-gb/help/okx-retail-price-improvement-program-rpi) | RPI | Book shape, organic priority, hidden liquidity, speed bump, and access fields. |
| [Perpetual funding mechanism](https://www.okx.com/en-us/help/perps-funding-fee-mechanism) | Funding | Current formula, interval behavior, impact value, and payment direction. |
| [WebSocket orders behavior announcement](https://www.okx.com/en-eu/help/okx-websocket-orders-channel-push-behavior-adjustment-announcement-us) | Order state | Announced post-only and RPI live-state behavior. |
