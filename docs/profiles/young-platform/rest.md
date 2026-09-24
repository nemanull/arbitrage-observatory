# Young Platform REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:24 to 04:56 UTC, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API of Young Platform for its spot market, since the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
The API is the trader surface documented on GitHub on 2026-07-21 and 2026-07-30, S1, and it fronts a Smart Order Router, not an exchange.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs), run from `server/`.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| base URL | `https://api.youngplatform.com/api/v1/trader` | S1 |
| resolved addresses | 104.20.1.155, 104.20.2.155 and two IPv6 addresses, Cloudflare | P1, P2 |
| edge | `cf-ray` suffix `YVR` in the first run and `SEA` in the second and third | P1, P2, P3 |
| cold request, new TLS connection, `GET /public/markets` | 5 requests per run over three runs: min 206 to 254, median 274 to 801, max 751 to 938 ms | P1, P2, P3 |
| warm request, kept alive | 10 requests per run: medians 192, 244 and 197 ms, max 235, 364 and 249 ms | P1, P2, P3 |
| warm `GET /public/liquidity/BTC-EUR` | 60 polls per run: medians 176, 204 and 195 ms, max 189, 216 and 205 ms | P1, P2, P3 |
| warm `GET /public/tickers` | 60 polls per run: medians 358, 407 and 394 ms, max 427, 430 and 717 ms | P1, P2, P3 |
| access | every public call answered from the Canadian VPN exit. No 403, no challenge page | P1, P2, P3 |

## 2. Catalog

### The instruments call

| call | reply | what it holds |
|---|---|---|
| `GET /public/markets` | 6,626 bytes, 24 rows | `market` and `sor_details`: `active`, `buy_enabled`, `sell_enabled`, precisions, `min_tick_size`, per order quantity and amount bounds |
| `GET /public/tickers` | about 10.3 KB, 89 rows | `mkt`, `o`, `h`, `l`, `c`, `qty`, `amt`, `t` |
| `GET /api/v4/public/markets`, legacy | 48,424 bytes, 89 rows | the catalog of the dismissed order book, with `makerFee`, `takerFee`, `activeMarginTrading` and a frozen `currentTradingPrice` |

The SOR catalog on 2026-09-23 held 20 markets quoted in EUR and 4 in USDC, P1 and P2.

```text
AAVE-EUR ADA-EUR BCH-EUR BNB-EUR BNB-USDC BTC-EUR BTC-USDC DOGE-EUR ETH-EUR ETH-USDC HYPE-EUR LINK-EUR
LTC-EUR NEAR-EUR ONDO-EUR POL-EUR RENDER-EUR SOL-EUR SOL-USDC TRX-EUR UNI-EUR USDC-EUR XRP-EUR YNG-EUR
```

All 24 are `active`, and 23 accept buys and sells.
`YNG-EUR`, Young Platform's own token, has `buy_enabled` and `sell_enabled` false, P1.
The ticker call lists 65 more markets that are not in the SOR catalog, such as `TRUMP-EUR`, `XLM-EUR` and `EURC-USDC`, and 53 of the 89 had a non-zero 24 h `qty` in both runs, P1 and P3.
Those 65 look like the app's bilateral list, and the liquidity call still served a book for `TRUMP-EUR` and `AVAX-EUR`, and the socket for `TRUMP-EUR`, see section 5.
The busiest markets by 24 h quote amount were ETH-EUR at about 210,411 EUR and BTC-EUR at about 190,066 EUR, and all EUR markets together came to about 471,703 EUR, P1, with 210,811, 189,466 and 471,684 EUR in the third run, P3.
Ticker `t` values are shared by many rows and were up to 25 minutes old, since a row keeps the time of its last change.

The legacy v4 catalog is not live.
Its `currentTradingPrice` read 51,395.32 for BTC-EUR, 1,383.91 for ETH-EUR and 64.21 for SOL-EUR, against ticker lasts of 76,199, 2,432.23 and 104.45 at the same minute, P2.

### How the engine's catalog would map it

| engine field | Young Platform | note |
|---|---|---|
| catalog source | none | there is no CCXT class, see [`fees.md`](./fees.md) section 8, so `loadMarkets` cannot build it |
| `rawMarketId` | `BTC-EUR` | identical in `markets`, `tickers`, the liquidity path and the socket topic |
| type | spot | no swap exists |
| `contractSize` | 1 | sizes are base currency, S2 |
| `linear` | not applicable | spot |
| `active` | `sor_details.active`, with `buy_enabled` and `sell_enabled` | |
| pair listed twice | BTC, ETH, SOL and BNB each against EUR and USDC | the quote family groups USD, USDC and USDT, so EUR and USDC are two families and nothing collides |

The liquidity call ignores case and separators in the path.
`btc-eur` and `BTC_EUR` both returned the BTC-EUR book with `market` echoing the spelling sent, P1.

## 3. Anchor

Young Platform publishes no index, no mark and no funding rate, because it lists no derivative.

| `AnchorRow` column | Young Platform | source |
|---|---|---|
| `index` | none | S1, S3 |
| `mark` | none | S1, S3 |
| `fundingRate` | none | S1, S3 |
| `fundingIntervalHours` | none | S1, S3 |
| `nextFundingAt` | none | S1, S3 |

Two reference prices exist, and neither is an index in the engine's sense.

- The socket topic `SOR.PI.<pair>` is "a single reference price aggregated across the SOR venues", S2.
  It has no REST twin, and its formula and venue list are not published.
  Its BTC-EUR value sat 0 ppm from the midpoint of the `SOR.OB.BTC-EUR` touch in the median, and -138 to 39 ppm from it over 45 frames, P5.
  So it reads as the router's own mid, not an outside index.
- `mid_price` in the liquidity reply is the exact midpoint of the router's best bid and ask on 24 of 24 markets, P2 and P3.

No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
For the record of the reference price only: `SOR.PI.BTC-EUR` sent 46 frames in about 46 s in each of two runs and took a new value on 27 and 19 of them, P4 and P5.
The execution policy names the router's venues only as "entities duly authorised in the European Economic Area (MiCAR) or in equivalent jurisdictions", S4, and the socket guide's example fill names `kraken_prime`, S2.
Which venues feed `SOR.PI` and the book is Not publicly specified.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET /public/liquidity/{market}`, no depth or limit parameter | S3 |
| documented meaning | "indicative liquidity aggregated across sources, not the order book of a single trading venue", "an estimate of executable depth" | S3 |
| levels | 8 per side on 23 of 24 markets, `ADA-EUR` had 6 bids and then 7 | P2, P3 |
| level order | bids descending and asks ascending on 24 of 24 in three runs | P1, P2, P3 |
| fields | `market`, `time` as ISO 8601 with whole seconds, `mid_price`, `bids` and `asks` of `{price, volume}` strings, volume in base currency | S3, P1 |
| age at arrival | `time` was 1.2 to 3.2 s before arrival over 24 markets and over 60 polls in three runs, and `time` truncates to the second | P1, P2, P3 |
| change rate | over 59 one second intervals on BTC-EUR the body changed 38, 38 and 39 times, and the best bid or ask changed 33, 28 and 30 times in the three runs | P1, P2, P3 |
| spread | 24 markets: min 1,143 to 1,257 ppm (`USDC-EUR`), median 3,301 to 3,363 ppm, max 4,087 to 4,362 ppm over three runs | P1, P2, P3 |
| crossed or empty | none | P1, P2, P3 |
| unknown market | 400 `{"code":"ERR_BAD_REQUEST","message":"book not found"}` | P1 |
| market outside the SOR catalog | `TRUMP-EUR` returned 8 bids and 8 asks, `AVAX-EUR` 8 bids and 5 asks | P1, P3 |

The book sits outside Kraken's touch, and Kraken is a venue the router uses in its own documentation example, S2.
The probe read it beside Kraken's public ticker in the same instant.

| pair | Young Platform bid and ask | Kraken bid and ask | Young Platform bid under Kraken bid | Young Platform ask over Kraken ask |
|---|---|---|---:|---:|
| BTC-EUR, 04:31 UTC | 76,126 and 76,370 | 76,249 and 76,249.1 | 1,616 ppm | 1,586 ppm |
| BTC-EUR, 04:43 UTC | 76,122 and 76,361 | 76,246.3 and 76,246.4 | 1,630 ppm | 1,503 ppm |
| ETH-EUR, 04:43 UTC | 2,430.28 and 2,437.63 | 2,433.52 and 2,433.61 | 1,331 ppm | 1,652 ppm |
| SOL-EUR, 04:43 UTC | 104.35 and 104.68 | 104.5 and 104.51 | 1,435 ppm | 1,627 ppm |
| BTC-EUR, 04:49 UTC | 76,190 and 76,432 | 76,317.4 and 76,317.5 | 1,669 ppm | 1,500 ppm |
| ETH-EUR, 04:49 UTC | 2,432.7 and 2,440.19 | 2,436.36 and 2,436.37 | 1,502 ppm | 1,568 ppm |
| SOL-EUR, 04:49 UTC | 104.54 and 104.87 | 104.7 and 104.71 | 1,528 ppm | 1,528 ppm |

So the router's touch is about 0.13% to 0.17% worse than Kraken's on each side, before the 0.40% commission of [`fees.md`](./fees.md) section 2.
Whether that margin is a spread the router adds or the touch of other venues is Not publicly specified.

The deepest level is not always an order.
In the second run the eight bids of `AAVE-EUR` summed to 89,498,117 EUR against 1,086,752 EUR of asks, P2.
The bid sides of `DOGE-EUR`, `LINK-EUR`, `LTC-EUR`, `POL-EUR`, `SOL-EUR`, `SOL-USDC` and `UNI-EUR` also summed to 88 to 177 million quote units against ask sides of 0.5 to 42 million, P2.
In the third run the deepest bid alone was over 10 million quote units on 8 of 24 markets, P3.

| market | deepest bid, quote units | distance from the best bid |
|---|---:|---:|
| `AAVE-EUR` | 89,179,732 | 39,809 ppm |
| `DOGE-EUR` | 87,297,130 | 19,883 ppm |
| `LINK-EUR` | 88,227,814 | 41,388 ppm |
| `LTC-EUR` | 88,929,246 | 40,279 ppm |
| `POL-EUR` | 87,334,853 | 80,913 ppm |
| `SOL-EUR` | 88,506,229 | 8,706 ppm |
| `SOL-USDC` | 159,174,111 | 6,361 ppm |
| `UNI-EUR` | 22,365,936 | 38,785 ppm |

Only `SOL-USDC` had such an ask, 20,283,667 USDC at 3,254 ppm from the best ask.
The engine would read those levels as depth, so a walk of this book reaching its eighth level would be fiction.
The REST book and the socket book read 3 s apart showed the same best bid, 76,161 EUR for 0.065 BTC, P5.

## 6. Rate limits and errors

No rate limit is published for the trader API, S1 and S3, and none of the error replies carried a rate limit or `Retry-After` header, P1 and P3.
No 429 was seen at the probe's pace, at most four requests a second.
The help center's "Exchange Rate Limiter" of 2023 counts penalty points on order placement and cancellation, 60 points with a decay of 1 a second, S6, and it applied to order entry through the old API, which was switched off on 2026-06-25, see [`fees.md`](./fees.md) section 7.

| request | status | body |
|---|---|---|
| `GET /public/liquidity/NOPE-EUR` | 400 | `{"code":"ERR_BAD_REQUEST","message":"book not found"}` |
| `GET /public/tickers/NOPE-EUR` | 400 | `{"code":"ERR_BAD_REQUEST","message":"ticker not found"}` |
| `GET /public/charts/BTC-EUR?interval=7` | 400 | `{"code":"ERR_BAD_REQUEST","message":"invalid interval"}` |
| `GET /public/nope` or `GET /public/liquidity/` | 404 | `404 page not found`, plain text |
| `GET /private/balance` without credentials | 401 | empty |
| `GET /api/v3/markets` or `GET /api/v3/ticker?pair=BTC-EUR` | 400 | `{"msg":"migrate to new APIs, https://github.com/YoungAgency/youngplatform_api_docs"}` |
| `GET /api/v3/orderbook?pair=BTC-EUR` | 400 | `{"error":"ERR_BAD_REQUEST","message":"Migrate to v4"}` |
| `GET /api/v4/public/trades?pair=BTC-EUR` and `GET /api/v4/public/orderbook?pair=BTC-EUR` | 400 | the same "migrate to new APIs" body |

The error shape of the trader API is `ErrorResponse`, `{code, message}`, S3.
Private calls use an HS256 or ES256 JWT with `aud` `trader` and an `X-Api-Key-Id` header, S1, and orders go to `POST /private/sor/orders` as `LIMIT` with FOK or IOC, S3.

## 7. Server time and clock offset

The trader API has no time call.
The legacy `GET /api/v4/public/time` still answers, `{"time":"2026-09-23T04:41:49.2597371Z"}`, with sub millisecond digits.
Over 10 calls the server time minus the local midpoint was min -1.5, median -0.5 and max 334.5 ms, and the outlier came with a reply of 899 ms, P2.
The rerun gave min 1.5, median 3.5 and max 250 ms, with a slowest reply of 686 ms, P3.
The `Date` header gave medians of 74.5, 7.5 and 185 ms in three runs, good only to half a second, P1, P2 and P3.
The clock of this host is therefore within a few milliseconds of the server, and the socket book's age of about a second in [`websocket.md`](./websocket.md) section 3 is real.

## 8. Recommended poller shape

None.
Young Platform lists no perpetual and publishes no index, mark or funding rate, so there is nothing for an anchor poller to read.

The verdict for the survey is spot only.
The venue cannot join the engine as a perpetual leg: CCXT has no class, no perpetual is listed, and the futures module in its web app is disabled and would carry One Trading's contracts, see [`fees.md`](./fees.md) section 3.
Its spot market would not fit either, since the book is an indicative eight level quote of other venues, about 0.15% outside Kraken's touch on each side, and a cross pays 4,000 ppm at Level 0.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Young Platform API docs, README, `GUIDES/overview.md` and `GUIDES/auth.md`, commits `0d81ff0` of 2026-07-21 and `0d92713` of 2026-07-30 | https://github.com/YoungAgency/youngplatform_api_docs | 2026-09-22 | Young Platform S.p.A. | base URL, public and private surfaces, auth, sections 1, 3 and 6 |
| S2 | `GUIDES/websocket.md` | https://github.com/YoungAgency/youngplatform_api_docs/blob/main/GUIDES/websocket.md | 2026-09-22 | Young Platform S.p.A. | `SOR.PI` definition, base currency sizes, `kraken_prime` example, sections 2 to 4 |
| S3 | `trader_openapi.json` | https://github.com/YoungAgency/youngplatform_api_docs/blob/main/trader_openapi.json | 2026-09-22 | Young Platform S.p.A. | paths, schemas, liquidity semantics, error shape, sections 2, 3, 5 and 6 |
| S4 | Execution policy under article 78 MiCAR, version June 2026 | https://youngplatform.com/en/legal/ | 2026-09-22 | Young Platform S.p.A., Italy | venue eligibility, section 4 |
| S5 | CCXT master, `ts/src` listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-22 | CCXT | no class, section 2 |
| S6 | Come funziona l'Exchange Rate Limiter?, 2023-06-21 | https://support.youngplatform.com/hc/it/articles/10636760063890 | 2026-09-22 | Young Platform, Italian help center | legacy order penalty counter, section 6 |
| P1 | `rest-probe.mjs all`, 04:31 to 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 5 and 6 |
| P2 | `rest-probe.mjs all`, 04:41 to 04:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 5 and 7, the Kraken comparison |
| P3 | `rest-probe.mjs all`, 04:48 to 04:50 UTC, the second pass, and `rest-probe.mjs errors` after it | [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the third readings, the deepest levels, the v4 error rows |
| P4 | `ws-probe.mjs book`, 04:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/young-platform/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `SOR.PI` cadence, section 4 |
| P5 | `ws-probe.mjs book`, 04:50 UTC, the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/young-platform/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `SOR.PI` against the book mid, the REST and socket touch, sections 3 to 5 |
