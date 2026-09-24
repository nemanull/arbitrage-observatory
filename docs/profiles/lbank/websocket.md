# LBank WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 02:39 to 03:06 UTC, from the development host near Seattle.

This profile covers the public perpetual WebSocket of LBank (CCXT id `lbank`), which serves the USDT-margined perpetuals, the only perpetual family.
The contract API documentation names the URL `wss://lbkperpws.lbank.com/ws` and documents no channel, no subscribe frame and no message, S1.
Every topic number, field and rule below was found on the wire by [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs), so the "documented" column of this profile is almost empty.
The protocol is the one LBank's own web app speaks, and a third party scraper on GitHub uses the same `SendTopicAction` frame, S3.
CCXT Pro 4.5.68 has no perpetual socket for LBank at all, its only URL is the spot socket `wss://www.lbkex.net/ws/V2/`, at `server/node_modules/ccxt/js/src/pro/lbank.js` line 32.

The book topic does not keep a correct book, section 4, and that is the finding that decides the venue's fit.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://lbkperpws.lbank.com/ws`, S1 | open in 430, 440, 447 and 429 ms in the four logged opens, served by Cloudflare with `cf-ray` edges `SEA` and `YVR` |
| same, with a query | `wss://lbkperpws.lbank.com/ws?version=1.0.0`, used by the scraper of S3 | open in 421, 457 and 426 ms in three runs, and it serves the same topics |
| spot | `wss://www.lbkex.net/ws/V2/`, S2 | not probed, spot is out of scope |

`lbkperpws.lbank.com` resolved through `lbkperpws.lbank.com.cdn.cloudflare.net` to `104.18.34.3` and `172.64.153.253` on 2026-09-23, the same addresses as the REST host, see [`rest.md`](./rest.md) section 1.
There is one perpetual family, so one URL carries every contract.
The web app build also names newer sockets, `wss://ccws.rerrkvifj.com/ws/V3/` and a test host `wss://uuws.lbk.world/ws/v3` with an `{"op": "sub"}` protocol, and neither was probed.

## 2. Channel matrix for public market data

A subscription is a topic number and a filter, `{"SendTopicAction": {"Action": "1", "LocalNo": 1, "TopicID": "25", "FilterValue": "Exchange_BTCUSDT", "ResumeNo": -1}}`.
The topic numbers were found in the exploratory runs P7 by subscribing `Exchange_BTCUSDT` to topics 1 to 45 one at a time, and their meaning comes from the pushes that followed.

| topic | push `action` | content | probed |
|---|---|---|---|
| 25 | `PushMarketOrder` | book: a snapshot of 25 or 26 levels per side, then batched level updates with a `bNo` | the only incremental book topic, section 4 |
| 18 | `PushMarketOrder`, then `PushDelayMarketOrder` | the touch, one level per side, then whole books of 1,404 to 1,755 rows spanning 111 to 135 contracts, 7 to 29 s apart | 3 frames in 55 s and 1 frame in 40 s |
| 8 | same as 18 | the acknowledgement names topic 18 | the server rewrites 8 to 18 |
| 7 | `PushMarketDataOverView` | ticker with `UnderlyingPrice` (index), `MarkedPrice`, `PositionFeeRate`, `PrePositionFeeRate`, `InstrumentStatus`, limits and open interest | about one frame a second per contract, busy or quiet |
| 17 | `PushMarketDataOverView` | same shape as 7 | not examined further |
| 2 | `PushMarketTrade` | trades with `TradeID`, `Direction`, `Price`, `Volume`, `TradeTime` in seconds | 426 frames in 55 s and 305 in 40 s on `BTCUSDT` |
| 11, 12, 13 | `PushKLine` | candles for many contracts at once, including instruments absent from the API such as `m3501100USDT` | not examined further |
| 3, 14, 99 | none | `errorCode` 54 `UserNotLogin` | login gated |
| 4, 6 | none | acknowledged, then `Error=PublishFlow(4)PubStartID(-1)<FirstID(0)` and nothing else | unknown |
| 5 | none | `InvalidValue:Filters.size!=3 && Filters.size!=4` | wants another filter shape |
| 1, 9, 10, 15, 16, 19 to 24, 26 to 45 | none | `errorCode` 2 `RecordNotFound:TopicIDNotFound` | absent |

No dedicated mark, index or funding topic exists.
Topic 7 carries all three for one contract per subscription, and a bare `Exchange` filter returned an empty `result: []`, so it cannot replace the bulk REST anchor call, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one URL for the one family |
| subscribe frame shape | Not publicly specified | `{"SendTopicAction": {"Action": "1", "LocalNo": <n>, "TopicID": "<topic>", "FilterValue": "Exchange_<symbol>", "ResumeNo": -1}}`, one topic and one contract per frame. `Action` `"0"` unsubscribes |
| unknown symbol expectation | Not publicly specified | topic 25 answers `errorCode` 5 `InvalidValue:NotFoundInstrumentID`. Topic 7 acknowledges success, sends `Error=PublishFlow(7)PubStartID(-1)<FirstID(0)` and then nothing |
| chunk unit and budget | Not publicly specified | 20 subscribe frames per window of about one second, and the 21st answers `errorCode` -3 `Over Max Speed [21]>[20]!`. Topic 25 also refused 5 and 10 of 100 frames sent at 10 a second with `errorCode` 51 `NoTradingRight:MoreThan3TimesPerSecond` |
| keepalive mechanism | Not publicly specified | the text frame `ping` is answered by the text frame `pong`, and a protocol ping by a protocol pong. The server sent no ping of its own in any run |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in the longest socket, 60 s, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | the subscribe limit above. Refused frames leave the socket open |
| public market data authentication | none for the URL | none for topics 2, 7, 18 and 25 |
| message parse and routing | Not publicly specified | JSON text. Route on `action`, then on each row's `data.InstrumentID`, because one book frame carries rows of many contracts |
| subscribe acknowledgement shape | Not publicly specified | `{"action": "RecvTopicAction", "requestNo": 0, "errorCode": 0, "errorMsg": "Success", "result": [{"table": "TopicAction", "data": {...the request as strings...}}]}`. It came 107 ms after the request in one run and up to 5.6 s after in another |
| symbol identifier format | Not publicly specified | `BTCUSDT` behind the prefix `Exchange_`, which is CCXT `market.id`, the REST `symbol` and the pushed `InstrumentID`. Lowercase is refused |
| number representation | Not publicly specified | prices, sizes and order counts as decimal strings, `Direction` as `"0"` for bids and `"1"` for asks |
| timestamp representation | Not publicly specified | book frames carry no time. Ticker `UpdateTime` and trade `TradeTime` are Unix seconds as strings |
| size unit | Not publicly specified | base coins, which is one contract since CCXT `contractSize` is 1 on every market, section 4 |
| sequence semantics | Not publicly specified | `bNo` rises by about 14,000 from one frame to the next within one routing `index` and is not ordered across indices, so it is a shared batch number and not a per contract sequence. No gap can be detected |
| idle repeat behaviour | Not publicly specified | quiet contracts receive one batch after the snapshot and then nothing, while their REST book moves, section 4 |

## 4. The book channel in detail

Topic 25 is the only incremental book topic, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first `PushMarketOrder` after a subscription has no `bNo` and names the contract in `errorMsg`, for example `"errorMsg": "Exchange_BTCUSDT"`.
It held 26 bids and 26 asks on `BTCUSDT`, `ETHUSDT`, `DOGEUSDT` and `STORJUSDT`, 26 and 25 or 26 on `HK50USDT`, and 24 or 25 per side on `CTKUSDT`, in every run.
Bids came best first and descending, asks best first and ascending, on every snapshot.
It arrived with or just before the acknowledgement, 535 to 2,305 ms after the socket opened.
No second topic 25 snapshot arrived for any contract in the 40 s of the second book run.
In the first run a topic 18 subscription on `ETHUSDT` sent its own one level per side `PushMarketOrder`, which a feed must not take for a book snapshot, so the second run moved topic 18 to `XRPUSDT`.

### Delta semantics

A delta is a `PushMarketOrder` with `index`, `bNo`, `changeType` `"3"` and `localNo`, and its `result` rows carry absolute sizes.
A size of `"0.0"` deletes the level, and 1,646 of 8,360 and 1,004 of 5,741 `BTCUSDT` rows were deletions in the two book runs.
Rows are not in price order: 92 of 93 and 66 of 66 `BTCUSDT` delta frames broke the order.
One frame carries rows for many contracts, not only the subscribed ones.
In the two book runs the frames carried 71,858 and 54,346 rows of 105 and 115 contracts that were never subscribed, and the batch runs saw 9,426 and 12,480 useful rows among 59,412 and 55,388.
An exploratory capture also carried rows of `SIMBTCUSDT`, which is absent from the API catalog, P7.
The rows are not windowed: a `BTCUSDT` book kept from the snapshot and every delta grew to 320 bids and 309 asks, and to 257 and 256 in the second run.

### Frame cadence

The routing `index` of a delta names one subscribed contract, not the contract of every row it carries.
With `BTCUSDT`, `ETHUSDT`, `DOGEUSDT` and `CTKUSDT` subscribed, 93 of 94 and 66 of 69 delta frames were routed to `Exchange_BTCUSDT`.
Deltas came 626 ms apart at the median, p90 689 ms and max 1,367 ms in the first run, and 764, 955 and 1,240 ms in the second.
So the topic is a conflated batch of 1.3 to 1.6 frames a second, not a stream of changes.

### Sequence and gap rule

```text
snapshot   no bNo                       replace the book of the contract it names
delta      bNo, rows of many contracts  apply each row by price, size 0 deletes
gap        not detectable               bNo is shared by a group and steps by about 14,000
```

Within one `index`, `bNo` rose on every frame, and a frame whose `bNo` was already seen was delivered again 1 time in the second book run and up to 3 times in a batch run.
Across routing indices `bNo` is not ordered, with steps from -6,075,410 to +6,091,356 in the first book run.
The first delta after a quiet contract's snapshot carries an older `bNo`: `CTKUSDT` received 199171581607 while `STORJUSDT` received 199178352790 90 ms later in the first quiet run, and 199183306997 against `HK50USDT`'s 199189040630 in the second.

### Checksum

None exists on any frame.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | descending, best first, on every snapshot | ascending, best first |
| delta | unordered, rows interleave contracts and sides | unordered |
| REST `marketOrder` | descending at every depth from 1 to 1,000 | ascending |

### Does the kept book match the REST book

| run | contract | top 20 prices equal to REST | top 20 sizes equal | crossed after a delta |
|---|---|---|---|---|
| 02:52 UTC | `BTCUSDT` | 20 of 20 both sides | 17 bids, 15 asks | 0 |
| 02:52 UTC | `ETHUSDT` | 20 of 20 both sides | 14, 16 | 0 |
| 02:52 UTC | `DOGEUSDT` | 20 of 20 both sides | 15, 13 | 0 |
| 02:52 UTC | `CTKUSDT` | bids 0 of 20, asks 20 of 20 | 0, 6 | 0 |
| 03:01 UTC | `BTCUSDT` | 20 of 20 both sides | 18, 19 | 0 |
| 03:01 UTC | `ETHUSDT` | 20 of 20 both sides | 18, 13 | 0 |
| 03:01 UTC | `DOGEUSDT` | bids 20 of 20, asks 0 of 20 | 17, 0 | 65 of 67 frames, a stale ask of 0.1035 under a bid of 0.10373 |
| 03:01 UTC | `CTKUSDT` | 0 of 20 both sides | 0, 0 | 0 |

The `quiet` mode then read the REST touch every 2 or 2.5 s beside the socket book of three quieter contracts.

| run | contract | delta frames after the snapshot | touch equal to REST |
|---|---|---|---|
| 02:54 UTC | `CTKUSDT` | 2 | 16 of 20 reads |
| 02:54 UTC | `HK50USDT` | 1 | 2 of 20 |
| 02:54 UTC | `STORJUSDT` | 1 | 2 of 20 |
| 03:02 UTC | `CTKUSDT` | 1 | 2 of 12 |
| 03:02 UTC | `HK50USDT` | 1 | 0 of 12 |
| 03:02 UTC | `STORJUSDT` | 1 | 0 of 12 |

The REST touch of `HK50USDT` moved during the second run, from an ask of 3177.36 to 3177.2, while the socket book kept its snapshot's ask of 3177.27.
So topic 25 delivers a correct book only for the busy group around `BTCUSDT`, and quiet contracts, and one side of `DOGEUSDT` in one run, go stale without any signal a feed could detect.

### Size unit against CCXT `contractSize`

`volumeMultiple` is 1 on all 845 contracts, and CCXT maps it to `contractSize` 1 at `server/node_modules/ccxt/js/src/lbank.js` line 678.
`minOrderVolume` equals `volumeTick`, 0.0001 on `BTCUSDT`, and a `BTCUSDT` touch level read `"10.2216"` at 86412.3, which is plausible only as bitcoin.
Where the kept book and the REST book of the table above had the same price, the sizes were equal on 13 to 19 of the top 20 levels of the busy contracts, and the rest moved between the two reads.
So a socket size is a size in coins, and the engine's `sizeMul` of 1 is right.

### One-sided and empty books

No one-sided or empty book was seen, and the suspended `COCOAUSDT` still sent a 52 row snapshot with its acknowledgement in all three error runs.

### Idle repeats

Nothing is repeated on topic 25: no delta frame left a kept book unchanged in any run.
A quiet contract simply receives nothing, which is the failure described above.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| topic 25 `Exchange_NOPEUSDT` | `errorCode` 5 `InvalidValue:NotFoundInstrumentID` | nothing |
| topic 25 `Exchange_btcusdt` | `errorCode` 5 `InvalidValue:NotFoundInstrumentID` | nothing |
| topic 25 `BTCUSDT`, no prefix | `errorCode` 5 `InvalidValue:Filters.size!=2 && Filters.size!=3` | nothing |
| topic 25 `Exchange_COCOAUSDT`, `needSuspend` 1 | success | a 52 row snapshot |
| topic 7 `Exchange_NOPEUSDT` | success, then `Error=PublishFlow(7)PubStartID(-1)<FirstID(0)` | nothing |
| topic 7 `Exchange_CTKUSDT` twice | success twice | every ticker arrives twice |
| `Action` `"0"` on that ticker | success | the ticker kept arriving twice until the socket closed, 2.4 and 3.3 s later |
| `Action` `"5"` | `{"action":"SendTopicAction","requestNo":0,"errorCode":-6,"errorMsg":""}` | |
| `hello` | `{"action":"hello","requestNo":0,"errorCode":-3,"errorMsg":"input_is_too_short"}` | the socket stays open |
| `{"action":"ping","ping":"probe"}` | `{"action":"action","requestNo":0,"errorCode":-6,"errorMsg":""}` | |

A third filter part is accepted on topic 25 and aggregates prices: `Exchange_ETHUSDT_1` was acknowledged as `Exchange_ETHUSDT_1.0` and its snapshot came in whole dollar steps, in an exploratory run on 2026-09-23 at 02:44 UTC.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | text `ping` answered by text `pong` in 107 to 591 ms. A protocol ping answered by a protocol pong in 244 ms |
| silence the server tolerates | Not publicly specified | a socket subscribed to the `HK50USDT` ticker that never sent a frame stayed open for the full 60 s in both runs, with 62 and 63 frames and no server ping. A socket with no subscription was not held |
| forced disconnect | Not publicly specified | none. An exploratory socket that sent 40 subscribe frames at once was closed with 1006 after 4.2 s, and the probe's bursts of 25 and 32 frames were not closed |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client offering permessage-deflate got no `sec-websocket-extensions` header back in both runs, and frames are uncompressed JSON text |
| handshake | | 421 to 457 ms to open in seven logged opens |
| subscription limits | Not publicly specified | 20 frames per window of about one second on topic 7: after a burst of 20, sends 254 and 504 ms later were refused and a send 754 ms later was accepted, and in the second run the refusals ran to 1,005 ms and acceptance began at 1,255 ms. Topic 25 at 10 frames a second lost 5 and 10 of 100 to `MoreThan3TimesPerSecond` |
| throughput | | 100 contracts, every eighth by turnover, on one socket: 373 to 399 KB a second, 29 to 30 KB a frame, `JSON.parse` median 15 µs and p90 1.2 ms |

## 6. Captured frames

Trimmed from the probe runs of 2026-09-23, with `result` arrays cut to the rows shown.

Subscribe.

```json
{"SendTopicAction": {"Action": "1", "LocalNo": 1, "TopicID": "25", "FilterValue": "Exchange_BTCUSDT", "ResumeNo": -1}}
```

Acknowledgement.

```json
{"action":"RecvTopicAction","requestNo":0,"errorCode":0,"errorMsg":"Success","result":[{"table":"TopicAction","data":{"Action":"1","LocalNo":"1","TopicID":"25","FilterValue":"Exchange_BTCUSDT","ResumeNo":"-1"}}]}
```

Snapshot, two levels per side of 52 rows.

```json
{"action":"PushMarketOrder","requestNo":0,"errorCode":0,"errorMsg":"Exchange_BTCUSDT","result":[{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"0","Price":"86412.3","Volume":"10.2216","Orders":"1"}},{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"0","Price":"86412.2","Volume":"0.3487","Orders":"1"}},{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"1","Price":"86412.4","Volume":"21.6683","Orders":"1"}},{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"1","Price":"86412.5","Volume":"0.3553","Orders":"1"}}]}
```

Delta, three `BTCUSDT` rows and one row of another contract, of 1,061 rows in the frame.

```json
{"action":"PushMarketOrder","index":"Exchange_BTCUSDT","bNo":199196108238,"changeType":"3","result":[{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"0","Price":"86412.3","Volume":"10.2216","Orders":"1"}},{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"0","Price":"86412.2","Volume":"0.3487","Orders":"1"}},{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"0","Price":"86412.1","Volume":"0.3506","Orders":"1"}},{"table":"MarketOrder","data":{"ExchangeID":"Exchange","InstrumentID":"ETHUSDT","Direction":"0","Price":"2757.97","Volume":"469.744","Orders":"1"}}],"localNo":12}
```

Keepalive, as text frames.

```text
ping
pong
```

Errors.

```json
{"action":"RecvTopicAction","requestNo":0,"errorCode":5,"errorMsg":"InvalidValue:NotFoundInstrumentID","result":[{"table":"TopicAction","data":{"Action":"1","LocalNo":"1","TopicID":"25","FilterValue":"Exchange_NOPEUSDT","ResumeNo":"-1"}}]}
```

```json
{"action":"","requestNo":0,"errorCode":-3,"errorMsg":"Over Max Speed [21]>[20]!"}
```

```json
{"action":"RecvTopicAction","requestNo":0,"errorCode":54,"errorMsg":"UserNotLogin","result":[{"table":"TopicAction","data":{"Action":"1","LocalNo":"7","TopicID":"3","FilterValue":"Exchange_BTCUSDT","ResumeNo":"-1","Token":"m"}}]}
```

Ticker, trimmed to the anchor fields.

```json
{"action":"PushMarketDataOverView","requestNo":0,"errorCode":0,"errorMsg":"Success","result":[{"table":"MarketDataOverView","data":{"ExchangeID":"Exchange","InstrumentID":"BTCUSDT","ProductGroup":"SwapU","UpdateTime":"1790131935","UnderlyingPrice":"86462.7","MarkedPrice":"86420.7","PositionFeeRate":"0.00003783","InstrumentStatus":"2","PrePositionFeeRate":"0.00003783"}}]}
```

Trade.

```json
{"action":"PushMarketTrade","index":"Exchange_BTCUSDT","bNo":0,"changeType":"3","result":[{"table":"MarketTrade","data":{"TradeID":"1007933718475523","ExchangeID":"Exchange","InstrumentID":"BTCUSDT","Direction":"1","Price":"86417.5","Volume":"0.002","TradeTime":"1790131936"}}],"localNo":8}
```

## 7. Private channels

Nothing is documented.
Topics 3 and 14 answer `UserNotLogin`, and the ack echoes a `Token` field, so a login token belongs in the subscribe frame.
The web app fetches such a token from `/cfd/user/v1/generateWsToken`, which was not called.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| verdict | do not build a book feed on this socket | topic 25 left quiet contracts and one side of `DOGEUSDT` stale with no sequence gap to detect it, section 4 |
| if built anyway: URL | `wss://lbkperpws.lbank.com/ws`, one plan | one family |
| channel | topic 25, filter `Exchange_<rawMarketId>` | the only incremental book |
| markets per connection | 100 at most, untested beyond | 100 ran at 373 to 399 KB a second, most of it rows of unsubscribed contracts |
| subscribe frames | one frame per contract, at most 2 a second | 10 a second lost 5 to 10 % to `MoreThan3TimesPerSecond`, and a burst beyond 20 is refused. A 100 contract slice takes 50 s to subscribe |
| keepalive | text `ping` every 15 s, and count the `pong` as traffic | the server sends no ping, and quiet contracts send no book frames |
| `maxSilenceMs` | 45,000 | three missed pongs |
| routing | each row's `data.InstrumentID`, never the frame's `index` | one frame carries many contracts |
| snapshot | a `PushMarketOrder` without `bNo`: `resetBook` for the contract in its rows | |
| delta | apply every row by price, size 0 deletes, and ignore a `bNo` already applied | redeliveries happen |
| resync | none is possible from the stream, so a periodic REST `marketOrder` compare per contract would be needed | no per contract sequence and no checksum |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | LBank CONTRACT API, "access URL" section | https://www.lbank.com/docs/contract.html | 2026-09-22 | LBank, global | the socket URL and nothing else, sections 1 and 3 |
| S2 | CCXT Pro 4.5.68 `lbank.js` | `server/node_modules/ccxt/js/src/pro/lbank.js` | 2026-09-22 | CCXT | the only CCXT socket is spot, line 32 |
| S3 | Third party scraper using `SendTopicAction` on this URL, `philip428/yarik-crypto` `src/services/scrapers_exp/lbank/test_ws.py` | https://github.com/philip428/yarik-crypto | 2026-09-22 | GitHub | the frame shape, the `?version=1.0.0` query and topic 7, sections 1 and 2 |
| S4 | LBank web app build for https://www.lbank.com/futures/btcusdt | https://www.lbank.com/futures/btcusdt | 2026-09-22 | LBank, global | v3 socket hosts, `SwapU`, `generateWsToken`, sections 1 and 7 |
| S5 | CCXT 4.5.68 `lbank.js` | `server/node_modules/ccxt/js/src/lbank.js` | 2026-09-22 | CCXT | `contractSize` from `volumeMultiple`, line 678, section 4 |
| P1 | `ws-probe.mjs book`, runs at 02:52 and 03:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs quiet`, runs at 02:54 and 03:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
| P3 | `ws-probe.mjs errors`, runs at 02:57, 03:02 and 03:06 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 6 |
| P4 | `ws-probe.mjs speed`, runs at 02:57 and 03:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| P5 | `ws-probe.mjs batch`, runs at 02:58 and 03:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| P6 | `ws-probe.mjs silence` and `deflate`, runs at 02:57 and 03:01 to 03:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P7 | exploratory topic scans before the probe was written, 02:39 to 02:45 UTC, not kept as a script | | 2026-09-23 UTC | this host | the topic numbers 1 to 45, topics 8, 11 to 14 and 17, the 40 frame burst, the price aggregation filter |
