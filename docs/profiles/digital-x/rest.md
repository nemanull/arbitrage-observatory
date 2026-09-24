# Digital X REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:25 to 03:40 UTC, from the development host near Seattle.

This profile covers the public REST API v2 of Digital X, formerly Korbit, which serves KRW spot markets only.
Digital X lists no perpetual, see [`fees.md`](./fees.md) section 3, so this is the spot profile of template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/digital-x/rest-probe.mjs), run in full twice, P1 and P2, and its `catalog` mode a third time, P3.
The documentation is the Open API v2 reference and its agent bundle, S1 and S2.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api.digitalx.miraeasset.com`, S1 |
| former base URL | `https://api.korbit.co.kr`, which "still serves the same API", S2. `/v2/time` answered 200 there in 179.8 and 171 ms cold |
| resolved addresses | `104.18.26.84` and `104.18.27.84`, plus `2606:4700::6812:1a54` and `2606:4700::6812:1b54`, Cloudflare. `ws-api.digitalx.miraeasset.com` resolves to the same addresses. The former host resolves to five `104.16.218.102` to `104.16.222.102` addresses |
| edge | every reply carries `server: cloudflare` and `cf-cache-status: DYNAMIC` |
| cold `GET /v2/time`, a new TCP and TLS connection each, 20 calls | min 164.8 and 165.4 ms, median 190.4 and 208.3 ms, p90 433.3 and 454.3 ms, max 448.9 and 464.3 ms |
| warm `GET /v2/time` on one kept-alive connection, 20 calls | min 137.5 and 138.4 ms, median 140.3 and 142.8 ms, p90 240.3 and 154.4 ms, max 257.7 and 180.4 ms |
| warm bulk `GET /v2/tickers`, 30 polls | median 268.3 and 266.1 ms, max 279.7 and 299.5 ms, section 4 |

Access from this host was open.
Every documented public call answered 200, and no page, API or socket refused this host.
A signed call without a signature answered 400 `NO_TIMESTAMP`, section 6.

## 2. Catalog

### The instruments call

`GET /v2/currencyPairs` returns every pair with `symbol`, `status`, `baseCurrency`, `quoteCurrency`, `minOrderValue` and `maxOrderValue`, S1.

| run | rows | `launched` | `stopped` | quote | bytes | reply |
|---|---:|---:|---:|---|---:|---|
| P1 | 227 | 193 | 34 | `krw` on all 227 | 31,122 | 147.4 ms |
| P2 | 227 | 193 | 34 | `krw` on all 227 | 31,122 | 150.9 ms |

The documented status values are `launched`, "trading available", and `stopped`, "trading unavailable", S1.
Every `symbol` is `<baseCurrency>_<quoteCurrency>` in lower case, and the 227 symbols and 227 bases are unique, P3.
So no pair is listed twice and no base trades against two quotes.
The reply carries `cache-control: public, max-age=60, stale-while-revalidate, max-stale=120`.

```json
{"symbol":"btc_krw","status":"launched","baseCurrency":"btc","quoteCurrency":"krw","minOrderValue":"5000","maxOrderValue":"1000000000"}
```

`GET /v2/currencies` lists 208 coins with deposit and withdrawal status, networks and `withdrawalTxFee`, in 120,407 bytes, P1 and P2.

### How the engine's catalog would map it

There is no CCXT class, see [`fees.md`](./fees.md) section 8, so the connector's `loadMarkets` path cannot build this catalog.
A hand written catalog would take `rawMarketId` from `symbol`, which is exactly the spelling of the ticker's `symbol` on all 227 pairs and of the socket's `symbol` on the 193 launched pairs it served.
`base` and `quote` are the upper case of `baseCurrency` and `quoteCurrency`.
Sizes are base coins, so a contract size of 1 is the right value, see [`websocket.md`](./websocket.md) section 4.
Every market is spot, and none is `linear` or a swap, so the connector's swap filter would keep none.
The quote is KRW, which [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6 does not map to the USDT family, so a KRW market would never cluster with a USDT perpetual of the same coin.

### Volume and activity

The bulk ticker's `quoteVolume` over the launched pairs summed to 96,791, 97,011 and 97,061 million KRW in P1 to P3.
`usdt_krw` alone was 69,984, 70,254 and 70,240 million of that, followed by `xrp_krw`, `btc_krw`, `eth_krw` and `wld_krw`.
60 or 61 launched pairs showed zero 24 h volume.
The 34 stopped pairs show `bestBidPrice` and `bestAskPrice` of `"0"`, and no launched pair did.
`usdt_krw` closed at 1,343 KRW in all three runs.

## 3. Anchor

Digital X publishes no index, no mark price and no funding rate, because it lists no perpetual.
No call returns any `AnchorRow` column.

| `AnchorRow` column | field | note |
|---|---|---|
| `index` | none | no index or reference price exists in the API, S1 |
| `mark` | none | |
| `fundingRate` | none | |
| `fundingIntervalHours` | none | |
| `nextFundingAt` | none | |

The only bulk price call is `GET /v2/tickers`, whose rows carry `open`, `high`, `low`, `close`, `prevClose`, `priceChange`, `priceChangePercent`, `volume`, `quoteVolume`, `bestBidPrice`, `bestAskPrice` and `lastTradedAt`, S1 and P1.
`close` is the last trade and the best prices come without sizes.
The venue's own `usdt_krw` and `usdc_krw` books are its only KRW to dollar stablecoin prices, and they are ordinary spot books, not an index.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

The bulk ticker was polled once a second for 30 polls in each run, as the closest thing to an anchor poll.

| measure | P1 | P2 |
|---|---|---|
| reply time | min 264.1, median 268.3, p90 273.7, max 279.7 ms | min 142.6, median 266.1, p90 271.8, max 299.5 ms |
| reply size | 60,040 to 60,051 bytes, 227 rows | 60,075 to 60,088 bytes |
| rows whose best bid, best ask or last changed between polls | min 7, median 20, p90 31, max 38 | min 15, median 40, p90 53, max 62 |
| `usdt_krw` changes in 29 intervals | bid 0, ask 0, last 2 | bid 3, ask 1, last 0 |
| `btc_krw` changes in 29 intervals | bid 20, ask 2, last 0 | bid 12, ask 13, last 2 |

`GET /v2/tickers?symbol=btc_krw,eth_krw` returns only those rows, 2 rows in 633 and 634 bytes.
An unknown symbol returns 200 with an empty `data` array, section 6.

## 5. REST book snapshot

`GET /v2/orderbook?symbol=<symbol>` returns `timestamp`, `bids` and `asks`, each level `{"price", "qty"}` as strings, S1.

| request | P1 and P2 |
|---|---|
| `symbol=btc_krw` | 30 bids and 30 asks, about 2.5 KB, 140.3 and 142.1 ms |
| `symbol=btc_krw&limit=5`, `limit=100` or `depth=100` | still 30 and 30, the undocumented parameters are ignored |
| `symbol=usdt_krw` | 30 and 30 |
| `symbol=klay_krw`, a stopped pair | 200, empty `bids` and `asks`, 71 bytes, `timestamp` 677,181,884 and 677,754,179 ms old, 7.8 days |
| `symbol=eth_krw&level=100000` | 30 grouped levels per side at 100,000 KRW steps, each with `amt`, the quote amount |
| `symbol=btc_krw&level=7` | 400 `BAD_REQUEST` |

Bids are descending and asks ascending, best first, on every read.
The stopped book's 7.8 day old `timestamp` shows that it is the time of the last book change, not of the reply.
It was 304 to 879 ms old on `btc_krw` and 588 and 1,142 ms old on `usdt_krw`.
The reply carries `cache-control: no-store`.
Ten reads of `btc_krw` about 340 ms apart returned 8, 9 and 6 distinct timestamps in three runs, which matches a book that did not change between some reads rather than a cache.
The REST book equalled the socket's last frame level for level on four of four comparisons, see [`websocket.md`](./websocket.md) section 4.

`GET /v2/tickSizePolicy?symbol=btc_krw` lists the tick ladder, from `0.0001` below 1 KRW to `1000` from 1,000,000 KRW, and the grouping levels in `orderbookLevels`, P1.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | "50 req/sec per IP", S2 | not approached |
| headers | `Ratelimit: limit=50, remaining=48, reset=1` and `Ratelimit-Policy: 50;w=1`, and `Retry-After` with 429, S2 | `ratelimit: limit=50, remaining=49, reset=1` and `ratelimit-policy: 50;w=1` on every quotation call, absent on `/v2/time`, on a 404 and on the signed `/v2/tradingFeePolicy` |
| sequential use | | five calls in a row on one connection all read `remaining=49` |
| concurrent use | | ten concurrent calls on new connections read `remaining` 47 to 49 in one run and 45 to 49 in the other, all 200 |
| on 429 | "pause until `Retry-After` or the `Ratelimit` reset window", S2 | no 429 was provoked |

Error replies have the shape `{"success": false, "error": {"code": <HTTP status>, "message": "<CODE>"}}`.

| request | status | body |
|---|---|---|
| `GET /v2/orderbook` without `symbol` | 400 | `{"success":false,"error":{"code":400,"message":"BAD_REQUEST"}}` |
| `GET /v2/orderbook?symbol=nope_krw` | 400 | `{"success":false,"error":{"code":400,"message":"INVALID_CURRENCY_PAIR"}}` |
| `GET /v2/orderbook?symbol=BTC_KRW` | 400 | `INVALID_CURRENCY_PAIR`, symbols are case sensitive |
| `GET /v2/orderbook?symbol=btc_krw&level=7` | 400 | `BAD_REQUEST` |
| `GET /v2/nope` | 404 | `{"success":false,"error":{"code":404,"message":"NOT_FOUND"}}` |
| `GET /v2/tickers?symbol=nope_krw` | 200 | `{"success":true,"data":[]}` |
| `GET /v2/tradingFeePolicy`, unsigned | 400 | `{"success":false,"error":{"code":400,"message":"NO_TIMESTAMP"}}` |

Announcements, including maintenance and deposit or withdrawal suspensions, come from the public `GET /v2/notices`, which returned the 20 newest with `title`, `createdAt`, `updatedAt` and `url`, P3.
Every `url` still pointed at `www.korbit.co.kr`, which answered a notice URL with 302 to the same path on `digitalx.miraeasset.com` in a manual curl at 03:40 UTC.
Market warnings come from the public `GET /v2/marketAlerts`, which listed one pair, `doge_krw`, with a `concentration` warning, P1 to P3.

## 7. Server time and clock offset

`GET /v2/time` returns `{"success":true,"data":{"time":1790133963596}}`, Unix ms, S1 and P1.
Over 20 warm calls, server time minus the local midpoint of each call was median 3 ms, min -28 and max 55 ms in P1, and median 5 ms, min 1 and max 23 ms in P2.
So this host's clock was within a few milliseconds of the venue's.
Signed calls reject a timestamp more than 1,000 ms ahead of the server, S2, which matters only for a later execution stage.

## 8. Recommended poller shape

None.
Digital X has no index, mark or funding, so there is nothing for an anchor poller to read, and it cannot join the engine as a perpetual leg.

| item | recommendation | reason |
|---|---|---|
| anchor poller | do not build one | section 3 |
| catalog refresh, if spot legs are ever added | `GET /v2/currencyPairs`, keep `status` `launched` | the reply allows caching for 60 s, and stopped pairs serve empty books |
| book | the WebSocket `orderbook` channel, not REST | the socket frame and the REST book are identical, and the socket sends every change |
| rate limit pause | `Retry-After` when present, else 1,000 ms | the documented window is one second |

A KRW spot leg would also need a KRW to USD rate before its prices could be compared with any perpetual, and the venue's own `usdt_krw` book is a candidate for that, but that is a design question outside this survey.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Digital X Open API LLM guide: `introduction.md`, `rest_api/quotation.md`, `rest_api/other.md` | https://docs.digitalx.miraeasset.com/llms.txt | 2026-09-22 | Digital X | base URL, schemas of `currencyPairs`, `tickers`, `orderbook`, `tickSizePolicy`, `time`, status values, sections 1 to 5 and 7 |
| S2 | Digital X Open API v2 reference and `rest_api.md` of the guide | https://docs.digitalx.miraeasset.com/index_en.html | 2026-09-22 | Digital X | former host, rate limit table and headers, 429 rule, timestamp window, sections 1, 6 and 7 |
| P1 | `rest-probe.mjs all` at 03:25 to 03:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digital-x/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs all` at 03:35 to 03:36 UTC, and `book` alone at 03:28 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digital-x/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7, the second readings, the concurrent rate limit reading |
| P3 | `rest-probe.mjs catalog` at 03:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digital-x/rest-probe.mjs) | 2026-09-23 UTC | this host | unique symbols and bases, notices, sections 2 and 6 |
