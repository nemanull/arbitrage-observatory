# IMBX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:12 to 04:37 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard exit that geolocates to Canada, and the second pass at 05:04 to 05:06 UTC was refused by a load balancer block, see section 6.

This profile covers the public REST calls behind IMBX's USDT-margined perpetuals.
IMBX publishes no API documentation, and the open API host its own configuration names does not answer this host, section 1.
Every call below is one IMBX's web client makes, read from its bundles, S1, and was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs).
These calls are undocumented, so their shape, limits and existence can change without notice.

## 1. Host and latency from this machine

| host | role in the web client, S1 | resolved on 2026-09-23 | probed |
|---|---|---|---|
| `lf-api.imbx.io` | `legacyFuturesApiDomain`: futures catalog, `price_list`, `public_market_info` | 52.68.7.104, 3.113.99.116 | 200 with `User-Agent: node` |
| `api.imbx.io` | `apiDomain`: funding, VIP levels | 52.68.7.104, 3.113.99.116 | 200 with `User-Agent: node` |
| `ls-api.imbx.io` | `legacySpotApiDomain`: spot catalog | 52.68.7.104, 3.113.99.116 | 200 with `User-Agent: node` |
| `futuresws.imbx.io` | futures socket | 52.68.7.104, 3.113.99.116 | 101 with `User-Agent: node` |
| `openapi.imbx.io`, `futuresopenapi.imbx.io` | not used by the client. The spot `public_info` names `openapi.iambit.com/exchange-open-api` as `open_api_url` | 18.181.124.196, 35.74.20.229 | no answer on port 443 in 6 s, and curl reported "Connection timed out after 8002 milliseconds" with no TCP connection. Port 80 accepts and returns an empty reply |
| `openapi.iambit.com` | the `open_api_url` host | 18.181.124.196, 35.74.20.229 | no answer on port 443 in 6 s |

`www.iambit.com` is a CNAME of `prd-iab-iambit-internet-alb-426483666.ap-northeast-1.elb.amazonaws.com`, which resolves to the same two addresses as the API hosts, so the API sits behind an AWS load balancer in Tokyo, P1.
IAMBIT is the platform's earlier name, which the spot `public_info` still carries in `open_api_url` and `base_url` `https://iambit.com`, P1.
`www.imbx.io` is a static site on CloudFront, served from the `SEA900-P10` edge.

| call | cold | warm |
|---|---|---|
| `POST /common/public_info`, 33,745 bytes | 717 ms | 251 to 404 ms over 5 calls, P1 |
| `POST /common/public_market_info`, 257 bytes | | 130 to 173 ms, median 152, over 120 calls, P2 |
| `POST /common/price_list`, 3,505 bytes | | 228 to 454 ms, median 239, over 60 calls, P2 |

### Refusals by User-Agent

| User-Agent | REST | socket upgrade |
|---|---|---|
| Node `fetch` default, `node` | 200 | 101 with `User-Agent: node` set on the socket |
| `curl/8.14.1` | 403 | 403 |
| empty or absent | 403 | 403, and the `ws` library sends none unless told |

Each 403 carried `server: awselb/2.0` and the body `<html> <head><title>403 Forbidden</title></head> <body> <center><h1>403 Forbidden</h1></center> </body> </html>`, P1 and the socket probe, see [`websocket.md`](./websocket.md) section 5.
The same exit address got 200 and 403 in the same second depending only on this header, so the refusal is a load balancer rule on the User-Agent and not a location block.
From 04:37 UTC a volume block refused `User-Agent: node` too, section 6.

## 2. Catalog

### The instruments call

`POST https://lf-api.imbx.io/common/public_info` with body `{}` returns `data.contractList`, P1.
A `GET` on the same path answers HTTP 200 with `{"code":"200008","msg":"Unsupported request method","data":null,"succ":false}`, P4.

| field | value on 2026-09-23 |
|---|---|
| contracts | 29 |
| `contractType`, `contractShowType` | `E` and `Perpetual` on all 29 |
| `contractSide` | 1 on all 29, linear |
| `marginCoin`, `marginCoinList` | `USDT`, `["USDT"]` |
| `deliveryKind` | `"0"` on all 29 |
| `capitalFrequency` | 8 on 24, 4 on the 5 commodity contracts |
| `tags` | `Stocks` 9, `Commodity` 5, `New listing` 9, none 6 |
| status field | none. A contract is live while it is listed |

The 29 are BTC, PEPE, XRP, ETH, TRX, DOGE, JUP, SOL, TRUMP, MET, HYPE, PUMP, WLFI, PENGU, WLD, TSLAX, CL, BZ, XAU, XAG, COINX, MSTR, CRCL, HOOD, PLTR, NVDA, MSFT, TSM and COPPER, all against USDT, P1.
`price_list` and the funding calls also return `STX`, `SUI`, `IMX`, `W`, `TON`, `PYTH` and `BEAMX`, which the catalog no longer lists and whose books are empty or hold a zero price, P2 and [`websocket.md`](./websocket.md) section 4.
A catalog read has to come from `public_info`, and every other reply has to be filtered by it.

### How the calls spell a contract

| call | key | example |
|---|---|---|
| `public_info` | `contractName` | `E-BTC-USDT` |
| `price_list` | `contractName` as the object key | `E-BTC-USDT` |
| `public_market_info` | `id`, sent as `contractId` | `1` |
| socket channel | `subSymbol` | `e_btcusdt` |
| funding calls | `symbol` | `BTC-USDT` |
| display | `contractOtherName` | `BTCUSDT`, but `MET-USDT` for MET and `TSLAUSDT` for `TSLAX` |

No CCXT class exists, so there is no `market.id` to match, see [`fees.md`](./fees.md) section 8.
The engine takes its catalog from a CCXT class at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 21 and 68, so IMBX would need a catalog outside CCXT, and `contractName` is the natural `rawMarketId`, since `public_info` and `price_list` both key on it.

### Size unit, pairs listed twice, and price scale

| contract | `multiplier` | `multiplierCoin` |
|---|---:|---|
| `E-BTC-USDT` | 0.0001 | BTC |
| `E-ETH-USDT` | 0.01 | ETH |
| `E-SOL-USDT`, `E-TRUMP-USDT`, `E-HYPE-USDT`, `E-XAG-USDT`, `E-COPPER-USDT` | 0.1 | base |
| `E-XRP-USDT`, `E-JUP-USDT`, `E-WLD-USDT` | 10 | base |
| `E-TRX-USDT`, `E-DOGE-USDT`, `E-MET-USDT`, `E-WLFI-USDT` | 100 | base |
| `E-PEPE-USDT`, `E-PUMP-USDT`, `E-PENGU-USDT` | 1000 | base |
| `E-XAU-USDT` | 0.001 | XAU |
| the 9 stock contracts and `E-CL-USDT`, `E-BZ-USDT` | 0.01 | base |

Source: P1.
The socket reports sizes in contracts, an inference, see [`websocket.md`](./websocket.md) section 4, so `multiplier` is the engine's `contractSize`.
Each base is listed once, so no pair is listed twice.
Prices are per one coin, `E-PEPE-USDT` at `0.00000495`, so no price scale is needed.
`TSLAX` and `COINX` are IMBX's names for Tesla and Coinbase stock perpetuals, `CL` and `BZ` are crude oil, and a ticker another venue uses for a different token would need a `DENIED_PAIRS` line.

## 3. Anchor

### The bulk calls

No call returns the index for every contract.

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `POST lf-api /common/price_list`, body `{}` | absent | `tagPrice` | absent | absent | absent | 3,505 bytes, 36 rows with `lastPrice`, `buyOne`, `sellOne` | 60 polls: min 228, median 239, p90 250, max 454 ms |
| `POST lf-api /common/public_market_info`, body `{"contractId": 1}` | `indexPrice` | `tagPrice` | `currentFundRate`, and `nextFundRate` | absent | absent | 257 bytes, one contract, with `fundingRateCap` and `fundingRateFloor` | 120 polls: min 130, median 152, p90 162, max 173 ms |
| the same over all 29 contracts, one after another | | | | | | 29 calls | 4,255 ms per sweep |
| `POST lf-api /common/public_info` | absent | absent | absent | `capitalFrequency`, hours | `nextCapitalSettTime`, Unix ms | 33,745 bytes | 251 to 404 ms warm |
| `GET https://api.imbx.io/futures/finance/public/funding-rate?size=100` | absent | absent | `fundingRate`, a moving estimate, section 4 | `timePeriod`, `EIGHT_HOURS` or `FOUR_HOURS` | `nextUpdate`, `2026-09-23T08:00:00` with no zone | 7,401 bytes, 36 rows, with `baseInterestRate` and the cap and floor | 584 ms |

Source: P2.
The web client asks `public_market_info` for one contract every 4 s while its futures page is open, S1.
Without `size` the funding call returns its first page of 10 rows out of `"total":36`.
The `tagPrice` of `price_list` equalled the `tagPrice` of `public_market_info` read right after it on 120 of 120 reads, P2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `contractName` | string, `E-BTC-USDT` | none, and `public_market_info` needs the contract's `id` |
| `index` | `public_market_info` `indexPrice` | JSON number, 0 for an unknown `contractId` | as is, and a 0 is no reading |
| `mark` | `price_list` `tagPrice`, or the same field of `public_market_info` | JSON number | as is |
| `fundingRate` | `public_market_info` `currentFundRate` | fraction per interval, `0.0000788458795124` is 0.00788 % | as is |
| `fundingIntervalHours` | `public_info` `capitalFrequency` | integer hours, 8 or 4 | as is |
| `nextFundingAt` | `public_info` `nextCapitalSettTime` | Unix ms, `1790150400000` is 2026-09-23 08:00 UTC | as is |

At 04:27 UTC all 29 contracts, both 8 h and 4 h, read `nextCapitalSettTime` 1790150400000, P1.

## 4. Anchor semantics

### Index

"IMBX calculates a weighted average of spot prices from leading cryptocurrency exchanges", S2.
The glossary says "Index price is derived from the sum of the prices from various spot exchanges multiplied by their respective weightage.", S3.
The constituents and weights are Not publicly specified, and no basket call was found in the client, S1.
For the stock and commodity perpetuals the index "is constructed from constituent prices quoted by third-party data vendors", and it runs in four modes: updated every second in regular hours, a fast decay EWMA before and after the session, a slow decay EWMA overnight, and "Fixed Mode (Daily Maintenance, Holiday, Weekends): No recalculation occurs", S4.

### Mark

The mark is "determined by calculating three raw price values and taking their median as the final mark price.", S5.
The same article says "This mark price updates every second.", S5.

| part | definition, S5 |
|---|---|
| Price 1 | "Last price on the IMBX futures market" |
| Price 2 | "index price × (1 + latest funding rate × (time until next settlement ÷ funding rate settlement interval))" |
| Price 3 | "index price + MA (2.5-minute order book basis)", the basis being `(Bid1 + Ask1) ÷ 2 − index price` sampled every 5 s, 30 samples |
| mark | "median (Price 1, Price 2, Price 3)" |
| override | "IMBX may adjust the MA calculation window for Price 3 or switch the mark price calculation to Price 1 in response to highly volatile market conditions." |

For stock and commodity perpetuals the mark is the same median in regular hours and an EWMA of the last price during maintenance and weekends, S4.
Their mark may not leave the index by more than ±8 % in regular, pre-market and after-hours sessions, ±5 % overnight and ±3 % at weekends and holidays for stocks, and ±3 % at all times for commodities, S4.

Two of the three parts are the perpetual's own price, so with a standing basis the median is the perpetual's own price and not the index.
That is what the probe saw.

| reading, P2 and P3 | index | mark | book mid | mark over index | mark over mid |
|---|---:|---:|---:|---:|---:|
| BTC, 04:28:12 UTC | 87,194 | 87,156.08 | 87,153.05 | −435 ppm | +35 ppm |
| BTC, the 60th poll, about 04:29:11 UTC | 87,116 | 87,073.17 | 87,071.55 | −492 ppm | +19 ppm |
| BTC, 04:29:50 UTC | 87,032.91 | 87,019.8 | | −151 ppm | |
| COPPER, 04:28:12 UTC | 6.833 | 6.834156 | 6.8345 | +169 ppm | −50 ppm |

The mark sat within 50 ppm of the book mid while it sat 151 to 492 ppm from the index.
So the mark carries IMBX's own basis, the shape that made the Binance ONE mark trail its own perpetual, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
A leg judged on this mark reads as fresh whenever IMBX's own book is off the index.

### Funding

The formula, interest rate and caps are in [`fees.md`](./fees.md) section 6.

| field | what it is | evidence |
|---|---|---|
| `currentFundRate` | the rate fixed for the upcoming settlement | the BTC funding history already held a row dated `2026-09-23T08:00:00` at `0.00007885` at 04:22 and 04:29 UTC, which is `currentFundRate` 0.0000788458795124 rounded, and the field did not change over 60 polls, P2 and P3 |
| `nextFundRate` | an estimate for the settlement after it, an inference | 0.00008 on BTC at 04:28 and 04:29 UTC |
| funding call `fundingRate` | a moving estimate | 0.0000761632284175 on BTC in a curl read at 04:19 UTC, and 0.00008 at 04:29 UTC in P2, when it equalled `nextFundRate` |
| funding history rows | settled rates, plus the upcoming one | 8 rows per contract read: BTC at 00:00, 08:00 and 16:00, XAU and COPPER every 4 h, all timestamps without a zone and on the UTC grid, P3 |

The engine wants the rate for the upcoming settlement, which is `currentFundRate`.
Because that rate is fixed hours ahead, it is not a live premium reading.
The settlement instant itself was not captured.

### How often each number changed

Over 59 one second intervals from 04:28:12 UTC, P2.

| number | BTC | COPPER |
|---|---:|---:|
| `indexPrice` | 45 | 0 |
| `tagPrice` | 49 | 1 |
| `lastPrice` in `price_list` | 41 | 11 |
| `currentFundRate` | 0 | 0 |
| `nextFundRate` | 0 | 0 |

The COPPER index held at 6.833 for the whole minute at 04:28 UTC, a Wednesday, while its last price moved 11 times.

## 5. REST book snapshot

None found.
The web client reads the book only from the socket, S1, and `price_list` carries `buyOne` and `sellOne` without sizes.
The open API host, where a ChainUP platform serves its REST depth, does not answer this host, section 1.
So the socket's size unit cannot be checked against a REST book, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

The limits are Not publicly specified, and no reply carried a rate limit header.
A `price_list` reply carried `cache-control: no-cache, no-store, max-age=0, must-revalidate`, `content-type: application/json;charset=utf-8`, `vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`, and security headers, and no `Retry-After`, P4.

### The volume block

| time, UTC | requests from this host to the IMBX API hosts | result |
|---|---|---|
| 04:12 to 04:27 | about 60, spread out | 200, apart from the User-Agent refusals of section 1 |
| 04:27:22 to 04:28:05 | `catalog`, 12 | 200 |
| 04:28:12 to 04:29:25 | `anchor`: 60 `price_list`, 120 `public_market_info`, a 29 call sweep, 3 more | 200, no 429 |
| 04:29:48 to 04:30:05 | `funding` and `errors`, about 20 | 200 |
| 04:30:11 to 04:32:47 | 4 REST calls and 5 socket upgrades | 200 and 101 |
| 04:37:03 to 05:02:05 | 26 single calls, one a minute or less often after 04:38, to watch the block | 403 from `awselb/2.0` with the bare HTML body, with `User-Agent: node` |
| 05:04:46 to 05:05:38 | the second pass, every mode of both probes | 403 on every REST call and every socket upgrade, whatever the User-Agent |

The refusal matches a load balancer rate rule that fired a few minutes after about 250 requests between 04:27 and 04:32 UTC, which is an inference, since nothing says so.
It also refused `https://api.imbx.io/vip/levels`, a different host behind the same load balancer, while `www.imbx.io` on CloudFront and the Zendesk help center kept answering 200.
It still held at 05:05 UTC, 28 minutes after it began, when this profile was written, so its length is unknown.
The second pass therefore could not rerun any probe, and every number here was checked against the first run's output instead.
The engine's poller pauses on 403 at [`../../../server/src/feeds/anchor/AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 193 and [`../../../server/src/shared/errors.ts`](../../../server/src/shared/errors.ts) line 1, but a block that also refuses the socket would take the book down with it.

### Error shapes

| request | status | body |
|---|---|---|
| `GET lf-api /common/public_info` | 200 | `{"code":"200008","msg":"Unsupported request method","data":null,"succ":false}` |
| `public_market_info` with `{}` | 200 | `{"code":"200004","msg":"Illegal parameters","data":null,"succ":false}` |
| `public_market_info` with `{"contractId": 999}` | 200 | `{"code":"0","msg":"Success","data":{"currentFundRate":0,"indexPrice":0,"fundingRateCap":0,"fundingRateFloor":0,"tagPrice":0,"nextFundRate":0},"succ":true}` |
| `public_market_info` with `{"contractId": "E-BTC-USDT"}` | 200 | the same zeros without the cap and floor |
| `POST lf-api /common/nope` | 404 | `{"timestamp":"2026-09-23T04:29:56.105+00:00","status":404,"error":"Not Found","path":"/common/nope"}` |
| `GET api /futures/finance/public/nope` | 500 | `{"errorCode":"50001","errorMessage":"No static resource futures/finance/public/nope."}` |
| funding history without `symbol` | 500 | `{"errorCode":"50001","errorMessage":"Required request parameter 'symbol' for method parameter type String is not present"}` |
| funding history for `NOPE-USDT` | 404 | `{"errorCode":"40402","errorMessage":"Contract not found for symbol: NOPE-USDT"}` |

Source: P4 at 04:29:56 UTC.
An unknown contract is a success with zeros, so a poller has to treat an index or mark of 0 as no reading.

## 7. Server time and clock offset

`public_info` carries `data.currentTimeMillis`.
Over five calls at 04:29:51 UTC the server time minus the local midpoint was −9, 66, 131, 67 and 65 ms, with round trips of 248 to 386 ms, so the clocks agree to within half a round trip, P3.

## 8. Recommended poller shape

No poller is recommended.
IMBX cannot join the engine in its current shape for four reasons.

1. The catalog is a CCXT class at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) line 21, and IMBX has none.
2. The index comes only from one `public_market_info` call per contract, so a one second anchor round costs 30 requests, one `price_list` and 29 index calls, and a sequential sweep took 4,255 ms.
3. The load balancer refused this host, socket included, a few minutes after about 250 requests between 04:27 and 04:32 UTC, so a one second round of 30 requests would run into the same block, section 6.
4. The mark is the median of IMBX's own last price, its own book basis and a funding model, so it reads IMBX's perpetual rather than the index, section 4.

If IMBX is ever reconsidered, the sketch is this.

| item | sketch | reason |
|---|---|---|
| mark | `POST https://lf-api.imbx.io/common/price_list` every second, keyed by `contractName` | one bulk call, median 239 ms |
| index | `public_market_info` per contract in a slow round robin, within a limit IMBX would have to state | no bulk index |
| interval and next settlement | `public_info` every 60 s | it moves only at settlements |
| rate | `currentFundRate` | the rate fixed for the upcoming settlement |
| skip | rows of `price_list` whose `contractName` is not in `public_info` | 7 delisted rows remain |
| skip | an `indexPrice` or `tagPrice` of 0 | an unknown contract answers zeros |
| headers | `User-Agent` must be present and not curl's | section 1 |
| rate limit pause | long, with the length measured before use | no `Retry-After`, and the block lasted at least 28 minutes, section 6 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | IMBX web client bundles, chunks `4083-367f78b32b08a08e.js` (API hosts, `public_market_info` every 4 s, paths) and `4313-f76e79e21745dc68.js` (hosts, socket URLs) | https://www.imbx.io/_next/static/chunks/ | 2026-09-23 | IMBX web client | hosts, paths, polling pace, sections 1 to 3 and 5 |
| S2 | Index price calculation, updated 2025-11-24 | https://imbxhelp.zendesk.com/hc/en-us/articles/52712468590745 | 2026-09-23 | IMBX, global | index, section 4 |
| S3 | IMBX futures: Glossary, updated 2025-11-24 | https://imbxhelp.zendesk.com/hc/en-us/articles/52712363533337 | 2026-09-23 | IMBX, global | index and mark definitions, section 4 |
| S4 | Perpetual Futures on Traditional Assets, updated 2026-03-06 | https://imbxhelp.zendesk.com/hc/en-us/articles/55759177417113 | 2026-09-23 | IMBX, global | TradFi index modes, mark modes and deviation caps, section 4 |
| S5 | Mark price calculation, updated 2025-11-24 | https://imbxhelp.zendesk.com/hc/en-us/articles/52712385166617 | 2026-09-23 | IMBX, global | mark formula, section 4 |
| P1 | `rest-probe.mjs catalog` at 04:27 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | DNS, latency, refusals, open API hosts, catalog, sections 1 and 2 |
| P2 | `rest-probe.mjs anchor` at 04:28 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | anchor calls, timings, change counts, mark against index and mid, sections 3 and 4 |
| P3 | `rest-probe.mjs funding` at 04:29 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | funding history, server time, sections 4 and 7 |
| P4 | `rest-probe.mjs errors` at 04:29 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | error shapes, headers, section 6 |
| P5 | `rest-probe.mjs` all four modes, second pass at 05:04 to 05:05 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the block: every API call 403, the open API hosts still silent, DNS unchanged, sections 1 and 6 |
