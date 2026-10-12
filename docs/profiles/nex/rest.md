# NEX Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:07 to 04:28 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public REST surface behind the NEX Exchange web app for its USDT-M perpetuals, with the spot catalog named for context.
NEX publishes no REST documentation, so every call here is one the web bundle makes, see [`fees.md`](./fees.md) section 1.
Numbers come from [`rest-probe.py`](../../../scripts/probes/venues/nex/rest-probe.py) unless a row says otherwise, from its first run and its second pass rerun.

## 1. Host and latency from this machine

| host | role | resolved IPv4 | cold | warm median | evidence |
|---|---|---|---|---|---|
| `n-exchange.io` | web app, static assets | 143.204.1.37, .71, .111, .125, CloudFront | 544 to 688 ms | 48 to 49 ms, a CloudFront cache hit on `robots.txt` | section `hosts` |
| `api.allinpro.com` | spot calls under `/api/spot/`, futures calls under `/futures/web/api/v1/` | 3.169.173.12, .39, .67, .102, CloudFront | 212 to 543 ms | 212 to 213 ms | section `hosts` |
| `user.allinpro.com` | account, configs and recommendation calls under `/v2/` | the same four addresses | 687 to 699 ms | 205 to 216 ms | section `hosts` |
| `ws.allinpro.com` | spot socket | the same four addresses | | | section `hosts` |

Every API reply carried `server: APISIX` and `x-cache: Miss from cloudfront`, so CloudFront passes the calls through to an Apache APISIX gateway uncached.
`n-exchange.io/robots.txt` sets `Crawl-delay: 30` and disallows `/api/*`, `/v2/*` and `/web/api/v1/*`.
The REST probe makes about 80 requests per run at no more than two per second and does not crawl.
No call answered a geoblock or a challenge from this exit.

## 2. Catalog

### The instruments call

`GET https://api.allinpro.com/futures/web/api/v1/market/list` returns every perpetual in one reply of 4,104 bytes, in 206 to 514 ms over the two runs.
It is the call `futureMarketRequest` makes in the bundle chunk `use-futures-data-B4H8DHFW.js`.

| field | meaning | BTCUSDT value |
|---|---|---|
| `name` | market id, the same spelling the socket and the state call use | `BTCUSDT` |
| `type` | 1 on all five, read as linear | 1 |
| `stock`, `money` | base and quote | `BTC`, `USDT` |
| `available` | listing flag, the only status field | true |
| `tick_size`, `amount_min`, `amount_prec` | price step, minimum size and size decimals | `0.01`, `0.0001`, 4 |
| `leverages` | allowed leverage values | 1 to 100 |
| `limits` | risk tiers of position size, maximum leverage and maintenance rate | 9 rows |
| `merges` | book aggregation steps accepted by the depth call and the depth channel | `100`, `10`, `1`, `0.1`, `0.01` |
| `maker_fee`, `taker_fee` | fee rates | `0.0004`, `0.002` |

| settlement asset | listed | `available` true | with any bid or ask | traded in 24 h |
|---|---|---|---|---|
| USDT | 5 | 5 | 0 | 0 |
| USDC, USD or coin | 0 | | | |

The five are BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT and DOGEUSDT.
`GET /futures/web/api/v1/market/depth` returned zero bids and zero asks for every market, both at merge `0` and at its finest merge step, ten reads in all.
`GET /futures/web/api/v1/market/deals` returned 50 trades per market, and the newest on every market was stamped 2026-09-05 06:53:13 to 06:53:20 UTC, 34.9 days before the probe.
The state call reports `volume` 0 on all five.
So the perpetual catalog is listed and flagged available, but the market has not traded for five weeks and has no resting order.

### How CCXT 4.5.68 maps it

There is no CCXT class, see [`fees.md`](./fees.md) section 8.
An adapter would build the catalog from this call: `name` as the raw market id, `stock` and `money` as base and quote, linear, and contract size 1.

### Size unit, pairs listed twice, and the settlement family

`amount_min` 0.0001 on BTCUSDT and 100 on DOGEUSDT read as base coin units, and the deals call reports `amount` 0.0005 BTC on a BTCUSDT trade, so the size unit is the base coin.
This could not be checked against a live book, because every book is empty.
No pair is listed twice, and all five settle in USDT.

### Spot, for context

`GET https://api.allinpro.com/api/spot/tickers` returns 38 pairs, all quoted in USDT, in one reply of 287,792 bytes that embeds 51 hourly candles per pair.
Four pairs, BNT-USDT, CRO-USDT, IWC-USDT and ALEKO-USDT, had 24 h volume 0.
Spot ids are spelled with a hyphen, `BTC-USDT`, while futures ids have none, `BTCUSDT`.

## 3. Anchor

`GET https://api.allinpro.com/futures/web/api/v1/market/state/all` returns every perpetual in one reply of 4,892 bytes, in 383 to 964 ms on the first read of each run and a median of 523 ms over 30 polls in both runs.
The web app reads it at start and then follows the same object on the socket channel `update.state`, see [`websocket.md`](./websocket.md) section 2.

| `AnchorRow` column | field | BTCUSDT value in the first run |
|---|---|---|
| `index` | `index_price` | `82693.90` |
| `mark` | `sign_price` | `76657.29` |
| `funding_rate` | `funding_rate_next`, equal to `funding_rate_last` and `funding_rate_predict` | `-0.00375` |
| `funding_interval_hours` | none. 8, inferred from `next_funding_time` falling on 08:00 UTC | |
| `next_funding_at` | `next_funding_time` in Unix seconds, times 1,000 | 1791619200, 2026-10-10 08:00 UTC |
| `ts` | `server_time` in Unix seconds, times 1,000 | 1791605983 |

Other fields are `last`, `open`, `high`, `low`, `volume`, `amount`, `change`, `period` 86,400, `funding_time` in minutes until the next settlement, `position_amount`, `buy_total`, `sell_total`, `insurance` and `prices`, a list of recent last prices.
`buy_total` and `sell_total` were nonzero, such as 1.1123 and 0.6146 on BTCUSDT, while the depth call showed an empty book, and no source explains them.
The socket's copy adds `orgin_sign_price`, the mark with eight decimals, and `next_funding_timestamp`.

## 4. Anchor semantics

| item | value | label | evidence |
|---|---|---|---|
| index formula and basket | not published, and no basket call was found | Not publicly specified | |
| index against NEX spot | within 1.2 bp of NEX's own spot ticker `price` on all five bases, from -0.9 to 1.2 bp over the two runs | Probed | section `compare` |
| index against Kraken | 1.2 to 10.5 bp above Kraken's USD last on BTC, ETH, SOL and DOGE over the two runs | Probed | section `compare` |
| mark formula | not published | Not publicly specified | |
| mark against index | far below on every market, over the two runs: -320 to -322 bp on ETHUSDT, -377 to -379 bp on BNBUSDT, -729 to -730 bp on BTCUSDT, -1,700 to -1,705 bp on DOGEUSDT and -2,826 to -2,827 bp on SOLUSDT | Probed | section `compare` |
| last against index | -361 to -3,112 bp, because `last` is a price from the final trades five weeks ago | Probed | section `compare` |
| funding formula and cap | not published. The rate is -0.00375 on all five, the same value in all three funding fields | Not publicly specified | |
| upcoming or settled | `funding_rate_next` and `funding_rate_last` are separate fields and were equal | Probed | section `futures` |
| change rate over 30 one-second polls on BTCUSDT | `index_price` and `sign_price` each changed 6 times in the first run and 3 times in the second. The three funding fields and `last` never changed, and `funding_time` changed once in the first run as a minute passed | Probed | section `poll` |

The mark moves with the index but sits far below it, and the rate is pinned at -0.375 % on every market.
Read together, the mark appears to blend the index with the frozen last trade, and -0.375 % appears to be the funding floor.
Neither reading is documented.
The settlement instant was not captured.

## 5. REST book snapshot

| item | perpetuals | spot |
|---|---|---|
| call | `GET /futures/web/api/v1/market/depth?market=BTCUSDT&merge=0` | `GET /api/spot/tickers/depth?symbol=BTC-USDT&merge=step0` |
| reply | `{"code":0,"msg":"success","data":{"index_price":"0","sign_price":"0","time":<ms>,"last":"0","asks":[],"bids":[]}}` on every market | `{"code":0,"msg":"Success","data":{"bids":[{"price","quantity"}],"asks":[...]},"time":<s with decimals>}` |
| levels | 0 and 0 | 11 bids and 5 asks at `step0`, 10 and 5 at `step1`, 9 and 5 at `step2`. A `limit=100` parameter is ignored |
| order | not observable | bids descending and asks ascending |
| caching | `x-cache: Miss from cloudfront`, no `cache-control` | the same |

The depth call's own `index_price` and `sign_price` are "0" on an empty book, so the state call is the only REST source of index and mark.
The BTC-USDT spot book is a ladder of five levels per side at steps of about 0.15 % with sizes growing about 1.25 times per level, plus six stale bids far below the market, from 61,851 down to 1.05.

## 6. Rate limits and errors

No rate limit is published, and no reply carried a rate limit header or `Retry-After`.
No probe drew a limit at two requests per second.

| request | status | body |
|---|---|---|
| futures depth, unknown market `FOOUSDT` | 200 | `{"code": 10011, "msg": "market is not exist", "data": null}` |
| futures depth, no market | 200 | `{"code": 20003, "msg": "market illegal", "data": null}` |
| futures deals, unknown market | 200 | `{"code": 10011, "msg": "market is not exist", "data": null}` |
| spot depth, unknown symbol or no symbol | 200 | `{"code": 1010002, "msg": "Ticker_id is empty", "data": []}` |
| spot publish status, no symbol | 200 | `{"code": 80005, "msg": "symbol is required", "data": [], "time": <s>}` |
| futures, unknown path | 404 | `404 page not found` |

Errors arrive with HTTP 200 and a nonzero `code`, so a poller must read `code` and not only the status.

## 7. Server time and clock offset

No dedicated time call was found.
The state call's `server_time` is whole Unix seconds, and it sat 0.11 s and 1.28 s behind the local request midpoint in the two runs, so it is a coarse clock at best.
The spot depth call's `time` is seconds with six decimals, and it sat 0.02 to 0.03 s ahead of the local midpoint.

## 8. Recommended poller shape

No anchor poller is recommended, because the perpetual books are empty and the market has not traded since 2026-09-05.
If the perpetuals come back to life, the shape is simple: one `GET /futures/web/api/v1/market/state/all` every few seconds covers all five markets, with `index_price`, `sign_price`, `funding_rate_next`, an 8 h interval and `next_funding_time` times 1,000 mapped as in section 3.
The poller must treat a nonzero `code` as an error, and it should prefer the socket's `update.state`, which carries the same object every second.
The venue publishes no documentation of any of this, so an adapter would rest on the web app's calls, which can change with any front end release.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://api.allinpro.com/futures/web/api/v1/market/list`, `market/state/all`, `market/depth` and `market/deals` | 2026-10-09 |
| S2 | `https://api.allinpro.com/api/spot/tickers` and `https://api.allinpro.com/api/spot/tickers/depth` | 2026-10-09 |
| S3 | the bundle chunks `https://n-exchange.io/assets/futures-CKtxs7-I.js` and `https://n-exchange.io/assets/spot-DNnX0UCy.js`, which name the futures and spot REST paths, and `https://n-exchange.io/assets/index-D4ICEk_G.js`, which names the hosts | 2026-10-09 |
| S4 | `https://n-exchange.io/robots.txt` | 2026-10-09 |
| S5 | Kraken `https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD,XDGUSD`, for the index comparison | 2026-10-09 |
