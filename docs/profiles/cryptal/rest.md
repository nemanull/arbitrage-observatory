# Cryptal REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific, which is 2026-09-23 from 04:44 to 04:56 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which geolocates to Canada.

Cryptal lists no perpetual, so this profile covers the public spot REST API, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
The API reference is an OpenAPI 3.0.1 file served at `https://api.cryptal.com/openapi.json` and rendered at `https://api.cryptal.com/`, S1.
It documents six public GET calls under `https://exchange.cryptal.com/exchange/api/v1/public`: `pairs`, `currencies`, `ticker`, `allMarketsSummery`, `orderbook/{pair}` and `trades/{pair}`.
Every reading below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/cryptal/rest-probe.mjs) in two runs of each mode, at no more than two requests per second.

## 1. Host and latency from this machine

| host | resolved | where | source |
|---|---|---|---|
| `exchange.cryptal.com`, the REST API | `3.78.135.93` and `18.196.190.233` | `ec2-3-78-135-93.eu-central-1.compute.amazonaws.com` and `ec2-18-196-190-233.eu-central-1.compute.amazonaws.com`, AWS Frankfurt, no CDN | P1, D1 |
| `wss.cryptal.com`, the web client's socket | the same two addresses | same | [`websocket.md`](./websocket.md) section 1 |
| `api.cryptal.com`, the API reference | CloudFront | `x-amz-cf-pop: SEA900-P9`, `x-cache: RefreshHit from cloudfront` | D1 |
| `cryptal.com`, the website | `143.204.160.77`, `.79`, `.87`, `.102` | `server-143-204-160-87.sea90.r.cloudfront.net` | D1 |

Every API reply carried `server: istio-envoy` and `cache-control: no-cache, no-store, max-age=0, must-revalidate`, and a `GET /pairs` read with curl also carried `x-powered-by: Undertow/1`, D1.

| call | reply | first request, new connection | warm, 3 requests per run |
|---|---|---|---|
| `GET /pairs` | 81,884 bytes | 750 and 783 ms | 157 to 161 ms |
| `GET /currencies` | 9,551 bytes | 154 and 158 ms, connection reused | 153 to 159 ms |
| `GET /ticker` | 21,474 and 21,476 bytes | 159 and 163 ms | 156 to 178 ms |
| `GET /allMarketsSummery` | 117,567 and 117,569 bytes | 159 and 163 ms | 159 to 164 ms |
| `GET /orderbook/BTC-USD` | 4,245 bytes | 154 ms both runs | 154 to 156 ms |
| `GET /trades/BTC-USD?limit=5` | 586 bytes | 157 and 160 ms | 157 to 161 ms |

Over 60 one second rounds per run, `GET /ticker` took a median of 160 and 161 ms, a p90 of 165 and 174 ms and a maximum of 632 and 634 ms, and `GET /orderbook/BTC-USD?limit=25` a median of 154 ms, a p90 of 157 and 162 ms and a maximum of 466 and 445 ms, with no reply over 1 s, P3.
The round trip to Frankfurt from this host is about 150 ms, and curl saw `x-envoy-upstream-service-time` of 5 and 7 ms, so the server adds only a few milliseconds, D1.

## 2. Catalog

### The instruments call

`GET /api/v1/public/pairs` returns an array of 81 rows with 42 fields each, P1.
Trimmed to the fields that matter:

```json
{"pair":"BTC-USD","pairDisplayName":"BTC-TOUSD","baseCurrency":"BTC","quoteCurrency":"USD","quoteCurrencyDisplayCode":"TOUSD","quoteCurrencyName":"TOL Dollar ($)","baseScale":"6","quoteScale":"2","minSize":"0.000001","minCost":"5","maxSize":"9000","takerFee":"0.0025","makerFee":"0.0025","orderTypes":["MARKET","LIMIT_ORDER"],"tradeEnabled":true}
```

The only status field is `tradeEnabled`.

| quote, as the API and the website spell it | `tradeEnabled` true | false |
|---|---:|---:|
| `USD`, shown as `TOUSD` | 27 | 1 |
| `GEL`, shown as `TOGEL` | 28 | 2 |
| `EUR`, shown as `TOEUR` | 8 | 1 |
| `BTC` | 5 | 8 |
| `USDT` | 1, `BTC-USDT` | 0 |
| total | 69 | 12 |

The 12 disabled pairs on 2026-09-23 UTC were `AXS-BTC`, `CHZ-BTC`, `DOGE-BTC`, `EUR-GEL`, `GRT-BTC`, `LINK-BTC`, `MATIC-USD`, `MATIC-GEL`, `MATIC-BTC`, `POL-EUR`, `UNI-BTC` and `XLM-BTC`, identical in both runs.

`GET /currencies` lists 31 currencies, P1.
`USD`, `GEL` and `EUR` are named "TOL Dollar ($)", "TOL Lari (₾)" and "TOL Euro (€)", carry `displayCode` `TOUSD`, `TOGEL` and `TOEUR`, have `types` `FIAT` and `CRYPTO`, and list one network, `BEP20`.
So a `USD` quote on Cryptal is the TOUSD balance, which the fees page also offers as a BEP20 wallet transfer, and not a bank dollar or a major stablecoin.
On 2026-09-23 UTC `USDT-USD` was bid 0.9901 and offered 0.9960 in both runs, so USDT traded under one TOUSD.
The engine's quote family treats USD, USDC and USDT as one settlement family, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), and a TOUSD quote would need its own decision before it joined that family.

`GET /allMarketsSummery` returns `tickers` with 69 rows and `pairs` with 95 rows, P1.
Fourteen of the 95 are absent from `GET /pairs`: `BTC-DAI`, `BUSD-EUR`, `BUSD-USD`, `BUSD-GEL`, `DAI-USD`, `DAI-GEL`, `FTN-USD`, `FTN-EUR`, `FTN-GEL`, `LUNC-GEL`, `LUNC-USD`, `LUNC-BTC`, `TON-USD` and `TON-GEL`.
So `GET /pairs` is the catalog, and `allMarketsSummery.pairs` also carries retired pairs.

### How CCXT 4.5.68 maps it

It does not, because CCXT has no Cryptal class, see [`fees.md`](./fees.md) section 8.
The fields a CCXT class would need are all present.

| engine field | Cryptal field | note |
|---|---|---|
| `rawMarketId` | `pair`, `BTC-USD` | uppercase with a hyphen. `btc-usd` and `BTC_USD` answer `gex.validate.unknown_pair`, section 6. The website shows `pairDisplayName`, `BTC-TOUSD`, which the API does not accept as an id |
| `base`, `quote` | `baseCurrency`, `quoteCurrency` | `USD` means TOUSD, see above |
| `contractSize` | none | spot, so 1, and the book `volume` is in the base currency, section 5 |
| `linear` | none | not applicable to spot |
| `active` | `tradeEnabled` | |

No pair is listed twice.
A base is quoted in several currencies, and `BTC-USD` and `BTC-USDT` would both fall in the USD family, so a spot stage would pick one with `marketFilter`.

## 3. Anchor

Cryptal publishes no index price, no mark price and no funding rate, because it lists no perpetual.
No call in S1 and no field in any public reply carries one.
The only reference prices are the ticker's `lastTradePrice`, `bidPrice` and `askPrice` and the book itself, all of which are Cryptal's own spot market and none of which is an index of other venues.

`GET /ticker` returns one row per tradable pair, 69 rows in 21.5 KB, and `GET /ticker?pair=BTC-USD` returns a one row array, P2.

```json
{"pair":"BTC-USD","pairDisplayName":"BTC-TOUSD","minPrice":"84748.49","maxPrice":"86784.21","askPrice":"87950.00","bidPrice":"85391.35","baseVolume":"0.868487","quoteVolume":"74435.29","lastTradePrice":"86751.38","lastTradeVolume":"0.003390","openPrice":"85700.36","priceChange":"1.96","tradeCount":286,"timestamp":0}
```

`timestamp` was 0 on all 69 rows in both runs, so the ticker carries no time.
Its `bidPrice` and `askPrice` equalled the book's best bid and ask on `BTC-USD`, `ETH-USD` and `XRP-USD` in both runs, P2.

No anchor poller is recommended, see section 8.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

How often the spot numbers changed over 60 one second polls per run, P3:

| number | run at 04:49 UTC | run at 04:54 UTC |
|---|---:|---:|
| `BTC-USD` ticker bid, ask, last | 0, 0, 0 | 0, 0, 0 |
| `ETH-USD` ticker bid, ask, last | 1, 1, 0 | 0, 0, 1 |
| `XRP-USD` ticker bid, ask, last | 3, 5, 0 | 1, 1, 0 |
| `USDT-USD` ticker bid, ask, last | 0, 0, 0 | 0, 0, 0 |
| `BTC-USD` book, all 25 levels a side | 0 | 0 |

The `BTC-USD` quote held still for a minute at a time in both runs, and its last trade did not change.
CoinGecko's `BTC/USD` row for Cryptal showed 24 h volume of about 75,558 US dollars, and the ticker's `tradeCount` for `BTC-USD` was 286 in both runs.

## 5. REST book snapshot

`GET /api/v1/public/orderbook/{pair}?limit=<n>`, S1.
The reference says "limits:[25, 100]" with a default of 100, and the wire agrees: 25 and 100 work, and 0, -1, 5 and 1000 answer 500 `gex.validate.invalid_order_book_depth`, P2.

```json
{"timestamp":1790139216136,"bids":[{"price":"85391.35","volume":"0.007297","totalCost":"623.10"},{"price":"85254.72","volume":"0.009850","totalCost":"839.76"}],"asks":[{"price":"87950.00","volume":"0.200000","totalCost":"17590.00"},{"price":"88007.15","volume":"0.004003","totalCost":"352.29"}]}
```

| pair | `limit=25` bids, asks | `limit=100` or none, bids, asks | best bid, best ask, run 1 | run 2 |
|---|---|---|---|---|
| `BTC-USD` | 25, 25 | 29, 37 | 85,442.69, 87,950.00 | 85,391.35, 87,950.00 |
| `ETH-USD` | 25, 25 | 26, 28 | 2,728.26, 2,811.98 | 2,725.43, 2,810.35 |
| `XRP-USD` | 25, 25 | 25 or 26, 36 or 37 | 1.62332, 1.67032 | 1.61235, 1.66184 |
| `USDT-USD` | 25, 25 | 33, 34 | 0.9901, 0.9960 | 0.9901, 0.9960 |

| property | reading |
|---|---|
| level order | bids descending and asks ascending on every reply of both runs |
| level shape | `{price, volume, totalCost}`, all decimal strings |
| size unit | base currency. `price` times `volume` equalled `totalCost` within half a cent on all 232 `BTC-USD` levels of four captures, and within rounding on every level of the other pairs |
| depth | no book reached 40 levels a side, so `limit=25` returns the quoting ladder and `limit=100` adds a few distant orders |
| `timestamp` | Unix ms of the reply, not of the last change. It changed between every two consecutive polls of 60 while the levels did not change, and it read 72 to 100 ms old on arrival, about half the round trip, P3 |
| caching | none. `cache-control: no-cache`, and each reply carries a new `timestamp` |

The `BTC-USD` book is a quoting ladder.
In the captures of both runs the first 25 bids were spaced exactly 1,600 ppm apart, and the asks after the second level 1,400 ppm apart, with a resting 0.2 BTC ask at the round price 87,950.00.
The levels beyond the ladder are far away, one of them a bid under 0.1 % of the price of the bid before it.

The spread is wide on every pair, from the ticker bid and ask of all 69 tradable pairs, P1:

| run | narrowest | median | p90 | widest | pairs under 10,000 ppm |
|---|---|---:|---:|---|---:|
| 04:48 UTC | `ETH-BTC` 2,004 ppm | 33,166 ppm | 37,099 ppm | `AXS-USD` 44,053 ppm | 8 |
| 04:53 UTC | `ETH-BTC` 2,318 ppm | 32,972 ppm | 37,079 ppm | `AXS-USD` 53,097 ppm | 8 |

`BTC-USD` read 28,921 and 29,522 ppm, `BTC-USDT` 6,033 and 5,762 ppm, `USDT-USD` 5,941 ppm, and `BTC-EUR` 35,482 and 35,548 ppm.
Buying at the ask and selling at the bid on Cryptal alone gives up about 30,000 ppm before two taker fees of 2,500 ppm each.

## 6. Rate limits and errors

No rate limit is documented in S1.
Every REST reply carried a token bucket header set, P1:

```text
x-ratelimit-burst-capacity: 20
x-ratelimit-replenish-rate: 20
x-ratelimit-requested-tokens: 1
x-ratelimit-remaining: 19
```

The socket upgrade carried the same set with 10 and 10, see [`websocket.md`](./websocket.md) section 5.
At two requests a second `x-ratelimit-remaining` never fell below 17 in the catalog runs or 18 in the poll runs.
The limit was not provoked, so the status code, body and `Retry-After` of a refusal are Not verified.

S1 documents 200, 400, 401, 403, 404 and 500, and an error body of `errorKey`, `errorType`, `errorMessage`, `params` and `transParams`, with the example key `validate.unknown_pair`.
The wire prefixes the key with `gex.` and answers with 500 where the table suggests 400 or 404, P2:

| request | status | body |
|---|---|---|
| `GET /orderbook/NOPE-USD`, `/orderbook/btc-usd`, `/orderbook/BTC_USD`, `/ticker?pair=NOPE-USD`, `/trades/NOPE-USD` | 500 | `{"errorKey":"gex.validate.unknown_pair","errorType":"ERROR","errorMessage":"Unknown pair","params":null,"transParams":null}` |
| `GET /orderbook/BTC-USD?limit=0`, `-1`, `5` or `1000` | 500 | `gex.validate.invalid_order_book_depth`, "Invalid order book depth" |
| `GET /orderbook/BTC-USD?limit=abc`, `GET /time`, `GET /serverTime` | 500 | `{"errorKey":"gex.error.general","errorType":"ERROR","errorMessage":"General error"}` |
| `GET /orderbook/XLM-BTC`, a disabled pair, at any limit | 403 | empty, `content-length: 0`, from behind the same envoy |
| `GET /trades/XLM-BTC` | 200 | `[]` |

The engine's anchor poller pauses on 403, see `server/src/feeds/anchor/AnchorPoller.ts`, so a poller that read one book per pair would pause on a disabled pair.

## 7. Server time and clock offset

No server time call exists.
`GET /time` and `GET /serverTime` answer 500 `gex.error.general`, P2.
From the one second `Date` header of ten `GET /currencies` replies, the server clock minus the local clock lay between -241 and +98 ms, P1 run 2.
The book `timestamp` read 72 to 100 ms old on arrival against a round trip of about 150 ms, which fits a clock within a few tens of milliseconds of this host, P3.
The first catalog run printed an offset of -12,138 ms because the probe then compared a stale `Date` with the clock 11 s later, and the probe was fixed before the second run.

## 8. Recommended poller shape

No anchor poller is recommended.
Cryptal has no index, mark or funding for a poller to read, and no perpetual for the engine to anchor.

If a spot stage ever adds Cryptal:

| item | recommendation | reason |
|---|---|---|
| top of book for every pair | `GET https://exchange.cryptal.com/exchange/api/v1/public/ticker` once a second | 69 pairs in one 21.5 KB reply with a median of 160 ms, and its bid and ask equalled the book's |
| depth | `GET .../orderbook/{pair}?limit=25` | 25 levels cover the engine's 20, and 100 adds only distant orders |
| budget | at most 20 requests a second from the headers, so one book per pair every second is out of reach for 69 pairs | a full book round takes about 3.5 s at the full budget |
| skip | pairs with `tradeEnabled` false | their book answers 403 |
| key | `pair` | the id the book and ticker accept |
| receive time | stamp on arrival | the ticker has no time and the book `timestamp` is the reply time |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Cryptal Exchange API, OpenAPI 3.0.1, "Base URL: https://exchange.cryptal.com/exchange", Last-Modified 2023-03-28 | https://api.cryptal.com/openapi.json, rendered at https://api.cryptal.com/ | 2026-09-23 UTC | Cryptal | the six public calls, `limit` values, status code table, error body, sections 2 to 7 |
| D1 | `dig`, `dig -x` and `curl -D -` on the four hosts | command line | 2026-09-23 UTC | this host, Canadian VPN exit | addresses, AWS and CloudFront names, headers, section 1 |
| P1 | `rest-probe.mjs catalog`, runs at 04:48 and 04:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptal/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | latency, catalog, currencies, spreads, rate limit headers, clock offset, sections 1 to 3, 5 to 7 |
| P2 | `rest-probe.mjs book`, runs at 04:49 and 04:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptal/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | depth limits, level order, ticker against book, error replies, sections 3, 5 and 6 |
| P3 | `rest-probe.mjs poll`, runs at 04:49 and 04:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptal/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | poll times, change counts, book `timestamp` age, sections 1, 4, 5 and 7 |
| S2 | CoinGecko exchange API for Cryptal | https://api.coingecko.com/api/v3/exchanges/cryptal | 2026-09-23 UTC | CoinGecko | `BTC/USD` 24 h volume, section 4 |
