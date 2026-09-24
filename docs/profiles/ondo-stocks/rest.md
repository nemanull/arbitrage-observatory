# Ondo Stocks REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:21 and 03:26 UTC, from the development host near Seattle.

The REST API of Ondo Stocks is the GM Backend API at `https://api.gm.ondo.finance`, S1.
Every path in its OpenAPI spec requires an `x-api-key` header, and the key is issued only after onboarding with Ondo, S1 and S2.
Without a key every path answered HTTP 403 to this host, in [`rest-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/rest-probe.mjs).
The venue lists no perpetuals, so this profile covers the spot product per template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), see [`fees.md`](./fees.md) section 3.

## 1. Host and latency from this machine

| host | resolved | front |
|---|---|---|
| `api.gm.ondo.finance` | `143.204.160.58`, `.102`, `.32` and `.68`, in both runs | CloudFront, `via: 1.1 <id>.cloudfront.net (CloudFront)`, in front of AWS API Gateway, whose `x-amzn-errortype` header names the refusal |
| `grpc.gm.ondo.finance` | CNAME `k8s-gmbacken-traefika-83782a153c-1276893679.us-east-1.elb.amazonaws.com`, three addresses `34.232.37.88`, `44.215.148.153` and `54.146.23.170` | AWS Application Load Balancer in `us-east-1`, `server: awselb/2.0`, see [`websocket.md`](./websocket.md) |

Every documented GET path, called once each without a key, answered the same way in both runs.

| request | status | `x-amzn-errortype` | body | time |
|---|---|---|---|---|
| each of the 17 GET paths of S1, among them `/v1/tickers`, `/v1/assets/all/prices/latest`, `/v1/assets/all/metadata`, `/v1/status/market` and `/v1/limits/trading` | 403 | `ForbiddenException` | `{"message":"Forbidden"}` | 74 to 200 ms at 03:21 UTC, 76 to 198 ms at 03:26 UTC |
| `/v1/nope` and `/v1/time`, which the spec does not define | 403 | `ForbiddenException` | `{"message":"Forbidden"}` | 76 to 195 ms |
| `/` | 403 | `MissingAuthenticationTokenException` | `{"message":"Forbidden"}` | 186 and 187 ms |

Every reply carried `x-cache: Error from cloudfront`, and none carried `Retry-After` or `WWW-Authenticate`.
A defined and an undefined path under `/v1/` got the same 403, so the refusal does not reveal whether a path exists.

Ten sequential `GET /v1/tickers` a second apart took 73 to 202 ms, median 195 ms, with the first, cold, request at 196 ms, at 03:21 UTC.
At 03:26 UTC they took 75 to 213 ms, median 196 ms, with the cold request at 197 ms.
The times split into two groups, about 75 ms and about 195 ms, and what decides the group is Not verified.

The public pages answered normally at 03:26 UTC: `https://status.ondo.finance/market` 200 with 151,759 bytes, `https://app.ondo.finance/` 200 with 254,722 bytes, and `https://docs.ondo.finance/openapi.json` 200 with 177,543 bytes.
So this host is not refused at the network level.
The API Gateway 403 is consistent with the missing key, and whether an address or country rule also stands behind it is Not verified.
The operator of this host is a US person and cannot obtain a key, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

CCXT 4.5.68 has no class for this venue and neither does the CCXT master branch of 2026-09-22, see [`fees.md`](./fees.md) section 8.
So there is no `loadMarkets` catalog, no `market.id`, no `contractSize` and no `linear` flag to map, and the swap filter at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203 would find nothing.

The venue's own catalog calls are key gated.

| call | returns | probed |
|---|---|---|
| `GET /v1/assets/all/metadata` | identifiers, addresses and classification for every symbol, cached 5 minutes, S1 and S3 | 403 |
| `GET /v1/tickers` | `tickerId` spelled `aaplon_usdon`, `baseCurrency` `AAPLon`, `targetCurrency` `USDon`, `lastPrice`, `baseVolume` and `targetVolume` over 24 h, S1 | 403 |
| `GET /v1/status/assets` | per asset trading status with a reason and expected duration, S1 | 403 |

CoinGecko's API listed the venue as `ondo_global_markets`, named Ondo Stocks, centralized, British Virgin Islands, trust score 6, trust score rank 84, with 347 coins and 347 pairs, in both runs of the probe.
All 100 tickers the API returned were quoted in `USDON`, with bases spelled like `CRCLON` and trade URLs of the form `https://app.ondo.finance/assets/crclon`.
Their `bid_ask_spread_percentage` read 0.011259 to 4.153355, median 0.112796, at 03:21 UTC, and 0.012976 to 4.153355, median 0.104603, at 03:26 UTC.
Symbols on the venue end in `on`, such as `TSLAon`, and the API rejects any symbol that does not, S4.

## 3. Anchor

The venue publishes no index price, no mark price and no funding rate, because it lists no perpetual.
It does publish a reference price beside its own price, behind the key.

| call | field | meaning | cache |
|---|---|---|---|
| `GET /v1/assets/all/prices/latest` | `primaryMarket.price` | the token price, with `primaryMarket.symbol`, a decimal string with up to 18 decimals | 1 s, S3 |
| same | `underlyingMarket.price` | the underlying stock's price, with `underlyingMarket.ticker` | 1 s, S3 |
| same | `timestamp` | Unix ms of the price retrieval | |
| gRPC `StreamPriceUpdates` | `token_price` and `stock_price` | the same two prices streamed, timestamp in ns | streamed, S5 |

S6 announces that `underlyingMarket` can become `null` for a token backed by several assets, which then lists `constituentTokens` instead.
No anchor poller is recommended, see section 8.

## 4. Anchor semantics

There is no index, mark or funding to describe.
The token price is not the stock price.
A token is a total-return tracker, so each token represents a number of shares that grows as net dividends are reinvested, and its price is that number times the share price, S7.
The shares per token history is served by `GET /v1/assets/{symbol}/shares-multiplier`, cached 1 s, S1 and S3, and it answered 403 here.
In the S7 example a 10 US dollar dividend, taxed at 50%, takes a token from 1 to 1.05 shares, so the token then trades 5% above the stock.
Off-hours quotes for the per-asset weekend list come from "the same proprietary pricing method", with wider spreads and per-asset limits, S7 and S8.
How often either price changed over a minute of one second polls could not be measured, because both calls answered 403.

## 5. REST book snapshot

No order book call exists.
The nearest calls are the quote calls, S1.

| call | what it returns | probed |
|---|---|---|
| `POST /v1/attestations/soft` | a non-binding price for a `symbol`, `side` and `notionalValue` or `tokenAmount`, "without impacting your trading limits", S2 | not called, since it needs the key |
| `POST /v1/attestations` | a signed, binding quote valid for about 30 s, submitted on chain to mint or redeem, S2 and S7 | not called, it is a trade step |
| gRPC `StreamSoftQuoteDepth` | a synthetic bid and ask ladder derived from the soft-quote price ladder, see [`websocket.md`](./websocket.md) section 4 | 403 |

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit values | Not publicly specified, "The account has exceeded its request rate limits", S4 | not reached |
| limit status | 429 with `{"code": "RATE_LIMITED", "message": "rate limit exceeded"}`, "Wait briefly and retry with exponential backoff.", S4 | not reached |
| `Retry-After` | not documented | absent on every 403 |
| missing key | 401 with `{"code": "MISSING_API_KEY", "message": "missing API key"}`, S4, and the spec lists 401 as "Missing or invalid API key.", S1 | 403 `{"message":"Forbidden"}` with `x-amzn-errortype: ForbiddenException` |
| error shape | `{code, message, documentation}`, where `code` is a reason code, S1 | the gateway's `{message}` only |
| market states | 403 with `MARKET_CLOSED`, `MARKET_PAUSED`, `ASSET_PAUSED`, `ASSET_CLOSED_FOR_SESSION` or `ASSET_REDEEM_ONLY`, S4 | not reached |

The documented refusal and the wire disagree.
The docs promise a 401 with a reason code, and the wire gave a 403 from the gateway with no reason code.
The engine treats 403, 418 and 429 as a rate limit, at [`errors.ts`](../../../server/src/shared/errors.ts) line 1, and pauses 60 s when no `Retry-After` comes, at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 9 and 188 to 194.
So a keyless poller would pause after every poll and never read a row.

## 7. Server time and clock offset

No server time call is documented, and `/v1/time` answered 403 like every other path.
The `Date` header of ten `/v1/tickers` replies read 955 ms behind to 38 ms ahead of the local clock at 03:21 UTC, and 816 ms behind to 63 ms ahead at 03:26 UTC.
`Date` has one second resolution, so that spread only says the clocks agree to within about one second.

## 8. Recommended poller shape

None.
The venue has no perpetual, so it has no index, mark or funding for an `AnchorRow`, and its price calls need a key that is issued only after KYC onboarding from which US persons are excluded, see [`fees.md`](./fees.md) section 1.
If the engine ever compares Ondo's tokens with stock perpetuals on another venue, the token price has to be divided by the shares multiplier of section 4 before it is compared with a stock price.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GM Backend API OpenAPI spec | https://docs.ondo.finance/openapi.json | 2026-09-22 | Ondo, global | host, `apiKey` on every path, paths, schemas, 401 and 429 descriptions, sections 1 to 6 |
| S2 | API Overview and Quickstart | https://docs.ondo.finance/api-reference/overview.md and https://docs.ondo.finance/api-reference/quickstart.md | 2026-09-22 | Ondo, global | key by onboarding, soft quote and attestation calls, sections 1 and 5 |
| S3 | Endpoint Caching | https://docs.ondo.finance/api-reference/endpoint-caching.md | 2026-09-22 | Ondo, global | 1 s price cache, 5 min metadata cache, 1 s shares multiplier cache, sections 2 to 4 |
| S4 | Error Codes | https://docs.ondo.finance/api-reference/error-codes.md | 2026-09-22 | Ondo, global | `MISSING_API_KEY`, `RATE_LIMITED`, market state codes, symbol rule, sections 2 and 6 |
| S5 | Price Streaming | https://docs.ondo.finance/api-reference/price-streaming.md | 2026-09-22 | Ondo, global | streamed token and stock price, section 3 |
| S6 | Upcoming API changes | https://docs.ondo.finance/api-reference/upcoming-changes.md | 2026-09-22 | Ondo, global | `underlyingMarket` may become null, `constituentTokens`, section 3 |
| S7 | Token and Quote Pricing | https://docs.ondo.finance/ondo-stocks/token-and-quote-pricing.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | total return, shares per token, 30 s quote, off-hours pricing, sections 4 and 5 |
| S8 | Off-Hours Trading | https://docs.ondo.finance/ondo-stocks/off-hours-trading.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | off-hours spreads and limits, section 4 |
| S9 | CoinGecko exchange API | https://api.coingecko.com/api/v3/exchanges/ondo_global_markets | 2026-09-22 | CoinGecko | listing, pair count, spreads, section 2 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/rest-probe.mjs) at 03:21 and 03:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 6 and 7 |
