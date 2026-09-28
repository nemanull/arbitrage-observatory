# TruBit Pro REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 local time, 2026-09-24 06:42 to 06:59 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocated to Canada (Cloudflare trace `loc=CA`, colo `YVR`).

This profile covers the public contract market REST API of TruBit Pro for its one perpetual family, USDT-M.
Every measured number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/trubit-pro/rest-probe.mjs) unless a source id says otherwise, and the mode is named beside it.
No CCXT class exists for TruBit, so the catalog mapping in section 2 describes what a hand-written loader would have to do.
Access results are from the Canadian VPN exit named above.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api-futures.trubit.com/market/api/v1`, S2 |
| DNS | `api-futures.trubit.com` is a CNAME to `api-futures.trubit.com.a1.initba.com`, one address `155.102.130.209` |
| edge | `Server: ESA`, Alibaba Cloud's edge, and the `via` header names caches `us37`, `l2us5` and `l2jp2`, which suggests an origin in Japan, an inference from the cache names |
| cold request | 472 ms, and 471 ms in the rerun at 06:57 UTC, `basic` |
| warm requests | 259 to 264 ms over five calls, and 254 to 262 ms in the rerun, `basic` |
| 60 s of bulk polls | median 258 to 259 ms, max 502 to 509 ms, none over 1 s, `poll` |

`https://api.trubit.com/` answered 500 `{"msg":"Internal Server Error","code":500,"data":null}` to every path tried, and it is not a documented base.
Every documented public call answered 200 to this host.

## 2. Catalog

### The instruments call

`GET /basic/refData`, documented at 1 request per second per IP, S1.

```json
{"code":0,"message":"OK","result":[{"symbol":"MASKUSDT","tick":1.0E-4,"lotSize":1.0,"type":"PERP"}]}
```

The reply is 2,546 bytes for 40 rows, and each row carries only `symbol`, `tick`, `lotSize` and `type`.
All 40 rows were `"type":"PERP"`, all 40 symbols end in `USDT`, and every `lotSize` was 1, `basic`.
The row has no status, no base or quote field, no contract size and no listing time.
A delisted contract presumably leaves the list, but no status value is documented.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no TruBit class, and the CCXT master tree has none either, see [`fees.md`](./fees.md) section 8.
A loader would build each market by hand.

| engine field | source | note |
|---|---|---|
| `rawMarketId` | `symbol` | identical to the socket `key` and to the anchor replies' `symbol` on 40 of 40 |
| `base` | `symbol` minus the `USDT` suffix | `1000PEPEUSDT` gives `1000PEPE`, which needs a price scale of 1000 |
| `quote` | `USDT` | |
| `linear` | true | margined and settled in USDT, S1 |
| `contractSize` | none | book `qty` is USDT notional, so sizes must be divided by price, not multiplied by a constant, see [`websocket.md`](./websocket.md) section 4 |
| `active` | presence in the list | no status field |

### Pairs to watch

- `1000PEPEUSDT` is quoted per 1,000 PEPE, so it needs a price scale.
- `TBTCTUSDT` is a second bitcoin contract.
  Its index read 84,110.80333333333 at the same `time` as `BTCUSDT`'s, identical to every digit, and its book traded at whole dollar prices near 84,077 on 2026-09-24 06:56 UTC.
  It held about 4.6 M USDT of open interest against about 36.6 M on `BTCUSDT`.
  A symbol based loader would read its base as `TBTCT`, so it must be skipped or mapped explicitly, and `BTCUSDT` is the one to keep.
- `TSLAUSDT` and `NVDAUSDT` are US equity perpetuals launched 2026-02-27, S9 of [`fees.md`](./fees.md), and `XAGUSDT` is silver.
- Apart from `TBTCTUSDT`, no pair is listed twice.

## 3. Anchor

### The bulk calls

| call | field | rows | reply | documented limit | time, 60 polls |
|---|---|---|---|---|---|
| `GET /basic/indexPrice` | `price`, `time` | 40 | 2,557 to 2,576 bytes | 10 per second | median 259, p90 271, max 506 ms |
| `GET /basic/markPrice` | `price`, `time` | 40 | 2,555 to 2,592 bytes | 10 per second | median 258, p90 271, max 502 ms |
| `GET /kLine/fundingRate?symbols=<all 40, comma separated>` | `rate`, `date`, `timestamp` | 40 | 4,078 bytes | 5 per second | median 259, p90 272, max 509 ms |
| `GET /basic/lastPrice` | `price`, `time` | 40 | 2,342 bytes | 1 per second | |

`indexPrice` and `markPrice` return every contract when `symbols` is omitted.
`fundingRate` without `symbols` answers `{"code":1,"msg":"FAILED","data":null}`, although S1 marks the parameter optional, so the call must name every contract.
No call publishes the funding interval or the next settlement time.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none |
| `index` | `indexPrice` `price` | JSON number | none |
| `mark` | `markPrice` `price` | JSON number, never 0 on 40 rows | none |
| `fundingRate` | `fundingRate` `rate` | JSON number, a fraction: `1.0E-5` is 0.001 % | none |
| `fundingIntervalHours` | none | | constant from the docs, 8 by S3 of [`fees.md`](./fees.md), 4 by its S9, unresolved |
| `nextFundingAt` | none | | not published |

The funding reply looked like this on 2026-09-24 at 06:42 UTC:

```json
{"code":0,"message":"OK","result":[{"symbol":"BTCUSDT","rate":1.0E-5,"date":"2026-09-24T06:00:00.000+00:00","timestamp":1790229600259}]}
```

Every one of the 40 rows carried `date` `2026-09-24T06:00:00.000+00:00` for the whole `poll` minute, and the rate changed 0 times on 40 of 40 contracts.
The docs say the rate "will be updated every 1 hour", S3 of [`fees.md`](./fees.md).
Whether `rate` is the rate for the next settlement or the one last computed at `date` is Not verified, and the settlement instant itself was not captured.

## 4. Anchor semantics

### Index

"The index price is taken from 5 major spot exchanges and applies dynamic algorithms to eliminate abnormal data sources in real-time", S5 of [`fees.md`](./fees.md).
The index article names "Binance, Okex, Huobi, Coinbase, Kraken" as examples and gives a volume weighted mean, S6 of [`fees.md`](./fees.md).
No basket or constituent call is documented, so the per contract basket is Not publicly specified.

### Mark

The mark is "Calculated based on index price and funding rate", and is "typically derived from the midpoint of the order book price but is also linked to the index price", with "the moving average benchmark", S6 of [`fees.md`](./fees.md).
No formula and no clamp are published.
On 2026-09-24 at the end of `poll`, mark over index ranged to -3,074 ppm on `AVAXUSDT`, -2,983 on `DYDXUSDT`, -2,481 on `XAIUSDT` and +1,786 on `MANAUSDT`.

### Funding

"Funding Rate = MA [ (Contract Price - Index Price)/Index Price]/Adjustment Coefficient", over 60 minutes with coefficient 1, capped at plus or minus 0.375 % or 0.75 % by maximum leverage, S3 of [`fees.md`](./fees.md).
35 of 40 rates were exactly plus or minus 0.00001 at 06:42 UTC, see [`fees.md`](./fees.md) section 6.

### How often each number changed

| number | changes in 59 one second intervals, over 40 contracts | BTC | ETH | MASK |
|---|---|---|---|---|
| index | min 0, median 13, max 47, 5 contracts never changed | 43 | 38 | 0 |
| mark | min 2, median 32, max 50 | 45 | 43 | 30 |
| funding | 0 on all 40 | 0 | 0 | 0 |

The index `time` field ran behind.
In `basic` at 06:45 UTC its age was 134 ms at the freshest, 5.6 s at the median and 206.5 s at the oldest, on `MASKUSDT`.
In the rerun at 06:57 UTC the median was 6.6 s, and `MASKUSDT` still carried the same `time`, 1790232168471, and the same price 0.4604, now 892 s old, while its mark moved 30 times in the `poll` minute.
The mark `time` age was 165 ms to 6.8 s, and 173 ms to 6.4 s in the rerun.
A thin contract's index can therefore sit unchanged for minutes, which the engine's 1,000 ppm move rule and 10 s age rule never see, because the poller stamps each reading on arrival.
A poller could read the `time` field to judge the venue's own age of the index.

## 5. REST book snapshot

`GET /depth/list?symbol=<s>&level=<5|10|20>`, documented at 10 per second per IP, S1.

| item | value |
|---|---|
| depth | 20 levels per side at most, `level=50` returned 20, and `level=7` also answered 200 |
| order | bids descending and asks ascending on BTC, ETH and MASK, `basic` |
| extra | a `trades` array beside `buyDepth` and `sellDepth` |
| size | `qty`, integer USDT notional |
| time | 255 to 259 ms warm, and one 1,020 ms reply on MASK, `basic` |
| caching | the 20 level book matched a book rebuilt from the socket on 60 of 60 checks, see [`websocket.md`](./websocket.md) section 4, so it is at least as fresh as the socket |

## 6. Rate limits and errors

The limits are per IP and per call, S1: `refData` 1 per second, `lastPrice` 1, `fundingRate` 5, `openInterest` 5, `indexPrice` 10, `markPrice` 10, `depth/list` 10.
The status code and body of a limit hit were not provoked and are Not verified.
The error code table lists `20013` "Transaction sent too fast", `20089` "Operation too fast" and `20121` "Operate frequently, try again 60 seconds later", S1.

| request | status | body, `errors` mode |
|---|---|---|
| `depth/list?symbol=NOPEUSDT` | 200 | `{"code":24001,"message":"Symbol not found","result":null}` |
| `depth/list` without symbol | 200 | `{"code":1,"msg":"FAILED","data":null}` |
| `markPrice?symbols=NOPEUSDT` | 200 | `{"code":0,"message":"OK","result":[]}` |
| `fundingRate?symbols=NOPEUSDT` | 200 | `{"code":24001,"message":"Symbol not found","result":null}` |
| `basic/nothing` | 404 | `{"timestamp":"2026-09-24T06:45:32.730+00:00","status":404,"error":"Not Found","path":"//api/v1/basic/nothing"}` |

Errors come back as HTTP 200 with a non zero `code`, so a poller must check `code`, not only the status.
One unknown symbol inside the funding `symbols` list fails the whole call, so the list must be rebuilt from the catalog.

## 7. Server time and clock offset

The contract API has no time call.
The spot host answers `GET https://api-spot.trubit.com/openapi/v1/time` with `{"serverTime":<ms>}`, S13.
Two reads gave offsets of +168 ms with a 711 ms round trip and +192 ms with a 617 ms round trip, so the clock agrees within about 350 ms, `basic`.
The contract replies carry an HTTP `Date` header at one second resolution.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `GET /basic/indexPrice`, `GET /basic/markPrice`, `GET /kLine/fundingRate?symbols=<every catalog symbol>` | three bulk calls cover index, mark and rate for all 40 |
| interval | 1,000 ms | 3 requests per second against limits of 10, 10 and 5, and max 509 ms in 60 polls |
| funding interval | constant, pending an answer between 8 h and 4 h | not published by the API |
| next settlement | none, leave unset | not published |
| row mapping | section 3, key `symbol` | |
| index age | read the `time` field and treat an index older than a few seconds as stale | the `MASKUSDT` index sat unchanged for at least 892 s |
| errors | check `code` in every 200 reply | errors are not HTTP errors |
| rate limit pause | 1,000 ms | the documented windows are per second, and no `Retry-After` was seen |

Three calls of about 2.5 to 4 KB each per second is about 0.8 GB a day.

## 9. Source ledger

| id | source | read |
|---|---|---|
| S1 | https://docs-api.trubit.com/trubit-pro/contract/contract-api.md, sections "Market Endpoint" and "Code Description" | curl, 2026-09-24 |
| S2 | https://docs-api.trubit.com/trubit-pro/readme.md, endpoint tables | curl, 2026-09-24 |
| S13 | https://docs-api.trubit.com/trubit-pro/spot/rest-api.md, "Check server time" | curl, 2026-09-24 |
| fees | S3, S5, S6 and S9 are in the ledger of [`fees.md`](./fees.md), and S6 is "What are Index Price, Mark Price, and Last Price?", article 42051377552532, updated 2025-10-11 | Zendesk API, 2026-09-24 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/trubit-pro/rest-probe.mjs) modes `basic`, `poll`, `errors` | run 2026-09-24 06:44 to 06:58 UTC |
