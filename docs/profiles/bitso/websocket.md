# Bitso WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 01:18 to 01:31 UTC, and the second pass 01:43 to 01:48 UTC, from the development host near Seattle.

This profile covers the public WebSocket of Bitso (CCXT id `bitso`) for its spot books, because Bitso lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitso/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
CCXT 4.5.68 has no Pro class for Bitso, so nothing here comes from CCXT.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| every spot book | `wss://ws.bitso.com`, S1 | open in 311 to 369 ms over ten logged sockets in two passes, through Cloudflare, colo `YVR` |

One URL serves every book and every quote currency.
The book is named in each subscribe frame, not in the URL.
`ws.bitso.com` resolved to `162.159.130.10` and `162.159.133.10`, the same Cloudflare pair as `api.bitso.com`, see [`rest.md`](./rest.md) section 1.
The upgrade reply carried `server: cloudflare` and a `__cf_bm` cookie, and no refusal or challenge.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| `orders` | the top 20 bids and top 20 asks as individual orders, each `{a, d, o, r, s, t, v}` | a whole top 20 replacement on every change in it, S2 | in 60 s, 1,089 and 1,762 frames on `btc_usd` in two runs, 1,115 and 1,010 on `btc_mxn`, 206 and 437 on `eth_usd`, 0 and 4 on `bar_usd`, 0 and 0 on `tusd_btc`. 20 entries per side on the busy books, which were 6 to 20 distinct prices, and 17 or 18 bids on `bar_usd` |
| `diff-orders` | one or more order changes, each `{a, d, o, r, s, t, v, z}`, with a per book `sequence` | every order change in the whole book, S3 | in 60 s, 1,273 and 1,987 frames on `btc_usd`, 1,121 and 1,079 on `btc_mxn`, 208 and 438 on `eth_usd`, 0 gaps |
| `trades` | `{a, i, mo, r, t, to, v, x}` | on trade, S4 | 0 to 3 frames per book in 60 s |
| best bid and ask, ticker, mark, index, funding | none | | S1 lists only the three channels above |

Both book channels carry order ids.
Neither is an aggregated price level feed, and a level has to be summed from its orders.
The channel names, fields and example payloads are from S1 to S4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, `wss://ws.bitso.com`, S1 | one URL served all 54 books across eight quote currencies, section 5 |
| subscribe frame shape | `{"action": "subscribe", "book": "btc_mxn", "type": "diff-orders"}`, one book and one channel per frame, S1 | as documented. 108 frames sent back to back on one socket were all acknowledged within 180 and 184 ms in two runs |
| unknown symbol expectation | Not publicly specified | `{"action":"subscribe","type":"orders","error":"This book is not supported - nope_usd","time":…}`, and the socket stays open |
| chunk unit and budget | Not publicly specified | 54 books times 2 channels on one socket, no refusal |
| keepalive mechanism | "Keep alive messages look like this: `{"type": "ka"}`", S1. No client ping is documented | `{"type":"ka"}` every 19,979 to 20,016 ms on every socket in both passes, including one with no subscription. No protocol ping from the server |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 100 s on six sockets over two runs, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 7 handshakes in 30 s or at 108 subscribe frames in one burst |
| public market data authentication | none, S1 | none |
| message parse and routing | every data frame has `type`, `book`, `payload` and `sent`, and `diff-orders` adds `sequence`, S1 | as documented. Route on `type` and `book`. An acknowledgement has `action`, and a refusal has `error` and no `book` |
| subscribe acknowledgement shape | `{"action": "subscribe", "response": "ok", "time": 1455831538045, "type": "trades"}`, S1 | the wire adds `book`: `{"action":"subscribe","response":"ok","time":1790126713871,"type":"orders","book":"btc_usd"}`. A second subscribe to the same pair answers `"response":"Already subscribed to channel: orders:btc_usd"` |
| symbol identifier format | `btc_mxn`, lower case major and minor, S1 | identical to CCXT `market.id` and to the REST `book` on 54 of 54 books. `BTC_USD` is refused as "not supported" |
| number representation | amounts, rates and values as strings, `t`, `d` and `z` as numbers, S2 and S3 | as documented. `diff-orders` pads amounts to 8 decimals, `"0.03560000"`, while `orders` strips trailing zeros, `"0.0356"`, for the same order |
| timestamp representation | `sent` and `d` in ms, S1 to S3 | integer ms. The local receive time minus `sent` was 38 to 92 ms, median 39 to 42 ms per channel, on the first 20 frames of each channel and book in two runs |
| size unit | `a` is "Major", the base currency, S2 and S3 | base currency, and the whole REST book replayed with the diffs summed to the `orders` levels exactly, section 4 |
| sequence semantics | "Each new message increments the sequence number by one. If you see a sequence number greater than the previous one by more than one unit, it means a message has been dropped", S1 | per book, 0 gaps in 2,602 and 3,508 `diff-orders` frames on five subscribed books over 60 s, and 0 in 23,533 and 25,446 on 54 books over 45 s. `orders` carries no sequence |
| idle repeat behaviour | not documented | nothing is repeated. A quiet book sends nothing at all, and `orders` never sent the same payload twice in a row |

## 4. The book channels in detail

### Snapshot on subscribe

Neither book channel sends a snapshot.
`orders` pushes the top 20 only when something in the top 20 changes.
On 2026-09-23 at 01:25 UTC, `bar_usd` and `tusd_btc` sent no `orders` and no `diff-orders` frame in 60 s after an `ok` acknowledgement, while their REST books held 14 and 37 bid levels and 50 ask levels each, see [`rest.md`](./rest.md) section 5.
In the rerun at 01:43 UTC, `bar_usd` sent its first `orders` frame 46.4 s after the subscribe, and `tusd_btc` again sent nothing.
With all 54 books subscribed for 45 s, 4 books sent no frame at all in the first run (`tusd_btc`, `bar_usd`, `brl1_brl`, `enj_usd`) and 3 in the second.
The first `orders` frame of the others arrived 125 ms to 41.4 s after the subscribe, median 1.1 s, and 184 ms to 11.8 s, median 759 ms, in the second run.
A dead book subscribed alone for 100 s sent nothing but its acknowledgement and the 20 s keepalive.

The documented recipe for a full book is REST, S1:

1. Subscribe to `diff-orders` and queue its messages.
2. Call `GET /order_book/?book=<book>&aggregate=false`, which returns every open order with its `oid` and the book's `sequence`.
3. Discard queued messages whose `sequence` is at or below the REST `sequence`, and apply the rest.
4. Apply live messages as they come.

The probe ran it on `btc_usd` at 01:25 UTC and again at 01:43 UTC.

| run | REST call | orders | REST `sequence` | queued | discarded | applied | `orders` frames compared | best bid and ask equal | summed levels equal | every order in the frame held with the same price and amount |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 01:25 | 513 ms | 6,396 | 3633406378 | 53, from 3633406333 to 3633406385 | 46 | 7 | 1,052 | 1,052 | 1,052 | not compared as numbers in this run |
| 01:43 | 363 ms | 6,402 | 3633438980 | 66, from 3633438923 to 3633438988 | 58 | 8 | 1,727 | 1,727 | 1,727 | 1,727 |

In both runs the queue began below the REST `sequence`, so it covered the REST reading.
The summed level check covers every level better than the frame's twentieth order.
No removal named an order the map did not hold.

### Delta semantics

`diff-orders` is an order level feed.
Each payload entry names one order `o` with its side `t` (0 buy, 1 sell, as corrected in 2023 per S5), price `r`, remaining amount `a`, value `v` and status `s`.

| `s` | meaning | what a book does |
|---|---|---|
| `open` | the order rests, or rests with a new amount or a new price | set order `o` to side `t`, price `r`, amount `a` |
| `cancelled` | removed without a fill | delete order `o` |
| `completed` | filled and removed | delete order `o` |

S3 says a cancelled order "does not have the fields `a` (amount) and `v` (value)".
On the wire it is the other way round.
Every `cancelled` entry carried `a` and `v`, 1,293 in the first `book` run and 1,754 in the second, with a `z` of 0 or a ms time.
The `completed` entries carried no `a`, 2 in the first run, and the 1 in the second carried only `d`, `o`, `r`, `s`, `t` and `z`, see section 6.
A modified order arrives as a `cancelled` at the old price followed by an `open` with the same `o` at the new price, one sequence apart.
On `btc_mxn` one ask flipped between 1500370 and 1499630 every 150 ms or so this way, see section 6.
So a feed keys orders by `o`, replaces on `open`, and deletes on anything else, never adding amounts.
The payload held 1 order in almost every frame, at most 3 on `eth_usd` in the first run and 2 on `btc_mxn` in the second, where a fill removed one bid and shrank the next.

`orders` replaces the top 20 orders of each side on every frame.
A level whose orders fall partly outside the top 20 is shown short, and a book of many small orders at one price shows fewer than 20 prices.
`btc_usd` showed 6 to 19 distinct bid prices, median 16, and 16 to 20 ask prices, median 18, over 1,089 frames, and 13 to 20, median 17, and 16 to 20, median 18, over 1,762 frames in the rerun.

### Sequence and gap rule

```text
REST aggregate=false        replace the book, last = sequence
diff sequence <= last       discard (queued before the REST reading)
diff sequence = last + 1    apply, last = sequence
diff sequence > last + 1    gap: a message was dropped, fetch the REST book again (documented)
```

The rule held on every message probed, with 0 gaps and 0 duplicates.
The sequence is per book: `btc_usd` was near 3.63 billion, `btc_mxn` near 4.52 billion and `bar_usd` near 117 million at the same minute.
It is a JSON number on the socket and a string on the REST book.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `orders` | best first, descending, on every frame of both runs: 1,089 and 1,762 `btc_usd` frames, 1,115 and 1,010 `btc_mxn`, 206 and 437 `eth_usd`, 4 `bar_usd` | best first, ascending, on every frame |
| `diff-orders` | one order per entry, no order to speak of | |
| REST `order_book` | descending | ascending |

### Size unit

`a` is in the base currency, "Major" in S2 and S3.
CCXT reports `contractSize` undefined for every Bitso market, at `server/node_modules/ccxt/js/src/bitso.js` line 556 (S6), and the connector turns that into 1, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194.
So the engine's size multiplier would read Bitso sizes correctly.
The replay above is the evidence: REST amounts and diff amounts summed to the `orders` sizes at every level compared.

### One-sided and empty books

No one-sided or empty book was seen on the socket, because the thin books sent nothing.
The REST book of `bar_usd` held 14 bid levels against 50 asks, see [`rest.md`](./rest.md) section 5.
What `orders` sends when a side empties is Not verified.

### Idle repeats

Nothing is repeated.
`orders` never sent the same payload twice in a row on any book, and a quiet book sends no frame, so a quiet book is indistinguishable from a dead stream except by the 20 s `ka`.

### Unknown, closed and malformed requests

Each case ran on its own socket at 01:30 UTC and again at 01:47 UTC, with the same replies.

| request | reply | then |
|---|---|---|
| `{"action":"subscribe","book":"nope_usd","type":"orders"}` | `{"action":"subscribe","type":"orders","error":"This book is not supported - nope_usd","time":1790127035180}` | socket stays open |
| `{"action":"subscribe","book":"BTC_USD","type":"orders"}` | `"error":"This book is not supported - BTC_USD"` | socket stays open |
| `{"action":"subscribe","book":"btc_usd","type":"nope"}` | `"error":"This type of channel is not supported - nope"` | socket stays open |
| `{"action":"nope","book":"btc_usd","type":"orders"}` | `{"action":"nope","type":"orders","error":"unknown subscription","time":1790127047401}` | socket stays open |
| `hello`, not JSON | `{"error":"invalid message","time":1790127050498}` | socket stays open |
| `{"action":"subscribe","type":"orders"}`, no `book` | no reply | the server closed the socket with code 1011 after 0.43 s and 0.49 s |
| the same subscribe twice | `ok`, then `"response":"Already subscribed to channel: orders:btc_usd"` | frames continue once |
| `{"action":"unsubscribe","book":"btc_usd","type":"orders"}` | `{"action":"unsubscribe","response":"ok",…}` | 0 and 7 `orders` frames in the first second, then 0 in the next 5 s, against 104 and 249 in the 5 s before |

The nine books hibernated on 2026-09-10 are no longer in `available_books`, so a closed book was not probed as such, see [`fees.md`](./fees.md) section 3.
A refusal carries no `book` field, so a feed that must know which book failed has to read it from the `error` text.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the server sends `{"type": "ka"}`, S1 | every 19,979 to 20,016 ms on every socket. The first `ka` came 5.3 to 15.4 s after open on six sockets opened three at a time, so the 20 s period does not start at the open. No protocol ping in any run |
| silence the server tolerates | Not publicly specified | a socket that never sent a frame, and sockets subscribed to a dead book, all stayed open for the full 100 s in both runs. The client closed them |
| forced disconnect | Not publicly specified | none in any run. A subscribe with no `book` closed the socket with 1011 |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got `sec-websocket-extensions: permessage-deflate;client_max_window_bits=15`. A client that did not offer it got no extension and plain frames, so the server does not force it |
| handshake | | 311 to 369 ms to open over both passes |
| subscription acknowledgement | | for 15 frames sent together, 75 to 142 ms after the send in the first run and 80 to 84 ms in the second |
| subscription limits | Not publicly specified | 108 subscriptions on one socket, all `ok` |
| throughput | | all 54 books, `orders` and `diff-orders`, 45 s, two runs: 46,444 and 50,155 frames, median 960 and 1,039 frames per second, p90 1,451 and 1,595, peak 1,862 and 1,986, 2.4 and 2.6 MB per second, 2,324 and 2,318 bytes per frame, 39.8 and 38.6 µs `JSON.parse` per frame |
| clock | | the acknowledgement's `time` minus the local receive time was −103 to −37 ms, median −38, and −44 to −41 ms, median −43, over 15 acknowledgements in each run. Data frames arrive a median 39 to 42 ms after their `sent` time, so both readings fit a one way delay near 40 ms and a server clock within a few tens of ms of this host |

Most of that byte rate is `orders`, whose frame repeats all 40 orders with ids and values on every change.
The first batch run carried 22,801 `orders` frames and 23,533 `diff-orders` frames, so at about 220 bytes a diff, `diff-orders` alone would be near 0.1 MB per second, an estimate from the frame sizes below.
A `btc_usd` `orders` frame was 4,558 to 4,616 bytes, against 207 to 228 bytes for a `diff-orders` frame.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Subscribe and acknowledgement.

```json
{"action": "subscribe", "book": "btc_usd", "type": "orders"}
```

```json
{"action":"subscribe","response":"ok","time":1790126713871,"type":"orders","book":"btc_usd"}
```

`orders`, the first two orders per side kept of 20.

```json
{"payload":{"bids":[{"a":"0.17311818","d":1790126712169,"o":"1vyCiAiOuSjO7CND","r":"86612","s":"undefined","t":0,"v":"14994.11180616"},{"a":"0.09279401","d":1790126708141,"o":"D8U01kR7vZcNQl7L","r":"86610","s":"undefined","t":0,"v":"8036.8892061"}],"asks":[{"a":"0.00332985","d":1790126709522,"o":"gg8Hnn2SmiDitDRt","r":"86636","s":"undefined","t":1,"v":"288.4848846"},{"a":"0.02533303","d":1790126709402,"o":"xETJm3avyIUgmVqd","r":"86639","s":"undefined","t":1,"v":"2194.82838617"}]},"sent":1790126714262,"book":"btc_usd","type":"orders"}
```

`diff-orders`, a modified ask, as a cancel at the old price and an open at the new price with the same order id and consecutive sequences.

```json
{"book":"btc_mxn","sequence":4520986708,"type":"diff-orders","payload":[{"a":"0.00181072","d":1790126704679,"o":"HWeHxDg0wjcUHibz","r":"1500370","s":"cancelled","t":1,"v":"2716.74996640","z":1790126713770}],"sent":1790126713928}
```

```json
{"book":"btc_mxn","sequence":4520986709,"type":"diff-orders","payload":[{"a":"0.00181072","d":1790126704679,"o":"HWeHxDg0wjcUHibz","r":"1499630","s":"open","t":1,"v":"2715.41003360","z":1790126713924}],"sent":1790126713933}
```

`diff-orders`, a cancel that carries `a` and `v` although S3 says it does not.

```json
{"book":"btc_usd","sequence":3633396483,"type":"diff-orders","payload":[{"a":"0.00389279","d":1790126258230,"o":"TExe7VzG9ZvCmVLc","r":"86628","s":"cancelled","t":0,"v":"337.22461212","z":0}],"sent":1790126319428}
```

`diff-orders`, a fill: the resting bid leaves as `completed` with no `a` and no `v`, and a partly filled bid rests with its new amount.

```json
{"book":"btc_mxn","sequence":4521005667,"type":"diff-orders","payload":[{"d":1790127803619,"o":"nW0AuzICRQ92QMr0","r":"1494400","s":"completed","t":0,"z":1790127803811},{"a":"0.00199645","d":1790127779761,"o":"FX7PmAfqYzaye1Zz","r":"1494390","s":"open","t":0,"v":"2983.47491550","z":1790127803811}],"sent":1790127803815}
```

Trade.

```json
{"payload":[{"a":"1.82161582","i":201566590,"mo":"d7gQKwArIpFK7lmS","r":"2769.2","t":0,"to":"nCf23xypiTOYOu8U","v":"5044.41852874","x":1790126718894}],"sent":1790126718977,"book":"eth_usd","type":"trades"}
```

Keepalive.

```json
{"type":"ka"}
```

Errors.

```json
{"action":"subscribe","type":"orders","error":"This book is not supported - nope_usd","time":1790127035180}
```

```json
{"action":"subscribe","response":"Already subscribed to channel: orders:btc_usd","time":1790127053553,"type":"orders","book":"btc_usd"}
```

```json
{"error":"invalid message","time":1790127050498}
```

## 7. Private channels

None on this socket.
S1 documents only the three public channels, and account updates come from authenticated REST calls such as `GET /open_orders` and `GET /user_trades`, as CCXT lists them at `server/node_modules/ccxt/js/src/bitso.js` lines 179 to 200.
Not probed.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Bitso lists no perpetual, so the engine has no use for this feed today, see [`fees.md`](./fees.md) section 9.
If spot legs are ever added, the shape would be as follows.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://ws.bitso.com`, one socket for every book | 54 books and 108 subscriptions ran on one socket with 0 gaps |
| channel | `diff-orders`, with a per order map in the subclass that sums each level before `setBid` and `setAsk` | it carries every order and a strict per book sequence. `orders` is capped at 20 orders, often fewer than the engine's 20 levels, and has no sequence |
| snapshot | `GET /order_book/?book=<id>&aggregate=false` after the subscribe, applying queued diffs above its `sequence` | neither channel sends one, and the recipe matched `orders` on 1,052 of 1,052 and 1,727 of 1,727 frames |
| alternative | `orders` alone, each frame a `resetBook` of its summed levels, plus one aggregated REST book per book at start | no order map and no sequence, at the cost of 6 to 20 levels and nearly all of the 2.4 MB per second the batch carried |
| markets per connection | all books on one socket | 54 books ran at a median 960 and 1,039 frames per second and under 40 µs parse per frame |
| subscribe frames | one per book, `{"action":"subscribe","book":"<id>","type":"diff-orders"}` | one book and one channel per frame, and `orders` is not needed once the order map exists |
| keepalive | none sent | the server needs no client frame and sends `ka` every 20 s |
| `maxSilenceMs` | 60,000 | three missed `ka` frames. The `ka` frame has to count as traffic, since a quiet book sends nothing |
| routing | `type` and `book`, with `book` equal to `rawMarketId` | the socket spells books as CCXT `market.id` does |
| resync | a sequence jump on one book refetches that book's REST snapshot | the engine's `resync` terminates the whole socket, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 296 to 314, which here would cost one REST call per book, and Bitso allows 60 public REST calls a minute per IP, see [`rest.md`](./rest.md) section 6. So a socket of 54 books takes about a minute to reseed |
| unserved book | log a refusal by its `error` text, and never subscribe without `book` | a missing `book` kills the socket with 1011 |
| receive time | stamp on arrival | `sent` is a server time, 38 ms or more behind arrival |
| sizes | `Number()` of `a`, base currency, contract size 1 | section 4 |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when asked |

That is a named change to the engine's feed shape: a per order map, a REST seed per book, and a per book resync instead of a socket restart.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading API, WebSocket "General", updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/general | 2026-09-22 | Bitso | URL, channels, message fields, subscribe and ack shape, `ka`, the REST plus diff recipe, sections 1 to 5 |
| S2 | Trading API, Orders Channel, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/orders-channel | 2026-09-22 | Bitso | top 20 orders, fields, sections 2 and 4 |
| S3 | Trading API, Diff-Orders Channel, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/diff-orders-channel | 2026-09-22 | Bitso | order states, fields, cancelled shape, sections 2 and 4 |
| S4 | Trading API, Trades Channel, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/trades-channel | 2026-09-22 | Bitso | trade fields, section 2 |
| S5 | Trading API, History of Changes, updated 2026-08-20 | https://docs.bitso.com/bitso-api/docs/history-of-changes | 2026-09-22 | Bitso | the `t` field corrected to 0 buy and 1 sell, and `z` and `sent` added in 2023, section 3 |
| S6 | CCXT 4.5.68 `bitso.js`, and no `pro/bitso.js` | `server/node_modules/ccxt/js/src/bitso.js` | 2026-09-22 | CCXT | `contractSize` undefined, private REST calls, sections 4 and 7 |
| P1 | `ws-probe.mjs book` at 01:25 UTC, and an 8 s exploratory socket at 01:18 UTC that is not a mode of the script | [`ws-probe.mjs`](../../../scripts/probes/venues/bitso/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 4 and 6 |
| P2 | `ws-probe.mjs batch` at 01:26 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitso/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 5 |
| P3 | `ws-probe.mjs silence` at 01:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitso/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P4 | `ws-probe.mjs errors` at 01:30 UTC and `deflate` at 01:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitso/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 4 and 5 |
| P5 | second pass reruns of every mode, `book` at 01:43, `batch` at 01:44, `silence` at 01:45, `errors` and `deflate` at 01:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitso/ws-probe.mjs) | 2026-09-23 UTC | this host | the second readings |
