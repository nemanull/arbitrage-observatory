# GoPax Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:30 to 04:55 UTC), from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare trace `loc=CA`, `colo=SEA`).

GoPax is a South Korean spot exchange with a KRW market and a small USDC market, and it lists no perpetual, dated future or option.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
CCXT 4.5.68 has no GoPax class, and neither does the CCXT master branch of 2026-09-22, see section 8.
Every number below carries a source id from section 10, a probe reference, or a CCXT reference.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Streami, Inc. ((주)스트리미), CEO 김나영, business registration 432-87-00120 | S9, site footer |
| address | 12F H Tower, 179 Bongeunsa-ro, Gangnam-gu, Seoul 06122 | S9 |
| country | South Korea | S9 and S10 |
| established | 2016 | S10 |
| ISMS certification | scope "가상자산 거래소 운영(GOPAX)", valid 2024-10-06 to 2027-10-05 | S9 |
| products researched | spot, 111 KRW pairs and 11 USDC pairs listed | P1, see [`rest.md`](./rest.md) section 2 |
| CoinGecko context | trust score 4, trust score rank 131, 24 h volume 3.66 BTC, 47 coins and 50 pairs tracked, read on 2026-09-23 UTC | S10 |

The survey list gave trust rank 127, and the CoinGecko API returned 131 on the day of the probe.

Who may trade:

- The foreigner guide says the customer's information is reviewed under the Act on Reporting and Using Specified Financial Transaction Information (특정금융정보법), and that the review can take up to 3 business days, S6.
- A foreign customer emails a passport copy and a photo of themselves holding the alien registration card (외국인등록증) and a note with the submission date, S6.
- The KYC flow verifies an alien registration card or a domestic residence report (거소신고증) through Hikorea, S7.
- The site's API key page says "법인 또는 외국인 고객님은 API 사용이 불가합니다", so a corporate or a foreign customer cannot use the API at all, S9.
- The KRW deposit interest notice defers payment to "국내 비거주 고객", so accounts held by non-residents of Korea exist, S8.
- KRW deposits and withdrawals run through a real-name account at Jeonbuk Bank (전북은행), S12.
- No page read names the United States or a list of excluded countries.
- The terms of service at `https://www.gopax.co.kr/terms` load from a CMS in the browser and were not read.
- A US person with no Korean identity or residence document has no verification path in the pages read, and even a verified foreign customer cannot trade through the API, S7 and S9.

Access from this host, all through the Canadian VPN exit named above:

- The public REST host `api.gopax.co.kr` answered every call with HTTP 200 and data, except the deliberate error cases, see [`rest.md`](./rest.md) section 1.
- The public socket `wss://wsapi.gopax.co.kr` upgraded with 101 on every attempt without any API key and delivered data, see [`websocket.md`](./websocket.md) section 1.
- `https://www.gopax.co.kr/` answered 200 from CloudFront, and its pages render in the browser, so the fee and membership tables were read from the page bundles, S1 and S2.
- `https://www.gopax.co.kr/API` answered 404, and the REST and WebSocket documentation live on GitHub Pages, S4 and S13.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| KRW spot | 0.20 %, 2,000 ppm | 0.20 %, 2,000 ppm | S1, and `makerFeePercent` 0.2 and `takerFeePercent` 0.2 on all 122 pairs of `GET /trading-pairs`, P1 |
| USDC spot | 0.20 %, 2,000 ppm | 0.20 %, 2,000 ppm | the same catalog fields on the 11 USDC pairs, P1, and S3 says the tiers apply to the KRW and USDC markets alike |

GoPax calls the base tier "일반" (regular), and this profile calls it VIP 0.
All trading fees are charged in the quote asset of the pair since the regular maintenance of 2022-11-01, S4 changelog 2022-10-14.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | no contract field in `GET /trading-pairs`, no derivative endpoint in S4 or S13, and no futures route in the site's route table, S9 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | same |
| spot | present | 122 pairs: 111 quoted in KRW and 11 in USDC, P1 |

CoinGecko's derivatives list of 2026-09-22 does not show GoPax either, as the survey task recorded.

## 4. Spot tiers

The membership program opened on 2025-12-04 09:00 KST, S3.
The tier table is the fee page's `DZ` function, S1.

| tier | maker | taker | taker ppm | qualification |
|---|---|---|---:|---|
| 일반, VIP 0 here | 0.20 % | 0.20 % | 2,000 | no condition |
| VIP 1 | 0.10 % | 0.10 % | 1,000 | 100,000 XP or more |
| VIP 2 | 0.00 % | 0.10 % | 1,000 | 200,000 XP or more |
| VIP 3 | 0.00 % | 0.07 % | 700 | 500,000 XP or more |
| VIP 4 | 0.00 % | 0.05 % | 500 | 1,000,000 XP or more |
| VIP 5 | -0.01 % | 0.05 % | 500 | 2,000,000 XP or more |
| VIP 6 | -0.02 % | 0.05 % | 500 | 5,000,000 XP or more |
| VIP 7 | -0.03 % | 0.05 % | 500 | 10,000,000 XP or more |

The XP thresholds are from S2.

### Qualification

- The tier is set by the XP accumulated over the last 90 days, and it is recomputed every day at 09:00 KST, S2.
- Trading earns 1 XP per 1,000 KRW of filled value, 2 XP for designated assets and 3 XP for newly listed assets, counted per fill in KRW at the fill, S2.
- Ten or more trades in a day, sign-up and first bank account registration also earn XP, S2.
- XP expires 90 days after it is paid, first in first out, S2 and S3.
- The fee is the tier at the time the order is placed, S2.
- So VIP 1 takes about 100,000,000 KRW of ordinary volume in 90 days, which is an inference from the 1 XP per 1,000 KRW rule.
- The tiers apply to the KRW and the USDC market alike, S3.

## 5. Discounts that change the spot taker

- No token holding discount and no referral discount on the trading fee was found, and a friend invitation event was announced as ended on 2026-08-03 in notice 2527, whose body was not read.
- The membership tiers of section 4 are the only standing reduction.
- The notices from 2025-11-18 to 2026-09-21 name no running zero fee promotion.
- The last fee promotion found was a BTC special fee on the KRW market from 2026-05-01 to 2026-05-20 KST, which has ended, S5.
- Maker events pay prizes and do not change the taker rate, for example the USDT maker event from 2026-03-03 to 2026-03-22 KST, which shared 10,000,000 KRW among USDT-KRW makers who quoted within 5 KRW of the spread, S11.

## 6. Funding as a cost

Not applicable.
GoPax lists no perpetual, so it charges no funding.

## 7. Liquidation, settlement and delisting

- Spot only, so there is no liquidation, settlement or delivery charge.
- A delisted pair leaves `GET /trading-pairs`, but `GET /tickers` still returns it, see [`rest.md`](./rest.md) section 2.
- No delisting charge is published.
- Deposit and withdrawal fees are listed per asset on `https://www.gopax.co.kr/feeinfo` and in the `withdrawalFee` field of `GET /assets`, S1 and S4.

## 8. CCXT

| check | result |
|---|---|
| `require('ccxt').exchanges` in 4.5.68, run from `server/` | 104 ids, none matches `gopax`, P1 |
| `server/node_modules/ccxt/js/src/` | no `gopax.js` |
| `ts/src` on CCXT master, commit `1d8b674` of 2026-09-22 12:48 UTC | 105 TypeScript files, none named `gopax`, S14 |
| `ts/src/pro` on the same commit | no `gopax` file, S14 |
| history | CCXT removed `js/gopax.js` in commit `567b1c6` of 2021-08-27 and again in `9d025a9` of 2021-09-02, both titled "gopax shutdown", and the release commit `30d6732` of 2021-09-02 is titled "ccxt 1.55.64 gopax delisted", S14 |

`market.taker` is therefore not available for any GoPax market, and `ccxtTakerPpm` has no CCXT constant to cite.
The GoPax REST documentation still says the API can be used "through CCXT", S4, which has not been true since 2021.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | none | GoPax cannot join the engine as a perpetual leg, since it lists no perpetual and has no CCXT class |
| `ccxtTakerPpm` | none | no CCXT class |

If a later design adds spot legs, the VIP 0 spot taker is 2,000 ppm on both quote markets, S1 and P1.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GoPax fee page, 수수료 안내, read from its page bundle `app/(service)/feeinfo/page-f8941a5cc1f02cb8.js` and the tier function in chunk `6557-23dcfe2601304d3a.js` | https://www.gopax.co.kr/feeinfo | 2026-09-22 | Streami, Korea | VIP 0 maker and taker, tier table, deposit and withdrawal lookup, sections 2, 4 and 7 |
| S2 | GoPax membership program page, read from chunk `7676-09980f3e24857f6b.js` | https://www.gopax.co.kr/membership-introduction | 2026-09-22 | Streami, Korea | XP thresholds, XP rules, 90 day window, fee at order time, section 4 |
| S3 | Notice 2247, membership program launch, updated 2026-03-04 | https://www.gopax.co.kr/notice/detail?id=2247 | 2026-09-22 | Streami, Korea | launch 2025-12-04, tiers for KRW and USDC markets, XP expiry, sections 2 and 4 |
| S4 | GoPax REST API documentation, English | https://gopax.github.io/API/index.en.html | 2026-09-22 | Streami | fee in quote asset, `/assets` fields, CCXT sentence, sections 2, 7 and 8 |
| S5 | Notice 2419, BTC fee event | https://www.gopax.co.kr/notice/detail?id=2419 | 2026-09-22 | Streami, Korea | the ended BTC fee promotion, section 5 |
| S6 | Foreigner guide page, read from `app/(service)/foreigner-guide/page-290629dbc4c2ce13.js` | https://www.gopax.co.kr/foreigner-guide | 2026-09-22 | Streami, Korea | foreign customer documents and review, section 1 |
| S7 | Notice 2497, Hikorea alien registration verification outage | https://www.gopax.co.kr/notice/detail?id=2497 | 2026-09-22 | Streami, Korea | alien registration card and domestic residence report in KYC, section 1 |
| S8 | Notice 2492, Q2 2026 KRW deposit interest | https://www.gopax.co.kr/notice/detail?id=2492 | 2026-09-22 | Streami, Korea | non-resident customers exist, section 1 |
| S9 | GoPax site bundle: footer in chunk `397-c1b2423418e405c3.js`, API key page text in chunk `6557-23dcfe2601304d3a.js`, route table in chunk `1460-bb3d1063a3c6c8aa.js` | https://www.gopax.co.kr/ | 2026-09-22 | Streami, Korea | operator, address, ISMS, no API for foreign or corporate customers, no derivatives route, sections 1 and 3 |
| S10 | CoinGecko exchange API, `gopax` | https://api.coingecko.com/api/v3/exchanges/gopax | 2026-09-23 UTC | CoinGecko | country, year, trust score and rank, volume, section 1 |
| S11 | Notice 2349, USDT maker king event | https://www.gopax.co.kr/notice/detail?id=2349 | 2026-09-22 | Streami, Korea | maker reward event, section 5 |
| S12 | Notice 2451, Jeonbuk Bank maintenance | https://www.gopax.co.kr/notice/detail?id=2451 | 2026-09-22 | Streami, Korea | KRW deposits and withdrawals through a Jeonbuk Bank real-name account, section 1 |
| S13 | GoPax WebSocket API documentation, English | https://gopax.github.io/wsapi/index.en.html | 2026-09-22 | Streami | no derivative channel, section 3 |
| S14 | CCXT on GitHub: `ts/src` and `ts/src/pro` listings at master `1d8b674434fde39ef282988b066812adf8d19b9e`, commits `567b1c62e2d5ef5096341d1d234187359b405205` and `9d025a93c2f1e33b39f543e0b51b6054087201ef` | https://github.com/ccxt/ccxt | 2026-09-22 | CCXT | no class today, removal in 2021, section 8 |
| P1 | `rest-probe.mjs catalog` at 04:31 UTC, and `all` from 04:47 UTC for the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/gopax/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog fee fields, pair counts, CCXT id list, sections 1 to 3 and 8 |

The notices were read through the public `GET https://api.gopax.co.kr/notices?format=1` call, 300 notices from 2025-11-18 to 2026-09-21, and each is linked at the site URL the notices themselves use.
