# Coincheck WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:32 to 04:47 UTC, from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare loc=CA, SEA edge), so every access result below is from that Canadian VPN exit.

This profile covers the public WebSocket of Coincheck (CCXT id `coincheck`) for its spot market, since Coincheck lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coincheck/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation S1 is short: it names the URL, the subscribe frame, the two public channels and their payloads, and nothing about keepalive, limits, sequence or errors.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every pair | `wss://ws-api.coincheck.com`, S1 | eleven opens took 487 to 582 ms, served from Tokyo |
| private | `wss://stream.coincheck.com/private`, S1 | not probed |

One socket carries every pair.
On 2026-09-23 at 04:28 UTC `ws-api.coincheck.com` resolved to three addresses, and the reverse name of `52.193.52.158` is `ec2-52-193-52-158.ap-northeast-1.compute.amazonaws.com`, so the socket terminates in AWS Tokyo, see [`rest.md`](./rest.md) section 1.
The 26 pairs of S1's list are exactly the 26 pairs of `GET /api/exchange_status`, all quoted in JPY.

## 2. Channel matrix for public market data

| channel | frame | depth and speed | probed |
|---|---|---|---|
| `<pair>-orderbook` | `{"type":"subscribe","channel":"btc_jpy-orderbook"}` | "the difference of order book information at regular intervals", S1 | diffs only, no snapshot, a `btc_jpy` frame every 209 to 831 ms with a median of 362 to 365 ms over three runs |
| `<pair>-trades` | `{"type":"subscribe","channel":"btc_jpy-trades"}` | "every 0.1 seconds", S1 | 31, 19 and 9 `btc_jpy` trade frames in 60 s |

No best bid and ask channel, no ticker channel and no depth-limited snapshot channel exists.
No mark, index or funding channel exists, since there is no derivative.
The only reference price is the REST standard rate, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every pair, S1 | 26 pairs on one socket, 12 or 13 of them delivered frames within 60 s in three runs and the rest were quiet |
| subscribe frame shape | `{"type":"subscribe","channel":"<pair>-orderbook"}`, "each subscribe command can subscribe to only one channel", S1 | 27 frames sent in 1 to 2 ms all took effect. An array in `channel` and a plural `channels` array were both ignored, see section 4 |
| unknown symbol expectation | Not publicly specified | no reply at all, and the socket stays open, for `nope_jpy`, `BTC_JPY`, the delisted `fct_jpy` and `etc_btc`, and the channel `btc_jpy-nope` |
| chunk unit and budget | one channel per frame, no cap published | 27 subscribe frames in one burst on one socket, none refused |
| keepalive mechanism | Not publicly specified | the server sent no protocol ping on any socket. A client protocol ping was answered with a pong, 3 of 3 |
| connection lifetime and maintenance notice | Not publicly specified. REST `exchange_status` names the states `available`, `itayose` and `stop`, S2 | no notice frame seen. An unsubscribed silent socket closed at 60.0 s after open with 1006 |
| handshake and operation rate limits | Not publicly specified | no refusal at eleven opens in 14 minutes and 27 subscribes in one burst |
| public market data authentication | none, S1 | none |
| message parse and routing | orderbook `["<pair>", {"bids", "asks", "last_update_at"}]`, trades a two dimensional array, S1 | the same. Route on `msg[0]`: a string is an orderbook frame for that pair, an array is a trades batch |
| subscribe acknowledgement shape | none documented | none sent, so a subscription is only confirmed by its first diff |
| symbol identifier format | lowercase `btc_jpy`, S1 | identical to `exchange_status` `pair` and to CCXT `market.id` for the three CCXT markets still listed |
| number representation | strings, S1 | price and size are strings, as `["13707473.0","0.019"]`, and `last_update_at` is a string |
| timestamp representation | `last_update_at` Unix time, S1 | whole seconds as a string. Arrival minus `last_update_at` was 59 to 1,137 ms over three runs, which is the truncation plus the delivery |
| size unit | "order amount", S1 | base coin, the same unit as the REST book, section 4 |
| sequence semantics | none | no sequence id, no checksum, no previous id, so a lost diff cannot be detected |
| idle repeat behaviour | not documented | 0 repeated frames in 762, 706 and 612 book frames. A quiet pair sends nothing, and `sui_jpy` went 41.9 s between frames |

## 4. The book channel in detail

### Snapshot on subscribe

None.
The first frame of each pair after the subscribe is an ordinary diff.
In three 60 s runs the first frames held 1 to 17, 1 to 11 and 1 to 7 levels in total, with a median of 1, and they arrived 238 ms to 38.7 s, 244 ms to 45.0 s and 291 ms to 53.0 s after the subscribe, as soon as that pair's book next changed.
A book built only from the stream never became complete: after 60 s it held 43 bids and 24 asks on `btc_jpy` in the first run and matched 5 of the REST book's top 20 bids, 14 of 20 bids and 7 of 20 asks in the second run, and 5 of 20 bids and 8 of 20 asks in the third.
CCXT Pro's `watchOrderBook` does not seed from REST either, and it resets the whole book to each diff at `server/node_modules/ccxt/js/src/pro/coincheck.js` lines 97 to 105, so it returns only the levels of the last diff.

### Delta semantics

Each level is `[price, size]`, where the size is the new absolute size at that price and `"0"` deletes the level.
The test is [`ws-probe.mjs`](../../../scripts/probes/venues/coincheck/ws-probe.mjs) `book`: a REST book fetched 3 s after the subscribe, kept up to date with every later diff, and compared with fresh REST books.

| run | pair | REST reference | top 20 bids, exact of 20 | top 20 asks, exact of 20 | same best bid and ask |
|---|---|---|---|---|---|
| 04:32 UTC | `btc_jpy` | 55 s, frames up to the REST request | 20 | 19, and one ask the REST book no longer had | best ask differed |
| 04:32 UTC | `eth_jpy` | 55 s, same | 20 | 19 | yes |
| 04:34 UTC | `btc_jpy` | 20, 38 and 55 s, frames up to 500 ms after the REST reply | 12, 18 and 20 | 17, 18 and 20 | best bid differed at 20 s |
| 04:34 UTC | `eth_jpy` | 20, 38 and 55 s, same | 20, 20 and 20 | 19, 20 and 20 | best bid differed at 20 and 38 s, best ask at 55 s |
| 04:43 UTC | `btc_jpy` | 20, 38 and 55 s, same | 18, 15 and 17 | 19, 18 and 17 | best bid differed at 20 and 38 s |
| 04:43 UTC | `eth_jpy` | 20, 38 and 55 s, same | 19, 19 and 20 | 20, 20 and 20 | best bid differed at 38 and 55 s |

The REST book fetched once and never updated held only 0 to 5 of the top 20 `btc_jpy` bids of the later REST books, so the diffs carry the change.
No kept book was ever crossed.

The misses show that the socket trails the REST book.
In the 04:43 run the kept book held 15 levels, over the six comparisons, that the fresh REST book no longer had.
A later frame touched every one of them 137 to 3,411 ms after the comparison window closed, which is 0.6 to 3.9 s after the REST reply arrived.
14 of the 15 arrived as a `"0"` deletion and one as a new size.
So none of those 15 was lost: the socket delivered each change, but up to about 4 s after the REST book already showed it.
Levels the REST book held and the kept book lacked were not followed, so whether each of them arrived later is Not verified.
The stream is also conflated to about one frame each 365 ms per pair, and nothing aligns a REST reply with a frame.
46.2, 46.1 and 45.3 % of all levels in the diffs were deletions in the three runs.

### Sequence and gap rule

```text
no sequence field, no checksum
a frame is a set of absolute sizes, so applying a frame twice is harmless
a lost frame leaves stale levels that nothing on the wire reveals
```

The only defences are a fresh REST seed and a crossed-book check.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| diff | deletions first, then the other levels, each group best first, descending | deletions first, then the other levels, each group ascending |
| REST `order_books` | descending, up to 200 | ascending, up to 200 |

Among 706 and 612 book frames of the second and third runs, 0 had a deletion after a non-zero level, 0 had an unsorted group, and 0 repeated a price inside one side.
525 and 460 of them were not sorted as a whole, which is the two groups side by side.
A feed applies diffs by price and never by position.

### Level window

Not publicly specified.
Diffs carry levels deep in the book, such as a `btc_jpy` bid at 13,649,515 JPY when the best bid was near 13,707,000, about 0.4 % away.
A `btc_jpy` frame carried at most 43 bids and 26 asks in the first run, and 28 and 15, then 21 and 14, in the other two.
Whether the stream covers levels beyond the REST book's 200 is Not verified.

### Size unit against CCXT `contractSize`

The size is in the base coin, as the REST book and the trades channel give it: `"0.019"` BTC at 13,707,473 JPY is about 260,000 JPY.
CCXT's static markets carry no `contractSize`, so it is `undefined`, see [`rest.md`](./rest.md) section 2.
The engine's connector turns a missing contract size into 1, which is the right multiplier for a base coin size.

### One-sided and empty books

Every frame may carry an empty `bids` or `asks` array.
In the first run 117 of 134 `eth_jpy` frames and all 95 `etc_jpy` frames touched one side only, and in the third run 144 of 159 `eth_jpy` frames.
No REST book was empty on either side at 04:28 or 04:42 UTC, but `grt_jpy` held 7 bids and 3 asks, see [`rest.md`](./rest.md) section 5.

### Idle repeats

Nothing is repeated.
A pair whose book does not change sends no frame: 13, 14 and 14 of 26 pairs sent nothing in the three 60 s runs, and `lsk_jpy`, `mona_jpy` and `trx_jpy` were silent in all three.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `nope_jpy-orderbook` | nothing | socket stays open |
| `BTC_JPY-orderbook` | nothing | socket stays open |
| `fct_jpy-orderbook`, `etc_btc-orderbook`, the two delisted CCXT pairs | nothing | socket stays open |
| `btc_jpy-nope` | nothing | socket stays open |
| `btc_jpy-orderbook` a second time | nothing | 11 frames in 4 s before, then 22 and 18 in the next 4 s in two runs, and 9 of the 18 were byte-identical to the frame before, so each diff arrives twice |
| `{"type":"unsubscribe","channel":"btc_jpy-orderbook"}` | nothing | still 22 frames in 4 s in both runs, 11 of them repeats, so unsubscribe is ignored |
| `{"type":"unsubscribe","channels":["btc_jpy-orderbook"]}` | nothing | still 16 frames in 3 s, 8 of them repeats |
| `{"type":"subscribe","channel":["eth_jpy-orderbook","xrp_jpy-orderbook"]}` | nothing | no `eth_jpy` or `xrp_jpy` frame in 3 s, in both runs |
| `{"type":"subscribe","channels":["eth_jpy-orderbook","xrp_jpy-orderbook"]}`, the private API's plural form | nothing | no `eth_jpy` or `xrp_jpy` frame in 3 s |
| text that is not JSON, `{"type":"nope"}`, `{"foo":1}` | nothing | socket stays open |

Because nothing acknowledges or refuses a subscription, a feed cannot tell a wrong pair from a quiet one.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | no server protocol ping on any socket. A client protocol ping every 20 s got a pong each time |
| silence the server tolerates | Not publicly specified | an unsubscribed socket that sent nothing closed 60.0 s after open with 1006 and no close frame, in both runs. A socket sending a protocol ping every 20 s was still open at 80 s, the cap of the test, in both runs. That matches the 60 s default idle timeout of an AWS load balancer, which is an inference |
| forced disconnect | Not publicly specified | none in 60 to 80 s |
| maintenance notice | Not publicly specified | none seen. A halted pair shows as `itayose` or `stop` in REST `exchange_status` |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 487 to 582 ms to open, eleven opens |
| subscription limits | one channel per subscribe frame | 27 channels on one socket, no limit reached |
| throughput | | every pair on one socket over three runs: median 10 to 13 frames per second, peak 19, 1.6 to 2.0 KB per second, 152 to 158 bytes per frame, 14 to 18 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Subscribe, one channel per frame, with no reply.

```json
{"type": "subscribe", "channel": "btc_jpy-orderbook"}
```

A first frame after the subscribe, which is a diff of one pair and not a snapshot.

```json
["eth_jpy", {"bids": [["436307.0", "0"]], "asks": [["438329.0", "0"], ["437998.0", "0.32"]], "last_update_at": "1790138086"}]
```

A `btc_jpy` diff, deletions first within each side.

```json
["btc_jpy", {"bids": [["13716811.0", "0"], ["13716737.0", "0"], ["13712991.0", "0"], ["13712831.0", "0"], ["13680092.0", "0"], ["13716299.0", "0.005"], ["13714460.0", "0.0306"], ["13713937.0", "0.01"], ["13712861.0", "0.01"], ["13712500.0", "0.01"]], "asks": [["13726667.0", "0"], ["13759856.0", "0"], ["13726637.0", "0.01"], ["13735165.0", "0.0436"]], "last_update_at": "1790138086"}]
```

A one-sided diff.

```json
["sol_jpy", {"bids": [], "asks": [["18887.0", "1.2"]], "last_update_at": "1790138088"}]
```

Trades: time, trade id, pair, rate, amount, taker side, taker order id, maker order id, Itayose order id.

```json
[["1790138098", "309542297", "btc_jpy", "13720000.0", "0.007", "sell", "9248698311", "9248697472", null], ["1790138098", "309542296", "btc_jpy", "13720860.0", "0.003", "sell", "9248698311", "9248698238", null]]
```

No keepalive, acknowledgement or error frame exists to quote.
The keepalive is a protocol ping and pong, which carries no JSON.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://stream.coincheck.com/private`, a login with `ACCESS-KEY`, `ACCESS-NONCE` and `ACCESS-SIGNATURE`, and a plural `channels` array.

- `order-events` and `execution-events`.

## 8. Recommended feed shape

A recommendation for a later spot stage, not a decision.
Coincheck cannot be a perpetual leg, and every pair is quoted in JPY, which the engine's quote family at `server/src/engine/cluster/quoteFamily.ts` lines 3 to 6 does not join to USD, USDC or USDT.
A book kept from this channel also trails the live REST book by one push interval of about 365 ms at best and by up to about 4 s on some levels, see section 4.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://ws-api.coincheck.com/` | one URL serves every pair, 26 pairs in all |
| markets per connection | all 26 | 27 channels on one socket delivered 1.6 to 2.0 KB per second |
| subscribe frames | one `{"type":"subscribe","channel":"<rawMarketId>-orderbook"}` per pair, sent once | a second subscribe duplicates every frame and unsubscribe is ignored |
| seed | after subscribing, `GET /api/order_books?pair=<pair>` per pair, then apply every diff that arrives after the request was sent | no snapshot on the socket, and the REST book is live and 200 levels deep. A diff older than the seed can briefly bring back a level, and its later deletion removes it, since every change arrives as an absolute size |
| keepalive | protocol ping every 20 s | the server sends none and drops a silent socket at 60 s |
| `maxSilenceMs` | 45,000 | pongs every 20 s count as traffic at `server/src/feeds/book/VenueFeed.ts` lines 97 to 98, and a quiet pair can go a whole minute without a frame |
| routing | `msg[0]` when it is a string | the pair id leads the frame |
| delta | set each `[price, size]`, delete on `"0"` | absolute sizes |
| resync | reseed a pair from REST on reconnect, when its kept book crosses, and on a timer such as every 60 s staggered across pairs | no sequence id means a lost frame is otherwise invisible |
| receive time | stamp on arrival | `last_update_at` is whole seconds |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coincheck Exchange API documentation, section WebSocket API | https://coincheck.com/documents/exchange/api | 2026-09-22 | Coincheck, Inc., Japan | URLs, subscribe frame, channels and payloads, pair list, private channels, sections 1 to 7 |
| S2 | Coincheck Exchange API documentation, section Status Retrieval | https://coincheck.com/documents/exchange/api | 2026-09-22 | Coincheck, Inc., Japan | `available`, `itayose` and `stop`, sections 3 and 5 |
| S3 | CCXT Pro 4.5.68 `coincheck.js` | `server/node_modules/ccxt/js/src/pro/coincheck.js` | 2026-09-22 | CCXT | URL at line 27, subscribe at lines 66 to 67, the book reset at lines 97 to 105, section 4 |
| P1 | `ws-probe.mjs book`, runs at 04:32 and 04:34 UTC, and the second pass at 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coincheck/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs errors` and `deflate` at 04:34 UTC, and the second pass at 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coincheck/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 to 5 |
| P3 | `ws-probe.mjs silence` at 04:36 UTC, and the second pass at 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coincheck/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 5 |
