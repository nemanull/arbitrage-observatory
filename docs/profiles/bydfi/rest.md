# BYDFi REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:12 to 20:51 Pacific time (2026-09-23 03:12 to 03:51 UTC), from the development host near Seattle.

This profile covers the public futures REST API of BYDFi (CCXT id `bydfi`) for every perpetual family.
BYDFi replaced its trading system on 2026-09-22, see [`fees.md`](./fees.md), and the documented API stopped answering the same day.
Section 1 records what the documented API returned, and the rest of the profile records the contract API the new platform serves on the same host.
That API has the paths and reply shapes of MEXC's contract API, see [`../mexc/rest.md`](../mexc/rest.md), and BYDFi publishes no documentation for it.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bydfi/rest-probe.mjs), P1, unless a source id says otherwise.

## 1. Host and latency from this machine

### The documented API

The documentation site listed `https://api.bydfi.com/api` for REST and `wss://stream.bydfi.com/v1/public/fapi` for the socket, S1, and CCXT 4.5.68 uses the same two, at `server/node_modules/ccxt/js/src/bydfi.js` line 192 and `server/node_modules/ccxt/js/src/pro/bydfi.js` line 48.
The Wayback Machine holds copies of the documentation from 2026-04-22 and 2026-09-18, and the 2026-09-18 copy still names those two URLs, S1.

| host | DNS on 2026-09-22 | result |
|---|---|---|
| `developers.bydfi.com` | no A record, answer NOERROR with an empty answer section, from the system resolver, 1.1.1.1 and 8.8.8.8 | the documentation cannot be reached, and a fetch from outside this host failed with `ENOTFOUND` too |
| `stream.bydfi.com` | no A record, only a TXT record `"v=spf1 include:zohomail.com -all"` | the documented socket cannot be opened, see [`websocket.md`](./websocket.md) section 1 |
| `api.bydfi.com` | CNAME `api.bydfi.com.cdn.cloudflare.net`, 104.18.12.14 and 104.18.13.14 | answers, behind Cloudflare, edge `SEA` or `YVR` in `cf-ray` |
| `futures.bydfi.com` | Cloudflare, 104.18.12.14 and 104.18.13.14 | answers, the host the web app calls |

Every documented public path on `api.bydfi.com` returned HTTP 404 with the body `{"code":404,"msg":"Not Found"}` and `content-type: application/json`.

| documented path under `https://api.bydfi.com/api/` | status |
|---|---|
| `v1/public/api_limits`, as CCXT spells it at `bydfi.js` line 203 | 404 |
| `v1/public/api_limit`, as the documentation spells it, S1 | 404 |
| `v1/fapi/market/exchange_info` | 404 |
| `v1/fapi/market/depth?symbol=BTC-USDT` | 404 |
| `v1/fapi/market/ticker/24hr` | 404 |
| `v1/fapi/market/mark_price?symbol=BTC-USDT` | 404 |
| `v1/fapi/market/funding_rate` | 404 |
| `v1/fapi/market/funding_rate_history?symbol=BTC-USDT` | 404 |

`new ccxt.bydfi().loadMarkets()` throws `ExchangeError: bydfi {"code":404,"msg":"Not Found"}`.
The 404 is not a geoblock.
The same host answers the new paths below with HTTP 200 to this host, and no reply carried a region notice.

### The API the new platform serves

| call | status | size | time |
|---|---|---:|---|
| `https://api.bydfi.com/api/v1/contract/ping` | 200 | 46 B | 115 to 142 ms warm |
| `https://api.bydfi.com/api/v1/contract/detail` | 200 | 616,747 B | 217 to 322 ms |
| `https://futures.bydfi.com/api/v1/contract/detail` | 200 | 616,747 B | 489 to 536 ms |
| `https://api.bydfi.com/api/v3/ping`, spot | 200 | `{}` | 110 to 121 ms |
| `https://api.bydfi.com/api/v3/time`, spot | 200 | `{"serverTime":…}` | 109 to 134 ms |

The first request to each host from `curl` took 0.34 to 0.69 s, and later requests on a kept-alive connection took 110 to 145 ms.
`futures.bydfi.com` and `https://www.bydfi.com/api/platform/futures/` serve the same contract calls.
`api.bydfi.com` returned the catalog in 217 to 322 ms against 489 to 536 ms from `futures.bydfi.com`, so this profile uses `api.bydfi.com`.
The web app's own bundle names `https://futures.<domain>` and `wss://futures.bydfi.com/edge`, and it was the lead to these paths.

## 2. Catalog

### The instruments call

`GET https://api.bydfi.com/api/v1/contract/detail` returns every contract in one reply of 616,747 bytes, `{"success":true,"code":0,"data":[…]}`.

| family | `quoteCoin` / `settleCoin` | contracts | `state` |
|---|---|---:|---|
| USDT-M | `USDT` / `USDT` | 255 | 0 on all |
| USDC-M | `USDC` / `USDC` | 3 | 0 on all |
| coin-M | `USD` / the base coin | 8 | 0 on all |

`futureType` 1, `type` 1, `apiAllowed` true and `isHidden` false held on all 266, and no contract had `preMarket` true.
The status values other than 0 are not listed anywhere BYDFi publishes, so the recommended poller keeps only `state` 0.

### How CCXT 4.5.68 maps it

The `bydfi` class reads the retired `exchange_info` call at `bydfi.js` line 406 and loads nothing, section 1.
The `mexc` class parses this reply unchanged once every `https://api.mexc.com` in its `urls.api` is replaced by `https://api.bydfi.com`.
Its spot URL then becomes `https://api.bydfi.com` and its contract URL `https://api.bydfi.com/api/v1/contract`, and `loadMarkets` returned 153 spot and 266 swap markets.

| field | CCXT `mexc` source | `BTC_USDT` | `ETH_USDT` | `BTC_USDC` | `BTC_USD` |
|---|---|---|---|---|---|
| `id` | `symbol` | `BTC_USDT` | `ETH_USDT` | `BTC_USDC` | `BTC_USD` |
| `symbol` | | `BTC/USDT:USDT` | `ETH/USDT:USDT` | `BTC/USDC:USDC` | `BTC/USD:BTC` |
| `contractSize` | `contractSize`, `mexc.js` line 1467 | 0.0001 | 0.01 | 0.0001 | 1 |
| `linear` | settle equals quote | true | true | true | false |
| `active` | `state === '0'`, `mexc.js` line 1461 | true | true | true | true |
| `taker` | `takerFeeRate`, `mexc.js` line 1465 | 0.0006 | 0.0006 | 0.0006 | 0.0006 |

`market.id` is spelled exactly as the socket's `symbol` and as the `symbol` of the bulk ticker and funding replies.
The detail, ticker and funding replies each held the same 266 ids, with none missing from any of them.
The old spelling `BTC-USDT` is refused by the new API with `{"success":false,"code":1001,"message":"Contract does not exist"}`.

### Size unit, pairs listed twice, and price scale

`contractSize` takes nine values across the catalog: 1 on 143 contracts, 0.01 on 46, 0.1 on 42, 10 on 17, 0.001 on 10, 100 on 4, 0.0001 on 2, 1000 on `TAG_USDT` and 10000 on `TOSHI_USDT`.
The socket and REST book report sizes in contracts, and one linear contract is `contractSize` base coins, see [`websocket.md`](./websocket.md) section 4.
The coin-M contracts have `contractSize` 1 and quote in USD.
`BTC_USD` levels read 16,253 and 19,959 at a price near 86,659, which is plausible as US dollars and not as bitcoin, so the engine would read 16,253 contracts as 16,253 BTC.
That reading is an inference, and the quote family ranks the inverse contract after the USDT one anyway, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).

| base | contracts |
|---|---|
| BTC, ETH, SOL | `_USDT`, `_USDC` and `_USD` |
| XRP, ADA, DOGE, LTC, LINK | `_USDT` and `_USD` |

No contract name carried a `1000` prefix or another price scale on 2026-09-22.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time over 60 rounds |
|---|---|---|---|---|---|---|---|
| `GET https://api.bydfi.com/api/v1/contract/ticker` | `indexPrice` | `fairPrice` | `fundingRate` | absent | absent | 142,110 to 142,214 B, 266 rows | min 117 and 124, median 121 and 127, p90 138 and 134, max 477 and 395 ms |
| `GET https://api.bydfi.com/api/v1/contract/funding_rate` | absent | absent | `fundingRate` | `collectCycle`, hours | `nextSettleTime`, Unix ms | 43,539 B, 266 rows | min 117 and 112, median 123 and 116, p90 154 and 144, max 429 and 388 ms |

The first run polled `futures.bydfi.com` and the second `api.bydfi.com`, and the replies had the same fields and sizes.
No single call carries all five `AnchorRow` columns.
MEXC's `funding_rate` reply also carries `idxPrice` and `fairPrice`, which the MEXC poller reads at [`../../../server/src/venues/mexc/anchor.ts`](../../../server/src/venues/mexc/anchor.ts) line 8, and BYDFi's reply does not.
Its keys were exactly `symbol,fundingRate,maxFundingRate,minFundingRate,collectCycle,nextSettleTime,timestamp`.
The ticker's `fundingRate` equalled the funding reply's `fundingRate` on all 266 contracts.
Single contract calls exist, `index_price/{symbol}`, `fair_price/{symbol}` and `funding_rate/{symbol}`, and answered in 115 to 165 ms.

### Row mapping

| `AnchorRow` column | call and field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC_USDT` | none |
| `index` | ticker `indexPrice` | JSON number | none |
| `mark` | ticker `fairPrice` | JSON number, never 0 on 266 rows | none |
| `fundingRate` | ticker or funding `fundingRate` | JSON number, a fraction per interval, `0.000039` is 0.0039 % | none |
| `fundingIntervalHours` | funding `collectCycle` | integer hours, 8 or 4 | none |
| `nextFundingAt` | funding `nextSettleTime` | integer Unix ms | none |

At 03:35 and 03:45 UTC on 2026-09-23 the 105 contracts on 8 h read `nextSettleTime` 2026-09-23 08:00 UTC and the 161 on 4 h read 04:00 UTC.
No ticker row had a zero `indexPrice`, `fairPrice`, `bid1` or `ask1`.

## 4. Anchor semantics

### Index

The help center says the index is taken from "the mainstream spot exchanges" and lists "Binance, Okex, Coinbase, Bybit, BitStamp", S2.
The catalog disagrees for most contracts.
Each contract's `indexOrigin` names its sources, and `BTC_USDT` lists `MEXC`, `KUCOIN`, `BITGET`, `BYBIT`, `BINANCE` and `OKX`.
`BTC_USD` is the only one read that matches the help center's style, with `BYBIT`, `COINBASE`, `BITSTAMP`, `BITFINEX`, `KRAKEN`, `BINANCE` and `OKX`.

| sources per contract | contracts |
|---:|---:|
| 1 | 1 |
| 2 | 1 |
| 3 | 2 |
| 4 | 10 |
| 5 | 44 |
| 6 | 73 |
| 7 | 119 |
| 8 to 10 | 16 |

| source | contracts |
|---|---:|
| `MEXC` | 217 |
| `GATEIO` | 205 |
| `KUCOIN` | 203 |
| `BITGET` | 190 |
| `BINANCE` | 183 |
| `BYBIT` | 152 |
| `OKX` | 142 |
| `BINANCE_FUTURE` | 94 |
| `BITGET_FUTURE` | 68 |
| `BYBIT_FUTURE` | 67 |
| `GATEIO_FUTURE` | 45 |
| `OKX_FUTURE` | 42 |
| `KUCOIN_FUTURE` | 22 |
| `COINBASE` | 14 |
| `MEXC_FUTURE`, `BITSTAMP`, `KRAKEN` | 8 each |
| `BITFINEX` | 6 |
| `BINANCETICKER` | 1 |

No contract lists BYDFi itself, so the self-index shape of [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not occur.
Other venues' perpetuals do appear, and 11 contracts use only futures sources: `CL_USDT`, `XAU_USDT`, `XAG_USDT`, `BZ_USDT`, `NVDA_USDT`, `COPPER_USDT`, `DELL_USDT`, `SKHYNIX_USDT`, `LUNA2_USDT`, `NFLX_USDT` and `XPD_USDT`.
Thin baskets: `ONE_USDT` uses `BINANCE` alone, `LUNA2_USDT` two futures, `COPPER_USDT` three futures, and `SPELL_USDT` `MEXC`, `BINANCE` and `GATEIO`.
`ONE_USDT` had the largest mark premium on the venue in both runs, -14,756 and -10,302 ppm, and `ONE|USDT` is already in `DENIED_PAIRS` at [`../../../server/src/engine/cluster/clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) line 11.
The help center adds two guards, S2.
A source more than 1 % from the median of all sources gets zero weight, and when more than one source deviates by more than 5 % the median replaces the weighted average.
No public call returns the weights.

### Mark

The mark formula is Not publicly specified in the help center read on 2026-09-22.
The index article describes a "Latest Transaction Price Protection" that switches the mark to "the latest transaction price of the contract itself plus a certain limit" when the index sources fail, S2.
No clamp on the mark premium is published.
In the second run the mark sat below the index on all four contracts read, by 439 to 532 ppm on `BTC_USDT`, 158 to 385 on `ETH_USDT`, 356 to 642 on `BTC_USDC` and 211 to 523 on `BTC_USD`.
The first run read 86,676 against 86,713.9 on `BTC_USDT`, 437 ppm below.
The touch sat within 80 ppm of the mark on each of the four at the last round, for example `BTC_USDT` bid 86,750.9 and ask 86,751 against a mark of 86,750.9 and an index of 86,794.6.
So the whole book traded about 500 ppm under the BTC index that evening.
The eight largest premiums across the venue were `ONE_USDT` -14,756, `SIREN_USDT` -5,276, `NAORIS_USDT` 4,363, `MYX_USDT` 4,191, `GUN_USDT` 4,134, `CLO_USDT` 4,023, `KERNEL_USDT` -3,919 and `RECALL_USDT` 3,554 ppm in the first run.
In the second they were `ONE_USDT` -10,302, `JCT_USDT` 7,892, `CLANKER_USDT` 6,114, `NAORIS_USDT` 6,049, `CLO_USDT` 5,505, `SPACE_USDT` 4,578, `MYX_USDT` 4,399 and `EDU_USDT` 4,348 ppm.

### Funding

The formula, the interest rate and the ±2 % cap are in [`fees.md`](./fees.md) section 6.
`maxFundingRate` 0.02 and `minFundingRate` -0.02 held on all 266 contracts, and no contract sat at the cap.

### Rate across a settlement

The published rate is the upcoming one.
`BTC_USDT` published 0.000039 at 03:35 UTC and 0.000041 at 03:46 UTC, while its history shows 0.000009 settled at 00:00 UTC, P1 `history`.
The history call `GET /api/v1/contract/funding_rate/history?symbol=BTC_USDT&page_num=1&page_size=12` returns `symbol`, `fundingRate`, `settleTime` and `collectCycle`, and held 395 rows for `BTC_USDT`, 380 for `ETH_USDT`, 118 for `BTC_USDC` and 118 for `BTC_USD`.
The rows run back past the upgrade, and the 08:00 UTC settlement of 2026-09-22 is missing from each of them.
The settlement instant itself was not captured.

### How often each number changed

Over 59 intervals of one second polls, at 03:35 and at 03:45 UTC:

| contract | index changed | mark changed | funding rate changed | next settlement changed |
|---|---:|---:|---:|---:|
| `BTC_USDT` | 28 and 45 | 40 and 45 | 0 and 1 | 0 and 0 |
| `ETH_USDT` | 30 and 55 | 38 and 51 | 0 and 0 | 0 and 0 |
| `BTC_USDC` | 24 and 42 | 31 and 14 | 0 and 1 | 0 and 0 |
| `BTC_USD` | 30 and 49 | 21 and 11 | 0 and 1 | 0 and 0 |

The index changed on 24 to 55 of 59 polls and the mark on 11 to 51, well inside the reader's 10 s age limit.
The upcoming rate moved once in the second minute on three of the four contracts, in the ticker and the funding reply alike, and how often it is recomputed is Not publicly specified.

## 5. REST book snapshot

`GET https://api.bydfi.com/api/v1/contract/depth/{symbol}?limit=N`, levels `[price, size in contracts, order count]` as JSON numbers.

| `limit` | `BTC_USDT` bids | asks | bytes |
|---|---:|---:|---:|
| absent | 593 and 596 | 461 and 455 | 15,522 to 15,560 |
| 5 | 5 | 5 | 266 and 267 |
| 20 | 20 | 20 | 763 and 771 |
| 100 | 100 | 100 | 3,495 and 3,509 |
| 1000 | 593 and 594 | 461 and 456 | 15,513 to 15,560 |

Bids are descending and asks ascending on every read, and the reply carries `version` and `timestamp` in ms.
`cf-cache-status` was `DYNAMIC`.
Six reads over about two seconds returned one `version` in each run, with `timestamp` 1.2 to 2.9 s old in the first and 0.3 to 1.9 s in the second, which matches the pauses of the book itself in [`websocket.md`](./websocket.md) section 4.
The REST top 5 per side equalled the socket's full book at the same `version` on 10 of 10 levels, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| published limit for the new API | Not publicly specified | nothing found on the site |
| published limit for the retired API | 20 requests per second for market data, HTTP 510 when exceeded, per endpoint limits at `/v1/public/api_limit` | S1 |
| what this host sent | 120 requests in 60 s, two a second, twice, with no refusal | P1 `anchor` |
| rate limit headers | none, `api.bydfi.com` sent only Cloudflare and content headers, and `futures.bydfi.com` added CORS headers | P1 `limits` |
| `Retry-After` | never seen | P1 |
| unknown contract | HTTP 200 `{"success":false,"code":1001,"message":"Contract does not exist"}` | P1 `limits` |
| unknown path | HTTP 404 `{"success":false,"code":404,"message":"Not Found"}` | P1 `limits` |

MEXC reports its rate limit as code 510 inside an HTTP 200 body, see [`../mexc/rest.md`](../mexc/rest.md) section 6, and BYDFi's limit reply was not provoked, so its shape is Not verified.

## 7. Server time and clock offset

`GET https://api.bydfi.com/api/v1/contract/ping` returns `{"success":true,"code":0,"data":<Unix ms>}`.
Ten reads over two runs gave a round trip of 115 to 142 ms and a server clock 4 to 12 ms ahead of this host's midpoint.
The spot half answers `GET https://api.bydfi.com/api/v3/time` with `{"serverTime":<Unix ms>}`.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://api.bydfi.com/api/v1/contract/ticker` and `https://api.bydfi.com/api/v1/contract/funding_rate` | the ticker holds index, mark and rate, and only the funding call holds interval and next settlement |
| interval | both every 1,000 ms, sent together | medians of 116 to 127 ms, no refusal at two a second, and the index and mark move about once a second |
| lighter alternative | the ticker every second and the funding call every 60 s | the interval never changed, and `nextSettleTime` is up to a minute stale after each settlement |
| row mapping | section 3, keyed by `symbol` | |
| skip | rows whose catalog `state` is not 0 | undocumented status values |
| do not read | the catalog's `takerFeeRate` as the registry rate | it matches VIP 0 today, see [`fees.md`](./fees.md) section 9 |
| rate limit pause | the base class default, and treat a body `code` of 510 as a limit | no limit is published, and MEXC's stack uses 510 |
| deny list input | `ONE_USDT`, one source, already denied, and the 11 futures-only baskets for review | section 4 |
| host | `api.bydfi.com`, not `futures.bydfi.com` | the same replies, faster from this host |

The two bulk replies are about 186 KB a second, about 16 GB a day.
The poller cannot reuse [`../../../server/src/venues/mexc/anchor.ts`](../../../server/src/venues/mexc/anchor.ts) with a URL change, because BYDFi's `funding_rate` reply lacks the index and mark.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BYDFi API documentation, archived: "API Domain", "Request Interaction", "Public Interface", "Market Interface", "WebSocket Market Data Push", "Changelog" | https://web.archive.org/web/20260918060356/https://developers.bydfi.com/en/changelog and the other `developers.bydfi.com/en/…` captures of 2026-04-22 and 2026-09-18 | 2026-09-22 | BYDFi, global | the retired API, sections 1 and 6 |
| S2 | Help Center, Trading Mechanism, article "Index Price", dated 2026-08-18 | https://www.bydfi.com/support/futures-trading/trading-mechanism | 2026-09-22 | BYDFi, global | index sources and guards, mark protection, section 4 |
| S3 | CCXT 4.5.68 `bydfi.js`, `pro/bydfi.js` and `mexc.js` | `server/node_modules/ccxt/js/src/` | 2026-09-22 | CCXT | sections 1 and 2 |
| S4 | BYDFi futures web app page, JavaScript bundle | https://www.bydfi.com/futures/BTC_USDT | 2026-09-22 | BYDFi, global | the `futures.<domain>` and `/edge` hosts, section 1 |
| P1 | `rest-probe.mjs` modes `legacy`, `catalog`, `anchor`, `history`, `book` and `limits`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/bydfi/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 8 |
