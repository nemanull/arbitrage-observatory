# Venue WebSocket protocol differences

Date: 2026-07-30.
Question: what differs between the Binance, Bybit, OKX, Kraken Futures, and Coinbase International WebSocket feeds?

Scope of the investigation: the five WebSocket profiles under [`profiles/`](../profiles/).
Every claim below carries a file and line reference.
This doc is the companion to [`2026-07-30-ccxt-ws-ingest-feasibility.md`](./2026-07-30-ccxt-ws-ingest-feasibility.md).
That doc records why CCXT Pro is not the transport.
This one records how the five venue protocols differ from each other.

## 1. Answer

Sixteen things differ between the five venues.
Sections 2 to 11 enumerate them.

| axis | section |
|---|---|
| endpoint split axis | 2 |
| subscribe frame shape | 3 |
| unknown symbol expectation | 3 |
| chunk unit and budget | 4 |
| keepalive mechanism | 5 |
| connection lifetime and maintenance notice | 6 |
| handshake and operation rate limits | 6 |
| public market data authentication | 7 |
| message parse and routing | 8 |
| subscribe acknowledgement shape | 9 |
| symbol identifier format | 10.1 |
| number representation | 10.2 |
| timestamp representation | 10.3 |
| size unit | 10.4 |
| sequence semantics | 10.5 |
| idle repeat behaviour | 11 |

## 2. Connection topology

Each venue splits its endpoints on a different axis.
"One socket per venue" is true on none of them once more than one channel is needed.

| venue | split axis | consequence | evidence |
|---|---|---|---|
| Binance USD-M | data class, and contract family | `/public/ws` carries book data, `/market/ws` carries trades, mark, and funding, so best bid and ask and mark price sit on different sockets of the same venue | [`binance/websocket.md:88`](../profiles/binance/websocket.md) and [`:360`](../profiles/binance/websocket.md) |
| Bybit | market family | `/v5/public/linear`, `/v5/public/inverse`, and `/v5/public/spot` are separate sessions, and one connection cannot move a Spot topic into a Linear session | [`bybit/websocket.md:130`](../profiles/bybit/websocket.md) |
| OKX | channel class | one `/ws/v5/public` carries every instrument type, and `/ws/v5/business` carries candles and unaggregated trades | [`okx/websocket.md:46-58`](../profiles/okx/websocket.md) |
| Kraken | product line | `futures.kraken.com/ws/v1` covers all derivatives, and Spot is a different API with different wire conventions | [`kraken/websocket.md:58-72`](../profiles/kraken/websocket.md) |
| Coinbase | platform | Advanced Trade, Exchange, International, Prime, and Derivatives are five products with five protocols | [`coinbase/websocket.md:47-71`](../profiles/coinbase/websocket.md) |

The key that decides the split is different on every venue.

## 3. Subscription frame shape

Five venues, five genuinely different shapes.

Binance carries the topic in the URL, so the firehose needs no subscribe message at all.

```text
wss://fstream.binance.com/public/ws/!bookTicker
```

Bybit sends flat topic strings of the form channel, depth, and symbol.

```json
{ "op": "subscribe", "args": ["orderbook.1.BTCUSDT"] }
```

OKX sends one argument object per symbol.

```json
{ "op": "subscribe", "args": [{ "channel": "bbo-tbt", "instId": "BTC-USDT-SWAP" }] }
```

Kraken Futures names the feed once and passes the symbols as an array.

```json
{ "event": "subscribe", "feed": "ticker", "product_ids": ["PF_XBTUSD"] }
```

Coinbase International sends the cross product of products and channels, with authentication inside the same frame.

```json
{
  "type": "SUBSCRIBE",
  "product_ids": ["BTC-PERP"],
  "channels": ["LEVEL1"],
  "time": "1683730727",
  "key": "API_KEY",
  "passphrase": "API_PASSPHRASE",
  "signature": "BASE64_HMAC_SIGNATURE"
}
```

Sources are [`bybit/websocket.md:179-193`](../profiles/bybit/websocket.md), [`okx/websocket.md:139-152`](../profiles/okx/websocket.md), [`kraken/websocket.md:500-511`](../profiles/kraken/websocket.md), and [`coinbase/websocket.md:357-370`](../profiles/coinbase/websocket.md).

Binance differs in more than shape.
`!bookTicker` is a single all-symbol firehose, so subscription is not a function of the instrument list at all.
Frame count scales with instrument count on the other four venues and not on Binance.

Binance also delivers messages for symbols that were never requested.
An unknown symbol is a normal condition on Binance and an error condition on the other four venues.

## 4. Chunking unit and budget

The unit, the budget, and the scope of the subscription cap differ on all five.

| venue | budget | unit | scope | evidence |
|---|---|---|---|---|
| Binance | 1,024 streams per connection, not reached by the firehose | streams | connection | [`binance/websocket.md:443`](../profiles/binance/websocket.md) |
| Bybit | 21,000 | characters | cumulative per connection | [`bybit/websocket.md:260`](../profiles/bybit/websocket.md) |
| OKX | 64 KB | bytes | per subscribe payload | [`okx/websocket.md:216`](../profiles/okx/websocket.md) |
| Kraken Futures | none published | not applicable | one frame with all product ids | [`kraken/websocket.md:500-511`](../profiles/kraken/websocket.md) |
| Coinbase International | none published | not applicable | not applicable | [`coinbase/websocket.md:357-370`](../profiles/coinbase/websocket.md) |

Bybit's cap is cumulative across the connection and OKX's applies to a single payload.
Exceeding the cap on Bybit therefore needs a second connection, and exceeding it on OKX needs a second payload on the same connection.

## 5. Keepalive

This is the most venue-specific part of the protocol.
Four incompatible mechanisms appear across five venues.

| venue | who initiates | payload | timing | evidence |
|---|---|---|---|---|
| Binance | the server | protocol frame, answered automatically by `ws` | server pings every 3 minutes, pong deadline 10 minutes | [`binance/websocket.md:440-441`](../profiles/binance/websocket.md) |
| Bybit | the client, at application level | JSON `{"op":"ping"}` | every 20 seconds, and protocol ping and pong must also be handled, with an inactive disconnect near ten minutes | [`bybit/websocket.md:236-237`](../profiles/bybit/websocket.md) and [`:266`](../profiles/bybit/websocket.md) |
| OKX | the client, as a raw text frame | the literal text `ping`, answered by the literal text `pong` | only when no message arrived within a local timer shorter than 30 seconds, and any data resets that timer | [`okx/websocket.md:86-89`](../profiles/okx/websocket.md) |
| Kraken Futures | the client, at protocol level | WebSocket control ping | at least every 60 seconds, with the official sample using 30 seconds, and no JSON application ping schema documented | [`kraken/websocket.md:632-634`](../profiles/kraken/websocket.md) |
| Coinbase International | not documented | not documented | the server can disconnect slow consumers | [`coinbase/websocket.md:421`](../profiles/coinbase/websocket.md) |

Kraken Futures adds one more difference.
Its `heartbeat` feed must be explicitly subscribed, and the documentation does not define its cadence, at [`kraken/websocket.md:613`](../profiles/kraken/websocket.md).
Liveness on that venue is something the client asks for rather than something it receives by default.

## 6. Lifecycle and rate limits

These numbers differ by an order of magnitude between venues.

| venue | handshake rate | concurrency | forced reconnect | in-band notice | evidence |
|---|---|---|---|---|---|
| Binance USD-M | not published, but 10 inbound messages per second per connection | 1,024 streams per connection | hard 24 hour connection lifetime | none | [`binance/websocket.md:439-443`](../profiles/binance/websocket.md) |
| Bybit | 500 connections per five minutes per IP per domain | 1,000 per IP for each of Spot, Linear, Inverse, and Options | inactive disconnect near ten minutes | none | [`bybit/websocket.md:258-266`](../profiles/bybit/websocket.md) |
| OKX | three per second per IP | 30 connections per private channel | none | `notice` code `64008`, about 60 seconds before a service upgrade | [`okx/websocket.md:222-223`](../profiles/okx/websocket.md) and [`:94`](../profiles/okx/websocket.md) |
| Kraken Futures | not published | 100 concurrent connections, 100 requests per second per connection | none | none | [`kraken/websocket.md:683-684`](../profiles/kraken/websocket.md) |
| Coinbase International | ten attempts in any 30 second interval | not published | none | none | [`coinbase/websocket.md:423`](../profiles/coinbase/websocket.md) |

Three items have no counterpart on the other four venues.

1. OKX allows only 480 subscribe, unsubscribe, and login operations per connection per hour, at [`okx/websocket.md:223`](../profiles/okx/websocket.md).
   No other venue publishes a cap on subscription churn.
2. OKX is the only venue that warns before dropping the connection.
   The `notice` with code `64008` arrives about 60 seconds before a service upgrade closes the socket, at [`okx/websocket.md:94`](../profiles/okx/websocket.md).
3. Coinbase International requires the first subscription within three seconds of connecting, at [`coinbase/websocket.md:374`](../profiles/coinbase/websocket.md).
   No other venue has a connect to subscribe deadline.

## 7. Authentication for public market data

Binance, Bybit, OKX, and Kraken Futures require none for public feeds.

Coinbase International requires it.
The signature is a Base64 encoded HMAC SHA-256 over `TIMESTAMP + KEY + CBINTLMD + PASSPHRASE`, at [`coinbase/websocket.md:372`](../profiles/coinbase/websocket.md).
The request time is epoch seconds and must be within 30 seconds of the request, at [`coinbase/websocket.md:373`](../profiles/coinbase/websocket.md).
The credentials travel inside the first subscribe frame rather than in a separate login step.

## 8. Message routing

The routing key is in a different place on every venue.

| venue | envelope | routing key | snapshot signal | evidence |
|---|---|---|---|---|
| Binance | none on raw streams, `{stream, data}` on combined streams | `s` at the top level | none, every `bookTicker` message is complete state | [`binance/websocket.md:16-44`](../profiles/binance/websocket.md) |
| Bybit | `{topic, type, ts, data}` | `topic`, or `data.s` | `type` is `snapshot` or `delta` | [`bybit/websocket.md:288-322`](../profiles/bybit/websocket.md) |
| OKX | `{arg: {channel, instId}, data: [...]}` | `arg.instId`, nested one level down | implicit, because `bbo-tbt` is always a one-level snapshot | [`okx/websocket.md:202-212`](../profiles/okx/websocket.md) and [`:252`](../profiles/okx/websocket.md) |
| Kraken Futures | flat, no nesting | `product_id` | the `feed` name itself changes between `book_snapshot` and `book` | [`kraken/websocket.md:543-601`](../profiles/kraken/websocket.md) |
| Coinbase International | `{channel, type, product_id, sequence, ...}` | `product_id` | `type` is `SNAPSHOT` or `UPDATE` | [`coinbase/websocket.md:376-396`](../profiles/coinbase/websocket.md) |

OKX also always wraps payloads in an array, so a one-level snapshot still arrives as a list.
Kraken Futures signals a snapshot by changing the feed name rather than by setting a type field, so its snapshot signal sits in a different field from every other venue.

## 9. Subscribe acknowledgement

| venue | acknowledgement | evidence |
|---|---|---|
| Binance | none for URL path subscriptions | [`binance/websocket.md:110-133`](../profiles/binance/websocket.md) |
| Bybit | `{success, ret_msg, conn_id, req_id, op}`, and Options and Spread use a second family with `successTopics` and `failTopics` | [`bybit/websocket.md:241-251`](../profiles/bybit/websocket.md) |
| OKX | one acknowledgement per argument, so N symbols produce N acknowledgements, with errors as `{event: "error", code, msg, connId}` | [`okx/websocket.md:82`](../profiles/okx/websocket.md) and [`:200-215`](../profiles/okx/websocket.md) |
| Kraken Futures | `{event: "subscribed", feed, product_ids}` | [`kraken/websocket.md:500-511`](../profiles/kraken/websocket.md) |
| Coinbase International | confirmations carry no sequence number | [`coinbase/websocket.md:416`](../profiles/coinbase/websocket.md) |

Two venues break the pattern.
Bybit uses two acknowledgement families within one venue.
OKX can acknowledge a subscription and then terminate it with `channel-conn-count-error`, at [`okx/websocket.md:233`](../profiles/okx/websocket.md), so an acknowledgement is not proof of success there.

## 10. Payload semantics

These five produce silently wrong numbers rather than visible failures.

### 10.1 Symbol identifier format

| venue | subscribe key | payload key | evidence |
|---|---|---|---|
| Binance | `btcusdt`, lowercase | `BTCUSDT`, uppercase | [`binance/websocket.md:669-671`](../profiles/binance/websocket.md) |
| Bybit | `BTCUSDT` | `BTCUSDT` | [`bybit/websocket.md:907`](../profiles/bybit/websocket.md) |
| OKX | `BTC-USDT-SWAP` | same | [`okx/websocket.md:64`](../profiles/okx/websocket.md) |
| Kraken Futures | `PF_XBTUSD`, where the prefix encodes the contract type and the base asset is `XBT` rather than `BTC` | same | [`kraken/websocket.md:470-484`](../profiles/kraken/websocket.md) |
| Coinbase International | `BTC-PERP`, becoming `BTC_USDC-PERPETUAL` after the 2026-09-09 cutover | same | [`coinbase/websocket.md:512`](../profiles/coinbase/websocket.md) and [`:440`](../profiles/coinbase/websocket.md) |

Binance is the only venue where the subscribe key and the routing key are not the same string.
Kraken Futures spells the base asset `XBT` rather than `BTC`, and the profile records that this is not a string substitution without product metadata, at [`kraken/websocket.md:714`](../profiles/kraken/websocket.md).

### 10.2 Number representation

Binance, Bybit, OKX, and Coinbase send prices and sizes as JSON strings, at [`binance/websocket.md:675`](../profiles/binance/websocket.md), [`bybit/websocket.md:913`](../profiles/bybit/websocket.md), [`okx/websocket.md:898`](../profiles/okx/websocket.md), and [`coinbase/websocket.md:376-396`](../profiles/coinbase/websocket.md).
Kraken Futures sends them as JSON numbers, at [`kraken/websocket.md:513-535`](../profiles/kraken/websocket.md).

### 10.3 Timestamp representation

| venue | form | fields | evidence |
|---|---|---|---|
| Binance | integer milliseconds | `E` event generation time, `T` matching engine transaction time | [`binance/websocket.md:42-43`](../profiles/binance/websocket.md) |
| Bybit | integer milliseconds | `ts` system generation time, `cts` matching engine time | [`bybit/websocket.md:918-919`](../profiles/bybit/websocket.md) |
| OKX | milliseconds carried as decimal strings, with authentication using epoch seconds | one timestamp | [`okx/websocket.md:898-900`](../profiles/okx/websocket.md) |
| Kraken Futures | integer epoch milliseconds, where Kraken Spot uses RFC 3339 instead | `time` and `timestamp` | [`kraken/websocket.md:484`](../profiles/kraken/websocket.md) and [`:707`](../profiles/kraken/websocket.md) |
| Coinbase International | RFC 3339 string such as `2023-05-10T14:58:47.547Z` | `time` | [`coinbase/websocket.md:512`](../profiles/coinbase/websocket.md) |

Coinbase International is the only one of the five that carries a date string rather than a number.

### 10.4 Size unit

Binance USD-M linear, Bybit linear, and Coinbase International report size in base units.
OKX reports derivative book size in contracts, at [`okx/websocket.md:905`](../profiles/okx/websocket.md).
Kraken Futures `PF_` contracts also report size in contracts, and the multiplier comes from REST rather than the socket, at [`kraken/websocket.md:713`](../profiles/kraken/websocket.md).

Comparing raw sizes across venues compares contracts against coins.

### 10.5 Sequence semantics

Four mutually incompatible models across five venues.

| venue | model | evidence |
|---|---|---|
| Binance | `U`, `u`, and `pu` form a strict chain, where every depth event's `pu` must equal the previous event's `u` | [`binance/websocket.md:423-433`](../profiles/binance/websocket.md) |
| Bybit | `u` is not consecutive and legitimately repeats, `u` equal to 1 identifies a service restart, and `seq` is a separate cross-sequence domain on the same message | [`bybit/websocket.md:359`](../profiles/bybit/websocket.md) and [`:363-374`](../profiles/bybit/websocket.md) |
| OKX | sequence rules are documented for the `books` family only, and `bbo-tbt` carries neither a sequence rule nor a checksum | [`okx/websocket.md:447-457`](../profiles/okx/websocket.md) |
| Kraken Futures | `book` carries `seq`, `ticker` carries none, and no gap or reset algorithm is documented | [`kraken/websocket.md:596`](../profiles/kraken/websocket.md) |
| Coinbase International | `sequence` increases across the entire session rather than per product, so it is structurally unusable per instrument | [`coinbase/websocket.md:415`](../profiles/coinbase/websocket.md) |

Binance is the only venue of the five that documents a gap detection rule.
Three of the five publish no usable per-instrument sequence at all for the best bid and ask channels: OKX `bbo-tbt`, Kraken Futures `ticker`, and Coinbase International, whose `sequence` is session scoped.

## 11. Idle repeat behaviour

| venue | repeats unchanged state | evidence |
|---|---|---|
| Binance | no, the stream pushes on change | [`binance/websocket.md:366-372`](../profiles/binance/websocket.md) |
| Bybit | yes, an identical depth one snapshot with the same `u` after three idle seconds | [`bybit/websocket.md:371-374`](../profiles/bybit/websocket.md) |
| OKX | yes, `bbo-tbt` is re-emitted after roughly 60 idle seconds | [`okx/websocket.md:435-437`](../profiles/okx/websocket.md) |
| Kraken Futures | always, because the full ticker sends complete state even when one field changed | [`kraken/websocket.md:537`](../profiles/kraken/websocket.md) |
| Coinbase International | no | [`coinbase/websocket.md:376-396`](../profiles/coinbase/websocket.md) |

Three of the five repeat unchanged state, and Binance and Coinbase International do not.
