# OneBullEx WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, which was 2026-10-10 from about 02:20 to 03:10 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

This profile covers the USDT-margined perpetuals, the only perpetual family, see [`fees.md`](./fees.md) section 3.
OneBullEx has two futures sockets, and neither is a documented public book feed.
The documented Open API socket needs a signed key on every channel and has no book channel, S1.
The website's own market socket is public and carries a whole book, but it is undocumented and speaks protobuf, S2.
Every probed number comes from [`ws-probe.py`](../../../scripts/probes/venues/onebullex/ws-probe.py), P1, which decodes the protobuf by hand from the schemas in the website bundle.

## 1. Endpoints

| family | URL | documented | probed |
|---|---|---|---|
| USDT-M perpetuals, Open API | `wss://openapi.onebullex.com/fstream/ws/open` | yes, S1 section 6.2.1, "all channels require authentication before subscription" | opened in 516 to 602 ms, then a server `ping` every 15 s and a `signature error` for a PRICE subscribe with a dummy key, P1 |
| USDT-M perpetuals, website market data | `wss://gateway.onebullex.com/ws/market` | no, it is the `wsFuturesMarket` host of the website config, S2 | opened in 469 to 524 ms, no key needed, protobuf frames, P1 |
| website user data | `wss://gateway.onebullex.com/ws/user` | no, `wsFuturesUser` in S2 | not probed, it is private |
| spot | `wss://bullapiprod.onebullex.com/ws/kline` and `/ws/user/push` | no, S2 | not probed, spot is out of scope on a perpetual venue |

One family exists, so there is no endpoint split.
The test hosts `openapi.1bullex.com` and `futures-openapi.1bullex.com` are named in S1 and were not probed.

## 2. Channel matrix for public market data

The documented socket, S1 section 6.5, all channels behind a signed key:

| channel | payload | public |
|---|---|---|
| `PRICE` | mark `markPx`, index `idxPx`, latest trades, per symbol | no, a dummy key got `signature error`, P1 |
| `ALLOCATION_RATIO` | funding rate, per symbol | no, same rule, S1 |
| `ACCOUNT`, `ORDERS`, `POSITIONS`, `QUIRE_LEVERAGE` | private | no |

No book, best bid and ask or ticker channel exists on the documented socket.

The website socket, topics from the bundle's subscribe calls and its channel enum, S2, all probed without a key, P1:

| topic | protobuf type | content | probed |
|---|---|---|---|
| `depth_full@<symbol>` | `DeepFullVO` | the whole book, 221 to 242 levels a side on `btc_usdt`, pushed as `depth_full@btc_usdt,50` | a median 0.38 to 0.70 s apart on `btc_usdt` over four runs, and 1 to 58 times in 30 s across the list, median 10.5 |
| `depth_update@<symbol>` | `DeepVO` | one price level per frame, absolute size, pushed as `depth_update@btc_usdt,100ms` | 2,084 to 2,674 frames in 45 s on `btc_usdt`, about 46 to 59 a second |
| `mark_price@<symbol>` | `PriceVO` | mark | about one a second |
| `index_price@<symbol>` | `PriceVO` | index | about one a second |
| `fund_rate@<symbol>` | `FundRateVO` | rate and next collection time | one frame in one 45 s run and none in the next |
| `trade@<symbol>` | `DealVO` | price, size, side `BID` or `ASK` | about one a second |
| `agg_ticker@<symbol>#<zone>` | `AggTickerVO` | ticker with index, mark and best bid and ask | named in S2, not probed |
| `kline@<symbol>,<interval>` | `KlineVO` | candles | named in S2, not probed |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is S1 for the Open API socket, and the probed column is the website socket unless it says otherwise.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for futures, S1 | one URL for the one family |
| subscribe frame shape | `{"op": "SUBSCRIBE", "channel": "PRICE", "key", "signature", "args": [{"symbol": "btc_usdt"}]}` | `{"events": ["depth_full@btc_usdt", ...], "method": "sub"}`, and `"unsub"` to leave, S2 and P1 |
| unknown symbol expectation | Not publicly specified | `depth_full@nope_usdt` is acked with success and stays silent. A topic with an unknown suffix, `depth_full@eth_usdt,20`, closes the whole socket in 0.11 s with no close frame |
| chunk unit and budget | Not publicly specified | 308 topics in 7 frames of at most 50, all acked, all 154 contracts served |
| keepalive mechanism | server sends text `ping` every 15 s, client answers `pong`, no `pong` for 60 s closes the socket, S1 section 6.8 | Open API socket: `ping` seen at 7.5, 22.5 and 37.5 s. Website socket: the client sends text `ping` and gets text `pong`, and the server sends no ping |
| connection lifetime and maintenance notice | Not publicly specified | no forced disconnect in any run. No maintenance frame seen |
| handshake and operation rate limits | Not publicly specified. The FAQ says rate limits are per key and IP and to "contact customer service", S1 section 8.3 | the website socket's upgrade reply carries `X-RateLimit-Burst-Capacity: 20` and `X-RateLimit-Replenish-Rate: 5`. Not exceeded |
| public market data authentication | required on every channel, and an empty `key` is "silently closed", S1 section 6.9.2 | Open API socket: a dummy key got `signature error`, and an empty key got no reply while the socket stayed open for 15 s more. Website socket: none |
| message parse and routing | binary frames of UTF-8 JSON with `arg.channel` and `arg.symbol`, S1 section 6.7 | binary protobuf `PushMessage {channel, event, data: google.protobuf.Any}`. Route on `event`, cut at the first comma, as the website client does for depth topics, S2 |
| subscribe acknowledgement shape | `{"event": "SUBSCRIBE", "args": [...], "code": 200, "msg": "success"}` | text `{"code":0,"msg":"success"}`, one per frame sent, naming no topic |
| symbol identifier format | `btc_usdt` | `btc_usdt`, identical to the REST `symbol`, see [`rest.md`](./rest.md) section 2 |
| number representation | strings, S1 section 6.10.2 | protobuf strings for prices and sizes |
| timestamp representation | ms, S1 section 6.10.3 | `int64` ms. In `fund_rate`, `t` is the next collection time, not the push time |
| size unit | contracts, `sz` "Trade quantity (contracts)", S1 | contracts. The `btc_usdt` touch showed sizes such as 2748 and 38873, whole numbers, and the catalog sets `contractSize` 0.0001 and `quantityPrecision` 0 |
| sequence semantics | none documented | `depth_full` carries an `id`. `depth_update` ids rise on every frame but skip, with a median step of 2, which suggests a shared counter, and they give no per symbol gap rule |
| idle repeat behaviour | Not publicly specified | a quiet contract's `depth_full` came as rarely as once in 30 s, which suggests a frame on change rather than on a fixed clock |

## 4. The book channel in detail

- **Snapshot on subscribe.**
  Every `depth_full` frame is a whole book, so the first one is the snapshot.
  Across the list, the median contract's first frame came 1.75 s and 1.86 s after the subscribe in two runs.
- **Delta semantics.**
  `depth_full` replaces the book.
  `depth_update` sets one level per frame, `ba` 1 for a bid and 2 for an ask, `q` absolute, and `q` "0" removes the level.
- **Sequence and gap rule.**
  None that a feed can check.
  `depth_update` ids rose on all 2,674 frames of the last book run, but only 743 steps were 1.
  A book rebuilt from the first `depth_full` plus every later `depth_update` matched the best bid and ask of every later `depth_full`, 81 of 81 in each of two runs, but never matched every level, with as few as 84.2 % of levels agreeing.
  So `depth_update` alone drifts, and `depth_full` is the frame to trust.
- **Checksum.**
  None.
- **Level order on the wire.**
  Asks ascending and bids descending, best first, in the captured frames.
  The first level of every `depth_full` was the best price in the rebuild check above, and the REST book has the same order, see [`rest.md`](./rest.md) section 5.
- **Size unit against `contractSize`.**
  Contracts, see section 3.
  There is no CCXT class, so the catalog's own `contractSize` is the multiplier, see [`rest.md`](./rest.md) section 2.
- **Depth.**
  The event name says `,50`, yet `depth_full` held 221 to 242 levels a side on `btc_usdt` over all runs.
  The suffix cannot be chosen, since `,20` closes the socket, and `depth_update@...,1000ms` still served the 100 ms stream.
- **One-sided and empty books.**
  Not observed.
  All 154 contracts sent at least one whole book in 30 s.
- **Unknown or closed symbol.**
  Acked and silent, see section 3.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Open API socket: server `ping` every 15 s, client `pong`, S1 | website socket: the website client sends text `ping` after 50 s without a frame and reconnects 50 s later if nothing comes, S2. The probe's `ping` every 20 s got a `pong` within 0.5 s each time and kept the socket open for 65 s |
| silence the server tolerates | 60 s without a `pong`, S1 | a website socket with no subscription and no client frame was dropped at 60.0 s without a close frame |
| forced disconnect | Not publicly specified | none seen |
| maintenance notice | none documented on the socket. The help center says maintenance schedules "do not follow a fixed cycle", S3 | none seen |
| compression | none documented | no permessage-deflate offered back when asked, and frames are raw protobuf |
| handshake | | 469 to 602 ms |
| subscription limits | Not publicly specified | 308 topics on one socket |
| throughput | | all 154 contracts on one socket, both depth topics: about 3,265 frames and 715 KB a second, of which `depth_full` is 60.5 frames and 210.5 KB a second |

## 6. Captured frames

Open API socket, a PRICE subscribe with a dummy key, S1 shape and P1 reply:

```json
{"event":"ERROR","args":[{"symbol":"btc_usdt"}],"code":400,"msg":"signature error"}
```

Website socket acknowledgement, one per subscribe frame:

```json
{"code":0,"msg":"success"}
```

Website socket `depth_full`, decoded from protobuf and trimmed to two levels a side:

```json
{"channel": "depth_full", "event": "depth_full@btc_usdt,50", "type_url": "type.googleapis.com/com.kylin.tiger.biz.core.proto.DeepFullVO", "bytes": 7950, "body": {"s": "btc_usdt", "id": "679050964828684385", "a": [["82574.1", "2748"], ["82574.2", "593"]], "b": [["82573.8", "38873"], ["82573.7", "1692"]], "levels": [228, 239]}}
```

Website socket `depth_update`, one level:

```json
{"channel": "depth_update", "event": "depth_update@btc_usdt,100ms", "body": {"id": "679050964824490052", "s": "btc_usdt", "ba": 1, "p": "82573.8", "q": "38873", "t": 1791600366171}}
```

Website socket `fund_rate`, where `t` is the next collection time:

```json
{"channel": "fund_rate", "event": "fund_rate@btc_usdt", "body": {"s": "btc_usdt", "r": "0.0001", "t": 1791619200000}}
```

Error: text that is not JSON gets the text `Invalid parameter`, and the socket then closes with no close frame, P1.

## 7. Private channels

- Open API socket `wss://openapi.onebullex.com/fstream/ws/open`, channels `ACCOUNT`, `ORDERS`, `POSITIONS` and `QUIRE_LEVERAGE`, signed with HMAC-SHA256, S1 sections 6.3 and 6.5.
- `GET /v2/user/listen-key` is listed under private endpoints, S1 section 5.1.
- The website's `wss://gateway.onebullex.com/ws/user` carries `balance`, `order`, `position`, `entrust` and `profit`, S2.

## 8. Recommended feed shape

The venue is blocked as a leg, because the only public book socket is the undocumented website socket.
If that socket were accepted, the shape below follows from the probe.

| item | recommendation | reason |
|---|---|---|
| URL | `wss://gateway.onebullex.com/ws/market` | the only socket with a public book |
| channel | `depth_full@<rawMarketId>` | a whole book in every frame, so no sequence rule is needed |
| markets per connection | all 154 | one socket carried 308 topics |
| subscribe frames | `{"events": [...], "method": "sub"}`, 50 topics per frame | worked at 7 frames |
| decoding | protobuf `PushMessage`, then `DeepFullVO` from the `Any` value | binary frames only, decoded by hand in P1 |
| keepalive | text `ping` every 20 s | an idle socket closes at 60 s |
| `maxSilenceMs` | 30,000 per socket | a quiet contract may send once in 30 s, but the socket as a whole never went quiet |
| resync | none needed on `depth_full`. Reconnect on close | each frame replaces the book |
| topic hygiene | never send a topic suffix such as `,20` | one bad topic closes the socket and drops every contract on it |
| deflate | keep it off | not negotiated |

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | OneBullEx Open API Documentation, version 2.1.1 dated 2026-04-20, `https://doc.onebullex.com/onebullex-openapi-en-v2.md`, sections 6.1 to 6.11 and 8.3 | 2026-10-09 |
| S2 | Website bundles `https://www.onebullex.com/_next/static/chunks/8516-3717ebce12deb4d6.js`, which holds the host config, the socket client class, the channel enum and the protobuf schemas under `com.kylin.tiger.biz.core.proto`, and the futures page chunks of `https://www.onebullex.com/futures/BTC-USDT`, which hold the subscribe calls | 2026-10-09 |
| S3 | "System Maintenance Schedule and Operational Restrictions", `https://support.onebullex.com/hc/en-us/articles/5159807678110`, updated 2026-03-27, read through the Zendesk API | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/onebullex/ws-probe.py), modes `open`, `book`, `batch`, `silence` and `deflate` | 2026-10-09 |
