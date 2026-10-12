# Coinmate WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:42 to 03:59 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Coinmate lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/coinmate/ws-probe.py) unless a source id says otherwise.
The first run held its windows at full length, and the second pass reran every mode with `--short`, which halves each window.
Source ids S1 to S6 are those of [`fees.md`](./fees.md) section 10.
The short answer is that `order_book-<PAIR>` pushes the whole book of one pair, 100 price levels a side, about every 1.5 s while the book changes and not at all while it is still.
It carries no sequence, no checksum and no timestamp, and it sends nothing on subscribe, so a feed has to seed each book from REST.

## 1. Endpoints

| endpoint | public market data | probed |
|---|---|---|
| `wss://coinmate.io/api/websocket` | version 2.0, one URL, channels chosen by subscribe frames, S3 | HTTP 101 through Cloudflare's `YVR` edge, no `Sec-WebSocket-Extensions` in the reply |
| `wss://coinmate.io/api/websocket/channel/<topic>/<PAIR>` | version 1.0, one URL per channel, subscribed on connect, S3 | `.../channel/order-book/BTC_EUR` upgraded and pushed the same book frames |
| `wss://coinmate.io/frontend/websocket/channel/order-book/<PAIR>` | the web app's own socket, found in its bundle, not documented | not opened |

One version 2.0 socket carries every pair and every public channel.
The probe held five subscriptions on three pairs over one socket, and six on six thin pairs over another.
The web app pings with `{"event":"ping"}` after 10 s without a message, from its bundle.

## 2. Channel matrix for public market data

| data | channel, version 2.0 | version 1.0 path | probed |
|---|---|---|---|
| book | `order_book-<PAIR>` | `/order-book/<PAIR>` | full book pushes, see section 4 |
| best bid and ask | none on a socket | | the REST ticker has `bid` and `ask`, see [`rest.md`](./rest.md) section 5 |
| trades | `trades-<PAIR>` | `/trades/<PAIR>` | acknowledged, and no push in 120 s, because `BTC_EUR` did not trade |
| statistics | `statistics-<PAIR>` | `/trade-stats/<PAIR>` | acknowledged, and no push in 120 s |
| mark, index, funding | Not offered | | no perpetuals, see [`fees.md`](./fees.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL in version 2.0, one URL per channel in version 1.0, S3 | both work |
| subscribe frame shape | `{"event":"subscribe","data":{"channel":"trades-BTC_EUR"}}`, S3 | as documented |
| unknown symbol expectation | an `error` event with a `message`, S3 | `{"message":"Websocket error","event":"error"}`, with no channel named, see section 4 |
| chunk unit and budget | Not publicly specified | one channel per frame, and six subscriptions on one socket were all served |
| keepalive mechanism | the server sends `ping` "every x seconds", and a client `ping` gets a `pong`, S3 | `{"event": "ping"}` every 29.1 to 29.4 s on a socket with no subscription, none on a socket with book traffic, and `{"event":"pong"}` to a client ping |
| connection lifetime and maintenance notice | Not publicly specified | no close and no notice within 150 s |
| handshake and operation rate limits | Not publicly specified | every open and every subscribe was accepted |
| public market data authentication | none, S3 | none needed |
| message parse and routing | `event` is `data`, `ping`, `pong`, `subscribe_success`, `unsubscribe_success` or `error`, S3 | book frames are `{"event":"data","channel":"order_book-BTC_EUR","payload":{...}}`, route by `channel` |
| subscribe acknowledgement shape | `subscribe_success`, S3 | `{"event":"subscribe_success","data":{"channel":"order_book-LTC_EUR"}}`, one per subscribe, a repeat included |
| symbol identifier format | `{CURRENCY_PAIR}` such as `BTC_EUR`, S3 | upper case with an underscore, and `btc_eur` drew an error |
| number representation | Not publicly specified | JSON numbers, not strings |
| timestamp representation | Not publicly specified | no timestamp in a book frame |
| size unit | Not publicly specified | units of the base asset, the same as the REST book |
| sequence semantics | none documented | none on the wire, every push is a whole book |
| idle repeat behaviour | Not publicly specified | pushes come about every 1.5 s while the book moves, stop while it is still, and some repeat the previous book exactly, see section 4 |

## 4. The book channel in detail

### Snapshot on subscribe

No.
The `subscribe_success` ack comes alone, and the first book arrives with the venue's next push for that pair.
On six thin pairs in the first run, the first book came 0.74, 0.84, 0.79 and 2.25 s after the ack on `ADA_CZK`, `XRP_CZK`, `LTC_CZK` and `SOL_CZK`, 9.66 s after it on `ETH_BTC`, and never within 60 s on `USDC_CZK`.
In the second pass it came 0.62, 0.76, 14.16, 10.98 and 0.54 s after the ack on the same five, and again never within 30 s on `USDC_CZK`.
So a quiet pair can stay empty on a fresh subscription for as long as it stays quiet.

### Delta semantics

None.
Every push is a whole book: `payload` holds `bids` and `asks` and nothing else.
In 120 s the first run carried 59 pushes on `BTC_EUR`, 67 on `BTC_CZK` and 32 on `ETH_EUR`, and in 60 s the second pass carried 28, 32 and 14.
`BTC_EUR` and `BTC_CZK` held 100 bids and 100 asks in every push, and `ETH_EUR` held 100 asks and 66 to 69 bids, so a side shorter than 100 is the whole side.
A book frame is about 22.7 KB, with a largest of 23,260 bytes.

### Sequence and gap rule

There is no sequence, update id, previous id or timestamp on the wire, and the document names none, S3.
Because every push is complete, there is no gap to detect.
A feed takes the newest push, but it cannot age it by a venue timestamp.

### Checksum

None documented and none on the wire.

### Level order on the wire

Bids are sorted best first, descending by price, and asks best first, ascending.
No push in any run was crossed, and no level had size zero.
Each level is an object with five fields: `price`, `amount`, `amountSum`, the running total of `amount` from the top, `cumulativePrice`, the running total of price times amount, and `wholePartDiffers`, a display flag.

### Rows are price levels

No push in the second pass repeated a price within a side, across 74 pushes on three pairs, and neither did the two version 1.0 pushes it summarised.
The socket book is therefore grouped by price, like the REST book with `groupByPriceLimit=True` and unlike the `False` form CCXT uses, see [`rest.md`](./rest.md) section 5.

### Level window

The document names no depth, and the probe saw at most 100 rows a side.
There is no depth parameter on the subscribe frame.

### Size unit

Sizes are in the base asset.
The `BTC_EUR` book showed `amount` values such as 0.01768501 against prices near 73,736 EUR, which is BTC.
Coinmate has no contracts, so there is no `contractSize` to reconcile.

### One-sided and empty books

None was seen.
A side shorter than 100 rows was seen on `ETH_EUR`, see the delta semantics above.

### Idle repeats

Pushes on a moving book came at a median interval of 1.50 to 1.63 s on all three pairs in both runs.
The longest interval was 6.0 s on `BTC_EUR` and 18.0 s on `ETH_EUR` in the first run, and 4.6 s and 13.6 s in the second.
On the thin pairs the longest gap was 10.5 to 16.5 s in the first run and 1.4 to 13.5 s in the second.
The minimum interval was 1.36 s, so the server batches on a cadence of about 1.5 s.
Some pushes matched the previous push of the same pair exactly: 3 of 59 on `BTC_EUR`, 28 of 67 on `BTC_CZK` and 3 of 32 on `ETH_EUR` in the first run, and 0 of 28, 6 of 32 and 3 of 14 in the second.
The likely reading is that the server pushes on any order book event, including one deeper than 100 rows, and stays silent otherwise.
So silence on a book channel is normal and is not a sign of a dead socket.

### Unknown, closed and wrong-level symbols

| sent | reply |
|---|---|
| `order_book-FOO_BAR` | `{"message":"Websocket error","event":"error"}` |
| `order_book-btc_eur` | `{"message":"Websocket error","event":"error"}` |
| channel `depth-BTC_EUR` | `{"message":"Websocket error","event":"error"}` |
| `{"event":"subscribe"}` with no `data` | `{"message":"Websocket error","event":"error"}` |
| event `hello` | `{"message":"Websocket message parse error","event":"error"}` |
| text that is not JSON | `{"message":"Websocket message parse error","event":"error"}` |
| `{"event":"ping"}` | `{"event":"pong"}` |
| a second subscribe to `order_book-LTC_EUR` | a second `subscribe_success` |
| `unsubscribe`, twice | `unsubscribe_success` both times |

No error closed the socket.
The error frames name no channel, so a feed cannot tell which subscription failed from the error alone, and the absence of a `subscribe_success` is the signal.

## 5. Session

| item | value |
|---|---|
| keepalive | the server sends `{"event": "ping"}` about every 29.3 s while a socket carries nothing, and sent none in either run while book frames flowed |
| silence the server tolerates | an idle socket that never answered a server ping stayed open for 150 s, and the second pass for 75 s |
| client pings | optional, `{"event":"ping"}` gets `{"event":"pong"}`, and the web app sends one after 10 s of silence |
| forced disconnects | none within 150 s |
| maintenance notices | none documented, none seen |
| compression | an offer of `permessage-deflate` was not accepted, the reply carried no extension |
| handshake and subscription limits | Not publicly specified |

## 6. Captured frames

A subscribe acknowledgement:

```json
{"event":"subscribe_success","data":{"channel":"order_book-LTC_EUR"}}
```

A book push from the second pass, trimmed to two levels a side, with `event` last on the wire as the server sends it:

```json
{"channel":"order_book-BTC_EUR","payload":{
  "bids":[{"price":73754.8,"amount":0.01768059,"amountSum":0.01768059,"cumulativePrice":1304.0283,"wholePartDiffers":true},
          {"price":73714.2,"amount":0.01353945,"amountSum":0.03122004,"cumulativePrice":2302.0781,"wholePartDiffers":true}],
  "asks":[{"price":80046.5,"amount":0.00313574,"amountSum":3.31513790,"cumulativePrice":249737.3627,"wholePartDiffers":true},
          {"price":80063.4,"amount":0.00125404,"amountSum":3.31639194,"cumulativePrice":249837.7654,"wholePartDiffers":true}]},
 "event":"data"}
```

The two asks shown are the last two of the 100, which is why their `amountSum` is large.

A server keepalive on an idle socket, written with a space after the colon unlike every other frame:

```json
{"event": "ping"}
```

The answer to a client ping:

```json
{"event":"pong"}
```

An error:

```json
{"message":"Websocket error","event":"error"}
```

## 7. Private channels

Version 2.0 names `private-open_orders-{ACCOUNT_ID}`, `private-user_balances-{ACCOUNT_ID}`, `private-user-trades-{ACCOUNT_ID}` and `private-user-transfers-{ACCOUNT_ID}`, with an optional `-{CURRENCY_PAIR}` on orders and trades, S3.
They take `clientId`, `publicKey`, `signature` and `nonce` inside the subscribe frame's `data`, S3.
Version 1.0 serves them under `wss://coinmate.io/api/websocket/channel/my-*` with the same fields as query parameters, S3.
The open orders channel sends a snapshot after subscribing, S3.

## 8. Recommended feed shape

None for the engine as it stands.
Coinmate has no perpetual, so it has no place in the perpetual engine.

If a later design adds EUR or CZK spot legs, the shape would be:

- one socket to `wss://coinmate.io/api/websocket` for all 15 pairs, one `{"event":"subscribe","data":{"channel":"order_book-<PAIR>"}}` per pair.
- seed each book from `GET /api/orderBook?currencyPair=<PAIR>&groupByPriceLimit=True` after the ack, because the socket sends no snapshot, see [`rest.md`](./rest.md) section 5.
- replace the book on every push and keep the top 20 levels a side.
- send `{"event":"ping"}` every 10 s, as the web app does, and set `maxSilenceMs` to about 25,000 on the pong, not on book traffic, because a still book is silent for 18 s or more.
- treat an error frame as a failure of every subscription without a `subscribe_success`, since error frames name no channel.
- resubscribe and reseed after any reconnect.

## 9. Source ledger

The sources are S1 to S6 of [`fees.md`](./fees.md) section 10.
S3, the Apiary document last updated 2026-03-09, holds the WebSocket section this profile quotes, with both versions and the event list.
The web app's socket path and its 10 s ping come from its JavaScript bundle `main-L5RRYEF5.js` and its chunks at `https://coinmate.io/`, read on 2026-10-09.
