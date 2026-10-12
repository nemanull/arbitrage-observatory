# Coinut WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:42 to 05:06 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Coinut lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers its spot book channel.
The channel is part of the legacy exchange API, which still answers although the exchange is no longer a product on the website, see [`fees.md`](./fees.md) section 1.
Every probed claim comes from [`ws-probe.py`](../../../scripts/probes/venues/coinut/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S10 are those of [`fees.md`](./fees.md) section 10, and P1 to P3 are its probes.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| spot | `wss://wsapi.coinut.com`, S1 | upgraded with 101 in 555 to 650 ms through Cloudflare, `cf-ray` at the YVR edge. A plain HTTPS GET on the host answers `{"status":["OK"], "version": "beta"}`, P1 |
| perpetuals | none | the venue lists none |

One socket carries every spot instrument and every public request.
The REST API at `https://api.coinut.com` takes the same request objects but ignores `subscribe`, S1.

## 2. Channel matrix for public market data

| request | what it gives | probed |
|---|---|---|
| `inst_order_book` | a book snapshot, then `inst_order_book_update` frames per changed level when `subscribe` is true. `top_n` of 10, 50, 100 or 200 limits the side, and `decimal_places` aggregates prices, S1 | snapshot on all 26 instruments, 0 update frames in 120 s |
| `inst_tick` | best bid, best ask, last, 24 h high, low and volume, then updates when `subscribe` is true, S1 | snapshot on 26 instruments, 0 updates |
| `inst_trade` | the last trades, then `inst_trade_update` frames, S1 | a trade list on all 26 instruments, holding 100 trades on 23 of them by the REST read, P1, and 0 updates |
| best bid and ask only | not offered as its own request | `inst_tick` carries `highest_buy` and `lowest_sell` |
| mark, index, funding | Not offered | the venue lists no derivative |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | one socket served book, tick and trade requests on all 26 instruments |
| subscribe frame shape | `{"request":"inst_order_book","inst_id":1,"subscribe":true,"nonce":704114}`, one instrument per frame, S1 | as documented, and every frame was answered |
| unknown symbol expectation | not documented | `{"nonce":607662,"reply":"inst_order_book","status":["INVALID_INST_ID"]}` |
| chunk unit and budget | Not publicly specified | 79 subscribe frames on one socket, the top 10 request and three per instrument sent over about 5 s, got 79 snapshot replies and no refusal |
| keepalive mechanism | application heartbeat `{"request":"hb","nonce":...}` answered by `{"reply":"hb","status":["OK"]}`, S1 | `hb` answered in 187 to 193 ms. No server protocol ping in any run. A socket with no client traffic closes at 60 s, see section 5 |
| connection lifetime and maintenance notice | not documented | no notice seen, and no lifetime cap reached in 120 s with `hb` every 20 s |
| handshake and operation rate limits | Not publicly specified | no refusal seen |
| public market data authentication | none for the public requests, S1 | none. A private request answers `AUTH_NEEDED` |
| message parse and routing | every reply carries `reply`, and a snapshot echoes the request `nonce`, S1 | route on `reply` and `inst_id`. The nonce must lie in 1 to 16,777,215, and 16,777,216 answers `{"status":["INVALID_NONCE"]}` |
| subscribe acknowledgement shape | the snapshot is the acknowledgement, S1 | as documented, with `"status":["OK"]` and the request nonce |
| symbol identifier format | integer `inst_id`, constant over time, with the symbol as the `inst_list` key, S1 | `inst_id` such as 490589 for `BTCUSDT`. A symbol string in `inst_id` fails schema validation, P1 |
| number representation | prices and sizes as strings, S1 | strings, with `count` as an integer. Snapshot prices are cut to the instrument's `decimal_places`, such as `"111024.84"`, while tick prices carry 8 decimals |
| timestamp representation | integer microseconds, S1 | integer microseconds. Every tick carried a `timestamp` of 2026-10-08 16:24:13 UTC, 36.6 to 36.7 hours before the probe runs, P1 |
| size unit | base currency `qty`, S1 | base currency, for example `"qty":"0.00004700"` BTC on `BTCUSDT` |
| sequence semantics | `trans_id` on updates, "check the `trans_id` field for the chronological order", S1 | the snapshot carries `trans_id`, and it rose from 38,975,677,110 to 38,975,680,643 across four snapshots of an unchanged `BTCUSDT` book, P1. So it is a venue wide counter, not a per book sequence |
| idle repeat behaviour | not documented | no frame at all after the snapshots in 120 s |

## 4. The book channel in detail

### Snapshot on subscribe

Yes.
`inst_order_book` answers with the whole book unless `top_n` limits it, S1.
The full `BTCUSDT` snapshot held 310 bids and 42 asks, and `LTCBTC` held 61 bids and 515 asks.
With `top_n` 10 the `BTCUSDT` snapshot held 10 and 10.
`top_n` 20 is refused with `JSON_VALIDATION_FAILED`, because the schema accepts only 10, 50, 100 and 200.
The engine's 20 levels would therefore come from `top_n` 50 cut to 20.

The wire snapshot keys are `buy`, `sell`, `inst_id`, `nonce`, `reply`, `status` and `trans_id`.
The documented `total_buy` and `total_sell` fields were absent, P1.

### Delta semantics

Documented, not seen.
Each `inst_order_book_update` carries one level, `side`, `price`, `qty`, `count` and `trans_id`.
A `qty` of 0 deletes the level, and any other `qty` replaces or inserts the level at that price, S1.
No update frame arrived in 120 s on any of the 26 books, and none arrived in the earlier 60 s run.

### Sequence and gap rule

None usable.
The book update carries `trans_id` and no previous id, S1.
`trans_id` moved by thousands between snapshots of a book that did not change, so a gap in it cannot be detected per book.
The only resync is to resubscribe and take a fresh snapshot.

### Checksum

None documented and none on the wire.

### Level order on the wire

Bids descending and asks ascending, on all levels of the `BTCUSDT` REST snapshot, P1, and in the socket snapshot's first levels.

### Size unit against CCXT `contractSize`

There is no CCXT class, see [`fees.md`](./fees.md) section 8.
Sizes are base currency amounts, so a spot catalog would use a contract size of 1.

### One-sided and empty books

`BTCCAD`, `ETHCAD`, `LTCCAD` and `ZECCAD` sent empty `buy` and `sell` arrays.
`BTCXIDR` sent 11 bids and 1 ask, at a bid of 1,906,060 and an ask of 1,066,524,605.2 XIDR, P1.
The other books are wide and stale, such as `ETHUSDT` at a bid of 660 and an ask of 4,990, and `USDTXSGD` at 1.34 and 88.80, P1.
No book was crossed.

### Idle repeats

None.
After the snapshots the socket carried only the `hb` replies the client asked for.

### Unknown and closed symbols

An unknown `inst_id` answers `INVALID_INST_ID` and nothing more.
The delisted USD pairs of 2023 are not in `inst_list`, see [`fees.md`](./fees.md) section 7.

## 5. Session

| item | probed |
|---|---|
| compression | a client that offers permessage-deflate gets no `Sec-WebSocket-Extensions` header back, so deflate is not negotiated. Frames are text JSON |
| keepalive | send `hb`. With `hb` every 20 s the subscribed socket stayed open for the whole 120 s window |
| silence tolerated | a socket with no client traffic dropped at 60.0 s in two idle runs, and a subscribed socket with no client traffic dropped 59.8 s after its last snapshot. Each drop came with no close frame, code none, so the client sees `ConnectionClosedError` |
| server pings | none seen in any run |
| unsubscribe | `subscribe` false on `inst_tick` got no reply within 2 s |
| not JSON | `hello` answers `{"msg":"hello","status":["INVALID_JSON_FORMAT"]}` |
| unknown request | `{"nonce":607664,"reply":"no_such_request","status":["INVALID_REQUEST_TYPE"]}` |

## 6. Captured frames

Heartbeat request and answer.

```json
{"request": "hb", "nonce": 607686}
{"nonce":607686,"reply":"hb","status":["OK"]}
```

Book snapshot with `top_n` 10 on `BTCUSDT`, trimmed to two levels a side.

```json
{"buy":[{"count":1,"price":"111024.84","qty":"0.00004700"},{"count":1,"price":"67000.00","qty":"0.00999900"}],"inst_id":490589,"nonce":608501,"reply":"inst_order_book","sell":[{"count":1,"price":"111111.00","qty":"0.00001833"},{"count":1,"price":"140000.00","qty":"0.00007400"}],"status":["OK"],"trans_id":38975682805}
```

Tick snapshot on `BTCCAD`, an empty book whose last trade was in 2020.

```json
{"high24":"9698.10000000","highest_buy":"0","inst_id":1801843,"last":"9698.10000000","low24":"9698.10000000","lowest_sell":"0","nonce":607768,"prev_trans_id":0,"price_change_24":"0","reply":"inst_tick","status":["OK"],"timestamp":1791476653578397,"trans_id":38974911443,"volume":"136.37721063","volume24":"0.00320000","volume24_quote":"31.03392000","volume_quote":"868958.29494790"}
```

Errors.

```json
{"nonce":607662,"reply":"inst_order_book","status":["INVALID_INST_ID"]}
{"nonce":607667,"reply":"user_balance","status":["AUTH_NEEDED"]}
```

No delta frame could be captured, because no book changed while a socket was open.
The second bid sits 39.7 % below the first, and the second ask 26.0 % above the first, which shows how thin and stale the book is.

## 7. Private channels

The same socket serves `login`, by username and password or by API key with an HMAC SHA256 signature, then `user_balance`, `new_order`, `new_orders`, `user_open_orders`, `cancel_order`, `cancel_orders` and `trade_history`, S1.
Order replies arrive as `order_accepted`, `order_filled` and `order_rejected`, S1.

## 8. Recommended feed shape

None.
Coinut has no perpetual, and its spot books have not changed during any probe and have not traded since 2026-02-04, see [`rest.md`](./rest.md) section 2.
If a spot feed were ever wanted, it would be one socket to `wss://wsapi.coinut.com`, one `inst_order_book` frame per instrument with `top_n` 50 and `subscribe` true, `hb` every 20 s, and a resubscribe as the only resync.
`maxSilenceMs` could not rest on book frames, because a quiet book sends nothing, so liveness would rest on the `hb` replies, under the 60 s drop.

## 9. Source ledger

The sources are S1 to S10 and the probes P1 to P3 of [`fees.md`](./fees.md) section 10.

| id | what it supports here |
|---|---|
| S1 | the endpoint, every request and reply shape, `top_n` values, delta rule, nonce range, private request names |
| P1 | REST snapshots, level order, `trans_id` movement, tick timestamps, empty and wide books |
| P2 | handshake, extensions, `hb` timing, snapshots over the socket, 0 updates in 120 s, the 60 s drop, error frames. Runs at 04:47 to 04:48, 04:48 to 04:51 and 04:51 to 04:55 UTC on 2026-10-10, and the second pass rerun at 05:01 to 05:03 UTC with `--short book errors deflate` |
