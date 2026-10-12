# Tebbit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:05 to 03:36 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public futures WebSocket of Tebbit, which has no CCXT id, for its one perpetual family, USDT-margined linear perpetuals.
Tebbit publishes no API documentation, so every "documented" value below comes from the website's own bundle, `https://tebbit.io/static/js/main.28a3fab6.chunk.js`, S1.
Every protocol claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/tebbit/ws-probe.py), runs W1 and W2 of section 9, or by [`endpoints-probe.py`](../../../scripts/probes/venues/tebbit/endpoints-probe.py), run E1.
Each `ws-probe.py` run holds sockets for about 4.5 socket minutes, and E1 for about 12 socket seconds, so about 9.5 minutes in total.

## 1. Endpoints

| family | URL in the website bundle | probed |
|---|---|---|
| USDT-M perpetuals | `wss://<host>/ws/market`, built from `document.domain` as `ws` plus `/market`, S1 | `wss://tebbit.io/ws/market` opens and delivers |
| private | `wss://<host>/ws/user`, subscribed with a `listenKey`, S1 | not probed |
| spot | `wss://<host>/ws/socket`, S1 | opens. A futures style `sub_symbol` frame got no answer in 4 s, E1. Not detailed. |
| bare `/ws` | not used by the bundle | `wss://tebbit.io/ws` answers the upgrade with HTTP 404, E1 |
| coin-M | no separate URL, and the coin-M catalog is empty | not applicable |

The REST paths match XT's futures API under the prefix `/futures/fapi/market`, see [`rest.md`](./rest.md) section 2.
The socket does not speak XT's documented Open API protocol.
A `{"method":"SUBSCRIBE","params":["depth_update@btc_usdt,100ms",...],"id":"a1"}` frame on `wss://tebbit.io/ws/market` got no acknowledgement and no data in 5 s, while a text `ping` on a second socket got `pong`, E1.
The protocol that works is the one the bundle sends: `{"req":"sub_symbol","symbol":"btc_usdt"}`, S1.

## 2. Channel matrix for public market data

| request | channels it starts | probed rate on `btc_usdt` |
|---|---|---|
| `{"req":"sub_symbol","symbol":"<id>"}` | `push.deep.full` | 33 frames in 20 s, one every 0.60 s, 100 levels a side, W1 and W2 |
| | `push.deep` | 331 and 343 frames in 20 s, one price level per frame |
| | `push.deal` | 24 and 23 trades in 20 s |
| | `push.mark.price` | 40 and 39 frames in 20 s, `{s, p, t}` |
| | `push.index.price` | 33 frames in 20 s in both runs, `{s, p, t}` |
| | `push.ticker`, `push.agg.ticker` | 33 each in 20 s in both runs. `push.agg.ticker` adds `i` index, `m` mark, `bp` and `ap` |
| `{"req":"sub_mark_prices"}` | `push.mark.prices` | 4 and 5 frames in 15 s, one every 3.03 to 3.04 s, 414 rows each |
| `{"req":"sub_tickers"}` | `push.tickers` | 4 and 5 frames in 15 s, one every 3.03 to 3.04 s, 412 rows each |
| `{"req":"sub_kline", ...}` | klines | in the bundle, not probed |

`sub_symbol` starts every per contract channel at once, and no request selects one channel or a depth.
No channel carries a funding rate, interval or next settlement, and the REST funding call returns nulls, see [`rest.md`](./rest.md) section 3.
On `btc_usdt` the mark and index frames carried the same `p` and `t` in the captured examples, `82537.7` at `1791602313384` in W1 and `82557.0` at `1791603071184` in W2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Documented" means the website bundle, since no API documentation exists.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market URL, one user URL, one spot URL, S1 | one URL carries every perpetual |
| subscribe frame shape | `{"req": <event>, ...data}`, with `sub_symbol {symbol}`, `sub_tickers`, `sub_mark_prices`, `sub_kline` and their `unsub_` pairs, S1 | as documented. A second `sub_symbol` replaces the first: `btc_usdt` then `eth_usdt` delivered only `eth_usdt`, 183 and 105 frames in 4 s |
| unknown symbol expectation | none in the bundle | `sub_symbol` with `nope_usdt`, with upper case `BTC_USDT`, or with no symbol all answer `succeed` and deliver nothing |
| chunk unit and budget | one symbol per socket, since the bundle calls `unsub_symbol` with no argument | one symbol per socket on the wire. Eight sockets opened at once from this host, each with one symbol, and all eight delivered in both runs |
| keepalive mechanism | the client sends text `ping` every 10 s and answers any frame matching `/ping/` with a pong, S1 | text `ping` answered by text `pong`, 6 of 6 in both runs. The server sent no ping in about 70 s |
| connection lifetime and maintenance notice | none | a socket that sent nothing for about 70 s stayed open and kept delivering, in both runs. No notice frame seen |
| handshake and operation rate limits | none | none hit at eight sockets opened together |
| public market data authentication | none for `/ws/market` | none needed |
| message parse and routing | text JSON `{channel, data}`. The bundle also inflates binary frames with pako, S1 | every frame was text JSON except the bare strings `succeed`, `pong` and `Invalid parameter`. No binary frame arrived. Routing is by `channel` and `data.s` |
| subscribe acknowledgement shape | none in the bundle | the bare text `succeed`, with no id and no symbol, even for an unknown symbol |
| symbol identifier format | lower case `base_quote` | `btc_usdt`, equal to the catalog `symbol`. Five ids are Chinese, such as `龙虾_usdt`, and `sub_symbol` with `龙虾_usdt` delivered 48 frames in 3 s |
| number representation | strings | decimal strings, and sizes in full books are often in E notation: 1,169 and 1,172 of 6,600 sizes, such as `"1E+1"` and `"1.64E+4"` |
| timestamp representation | `t` in Unix ms | `t` in Unix ms on deltas, deals, mark, index and tickers. Full books carry no `t` |
| size unit | contracts | contracts. The BTC contract is 0.0001 BTC, see [`rest.md`](./rest.md) section 2 |
| sequence semantics | not in the bundle | `id` on deltas and full books is a large integer string, strictly increasing, with steps of 1 on 25 of 330 and 38 of 342 steps and a median step of 2, so gaps cannot be detected |
| idle repeat behaviour | none | a full book every 0.53 to 0.68 s on `btc_usdt`, and 11 to 17 full books in 10 s on each of eight contracts in W2, none identical to the one before, even on `akam_usdt` with 32 deltas in 10 s |

## 4. The book channel in detail

| question | answer | evidence |
|---|---|---|
| snapshot on subscribe | yes in effect: the first `push.deep.full` arrives within about 0.6 s, and one follows every 0.53 to 0.68 s | W1, W2 |
| full book depth | 100 bids and 100 asks on every full book of `btc_usdt`, and on the eight contracts of W2, keys `s`, `id`, `b`, `a` | W1, W2 |
| delta semantics | `push.deep` carries one level: `ba` 1 for a bid and 2 for an ask, `p`, absolute size `q`, and `q` `"0"` to delete | ba 1 prices had a median of 82537.4 and ba 2 of 82538.1 against a best bid of 82537.5 in W1, and 82556.7 and 82557.3 against 82556.7 in W2. 19 of 331 and 17 of 343 deltas were deletions |
| deltas per instant | a median of 5 delta frames share one `t`, up to 10 and 13 | W1, W2 |
| rebuild rule | apply every `push.deep` whose `id` is greater than the last full book's `id` | rebuilding each full book from the one before matched the next full book on its top 20 levels 32 times out of 32 in each run |
| sequence and gap rule | none: ids are strictly increasing but skip values, so a missing delta is invisible | W1, W2 |
| relation to REST | the REST book's `u` equalled the `id` of a full book captured in the same second, `679059129477627971` in W1 and `679062309179490395` in W2 | W1, W2 |
| checksum | none | W1, W2 |
| level order on the wire | bids descending and asks ascending in full books | W1, W2 |
| size unit | contracts, multiplied by the catalog `contractSize` | [`rest.md`](./rest.md) section 2 |
| one-sided and empty books | not seen on the twelve contracts probed | W1, W2 |
| unknown or closed symbol | answered `succeed` and silence | W1, W2 |

A full book every 0.6 s is a whole 100 level snapshot, so a feed that only reads `push.deep.full` needs no sequence rule and loses at most about 0.6 s.
A feed that also applies `push.deep` gets per level freshness, and the next full book replaces any drift.
The per delta frames are small and many: about 17 a second on BTC.

## 5. Session

| item | value | evidence |
|---|---|---|
| keepalive | text `ping`, answered by text `pong` | W1, W2 |
| silence tolerated | at least 65 s with no client frame, while data flowed | W1, W2 |
| forced disconnects | none in about 70 s | W1, W2 |
| malformed frame | a non JSON text frame is answered `Invalid parameter` and the server then closes with no status, code 1005 | W1, W2 |
| unknown `req` | `{"req":"bogus"}` gets no answer and the socket stays open | W1, W2 |
| unsubscribe | `{"req":"unsub_symbol"}` answers `succeed`. No frame followed in 3 s in W1, and 10 frames of the old symbol followed in W2 before silence | W1, W2 |
| compression | permessage deflate was not offered by the probes, and the server sent no `Sec-WebSocket-Extensions` header | E1 |
| handshake | plain upgrade, no token, no origin check seen | W1, W2, E1 |
| subscription limit | one symbol per socket, by replacement | W1, W2 |
| frame lag | arrival minus `t` on the local clock: mark and index 120 and 166 ms, deltas 281 and 282 ms, deals 250 and 244 ms. The server clock read about 0.3 s ahead of the local clock, so the true lag is about 0.3 s more | W1, W2, [`rest.md`](./rest.md) section 7 |

## 6. Captured frames

Subscribe acknowledgement, a bare text frame:

```text
succeed
```

A full book, trimmed to two levels a side:

```json
{"channel": "push.deep.full", "data": {"s": "btc_usdt", "id": "679059129477627971", "a": [["82537.9", "4859"], ["82538", "1.64E+4"]], "b": [["82537.5", "29646"], ["82537.4", "8308"]]}}
```

This is the first full book of W1, and its id equals the `u` of the REST book read in the same second.

A delta that deletes an ask level:

```json
{"channel": "push.deep", "data": {"id": "679059131239235650", "s": "btc_usdt", "ba": 2, "p": "82537.9", "q": "0", "t": 1791602313196}}
```

Mark price:

```json
{"channel": "push.mark.price", "data": {"s": "btc_usdt", "p": "82537.7", "t": 1791602313384}}
```

Keepalive answer to a text `ping`:

```text
pong
```

Error answer to a non JSON frame, followed by a close with code 1005:

```text
Invalid parameter
```

## 7. Private channels

`wss://<host>/ws/user` with `{"req":"sub_user","listenKey":<key>}`, where the key comes from a logged in session, S1.
Not probed.

## 8. Recommended feed shape

| item | value |
|---|---|
| URL | `wss://tebbit.io/ws/market` |
| markets per connection | one, because a second `sub_symbol` replaces the first. Covering all 412 perpetuals would take 412 sockets. |
| subscribe frame | `{"req":"sub_symbol","symbol":"<id>"}` |
| book | reset the book from each `push.deep.full`, then apply `push.deep` with `id` above that full book's `id`. Parse sizes as floats, since E notation is common. |
| keepalive | text `ping` every 10 s, as the website does |
| `maxSilenceMs` | 10,000. A full book arrives every 0.6 s on every contract probed, so 10 s of silence means a dead socket. |
| resync | none needed beyond the next full book, since there is no detectable gap |

The one symbol per socket rule is the cost.
The engine's feed plans connections in slices, so a slice of one is expressible, but 412 sockets from one host is far beyond what any other venue needs.
The book feed is not what blocks this venue, see [`rest.md`](./rest.md) section 8.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | website bundle `https://tebbit.io/static/js/main.28a3fab6.chunk.js`: the URL builder with `ws` and `spotWs`, the socket class with `emit`, `sub_symbol`, `sub_tickers`, `sub_mark_prices`, `sub_user`, the 10 s text ping and the pako inflate | 2026-10-09 |
| W1 | [`ws-probe.py`](../../../scripts/probes/venues/tebbit/ws-probe.py) first run, 2026-10-10 03:18 UTC, with part D on the first eight catalog contracts | 2026-10-09 |
| W2 | [`ws-probe.py`](../../../scripts/probes/venues/tebbit/ws-probe.py) second pass run, 2026-10-10 03:31 UTC, with part D on the first four and last four catalog contracts | 2026-10-09 |
| E1 | [`endpoints-probe.py`](../../../scripts/probes/venues/tebbit/endpoints-probe.py), 2026-10-10 03:35 UTC, rerun at 03:36 UTC with the same four results. It replaced manual checks made at 03:05 UTC. | 2026-10-09 |
