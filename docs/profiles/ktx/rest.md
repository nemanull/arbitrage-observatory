# KTX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 02:44 to 03:11 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers KTX's public REST surface for its one perpetual family, USDT-M linear perpetuals, market `lpc`.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/ktx/rest-probe.py) or [`anchor-probe.py`](../../../scripts/probes/venues/ktx/anchor-probe.py) unless a source row is named.
Market data lives under `https://api.ktx.com/api` and private calls under `https://api.ktx.com/papi`, S1.

## 1. Host and latency from this machine

| host | role | resolved address | cold request | warm request |
|---|---|---|---|---|
| `api.ktx.com` | REST, `/api` public and `/papi` private | `104.26.2.247`, `104.26.3.247`, `172.67.70.250`, Cloudflare | 250 to 695 ms over two runs, `GET /api/v1/ping` on a new TLS connection | 222 to 304 ms, medians 226 and 233 ms |
| `api.ktx.news` | backup host from `GET /api/v1/pu/domains` | `104.21.63.160`, `172.67.171.12` | `GET /api/v1/time` answered 200 in 642 and 675 ms | |
| `api.ktx.exchange` | backup host | `104.21.8.166`, `172.67.139.201` | `GET /api/v1/time` answered 200 in 679 and 705 ms | |
| `m-stream.ktx.com` | WebSocket | the same addresses as `api.ktx.com` | see [`websocket.md`](./websocket.md) | |

Every reply carried `server: cloudflare` and a `CF-RAY` ending in `YVR`, the Vancouver edge.
A reply served from Cloudflare's cache came back in 14 to 55 ms, so the warm figure above is the origin round trip.
No call was refused from the Canadian exit, see [`fees.md`](./fees.md) section 1 for the trading restriction.

## 2. Catalog

### The instruments call

`GET /api/v1/products?market=lpc` returns every perpetual in one reply of about 159 KB, S1.
The `market` parameter defaults to `spot`, so a call without it returns the 185 spot pairs.

| field | value on the wire |
|---|---|
| rows | 263 |
| `active` | 1 on 234 contracts, 0 on 29 |
| `market` | `lpc` on every row |
| `symbol` | `BTC_USDT_SWAP` style, every id ending `_USDT_SWAP` |
| settlement asset | USDT on all 263 |
| `makerFee`, `takerFee` | `0.0004` and `0.0006` on every row |
| `mini` | 1 on 26 contracts, the MINI taker mode of [`fees.md`](./fees.md) section 3 |
| `markMethod` | `Fair Price` on every row |
| `followFundingRate` | 1 on 146, 0 on 117 |
| contract size | no field. Sizes are in base coin units, see [`websocket.md`](./websocket.md) section 4. |
| `priceIncrement`, `quantityIncrement`, `minOrderSize`, `maxOrderSize` | per contract |
| funding | `markPrice`, `fundingRate`, `predictedFundingRate`, `prevFundingTime`, `nextFundingTime`, `time` on every row, section 3 |

The 29 inactive contracts are EOS, TON, MKR, AERGO, ZKJ, FUN, OXT, PAXG, SIREN, FLOW, JST, LRC, HAEDAL, LINEA, IN, RPL, MOVE, BABY, KNC, SXP, ICX, STORJ, FLM, EUL, EDEN, MIRA, STRK, RVV and COMMON.
`market=ipc`, `lfc` and `ifc` answer 200 with an empty list, and `market=swap` answers `{"msg":"Invalid parameter 'market'","state":-12015}`.
So the API names coin-margined perpetuals and dated futures but lists none.
`symbol=BTC_USDT_SWAP` narrows the reply to one row of 639 bytes.

### How CCXT maps it

CCXT 4.5.68 has no KTX class, and CCXT master has none either, see [`fees.md`](./fees.md) section 8.
So the catalog has to be read natively, which is what the Rust adapters do anyway, as in [`gate/markets.rs`](../../../server/src/venues/gate/markets.rs).
A native mapping is direct: `symbol` is the id, the base is the part before the first `_`, the quote is USDT, `linear` is true, `active` is `active` 1, and the contract size is 1.

### Size unit, pairs listed twice, and price scale

No base is listed twice.
The id the catalog prints is the id the socket stream, the REST book and the anchor use, with no case change.
No contract is quoted per 10 or per 1000 units, and no `1000` prefix appears in the ids.

## 3. Anchor

### The bulk calls

| call | rows | reply | fields |
|---|---|---|---|
| `GET /api/v1/products?market=lpc` | 263 | about 159 KB, 241 to 324 ms when fresh | `markPrice`, `fundingRate`, `predictedFundingRate`, `prevFundingTime`, `nextFundingTime`, `time` |
| `GET /api/v1/pu/contracts` | 263 | about 110 KB, 274 to 1,243 ms when fresh | `index_price`, `funding_rate`, `funding_interval` in seconds, `next_funding_rate_timestamp`, `open_interest`, `bid`, `ask`, `last_price` |

Both calls are documented, S1, and both are cached by Cloudflare, which section 4 shows to matter.
`pu/contracts` is a separate backend: its replies are `application/json` from nginx and carry `x-ratelimit-limit` 2000, `x-ratelimit-remaining` and `x-ratelimit-reset`, while `products` replies are `text/plain` and carry `ktx-usage`.

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| index | `markPrice` from `products` | KTX publishes one reference series, see section 4 |
| mark | `markPrice` from `products` | the same number |
| funding rate | `fundingRate` from `products`, a fraction per interval | equal to `pu/contracts` `funding_rate` on 234 of 234 active contracts when both were read fresh |
| funding interval hours | (`nextFundingTime` minus `prevFundingTime`) / 3,600,000 | equal to `pu/contracts` `funding_interval` on all 263 |
| next funding at | `nextFundingTime`, Unix ms | equal to `next_funding_rate_timestamp` on all 263 |
| ts | `time`, Unix ms, the row's own stamp | 1.1 s old on a fresh read |

So one call, `products?market=lpc`, fills every column.

## 4. Anchor semantics

### Index and mark

The help center says the mark price "is composed of a basket of prices from major spot trading markets (such as OKX, Binance, HTX, Bybit, etc.)" and is "a comprehensive price index obtained by calculating with the trading volume weighted", S2.
So the published mark is itself the spot index, with no premium component documented.
The wire agrees: `pu/contracts` `index_price` and `products` `markPrice`, read fresh back to back, were equal on 153, 234 and 121 of the 234 active contracts in three rounds of the first run, and on 203, 198 and 205 in the second pass, with a median gap of 0 ppm every round.
The unequal ones differed by up to 3,867 ppm, which fits two samples of one series a few hundred milliseconds apart.
Across 60 one-second polls of BTC in the first run both fields moved through the same values, `82596.2`, `82614.2` and `82604.2`, with `pu/contracts` trailing.
In the second pass both held `82562` through all 60 polls.
The fresh BTC mark sat 56 ppm above the REST book mid in the first run and 53 ppm above it in the second pass.
The basket, its weights and its update period are Not publicly specified, and no basket call exists.

### Funding

The formula is "Funding Fee = Position Value × Funding Rate", S3, and the rate formula itself is Not publicly specified.
`fundingRate` is the rate the engine needs.
On the 126 active contracts with `followFundingRate` 1 that Binance USD-M also lists, `fundingRate` equalled Binance's live `lastFundingRate` on 97 and sat within 0.000002 of it on 103.
The rest differed by more, WIF at 0.00002 against 0.00001788, which fits a copy refreshed less often than Binance's own estimate.
Binance's field moves inside the period toward its upcoming settlement, so on the followed contracts `fundingRate` tracks the upcoming rate, not the last settled one.
On the 108 contracts with `followFundingRate` 0 it matched Binance on only 36, BTC among the misses at 0.0001 against Binance's 0.00002073.
Whether those contracts publish an upcoming or a settled rate is not established, because the rate did not move in any read.
`predictedFundingRate` differed from `fundingRate` on 66 active contracts, often sitting at the 0.0001 or 0.00005 baseline, and its meaning is Not publicly specified.
The interval is 8 h on 141 contracts, 4 h on 120 and 1 h on KAIA and ICX, and the three `nextFundingTime` values seen sat on the UTC hour grid of their interval.

### Rate across a settlement

Not captured, because the survey does not wait for a settlement.

### How often each number changed

| number | 60 polls paced at one per second, BTC_USDT_SWAP |
|---|---|
| `markPrice` | 2 changes and 3 distinct values in the first run, no change in the second pass |
| `fundingRate` | no change, `0.0001` |
| `predictedFundingRate` | no change, `0.0001` |
| row `time` | 1.3 to 32.2 s old at read over both runs, median 4.4 s in each, with every read a Cloudflare HIT |

## 5. REST book snapshot

`GET /api/v1/order_book?market=lpc&symbol=BTC_USDT_SWAP&level=20`, S1.

| item | value |
|---|---|
| levels | 1, 2, 5, 10, 20, 50, 100, 200, 500 or 1000, default 100. `level=3` answers `{"msg":"Invalid parameter 'level': should be 1, 2, 5, 10, 20, 50, 100, 200, 500 or 1000","state":-12015}`. |
| depth served | `level=500` and `level=1000` returned 193 to 201 levels a side across two runs, so the BTC book holds about 200 levels a side |
| order | bids descending, asks ascending |
| fields | `b`, `a`, `t` in ms, and `i`, the same per symbol id the socket sends |
| `price_scale` | merges prices, `price_scale=2` gave levels 10 apart |
| unknown symbol | `{"msg":"Product 'NOPE_USDT_SWAP' doesn't exist","state":-20001}` with HTTP 200 |
| inactive symbol | `{"result":{"a":[],"b":[],"t":"1747880257526","i":47014372},"state":0}` |
| caching | `cache-control: public, max-age=0, stale-while-revalidate=10` |

Cloudflare cached the `level=20` URL and once served it 217 s old, with `cf-cache-status: HIT` and `age: 216`, while the other levels came back `DYNAMIC` and under 1 s old.
Later reads of `level=20` were 0.9 to 1.0 s old, so the stale reply was the first hit after the URL sat idle.
Adding any unused query parameter, such as `&_=<ms>`, made every read `DYNAMIC` and 0.6 to 0.7 s old.
The book stamp `t` shows the age, so a client can check it.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| request limit | 10,000 requests per 10 s per IP, beyond which the answer is `-20007` | S1 |
| CPU limit | 10,000 units per 10 s per IP, reported as `ktx-usage: T1:T2:T3`, beyond which the answer is `-20006` | S1 |
| `ktx-usage` seen | `1:1:0` on ping, ticker and book, `4:4:0` on the full catalog | Probed |
| `pu/contracts` limit | `x-ratelimit-limit: 2000`, remaining 1999 to 1993 during the run, no window documented | Probed |
| `Retry-After` | never sent | Probed |
| error shape | HTTP 200 with `{"msg":"...","state":<code>}`, for example `-12013` missing parameter, `-12015` invalid parameter, `-20001` unknown product | S1, Probed |
| unknown path | HTTP 404 with an nginx HTML page | Probed |
| private call without a key | `GET /papi/v1/trade/accounts` answers `{"msg":"Missing header 'api-expire-time'","state":-12023}` | Probed |

No limit was reached, since the probes sent at most 2 requests per second.

## 7. Server time and clock offset

`GET /api/v1/time` returns `{"result":{"time":"1791601065712"},"state":0}`, a string in ms.
Five reads in each of two runs put the server 38 to 46 ms ahead of this host, medians 38 and 44 ms, against the round trip midpoint.

## 8. Recommended poller shape

| item | value |
|---|---|
| URL | `https://api.ktx.com/api/v1/products?market=lpc&_=<ms>` |
| cache busting | append an unused `_` parameter that changes every round, because a plain URL can return a Cloudflare copy minutes old, 139 to 214 s on the first read of a run |
| interval | 2 s, about 80 KB per second, far inside the 10,000 per 10 s limit |
| row mapping | section 3, one call fills index, mark, funding rate, interval, next settlement and `ts` |
| skip | rows with `active` 0 |
| freshness check | drop a row whose `time` is more than 10 s old. Fresh reads were 1.1 s old. |
| fallback | `pu/contracts?_=<ms>` carries `index_price`, `funding_rate`, `funding_interval` and `next_funding_rate_timestamp`, but no row stamp |

The mark doubles as the index, so the engine's basis against index reads as basis against KTX's mark.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | KTX API doc (v4), `https://ktx-private.github.io/api-en/`, sections "Traffic restriction", "Market Data Endpoints" and "Errors" | 2026-10-09 |
| S2 | "Mark Price", `https://support.ktx.com/hc/en-001/articles/4775423250462`, updated 2026-04-16 | 2026-10-09 |
| S3 | "Funding Rate", `https://support.ktx.com/hc/en-001/articles/4782607314078`, updated 2026-04-16 | 2026-10-09 |
