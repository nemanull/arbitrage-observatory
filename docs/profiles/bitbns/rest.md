# BitBNS REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (04:41 to 05:23 UTC on 2026-09-23), from the development host near Seattle, through its Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST surface of BitBNS (CCXT id `bitbns`) for its one perpetual family, USDT-settled linear perpetuals, with spot only where the catalog or CCXT needs it.
The documented public REST API is spot only, S1.
The perpetual instrument list, 24 hour change and funding history below are routes of the BitBNS web app, read out of its bundles, S3, and called by [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs).
The documented perpetual API is signed, S2, and was not called.

## 1. Host and latency from this machine

| host | role | addresses | probed |
|---|---|---|---|
| `bitbns.com` | public routes, spot catalog, spot books, web app futures routes | `104.26.8.241`, `104.26.9.241`, `172.67.73.158` and three IPv6, Cloudflare | DNS in 12 and 15 ms |
| `api.bitbns.com` | keyed `v1` and `v2` API | the same three Cloudflare addresses | 403 without a key, below |
| `socket.bitbns.com`, `wsinrmv2.bitbns.com`, `wsusdtmv2.bitbns.com` | Socket.IO streams, see [`websocket.md`](./websocket.md) | the same three Cloudflare addresses | |

| call | cold | warm, 10 requests at 0.5 s | Cloudflare cache status |
|---|---|---|---|
| `GET /exchangeData/orderbook?coin=BTC&market=INR` | 303, 296 and 636 ms | median 26, 17 and 27 ms, max 58, 37 and 38 ms | `HIT` on 31 of 33, `REVALIDATED` once, `EXPIRED` once |
| `GET /order/fetchTickers` | 39, 36 and 37 ms, connection reused | median 29, 21 and 32 ms, max 51, 24 and 103 ms | `HIT` on 33 of 33 |
| `GET /futures-testnet/getInstDetails?network=mainnet` | 607, 251 and 602 ms | median 218, 196 and 214 ms, max 226, 199 and 224 ms | `DYNAMIC` on 33 of 33, so every request reaches the origin |

The figures in each cell are the runs at 04:56, 05:09 and 05:22 UTC, P2.
Cloudflare served the third run from its Seattle edge, `cf-ray` suffix `SEA` on all 33 requests, P2.
Every public route on `bitbns.com` answered 200 to this host.
`api.bitbns.com/api/trade/v1/tickers` and `/platform/status` answered HTTP 403 with `{"data":null,"status":0,"error":"invalid api key","code":401}`, which is the missing key and not a geoblock, P4.
These access results are from the Canadian VPN exit, not from a Seattle address.

## 2. Catalog

### The instruments call

| call | reply | documented |
|---|---|---|
| `GET https://bitbns.com/futures-testnet/getInstDetails?network=mainnet` | 6,230 bytes, `[{"status":1,"msg":"Instrument Details","data":{"1":{…},…,"20":{…}}}]` | no, a web app route, S3 |
| `POST https://api.bitbns.com/api/trade/v1/futuresInstList` | not called, it needs `X-BITBNS-KEY`, `X-BITBNS-PAYLOAD` and `X-BITBNS-SIGNATURE` | yes, "Get all active futures market list", S2 |

The web app route is spelled `futures-testnet` for both networks, and the `network=mainnet` query selects the live one, S3.
Without `network` it answers `[{"status":0,"msg":"Something went unexpected while fetching coin list"}]`, and `/futures/getInstDetails` is an nginx 404, P4.
Each row carries `inst_id`, `coin_id`, `name`, `coin_name`, `factor`, `inst_leverage_json`, `margin_bucket_json`, `usdt_settled`, `status`, `default_leverage`, `min_allowed`, `price_prec` and `qnty_prec`, P1.

| field | values on 2026-09-23 UTC |
|---|---|
| rows | 20, `inst_id` 1 to 20 |
| `status` | 0 on all 20, the same value the documented sample shows, S2 |
| `usdt_settled` | 1 on all 20 |
| `coin_name` | `IC15USDTP`, `BTCUSDTP`, `ETHUSDTP`, `BNSUSDTP`, `BNBUSDTP`, `SOLUSDTP`, `ADAUSDTP`, `XRPUSDTP`, `MATICUSDTP`, `DOGEUSDTP`, `1000SHIBUSDTP`, `DOTUSDTP`, `AVAXUSDTP`, `TRXUSDTP`, `UNIUSDTP`, `XLMUSDTP`, `LTCUSDTP`, `LINKUSDTP`, `ATOMUSDTP`, `AAVEUSDTP` |
| shown by the web app | `futuresInstruments: [2,3,4,5,6,7,8,9,10,11]` in `/jugApi/globalParams.json` |

The 24 hour change route, `GET /futures-testnet/get24HrChange?network=mainnet&inst_id=<id>`, was read for all 20 in both runs, P1.
Only `BTCUSDTP` had volume, `{"open":64715.2075,"close":7841.26,"low":7841.26,"high":64715.2075,"change_per":44,"vol":0.0005999899999999999}`.
The other 19 answered `open`, `close` and `vol` of 0.
The newest trade in each room is in [`websocket.md`](./websocket.md) section 4, and six rooms last traded in 2022 or 2023.

### Spot, for context

`GET https://bitbns.com/order/fetchMarkets` listed 224 spot pairs, 186 against INR and 38 against USDT, all `active`, P1.
`GET /order/fetchTickers` summed to 291,713 INR of 24 hour volume over the 22 INR pairs that traded and about 1 USDT on the USDT market, with a median spread of 551,546 ppm over 221 two-sided books, P1.
CoinGecko put the whole venue at 0.023 BTC of 24 hour volume, S6.
The spot books sat far below the global price.

| pair | BitBNS bid and ask | CoinGecko at 04:54 UTC | bid as share of reference |
|---|---|---|---|
| `BTC/INR` | 3,955,011 and 3,990,000 | 8,331,451 INR | 47.5 % |
| `BTC/USDT` | 40,000 and 49,990 | 87,138 USD | 45.9 % |
| `ETH/INR` | 93,000 and 100,502 | 265,968 INR | 35.0 % |
| `USDT/INR` | 76.66 and 80.50 | 95.6 INR | 80.2 % |

`/jugApi/globalParams.json` read `masterCryptoTransferDisable: false` and listed network 6 as open for BTC withdrawals, so the published configuration does not explain the discount, P1.

### How CCXT 4.5.68 maps it

CCXT maps only the spot list.
`loadMarkets` returned 224 markets, all `type` `spot`, 0 swaps, and no pair listed twice, P1.
`market.id` is the venue `id`, `BTC` for `BTC/INR` and `BTCUSDT` for `BTC/USDT`, with `uppercaseId` `BTC_USDT`, at `server/node_modules/ccxt/js/src/bitbns.js` lines 302 to 305.
`linear` and `contractSize` are `undefined` on every market, lines 321 and 323.
The connector keeps only active swaps at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 201, so it would log "no usable swap markets" and skip BitBNS.

### Keys, size unit, pairs listed twice, and price scale

A perpetual has three keys, and no call spells all three.

| where | key for the BTC perpetual |
|---|---|
| socket room | `news_BTCUSDTP`, from `coin_name` |
| index socket | `"0"`, the `coin_id` |
| funding history and 24 hour change | `inst_id` 2 |

The instrument list is the only place that joins them.
Sizes on the perpetual socket read as base coins, see [`websocket.md`](./websocket.md) section 4, and `factor` is not a contract size.
No pair is listed twice among the perpetuals.
`1000SHIBUSDTP` is quoted per 1,000 SHIB: its index key 497 read 0.0061556667 while the SHIB key 146 read 0.0000061557, P5.
It would need a price scale of 1,000 in [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts).

## 3. Anchor

### The bulk calls

There is no REST call that returns index, mark or funding for every perpetual.

| source | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| socket `index_price_all` on `/bnsIndexSocket` | yes, 18 of 20 instruments | none, the docs say mark equals index | no | no | no | 20 keys per frame, 300 to 313 bytes | a burst every 5.0 s, see [`websocket.md`](./websocket.md) section 2 |
| `POST /futures-testnet/fundingRateHistory`, body `network=mainnet&inst_id=<id>` | no | no | the last settled rates, 50 rows, newest first | 8 h between rows | not published | 4,452 to 4,502 bytes | 200 to 291 ms |
| `GET /futures-testnet/get24HrChange` | no | no | no | no | no | 24 hour open, close and volume of the last trade price | one instrument per call |

The funding history route answered an unauthenticated POST with `{"status":1,"msg":"Funding Rate History","data":[{"id":73017,"inst_id":2,"funding_rate":-0.009573,"timestamp":"2026-09-23T00:00:11.000Z"},…]}`, P3.
The index socket leaves out `IC15USDTP` (`coin_id` 477) and `MATICUSDTP` (`coin_id` 83), and carries two keys, 136 and 146, that are not instrument coins, P5.

### Row mapping

Nothing maps cleanly to an `AnchorRow`, whose columns are at [`types.ts`](../../../server/src/engine/cluster/types.ts).

| `AnchorRow` column | nearest field | problem |
|---|---|---|
| key | `coin_id` on the index socket | a different key from the socket room and from the funding route |
| `index` | the `index_price_all` value, a JSON number except BNS, which is the string `"0.00002881"` | a socket, not a poll |
| `mark` | none | the docs say mark equals index, so a mark column would copy the index |
| `fundingRate` | the newest `funding_rate` of the history, in percent | it is the last settled rate, not the upcoming one, and one POST per instrument |
| `fundingIntervalHours` | 8, from the row spacing | not published as a field |
| `nextFundingAt` | the next of 00:00, 08:00 or 16:00 UTC | derived from the schedule, not published |

## 4. Anchor semantics

### Index

| instrument | documented basket | source |
|---|---|---|
| `BTCUSDTP`, `ETHUSDTP` | last trade on "FTX, Binance, Gate.io, Huobi, Okex and Bitfinex", stale feeds dropped, feeds more than 5 % from the median dropped, then the arithmetic mean | S4 |
| `IC15USDTP` | "licenced from Cryptowire and comes directly from there" | S4 |
| `BNSUSDTP` | "BNS Index Feed comes from Bitbns BNS Prices", the venue's own spot | S4 |
| the other 16 | Not publicly specified | |

The documented basket still names FTX, which failed in 2022, so the documented basket is out of date.
The BNS index is self-referential, the shape that produced false rows on the Binance ONE perpetual, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
It read the constant string `"0.00002881"` in every frame of both runs.
The BTC index read 86,897.565 to 86,945.625 in the first run and 86,920.19 to 86,928.8025 in the rerun, and CoinGecko read 87,138 USD at 04:54 UTC, P5.
The basket call is not public.

### Mark

"Right now the Mark price used for funding rate calculations is same as the Index Price", S4.
No mark is published on any route or socket found.
The web app labels the liquidation price "Based on Last Index price.", S3.

### Clamps

The platform price band is "+-5% around Underlying Index Price", S4.
It did not hold on the wire.
`BTCUSDTP` last traded at 7,841.26, 91 % below its index, and its only ask sat at 64,715.2075, 26 % below.
The quoted books of `ETHUSDTP`, `SOLUSDTP` and `BNBUSDTP` sat within 0.8 % of their index, P5 and [`websocket.md`](./websocket.md) section 4.

### Funding

"FR = (LTP - Index price)/Index price . Logged every 15 minutes. Linear average every 8 hrs.", and "FFR = simple average of 8hrs subject to 0.5% max.", S4.
The published rate is the last settled one, and no upcoming or predicted rate is published.
The unit is percent, an inference from the 0.5 % cap, see [`fees.md`](./fees.md) section 6.
`BTCUSDTP` settled `-0.009573` on all 50 rows from 2026-09-06 16:00 UTC to 2026-09-23 00:00 UTC, and `ETHUSDTP` three values from `0.313105` to `0.326367`, P3.
The rate tracks the last trade, and the last trade barely moves, so the rate is stale by construction.
The settlement instant itself was not captured.

### How often each number changed

| number | over 30 s of the index socket, two runs |
|---|---|
| BTC index | 7 distinct values in 7 bursts, both runs |
| ETH index | 6 and 7 distinct values |
| SOL index | 6 and 3 distinct values |
| TRX index | 2 and 1 distinct values |
| BNS index | 1, the constant string |
| funding | once per 8 h at most, and never for BTC over 16 days |

## 5. REST book snapshot

| call | depth | order | caching | source |
|---|---|---|---|---|
| `GET /exchangeData/orderbook?coin=<COIN>&market=<INR or USDT>` | whole book, 333 bids and 152 asks on `BTC/INR` | bids descending, asks ascending | Cloudflare `HIT`: 30 polls at 1 s returned 1, 2 and 1 distinct bodies in three runs, stamped 117 to 147 s, 4 to 305 s and 188 to 218 s old | S1, P6 |
| `GET /order/fetchOrderbook?symbol=<market.id>`, the CCXT route | 15 per side | bids descending, asks ascending | `BYPASS` or `HIT`: the `BTC` copy was 0, 242 and 1,035 s old over three runs, and the `BTCUSDT` copy 4,300, 5,078 and 5,871 s old | P6 |
| perpetual book | none on REST, the web app reads it only from the socket | | | S3 |

`fetchOrderbook?symbol=USDT` returned a different book, best 74.06 and 76.08, from the `USDT/INR` book that `exchangeData/orderbook` and the socket both showed at 76.66 and 80.50, read back to back at 05:23 UTC, P6.
A REST book from either route can be minutes old, so it is not a resync source.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| keyed API limit | "100 write operations per 10 mins" and "500 read operations per 10 mins" | S1 |
| public routes | Not publicly specified | |
| CCXT pacing | `rateLimit: 1000` ms, `bitbns.js` line 24 | S5 |
| refusals seen | none, no 429 in about 300 probe requests | P1 to P6 |

| request | status | body |
|---|---|---|
| unknown or missing coin on `exchangeData/orderbook` | 200 | `[{"status":0,"msg":"Invalid market or coin passed"}]` |
| unknown symbol on `order/fetchOrderbook` | 200 | `[{"status":0,"msg":"Some error in sell data"}]` |
| `get24HrChange` without `inst_id` | 200 | `[{"status":0,"msg":"Invalid Instrument Id","data":{}}]` |
| `GET` on `fundingRateHistory` | 404 | Express `Cannot GET /futures-testnet/fundingRateHistory` |
| `/futures/getInstDetails` | 404 | nginx HTML |
| `api.bitbns.com` without a key | 403 | `{"data":null,"status":0,"error":"invalid api key","code":401}` |

Errors on the public routes arrive as HTTP 200 with `status` 0, so a poller must read the body.
A keyless call to `api.bitbns.com` returns 403, which [`errors.ts`](../../../server/src/shared/errors.ts) line 1 treats as a rate limit and would pause on.
CCXT reads the `code` and `msg` fields in `handleErrors`, `bitbns.js` lines 1294 to 1313.

## 7. Server time and clock offset

No time endpoint is documented, and CCXT's `bitbns` class has no `fetchTime`, S5.
The `Date` header has one second resolution, and it read 990 ms behind to 130 ms ahead of the local clock over 99 requests, which fits a clock offset under one second, P2.
The `timestamp` of a cached book is the cache's age and not the server clock.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
No anchor poller is recommended.
BitBNS publishes no REST index or mark, its funding is a per instrument history of settled rates, and its index is a socket that republishes every 5 s.
If a BitBNS leg were ever wanted, the anchor would have to be a socket reader of `index_price_all` keyed by `coin_id`, with mark set equal to index, which the reader at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) cannot tell apart from a fresh mark.
The funding would come from 20 POSTs per 8 h to `fundingRateHistory`, taking the newest row, and `nextFundingAt` from the 00:00, 08:00 and 16:00 UTC schedule.
`BNSUSDTP` would need a deny line for its self-referential index, and `1000SHIBUSDTP` a price scale of 1,000.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbns API docs, Public Endpoints (Markets, Live Tickers, Order Book), Rate limit | https://docs.bitbns.com/bitbns/rest-endpoints/public-endpoints | 2026-09-22 | BitBNS | public routes, `exchangeData/orderbook`, rate limits, sections 1, 5 and 6 |
| S2 | Bitbns API docs, Futures, Active Markets | https://docs.bitbns.com/bitbns/futures/active-markets | 2026-09-22 | BitBNS | signed `futuresInstList`, sample rows with `status` 0, section 2 |
| S3 | Bitbns web app bundles `index.c7bf753d.js`, `index.90dda0f6.js`, `chartHeader.51f4291a.js` | https://bitbns.com/trade/assets/ | 2026-09-22 | BitBNS | `futures-testnet` routes with `network`, `fundingRateHistory`, `/bnsIndexSocket`, "Based on Last Index price.", sections 2 to 5 |
| S4 | Bitbns Beginner's Guide, Index Price Calculations, How is Funding Rate Calculated, Bitbns Futures Beginner's Guide | https://docs.bitbns.com/bitbns-beginners-guide/guides/bitbns-futures-beginners-guide | 2026-09-22 | BitBNS | index baskets, mark equals index, funding formula and cap, price band, section 4 |
| S5 | CCXT 4.5.68 `bitbns.js` | `server/node_modules/ccxt/js/src/bitbns.js` | 2026-09-22 | CCXT | spot only mapping, `rateLimit`, `handleErrors`, no `fetchTime`, sections 2, 6 and 7 |
| S6 | CoinGecko API `exchanges/bitbns` and `simple/price` | https://api.coingecko.com/api/v3/exchanges/bitbns | 2026-09-23 | CoinGecko | 0.023 BTC venue volume, reference prices at 04:54 UTC, section 2 |
| P1 | `rest-probe.mjs catalog` at 04:56 and 05:09 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | instrument list, 24 hour change, spot catalog and tickers, CCXT markets, `globalParams`, section 2 |
| P2 | `rest-probe.mjs latency` at 04:56, 05:09 and 05:22 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | DNS, cold and warm times, cache status, `Date` offset, sections 1 and 7 |
| P3 | `rest-probe.mjs funding` at 04:57 and 05:10 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | funding history rows, interval, rates, sections 3 and 4 |
| P4 | `rest-probe.mjs errors` at 04:57 and 05:10 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | error bodies, keyless 403, sections 1, 2 and 6 |
| P5 | `ws-probe.mjs index` and `futures` at 05:04 to 05:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbns/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | index values and keys, book against index, sections 2 to 4 |
| P6 | `rest-probe.mjs book` at 04:56, 05:09 and 05:23 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | REST book depth, order, cache age, section 5 |
