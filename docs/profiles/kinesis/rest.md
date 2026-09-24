# Kinesis REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:51 to 05:11 UTC in two runs, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

Kinesis lists no perpetual, so this profile covers the spot market, per the survey plan's spot variant.
Two REST surfaces exist.
The documented one is `https://client-api.kinesis.money/v1/exchange/…`, published only as example code in the `bullioncapital/kinesis-api` repository, and it signs every call, market data included, with an account key, S1.
The other is `https://fastapi.kinesis.money/api/…`, the backend of the web app at `kms.kinesis.money`, whose market data calls answer without credentials but are undocumented, B1.
Every number below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs), P1 to P3 in the first run and P4 to P6 in the rerun, unless it names another source.
The access results come from the Canadian VPN exit named in the Probed line.

## 1. Host and latency from this machine

| host | resolves to | role |
|---|---|---|
| `fastapi.kinesis.money` | `166.117.2.180`, `166.117.239.99`, AWS Global Accelerator addresses | web app API and sockets, no credentials needed for market data |
| `client-api.kinesis.money` | CNAME `kbe-prod-exchange-client-api-alb-611287103.ap-southeast-2.elb.amazonaws.com`, then `3.104.14.114`, `32.236.60.110`, `52.63.74.195` | documented API, an AWS load balancer in `ap-southeast-2`, Sydney |
| `kms.kinesis.money` | CloudFront, `server: AmazonS3` in a `curl -I` reply | the web app's static files |

| call | first run | rerun |
|---|---|---|
| `GET /api/exchange/depth/KAU_C1USD`, new connection each time | 495, 481, 466 ms | 473, 486, 477 ms |
| same, reused connection, after the first | 160, 164, 160, 161 ms | 170, 164, 172, 163 ms |
| same, 60 polls one second apart on one connection | min 161, median 163, p90 169, max 487 ms | min 161, median 164, p90 174, max 494 ms |

`curl -w` on `/api/exchange/fees/trade`, three requests between the two probe runs, showed TCP connected at 12 to 13 ms, TLS done at 298 to 311 ms and the first byte at 449 to 470 ms.
So the accelerator's edge is near this host, while the TLS and the reply come from a backend about 150 ms away, consistent with Sydney, which is an inference from the timings and the `client-api` load balancer's region.

Unsigned calls to the documented API all failed.

| call | status | body |
|---|---|---|
| `GET https://client-api.kinesis.money/v1/exchange/pairs` | 403 | `{"message":"Forbidden resource","error":"Forbidden","statusCode":403}` |
| `GET …/v1/exchange/mid-price/KAU_USD` | 403 | same |
| `GET …/v1/exchange/depth/KAU_USD` | 403 | same |

The reply names no region, and the example code sends `x-api-key`, `x-nonce` and `x-signature` on these same calls, S1, so this is the key check and not a geoblock.
The API key comes from `https://kms.kinesis.money/settings/api-keys`, so a key needs a verified account, S1.

## 2. Catalog

### The instruments call

`GET https://fastapi.kinesis.money/api/tradeable-symbols/public?includeOrderRange=true&includeKvtPairs=true` returns 162 pairs, 33,723 bytes, in 171 and 178 ms.
The same path without `/public` answers 403 `Forbidden resource`.
The web app calls the `/public` form when no one is logged in, from `symbols-Cd-1-xun.js`, B1.

```json
{"id":"KAU_C1USD","base":{"code":"KAU","type":"crypto"},"quote":{"code":"C1USD","type":"hybrid"},"fee":"C1USD","canBuy":true,"canSell":true,"sortOrder":1,"baseDecimals":5,"quoteDecimals":7,"orderRange":0.5}
```

| field | observed |
|---|---|
| `id` | `<base>_<quote>` on 162 of 162, the same spelling the depth call and the depth socket use |
| `canBuy`, `canSell` | true on 162 of 162, the only status the reply carries |
| `fee` | the quote code on 162 of 162, see [`fees.md`](./fees.md) section 2 |
| `base.type` | `crypto` on 153 and `hybrid` on 9, where the Currency One stablecoins are `hybrid` |
| `orderRange` | a number such as 0.5, whose meaning is Not publicly specified |
| derivative | none, no id looks like a perpetual, future or option |

Pairs by quote on both runs: C1USD 48, C1GBP 12, C1EUR 12, C1AUD 12, C1CAD 12, C1CHF 12, KAG 11, KAU 10, C1AED 10, C1SGD 10, USDT 4, USDC 4, C1JPY 2, C1MXN 2 and BTC 1.

`GET /api/exchange/symbol-pair-settings/all` returns 434 rows of `{id, symbolId, baseDecimals, quoteDecimals, createdAt, updatedAt}`, and 272 of them are not in the public list.
They include metals not yet listed, such as `KCU_C1USD` and `KNI_C1USD` created on 2026-06-03, and older fiat pairs such as `BTC_USD` and `KAU_EUR`.
The snapshots socket also carries 48 pairs ending in `_USD` that the catalog does not list, see [`websocket.md`](./websocket.md) section 6.
The catalog to trust is the `/public` list.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no Kinesis class, and CCXT master on 2026-09-22 has none either, see [`fees.md`](./fees.md) section 8.
The engine's catalog comes from `loadMarkets`, so a Kinesis market cannot enter it without a hand-written connector.

### Settlement family, pairs listed twice, and price scale

| question | answer |
|---|---|
| quote family | 8 of 162 pairs quote in USDT or USDC, the engine's USD family. The 48 C1USD pairs quote in Kinesis's own Currency One dollar, which is not in the family |
| pairs listed twice | `BTC_C1USD`, `BTC_USDT` and `BTC_USDC` are three pairs on one base, and the family rule would pick among them |
| size unit | base currency, see [`websocket.md`](./websocket.md) section 4 |
| price scale | none, a price is per one unit of base |
| name clash | KAU is Kinesis gold and KAG Kinesis silver, which another venue may list under another meaning, so a `DENIED_PAIRS` check would be needed |

## 3. Anchor

Kinesis publishes no index, no mark and no funding, since it lists no perpetual.
No anchor poller is recommended.

It does publish these reference prices, all from the web app backend and all undocumented.

| call | what it gives | probed |
|---|---|---|
| snapshots socket, `latestMidPrice`, `bidPrice`, `askPrice` | a mid and a bid and ask per pair, pushed about 5 times a second | the bid and ask were crossed, bid above ask, on some rows of every 30 s capture, so they are not the book's touch, see [`websocket.md`](./websocket.md) section 6 |
| `GET /api/market-data/trendlines?symbolIds=KAU_C1USD,KAG_C1USD&timeFrame=5&fromDate=…&toDate=…` | one price per 5 minutes per pair | 200, 12 points per pair for the last hour, for example `{"createdAt":"2026-09-23T05:00:00.000Z","price":139.6980202}` |
| `GET /api/market-data/ohlc/v2?symbolId=KAU_C1USD&fromDate=…&to=…&timeFrame=5&requiredCount=5&includeOlderDataPresentFlag=true` | chart bars, `ohlcData`, `ohlcCurrentActive`, `olderDataPresent` | 200 in 213 ms, 5 bars, `volume` 0 on the last bar |
| documented `GET /v1/exchange/mid-price/<pair>` | bid and ask, per the example code's `bidAskCheck`, S1 | 403 without a key |

KAU and KAG are backed by gold and silver bullion, per the fee page cited in [`fees.md`](./fees.md) section 3, but no public call publishes the metal reference price itself.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
For context on how often the book moves, 60 depth polls of `KAU_C1USD` one second apart saw the touch change on 27 of 59 intervals and the whole reply change on 36, and on 35 and 45 of 59 in the rerun.

## 5. REST book snapshot

`GET https://fastapi.kinesis.money/api/exchange/depth/<pair>` is the web app's call, B1.
It takes no depth parameter.

```json
{"symbolId":"KAU_C1USD","buy":[{"amount":22818.20386,"price":139.6060393,"ownedAmount":0},{"amount":456.39676,"price":139.5960403,"ownedAmount":0}],"sell":[{"amount":35119.62838,"price":139.81,"ownedAmount":0},{"amount":7023.92567,"price":139.95,"ownedAmount":0}]}
```

The example keeps two of 81 bids and two of 55 asks.

| item | observed over all 162 pairs, both runs |
|---|---|
| reply time | median 154 and 160 ms, max 170 and 221 ms, one call every 500 ms |
| reply size | 1,058 to 9,016 bytes, and 1,062 to 9,012 in the rerun |
| levels | bids 8 to 100, asks 9 to 83, median 10 on each side, 15 pairs with 20 bids or more and 14 with 20 asks or more |
| level cap | 100 per side: `KAG_C1USD` returned 100 bids while its socket held 104, [`websocket.md`](./websocket.md) section 4 |
| order | `buy` descending and `sell` ascending on 162 of 162 |
| empty, one-sided or crossed | 0 of 162 |
| numbers | JSON numbers, up to 8 price decimals and up to 17 amount decimals |
| `ownedAmount` | 0 on every level, since no one is logged in |
| caching | a weak `ETag` that changes with the book, no `Cache-Control` and no `Age` header. The reply changed on 36 and 45 of 59 one second polls, so it is not cached for a second |
| unknown pair | 200 `{"symbolId":"NOPE_C1USD","buy":[],"sell":[]}`, and the same empty book for `kau_c1usd` and `KAU-C1USD` |

On `BTC_C1USD` the touch sat 124 ppm wide in both runs, on `KAU_C1USD` 1,604 ppm, on `KAG_C1USD` 4,522 and 4,319 ppm, and on `IMX_C1USD` 15,791 and 15,395 ppm.
Every pair's book held at least 8 levels a side with regular price steps, which looks like one automated liquidity provider on every pair.
That is an inference from the book shape, and Terms Schedule 7 clause 2.6.1 says Kinesis is "the immediate counterparty" to each trade, S2.

## 6. Rate limits and errors

No rate limit is published for either API, and the API License Agreement names none, S3.
No reply carried a rate limit header or `Retry-After`.
The probe stayed at or under 2 requests a second and met no refusal, so the limit is Not verified.

| case | status | body |
|---|---|---|
| a private route without a session, such as `/api/tradeable-symbols` or `/api/market-data-api/fx-rate/symbols` | 403 | `{"message":"Forbidden resource","error":"Forbidden","statusCode":403}` |
| an unknown route, such as `/api/exchange/nope` or `/api/exchange/mid-price/KAU_C1USD` | 404 | `{"message":"Cannot GET /api/exchange/nope","error":"Not Found","statusCode":404}` |
| an unknown pair on the depth call | 200 | an empty book, section 5 |

## 7. Server time and clock offset

Neither API has a public time call, and `/api/time` answers 404.
The `Date` header has one second resolution, so five requests bracket the offset of the server clock against this host's clock between -248 and +146 ms in the first run and between -79 and +342 ms in the rerun.
Together the offset lies between -79 and +146 ms.

## 8. Recommended poller shape

None.
Kinesis does not fit the engine as a perpetual leg, and it should not be added as a spot venue either.

| blocker | evidence |
|---|---|
| no perpetual | 162 spot pairs, no derivative, section 2 |
| no CCXT class | [`fees.md`](./fees.md) section 8 |
| the documented API needs an account key even for market data | 403 on unsigned calls, section 1 |
| the keyless calls are the web app's undocumented backend | B1, and they can change with any web release |
| the terms forbid automated data use without consent | Schedule 7 clause 5.1.4 prohibits "Data feed or data stream services that make use of any market data from Kinesis", and clause 5.1.6 prohibits any "robot," "spider," or other automatic device, program, script" used "to access, acquire, copy, or monitor any portion of the properties", S2 |
| the book socket carries one pair per connection and updates at most about once a second per side | [`websocket.md`](./websocket.md) sections 3 and 4 |
| most pairs quote in Kinesis's own stablecoins | 8 of 162 pairs quote in USDT or USDC, section 2 |
| thin volume | about 1.0 million USD in 24 h over 34 CoinGecko tickers, [`fees.md`](./fees.md) section 1 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Kinesis API example repository, `README.md` and `v1/kinesis_api_example.py`, commit `5ef2259` of 2022-04-28 | https://github.com/bullioncapital/kinesis-api | 2026-09-22 | Kinesis | documented host, key headers, endpoint list, sections 1 and 3 |
| S2 | Kinesis Terms of Use, effective 2026-05-28, Schedule 7 clauses 2.6.1, 5.1.4 and 5.1.6 | https://kinesis.money/about-us/documents/terms-of-use/ | 2026-09-22 | Kinesis Cayman | counterparty, data use restrictions, sections 5 and 8 |
| S3 | Kinesis API License Agreement | https://kinesis.money/about-us/documents/api-license-agreement/ | 2026-09-22 | Kinesis | no published rate limit, section 6 |
| B1 | kms.kinesis.money web app bundle: `config-DXqbasct.js` (`defaultApiRoot` `https://fastapi.kinesis.money`), `base-url-C2f2w9eD.js` (`${defaultApiRoot}/api`), `symbols-Cd-1-xun.js` (`tradeable-symbols/public`, `exchange/symbol-pair-settings/all`), `useDepthLoading-Bv2CFafN.js` (`exchange/depth/<pair>`), `useTradingView-DIbvkmKK.js` (`market-data/ohlc/v2`), `market-D4fVDDYD.js` (`market-data/trendlines`) | https://kms.kinesis.money/_assets/ | 2026-09-22 | Kinesis, global | undocumented calls, sections 2, 3 and 5 |
| P1 | `rest-probe.mjs main` at 04:51 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 3, 6 and 7 |
| P2 | `rest-probe.mjs books` at 04:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P3 | `rest-probe.mjs poll` at 04:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 4 and 5 |
| P4 | `rest-probe.mjs main` rerun at 05:08 UTC, the first to include the OHLC call | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 3, 6 and 7 |
| P5 | `rest-probe.mjs books` rerun at 05:08 UTC, the first to report decimals | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P6 | `rest-probe.mjs poll` rerun at 05:10 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 4 and 5 |
