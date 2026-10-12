# C-Patex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09, for the venue survey of 2026-09-22, CoinMarketCap addition at rank 73, wave 42.

**Probed:** 2026-10-10 between 02:54 and 03:09 UTC, the evening of 2026-10-09 in local time, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the public spot WebSocket of C-Patex, because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The socket is a JSON-RPC protocol of the ViaBTC exchange server family, with `depth.subscribe`, `depth.update` and a `clean` flag, the same family as CCXT's `p2b` socket.
Every probed value below comes from [`ws-probe.py`](../../../scripts/probes/venues/c-patex/ws-probe.py), in two full runs, and the documented value is from the API documentation S1.
Run 1 used an earlier revision of the probe, whose `idle` mode sent nothing after the subscribe and whose `book` mode did not compare a mid-stream snapshot with the maintained book.
Run 2 used the revision in the repository, which also tries the limits 101, 200 and 500 in `params`.
The probe held one socket at a time for about 9.2 minutes in total, including a ten second first look.

## 1. Endpoints

| scope | documented URL | probed |
|---|---|---|
| public market data and private user data, one socket | `wss://ws.c-patex.com/`, S1 line 1709 | opened in 496 to 599 ms over twelve opens, HTTP 101 through Cloudflare, `permessage-deflate` offered, no refusal from the Canadian exit |
| web app socket | not documented, `wss://back.c-patex.com/ws` appears in the web bundle | answers a WebSocket handshake with HTTP 200 and a JSON body, not an upgrade, [`rest-probe.py`](../../../scripts/probes/venues/c-patex/rest-probe.py) `errors` |

Spot is the only product, so there is no split by product family.

## 2. Channel matrix for public market data

| channel | depth and speed | probed |
|---|---|---|
| `depth.subscribe` then `depth.update` | `[market, limit, interval]`, limit 1 to 100, interval `"0"` or `"0.01"` | snapshot then deltas, section 4, recommended |
| `depth.query` | same parameters, one reply | returns the current book, used to cross-check section 4 |
| `price.subscribe` | last price | `price.update` with `[market, "82628.00000000"]` |
| `state.subscribe` | 24 h statistics | `state.update` with `period` 86400, `last`, `open`, `close`, `high`, `low`, `deal`, `volume`, `change` |
| `deals.subscribe` | trades | `deals.update` with a batch of recent trades, `time` as a float in seconds |
| `kline.query` and `kline.subscribe` | candles | `kline.query` answered with 60 s candles |
| best bid and ask, mark, index, funding | none | no such channel in S1 |

## 3. The sixteen axes

The axes are those of `docs/research/2026-07-30-venue-ws-protocol-differences.md`.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | one URL, section 1 |
| subscribe frame shape | `{"method":"depth.subscribe","params":["ETH_BTC",1,"0"],"id":111}`, S1 | as documented. A nested list of two markets and a flat list of two markets are both refused with `{"code":1,"message":"invalid argument"}` |
| unknown symbol expectation | not documented | `NOPE_USDT` and `btc_usdt` are acknowledged with `{"status":"success"}` and then get one empty snapshot `[true,{},"NOPE_USDT"]` |
| chunk unit and budget | one market per depth subscription. "Repeated subscription will be cancelled for the same data type", S1 line 1616 | a second `depth.subscribe` on the same socket replaced the first: only `ETH_USDT` frames arrived after it, in both runs. So one socket carries one depth market |
| keepalive mechanism | `server.ping` answered with `"pong"`, S1 line 1752 | as documented. The server sent no protocol ping |
| connection lifetime and maintenance notice | Not publicly specified | the server closed with code 1000 and an empty reason 106.1 s after the last client message in run 1, and 115.4 s after it in run 2, although depth frames kept arriving |
| handshake and operation rate limits | Not publicly specified | twelve opens and about forty requests, none refused |
| public market data authentication | none | none. `asset.query` without `server.auth` answers `{"code":6,"message":"require authentication"}` |
| message parse and routing | `method` plus `params`, `id` null on notifications, S1 | as documented. The market is the third element of `depth.update` params |
| subscribe acknowledgement shape | `{"result":{"status":"success"},"error":null,"id":n}`, S1 | as documented, `params` empty on success and echoing the request on error |
| symbol identifier format | `BASE_QUOTE`, such as `ETH_BTC` | `BTC_USDT`, identical to REST `name`. Case matters: `btc_usdt` gets an empty book |
| number representation | strings | prices and sizes as strings, `server.time` as an integer |
| timestamp representation | `server.time` in seconds | integer seconds, and no timestamp on `depth.update` |
| size unit | base asset, "amount in 1st Ticker", S1 | base asset, matching REST depth |
| sequence semantics | none documented | no sequence, no checksum, no update id on any depth frame |
| idle repeat behaviour | not documented | no repeats. `BTC_USDT`, the busiest pair, sent 6 depth frames in 60 s in each run, with a median gap of 11.65 s in run 1 and 15.02 s in run 2 |

## 4. The book channel in detail

### Snapshot on subscribe

The first `depth.update` after the acknowledgement has `clean` `true` and holds the whole book up to `limit` on each side.
It arrived within 1 ms of the acknowledgement in both runs, 100 asks and 100 bids at limit 100.

### Delta semantics

Later frames have `clean` `false` and carry only changed levels, as `[price, size]` pairs.
Size `"0"` deletes a level, any other size replaces it.
S1 line 2536 describes `clean` as "FALSE: returned latest result, TRUE - no updates", and the wire shows the meaning above.

A second `clean` `true` frame arrived mid-stream, 28.6 s after the first snapshot in run 1 and 50.6 s after it in run 2.
In run 2 the mid-stream snapshot matched the maintained book on the ask side but not on the bid side, so it corrects a book that a client trimming to the limit can no longer rebuild from deltas.
A client must treat every `clean` `true` frame as a full replacement.

### Levels outside the limit

Deltas carry levels far outside the subscribed depth.
At limit 100 a delta in run 2 added a bid at 76641.89 and deleted an ask at 89085.41 while the best bid and ask were near 82,610.
Run 1 counted 2 additions beyond the deepest held level and 3 deletions of levels that were never in the book, and run 2 counted 3 and 2.
A client should keep only the best `limit` levels per side or simply read the top of book, which is unaffected.

### Sequence and gap rule

There is none.
Without a sequence a lost frame cannot be detected, so the only repair is the next `clean` `true` frame or a resubscribe.
After 60 s the maintained top five levels matched both `depth.query` and REST `depth/result` on both sides, in both runs.

### Checksum

None.

### Level order on the wire

Asks ascend from the best ask.
Bids also ascend, so the best bid is the last element, on snapshots, deltas and `depth.query`.
S1 shows bids descending in its REST example, see [`rest.md`](./rest.md) section 5, and the wire disagrees.

### Size unit against CCXT's contractSize

Sizes are base asset units.
There is no CCXT class, so there is no `contractSize` to compare.

### One-sided, empty and unknown books

`NOPE_USDT` gets an acknowledgement and one empty snapshot `{}`.
REST shows thin and one-sided books on several pairs, for example `PATEX_USDT` with 91 asks and 1 bid, see [`rest.md`](./rest.md) section 5.

### Parameters

| limit | interval | reply |
|---|---|---|
| 1, 5, 50, 100 | `"0"` | success, snapshot of that depth |
| 101, 200, 500, 1000, 1001 | `"0"` | `invalid argument` |
| 0 | `"0"` | `invalid argument` |
| 5 | `"0.01"` | success |
| 5 | `"1"`, `"10"`, `"abc"` | `invalid argument` |

S1 says the interval defaults to `1` and offers `0` for no interval, line 2512, but `"1"` is refused on the wire.

## 5. Session

| item | probed |
|---|---|
| keepalive | send `{"method":"server.ping","params":[],"id":n}`, answered with `"pong"` in about 160 ms |
| silence tolerated | about 106 to 115 s without a client message. A ping 60 s after open kept the socket alive until 115.4 s after that ping |
| forced disconnect | close code 1000 with an empty reason after that silence. No other disconnect in about 9 minutes |
| maintenance notices | none seen, none documented |
| compression | `permessage-deflate;client_max_window_bits=15` accepted |
| malformed JSON | ignored with no reply, and the socket stayed usable |
| unknown method | `depth.nope` got no reply at all within 3 s |
| server time | `server.time` returned integer seconds, 0.22 s and 0.20 s behind the midpoint of the request on the host's clock, at one second resolution |

## 6. Captured frames

Subscribe acknowledgement:

```json
{"id":3,"params":[],"result":{"status":"success"},"error":null}
```

Snapshot, trimmed to two levels per side:

```json
{"id":null,"method":"depth.update","params":[true,{"asks":[["82640.76325","1.26"],["82645.96377","0.85434"]],"bids":[["82622.83689","1.43"],["82624.23675","0.9426"]]},"BTC_USDT"]}
```

Delta, with a deletion and a level far below the book:

```json
{"id":null,"method":"depth.update","params":[false,{"bids":[["76645.44082999","0"],["82608.93756861","0.75"],["82620.13716","0"]]},"BTC_USDT"]}
```

Keepalive answer:

```json
{"id":1,"params":[],"result":"pong","error":null}
```

Error:

```json
{"id":25,"params":["BTC_USDT",101,"0"],"result":null,"error":{"code":1,"message":"invalid argument"}}
```

## 7. Private channels

S1 documents `server.auth` with a web token, then `asset.query`, `asset.subscribe`, `order.query`, `order.history` and `order.subscribe`, on the same URL.
None was called.

## 8. Recommended feed shape

C-Patex cannot join as a perpetual leg, so this is the shape a future spot feed would take.

| item | value |
|---|---|
| URL plan | `wss://ws.c-patex.com/`, one socket per market, because a second `depth.subscribe` replaces the first |
| markets per connection | 1. The 26 listed pairs need 26 sockets, and only about 12 have volume, see [`rest.md`](./rest.md) section 2 |
| subscribe frame | `{"method":"depth.subscribe","params":["BTC_USDT",50,"0"],"id":1}` |
| keepalive | `server.ping` every 30 s |
| `maxSilenceMs` | 60000, since `BTC_USDT` went up to 16.0 s between depth frames and quieter pairs may go longer |
| resync rule | replace the book on every `clean` `true` frame, drop levels beyond the limit, and resubscribe after a close or a silence past `maxSilenceMs` |

The missing sequence, the one market per socket rule and the slow update cadence make this a weak spot feed even before the lack of perpetuals.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | C-Patex API documentation, `https://github.com/PatexGit/api-docs/blob/main/API.md`, last commit `565474b` of 2023-08-04, section "WebSocket Protocol API" from line 1612 | documented column |
| S2 | web bundle served by `https://c-patex.com/`, read 2026-10-09 | `wss://back.c-patex.com/ws` and `wss://ws.c-patex.com` |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/c-patex/ws-probe.py), modes `book`, `multi`, `params`, `errors`, `channels` and `idle`, two full runs | probed column |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/c-patex/rest-probe.py), modes `catalog` and `depth` | cross-checks |
