# SWFT Trade REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 03:19 to 03:26 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada (`ipinfo.io` reports AS212238 Datacamp Limited).

SWFT Trade lists no perpetuals, so the researched product is its spot market, see [`fees.md`](./fees.md) section 3.
The venue's API host answers, but every market data call of its TRADE API refuses a request without an issued partner channel number and HMAC signature.
So no catalog, no book and no price could be read, and the venue has no public API in the sense this survey needs.
Every probed fact below comes from [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py).

## 1. Host and latency from this machine

### DNS

| host | resolved | note |
|---|---|---|
| `www.swftc.info` | 170.33.12.190 | the "API HOST" on the documentation's front page, S2. Answers from `nginx/1.24.0` directly, not behind Cloudflare |
| `swftc.info` | 170.33.12.190 | same origin |
| `swap.swftcoin.com` | 170.33.12.190 | same origin |
| `www.swft.pro`, `swft.pro` | 104.21.7.4, 172.67.135.140 | Cloudflare, the website CoinMarketCap names |
| `exchange.swftcoin.com` | 104.21.26.187, 172.67.138.91 | Cloudflare |
| `docs-swft.en.swft.pro` | 104.18.40.47, 172.64.147.209 | GitBook on Cloudflare |
| `trade.swft.pro` | does not resolve | a guess |

### What each host returned

| request | status | time |
|---|---|---|
| `GET https://www.swftc.info/` | 303 to `/swft-v3/swft-v3-pc/index.html` | 1,235 to 1,284 ms |
| `GET https://www.swftc.info/swft-v3/swft-v3-pc/index.html`, three in a row | 200, 25,333 bytes, the swap web app | 1,521 to 1,643 ms, with no cold to warm difference, since each call opens a new connection |
| `GET https://swap.swftcoin.com/` and `https://exchange.swftcoin.com/` | 303 to the same web app path | 1,241 to 1,960 ms |
| `GET https://www.swft.pro/` | 200, 1,395 bytes, a page titled "SWFT Blockchain" that calls itself a "One-Stop Cross-Chain Platform" | 929 to 993 ms |
| `GET https://docs-swft.en.swft.pro/` | 200, the GitBook site "SWFT API-en" | 160 to 347 ms |

No host returned a geoblock or a refusal of this exit.
The 1.2 s floor on `www.swftc.info` holds for every call, the refusals included.
The web app on `www.swftc.info` and the `swft.pro` site are a swap aggregator, bridge and NFT front end, and neither script holds an order book screen or a market data URL, S3.

### The partner gate

The TRADE API documentation says it "is for partners who have applied for the channel number channelId and private key at us", that partners must "Provide channel name, register account", and that every call is "POST application/json", S2.
Every market data call lists `channelId`, `timestamp` and `sign` as required, where `sign` is an uppercase HMAC-SHA256 over the sorted parameters with the partner's secret, S2.

The probe sent each call once without a channel, and once with the documentation's own example `channelId` `swft-channel` and a placeholder `sign` of `00`, S1.

| call | no channel | example channel, placeholder sign |
|---|---|---|
| `POST /marketApi/loadPair` | 200, `{"resCode":"901","resMsg":"请求参数不全"}`, "request parameters incomplete" | 200, `{"resCode":"964","resMsg":"用户名不存在"}`, "user name does not exist" |
| `POST /marketApi/depth` | 200, 901 | 200, 964 |
| `POST /marketApi/history/detail` | 200, 901 | 200, 964 |
| `POST /marketApi/history/trade` | 200, 901 | 200, 964 |
| `POST /market/history/kline` | 200, `{"resCode":"907","resMsg":"必填字段为空","resMsgEn":null,"data":null}`, "required field empty" | 200, 907 |
| `GET /marketApi/loadPair` | 200, 901 | not sent |
| `GET /market/history/kline?symbol=btcusdt&period=5min&size=2` | 200, `{"resCode":"213","resMsg":"非法请求",...}`, "illegal request" | not sent |

The error table in the documentation lists 800, 900 and 1100 to 1111 only, so 901, 907, 213 and 964 are undocumented, S2.
The replies name missing parameters and an unknown channel, and nothing in them points to a regional block.
This survey uses no credentials, so nothing behind it was read.

### Other sources checked

- CoinMarketCap lists 11 spot pairs, S4.
  Its 24 h spot volume for the venue read 259,772,150 USD in both the detail record and the `exType=1` listing at 03:19 UTC, and 6,564,191 USD in both at 03:24 UTC.
  At 03:21 UTC the detail record still read the first figure while the listing read the second, S4.
  The listing row also reports `visits` of 62 and `liquidity` of 278, S4.
  Every pair has an empty `marketUrl`, and the tags read `order-book-exchange` and `auto-order-book-exchange`, S4.
  These figures are not evidence that a public book trades.
- CoinGecko's exchange list, 1,503 rows, has no SWFT entry, S5.
  A first attempt from this exit was answered with 429, and the list call succeeded on a later run.
- CCXT 4.5.68 and CCXT master have no class, see [`fees.md`](./fees.md) section 8.

## 2. Catalog

No catalog could be read.
The catalog call is `POST /marketApi/loadPair`, which returns `tradePair` such as `BTC/USDT`, `tradeCode`, `allowCoinLow`, `allowTradeLow`, `tradeNumAccuracy` and `tradePriceAccuracy` per pair in its documented example, S2.
It refused this host as shown in section 1.
CoinMarketCap's 11 spot pairs, listed in [`fees.md`](./fees.md) section 3, are the only pair list available, and none is a perpetual.
No CCXT class exists, so there is no `market.id`, `contractSize`, `linear` or `active` mapping.

## 3. Anchor

The venue publishes no index, mark or funding, since it lists no perpetuals.
The only reference prices it documents are `latestPrice` in the depth reply and `latestPrice`, `latestPriceUSDT` and `latestPriceRMB` in `POST /marketApi/history/detail`, all behind the partner gate, S2.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

## 5. REST book snapshot

The documented call is `POST /marketApi/depth` with `tradePair` and `depth`, where `depth` is "Deep polymerization, 1,2,3,4,5,6", an aggregation level, S2.
The documented reply holds `buyOrders` and `sellOrders` as arrays of `[price, amount]` strings, plus `latestPrice` and `latestType`, S2.
The documented example lists `buyOrders` from 10395.67 down to 10393.50 and `sellOrders` from 10392.33 up to 10392.39, so its example bids sit above its asks, S2.
No level count, timestamp, sequence or caching rule is documented.
The call refused this host with 901 and 964, see section 1, so nothing was probed.

## 6. Rate limits and error shapes

No rate limit is published: none of the 29 documentation pages contains "rate limit", "frequency", "per second", "per minute" or "times per", S1.
Every refusal seen came as HTTP 200 with a JSON body carrying `resCode` and a Chinese `resMsg`, as tabled in section 1.
An unknown path returns HTTP 404 with a Spring style body, `{"timestamp":"2026-10-10T03:22:31.903+00:00","status":404,"error":"Not Found",...}`, S1.
No 429 and no `Retry-After` was seen from any SWFT host.

## 7. Server time

No server time call is documented.
The millisecond `timestamp` in the 404 body of an unknown path serves as a clock reading.
Six samples over two runs put the server 484 to 512 ms ahead of the local midpoint of each request, with round trips of 1,265 to 1,319 ms, S1.
Since each request opens a new TLS connection, the true offset is only bounded by half the round trip, about 650 ms either way.
The documentation asks for a millisecond `timestamp` within five minutes of server time and labels it "UTC+8", S2.

## 8. Recommended poller shape

None.
The venue has no perpetuals and no index, mark or funding to poll, and its spot book is readable only by a partner with an issued `channelId` and secret.
SWFT Trade cannot join the engine in its current shape, as a perpetual leg or as a public spot source.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | `https://www.swftc.info/` calls listed in section 1, the 404 clock readings and the 29 page scan, read by [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) | 2026-10-10 UTC | DNS, latency, the gate replies, error shapes, server time, absence of rate limits |
| S2 | SWFT API documentation, `https://docs-swft.en.swft.pro/master.md`, `trade-api/swft-trade-interface.md`, `trade-api/generate-signature.md`, `trade-api/get-the-support-trade-pair.md`, `trade-api/get-market-depth.md`, `trade-api/latest-transaction-information.md`, `trade-api/historical-transaction-record.md` and `trade-api/k-line-data.md` | 2026-10-10 UTC | API host, partner requirement, signature, call shapes, error table |
| S3 | `https://www.swft.pro/` and its bundle, and the `swftc.info` web app and scripts, read by [`ws-probe.py`](../../../scripts/probes/venues/swft-trade/ws-probe.py) | 2026-10-10 UTC | no order book screen or market data URL in the front ends |
| S4 | CoinMarketCap data API `exchange/detail`, `exchange/listing` and `exchange/market-pairs/latest` for slug `swft-octopus-trade`, read by [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) | 2026-10-10 UTC | pair list, volumes, tags |
| S5 | `https://api.coingecko.com/api/v3/exchanges/list`, read by [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) | 2026-10-10 UTC | no CoinGecko entry |
