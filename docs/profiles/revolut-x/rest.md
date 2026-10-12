# Revolut X REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Vancouver, Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
Revolut X lists spot only, so this file records the spot catalog, the spot REST book and the venue's index price, per change 1 of the survey plan's template.
Every public call answered from this host without credentials.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/revolut-x/rest-probe.py), whose sections are named below.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| base URL | `https://revx.revolut.com/api/`, with `1.0` or `2.0` as the first path segment | S1 |
| resolved address | `34.54.59.116`, one A record | section host |
| front | Google Cloud load balancer, `Via: 1.1 google`, HTTP/3 offered in `Alt-Svc` | section host |
| cold request, new TLS connection | 276 ms and 298 ms in two runs | section host |
| warm request, kept-alive connection | median 240 ms and 232 ms in two runs, 213 ms to 275 ms | section host |
| order book call, warm | 157 ms to 206 ms | section book |
| refusal from this exit | none on `/public/` paths, HTTP 401 `{"message":"Unauthorized",...}` on unsigned private paths | section other |

The response headers carry a `request-id` and no rate limit header.

## 2. Catalog

### The instruments call

`GET /api/1.0/public/configuration/pairs` returns a map keyed by `BASE/QUOTE`, S2.
Each value has `base`, `quote`, `base_step`, `quote_step`, `min_order_size`, `max_order_size`, `min_order_size_quote`, `max_order_size_quote`, `status` and `slippage`, section catalog.
`region` filters it, and without `region` it returns both regions merged, S2.

| call | pairs | `status` | active by quote |
|---|---|---|---|
| no region | 455 | all `active` | USD 307, GBP 64, EUR 61, USDC 23 |
| `region=UK` | 393 | all `active` | USD 306, GBP 64, USDC 23 |
| `region=EEA` | 384 | all `active` | USD 300, EUR 61, USDC 23 |

322 pairs are in both regions, 71 only in UK and 62 only in EEA, and the unfiltered map is exactly their union.
GBP pairs exist only in UK and EUR pairs only in EEA.
A few USD pairs are regional too, for example `PAXG/USD`, `USDT/USD` and `XAUT/USD` only in UK, and `PUMP/USD` only in EEA.
No `status` other than `active` was seen, so the value a halted or delisted pair takes is Not verified.
`GET /api/1.0/public/configuration/currencies` lists 310 currencies, 307 `crypto` and 3 `fiat`, with `symbol`, `name`, `scale`, `asset_type` and `status`.

No pair is a perpetual, a future or an option.
That, with the absence of any derivative endpoint in S1, is how the venue's lack of perpetuals was established.

### Symbol forms

| place | form | evidence |
|---|---|---|
| catalog key, tickers `symbol`, trades `symbol` | `BTC/USD` | sections catalog, tickers, other |
| order book path | `BTC-USD`, and `BTCUSD` answers 400 "No such pair: BTCUSD" | section book |
| tickers `symbols` filter | `BTC-USD,ETH-USD` | section tickers |

Revolut's own LLM reference states the same split, S3.

### How CCXT maps it

CCXT 4.5.68 has no Revolut class, see [`fees.md`](./fees.md) section 8.
CCXT master's `revolutx` class, S5, loads the unfiltered pairs map at line 368 and builds `market.id` as `base + '-' + quote` at line 390, so `id` is the path form `BTC-USD` and `symbol` is `BTC/USD`.
It sets `'contractSize': undefined` at line 313 and `'linear': undefined` at line 314, as a spot class should, and `active` from `status === 'active'` at line 303.
Its `region` option defaults to `undefined` at line 122, so its catalog mixes both regions, and a symbol in both regions appears once.

### Regions

Each region has its own book.
In one tickers reply, `BTC/USD` showed bid 82509.71 in UK and 82514.24 in EEA with the same ask 82522.06, section tickers.
The book call without `region` resolved `BTC-USD` to EEA, as S2 says.
For `BTC-GBP`, a UK-only pair, it resolved to UK, and `BTC-EUR` with `region=UK` answered 400 "Couldn't find currency pair BTC/EUR", section book.
So a symbol that exists in both regions needs `region` named to pick the book, and the reply's `metadata.region` says which one came back.

## 3. Anchor

Revolut X publishes no mark price and no funding rate, because it has no perpetuals.
It does publish an index price.
`GET /api/1.0/public/tickers` returns `index_price` on every row, described as "The consolidated fair market value for the asset, calculated as a real-time, volume-weighted average of spot prices across constituent external exchanges", S4.
The constituent exchanges and their weights are Not publicly specified.

| call | rows | bytes | time | evidence |
|---|---|---|---|---|
| no filter | 777, one per pair and region, 393 UK and 384 EEA | about 197,000 | 398 ms and 466 ms | section tickers |
| `region=UK` | 393 | about 99,100 | 255 ms and 257 ms | section tickers |
| `region=EEA` | 384 | about 97,800 | 271 ms and 309 ms | section tickers |
| `symbols=BTC-USD,ETH-USD` | 4, both regions | about 1,070 | 189 ms and 204 ms | section tickers |

No row lacked `index_price`.
The same pair carried the same `index_price` in both regions within one reply.
Each row also has `bid`, `ask`, `mid`, `last_price`, `low_24h`, `high_24h`, `price_change_24h`, `volume_24h`, `quote_volume_24h` and `region`, and `metadata.timestamp` is in epoch milliseconds.

No anchor poller is recommended, since the engine's anchor is a perpetual's index, mark and funding, and this venue has none.

## 4. Anchor semantics

Not offered for mark and funding.
For the index, the section poll sampled `BTC/USD` in EEA 22 times over 60 s, one call about every 2.8 s, in each of two runs.
`index_price` changed on 20 of the 21 consecutive pairs of samples in both runs, while the ticker `bid` changed on 5 and 8.
So the index updates at least every few seconds.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /api/2.0/public/order-book/{symbol}?limit=&region=` | S2 |
| default depth | 50 levels a side | section book |
| depth range | 1 to 192, and 0, 193, 500 and 1000 answer 400 "Limit must be between 1 and 192" | section book |
| level shape | `{"price":"82512.87","quantity":"...","count":1}`, strings for price and quantity, an integer order count | section book |
| level order | bids descending, asks ascending, as S2 says | section book |
| size unit | base currency, so BTC for `BTC-USD` | S2, section book |
| book time | `metadata.timestamp`, epoch milliseconds, and `metadata.region` | section book |
| sequence or update id | none | section book |
| caching | no `Cache-Control` header, and `metadata.timestamp` changed on 21 of 21 consecutive polls about 2.8 s apart | sections book and poll |
| unknown symbol | HTTP 400 `{"message":"No such pair: NOPE-USD","error_id":"...","timestamp":...}` | section book |
| bad region | HTTP 400 "Unable to parse value: 'US'" | section book |

Over the same 60 s, the top five levels of `BTC-USD` changed on 11 and 15 of 21 polls in the two runs, the best bid on 4 and 8, and the best ask on 3 both times, section poll.
The deprecated `GET /api/1.0/public/order-book/{symbol}` still answers with at most 5 levels a side in an abbreviated schema, such as `"s":"BUYI"`, `"p"`, `"q"`, `"no"` and an ISO-8601 `pdt`, S6, section book.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| public calls | 1 token, refilled at 1 token a second, each request costs 1, on every public operation page | S2, S4 |
| whether the bucket is per call or shared | Not publicly specified | S1 |
| older statement | "20 requests per 10 seconds" for the public last trades and order book calls, in the LLM reference | S3 |
| over the limit | HTTP 429, and "The `Retry-After` header specifies the delay in milliseconds" | S2 |
| limit headers on a normal reply | none | section host |
| error body | `{"message":...,"error_id":"<uuid>","timestamp":<ms>}` | sections book and other |

The probe spaced every request by at least 1.25 s, so no 429 was provoked and its body was not captured.

## 7. Server time and clock offset

No server time call is published, S1.
`metadata.timestamp` of the tickers call read 640 ms to 659 ms ahead of the local midpoint of each request across two runs, section clock.
The one second `Date` header agreed with the local clock within its resolution.

## 8. Recommended poller shape

None for the perpetual engine, since the venue lists no perpetuals and publishes no socket.
For a future spot leg, the catalog would come from `configuration/pairs` per region, and books from the 2.0 book call per symbol and region.
At one request a second, one full pass over the 455 pairs would take about 8 minutes, so a REST book feed could watch only a handful of pairs.
The tickers call returns best bid and ask for every pair and region in one reply, which at one call a second gives top of book without depth.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Revolut X Crypto Exchange REST API reference, https://developer.revolut.com/docs/api/revolut-x-crypto-exchange | 2026-10-09 |
| S2 | Get order book and Get currency pairs operation pages, https://developer.revolut.com/docs/api/revolut-x-crypto-exchange/operations/get-order-book-public.md and https://developer.revolut.com/docs/api/revolut-x-crypto-exchange/operations/get-currency-pairs-public.md | 2026-10-09 |
| S3 | Revolut X REST API reference for LLMs, official repository, https://github.com/revolut-engineering/revolut-x-api/blob/master/revolut-x-api-for-llm.md | 2026-10-09 |
| S4 | Get tickers operation page, https://developer.revolut.com/docs/api/revolut-x-crypto-exchange/operations/get-tickers-public.md | 2026-10-09 |
| S5 | CCXT master `revolutx` class at `f0aca06eb748`, https://github.com/ccxt/ccxt/blob/master/ts/src/revolutx.ts | 2026-10-09 |
| S6 | Get order book (deprecated) operation page, https://developer.revolut.com/docs/api/revolut-x-crypto-exchange/operations/get-public-order-book-deprecated.md | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/revolut-x/rest-probe.py), all seven sections, run twice | 2026-10-09 |
