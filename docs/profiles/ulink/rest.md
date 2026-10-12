# Ulink REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers Ulink at `ulinkex.com`, CoinMarketCap id 33326.
Ulink publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The REST calls below are the public ones its own web bundle makes, S2, the same calls the SunX profile found on another tenant of the bundle, see [`../sunx/rest.md`](../sunx/rest.md).
They answer from this host without a challenge, and they return a perpetual catalog with a mark price, but no index, no funding rate and no book.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/ulink/rest-probe.py), P1, run twice, section by section.

## 1. Host and latency from this machine

### Which Ulink

CoinMarketCap has one venue named Ulink, id 33326, slug `ulink`, website `https://ulinkex.com/`, launched 2022-02-28 by its own record, P1 section 1.
It sat at position 249 of 300 in the `exType=0` listing and at 215 and 216 of 230 in the `exType=1` listing over the two runs.
It reports 219 derivatives pairs and 18 spot pairs, and every pair read has `priceExcluded` 1 and `volumeExcluded` 1.

### Hosts

| host | resolved on 2026-10-09 | role | result, P1 sections 2 and 3 |
|---|---|---|---|
| `ulinkex.com`, `www.ulinkex.com` | `174.35.100.116`, `2607:3f40:ff02::5` | the live site and its REST calls | HTTP 200 |
| `www.yyy23hjkk.com` | the same addresses | host and socket of the default Ulink config | HTTP 200, the same page and the same catalog |
| `www.rmex.vip` | no DNS record | `host` field of the Ulink config's base object | name not found |
| `api.ulinkex.com`, `ws.ulinkex.com` | no DNS record | none | name not found |
| `ulinkinc.zendesk.com` | `216.198.53.6`, `216.198.54.6` | help center | HTTP 200 through Cloudflare |

The catalog call took 256 to 514 ms over six tries in two runs, P1 section 4.
One funding countdown call timed out after 30 s in the second run, and every other call answered, P1 section 5.
No geoblock or challenge was seen on any REST call from this Canadian exit.
The socket upgrade on `ulinkex.com` is refused, see [`websocket.md`](./websocket.md) section 1.

## 2. Catalog

### The instruments call

`GET https://ulinkex.com/v1/cfd/public/instruments` returns `{"code":0,"msg":"","data":[...],"success":true}`, about 392,200 bytes, P1 section 4.

| item | value |
|---|---|
| rows | 300 |
| `status` values | `online` 238, `offline` 62 |
| settlement asset | USDT on every online row, `marginCurrencyList` `[{"usdt": "6"}]` |
| symbol spelling | lower case base and quote with no separator, `btcusdt`, the string the socket channels use |
| contract size | `oneLotSize` in base units: 0.001 BTC, and 0.01 on 58 rows, 1 on 54, 0.1 on 51, 10 on 35, 100 on 21, 1,000 on 8 and 100,000 on 1 |
| minimum order | `minSize` 1 lot on every online row |
| leverage | `maxLeverage` 100 on 207 rows, 150 on 22, 20 on 4, 200 on 2, 30 on 2 and 75 on 1 |
| book aggregation | `orderBookLevel`, such as `[0.1, 1, 10]` for BTC, the steps the socket's `_depth_level<n>` channels use |
| non-crypto rows online | `xauusdt` Gold, `xagusdt` Silver, `tslausdt` Tesla, `aaplusdt` Apple and `nvdausdt` Nvidia |
| pairs listed twice | none |
| other fields | `lastPrice`, `markPrice`, `settledAt`, `settlementRate`, `fundingIntervalHours`, `takerFee`, `makerFee`, `commissionRate`, `openSpread`, `closeSpread`, `configBo` |

The same call on `www.yyy23hjkk.com` returned the same 300 rows, P1 section 4.

### How CCXT maps it

No CCXT class exists, so there is no `market.id`, `contractSize`, `linear` or `active` to compare.
An adapter would build its own catalog from this call, with `symbol` as the raw id and `oneLotSize` as the contract size.

### Spot, for the coverage matrix

`GET /v1/cfd/public/spot_instruments` returns 18 rows, all `online`, about 13,020 bytes, with `takerFee` and `makerFee` 0.001 on each, P1 section 7.
The bundle's `/v1/spot/public/products` and `/v1/spot/public/tickers` answer HTTP 404 on this host.

## 3. Anchor

No REST call returns an index price or a funding rate.

| `AnchorRow` column | where | value seen | label |
|---|---|---|---|
| index | socket `market_btcusdt_index_price` only, one channel per symbol | BTC 82,669.34 and 82,685.46 in the two runs | Probed, see [`websocket.md`](./websocket.md) section 2 |
| mark | catalog `markPrice`, every perpetual at once | BTC 0.48 bp below OKX's mark in the first run and 0.06 bp below in the second | Probed |
| funding rate | socket `market_Pu8g.btcusdt_funding_rate` only, field `fr` | BTC -0.00002057 to -0.00002012 | Probed |
| interval | catalog `fundingIntervalHours` | 8 on 150 rows, 4 on 88 rows | Probed |
| next settlement | `GET /v1/cfd/public/funding/countdown`, seconds | 10,508 at 05:04:51 UTC and 10,261 at 05:08:58 UTC, both pointing to 07:59:59 UTC | Probed |

The countdown gave the same number for `/btcusdt` and `/dogeusdt` in the first run, so it does not tell symbols apart, and it cannot be right for both 8 hour and 4 hour symbols at every instant, P1 section 5.
The catalog's `settledAt` pointed to 2026-10-10 20:00:00 UTC on all 238 online rows, 14.85 to 14.92 hours ahead, which is longer than any funding interval.
It and `settlementRate` 0.0002 match the Lightning Contract's 04:00 UTC+8 overnight fee of [`fees.md`](./fees.md) section 6, which is an inference.
ETH, SOL and DOGE marks sat within 3.3 bp of OKX's marks in both runs, P1 section 5.
The socket index sat 4.84 bp above the socket mark in the first run, and the best bid sat 4.06 to 4.88 bp below the index, see [`websocket.md`](./websocket.md) section 4.
The settlement instant itself was not captured, because the survey does not wait for clock events.

## 4. Anchor semantics

- Index formula and basket: a trading volume weighted average of "Huobi, Biance, Okex, Bittrex, HitBTC, Gate.io, Bitmax, Poloniex, FTX, MXC", S1.
  A source gets zero weight when it deviates more than 5 % from the median of all sources or sends no trade for 10 s.
  The list still names FTX, and the article was last updated on 2023-08-07.
- Mark formula, S1: the median of price 1, price 2 and the contract price, where price 1 is index times (1 + funding rate times hours to the next funding over 8), and price 2 is index plus a 30 minute moving average of mid minus index, sampled every minute.
  In extreme conditions price 2 is used alone.
- Funding formula: premium index plus clamp(interest rate minus premium index, 0.05 %, -0.05 %), with an absolute cap of 0.15 %, S1.
- No basket call is public.
- Whether `fr` is the upcoming or the last settled rate: Not verified.
- Change rate over 15 polls 2 s apart, in two runs, P1 section 6: BTC `lastPrice` changed 7 to 11 times and `markPrice` 12 to 14 times, ETH 7 to 11 and 8 to 12, DOGE 4 to 9 and 9 to 10.
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
The `Date` header sat 0.1 to 0.4 s behind the host clock, which includes the request time and the header's whole second rounding, P1 section 8.

## 8. Recommended poller shape

None.
A poller could read marks and intervals for every symbol from one catalog call every few seconds, but the index and the funding rate exist only as one socket channel per symbol, and the next settlement time is one countdown for all symbols.
The venue is not recommended for the engine, see [`websocket.md`](./websocket.md) section 8.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | "Ulink Perpetual Contract Guides", `https://ulinkinc.zendesk.com/hc/en-us/articles/7617336092815-Ulink-Perpetual-Contract-Guides`, updated 2023-08-07 | 2026-10-09 |
| S2 | The live web bundle `https://ulinkex.com/app.e941a78f.js`, its tenant configs and its public REST paths | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/ulink/rest-probe.py), run twice | 2026-10-09 |
