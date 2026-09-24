# Flipster REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 06:33 to 06:51 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the Flipster Trading API at `https://trading-api.flipster.io` for the perpetual swaps.
The API is a private launch for selected users, and every market data call answered this host with HTTP 401 `api.unauthorized` because no API key was sent, P1.
Only `/api/v1/public/ping` and `/api/v1/public/time` answer without a key.
So the catalog, anchor and book sections below record the documented shape and the refusal, and the few numbers that were readable come from the stream the flipster.io website opens for logged out visitors, which is not part of the published API.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| documented host | `https://trading-api.flipster.io`, base path `/api/v1/` | S1 |
| resolved addresses | `trading-api.flipster.io` and `api.flipster.io` both resolve to `104.18.20.111` and `104.18.21.111`, Cloudflare | P1 |
| edge | `cf-ray` suffixes `SEA` and `YVR`, and `server: cloudflare` | P1, P2 |
| origin | `x-prex-region: tokyo` on every public reply | P1, P2 |
| caller as seen by the venue | `x-prex-ipcountry: CA`, `x-prex-ipcity: Vancouver`, the Canadian VPN exit | P1, P2 |
| first request, TLS included | 209, 219, 231 and 239 ms in four processes | P1, P2 |
| warm `GET /api/v1/public/time` | 122 to 400 ms over 18 requests in two runs, median 138 ms | P2 |
| a 401 refusal | 116 to 400 ms over two runs | P1 |

All results in this profile are from the Canadian VPN exit named above, and a different exit could be answered differently.

## 2. Catalog

### The documented calls

| call | documented reply | probed without a key |
|---|---|---|
| `GET /api/v1/market/contract`, optional `symbol` | one `Contract` or an array, with `symbol`, `quoteCurrency`, `initMarginRate`, `maintMarginRate`, `maxLeverage`, `baseInterestRate`, `fundingRateCap`, `fundingIntervalHours`, `tickSize`, `unitOrderQty`, `notionalMinOrderAmount`, `notionalMaxOrderAmount`, `notionalMaxPositionAmount`, `maxOpenInterest`, all decimals as strings | 401 `{"error":"api.unauthorized"}` |
| `GET /api/v1/trade/symbol` | `{"spot": [...], "perpetualSwap": [...]}`, "the list of tradable symbol" for the API | 401 `{"error":"api.unauthorized"}` |

Both calls declare the security scheme `thirdPartyApiKeyAuth` with scope `read`, an `api-key` header, S2 and S3.
The symbol pattern is `^[A-Z0-9]+(\.[A-Z0-9]+)?$`, and the documentation spells a perpetual `BTCUSDT.PERP`, S3.
No status field is documented, and the documentation warns that "not all symbols displayed on the platform are available for API trading at all times", S1.
No contract size or multiplier field is documented, so the size unit of the API book is Not publicly specified.

### What could be counted

| source | perpetuals | by settlement | notes |
|---|---:|---|---|
| website stream table `market/pswaps`, 2026-09-23 06:41 and 06:51 UTC | 242 in both reads | USDT 242, USD1 0, other 0 | every key ends in `.PERP`, and TradFi contracts such as `XAUUSDT.PERP`, `NVDAUSDT.PERP` and `SPYUSDT.PERP` are in the same table, P5 |
| website stream table `market/spots` | 6 spot pairs | USDT 6 | keys without a suffix, such as `BTCUSDT`, P5 |
| CoinGecko `aqx_derivatives` | 243 perpetual pairs, 0 futures | USDT 243 | CoinGecko spells them `BTC-USDT.PERP`, S7 |
| CoinMarketCap derivatives ranking, 2026-09-23 | 234 pairs | | as given in the survey brief, not re-read here |

The website stream is not a documented API, and nothing guarantees that its table equals the Trading API's tradable list.
On that table 133 and then 132 of the 242 contracts showed a `turnover24h` of `"0"`, P5.
CoinGecko reported a non-zero 24 h volume for all 243 of its Flipster perpetuals, and for `PYTH-USDT.PERP` it reported 34,590 PYTH, about 2,198 USD, while the website table showed `"0"` for `PYTHUSDT.PERP`, S7.
So the website field is not a volume the survey can use, and many contracts trade only a few thousand dollars a day.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no Flipster class, and the CCXT master branch at commit `1c996ee07ed6f5c03c7097b2d46d8a8c0eeb5adb` has none either, see [`fees.md`](./fees.md) section 8.
So the engine's catalog step, `loadMarkets` filtered to active swaps at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68 and 79, has nothing to call.
A custom catalog would read `GET /api/v1/market/contract` with a key and would have to take the base from the symbol, because the documented contract carries only `quoteCurrency`.

### Size unit and pairs listed twice

The website book's sizes read as coins: the BTC touch held `"0.00443"` at 86,476.6 and the ETH touch `"0.137"` at 2,754.96, which is 383 and 377 USDT, see [`websocket.md`](./websocket.md) section 6, P4.
Whether the API book uses the same unit could not be checked without a key.
No pair was listed twice in the website table, since no USD1 contract was listed.
Three contracts carry a 1000 prefix, `1000BONKUSDT.PERP`, `1000SHIBUSDT.PERP` and `1000PEPEUSDT.PERP`, and would need a price scale in [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts), P5.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | probed |
|---|---|---|---|---|---|---|
| `GET /api/v1/market/ticker` without `symbol` | `indexPrice` | `markPrice` | `fundingRate`, "the current periodic funding rate" | `fundingIntervalHours`, integer hours | `nextFundingTime`, nanosecond timestamp as a string | 401 without a key |
| `GET /api/v1/market/funding-info` without `symbol` | absent | absent | `fundingRate`, "the current estimated funding rate for the upcoming settlement", and `lastFundingRate` | `fundingIntervalHours` | `nextFundingTime` | 401 without a key |

The ticker call, as documented, carries all five `AnchorRow` columns for every symbol in one reply, S3.
It also carries `bidPrice`, `askPrice`, `lastPrice`, `openInterest` and `fundingRateCap`.
The funding-info page says it also returns index and mark in its prose, but its schema lists only the funding fields, S3.
Reply size and time are Not verified, because neither call answered.

### Row mapping, as documented

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT.PERP` | none |
| `index` | `indexPrice` | decimal string | `Number()` |
| `mark` | `markPrice` | decimal string, nullable | `Number()`, and a null is a markless row |
| `fundingRate` | `fundingRate` | decimal string, "periodic" rate | `Number()`, per interval if the formula's `/(8/N)` applies, see section 4 |
| `fundingIntervalHours` | `fundingIntervalHours` | integer | none |
| `nextFundingAt` | `nextFundingTime` | nanosecond integer as a string, per the `Timestamp` schema | `Number(BigInt(v) / 1_000_000n)` |

### What the website stream showed

The website's ticker table `market/tickers` carried `midPrice`, `markPrice`, `indexPrice`, `fundingRate`, `fundingTime`, `priceChange24h`, `priceChangePct24h`, `high24h`, `low24h`, `volume24h`, `turnover24h`, `openInterest` and `openInterestInUsdt`, P4.
It had no interval field, and `fundingTime` was a nanosecond string such as `"1790150400000000000"`, 2026-09-23 08:00 UTC.
BTC read index `86522.6`, mark `86500` and funding rate `0.000061364354021305` at 06:47 UTC, P4.

## 4. Anchor semantics

### Index

| item | value | source |
|---|---|---|
| formula with more than 3 valid constituents | each constituent's last price capped to within 3 % of the constituents' median, then an equal weighted average | S4 |
| with 2 or 1 valid constituents | the average of the two, or the one last price | S4 |
| staleness | a feed delayed more than 500 ms is excluded, and for an exchange not updated within one minute the page says both that its last price is served and that it is excluded | S4 |
| re-inclusion | not delayed more than 500 ms and within 3 % of the median of the others | S4 |
| circuit breaker | a move of more than 25 % from the previous index stops the calculation "pending investigation" | S4 |
| TradFi | constituent prices from third party data vendors, updated every second, frozen at the last value when the market is closed, and rolled between futures contracts for CL and BZ | S5 |
| basket call | Not publicly specified, and the constituents are not listed in the documentation read | S4 |

The index uses constituent last prices, not the venue's own perpetual, per the formula.
Whether any basket is mostly Flipster's own market could not be checked, since no basket is published.

### Mark

| item | value | source |
|---|---|---|
| formula | `Median(Price 1, Price 2, Last Price)` | S6 |
| Price 1 | `index * (1 + last funding rate * time until next funding / funding period)` | S6 |
| Price 2 | `index + 30 s moving average of basis`, basis `(best bid + best ask) / 2 - index`, sampled each second, since 18 September 2025 08:01 UTC, 150 s before that | S6, S8 |
| clamp | none published as a premium cap, but "Flipster may enforce that Mark Price = Perpetual Swap List Price" in extreme conditions | S6 |
| TradFi when closed | "Frozen at last available price" | S5 |
| delisting | 1 h linearly weighted TWAP of the index | S9 |

The median includes the last traded price, so a mark can sit on the last trade.
On the website stream BTC's mark stayed at `86500` for all 124 ticker frames of the 06:46 UTC run while its index changed 11 times, P4.
ETH's mark changed 24 times in the same 124 frames, P4.

### Funding

The formula, cap and window are in [`fees.md`](./fees.md) section 6.
The rate is divided by `8/N`, so a 4 h contract publishes half its 8 h equivalent, S8.
The documented funding-info call separates the upcoming estimate, `fundingRate`, from the last settled rate, `lastFundingRate`, S3.
The ticker's `fundingRate` is described only as "the current periodic funding rate", so whether it is the upcoming estimate is Not verified.
No public call returns funding history, and the settlement instant was not captured.

### How often each number changed

Measured on the website stream, not on the Trading API, over 124 and 125 ticker frames in 25 s, in runs that started at 06:46 and 06:50 UTC, P4.

| field | BTC changes | ETH changes | PYTH changes, second run only |
|---|---|---|---:|
| `midPrice` | 7 and 8 | 11 and 4 | 11 |
| `indexPrice` | 11 and 15 | 14 and 18 | 6 |
| `markPrice` | 0 and 15 | 24 and 25 | 25 |
| `fundingRate` | 1 and 1 | 1 and 1 | 1 |
| `fundingTime` | 0 and 0 | 0 and 0 | 0 |

The stream pushed a ticker frame every 200 ms, so an index change count of 11 to 18 in 25 s means the index moved every 1.4 to 2.3 s.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET /api/v1/market/orderbook?symbol=BTCUSDT.PERP` | S3 |
| reply | `{"symbol", "bids": [[price, quantity], ...], "asks": [...]}`, decimals as strings | S3 |
| depth parameter | the prose says "Optional parameters such as limit can be used", and the parameter list has only `symbol` | S3 |
| probed | 401 `{"error":"api.unauthorized"}` | P1 |

Level order, depth limits and caching are Not verified.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented policy | "Each API key is assigned a request-per-second (RPS) and request-per-minute (RPM) quota", limits vary by endpoint type, and a breach returns 429 "Too Many Requests" with a `Retry-After` header | S1 |
| headers on public calls | `x-ratelimit-limit: 100`, `x-ratelimit-remaining` 97 to 99 at about 2.5 requests per second, `x-ratelimit-reset` a Unix second 0.3 to 1.5 s ahead of the server clock | P1, P2 |
| headers on a 401 | no rate limit header, and `x-prex-error-type: api.unauthorized` | P1 |
| window | Not publicly specified, and the reset header moved forward about one second per second | P2 |
| 429 | not provoked | |

| request | status | body |
|---|---|---|
| any documented market or trade call without a key | 401 | `{"error":"api.unauthorized"}`, `content-type: application/json` |
| `GET /api/v1/nope` | 403 | `Invalid Origin`, `text/plain` |
| `GET /api/v2/market/ticker` | 404 | nginx HTML `404 Not Found` |

The engine's anchor poller pauses only on 403, 418 and 429, at [`errors.ts`](../../../server/src/shared/errors.ts) line 1, so a 401 would surface as an ordinary error on every poll.

## 7. Server time and clock offset

`GET /api/v1/public/time` returns `{"serverTime":"1790145553108000536"}`, nanoseconds since the epoch as a string, with no key, P1.
Server time minus the local midpoint of each request had a median of +6.5 ms over 18 warm requests in two runs, P2.
Sixteen of them fell between -5 and +15 ms.
The two outliers, +49 and +142 ms, came on requests that took 212 and 400 ms, so they measure an uneven path more than the clock.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| now | no poller | every call that carries index, mark or funding returns 401 without a key, and keys are issued only through the private launch, S1 |
| website stream | do not poll or subscribe it for the engine | it is not a published API, its protocol is the web client's own, and it can change with any web release |
| with a read key | `GET https://trading-api.flipster.io/api/v1/market/ticker` without `symbol`, once a second | one documented call carries all five `AnchorRow` columns, section 3 |
| key | `symbol`, which must equal the book feed's routing key | the documented WebSocket topics use the same `BTCUSDT.PERP` spelling, see [`websocket.md`](./websocket.md) section 3 |
| `nextFundingAt` | `Number(BigInt(nextFundingTime) / 1_000_000n)` | the timestamp is in nanoseconds |
| skip | rows with a null `markPrice` or `indexPrice` | both are nullable in the schema |
| skip | TradFi rows while their market is closed | mark and funding are frozen then, S5 |
| rate limit pause | honour `Retry-After` | documented, S1 |
| auth | the poller would need to send `api-key`, `api-expires` and an HMAC-SHA256 `api-signature` | the base poller sends only an `accept` header today, at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) line 230, S1 |

Before any of this, someone has to request API access from Flipster support, and the engine has to learn to sign requests.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Flipster API Documentation, Introduction and Essential Concepts | https://api-docs.flipster.io/readme.md | 2026-09-23 UTC | Flipster Corp | host, private launch, HMAC headers, rate limit policy, sections 1, 2, 6 and 8 |
| S2 | Get Tradable Symbols | https://api-docs.flipster.io/api-reference/trade/get-tradable-symbols.md | 2026-09-23 UTC | Flipster Corp | symbol list call, section 2 |
| S3 | Market pages: Get Contract Info, Get Tickers, Get Funding Info, Get Orderbook | https://api-docs.flipster.io/api-reference/market.md | 2026-09-23 UTC | Flipster Corp | schemas and security of the market calls, sections 2, 3 and 5 |
| S4 | Index Price, updated 2025-06-10 | https://support.flipster.io/hc/en-us/articles/7353351786383-Index-Price | 2026-09-23 UTC | Flipster Corp | index formula, section 4 |
| S5 | TradFi Trading Hours & Pricing, updated 2026-04-29 | https://support.flipster.io/hc/en-us/articles/15957330955407-TradFi-Trading-Hours-Pricing | 2026-09-23 UTC | Flipster Corp | TradFi index, frozen mark and funding, sections 4 and 8 |
| S6 | Mark Price Calculation, updated 2025-09-18 | https://support.flipster.io/hc/en-us/articles/7353316085647-Mark-Price-Calculation | 2026-09-23 UTC | Flipster Corp | mark formula, section 4 |
| S7 | CoinGecko derivatives exchange `aqx_derivatives` | https://api.coingecko.com/api/v3/derivatives/exchanges/aqx_derivatives?include_tickers=unexpired | 2026-09-23 UTC | CoinGecko | 243 perpetual pairs, section 2 |
| S8 | Changes to funding rate and mark price calculation, September 18, 2025 | https://support.flipster.io/hc/en-us/articles/13803308706319-Changes-to-funding-rate-and-mark-price-calculation-September-18-2025 | 2026-09-23 UTC | Flipster Corp | 30 s basis, `/(8/N)`, section 4 |
| S9 | Delisting of Contracts, updated 2025-09-18 | https://support.flipster.io/hc/en-us/articles/7376922453519-Delisting-of-Contracts | 2026-09-23 UTC | Flipster Corp | delisting mark, section 4 |
| S10 | flipster.io web client, release `release-web-3.38.101`, read with curl | https://flipster.io/trade/perpetual/BTCUSDT.PERP | 2026-09-23 UTC | Flipster Corp | the website stream URL and its table names, sections 2 and 3 |
| P1 | `rest-probe.mjs access`, runs at 06:39 and 06:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/flipster/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | DNS, every documented call without a key, error shapes, sections 1, 2, 5 and 6 |
| P2 | `rest-probe.mjs time`, runs at 06:39 and 06:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/flipster/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | latency, rate limit headers, clock offset, sections 1, 6 and 7 |
| P4 | `ws-probe.mjs web`, runs that started at 06:46 and 06:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/flipster/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | website ticker and book, sections 2, 3 and 4 |
| P5 | `ws-probe.mjs catalog` at 06:41 and 06:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/flipster/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | website perpetual and spot tables, section 2 |
