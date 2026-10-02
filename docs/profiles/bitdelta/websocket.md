# BitDelta WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:27 to 03:53 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public socket of BitDelta for its derivatives, which the venue's terms call perpetual contracts.
The public API documentation names two socket URLs and three events, all for spot, S1.
The derivatives events below were found in the script bundle of the venue's derivatives trade page, S2, and confirmed on the wire by [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs).
No documentation covers them.
The short answer is that the derivatives stream a two-sided quote per contract with no sizes and no depth, so there is no book channel for a feed to use.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| everything public | `wss://api.bitdelta.com/socket.io/?EIO=4&transport=websocket`, Socket.IO 4. S1 writes it as `wss://api.bitdelta.com/` and `wss://api.bitdelta.com/price_change`, which are the Socket.IO host and a namespace, not raw WebSocket paths. | open in 574 to 644 ms over two runs, W4 |
| namespace `/` | the website's `main` socket, S2 | derivatives quotes, spot rooms, W1 |
| namespace `/price_change` | the website's `pairs` socket, S1 and S2 | spot 24 h tickers as `prices`, W1 |
| namespace `/otc` | the website's `otc` socket, S2 | not probed |
| `wss://api.bitdelta.com/` as a raw WebSocket | | HTTP 404, W4 |
| Engine.IO polling | | `GET /socket.io/?EIO=4&transport=polling` answered 400 `{"code":0,"message":"Transport unknown"}` to curl, and so did `EIO=3`, so only the WebSocket transport is served |

One socket carries both the derivatives quotes and the spot rooms, because they share the `/` namespace.
The website connects with the auth object `{"token": "guest"}` when nobody is logged in, S2, and the probe sends the same.
A connect with no auth object at all was accepted too, W2.
`api.bitdelta.com` resolves to two Cloudflare addresses, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| event | namespace and subscription | payload | rate on 2026-09-22 |
|---|---|---|---|
| `prices_futures_v2` | `/`, pushed to every connected client with no join | an array of rows, each holding symbol, bid, ask, status, marketClosed, mid and tsMs in that order, 1 to 75 rows per frame, median 40 and 37 in the last two runs | 12.0 and 12.1 frames a second over four runs, 2.3 to 2.6 KB each, 89 of the 90 contracts seen in 60 s, all but `STOUSD`, whose status is `Not active`, W1 |
| `futures_prices` | `/`, after `42["join","BTCUSD"]` for a contract symbol | one contract per event, the arguments being symbol, mid, bid, ask, marketClosed and tsMs in that order | about 9.5 a second on `BTCUSD` and `ETHUSD`, 521 to 532 events in 55 s, and 206 to 218 on `ZENUSD`, W1 |
| `orderbook_limited` | `/`, after a join of a spot pair such as `BTCUSDT` | an object with `bids` and `asks` arrays of price and size pairs, and `pair`, numbers as JSON numbers | spot only, 2.1 to 2.7 frames a second over two spot rooms. A derivatives room never received it, W1 |
| `trades` and `spot_v2` | `/`, after a spot join | pair, side, price, size, ISO time and `"l"`, and pair, price, size and tsMs | spot only, W1 |
| `prices` | `/price_change`, no join | spot 24 h rows led by symbol and last price, for every pair | about 1 a second, 23 KB each, W1 |
| `campaign_leaderboard` | `/`, no join | a marketing leaderboard | 3 in 60 s, W1 |

No derivatives depth, trade, mark, index or funding event exists.
The website's derivatives page listens to exactly two market events, `futures_prices` and `prices_futures_v2`, and the rest of its socket keys are private, S2 and section 7.
The page's "order book" feature flag, `DERIVATIVE_ORDERBOOK`, gates the tab of the user's own open orders, and its call `futures/orderbook-v2` fetches them, S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host, three namespaces, S1 and S2 | derivatives and spot share namespace `/`, section 1 |
| subscribe frame shape | "First you have to join the room, then listen to the event", S1. No frame is shown. | `42["join","BTCUSD"]`, one room per packet, and the website sends the same, S2 |
| unknown symbol expectation | Not publicly specified | `42["join","NOPEUSD"]` and `42["join","btcusdt"]` get no reply and no data, W2 |
| chunk unit and budget | Not publicly specified | not needed, since `prices_futures_v2` carries every contract without a join |
| keepalive mechanism | Not publicly specified | Engine.IO server ping `2` every 25 s, the client answers `3`. The open packet says `"pingInterval":25000,"pingTimeout":20000` |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 120 s on a socket that answers pings, W3. No notice event seen |
| handshake and operation rate limits | "We recommend using the websocket for getting data as much as possible, as this will not count the request rate limit.", S1 | no refusal on any open or join |
| public market data authentication | none | the guest token or no auth object, both accepted |
| message parse and routing | Socket.IO event name, then the room's symbol inside the payload | `prices_futures_v2` routes on `row[0]`, `futures_prices` on `args[0]`, `orderbook_limited` on `pair` |
| subscribe acknowledgement shape | none | a join is never acknowledged. The namespace connect answers `40{"sid":"…"}` |
| symbol identifier format | `BTCUSDT` for spot, S1 | six letters for derivatives, `BTCUSD`, `NERUSD` for NEAR, `SHBUSD` for SHIB, see [`rest.md`](./rest.md) section 2 |
| number representation | JSON numbers in the S1 example | JSON numbers everywhere, W1 |
| timestamp representation | Not publicly specified | integer Unix ms in `tsMs`. The spot `trades` event carries an ISO string |
| size unit | Not publicly specified | none for derivatives, a quote carries no size. Spot sizes are base units |
| sequence semantics | none | none on any event. Every derivatives event is a whole quote, and every `orderbook_limited` frame is a whole book of up to 125 levels |
| idle repeat behaviour | Not publicly specified | the same bid and ask arrive again with a new `tsMs`, see section 4 |

## 4. The book channel in detail

There is no book channel for the derivatives.
This section records the quote events that stand in its place, and closes with the spot `orderbook_limited` event, because it is the only book the venue streams.

### Snapshot on subscribe

`prices_futures_v2` starts 0.8 to 0.9 s after the socket is created, with no join, W1.
`futures_prices` starts 0.26 to 0.28 s after the join and carries one contract, W1.
Each event is a whole quote, so the first event is the snapshot and every later event replaces it.

### Delta semantics

None.
A row replaces the contract's bid, ask and mid, and carries no size and no level beyond the touch.

### Sequence and gap rule

No sequence field exists.
`tsMs` is the only ordering hint, and a missed event is invisible.

### Checksum

None.

### Level order on the wire

One bid and one ask per contract.
No crossed quote was seen in 26,628 and 29,298 rows, W1.
The mid is `(bid + ask) / 2` rounded to the contract's price precision: `SOLUSD` read bid `118.92`, ask `118.99` and mid `118.95`, W1.

### Size unit against CCXT `contractSize`

No CCXT class exists and no size is sent, so the engine's `sizeMul` has nothing to multiply.

### Quote width

The quoted spread is wide on most contracts, W1 in two runs, and P2 read a median of 4,720 and 4,556 ppm over all 90 contracts from the REST quote.

| contract | median spread, ppm |
|---|---:|
| `BTCUSD` | 45 and 49 |
| `XRPUSD` | 150 and 148 |
| `ETHUSD` | 419 and 418 |
| `SOLUSD` | 588 and 586 |
| `ZENUSD` | 1,094 and 1,091 |
| `IOSUSD` | 2,079 and 2,051 |
| `BTCETH` | 2,119 and 2,128 |
| `SNXUSD` | 240,000, `0.22` against `0.28` unchanged for 60 s in both runs, and 230,769 to 274,510 in a third run at 03:52 UTC |
| median over 89 contracts | 4,566 and 4,559 |

### Update rate and staleness

| stream | contract | events in 60 s | median gap | p90 gap | max gap | arrival minus `tsMs`, median |
|---|---|---:|---:|---:|---:|---:|
| `prices_futures_v2` | `BTCUSD` | 562 and 553 | 82 ms | 163 and 164 ms | 326 and 332 ms | 136 and 134 ms |
| `prices_futures_v2` | `ZENUSD` | 235 and 235 | 164 and 165 ms | 501 and 491 ms | 1,539 and 1,211 ms | 140 and 139 ms |
| `prices_futures_v2` | all 89 | median 292 and 313 per contract | | | per contract max gap median 1,064 and 1,054 ms, largest 13,131 and 15,196 ms | 137 ms |
| `futures_prices` | `BTCUSD` | 524 and 521 in 55 s | 102 ms | 110 and 112 ms | 227 and 264 ms | 91 and 90 ms |

The two numbers in a cell are the two runs of W1 at 03:29 and 03:45 UTC.
The clock offset against the venue was 3 to 50 ms, and 7 to 9 ms on warm requests in the rerun, see [`rest.md`](./rest.md) section 7, so the arrival minus `tsMs` is mostly transit.

### One-sided and empty books

No quote with a zero or missing side was seen, and every row read `status` `Active` with `marketClosed` false, W1.
The one contract whose status is `Not active`, `STOUSD`, never appeared on the stream, while the REST snapshot still quoted it, W1 and P2.
The field `ismarketclosed` exists because the same platform lists contracts that close, and the page's text reads "Market is closed, please wait to get it opened to close your position", S2.

### Idle repeats

A contract whose quote has not moved is sent again with a new `tsMs`.
`SOLUSD` read bid `118.92` and ask `118.99` in four `prices_futures_v2` rows over 335 ms, W1.
In the run at 03:45 UTC 19,699 of 29,298 rows, 67 %, repeated the previous bid and ask of their contract, among them 512 of 552 on `SOLUSD`, 239 of 240 on `SNXUSD` and 113 of 553 on `BTCUSD`, and at 03:52 UTC 19,955 of 27,166, 73 %, W1.
`futures_prices` repeats the same way, 118 of 521 events on `BTCUSD` and then 245 of 534.
So a new event is not a new price, and an unchanged price is not a stale feed.

### Unknown and closed symbols

| request | reply | then |
|---|---|---|
| `42["join","NOPEUSD"]` | none | nothing |
| `42["join","btcusdt"]` | none | nothing |
| `42["join","BTCUSDT"]` twice | none | the socket stays open, whether frames double was not measured |
| `42["leave","BTCUSDT"]` | none | the socket stays open, whether the room stops was not measured |
| `42["subscribe","BTCUSD"]`, an unknown event | none | nothing |
| `40/nope,{"token":"guest"}` | `44/nope,{"message":"Invalid namespace"}` | the socket stays open |
| `40/price_change,` with no auth | `40/price_change,{"sid":"…"}` | accepted |
| plain text `hello` | the server closes the socket, code 1005, in both runs that sent it | |
| `42[not json` | the server closes the socket, code 1005, in the first run, where it was sent before the plain text | |

### The spot `orderbook_limited` event, for comparison

Each `ETHUSDT` frame was a whole book of 45 to 125 levels per side, and every frame on both rooms had bids descending and asks ascending, with no sequence and no timestamp, W1.
The `BTCUSDT` room delivered frames with only three bids, the best at `70000`, in the runs at 03:29 and 03:45 UTC, and at 03:45 one frame with no asks at all, W1, and the REST book showed the same three bids at 03:37 UTC, see [`rest.md`](./rest.md) section 5.
Spot is outside this survey's scope beyond its coverage line, so this event was not studied further.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | server ping `2` at 25.6, 50.8, 75.9 and 101.1 s in both runs, the client answers `3`, W3 |
| silence the server tolerates | `"pingTimeout":20000` in the open packet | a socket that stops answering pings closed at 45.6 s in both runs, one ping plus 20 s, with code 1005 and no close reason. A socket that answers pings but never connects a namespace also closed at 45.6 s, which matches Socket.IO's default `connectTimeout` of 45 s, an inference. A socket that connects and answers stayed open for the full 120 s, W3 |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a permessage-deflate offer got no `sec-websocket-extensions` header back, so it is not negotiated. On `EIO=3` the first frame arrived with RSV1 set and the `ws` library refused it with "Invalid WebSocket frame: RSV1 must be clear", W4 |
| handshake | | 574 to 644 ms to open over two runs, then the open packet `0{"sid":…,"upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}` |
| subscription limits | Not publicly specified | not needed for the derivatives, which need no join |
| throughput | | `prices_futures_v2` 12.0 to 12.1 frames a second at 2.3 to 2.6 KB, 28 to 32 KB a second for all 90 contracts |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-22.
Arrays marked `…` are cut.

Open packet, and the namespace connects the probe sent and their answers.

```text
0{"sid":"SO0y4v3RU0Fg_S2ZAEgJ","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40{"token":"guest"}
40/price_change,{"token":"guest"}
40{"sid":"nEejZAdqmiBYsd68AIuZ"}
40/price_change,{"sid":"_zq_DOZAxFxaGgkcAIua"}
```

All-contract quotes, three rows kept.

```text
42["prices_futures_v2",[["LTCUSD",63.235,63.535,"Active",false,63.385,1790134183269],…,["BNBUSD",795.471,795.499,"Active",false,795.485,1790134183273],…,["LTCBTC",0.00071979,0.00074329,"Active",false,0.00073154,1790134183274],…]]
```

One contract after `42["join","BTCUSD"]`, fields symbol, mid, bid, ask, marketClosed, tsMs.

```text
42["futures_prices","BTCUSD",86649.282,86647.335,86651.229,false,1790134188380]
```

Spot book after `42["join","ETHUSDT"]`, two levels per side kept.

```text
42["orderbook_limited",{"bids":[[2767.99,2.0643132],[2767.89,2.3769182],…],"asks":[…],"pair":"ETHUSDT"}]
```

Keepalive, server first.

```text
2
3
```

Error.

```text
44/nope,{"message":"Invalid namespace"}
```

## 7. Private channels

Named for a future execution stage, from the socket keys in the derivatives page bundle, S2, not probed.
They arrive on the same `/` namespace once the auth token is a user's token.

- `futures_user_positions_v2`, `futures_user_balances`, `futures_user_open_orders_v2`, `futures_user_mode`, `futures_user_txs_v2`, `futures_user_order_history_v2`, `futures_user_trades_v2`, `user_profile`, `user_balances`, `kyc_level`.
- Orders are placed over REST, `futures/limit-order` and `futures/market-order`, S2.

## 8. Recommended feed shape

None.
The engine's feed keeps `depthLevels` per side, 20 by default, at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61, and walks sizes on each level, and BitDelta sends one price per side with no size for its derivatives.
A feed could turn `prices_futures_v2` into a one level book only by inventing a size, and the quote's width, a median 4,566 ppm over 89 contracts, would dominate any cross it found.

If a later design accepts a sizeless quote, this is what the wire supports.

| item | value | reason |
|---|---|---|
| URL plan | one socket, `wss://api.bitdelta.com/socket.io/?EIO=4&transport=websocket` | every contract comes on namespace `/` |
| subscribe | send `40{"token":"guest"}` after the open packet, and no join | `prices_futures_v2` needs no join |
| keepalive | answer every `2` with `3` | Engine.IO server ping every 25 s |
| `maxSilenceMs` | 30,000 | `prices_futures_v2` runs at 12 frames a second and the server pings every 25 s |
| resync | none possible, there is no sequence | |
| deflate | keep `perMessageDeflate: false` | not negotiated, and `EIO=3` sends RSV1 frames the `ws` library rejects |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitdelta Public API, a Postman collection published 2024-04-04, folder "Web socket" | https://api-docs.bitdelta.com/ | 2026-09-22 | BitDelta, global | socket URLs, `orderbook_limited`, `prices`, `trades`, the rate limit note, sections 1 to 3 |
| S2 | Derivatives trade page and its script bundle under `/derivatives/_next/static/chunks/` | https://bitdelta.com/en/trade/derivatives/btc-usd | 2026-09-22 | BitDelta, global | namespaces, the guest token, the event keys, private keys, sections 1, 2, 4 and 7 |
| W1 | `ws-probe.mjs prices`, 03:28, 03:29, 03:45 and 03:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| W2 | `ws-probe.mjs errors`, 03:30, 03:31 and 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs) | 2026-09-22 | this host | sections 1, 3 and 4 |
| W3 | `ws-probe.mjs silence`, 03:31 and 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
| W4 | `ws-probe.mjs handshake`, 03:27 and 03:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs) | 2026-09-22 | this host | sections 1 and 5 |
| P2 | `rest-probe.mjs catalog`, 03:35 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) | 2026-09-22 | this host | `STOUSD` status and the REST quote width, section 4 |
