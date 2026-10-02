# Upbit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:06 to 03:42 UTC), from the development host near Seattle.

This profile covers the public quotation REST API of Upbit Korea (CCXT id `upbit`) at `https://api.upbit.com/v1`.
Upbit lists no perpetual, so this is its spot catalog and book, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/upbit/rest-probe.mjs) unless it names a source.
R1 is the first run of `host`, `catalog`, `ticker`, `book` and `errors` at 03:14 to 03:15 UTC, R2 the `time` mode at 03:15 UTC and a `book` rerun at 03:24 UTC, R3 the second pass of every mode at 03:26 UTC, and R4 a `ticker` rerun with turnover sums at 03:41 UTC.

## 1. Host and latency from this machine

| item | value |
|---|---|
| name | `api.upbit.com` is a CNAME of `api.upbitit.cool` |
| addresses | six A records, `52.78.7.238`, `16.184.63.104`, `54.116.177.64`, `43.202.177.228`, `15.164.2.255`, `52.78.85.202` at 03:06 UTC, and a different six, `15.165.199.204`, `13.124.164.152`, `43.203.47.177`, `3.34.235.171`, `3.36.1.145`, `54.180.169.171`, at 03:26 UTC |
| protocol | HTTP/2 |
| cold request, `/v1/market/all`, 59 KB | 541 ms in R1 and 538 ms in R3 |
| warm request, the same | median 171 ms in R1 and 176 ms in R3, 168 to 182 ms over 14 requests |
| round trip of a small book read | 165 to 206 ms on 39 of 40 requests, and one cold request of 548 ms, R2 and R3 |
| headers | `remaining-req`, `limit-by-ip: Yes`, `cache-control: no-cache, no-store, max-age=0, must-revalidate`, and a weak `etag` |
| refusals | none: every public call answered, and no geoblock or challenge page was served to this host |

## 2. Catalog

### The instruments call

| call | reply | what it holds |
|---|---|---|
| `GET /v1/market/all` | 59 KB, 855 rows | `market`, `korean_name`, `english_name` |
| `GET /v1/market/all?is_details=true` | 236 KB, 855 rows, 176 to 710 ms | the same plus `market_event`: `warning` and five `caution` flags, S4 |
| `GET /v1/orderbook/instruments?markets=...` | one row per pair | `quote_currency`, `tick_size`, `supported_levels`, S5 |

On 2026-09-23 the catalog held 855 pairs: 289 KRW, 328 BTC and 238 USDT, in R1 and R3.
It has no status, tick size, lot size or listing date field, so a pair is either listed or absent.
358 distinct base assets are listed: 47 in one market, 125 in two and 186 in all three, and 197 bases trade against both KRW and USDT.
`market_event.warning` was true on 18 pairs, and at least one `caution` flag was true on 233 pairs in R1 and 234 in R3.
The most common flag was `GLOBAL_PRICE_DIFFERENCES`, "국내외 가격 차이 경보", a warning that the Upbit price differs from overseas prices, on 188 and 187 pairs, S4.

`orderbook/instruments` gave `KRW-BTC` a tick of `"1000"` and levels `0`, `10000`, `100000`, `1000000` and two more, `KRW-XRP` a tick of `"1"`, `USDT-BTC` a tick of `"0.01"` with level `0` only, and `BTC-ETH` a tick of `"0.00000001"` with level `0` only, R1 and R3.
The KRW tick table is stepped by price, from 1,000 KRW at 1,000,000 KRW and above down to 0.00000001 KRW below 0.00001 KRW, S6.

### How CCXT 4.5.68 maps it

| item | value | source |
|---|---|---|
| call | `fetchMarkets` reads `market/all` without details | `server/node_modules/ccxt/js/src/upbit.js` lines 508 to 520 |
| markets | 855, every one `type` `spot`, 0 swaps | R1 and R3 |
| `market.id` | the `market` field, `KRW-BTC`, identical on 855 of 855, and identical to the socket `code` | R1 and R3, [`websocket.md`](./websocket.md) section 3 |
| `symbol` | `BTC/KRW`, base and quote split from the id, quote first on the wire | lines 522 to 529 |
| `active` | hard coded `true` on every market | line 542 |
| `linear`, `contractSize` | `undefined` on every market | lines 544 and 548 |
| `taker`, `maker` | 0.0005 on KRW pairs, 0.0025 on BTC and USDT pairs | lines 546 and 547, see [`fees.md`](./fees.md) section 8 |
| renamed currency | `TON` becomes `Tokamak Network`, and no `TON` pair was listed | line 282, R1 |

The connector keeps only markets with `type` `swap`, `swap` true and `active` not false, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 201, so it keeps none of Upbit's 855.
If it ever loaded spot, `active` would not track a delisting, because CCXT sets it to `true` whatever the venue says.
Sizes are in the base currency, which matches the `contractSize` of 1 that the connector reads from `undefined`, see [`websocket.md`](./websocket.md) section 4.
No pair needs a price scale.
A base listed in two or three quote markets is one pair per market, and only the USDT market is in the engine's USD, USDC and USDT quote family, so the engine would see at most one Upbit market per base.
That USDT market is thin: over the 24 h to 03:41 UTC on 2026-09-23 the KRW market turned over 2.34 trillion KRW, about 1,745 million USDT at the `KRW-USDT` last trade of 1,343, while the BTC market turned over 30.01 BTC, about 2.6 million USDT, and the USDT market 1.07 million USDT, R4.
So the USDT market carried about 0.06 % of the KRW market's turnover.

## 3. Anchor

Upbit publishes no index price, no mark price and no funding rate, and it has no perpetual to which one would belong.
Neither developer index names any such endpoint, S1 and S2.
The reference prices it does publish are these.

| call | what it is | reply | warm time |
|---|---|---|---|
| `GET /v1/ticker/all?quote_currencies=KRW` | last trade, 24 h and 52 week statistics for every KRW pair | 227 KB, 289 rows | 20 polls: min 177, median 181, p90 198, max 714 ms in R1, and min 174, median 178, p90 197, max 349 ms in R3 |
| `GET /v1/ticker/all?quote_currencies=BTC` and `USDT` | the same for the other two markets | 229 KB, 328 rows, and 171 KB, 238 rows | 175 to 282 ms |
| `market_event.caution.GLOBAL_PRICE_DIFFERENCES` in `market/all?is_details=true` | a flag that Upbit's price differs from overseas prices | a boolean per pair | as above |

The ticker's `trade_price` is the last trade and nothing else.
Across 20 consecutive KRW polls about 0.5 s apart, `trade_price` changed in 48 and 57 of 5,491 row to row comparisons, and `timestamp` in 346 and 390, R1 and R3.
The site of Upbit's own index family, UBCI, at `ubcindex.com` and `www.ubcindex.com`, did not resolve from this host on 2026-09-23.

## 4. Anchor semantics

There is no index basket, mark formula, clamp, funding formula or cap to record, because none of the three numbers exists.
The threshold behind `GLOBAL_PRICE_DIFFERENCES` is Not publicly specified in S4.
A spot leg would have to be anchored by another venue's index, because Upbit's own last trade is the only price it publishes.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /v1/orderbook?markets=KRW-BTC,KRW-ETH&count=30&level=0`, S3 |
| depth | `count` 1 to 30, default 30. `count=31` and `count=50` returned 30, and `count=abc` returned 400 "Type mismatch error. Check the parameters type!", R1 and R3 |
| pairs per call | every listed pair at once: 855 pairs, 2.29 MB, in 392 ms in R1, 2,846 ms in R2 and 387 ms in R3. 289 KRW pairs, 795 KB, in 344, 1,696 and 344 ms |
| one bad pair | fails the whole call with 404 `Code not found` |
| level order | each `orderbook_units` element holds one bid and one ask. Bids strictly descending and asks strictly ascending on `KRW-BTC` in every run |
| key order | `bid_price`, `bid_size`, `ask_price`, `ask_size`, which is not the socket's order |
| numbers | plain JSON numbers, as in `116233000`, where the socket writes a price of that size in exponent form, as in `1.16539E8`, see [`websocket.md`](./websocket.md) section 3 |
| zero slots | a thin side is padded with `{"bid_price":0,"bid_size":0,...}`. 42 of the first 60 BTC market pairs carried at least one zero slot, and `BTC-LWP` had 27 zero bid slots of 30, R1 to R3 |
| `level` | groups KRW books: `KRW-BTC` with `level=100000` returned prices on a 100,000 KRW step. `BTC-ETH` with `level=100` returned `[]` with 200 |
| case | `markets=krw-btc` returned the `KRW-BTC` book with 200 |
| caching | `no-cache`. `timestamp` is the time of the book's last change on the pair's 100 ms grid, and 6 to 10 distinct timestamps came back over 10 reads about 0.5 s apart |
| age | the book lagged its `timestamp` by 101 to 1,708 ms over 30 repeat reads, R1 to R3, and by up to 2,207 ms in the 40 clock reads, R2 and R3. It matched the socket frame with the same `timestamp` level for level and was 0 to 200 ms behind the newest socket frame, see [`websocket.md`](./websocket.md) section 4 |

The documentation describes `timestamp` as "조회 요청 시각의 타임스탬프", the time of the request, S3.
The wire disagrees: every `KRW-BTC` timestamp read ended in 06 ms modulo 100, and the lag grew between book changes, R2 and R3.
So the timestamp dates the book, and it cannot be used to read the server clock.

## 6. Rate limits and errors

| group | limit | unit | source |
|---|---|---|---|
| `market`, `candle`, `trade`, `ticker`, `orderbook` | 10 requests a second each | IP | S7 |
| `origin`, any quotation request with an `Origin` header | 1 request per 10 s | IP | S7, S8 |
| `websocket-connect` | 5 a second | IP | S7 |
| `websocket-message` | 5 a second and 100 a minute | connection | S7 |

CCXT spaces public calls to 10 a second, with `rateLimit` 50 ms and a cost of 2 per public call, at `server/node_modules/ccxt/js/src/upbit.js` lines 26 and 110 to 131.

Every reply carries `remaining-req: group=<group>; min=600; sec=<n>`.
`sec` is the number of requests left in the current second, and `min` is deprecated, S7.
This probe saw `sec` between 7 and 9 at its pace of about three requests a second.
A request with `Origin: https://example.com` answered 200 with `remaining-req: group=origin; min=6; sec=0`, so the next one within 10 s would be refused, R1 and R3.

Exceeding a group's limit returns 429, and repeated 429s return 418 with a block whose length grows with each repeat, S7.
The documented 418 reply includes the block time, S7.
No 429 or 418 was provoked, and `Retry-After` was never seen, so whether a 429 carries it is Not verified.

| request | status | body |
|---|---|---|
| `/v1/orderbook?markets=KRW-NOPE` | 404 | `{"error":{"name":404,"message":"Code not found"}}` |
| `/v1/orderbook?markets=KRW-BTC,KRW-NOPE` | 404 | the same |
| `/v1/orderbook` | 400 | `{"error":{"name":400,"message":"Missing request parameter error. Check the required parameters!"}}` |
| `/v1/orderbook?markets=KRW-BTC&count=abc` | 400 | `{"error":{"name":400,"message":"Type mismatch error. Check the parameters type!"}}` |
| `/v1/ticker?markets=KRW-NOPE` | 404 | `{"error":{"name":404,"message":"Code not found"}}` |
| `/v1/nope` | 404, no `remaining-req` | `{"error":{"name":"not_found","message":"no Route matched with those values"}}` |

Quotation errors carry an integer `name`, as S9 says, and the unrouted path carries a string.

## 7. Server time and clock offset

Upbit has no server time endpoint.
The `Date` header has one second resolution, so the probe sent 20 book reads with 0.2 s pauses and bounded the offset at the second in which `Date` changed.
The local clock minus the server clock lay between −113 and +113 ms in R2, and between −100 and +110 ms in R3.
That is consistent with no offset, and it cannot resolve anything finer than about 200 ms.

## 8. Recommended poller shape

No anchor poller is recommended, because Upbit publishes no index, mark or funding to poll.
If a spot leg is ever built, two REST calls still help.

| item | recommendation | reason |
|---|---|---|
| catalog refresh | `https://api.upbit.com/v1/market/all?is_details=true` every few minutes | CCXT marks every pair `active`, and this reply is the only place a pair disappears or gains `warning` |
| skip | pairs with `market_event.warning` true | investment warning pairs, 18 on 2026-09-23 |
| book reseed | not needed | every socket frame is a whole 30 level book |
| headers | no `Origin` header, and `Accept-Encoding: gzip` | the `origin` group allows one request per 10 s. gzip is supported, S9 |
| rate limit pause | 1,000 ms on 429, and the block time in the body on 418 | the window is one second, S7 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Upbit developer center index, Korea | https://docs.upbit.com/kr/llms.txt | 2026-09-23 | Dunamu, Korea | no index, mark or funding endpoint, section 3 |
| S2 | Upbit developer center index, regional sites | https://global-docs.upbit.com/llms.txt | 2026-09-23 | Upbit Singapore, Indonesia, Thailand | the same, section 3 |
| S3 | 호가 조회, page updated 2026-07-28 | https://docs.upbit.com/kr/reference/list-orderbooks | 2026-09-23 | Dunamu, Korea | `count` up to 30 since v1.5.8 of 2025-07-02, `level`, `timestamp` described as request time, section 5 |
| S4 | 페어 목록 조회, page updated 2026-07-29 | https://docs.upbit.com/kr/reference/list-trading-pairs | 2026-09-23 | Dunamu, Korea | `is_details` and `market_event` flags, sections 2 to 4 |
| S5 | 호가 정책 조회, page updated 2026-07-28 | https://docs.upbit.com/kr/reference/list-orderbook-instruments | 2026-09-23 | Dunamu, Korea | `tick_size` and `supported_levels`, section 2 |
| S6 | 원화(KRW) 마켓 주문 가격 단위, page updated 2026-05-04 | https://docs.upbit.com/kr/docs/krw-market-info | 2026-09-23 | Dunamu, Korea | KRW tick table, section 2 |
| S7 | 요청 수 제한 (Rate Limits), page updated 2026-09-08 | https://docs.upbit.com/kr/reference/rate-limits | 2026-09-23 | Dunamu, Korea | groups, limits, `remaining-req`, 429 and 418, section 6 |
| S8 | API 공통 문의, CORS and `Origin` | https://docs.upbit.com/kr/docs/faq-api | 2026-09-23 | Dunamu, Korea | the `origin` group, section 6 |
| S9 | REST API 사용 및 에러 안내, page updated 2026-08-31 | https://docs.upbit.com/kr/reference/rest-api-guide | 2026-09-23 | Dunamu, Korea | endpoint, error shape, gzip, sections 6 and 8 |
| C1 | CCXT 4.5.68 `upbit.js` | `server/node_modules/ccxt/js/src/upbit.js` | 2026-09-22 | CCXT | sections 2 and 6 |
| R1 | `rest-probe.mjs host`, `catalog`, `ticker`, `book`, `errors` at 03:14 to 03:15 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| R2 | `rest-probe.mjs time` at 03:15 UTC and `book` at 03:24 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 5 and 7 |
| R3 | `rest-probe.mjs all`, second pass at 03:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7, second reading |
| R4 | `rest-probe.mjs ticker` with the turnover sums, at 03:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit/rest-probe.mjs) | 2026-09-23 UTC | this host | 24 h turnover per market, section 2 |
| D1 | `dig api.upbit.com` at 03:06 UTC, and `dig` and `curl` of `ubcindex.com` and `www.ubcindex.com` | none | 2026-09-23 UTC | this host | section 1 and the UBCI site in section 3 |
