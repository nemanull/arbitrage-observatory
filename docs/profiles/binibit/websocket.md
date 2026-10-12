# Binibit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:58 to 04:17 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit in Canada.

This profile covers Binibit's perpetuals, a read-only preview of 27 USDT contracts, see [`fees.md`](./fees.md) section 3.
There is no public WebSocket for them.
Binibit documents no WebSocket API at all, and its FAQ answers "Is there a WebSocket API?" with "Not yet", S1.
The futures terminal polls REST instead, every 5 s for the book, S2.
What follows is how that was established, read from the web bundle and probed with [`ws-probe.py`](../../../scripts/probes/venues/binibit/ws-probe.py).
The source ids are listed in section 9, and `fees.md S<n>` points at the ledger of [`fees.md`](./fees.md).

## 1. Endpoints

| endpoint | protocol | what it carries | access | source |
|---|---|---|---|---|
| none for futures market data | | | | S2 |
| `wss://sockets-v2stage.binibit.com/sr/position-summary` | SignalR | a futures account's position summary | needs a login token and a futures account id | S2 |
| `wss://sockets-v2stage.binibit.com/sr/orderbook` | SignalR, JSON protocol | the spot book, event `OrderBook` | public | S3, probed |
| `wss://sockets-v2stage.binibit.com/sr/deals` | SignalR, JSON protocol | spot trades, event `MainDeals` | public | S3, probed |
| `wss://sockets-v2stage.binibit.com/sr/orders` | SignalR | the user's orders and deals | needs a login token | S3 |

- The socket base `https://sockets-v2stage.binibit.com` is a build-time constant of the production site, beside `internal-api-v2stage.binibit.com` and `identity-v2stage.binibit.com`, S3.
  The production web app talks to hosts named "v2stage".
- The futures page chunk calls six REST routes, `contracts`, `settings`, `ticker`, `orderbook`, `trades` and `candles`, and opens no public socket, S2.
  Its only hub is `/sr/position-summary`, built with an `accessTokenFactory`, S2.
- The spot hub accepts `ByCurrencyPair` for the futures symbol `BTCUSDT` with a null result, and then sends nothing for it, section 4.

## 2. Channel matrix for public market data

| channel | futures | spot |
|---|---|---|
| order book | no socket, REST poll every 5 s at depth 50 | `/sr/orderbook` event `OrderBook`, 40 levels a side |
| best bid and ask | no socket | top of `OrderBook` |
| trades | no socket, REST poll every 5 s | `/sr/deals` event `MainDeals` |
| ticker | no socket, REST poll every 15 s | none found |
| mark price | none anywhere | not offered |
| index price | none anywhere | not offered |
| funding | no socket, the contracts call every 60 s | not offered |

The poll intervals are the bundle's `pollMs` values 60000 for contracts, 300000 for settings, 15000 for the ticker, 5000 for the book, 5000 for trades and 15000 for candles, S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
For futures every axis is "no socket", so the table describes the public spot hub `/sr/orderbook`, the only public market data socket Binibit runs.
"Documented" is "none" throughout, because no socket is documented, S1.

| axis | documented | probed on the spot hub |
|---|---|---|
| endpoint split axis | none | one hub per stream kind, `/sr/orderbook` and `/sr/deals`, every pair on one socket |
| subscribe frame shape | none | SignalR handshake `{"protocol":"json","version":1}` then invocation `{"type":1,"target":"ByCurrencyPair","arguments":["BTC_USDT"]}`, each ended by the record separator 0x1E |
| unknown symbol expectation | none | `NOPE_XYZ` and the futures symbol `BTCUSDT` got completion `{"type":3,"result":null}` and then no events |
| chunk unit and budget | none | one pair per invocation, the client's `Unsubscribe` target removes it |
| keepalive mechanism | none | SignalR ping `{"type":6}`, 3 in 45 s |
| connection lifetime and maintenance notice | none | no close within 45 s |
| handshake and operation rate limits | none | not provoked |
| public market data authentication | none | none for `/sr/orderbook` and `/sr/deals`, with `skipNegotiation` and the WebSockets transport as the bundle uses |
| message parse and routing | none | SignalR type 1 frame whose single argument is a JSON string to parse again |
| subscribe acknowledgement shape | none | SignalR completion type 3 with the invocation id and `result` null |
| symbol identifier format | none | upper case `BASE_QUOTE`, such as `BTC_USDT` |
| number representation | none | JSON numbers, such as `"price":82617.28271728` |
| timestamp representation | none | per order `dateCreated` as ISO 8601 with offset, and no frame time |
| size unit | none | `amount` in base units |
| sequence semantics | none | none |
| idle repeat behaviour | none | 6 of the 7 `OrderBook` events after the first repeated the previous top of book unchanged, in the second run |

## 4. The book channel in detail

### Futures

There is no futures book channel.
The futures terminal reads `GET https://binibit.com/api/futures-public/orderbook?symbol=<SYMBOL>&depth=50` every 5 s, S2, and [`rest.md`](./rest.md) section 5 profiles that call.
Its book is Bybit's linear book passed through, [`rest.md`](./rest.md) section 5.

### Spot, for the record

The spot hub was probed only to establish that it carries no futures data.

- Each `OrderBook` event is a whole book of 40 bids and 40 asks for one pair, not a delta, with keys `currencyPairCode`, `bids` and `asks`.
- Each level is a full order object with `isBid`, `amount`, `price`, `postOnly`, `reservedAmount` and `dateCreated`.
- Events came 0.35 s to 15.53 s apart, with a median of 4.00 s in one run and 0.77 s in the other, 7 and 8 events for `BTC_USDT` in about 40 s each.
- No sequence, checksum or frame timestamp exists, so a gap cannot be detected and each event replaces the book.
- The spot top was about 0.2 % wide, best bid 82627.37 against best ask 82792.81 in the second run.

## 5. Session

Not applicable to futures, which have no socket.
On the spot hub the server sent SignalR pings, 3 in 45 s, and closed nothing within the hold.
`Sec-WebSocket-Extensions` was absent, so frames were not compressed.
The socket opened with HTTP 101 in 437 ms and 388 ms over two runs, through Cloudflare.
The bundle reconnects after 0, 2, 5, 10 and 30 s, S3.

## 6. Captured frames

From `ws-probe.py hub`, trimmed.

The handshake reply, an empty SignalR handshake object:

```json
{}
```

The completion for every `ByCurrencyPair` invocation, including the futures symbol `BTCUSDT`:

```json
{"type":3,"invocationId":"1","result":null}
```

A spot `OrderBook` event, whose argument is a JSON string, shown parsed and cut to one level:

```json
{"currencyPairCode":"BTC_USDT","bids":[{"currencyPairCode":"BTC_USDT","clientOrderId":null,"isBid":true,"amount":71.843,"price":82617.28271728,"isMarket":false,"postOnly":false,"selfTradePrevention":0,"reservedAmount":0.0,"dateCreated":"2026-10-10T04:05:53.581408+00:00"}],"asks":[]}
```

The server ping:

```json
{"type":6}
```

## 7. Private channels

- `/sr/position-summary` for a futures account, S2.
- `/sr/orders` with `ByAccount` and `UnsubscribeAccount`, events `AccountOrders` and `UserOrders`, S3.

Both take the login token through `accessTokenFactory`.

## 8. Recommended feed shape

No WebSocket feed is possible for Binibit's perpetuals.
If futures trading opens, the only feed is the REST book poll of [`rest.md`](./rest.md) section 8, and its data would duplicate Bybit's.
The engine should take Bybit's own feed instead.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Binibit API docs FAQ `https://docs.binibit.com/faq.md` and changelog `https://docs.binibit.com/changelog.md`, which puts WebSocket streams on the v2.0 roadmap | 2026-10-09 |
| S2 | futures page chunk, `https://binibit.com/_next/static/chunks/app/futures/%5Bpair%5D/page-536bcc3f24210dec.js` | 2026-10-09 |
| S3 | site chunks `https://binibit.com/_next/static/chunks/main-app-c1da2d460086521c.js` (socket base) and `https://binibit.com/_next/static/chunks/5216-a360efd825fdd4a1.js` (hub map) | 2026-10-09 |
