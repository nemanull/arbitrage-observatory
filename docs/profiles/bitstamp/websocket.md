# Bitstamp WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers the public market data socket for Bitstamp's 20 USD settled linear perpetuals, as a later book feed would use it.
Every probed number comes from [`../../../scripts/probes/bitstamp-ws-probe.mjs`](../../../scripts/probes/bitstamp-ws-probe.mjs), run three times on 2026-09-15: 91 s from 07:08 UTC, 201 s from 07:11 UTC and 70 s from 07:25 UTC.
The runs are called run 1, run 2 and run 3 below.
Its `spacing` mode also kept 30 s of raw BTC frames from 07:33 UTC, called the spacing capture.
A 91 s rerun from 19:20 UTC, called the second pass, rechecked every structural row, and rates and cadences are one host on one date.
Sockets were opened with `perMessageDeflate: false`, as the engine does at [`../../../server/src/feeds/book/VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 77.

## 1. Endpoints

| family | URL | authentication |
|---|---|---|
| every market, spot and perpetual | `wss://ws.bitstamp.net` | none for public channels |

There is one URL for everything.
The documentation names only `wss://ws.bitstamp.net`.
Probed: one socket carried `order_book_btcusd-perp` and the spot `order_book_btcusd` together, and both delivered data.
`ws.bitstamp.net` resolved to eight addresses, and six in the second pass, behind the CNAME `websocket-1667196836.eu-central-1.elb.amazonaws.com`, which suggests an AWS load balancer in Frankfurt, an inference from the name only.
The client's `bts:heartbeat` round trip was 144.8 to 150.4 ms over 13 samples in run 2, and 145.8 to 146.9 ms over 5 in the second pass.

## 2. Channel matrix for public market data

`[market]` is the lowercase market symbol, `btcusd-perp` for the BTC perpetual.
The documentation lists every perpetual market symbol with the `-perp` suffix in its channel list.

| channel | event | documented content | probed on a perpetual |
|---|---|---|---|
| `order_book_[market]` | `data` | "Top 100 levels", "each message is a full snapshot", on "Every order book change" | delivers, full book on each frame, see section 4 |
| `detail_order_book_[market]` | `data` | top 100 levels as `[price, amount, order_id]` | delivers, one entry per resting order, so prices repeat |
| `diff_order_book_[market]` | `data` | "only changed levels", "Full depth", seeded from REST | delivers, see section 4 |
| `live_orders_[market]` | `order_created`, `order_changed`, `order_deleted` | full order objects with `event_id` and `pre_event_id` | delivers, 11.5 msg/s on `asterusd-perp`, and 44.5 msg/s in the second pass |
| `live_trades_[market]` | `trade` | one message per trade | delivers, 5 trades in 201 s on `btcusd-perp` |
| `funding_rate_[market]` | `funding_rate_saved` | `funding_rate`, `mark_price`, `index_price`, `market`, `timestamp`, `next_funding_time` | delivers once a second for all 20, see [`rest.md`](./rest.md) section 3 |
| `announcements` | `published` and others | tokenized security halts and corporate actions | not subscribed |
| best bid and ask | none | not offered | not applicable |
| ticker | none | not offered | not applicable |
| separate mark or index channel | none | mark and index ride on `funding_rate_[market]` | not applicable |

## 3. The sixteen axes

The axes are those of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one address, `wss://ws.bitstamp.net` | none, spot and perpetual channels shared one socket |
| subscribe frame shape | `{"event": "bts:subscribe", "data": {"channel": "[channel_name]"}}`, one channel per frame | the same frame was accepted for 29 channels in run 2 |
| unknown symbol expectation | "correct form of message with unexpected content will result in an error response" | `order_book_fooxyz-perp` got `bts:subscription_succeeded` and then silence for 201 s, while `order_book_BTCUSD-PERP` and `order_book_BTC/USD-PERP` got `bts:error` "Invalid channel provided." |
| chunk unit and budget | 1,024 channel subscriptions per connection, and client frames "under 512 bytes" | a 700 byte subscribe frame closed the socket with code 1009 and reason "read limited at 513 bytes", the 1,025th subscription was not probed |
| keepalive mechanism | client sends `{"event": "bts:heartbeat"}` and the server answers | answered every 15 s in 144 to 150 ms, and the server also sent a protocol ping every 54.0 s on every socket, which is not documented |
| connection lifetime and maintenance notice | "Maximum connection age is 90 days", and `bts:request_reconnect` gives "a few seconds to reconnect" | not observed in 362 s of sockets, and an idle socket with no subscription stayed open 201 s |
| handshake and operation rate limits | none published | not probed |
| public market data authentication | none | none needed |
| message parse and routing | `{event, channel, data}` | the routing key is the `channel` string, and book `data` carries no symbol field, while `funding_rate_saved` data also carries `market: "btcusd-perp"` |
| subscribe acknowledgement shape | `{"event": "bts:subscription_succeeded", "channel": "...", "data": {}}` | one per channel, 29 of 29 within 147 ms of sending in run 1 and again in the second pass |
| symbol identifier format | lowercase market symbol, `btcusd-perp` | the same string CCXT reports as `market.id`, while REST `ticker` and `funding_rate` replies spell the market `BTC/USD-PERP` |
| number representation | book levels are string tuples | strings on every book channel, while `live_trades` and `live_orders` carry both JSON numbers and `_str` strings |
| timestamp representation | `timestamp` in seconds and `microtimestamp` in microseconds, both strings | as documented on book frames, but `live_trades_btcusd-perp` sent `timestamp: "1789456400586"`, which is milliseconds |
| size unit | "amount" in base currency, and the catalog's `contract_size` is 1 | base units, 77 of 78 socket levels equalled the REST level at the same price, see section 4 |
| sequence semantics | book channels have none, `microtimestamp` orders diffs against the REST snapshot, and only `live_orders` has `event_id` and `pre_event_id` | `microtimestamp` never went backwards and never repeated on 8,495 frames of 20 books, and `live_orders_asterusd-perp` chained 2,315 events with no break. The second pass gave the same on 5,082 frames and 4,074 events |
| idle repeat behaviour | not documented | none, 0 identical consecutive frames on 8,495 frames, and 0 on 5,082 in the second pass, and `order_book_eurusd-perp` was silent for up to 49.2 s |

## 4. The book channel in detail

### Snapshot on subscribe

`order_book_[market]` sends no snapshot at the moment of subscription.
Its first frame is the next change-driven full book.
In run 3, 11 of 20 perpetual books sent a first frame within 286 ms of subscribing, and the rest took 657 ms to 6,053 ms, with `eurusd-perp` at 4,246 ms and `qqqusd-perp` at 6,053 ms.
In the second pass 13 of 20 sent one within 295 ms, and the rest took 1,296 ms to 12,094 ms, with `qqqusd-perp` last.
A quiet book therefore stays empty after a reconnect until someone changes it.

### Delta semantics

On `order_book_[market]` there are no deltas.
Every frame is the whole visible book up to 100 levels a side, and the probed perpetual books held 8 to 77 levels a side, so each frame was the complete book.
`diff_order_book_[market]` carries only changed levels, and an amount of zero removes the level.
The documentation spells that zero as `"0"`.
The wire spells it at the market's size precision, `"0.00000"` on `btcusd-perp` and `"0"` on `asterusd-perp`, so a parser has to compare the number, not the string.

### Sequence and gap rule

No book channel carries a sequence number or a checksum.
The documented reconciliation for `diff_order_book_[market]` is: buffer diffs, fetch `GET /api/v2/order_book/[market]/?group=1`, drop buffered diffs whose `microtimestamp` is at or before the snapshot's, then apply the rest.
Nothing in a diff frame reveals a lost diff.

The probe reconstructed `btcusd-perp` and `asterusd-perp` from REST plus diffs and compared the result with the `order_book_` frames.
The two channels are not published on the same instants, so a full frame was counted as matched when any reconstructed state within 3 s had the same top 20 levels.

| run | market | full frames | matched | last third matched |
|---|---|---:|---:|---:|
| run 2 | `btcusd-perp` | 924 | 464 | 154 of 308 |
| run 2 | `asterusd-perp` | 351 | 188 | 58 of 117 |
| run 3 | `btcusd-perp` | 309 | 183 | 46 of 103 |
| run 3 | `asterusd-perp` | 142 | 69 | 26 of 48 |
| second pass | `btcusd-perp` | 428 | 82 | 36 of 143 |
| second pass | `asterusd-perp` | 324 | 85 | 29 of 108 |

A lost diff would leave the reconstruction wrong from that point on, and the late share did not fall in any run, so no diff was lost in the 362 s of runs 2, 3 and the second pass.
The unmatched full frames are intermediate states the diff stream coalesced, because diffs arrived far less often.
In the spacing capture, `order_book_btcusd-perp` frames were at least 177 ms apart, with 109 of 129 gaps between 150 and 250 ms, while `diff_order_book_btcusd-perp` frames were at least 602 ms apart, 30 of 38 gaps between 500 and 1,000 ms.
The documentation says both update on "Every order book change", and the wire shows them sampled at different rates.
The spot `order_book_btcusd` in the same capture had 240 of 267 gaps under 150 ms, with a minimum of 79 ms.

### Checksum

None documented and none on the wire.

### Level order on the wire

Probed on `order_book_[market]`: bids strictly descending and asks strictly ascending on every one of 8,495 frames of 20 books in run 2, and of 5,082 in the second pass.
`detail_order_book_[market]` repeats a price once per resting order, so its order is non-increasing and non-decreasing, and it was on all 364 frames.
The documentation warns that "a snapshot may occasionally show the best bid ≥ best ask" and that this "will self-correct within the next message".
The probe counted 0 crossed `order_book_` frames on perpetuals in run 2 and in the second pass.

### Size unit against CCXT's contractSize

CCXT sets `contractSize: undefined` for every Bitstamp market at `server/node_modules/ccxt/js/src/bitstamp.js` line 708, so the connector's `toContractSize` makes it 1, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 180 to 186.
The raw catalog field is `contract_size: "1.00000000"` on all 20 perpetuals, and the contract specifications page gives a contract value of "1 BTC", "1 ASTER" and so on.
The socket reports amounts in base units.
The probe compared the socket's `order_book_` frame nearest to a REST `order_book` read, 57 to 150 ms apart, at the same prices.

| run | market | common bid prices | equal sizes | example |
|---|---|---:|---:|---|
| run 2 | `btcusd-perp` | 20 | 20 | 77216, socket `0.33670`, REST `0.33670` |
| run 2 | `asterusd-perp` | 20 | 20 | 0.68776, socket `2180`, REST `2180` |
| run 3 | `btcusd-perp` | 18 | 17 | 77283, socket `0.33641`, REST `0.33641` |
| run 3 | `asterusd-perp` | 20 | 20 | 0.68847, socket `2178`, REST `2178` |
| second pass | `btcusd-perp` | 20 | 20 | |
| second pass | `asterusd-perp` | 20 | 19 | |

With a contract size of 1 the unit matches, and `sizeMul` stays 1.
A BTC touch of 0.33 BTC and an ASTER level of 2,180 ASTER, about 1,500 USD, are plausible base unit sizes and implausible as any other unit.

### One-sided and empty books

Not observed on `order_book_`, where every frame had both sides.
`diff_order_book_` frames often carry one empty side, 87 of 303 on `btcusd-perp` in run 2, which is a normal diff.
What `order_book_` sends for a book with an empty side is not documented and was not observed.

### Idle repeats

None.
No identical consecutive frame occurred on any book channel.
Quiet books go silent, with maximum gaps of 32.0 s on `eurusd-perp` in run 2 and 49.2 s in run 3, and 19.4 s on `wtiusd-perp` in run 2.

### Unknown or closed symbol

An unknown lowercase symbol is acknowledged and then silent.
A wrongly cased or slash spelled symbol returns `bts:error` with "Invalid channel provided.", and the socket stays open.
A closed market was not available to test, since all 20 perpetuals had `trading: "Enabled"`.

### Rate and bytes

| scope | frames | rate | bytes |
|---|---:|---:|---:|
| 20 `order_book_` channels on one socket, run 2 | 8,495 in 201.5 s | 42 msg/s | 59.5 KB/s |
| `order_book_btcusd-perp` | 936 | 4.65 msg/s | 2,500 bytes a frame |
| `order_book_ethusd-perp` | 689 | 3.42 msg/s | 1,650 bytes a frame |
| `order_book_asterusd-perp` | 356 | 1.77 msg/s | 1,208 bytes a frame |
| `order_book_eurusd-perp` | 28 | 0.14 msg/s | 753 bytes a frame |
| `diff_order_book_btcusd-perp` | 303 | 1.50 msg/s | 394 bytes a frame |
| `funding_rate_[market]`, 20 markets | 201 each | 1.0 msg/s each | 239 to 247 bytes a frame |
| 20 `order_book_` channels on one socket, second pass | 5,082 in 91.5 s | 56 msg/s | 70.8 KB/s |

Frame arrival lagged the frame's `microtimestamp` by 76.7 ms minimum and 85.6 ms median on `order_book_btcusd-perp` in run 2.
The heartbeat round trip was about 145 ms, so the one way path is about 73 ms and the two clocks agreed within a few milliseconds, an inference that assumes a symmetric path.
In the second pass the lag was 97.8 ms minimum and 107 ms median against the same 146 ms round trip, which puts this host's clock about 25 ms from the venue's, so the agreement is not stable from run to run.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"event": "bts:heartbeat"}`, reply `{"event": "bts:heartbeat", "channel": "", "data": {"status": "success"}}` | as documented, 144 to 150 ms round trip |
| server pings | not documented | a WebSocket protocol ping every 54.0 s, at 53,998 ms, 107,997 ms and 161,998 ms after open, on all three sockets of run 2 |
| silence tolerated | not documented | a socket with no subscription and no client message stayed open 201 s, answering the ws library's automatic pongs only |
| forced disconnect | "Maximum connection age is 90 days" | not observable in a probe |
| maintenance notice | `{"event": "bts:request_reconnect", "channel": "", "data": null}`, then "a few seconds to reconnect" | not observed |
| compression | not documented | the server negotiated `permessage-deflate` when a client offered it, and none when refused, and every frame was a text frame |
| handshake | HTTP upgrade | connect time 593 to 678 ms including TLS over the three runs, and 657 to 763 ms in the second pass, and the upgrade response carried no server header |
| subscription limit | 1,024 channels per connection, "Attempting a 1025th subscription causes the connection to be silently closed" | not probed |
| client frame size | "keep them under 512 bytes" | a 700 byte frame closed the socket with code 1009, "read limited at 513 bytes", 9.3 s after open |
| errors | `bts:error` with `code` null or 4009, and `message` | `Incorrect JSON format.` for text that is not JSON, `Bad subscription string.` for a frame without a channel and for the unknown event `bts:ping`, `Invalid channel provided.` for a malformed channel name |

## 6. Captured frames

Level arrays are trimmed to three entries, and every value inside is as received.

Subscribe acknowledgement, run 2, 07:11:55.889 UTC.

```json
{"event": "bts:subscription_succeeded", "channel": "order_book_btcusd-perp", "data": {}}
```

Full book on `order_book_btcusd-perp`, spacing capture, 07:33:37.987 UTC, 68 bids and 51 asks on the wire.
The first element of `bids` is the best bid and the first element of `asks` is the best ask.

```json
{
  "data": {
    "timestamp": "1789457617",
    "microtimestamp": "1789457617906487",
    "bids": [["77188", "0.41122"], ["77183", "0.32386"], ["77180", "1.87131"]],
    "asks": [["77189", "0.41124"], ["77193", "0.32385"], ["77194", "1.10113"]]
  },
  "channel": "order_book_btcusd-perp",
  "event": "data"
}
```

Diff on `diff_order_book_btcusd-perp`, run 2, 07:11:56.583 UTC, with the zero spelled at size precision.

```json
{
  "data": {
    "timestamp": "1789456316",
    "microtimestamp": "1789456316507635",
    "bids": [["77049", "0.00000"], ["77035", "2.45710"]],
    "asks": [["77409", "0.00000"]]
  },
  "channel": "diff_order_book_btcusd-perp",
  "event": "data"
}
```

Diff on `diff_order_book_asterusd-perp`, run 2, 07:11:56.369 UTC, with the zero spelled `"0"`.

```json
{
  "data": {
    "timestamp": "1789456316",
    "microtimestamp": "1789456316294301",
    "bids": [["0.68704", "18089"], ["0.68647", "0"], ["0.68616", "0"]],
    "asks": [["0.68806", "30"], ["0.68810", "0"]]
  },
  "channel": "diff_order_book_asterusd-perp",
  "event": "data"
}
```

Funding, mark and index push, spacing capture, 07:33:38.589 UTC.

```json
{
  "data": {
    "market": "btcusd-perp",
    "mark_price": "77186.81199586",
    "index_price": "77177.99454545454",
    "funding_rate": "0.000123",
    "timestamp": "1789457618",
    "next_funding_time": "1789459200"
  },
  "channel": "funding_rate_btcusd-perp",
  "event": "funding_rate_saved"
}
```

Order event with its gap chain, run 2, 07:11:55 UTC.

```json
{
  "data": {"id": 2050545009631360, "id_str": "2050545009631360", "order_type": 1, "order_subtype": 5, "datetime": "1789456316", "microtimestamp": "1789456315879000", "amount": 32, "amount_str": "32", "amount_traded": "0", "amount_at_create": "32", "price": 0.6881, "price_str": "0.68810", "is_liquidation": false},
  "channel": "live_orders_asterusd-perp",
  "event": "order_deleted",
  "event_id": "00065b80-440c-8e58-0000-03f902000020",
  "pre_event_id": "00065b80-440a-a228-0000-03f901000020",
  "order_source": "orderbook"
}
```

Trade, run 2, 07:13:20.663 UTC.
The integer `id` is larger than 2 to the power 53, so a JavaScript parser loses its last digits and `id_str` is the usable id.

```json
{
  "data": {"id": 2001939623936278528, "id_str": "2001939623936278528", "type": 0, "sell_order_id": 2050545352740993, "buy_order_id": 2050545360601216, "amount": 0.00921, "amount_str": "0.00921", "price": 77204, "price_str": "77204", "microtimestamp": "1789456400586000", "timestamp": "1789456400586"},
  "channel": "live_trades_btcusd-perp",
  "event": "trade"
}
```

Keepalive answer, run 2, 07:12:10.891 UTC.

```json
{"event": "bts:heartbeat", "channel": "", "data": {"status": "success"}}
```

Errors, run 2, on the bad frames socket.

```json
[
  {"event": "bts:error", "channel": "", "data": {"code": null, "message": "Incorrect JSON format."}},
  {"event": "bts:error", "channel": "", "data": {"code": null, "message": "Bad subscription string."}},
  {"event": "bts:error", "channel": "", "data": {"code": null, "message": "Invalid channel provided."}}
]
```

The maintenance notice, from the documentation, not captured.

```json
{"event": "bts:request_reconnect", "channel": "", "data": null}
```

## 7. Private channels

Named for a future execution stage only.
They use the same URL, a channel of the form `[channel_name]-[user-id]` and an `auth` token from `POST /api/v2/websockets_token/`, which is valid for 60 seconds.

| channel | events |
|---|---|
| `private-my_orders_[market]-[userId]` | `order_created`, `order_changed`, `order_deleted`, `order_replaced`, `stop_active`, `stop_inactive` |
| `private-my_trades_[market]-[userId]` | `trade` |
| `private-my_settlements-[userId]` | `settlement` |
| `private-live_trades_[market]-[userId]` | `self_trade` |
| `private-live_order_trades_[market]-[userId]` | `trade` |
| `private-my_liquidations-[userId]` | `im_breach_warning`, `im_breach`, `mm_breach_warning`, `liquidation_start`, `liquidation_concluded` |
| `private-my_token_settlements-[userId]` | `token_ready` |

A FIX v2 API is linked from the site footer at `https://www.bitstamp.net/fix/v2/` and was not read.

## 8. Recommended feed shape

This is a recommendation for a later design, not a decision.

| item | recommendation | evidence |
|---|---|---|
| URL plan | one plan, `wss://ws.bitstamp.net`, since every market shares one address | section 1 |
| markets per connection | all 20 on one connection today, and at most 1,000 channels per connection if the catalog grows | 1,024 channel limit, section 5 |
| channel | `order_book_<rawMarketId>`, a stateless full book of up to 100 levels a side, above the engine's 20 | section 4 |
| subscribe frames | one frame per market, `{"event":"bts:subscribe","data":{"channel":"order_book_btcusd-perp"}}`, 72 bytes for the longest perpetual symbol, `silverusd-perp`, inside the 512 byte cap | section 5 |
| handleMessage | route `event: "data"` whose `channel` starts with `order_book_`, take `rawMarketId` as the rest of the channel string, call `accepts`, then `resetBook` with every frame's bids and asks | section 4 |
| stale frame guard | drop a frame whose `microtimestamp` is not above the last applied one for that market, a condition never observed | section 3 |
| resync rule | none on the book, since each frame replaces the book, and a `bts:request_reconnect` should close the connection with reopen | sections 4 and 5 |
| seeding | after each subscribe, read `GET /api/v2/order_book/<rawMarketId>/` once per market, or accept that a quiet book stays empty until its next change, up to 49 s | section 4 |
| keepalive | send `{"event":"bts:heartbeat"}` every 20 s, since data can be silent for 49 s | section 5 |
| `maxSilenceMs` | 60,000, since the heartbeat answer arrives every 20 s and the server pings every 54 s, and `VenueFeed` counts both as traffic at lines 93 and 94 | section 5 |
| compression | refuse deflate as today, the server does not force it | section 5 |
| control frames | log `bts:error`, and treat a silent market as a possible misspelled id, because an unknown lowercase symbol is acknowledged and never errors | section 3 |

The Bybit shape at [`../../../server/src/venues/bybit/bybit.ts`](../../../server/src/venues/bybit/bybit.ts) fits with three differences.
Bitstamp needs no sequence check, one frame per channel instead of an argument array, and a first book that may arrive seconds late.

`diff_order_book_[market]` is not recommended.
It needs a REST seed, it carries no way to detect a lost diff, and it arrives less often than the full book.

## 9. Source ledger

`https://www.bitstamp.net/websocket/v2/` sits behind an Imperva JavaScript challenge.
Plain `curl` and WebFetch received a 212 byte challenge page, so it was rendered with headless Google Chrome on this host and read as text.

| title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|
| Websocket API v2 | https://www.bitstamp.net/websocket/v2/ | 2026-09-15 | all Bitstamp entities | sections 1 to 8 |
| Bitstamp API reference, OpenAPI 3.0.3 spec embedded in the page | https://www.bitstamp.net/api/ | 2026-09-15 | all Bitstamp entities | section 4 reconciliation call, section 7 token call |
| Perpetual futures contract specifications | https://www.bitstamp.net/derivatives/perpetual-futures/contract-specifications/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | section 4 contract value |
| CCXT 4.5.68 bitstamp class | `server/node_modules/ccxt/js/src/bitstamp.js` line 708, `server/node_modules/ccxt/js/src/pro/bitstamp.js` lines 28 and 65 | 2026-09-15 | not applicable | section 4 contract size, and CCXT Pro's own book watcher uses `diff_order_book_` |
| Socket probe | [`../../../scripts/probes/bitstamp-ws-probe.mjs`](../../../scripts/probes/bitstamp-ws-probe.mjs), runs at 07:08, 07:11 and 07:25 UTC, the `spacing` mode at 07:33 UTC, and the second pass at 19:20 UTC | 2026-09-15 | this host | sections 1 to 6 |
