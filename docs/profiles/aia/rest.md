# AIA Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
AIA Exchange publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The REST calls below are the public ones its own web bundle makes on `aianalysisexchange.com`.
They answer from this host without a challenge, and they return a perpetual catalog with a mark price and a settlement time, but no index and no book.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/aia/rest-probe.py), section by section.

## 1. Host and latency from this machine

| host | resolved on 2026-10-09 | role | result, P1 sections 1 and 2 |
|---|---|---|---|
| `aianalysisexchange.com`, `www.aianalysisexchange.com` | `138.113.149.170` | the live site and its REST calls, behind a CDN whose headers say `Cdn Cache Server V2.0` | HTTP 200 |
| `api.`, `ws.` and other names under `aianalysisexchange.com` | the same address, through wildcard DNS | none | certificate does not cover the name |
| `m.aianalysisexchange.com` | `92.205.3.168` | the host the bundle sends mobile visitors to, served by Apache | HTTP 500 with WordPress's error text "There has been a critical error on this website." |
| `www.cryptoex.aianalysis.co.uk` | `13.248.213.45`, `76.223.67.189` | the bundle's configured `host` and socket | TLS alert `unrecognized name` |
| `aiaexchange.com`, `www.aiaexchange.com` | `13.223.25.84`, `54.243.117.197` and two IPv6 addresses | an unrelated parked domain | `www` answers 302 to `hugedomains.com/domain_profile.cfm?d=aiaexchange.com`, and the bare name dropped the TLS handshake in the first run and answered the same 302 in the second |

CoinMarketCap names `https://aianalysisexchange.com` as the website of AIA Exchange, see [`fees.md`](./fees.md) S1.
The bundle sets `api` to an empty string, so every REST call goes to the page's own origin.
The catalog call took 746 to 978 ms over six tries in two runs, with no steady gap between cold and warm, and small replies took 600 to 840 ms, P1 sections 4 and 5.
No geoblock or challenge was seen on any REST call from this Canadian exit.

## 2. Catalog

### The instruments call

`GET https://aianalysisexchange.com/v1/cfd/public/instruments` returns `{"code":0,"msg":"","data":[...],"success":true}`, 94,955 to 94,989 bytes, P1 section 4.

| item | value |
|---|---|
| rows | 73 |
| `status` values | `online` 23, `offline` 50 |
| online symbols | btcusdt, ethusdt, ltcusdt, bchusdt, trxusdt, filusdt, linkusdt, xrpusdt, dogeusdt, shibusdt, adausdt, solusdt, bnbusdt, avaxusdt, uniusdt, arbusdt, pepeusdt, xaiusdt, hypeusdt, wlfiusdt, pumpusdt, lineausdt, asterusdt |
| settlement asset | USDT on every row, `marginCurrencyList` `[{"usdt": "6"}]` |
| symbol spelling | lower case base and quote with no separator, `btcusdt`, the same string the socket channels use, see [`websocket.md`](./websocket.md) section 2 |
| contract size | `oneLotSize` in base units: 0.001 BTC, 0.01 ETH, 100 DOGE, 1,000 PEPE, and so on per symbol |
| minimum order | `minSize` 1 lot on every online row |
| leverage | 5 to 100 on every online row |
| other fields | `lastPrice`, `markPrice`, `settledAt`, `settlementRate`, `fundingIntervalHours`, `takerFee`, `makerFee`, `commissionRate`, `openSpread`, `closeSpread`, `orderBookLevel`, `configBo.margins` |

Two offline rows are `xauusdt` "Gold (Derivatives)" and `xagusdt` "Silver (Derivatives)".
No pair is listed twice.

### How CCXT maps it

No CCXT class exists, so there is no `market.id`, `contractSize`, `linear` or `active` to compare.
An adapter would have to build its own catalog from this call, with `oneLotSize` as the contract size.

### Spot, for the coverage matrix

`GET /v1/cfd/public/spot_instruments` returns 20 rows, all `online`, 14,449 to 14,452 bytes, P1 section 7.
The paths `/v1/spot/public/products` and `/v1/spot/public/tickers`, which the bundle also names, return HTTP 404.

## 3. Anchor

No call returns an index price.
The catalog call returns, for every perpetual at once:

| `AnchorRow` column | field | value seen | label |
|---|---|---|---|
| index | none in REST, the socket channel `market_btcusdt_index_price` only | | Not verified |
| mark | `markPrice` | BTC 82,528.7 beside `lastPrice` 82,528.6 in the first run | Probed |
| funding rate | `settlementRate`, labelled "Overnight Rate" in the bundle | 0.0002 on all 23 online rows | Probed, meaning Not publicly specified |
| interval | `fundingIntervalHours` | 8 on 17 rows, 4 on 6 rows | Probed |
| next settlement | `settledAt` in ms | 2026-10-10 04:00:00 UTC on all 23 rows, including the 4 hour ones | Probed |

`GET /v1/cfd/public/funding/countdown` returns `{"code":0,"msg":"","data":15621,"success":true}`, seconds to the next settlement, P1 section 5.
At 03:39:38 UTC it pointed to 07:59:59 UTC, while `settledAt` in the same minute pointed to 04:00:00 UTC.
The second run at 03:45:10 UTC gave the same two times.
Appending `/btc`, `/btcusdt` or `/pump` gave the same count, so the call does not tell symbols apart.
The two times disagree, and no document says which one is the settlement.
The settlement instant itself was not captured, because the survey does not wait for clock events.

## 4. Anchor semantics

- Index: no formula, basket or basket call is published.
- Mark: no formula is published.
  The three marks compared with OKX's swap marks sat within 3 bp in both runs: BTC -0.84 and -0.52 bp, ETH 1.08 and 1.29 bp, SOL 1.83 and 2.74 bp, P1 section 5.
  CoinMarketCap marks every AIA spot pair `priceExcluded` and `volumeExcluded`, see [`fees.md`](./fees.md) section 3.
- Funding: no formula or cap is published.
  `settlementRate` was 0.0002 on every online row and never changed during the polls, so it reads as a fixed overnight charge rather than a market funding rate.
  Whether it is the upcoming or the last settled rate is Not verified.
- How often each number changed over 20 polls 3 s apart, 76 and 77 s in the two runs, P1 section 6:

| symbol | `lastPrice` changes | `markPrice` changes | `settlementRate` changes | `settledAt` changes |
|---|---|---|---|---|
| btcusdt | 13 and 14 | 13 and 10 | 0 | 0 |
| ethusdt | 8 and 12 | 13 and 12 | 0 | 0 |
| dogeusdt | 11 and 10 | 17 and 13 | 0 | 0 |

## 5. REST book snapshot

None.
The bundle names no REST depth or order book path, P1 section 3, and loads its book only from the socket channel `market_expf.<symbol>_depth_step0`.

## 6. Rate limits and errors

No rate limit is published, and no reply carries a limit or `Retry-After` header, P1 section 8.
No limit was hit at the probe's pace of about one request per 3 s.

| case | status | body |
|---|---|---|
| unknown path | 404 | `{"code":404,"msg":"Requested address does not exist","data":null,"success":false}` |
| missing parameter, `/v1/asset/public/exchange/rate` | 400 | `{"code":904,"msg":"Method parameters verification failed","data":null,"success":false}` |
| private call without a token, `/v1/users/profile` | 401 | `{"code":401,"data":null,"msg":"Unauthorized access is not allowed"}` |

Replies carry `cache-control: no-cache, no-store`, an `x-envoy-upstream-service-time` header and the CDN's `x-ws-request-id`.

## 7. Server time and clock offset

No server time call is known.
The `Date` header was 0.7 s and 1.2 s behind the host clock in the two runs, about the header's one second resolution, P1 section 8.

## 8. Recommended poller shape

None for the engine as it stands, because the venue has no reachable book feed, see [`websocket.md`](./websocket.md) section 8.
If the socket became reachable, one poll of `/v1/cfd/public/instruments` every few seconds would give mark, interval and a settlement time for all 23 perpetuals in about 95 KB.
It would leave the index column empty, and `settlementRate` would need its meaning confirmed before it is stored as funding.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The live web bundle `https://aianalysisexchange.com/app.87b0b8bc.js`: the tenant config module 623, with exId `expf`, `host` and `ws` on `www.cryptoex.aianalysis.co.uk`, and the public REST paths listed in P1 section 3 | 2026-10-09 |
| S2 | OKX public mark price, `https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=<BTC, ETH, SOL>-USDT-SWAP`, for comparison only | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/aia/rest-probe.py), run twice, about 45 requests over about 80 s | 2026-10-09 |
