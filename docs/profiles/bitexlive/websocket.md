# Bitexlive WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:23 to 04:53 UTC on 2026-09-23, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the spot market data socket of Bitexlive, because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The venue documents no WebSocket API, S1.
The socket below is the one the venue's own web app uses, found in its JavaScript bundle, S2 and S3.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitexlive/ws-probe.mjs), and the documented column reads "not documented" wherever S1 is silent.
The terms forbid access "by any means other than the interface provided by us", S4, and whether this socket counts as such an interface for a third party is an open question.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| spot, all pairs | `wss://wss.bitexlive.com/app/fiac7yamhonzmyhqokgp?protocol=7&client=js&version=8.4.0&flash=false` | upgrade 101 in 529 to 581 ms on the three book runs, `x-powered-by: Ratchet`, through Cloudflare |
| perpetuals | none | the venue lists none |

The bundle builds a Laravel Echo client with `broadcaster: "reverb"`, `key: "fiac7yamhonzmyhqokgp"`, `wsHost: "wss.bitexlive.com"`, `wssPort: "443"` and `forceTLS: true`, S3.
Echo's Reverb mode speaks the Pusher protocol, and the server answered as a Pusher protocol 7 server, section 6.
The server header `x-powered-by: Ratchet` names a PHP socket server, so the backend is Pusher compatible rather than Pusher itself.
One socket carries every pair, and all 21 book channels and `market.public` ran on one connection, P1.
Access from this host met no refusal, and it is from the Canadian VPN exit, not from a US address.

## 2. Channel matrix for public market data

| channel | event | payload | probed on 2026-09-23 UTC |
|---|---|---|---|
| `exchange.public.<market uuid>` | `order.book.updated` | `{"orderBook": {"SELL": [...], "BUY": [...]}, "market": {...}}`, 22 levels per side | one full book per pair every 49.6 to 51.7 s, section 4 |
| `exchange.public.<market uuid>` | `public_trade.created` | `{"trade": {"direction", "price", "amount", "date"}}` | one trade per pair per sweep, 3 per pair in the 110 s rerun |
| `market.public` | `market_data.updated` | one pair's `last_price`, `change_day`, `volume_day`, `quote_volume_day`, `high_day`, `low_day` | 84 frames in 110 s, and 105 in the rerun, 5 per pair |

The channel and event names are from the bundle's listeners, S2.
The bundle listens with a leading dot, `.order.book.updated`, which in Echo means the raw event name without a namespace, and the frames carry `order.book.updated`.
No best bid and ask channel, no depth or speed choice, and no mark, index or funding channel exists.
The web app loads its first book with `POST /exchange/query/order-book` and a session cookie, S2, which this probe did not call.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | not documented | one URL for every pair |
| subscribe frame shape | not documented. Pusher: `{"event":"pusher:subscribe","data":{"channel":"<name>"}}`, one channel per frame | 22 frames sent in one burst, each acked |
| unknown symbol expectation | not documented | a zero UUID and `exchange.public.BTC_USDT` were both acked as `pusher_internal:subscription_succeeded` and stayed silent |
| chunk unit and budget | not documented | 22 channels on one socket, no refusal, the whole venue fits |
| keepalive mechanism | not documented. Pusher: client `pusher:ping`, server `pusher:pong` | `pusher:pong` 167 to 173 ms after the ping. The server announced `activity_timeout` 86400 and still sent one `pusher:ping`, at 87.1 s and at 77.1 s in two runs, to a subscribed client that never sent anything |
| connection lifetime and maintenance notice | not documented | no notice seen. A socket with no subscription that sent nothing closed at 60.5 s with 1006 and no close frame, in both runs |
| handshake and operation rate limits | not documented | no refusal at 22 subscribes in one burst, opens took 529 to 581 ms |
| public market data authentication | none for public channels. The bundle names `/broadcasting/auth` for private ones | none |
| message parse and routing | not documented | envelope `{event, data, channel}`, where `data` is a JSON string that needs a second parse. Route on `channel`, whose suffix is the market UUID |
| subscribe acknowledgement shape | not documented | `{"event":"pusher_internal:subscription_succeeded","data":"{}","channel":"<name>"}`, 167 to 179 ms after the burst |
| symbol identifier format | not documented | the channel carries the market UUID, and the frame's `market.title` carries `BTC_USDT`, equal to the REST `tradingPairs` |
| number representation | not documented | `price`, `amount` and `total` are decimal strings, `quantity` is a JSON integer |
| timestamp representation | not documented | a book frame carries no timestamp. `market.market_data.updated_at` is ISO 8601 with microseconds, and a trade `date` is ISO 8601 with `+00:00` |
| size unit | not documented | `amount` in base currency rounded to the pair's `amount_decimals`, `total` in USDT, section 4 |
| sequence semantics | not documented | none. Every frame is a whole 22 level book with no id |
| idle repeat behaviour | not documented | each pair's book is pushed once per sweep, every 49.6 to 51.7 s, changed or not. 1 of 63 later frames repeated the frame before it exactly |

## 4. The book channel in detail

### Snapshot on subscribe

No frame follows a subscribe.
The first book frame for each pair arrives with the next sweep, which came 36.3 to 39.5 s after the subscribe burst in the second run and 11.4 to 13.4 s after it in the rerun, P1.
So a new connection waits up to about 52 s for its first book.

### Delta semantics

There are no deltas.
Every `order.book.updated` frame replaces the pair's whole book with 22 bids and 22 asks, on 126 of 126 frames over three runs.
A frame was 5,432 to 5,763 bytes in the rerun, and the `market` object inside it repeats the pair's static fields each time.

### Sequence and gap rule

None exists, and none is needed for a whole book replace.
Nothing in a frame tells a reader whether a cycle was skipped.

### Cadence

In the 110 s second run every pair got two book frames 50.3 to 51.7 s apart, and in the rerun three frames 49.6 to 50.7 s apart, P1.
All 21 pairs arrive in one sweep that lasted 1.8 to 3.2 s in those two runs, and 8.4 s in the first run.
Each sweep also prints one trade per pair, P1, and the REST trade call shows one `BTC_USDT` trade every 48 to 52 s, see [`rest.md`](./rest.md) section 5.
The REST top of book read every 5 s beside the socket moved only within a few seconds of each sweep, P2.
So the venue's book itself stands still between sweeps, and against the wider market it can be about 52 s old.

### Checksum

None.

### Level order on the wire

| frame | bids, `BUY` | asks, `SELL` |
|---|---|---|
| socket book | descending, best first, on 126 of 126 frames | descending, so the best ask is the last element, on 126 of 126 frames |
| REST `orderBook` | descending | descending, see [`rest.md`](./rest.md) section 5 |

A feed takes the best ask as the minimum `price` of `SELL`, never `SELL[0]`.

### Size unit

A level is `{"price", "amount", "total", "quantity"}`.
`amount` is in base currency, `total` is in USDT, and `quantity` is the order count at the level, which was 1 on all 44 levels of the `BTC_USDT` frame quoted in section 6.
`amount` is rounded to the pair's `amount_decimals`, 5 for `BTC_USDT`, so a small level loses most of its size.
The best `BTC_USDT` bid read `"amount":"0.00009"` with `"total":"8.37441"` at 87,233.51, which is 0.000096 BTC.
On 13 to 28 of 44 `BTC_USDT` levels, and 14 to 21 of 44 `ETH_USDT` levels, `total / price` differed from `amount` by more than 1 %, over five frames of each, P1.
The REST book carries the same rounded size: its size equalled the socket `amount` within 1 % on 44 of 44 levels in each of three comparisons, and equalled `total / price` on only 19 to 31, P1.
Which of the two is the size a taker could fill is Not verified, and `total / price` is the likelier, since `total` keeps more digits.
The engine's size multiplier would be 1, since spot has no contract size.

### Crossed and one-sided books

6 of 21 pairs were crossed on the socket in the first run, and 5 of 21 on every sweep of the second run and the rerun, P1.

| pair | best bid | best ask |
|---|---|---|
| `APTM_USDT` | 0.24 | 0.085 |
| `USDC_USDT` | 1.00069 | 1.0001 |
| `BTXK_USDT` | 0.00966 | 0.002 |
| `ETH_USDT` | 2786.62 | 2359.9 |
| `ZRX_USDT` | 0.1252 | 0.06 |
| `LTC_USDT` | 64.09 | 64.09 |

The rows are from the first sweep of the second run, except `LTC_USDT`, which touched at 64.09 in the first run only.
A crossed ask 15 % under the bid survived every sweep on `ETH_USDT`, so the matching engine does not clear these levels, and the book is not one a taker could cross.
No one-sided or empty book was seen.

### Idle repeats

Every pair is pushed each sweep whether or not it traded.
Of 63 frames that followed an earlier frame for the same pair, 62 differed from it, and the `BTXK_USDT` frame at 62.6 s in the rerun repeated the one before it exactly, P1.

### Unknown and repeated channels

| request | reply | then |
|---|---|---|
| `exchange.public.00000000-0000-0000-0000-000000000000` | `pusher_internal:subscription_succeeded` | nothing |
| `exchange.public.BTC_USDT` | `pusher_internal:subscription_succeeded` | nothing |
| the `BTC_USDT` UUID channel twice | success both times | |
| `pusher:unsubscribe` | no reply | |
| `{"event":"nope","data":{}}` | `{"event":"pusher:error","data":"{\"code\":4200,\"message\":\"Invalid message format\"}"}` | the socket stays open |
| `hello`, not JSON | the same 4200 error | the socket stays open, and the next `pusher:ping` is answered |

A pair that is closed or delisted was not available to probe.
Because any channel name is acked, a feed must notice a channel that never delivers on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | not documented | `{"event":"pusher:ping","data":{}}` answered by `{"event":"pusher:pong"}` 167 to 173 ms later. No protocol level ping from the server in 119 s. One application `pusher:ping` from the server, at 87.1 s and at 77.1 s in two runs, to a subscribed client that had sent nothing |
| silence the server tolerates | not documented. `connection_established` announces `activity_timeout` 86400 | a socket with no subscription and no client frame closed at 60.5 s with 1006 and no close frame, in both runs. A subscribed socket that sent nothing was still open at 90 s in both runs, having received a book frame every sweep. Whether it would close without answering the server's ping was not tested |
| forced disconnect | not documented | none in 119 s |
| maintenance notice | not documented | none seen |
| compression | not documented | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | | 529 to 581 ms to open on the three book runs |
| subscription limits | not documented | 22 channels, the whole venue, on one socket with no refusal |
| throughput | | 42 book frames and 233,913 bytes of book in 110 s over all 21 pairs, plus 84 `market_data.updated` frames. The rerun caught three sweeps: 63 book frames, 350,911 bytes, and 105 `market_data.updated` frames |

The 60 s close of an idle socket looks like a proxy read timeout between Cloudflare and the Ratchet server, and it is an inference.
A subscribed socket receives a frame about every 50 s, which is under 60 s, but a client ping every 20 s removes the dependence on that margin.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Connection established.

```json
{"event":"pusher:connection_established","data":"{\"socket_id\":\"418024424.604336913\",\"activity_timeout\":86400}"}
```

Subscribe, and its acknowledgement.

```json
{"event":"pusher:subscribe","data":{"channel":"exchange.public.cf702823-b6df-4f41-970c-9f43f0e9deaa"}}
```

```json
{"event":"pusher_internal:subscription_succeeded","data":"{}","channel":"exchange.public.cf702823-b6df-4f41-970c-9f43f0e9deaa"}
```

Book frame for `BTC_USDT`, with the inner `data` string shown parsed, the first three bids and the last three asks kept, and the `market` object cut to a few of its fields.

```json
{"event":"order.book.updated","channel":"exchange.public.cf702823-b6df-4f41-970c-9f43f0e9deaa","data":{"orderBook":{"BUY":[{"price":"87233.51","amount":"0.00009","total":"8.37441","quantity":1},{"price":"87233.50","amount":"0.00002","total":"2.09360","quantity":1},{"price":"87233.38","amount":"0.00002","total":"2.09360","quantity":1}],"SELL":[{"price":"87233.55","amount":"0.00002","total":"2.09360","quantity":1},{"price":"87233.54","amount":"0.00010","total":"9.07228","quantity":1},{"price":"87233.53","amount":"0.39073","total":"34085.28057","quantity":1}]},"market":{"id":"cf702823-b6df-4f41-970c-9f43f0e9deaa","title":"BTC_USDT","price_decimals":2,"amount_decimals":5,"total_decimals":5,"active":true}}}
```

Trade.

```json
{"event":"public_trade.created","data":"{\"trade\":{\"direction\":\"SELL\",\"price\":\"0.896\",\"amount\":\"0.0014\",\"date\":\"2026-09-23T04:28:49+00:00\"}}","channel":"exchange.public.32913547-9789-4642-a980-ccfc98b47cf4"}
```

Market data.

```json
{"event":"market_data.updated","data":"{\"marketData\":{\"id\":\"32913547-9789-4642-a980-ccfc98b47cf4\",\"title_formatted\":\"NEXO | USDT\",\"title\":\"NEXO_USDT\",\"total_decimals\":5,\"price_decimals\":3,\"amount_decimals\":4,\"tab\":\"USDT\",\"currency\":\"Nexo\",\"last_price\":\"0.897\",\"change_day\":\"2.74\",\"volume_day\":\"9570.29000000\",\"quote_volume_day\":\"12322.73000000\",\"high_day\":\"0.899\",\"low_day\":\"0.858\"}}","channel":"market.public"}
```

Keepalive.

```json
{"event":"pusher:ping","data":{}}
```

```json
{"event":"pusher:pong"}
```

Error.

```json
{"event":"pusher:error","data":"{\"code\":4200,\"message\":\"Invalid message format\"}"}
```

## 7. Private channels

Named for a future execution stage, from the bundle's listeners, S2, not probed.
Echo prefixes each with `private-` and authorises it through `/broadcasting/auth` with a bearer token and a CSRF header, S3.

- `exchange.<userId>` with events `order.updated` and `trade.created`.
- `wallet.balance.<userId>` with event `balance`.
- `private.user.<id>` with event `notification`.

The documented REST account calls, `userBalance`, `userOrder`, `userOrderCancel`, `userOrderHistory` and `userTrade`, take an API key and secret in headers, S1.

## 8. Recommended feed shape

None, because the venue lists no perpetual and has no CCXT class, see [`fees.md`](./fees.md) section 9.
The socket also fails the book feed contract on its own terms.

| engine need | this socket |
|---|---|
| a documented public socket | undocumented, taken from the web app bundle |
| snapshot on subscribe, or a sequence to resync on | neither. The first book arrives with the next sweep, up to about 52 s later |
| at least 20 levels | 22 levels, enough |
| a book that moves with the market | a whole book every 49.6 to 51.7 s |
| a best bid below the best ask | 5 or 6 of 21 pairs crossed and left standing |
| `rawMarketId` in the frame | the channel carries a UUID that only the exchange page maps to `BTC_USDT` |

If it were ever wired, the shape would be one URL, one socket for all pairs, one `pusher:subscribe` per `exchange.public.<uuid>`, a `pusher:ping` every 20 s, a `maxSilenceMs` of about 70,000 counting the pong as traffic, `resetBook` on every frame from `BUY` and `SELL`, sizes from `total / price`, and the UUID map read from `window.pageData.pairs` at start.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitexlive API | https://bitexlive.com/api | 2026-09-23 UTC | Bitexlive, global | no WebSocket documented, REST account call names, sections 1 and 7 |
| S2 | Bitexlive web app bundle | https://bitexlive.com/build/assets/app-DU8dfZ9k.js | 2026-09-23 UTC | Bitexlive | channel and event names, the first book by `POST /exchange/query/order-book`, private channel names, sections 2 and 7 |
| S3 | Bitexlive Echo and Pusher bundle | https://bitexlive.com/build/assets/index-Cf4Q9gzi.js | 2026-09-23 UTC | Bitexlive | `broadcaster`, `key`, `wsHost`, `wssPort`, `forceTLS`, the auth endpoint, sections 1 and 7 |
| S4 | Bitexlive Terms of Use, last updated 22 October 2025 | https://bitexlive.com/terms | 2026-09-23 UTC | Bitex Trade LLC, Georgia | the prohibited access clause, preamble |
| S5 | Bitexlive exchange page with `window.pageData` | https://bitexlive.com/exchange/BTC_USDT | 2026-09-23 UTC | Bitexlive | market UUID per pair, section 4 |
| P1 | `ws-probe.mjs book` at 04:28 and 04:34 UTC and the rerun at 04:45 UTC, `errors`, `deflate` and `silence` at 04:37 and again at 04:47 to 04:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexlive/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | REST order book reads every 5 s and after each `BTC_USDT` frame inside `ws-probe.mjs book` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexlive/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | section 4 |
