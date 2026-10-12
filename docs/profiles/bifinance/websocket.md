# BiFinance WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 (2026-10-10 UTC), from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the public perpetual market data socket of BiFinance (no CCXT id).
BiFinance documents no WebSocket API.
The socket below is the futures web app's own feed, and its URL and topic names come from the public JS bundle (S1).
Every probed number comes from [`ws-probe.py`](../../../scripts/probes/venues/bifinance/ws-probe.py), modes A to D.
The first run started 2026-10-10 02:33 UTC and the second pass rerun 02:43 UTC, and where the two differ both are given.

## 1. Endpoints

| family | URL | source |
|---|---|---|
| USDT-margined perpetuals, all 55 contracts | `wss://www.bifinance.com/wsContract/zh_cn/` | S1, `VITE_APP_WS_FUTURES_URL` `wss://{domain}/wsContract/zh_cn/` with `{domain}` the page's host |
| spot | `wss://www.bifinance.com/ws/zh_cn/` | S1, `VITE_APP_WS_URL`, named here and not detailed |

There is one perpetual family, so one socket carries every contract.
The handshake needs no token, no cookie and no origin, and it took 336 ms and 331 ms in the two runs (mode A).
Mode C held all 55 contracts' depth topics on one socket.

## 2. Channel matrix for public market data

Topic names are from the bundle (S1), with `<sym>` the lowercase contract id such as `btcusdt`.

| data | topic | probed |
|---|---|---|
| book, top 20 per side | `alpha-market-depth-contract-<sym>-trade` | yes, full replace each frame, sizes in `cumulativeCommissionQuantity` |
| book, top 30 per side | `alpha-market-depth-contract-<sym>-paint` | yes, full replace each frame, sizes in `lastNumber` |
| mark and index | `usdt-marked-price-<sym>` | yes, `{coinMarket, indexPrice, markedPrice}` |
| ticker, every contract | `alpha-market-ticker-contract` | yes, 39 frames naming 27 contracts in 4 s, with 24 h stats, klines and `trade`, and no mark, index or funding field (mode B) |
| trades | named in the bundle as `subTradeHistory`, topic not resolved | no |
| best bid and ask only | none | no such topic in the bundle |
| funding | none | no funding topic in the bundle |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so the documented column records what the bundle shows.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one futures URL and one spot URL, S1 | one socket carried all 55 contracts |
| subscribe frame shape | `{"id": randomString(), "cmd": "sub", "topic": "<topic>", "data": {}}`, one topic per frame, S1 | 55 frames in a burst all delivered, and a frame with no `id` is refused with `{"invalidParameter": "id"}` |
| unknown symbol expectation | not in the bundle | a text frame `{"invalidParameter": "<topic>"}`, then nothing |
| chunk unit and budget | not in the bundle | 55 topics on one socket, 1,577 and 1,564 frames in 30 s, no refusal |
| keepalive mechanism | server sends `{"ping": <ms>}` and the client answers `{"pong": <same>}`, S1 | a server ping every 5.0 to 5.2 s. A socket that never answered was still open at 75 s |
| connection lifetime and maintenance notice | not in the bundle | none seen within 75 s |
| handshake and operation rate limits | not in the bundle | none hit at 5 handshakes per run and 55 subscribe frames in a burst |
| public market data authentication | none for market topics, S1 | none |
| message parse and routing | route on `topic`, S1 | every data frame carries `topic`, `cmd`, `data`, `time`, `responseCode`, `pushMessageType` |
| subscribe acknowledgement shape | none, S1 | no acknowledgement frame, the first data frame came 261 to 873 ms after the subscribe in the first run and 285 to 1,262 ms in the second |
| symbol identifier format | `<sym>` lowercase in the topic, `symbolKey` `CONTRACT/BTCUSDT` in the body | the catalog's `coinMarket` `BTCUSDT`, lowercased, and `originCoinMarket` `CONTRACT/BTCUSDT` in the body |
| number representation | not in the bundle | prices and sizes are strings, `lastPrice` and `lastPriceCny` are JSON numbers |
| timestamp representation | not in the bundle | envelope `time` in integer ms, monotonic on every topic, no per level or per book exchange time |
| size unit | not in the bundle | contracts of the catalog's `faceValue`, inferred from magnitude, section 4 |
| sequence semantics | none | no sequence field, each frame replaces the whole window |
| idle repeat behaviour | not in the bundle | 0 to 4 identical consecutive book bodies per topic in 40 s, and 22 and 18 of 27 consecutive mark bodies |

Every frame, the server ping included, is a binary frame holding a gzip stream (235 of 235 and 220 of 220 in mode A), and the bundle inflates it with `pako.inflate` (S1).
The few text frames are the `invalidParameter` and `invalid protocol` errors.
Permessage deflate is not used, since the probe offered none and the frames came anyway.

## 4. The book channel in detail

### Snapshot on subscribe

There is no separate snapshot.
Every frame of `-trade` carries the full top 20 bids and top 20 asks, and every frame of `-paint` the full top 30, so the first frame is a snapshot and each later frame replaces the book.
The first BTCUSDT `-trade` frame came 325 ms and 862 ms after the subscribe in the two runs.

### Delta semantics

None, each frame is a full replacement of the window.
A feed calls `resetBook`, writes all levels, and publishes, once per frame.

### Sequence and gap rule

No sequence or update id exists on the wire.
With full replacement no gap can corrupt the book, so the only rule is a silence watch.

### Checksum

None.

### Level order on the wire

Bids descending and asks ascending on every frame of both runs: 65 and 45 BTCUSDT, 51 and 57 ETHUSDT and 32 and 30 CSCOUSDT `-trade` frames, and 52 and 53 BTCUSDT `-paint` frames.
No frame was crossed.

### Level window

`-trade` held exactly 20 bids and 20 asks on every frame, and `-paint` exactly 30 and 30.
The REST `contract-market/deeps` call returns the same 20 per side, and `contract-market/depth` with `type paint` the same 30 ([`rest.md`](./rest.md) section 5).

### Cadence

| topic, mode A, 40 s | frames, run 1 and 2 | gap median | gap max |
|---|---|---|---|
| BTCUSDT `-trade` | 65 and 45 | 545 and 999 ms | 1,002 and 1,198 ms |
| ETHUSDT `-trade` | 51 and 57 | 883 and 576 ms | 1,228 and 1,064 ms |
| CSCOUSDT `-trade` | 32 and 30 | 1,053 and 1,108 ms | 3,586 and 3,074 ms |
| BTCUSDT `-paint` | 52 and 53 | 817 and 753 ms | 1,230 and 1,218 ms |
| BTCUSDT mark and index | 28 and 28 | 1,382 and 1,390 ms | 2,874 and 1,550 ms |

In mode C, with all 55 contracts on one socket for 30 s, every contract sent frames in both runs, 15 to 52 each with a median of 24, then 16 to 53 with a median of 23.
The longest silence on one contract, counting the window edges, was 7.7 s on 1000BONKUSDT in the first run and 5.5 s on METAUSDT in the second.

### Size unit against `contractSize`

There is no CCXT class, so no CCXT `contractSize` exists.
The catalog's `faceValue` is 0.001 for BTCUSDT, 0.01 for ETHUSDT and TSLAUSDT, 0.1 for SOLUSDT and 1000 for 1000PEPEUSDT ([`rest.md`](./rest.md) section 2).
A BTCUSDT top bid of `2214.000` read as contracts is 2.214 BTC, against Binance USD-M's top bid of 3.468 BTC at about the same moment, while read as BTC it would be a level of about 183 million USDT ([`rest.md`](./rest.md) section 5, second pass).
So the size unit is contracts of `faceValue`, inferred from magnitude, and Not publicly specified.
In the second run every `-trade` size was a whole number, written with 3 decimals on BTCUSDT and 2 on ETHUSDT and CSCOUSDT (1,800, 2,280 and 1,200 levels), and `-paint` sent the same sizes as integers (3,180 levels).
`cumulativeTransactionVolume` was `"0"` on the top bid of most frames, and a whole number on 1 of 45 BTCUSDT and 2 of 57 ETHUSDT frames in the second run, with no published meaning.

### One-sided and empty books

Not seen, in mode A every frame of the three `-trade` topics held 20 levels per side, and in mode C all 55 contracts sent frames.

### Idle repeats

A quiet book still sends frames.
Between 0 and 4 identical consecutive bodies were seen per book topic in 40 s, and the mark topic repeats its body when the price does not move.

### Unknown, closed and wrong-level symbols

| case | answer |
|---|---|
| `alpha-market-depth-contract-nopeusdt-trade` | text `{"invalidParameter": "alpha-market-depth-contract-nopeusdt-trade"}`, then nothing |
| `alpha-market-depth-contract-btc-usdt-trade`, the spot spelling | text `{"invalidParameter": ...}` |
| `alpha-market-depth-btc-usdt-trade`, a spot topic on the futures socket | text `{"invalidParameter": ...}` |
| `not json` | text `invalid protocol`, and the socket stays open |
| a subscribe with no `id` | text `{"invalidParameter": "id"}`, and no data |
| the same topic subscribed twice | 4 and then 7 ETHUSDT frames in 4 s, which is the single stream's cadence, so not doubled |
| `cmd unsub` | 0 further frames in the first run, and 1 frame 81 ms later in the second, then nothing |

No delisted contract was available to test.

## 5. Session

| item | value |
|---|---|
| keepalive | server `{"ping": <ms>}` every 5.0 to 5.2 s, client answers `{"pong": <ms>}` (S1 `sendNow({pong: t.ping})`) |
| silence tolerated | a socket that never answered 14 pings was still open at 75 s in both runs (mode D) |
| forced disconnects | none in 75 s |
| maintenance notices | none seen, none named in the bundle |
| compression | every frame is gzip inside a binary frame, permessage deflate not negotiated |
| handshake | 336 ms and 331 ms, nginx, `x-req-id` header |
| subscription limits | none hit at 55 topics on one socket |

## 6. Captured frames

Each frame was inflated from gzip and trimmed to two levels per side.

A `-trade` book frame, mode A:

```json
{"cmd": "deal", "data": {"buySumAllEntrustNumber": "34297", "rangeAbility": -0.0032,
 "asks": [{"trustPrice": "82590.3", "cumulativeCommissionQuantity": "1060.000", "cumulativeTransactionVolume": "0"},
          {"trustPrice": "82591.1", "cumulativeCommissionQuantity": "1200.000", "cumulativeTransactionVolume": "0"}],
 "lastPriceCny": 82589.5,
 "bids": [{"trustPrice": "82589.6", "cumulativeCommissionQuantity": "2359.000", "cumulativeTransactionVolume": "0"},
          {"trustPrice": "82589.0", "cumulativeCommissionQuantity": "2228.000", "cumulativeTransactionVolume": "0"}],
 "sellSumAllEntrustNumber": "25231", "symbolKey": "CONTRACT/BTCUSDT", "lastPrice": 82589.6},
 "pushMessageType": "1", "responseCode": 1, "time": 1791599669189, "topic": "alpha-market-depth-contract-btcusdt-trade"}
```

A `-paint` book frame, mode A:

```json
{"cmd": "deal", "data": {"asks": [{"trustPrice": "82590.3", "lastNumber": "1060"}, {"trustPrice": "82591.1", "lastNumber": "1200"}],
 "bids": [{"trustPrice": "82589.6", "lastNumber": "2359"}, {"trustPrice": "82589.0", "lastNumber": "2228"}],
 "symbolKey": "CONTRACT/BTCUSDT"},
 "pushMessageType": "1", "responseCode": 1, "time": 1791599669128, "topic": "alpha-market-depth-contract-btcusdt-paint"}
```

A mark frame, mode A, where mark and index are the same string:

```json
{"cmd": "real", "data": {"coinMarket": "BTCUSDT", "indexPrice": "82589.5", "markedPrice": "82589.5"}, "id": "", "pushMessageType": "1", "responseCode": 1, "time": 1791599668507, "topic": "usdt-marked-price-btcusdt"}
```

A server ping, mode A, answered with `{"pong": 1791599634482}`:

```json
{"ping": 1791599634482}
```

Errors, mode B, all text frames:

```json
{"invalidParameter": "alpha-market-depth-contract-nopeusdt-trade"}
```

```json
{"invalidParameter": "id"}
```

There is no subscribe acknowledgement to capture.

## 7. Private channels

The same socket carries `account-user-usdt-contract-position`, `alpha-market-order-contract` and `alpha-market-order-contract-stop`, which the web app subscribes only with a login token (S1, `WS_CONTRACT_KEYS`).
The only documented API is a spot market maker REST API keyed by `appKey` (S3), with no futures and no socket.

## 8. Recommended feed shape

The socket itself would fit the engine with the gzip handling the BingX feed already has.
The venue is still not recommended, because the anchor behind it is not real, as [`rest.md`](./rest.md) sections 4 and 8 show.
If it were built, the shape would be this.

| item | value |
|---|---|
| URL plan | one socket, `wss://www.bifinance.com/wsContract/zh_cn/` |
| markets per connection | all 55 on one socket was clean in mode C |
| subscribe frames | one `{"id": "<unique>", "cmd": "sub", "topic": "alpha-market-depth-contract-<sym>-trade", "data": {}}` per contract |
| decoding | gunzip every binary frame, as [`../../../server/src/venues/bingx.rs`](../../../server/src/venues/bingx.rs) does |
| keepalive | answer each `{"ping": n}` with `{"pong": n}` |
| book handling | `resetBook`, then 20 bids and 20 asks, then `publish`, on every frame |
| sizes | multiply by the catalog's `faceValue` |
| `maxSilenceMs` | 15,000, about twice the 7.7 s worst silence seen on 55 contracts |
| resync rule | none needed for gaps, reconnect and resubscribe on silence or close |
| mark and index | `usdt-marked-price-<sym>`, one topic per contract, through [`../../../server/src/venues/socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs) |

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | web app bundle `https://www.bifinance.com/assets/index-411dd017.js`, socket URLs, topic templates, `WS_KEYS`, `WS_CONTRACT_KEYS`, ping and pong handler, `pako.inflate` | 2026-10-09 |
| S3 | API documentation chunk `https://www.bifinance.com/assets/DocsApi-96558f87.js` | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/bifinance/ws-probe.py), modes A to D | 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/bifinance/rest-probe.py), for the catalog and the REST book | 2026-10-10 UTC |
