# Mudrex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:16 to 04:31 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare loc=CA, SEA edge).

This profile covers the REST API of Mudrex (CCXT id `mudrex`) for its USDT-quoted linear perpetuals.
Every measured number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/mudrex/rest-probe.mjs) or [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs), each run twice.
The public surface is two candle endpoints, price and mark price, and nothing else.
The catalog, the asset detail with its funding fields, and every other path sit behind an `X-Authentication` secret that only a KYC-verified Indian account can create, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `trade.mudrex.com`, base path `/fapi/v1`, S1 |
| resolved | `99.86.101.25`, `99.86.101.52`, `99.86.101.69`, `99.86.101.74` in both runs, no CNAME record |
| path | CloudFront POP `SEA900-P13`, then `via: 1.1 kong/3.9.0`, `server: mudrex.edge` |
| caching | `x-cache: Miss from cloudfront` on every public reply whose headers the probe logged, so a poll reaches the origin |
| cold request | 371 and 305 ms, one BTC kline |
| warm requests | 306, 91 and 267 ms, then 117, 207 and 199 ms |
| bulk mark-kline, 25 assets, 60 polls | min 128, median 294, p90 415, max 959 ms, then min 126, median 281, p90 425, max 709 ms, none over 1 s |
| access from the Canadian exit | public paths under `/fapi/v1/price` answered 200. The catalog answered 401 `Invalid Authentication`, section 2 |

## 2. Catalog

### The instruments call

The catalog is `GET /fapi/v1/futures`, with `sort`, `order`, `offset` and `limit`, where `limit` defaults to 20, S2.
It requires the `X-Authentication` header, S2, and the FAQ says "Public endpoints and HMAC signing are not part of the MVP" for everything outside `/fapi/v1/price`, S5.
Without a credential it answered the same in both runs.

```json
{"success":false,"errors":[{"text":"Invalid Authentication","code":3100}]}
```

The status was 401 with `x-cache: Error from cloudfront`, for `GET /fapi/v1/futures?limit=1` and for `GET /fapi/v1/futures/BTCUSDT?is_symbol`.
The documented listing row has no status field, S2, so a delisted or halted state cannot be read even with a key.

### The count, read from the socket

The one public list of symbols is the `ticker@1s` snapshot, which returns the last row for every requested symbol that has data, see [`websocket.md`](./websocket.md) section 2.
The probe requested every Gate USDT contract name and every Bybit linear symbol, 1,204 names in the rerun.

| family | active count | evidence |
|---|---:|---|
| USDT-quoted linear perpetuals | 745 in both runs | ticker snapshot, P1 |
| of which also Bybit USDT perpetuals | 745 | every one, P1 and P2 |
| Bybit USDT perpetuals not answered | 32 of 777 | P2, among them the equity and fund tickers `AMZUUSDT`, `ANETUSDT`, `CORZUSDT`, `FUTUUSDT`, `GDXUSDT`, `GTLBUSDT`, `MRNAUSDT`, `OKLOUSDT` and `TLTUSDT` |
| Bybit USDC perpetuals, 68, and dated USDT futures, 40 | 0 | P1 rerun |
| Gate contract names not on Bybit | 0 | P1 |

The count is a lower bound, because the documentation says "Assets with no data yet are omitted from the snapshot", S3.
The set is Bybit's USDT perpetual list less 32 names, and it keeps Bybit's multiplied names: 21 symbols start with a digit, such as `1000PEPEUSDT`, `1000000BABYDOGEUSDT` and `10000SATSUSDT`, P2.
`TON/USDT` returned `{"success":true,"data":{}}` on the REST candles, P4, and `TONUSDT` is not among Bybit's trading USDT perpetuals either, P2.

### How CCXT 4.5.68 maps it

`loadMarkets` without credentials returns nothing.
It calls `privateGetFutures` at `server/node_modules/ccxt/js/src/mudrex.js` line 450, and `sign` calls `checkRequiredCredentials` at line 195, so the probe got `AuthenticationError: mudrex requires "secret" credential` before any request left the host, in both runs.
With a key, `parseMarket` at lines 485 to 547 would give the following, read from the source and from a call of `parseMarket({symbol: '1000PEPEUSDT'})` in the probe.

| field | CCXT value | against the wire |
|---|---|---|
| `market.id` | the listing `symbol`, `BTCUSDT`, line 500 | the socket spells `btcusdt`, and the REST candles take `BTC/USDT` and answer under `btc/usdt`. A feed and a poller both convert |
| `base` | the symbol less a trailing `USDT`, lines 487 to 489, so `1000PEPE` | the REST candle call needs `1000PEPE/USDT` |
| `contractSize` | `contract_size` from the listing, else 1, line 521 | the documented listing has no `contract_size` field, and quantity is "in the base asset", S2, so 1 is right |
| `linear` | true, line 517 | USDT quoted and settled, S1 |
| `active` | true for every row, line 515 | no status field exists to contradict it |
| `taker` | 0.00059, line 519 | see [`fees.md`](./fees.md) section 8 |

No pair is listed twice, since every contract is `<BASE>USDT`.
A multiplied name such as `1000PEPEUSDT` would need the same price scale the engine already gives Bybit's, since the names are Bybit's.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v1/price/mark-kline?assets=<up to 25>&aggregation=1m&start_time=<s>&end_time=<s>` | absent | close of the last completed 1 m candle | absent | absent | absent | 1,447 and 1,445 bytes for 25 assets | median 294 and 281 ms over 60 polls |
| `GET /fapi/v1/price/kline`, same parameters | absent | absent, it is the last price | absent | absent | absent | 1,609 and 1,603 bytes for 25 assets | median 298 and 272 ms over 12 polls |
| `GET /fapi/v1/futures`, private | absent | absent | `funding_fee_perc` | absent | `funding_interval`, Unix seconds of the next funding, S2, S5 | not readable, 401 | |

No public call carries an index, a funding rate, an interval or a next settlement time.
The one public mark is a 1 m candle, 25 assets per call at most, S4, so 745 perpetuals take 30 calls per round.
At the documented 300 requests per minute per IP, S4, one full round fits every 6 s at best.
The socket's `markKline@1s` and ticker `mp` carry the mark faster, see [`websocket.md`](./websocket.md) section 8, but the socket has no index or funding either.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the `asset_ticks` key, `btc/usdt` | lowercase, with a slash | drop the slash and uppercase to get `BTCUSDT` |
| `index` | none | | Not publicly specified |
| `mark` | the last candle's element 4, the close | JSON number | none, but it is 1 to 60 s old, section 4 |
| `fundingRate` | none public | | the private `funding_fee_perc` is a "Funding fee percentage", unit not stated, S2 |
| `fundingIntervalHours` | none | | "compare consecutive next-funding times (or ask support for the schedule)", S5 |
| `nextFundingAt` | none public | | the private `funding_interval` would be multiplied by 1,000 |

## 4. Anchor semantics

### Index

Not publicly specified.
Mudrex publishes no index value, no basket and no index formula.
Its learn article describes an index only generically, as "Average of major exchange prices", S6.
The engine's anchor reading divides one leg's index by the other's, at [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 58, so a leg with no index cannot be judged.

### Mark

Mudrex publishes no mark formula and no clamp.
On the wire the mark is Bybit's.

| comparison, `ws-probe.mjs mark`, Bybit ticker polled once a second for 40 s | BTC | ETH | SOL |
|---|---|---|---|
| `markKline@1s` close equal to a Bybit `markPrice` seen in the previous 10 s | 27 of 28, then 28 of 30 | 23 of 26, then 33 of 33 | 13 of 13, then 28 of 33 |
| median lag behind that Bybit reading | 322, then 838 ms | 888, then 619 ms | 321, then 870 ms |
| `markKline@1s` close equal to a Bybit `indexPrice` within 10 s | 0 | 0 | 0, then 1 |
| ticker `mp` equal to a Bybit mark within 10 s | 26 of 29, then 31 of 35 | 25 of 31, then 33 of 35 | 12 of 15, then 20 of 26 |
| ticker `mp` median lag | 1,011, then 1,617 ms | 2,001, then 1,616 ms | 4,004, then 2,601 ms |

The last price is Bybit's as well.
At one read 20 s into each `ws-probe.mjs streams` run, the ticker `p` equalled Bybit's `lastPrice` on 705 of 745 symbols in both runs, and the 90th percentile difference was 0 ppm.
Gate's `last` equalled it on 26 and 28 of 660 shared symbols.
So Mudrex quotes Bybit's prices, the mark a fraction of a second late, and a Mudrex leg would add no cross that Bybit's own book does not show.
Whether Mudrex routes orders to Bybit is Not publicly specified.
The terms say only that derivative "Prices and execution are offered by Mudrex TR", S7.

If Mudrex passes Bybit's mark through, a capped or lagging Bybit mark reaches a Mudrex leg as well, and Bybit's own profiles are in [`../bybit/`](../bybit/).
That pass-through is an inference from equal numbers, not a published rule.

### Funding

Not publicly specified, see [`fees.md`](./fees.md) section 6.
Whether a published rate would be the upcoming or the last settled one cannot be checked, since no rate is public.
The settlement instant itself was not captured.

### How often each number changed

| number | source | change over the probe |
|---|---|---|
| REST mark close | `mark-kline`, 25 assets, 60 polls a second apart | once a minute at most: each of 25 assets changed once in the first run, and 16 changed once and 9 not at all in the rerun, which ended 4 s after a minute boundary |
| REST mark candle age | the last candle's open time against the request's `end_time` | 61 to 120 s in both runs, so the close is 1 to 60 s old |
| REST reply completeness | keys per reply | the rerun's first reply, 4 s after a minute boundary, carried 10 of 25 assets, and 11 of 60 replies carried fewer than 25. The FAQ says "symbols with no data in the interval, are omitted", S5 |
| socket mark | `markKline@1s@btcusdt` | 24 and 34 frames in about 42 s, since a second with no change sends nothing |

The REST window used was `end_time - 120` to `end_time`, and every asset present in a reply held one closed candle and never the candle in progress.
The first `catalog` run's BTC kline, read 6 s after a minute boundary with the same window, came back as 55 bytes, which is the length of `{"success":true,"data":{"asset_ticks":{"btc/usdt":[]}}}`, while the later runs got 103 and 104 bytes with one candle.

## 5. REST book snapshot

None.
The documentation lists no book path, S1, and CCXT sets `fetchOrderBook: false` at `server/node_modules/ccxt/js/src/mudrex.js` line 58.
The probe tried `/fapi/v1/price/depth`, `/price/orderbook`, `/price/ticker`, `/price/tickers`, `/price/trades`, `/price/index-kline`, `/price/funding` and `/fapi/v1/time`, and every one answered 401 with code 3100 `Invalid Authentication` in both runs.
All eight answered alike, including `/fapi/v1/time`, which the documentation does not list, so a 401 here does not show that a private path exists.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public REST limit | 300 requests per minute per IP, with "no weight-based scheme", S4 | not approached, the busiest mode sent about 72 requests in a minute |
| breach | `HTTP 429 Too Many Requests` with `{"code":429,"text":"Rate limit exceeded"}`, S4 | not triggered |
| `Retry-After` | Not publicly specified | not seen, and no rate limit header appeared on the 200 replies whose headers the probe logged |
| trading API limits | per key: 10 per second, 500 per minute, 30,000 per hour by default, and 2 per second on wallet endpoints, S4 | not probed |

Error shapes seen, each in both runs.

| request | status | body |
|---|---:|---|
| `mark-kline` with no `assets` | 400 | `{"success":false,"errors":[{"code":400,"text":"assets are required"}]}` |
| 26 assets | 400 | `"allowed assets size is 25"` |
| `aggregation=1s` | 400 | `"1s aggregation not supported"` |
| no `end_time` | 400 | `"start and end time should be greater than 0"` |
| `NOPE/USDT` alone, `TON/USDT`, or `BTCUSDT` without a slash | 200 | `{"success":true,"data":{}}` |
| `BTC/USDT,NOPE/USDT` | 200 | only `btc/usdt` in `asset_ticks` |
| `btc/usdt` in lowercase | 200 | accepted |
| any private or unknown path without a key | 401 | `{"success":false,"errors":[{"text":"Invalid Authentication","code":3100}]}` |

An unknown or misspelt symbol is silent, which a poller has to notice on its own.
The documented 404 `asset not found`, S4, was not produced by any of these requests.

## 7. Server time and clock offset

No time call is public, and `/fapi/v1/time` answered 401.
The `Date` header has one second resolution, so the server time minus the local request midpoint should fall between -1,000 and 0 ms when the clocks agree.
It read -541, -188, -791, -395 and 2 ms, then -105, -760, -370, -919 and -470 ms, with round trips of 94 to 293 ms.
So the clocks agree within about a second, and nothing finer can be read.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| anchor poller | none | no public index, funding rate, interval or next settlement, section 3 |
| mark alone | not from REST | the REST mark is the close of the last completed minute, 1 to 60 s old on arrival, while the engine stamps a reading on arrival and trusts it for 10 s, `ANCHOR_MAX_AGE_MS` at [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 5 |
| catalog | none without a key | 401 on `/fapi/v1/futures`, and CCXT cannot load markets |
| rate limit pause | 60,000 ms if ever used | the limit is counted per minute and no `Retry-After` is documented |

Mudrex cannot supply an `AnchorRow` today.
Its mark could fill the `mark` column from the socket, but the index would stay empty, and the engine's index gap in section 4 has nothing to divide.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Mudrex API docs, Overview and Market Data | https://docs.trade.mudrex.com/docs/overview | 2026-09-22 | RPFAS Technologies, India | host, base path, public surface, sections 1, 5 |
| S2 | Mudrex API docs, Asset listing and Asset by id | https://docs.trade.mudrex.com/docs/get-asset-listing | 2026-09-22 | RPFAS Technologies, India | catalog call, fields, funding fields, sections 2, 3 |
| S3 | Mudrex API docs, WebSocket Streams | https://docs.trade.mudrex.com/docs/websocket-streams | 2026-09-22 | RPFAS Technologies, India | ticker snapshot omits assets without data, section 2 |
| S4 | Mudrex API docs, Mark Price Kline, Historical Kline and Authentication and Rate Limits | https://docs.trade.mudrex.com/docs/mark-price-kline | 2026-09-22 | RPFAS Technologies, India | 25 assets per call, error texts, 300 per minute, trading limits, sections 3, 6 |
| S5 | Mudrex API docs, FAQ | https://docs.trade.mudrex.com/docs/faq | 2026-09-22 | RPFAS Technologies, India | no public trading endpoints, `funding_interval` meaning, omitted symbols, sections 2 to 4 |
| S6 | Mudrex Learn, perpetual contracts explained | https://mudrex.com/learn/perpetual-contract-explained-how-to-trade-futures/ | 2026-09-22 | Mudrex, India | generic index description, section 4 |
| S7 | Mudrex Terms of Use | https://mudrex.com/terms | 2026-09-22 | all three entities | derivatives priced and executed by Mudrex TR, section 4 |
| S8 | CCXT 4.5.68 `mudrex.js` | `server/node_modules/ccxt/js/src/mudrex.js` | 2026-09-22 | CCXT | `loadMarkets`, `parseMarket`, `fetchOrderBook: false`, sections 2, 5 |
| P1 | `ws-probe.mjs streams` and `mark`, two runs each between 04:17 and 04:30 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit, plus Bybit's and Gate's public tickers | symbol count, Bybit comparison, sections 2 and 4 |
| P2 | `rest-probe.mjs catalog`, runs at 04:22 and 04:27 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/mudrex/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | DNS, latency, 401, CCXT, Bybit set difference, sections 1 and 2 |
| P3 | `rest-probe.mjs anchor`, runs at 04:22 and 04:30 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/mudrex/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | bulk reply size and time, candle age, change counts, sections 1, 3, 4 |
| P4 | `rest-probe.mjs errors` and `clock`, runs at 04:24 and 04:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/mudrex/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | error shapes, guessed paths, clock, sections 5 to 7 |
