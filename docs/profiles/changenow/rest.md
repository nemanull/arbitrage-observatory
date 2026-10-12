# ChangeNOW REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 04:10 to 04:20 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada (`ipinfo.io` reports AS212238 Datacamp Limited).

ChangeNOW lists no perpetuals, so the researched product is its spot conversion service, see [`fees.md`](./fees.md) section 3.
ChangeNOW is an instant swap service with no order book.
Its API answers from the Canadian exit, and several documented calls work without an API key: the currency lists, the pair list, the minimum amount and the floating-rate quote.
None of them returns a book, a trade, an index, a mark or a funding rate.
Every probed fact below comes from [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py), with the quote measurements from [`fees-probe.py`](../../../scripts/probes/venues/changenow/fees-probe.py).

## 1. Host and latency from this machine

### DNS

| host | resolved | note |
|---|---|---|
| `api.changenow.io` | 104.20.30.56, 172.66.171.200, and two IPv6 addresses | Cloudflare, the API host of the documentation, S2 |
| `changenow.io`, `vip-api.changenow.io`, `notifier.changenow.io`, `content-api.changenow.io` | the same addresses | Cloudflare |

### Latency

Ten sequential `GET /v1/min-amount/btc_eth` calls over two runs took 192 to 1,426 ms each, every one on a new connection, S1.
The first two calls of each run took 529 to 1,426 ms and the last three took 192 to 210 ms, so the first calls of a burst are slow even though no connection is reused.
The catalog calls of section 2 took 214 to 1,083 ms, the 13 MB pair list included, S1.
The API page advertises a 350 ms response time and 99.99 % availability, S3.

### Access from the Canadian exit

No call was refused for geography.
The terms prohibit the United Kingdom, the United States, India and Russia, and can deny an IP address from a prohibited jurisdiction, but Canada is not on that list, see [`fees.md`](./fees.md) section 1.
Every refusal seen was an API key refusal, tabled below.

### Which documented calls need an API key

The documentation says "To access the ChangeNOW API you need to generate an API key", and puts `api_key` in the URL of most v1 calls, S2.
The probe sent each call once without any key, in each of two runs, S1.
The amounts in the table are from the second run, and the first run returned the same statuses with amounts that differed by up to 2 %.

| call | status without a key | body |
|---|---|---|
| `GET /v1/currencies?active=true` | 200 | array of 1,271 currencies, 302,760 bytes |
| `GET /v1/currencies-to/btc` | 200 | array of 1,344 currencies |
| `GET /v1/currencies/btc` | 200 | one currency record |
| `GET /v1/market-info/available-pairs/?includePartners=false` | 200 | array of 854,929 pairs, 13,167,493 bytes |
| `GET /v1/exchange-amount/0.01/btc_usdttrc20` | 200 | `{"estimatedAmount":814.710507,"transactionSpeedForecast":"10-60","warningMessage":null}` |
| `GET /v1/min-amount/btc_usdttrc20` | 200 | `{"minAmount":0.0001523}` |
| `GET /v1/exchange-range/btc_usdttrc20` | 200 | `{"minAmount":0.00015232,"maxAmount":null}` |
| `GET /v1/exchange-amount/fixed-rate/0.01/btc_usdttrc20` | 401 | `{"error":"unauthorized","message":"Api Key required"}` |
| `GET /v1/market-info/fixed-rate/x` | 401 | `Unauthorized` |
| `GET /v2/exchange/currencies?active=true&flow=standard` | 200 | array of 1,271 rows |
| `GET /v2/exchange/min-amount?...` and `/v2/exchange/range?...` | 200 | minimums of 0.0001523 and 0.0001524 BTC, with `maxAmount` null |
| `GET /v2/exchange/estimated-amount?...` | 401 | `Unauthorized` |
| `GET /v2/exchange/available-pairs?...` | 401 | `Unauthorized` |
| `GET /v2/exchange/network-fee?...` | 401 | `Unauthorized` |
| `GET /v2/markets/estimate?...` | 401 | `{"error":"unauthorized","message":"API key must be specified in X-CHANGENOW-API-KEY header"}` |

So the floating-rate v1 quote is the one keyless price source.
The fixed-rate quote and every v2 quote need a key, which the partner program issues, S2 and S3.
This survey uses no credentials, so nothing behind the key was read.

### Other sources checked

- CoinMarketCap reported a 24 h spot volume of 29,685,227 USD at its 04:04:20 UTC update and 31,970,197 USD at its 04:14:20 UTC update, with 0 perpetual and 0 futures volume both times, S4.
  Its tags read `order-book-exchange` and `auto-order-book-exchange`, but the venue has no order book, so the tag is not evidence of one.
- CoinGecko lists an exchange with id `changenow`, S5.
- CCXT 4.5.68 and CCXT master have no class, see [`fees.md`](./fees.md) section 8.

## 2. Catalog

There is no instrument catalog in the order book sense.
The nearest calls are the currency lists and the pair list, S1.

| call | rows | fields |
|---|---|---|
| `GET /v1/currencies?active=true` | 1,271 currencies, 94 with `isFiat` true, 536 with `supportsFixedRate` true | `ticker`, `name`, `image`, `hasExternalId`, `isExtraIdSupported`, `isFiat`, `featured`, `isStable`, `supportsFixedRate` |
| `GET /v2/exchange/currencies?active=true&flow=standard` | 1,271 rows over 177 networks and 1,013 distinct tickers | the v1 fields plus `network`, `tokenContract`, `buy`, `sell` and `legacyTicker` |
| `GET /v1/market-info/available-pairs/` | 854,929 pairs such as `nvdahood_btc` | a bare `from_to` string |

The v1 ticker joins coin and network, as in `usdttrc20` and `usdterc20`, while v2 splits them into `ticker` `usdt` and `network` `trx`.
A pair that is not listed, such as `btc_usdt` in v1, returns 400 `{"error":"pair_is_inactive","message":"Pair is inactive"}`, the same reply as a coin that does not exist, S1.
Only two rows have a name containing "futures" or "perpetual": ticker `f`, "SynFutures", on the Base and Ethereum networks, which is a token, S1.
No CCXT class exists, so there is no `market.id`, `contractSize`, `linear` or `active` mapping.

## 3. Anchor

The venue publishes no index, mark or funding, since it lists no perpetuals.
The only reference price it publishes is the floating-rate quote of section 5, which is an all-in conversion amount for one input size, not an index.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

## 5. REST book snapshot

There is no book.
The documented price call is `GET /v1/exchange-amount/:send_amount/:from_to`, which returns `estimatedAmount`, `transactionSpeedForecast` in minutes and `warningMessage`, S2.
It answers without an API key, though the documentation shows `api_key` in its URL, S1 and S2.
Terms clause 5.3 says the rate a user receives "is calculated at the time your payment is accepted", typically after six confirmations, so the quote is an estimate and not a firm price, S6.

The quote was read for 0.01, 0.1 and 1 BTC and 0.3, 3 and 30 ETH against `usdttrc20` in both directions, in two runs of three rounds about 15 s apart, S7.
Its implied cost against the Coinbase Exchange best bid and ask was 11,270 to 16,783 ppm, falling with size, as tabled in [`fees.md`](./fees.md) section 2.
The sale quotes for 0.1 and 1 BTC and for every ETH size held the same value across two or three consecutive rounds while the reference books moved, so the quoted rate moves in steps tens of seconds apart, S7.
A quote carries no timestamp, sequence or depth.

## 6. Rate limits and error shapes

The documentation states "1800 calls per minute" and "30 calls per second", S2.
No `X-RateLimit` style header and no `Retry-After` came back on any call, and no 429 was seen, S1.
Errors seen:

| case | status | body |
|---|---|---|
| unknown or inactive pair | 400 | `{"error":"pair_is_inactive","message":"Pair is inactive"}` |
| key required, v1 | 401 | `{"error":"unauthorized","message":"Api Key required"}` or plain `Unauthorized` |
| key required, v2 | 401 | plain `Unauthorized`, or the `X-CHANGENOW-API-KEY` message on `/v2/markets/estimate` |
| unknown path | 404 | plain `Not Found` |

The documentation also lists 403 "the endpoint is not activated for your API key" and 500 "service error on our side", S2.

## 7. Server time

No server time call is documented.
The `Date` response header from Cloudflare is the only clock reading, and it has one second resolution.
Six samples over two runs put it 45 to 886 ms behind the local midpoint of each request, with round trips of 182 to 195 ms, S1.
That spread is the header's truncation to whole seconds, so the true offset is only bounded to within about one second.

## 8. Recommended poller shape

None.
The venue has no perpetuals and no index, mark or funding to poll, and it has no order book to snapshot.
ChangeNOW cannot join the engine in its current shape, as a perpetual leg or as a spot book source.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | `https://api.changenow.io/` calls listed in sections 1, 2, 6 and 7, read by [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py) | 2026-10-10 UTC | DNS, latency, keyless access, catalog counts, error shapes, clock |
| S2 | ChangeNOW API documentation, Postman collection `https://documenter.gw.postman.com/api/collections/8180765/SVfTPnM8`, linked from `https://changenow.io/api` as `https://documenter.getpostman.com/view/8180765/SVfTPnM8`, read by [`ws-probe.py`](../../../scripts/probes/venues/changenow/ws-probe.py) | 2026-10-10 UTC | call list, API key rule, rate limits, documented errors |
| S3 | `https://changenow.io/api`, read by [`fees-probe.py`](../../../scripts/probes/venues/changenow/fees-probe.py) | 2026-10-10 UTC | partner program, advertised response time |
| S4 | CoinMarketCap data API `exchange/detail`, `exchange/listing` and `exchange/market-pairs/latest` for slug `changenow`, read by [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py) | 2026-10-10 UTC | volumes, tags, pair counts |
| S5 | `https://api.coingecko.com/api/v3/exchanges/list`, read by [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py) | 2026-10-10 UTC | CoinGecko entry |
| S6 | `https://changenow.io/terms-of-use/changenow-terms`, read by [`fees-probe.py`](../../../scripts/probes/venues/changenow/fees-probe.py) | 2026-10-10 UTC | when the rate is fixed |
| S7 | quote rounds of [`fees-probe.py`](../../../scripts/probes/venues/changenow/fees-probe.py) | 2026-10-10 UTC | quote cost and refresh |
