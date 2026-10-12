# SunX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers SunX at `sunx.vip`, CoinMarketCap id 32686.
SunX publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The REST calls below are the public ones its own web bundle makes, the same calls the AIA Exchange profile found on another tenant of the bundle, see [`../aia/rest.md`](../aia/rest.md).
They answer from this host without a challenge, and they return a perpetual catalog with a mark price, but no index, no funding rate and no book.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/sunx/rest-probe.py), P1, section by section.

## 1. Host and latency from this machine

### Which SunX

CoinMarketCap names two venues SunX, P1 section 1.

| CoinMarketCap id | slug | website | kind | pairs | prices and volumes |
|---|---|---|---|---|---|
| 32686 | `sunx` | `https://sunx.vip/` | centralized, launched 2018-07-31 by its own record | 234 perpetual, 28 spot | excluded on every pair read |
| 32630 | `sunperp` | `https://www.sunx.io/` | DEX, type `swap` | 241 perpetual, 0 spot | counted |

The exchange listing that the survey used holds only id 32686, at position 209 in a first manual read on 2026-10-09 and at 208 in both probe runs, P1 section 1.
So the surveyed venue is `sunx.vip`.
The `sunx.io` DEX is described in section "Namesake" below.

### Hosts

| host | resolved on 2026-10-09 | role | result, P1 sections 2 and 3 |
|---|---|---|---|
| `sunx.vip`, `www.sunx.vip` | `174.35.100.116` | the live site and its REST calls, behind a CDN | HTTP 200 |
| `www.sun3259.me` | `174.35.100.116` | the host of SunX config `Ch3Q` | HTTP 200, the same page |
| `www.31976.me` | Cloudflare `104.21.7.253`, `172.67.156.145` | the host of SunX config `FaJ6` | HTTP 200, the same page and the same catalog |
| `api.sunx.vip`, `ws.31976.me` | no DNS record | none | name not found |
| `support.sunx.vip` | `216.198.53.6`, `216.198.54.6`, an alias of `sunbitex.zendesk.com` | help center | HTTP 200 through Cloudflare |

The catalog call took 264 to 602 ms over six tries in two runs, and the first call of each run was the slowest, P1 section 4.
No geoblock or challenge was seen on any REST call from this Canadian exit.
The socket upgrade on `sunx.vip` is refused, see [`websocket.md`](./websocket.md) section 1.

## 2. Catalog

### The instruments call

`GET https://sunx.vip/v1/cfd/public/instruments` returns `{"code":0,"msg":"","data":[...],"success":true}`, about 448,900 bytes, P1 section 4.

| item | value |
|---|---|
| rows | 349 |
| `status` values | `online` 253, `offline` 96 |
| settlement asset | USDT on every online row, `marginCurrencyList` `[{"usdt": "6"}]` |
| symbol spelling | lower case base and quote with no separator, `btcusdt`, the string the socket channels use |
| contract size | `oneLotSize` in base units: 0.001 BTC, and 0.01, 0.1, 1, 10, 100, 1,000 or 10,000 on other rows |
| minimum order | `minSize` 1 lot on every online row |
| leverage | `maxLeverage` 100 on 152 rows, 75 on 56, 125 on 18, 50 on 16, 25 on 9 and 200 on 2 |
| non-crypto rows online | `xauusdt` Gold, `xagusdt` Silver, `tslausdt` Tesla and `nvdausdt` Nvidia |
| pairs listed twice | none |
| other fields | `lastPrice`, `markPrice`, `settledAt`, `settlementRate`, `fundingIntervalHours`, `takerFee`, `makerFee`, `commissionRate`, `openSpread`, `closeSpread`, `orderBookLevel`, `configBo` |

### How CCXT maps it

No CCXT class exists, so there is no `market.id`, `contractSize`, `linear` or `active` to compare.
An adapter would build its own catalog from this call, with `symbol` as the raw id and `oneLotSize` as the contract size.

### Spot, for the coverage matrix

`GET /v1/cfd/public/spot_instruments` returns 28 rows, all `online`, about 20,270 bytes, P1 section 7.

## 3. Anchor

No REST call returns an index price or a funding rate.

| `AnchorRow` column | where | value seen | label |
|---|---|---|---|
| index | socket `market_btcusdt_index_price` only, one channel per symbol | BTC 82,649.87 to 82,662.69 over three runs | Probed, see [`websocket.md`](./websocket.md) section 2 |
| mark | catalog `markPrice`, every perpetual at once | BTC 82,619.448 beside OKX's mark 82,619.3 in the first run, 0.02 bp apart, and 0.47 bp apart in the second | Probed |
| funding rate | socket `market_FaJ6.btcusdt_funding_rate` only, field `fr` | BTC 0.00001832 to 0.00001841 | Probed |
| interval | catalog `fundingIntervalHours` | 8 on 149 rows, 4 on 104 rows | Probed |
| next settlement | `GET /v1/cfd/public/funding/countdown`, seconds | 12,244 at 04:35:55 UTC and 12,063 at 04:38:56 UTC, both pointing to 07:59:59 UTC | Probed |

The countdown gave the same number for `/btcusdt` and `/dogeusdt`, so it does not tell symbols apart, and it cannot be right for both 8 hour and 4 hour symbols at every instant, P1 section 5.
The catalog's `settledAt` pointed to 2026-10-10 20:00:00 UTC on all 253 rows, 15.35 to 15.4 hours ahead, which is longer than any funding interval.
It and `settlementRate` match the daily 04:00 UTC+8 overnight fee of [`fees.md`](./fees.md) section 6, which is an inference.
Marks for ETH, SOL and DOGE sat within 3.5 bp of OKX's marks in both runs, P1 section 5.
The settlement instant itself was not captured, because the survey does not wait for clock events.

## 4. Anchor semantics

- Index formula and basket: not published.
- Mark formula: not published.
  It tracked OKX's mark within 0.5 bp on BTC and ETH in both runs, P1 section 5.
- Funding formula, cap and floor: not published, see [`fees.md`](./fees.md) section 6.
- Whether `fr` is the upcoming or the last settled rate: Not verified.
- Change rate over 15 polls 2 s apart, in two runs, P1 section 6: BTC `lastPrice` changed 6 to 10 times and `markPrice` 10 to 11 times, ETH 4 to 10 and 11, DOGE 5 to 6 and 8 to 9.
  `settlementRate` and `settledAt` never changed.

## 5. REST book snapshot

None.
`/v1/cfd/public/depth` and `/v1/cfd/public/orderbook` answer HTTP 404 `{"code":404,"msg":"Requested address does not exist",...}`, and the bundle names no REST book path, P1 sections 3 and 7.
The socket is the only book source.

## 6. Rate limits and errors

- No limit is published, and no limit header was seen, P1 section 8.
- An unknown path answers HTTP 404 with the JSON body above.
- A private path, `/v1/users/profile`, answers HTTP 401 `{"code":401,"data":null,"msg":"Unauthorized access is not allowed"}`.
- Replies carry `cache-control: no-cache, no-store, max-age=0, must-revalidate` and an Envoy timing header.

## 7. Server time and clock offset

No time call is known.
The `Date` header sat 0.7 to 1.1 s behind the host clock, which includes the request time and the header's whole second rounding, P1 section 8.

## 8. Recommended poller shape

None.
A poller could read marks and intervals for every symbol from one catalog call every few seconds, but the index and the funding rate exist only as one socket channel per symbol, and the next settlement time is one countdown for all symbols.
The venue is not recommended for the engine, see [`websocket.md`](./websocket.md) section 8.

## Namesake

The SunX DEX at `sunx.io`, CoinMarketCap id 32630, documents an HTX style REST API at `https://api.sunx.io`, N1.
It answered from this host, P1 section 9.

| call | result |
|---|---|
| `/sapi/v1/public/contract_info` | 288 rows, all `swap` in partition USDT, `contract_status` 1 on 286, `settlement_period` 8 on 164, 4 on 116 and 1 on 8 |
| `/sapi/v1/public/index` | 297 index rows in one call |
| `/sapi/v1/public/batch_funding_rate` | 288 rows in one call, with `funding_rate` and `funding_time`, though `next_funding_time` and `estimated_rate` are null, and this call is not in the documentation index |
| `/sapi/v1/public/funding_rate` | needs `contract_code`, and answers `err_code` 1066 "contract_code cannot be empty." without it |
| `/sapi/v1/index/market/history/linear_swap_mark_price_kline` | a per contract mark candle, the only mark call found |
| `/sapi/v1/market/depth?type=step6` | a 20 level book |
| `/sapi/v1/public/timestamp` | HTTP 404 |

CCXT 4.5.68 has an `htx` class but no class for this DEX, P1 section 10.
It is not the surveyed venue.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The live web bundle `https://sunx.vip/app.86f4b977.js`, its tenant configs and its public REST paths | 2026-10-09 |
| N1 | SunX DEX documentation index, `https://sunx.gitbook.io/sunx/llms.txt`, and its REST pages under `developer/rest/` | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/sunx/rest-probe.py), run twice | 2026-10-09 |
