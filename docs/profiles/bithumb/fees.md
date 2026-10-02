# Bithumb Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:13 to 03:30 UTC for run 1 and 03:35 to 03:44 UTC for run 2, from the development host near Seattle.

Bithumb is CoinGecko's trust rank 51 on 2026-09-22, it lists no perpetual, and its CCXT 4.5.68 class is `bithumb`.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Fee numbers come from the official help center, read through its public Zendesk API because the article pages answer this host with HTTP 403, see section 10.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bithumb/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bithumb/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 local time, 2026-09-23 UTC | this profile |
| venue | Bithumb, a South Korean spot exchange founded in 2014, CoinGecko trust score 7, rank 51, 24 h volume 7,527 BTC | S12 |
| legal entity | the operating company name was not confirmed from an official page on this date, the terms page timed out and the help center articles read do not name it | S1 to S11 |
| who may trade | adults with a Korean mobile phone in their own name, a completed customer verification, and one real-name KB Kookmin Bank account | S9, S10, S11, S15 |
| foreigners | "외국인은 회원가입이 어렵습니다. (국내 거주 외국인 포함 가입 불가)", so no foreign national may open an account, including one resident in Korea | S9 |
| minors | under 19 may not use the service | S11 |
| US persons | a US person who is not a Korean national cannot sign up, by the foreigner rule above | S9 |
| public API from this host | REST `api.bithumb.com` answered 200 and the WebSocket `ws-api.bithumb.com` opened with no refusal, see [`rest.md`](./rest.md) section 1 | run 1 |

The API documentation and the help center are in Korean.
Quoted Korean text is kept verbatim and translated beside it.

## 2. Quick answer

| market | maker | taker | ppm maker | ppm taker | condition | source |
|---|---|---|---|---|---|---|
| KRW market, base rate | 0.25 % | 0.25 % | 2,500 | 2,500 | no application, or after the 30 day discount expires | S2, S3, S14 |
| KRW market, "국내 최저 수수료" discount | 0.04 % | 0.04 % | 400 | 400 | a free application in the app, valid 30 days from the application date | S1, S2, S3 |
| BTC market | 0 % | 0 % | 0 | 0 | none, shown as "수수료 무료", free | S1, S5 |

The help center fee table strikes 0.25 % through and prints 0.04 % beside it for the KRW market, S1.
The discount is not automatic.
S2 says "신청일 기준 30일 기간 동안 0.25%에서 0.04%로 할인된 거래 수수료를 제공", a discount from 0.25 % to 0.04 % for 30 days from the application date.
S3 says "기간이 만료되면 0.25%가 적용됩니다", once the period expires 0.25 % applies.
So the rate an account pays with no action is 2,500 ppm, and 400 ppm is one tap away and has to be renewed every 30 days.
Maker and taker pay the same rate on every market.
The fee is charged as fill price times fill quantity times the rate, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps, any settlement | absent | no derivative endpoint in the API index S16, CCXT `swap: false` at `server/node_modules/ccxt/js/src/bithumb.js` line 30, and Bithumb is not among the 113 venues of CoinGecko's derivatives list on 2026-09-22 S12 |
| dated futures | absent | CCXT `future: false` at line 31, S16 |
| options | absent | CCXT `option: false` at line 32, S16 |
| margin | absent | CCXT `margin: false` at line 29 |
| spot, KRW quoted | present, 480 markets | `GET /v1/market/all`, run 1 |
| spot, BTC quoted | present, 13 markets | `GET /v1/market/all`, run 1 |
| spot, USDT or USDC quoted | absent | no `USDT-` or `USDC-` market in `/v1/market/all`, and the legacy `GET /public/ticker/ALL_USDT` answers status `5500` "입력값을 확인해 주세요." (check the input), run 1 |
| stablecoins as a base | present: `KRW-USDT`, `KRW-USDC`, `KRW-USD1`, `KRW-USDE` and `BTC-USDC` | run 1 |
| TWAP orders | present, charged like a KRW market order | S14 |
| coin lending ("코인대여", "렌딩플러스") | present, not a derivative, named in S7 | S7 |

The KRW market quotes in Korean won, which is not in the engine's USD, USDC and USDT settlement family, see [`rest.md`](./rest.md) section 2.

## 4. Spot tiers

There is no published maker and taker schedule by volume.
The membership programme sorts accounts into six grades, black to white, from the previous month's trade value, set on the first of each month, S6.
A grade changes rewards and not the fee rate.
It pays trade points of at most 0.01 % of the daily trade value, and maker rewards on maker fills, with every membership benefit capped at 3,000,000 points a month in total, S6.
The grade thresholds are published only as an image in S6, and were not transcribed.

| grade effect | value | source |
|---|---|---|
| trade points | up to 0.01 % of daily trade value, 100 ppm | S6 |
| maker reward | paid on maker fill value, rate Not publicly specified in the articles read | S6 |
| monthly cap on points and rewards | 3,000,000 points | S6 |

## 5. Discounts that change the spot taker

| discount | effect | end date | source |
|---|---|---|---|
| "국내 최저 수수료 신청" (lowest domestic fee application) | KRW market 0.25 % to 0.04 % for 30 days, renewable, with an app push 7 days before expiry | none published | S2, S3 |
| BTC market | 0 % on every account | none published | S1, S5 |
| API trade fee payback | KRW market fees paid through an API key are paid back in KRW up to a cumulative API trade value of 100 billion KRW, fee free markets excluded, and the payback lapses after 30 days without trading | none published | S7 |
| VIP matching programme | accounts with 1 billion KRW a month of trading on another exchange or broker get an immediate grade and "거래 수수료 무료", fee free trading | none published | S8 |
| token holding | none found in the fee articles read | S1, S2 |

## 6. Funding as a cost

None.
Bithumb lists no perpetual, so there is no funding rate, interval, cap or settlement, see section 3.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement charge, since there is no leveraged product.
Delisting follows the Korean exchange alert system.
`GET /v1/market/all?isDetails=true` flags 23 of 493 markets `CAUTION` (유의 종목, designated for caution), and `GET /v1/market/virtual_asset_warning` listed 69 alerts in run 1 and 70 in run 2, including 2 and then 3 of type `PRICE_DIFFERENCE_HIGH`, "글로벌 시세 차이", a gap to the global price, see [`rest.md`](./rest.md) section 4.
Deposit and withdrawal fees are looked up through the page "입출금 수수료 조회" of the API index S16, and are out of scope here.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `bithumb`, spot only, `swap: false` | `server/node_modules/ccxt/js/src/bithumb.js` lines 21 and 28 to 32 |
| `market.taker` without credentials | `0.0025`, 2,500 ppm, on all 480 KRW and all 13 BTC markets | `fees.trading.taker` at line 167, maker at line 166, run 2 `ccxt_taker_by_quote` |
| markets endpoint | the legacy `GET /public/ticker/ALL_KRW` and `ALL_BTC`, one call per quote in `options.quoteCurrencies`, which holds KRW and BTC | lines 298 to 307 and 253 to 272 |
| `market.id` | the base alone, `BTC` for `BTC/KRW`, so 13 ids are shared by a KRW and a BTC market | line 367, run 1 `ccxt_ids_shared` |
| fee source comment | `'fees': 'https://en.bithumb.com/customer_support/info_fee'`, which now redirects to a single page app with no fee number in its HTML | line 124, S13 |

CCXT's constant equals the base rate and not the discounted one.
CCXT also reports 2,500 ppm on the 13 BTC markets, which charge 0 %.

## 9. Recommended registry values

No registry entry is recommended.
The engine's catalog keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196, and Bithumb has none, so the connector would load zero markets.
If a spot leg were ever modelled, `takerPpm: 2500` is the rate an account pays with no action, `takerPpm: 400` is the rate with the 30 day application, and `ccxtTakerPpm: 2500` matches CCXT's constant at `server/node_modules/ccxt/js/src/bithumb.js` line 167.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 거래 수수료는 얼마인가요? (What is the trade fee?), updated 2026-04-22 | https://support.bithumb.com/hc/ko/articles/51131554420377 | 2026-09-22 | Bithumb, Korea | KRW 0.25 % struck to 0.04 %, BTC market free, fee formula, sections 2 and 5 |
| S2 | 국내 최저 수수료 0.04% 신청이 무엇인가요?, updated 2026-08-11 | https://support.bithumb.com/hc/ko/articles/51131586657689 | 2026-09-22 | Bithumb, Korea | the 30 day discount from 0.25 % to 0.04 %, sections 2 and 5 |
| S3 | 국내 최저 수수료 0.04% 신청했는데 기본 수수료가 적용된 것 같아요., updated 2026-08-11 | https://support.bithumb.com/hc/ko/articles/51131605439641 | 2026-09-22 | Bithumb, Korea | 0.25 % after expiry, 7 day push notice, section 5 |
| S4 | 원화 마켓 거래 정책 안내 (KRW market trading policy), updated 2026-08-11 | https://support.bithumb.com/hc/ko/articles/51036972377241 | 2026-09-22 | Bithumb, Korea | fee table, 5,000 KRW minimum order, tick sizes by price band |
| S5 | BTC 마켓 거래 정책 안내 (BTC market trading policy), updated 2026-08-11 | https://support.bithumb.com/hc/ko/articles/51036943631257 | 2026-09-22 | Bithumb, Korea | BTC market free, fixed tick of 0.00000001 BTC |
| S6 | 빗썸 멤버십 and 포인트와 메이커 리워드의 지급 제한이 있나요?, updated 2026-04-21 and 2025-11-27 | https://support.bithumb.com/hc/ko/articles/51037042757657 and https://support.bithumb.com/hc/ko/articles/51144621495065 | 2026-09-22 | Bithumb, Korea | six grades, 0.01 % points, maker reward, 3,000,000 point monthly cap, section 4 |
| S7 | API 거래 수수료 페이백 articles, updated 2025-11-28 to 2025-12-01 | https://support.bithumb.com/hc/ko/articles/52816706062233 and https://support.bithumb.com/hc/ko/articles/52816736645657 | 2026-09-22 | Bithumb, Korea | API fee payback to 100 billion KRW, lapse rule, lending named, sections 3 and 5 |
| S8 | VIP 매칭 프로그램은 무엇인가요?, updated 2026-06-30 | https://support.bithumb.com/hc/ko/articles/54923768603417 | 2026-09-22 | Bithumb, Korea | fee free trading for matched VIPs, section 5 |
| S9 | 빗썸 외국인도 가입이 가능한가요? and 외국인은 고객확인이 가능한가요? | https://support.bithumb.com/hc/ko/articles/51036096919065 and https://support.bithumb.com/hc/ko/articles/51129408534041 | 2026-09-22 | Bithumb, Korea | foreigners cannot sign up or verify, section 1 |
| S10 | 계좌 연결이 안돼요 (account link fails), updated 2026-06-05 | https://support.bithumb.com/hc/ko/articles/52816484189593 | 2026-09-22 | Bithumb, Korea | KB Kookmin Bank account only, one per person, no minors or foreigners, section 1 |
| S11 | 빗썸 미성년자는 빗썸을 이용할 수 없나요? | https://support.bithumb.com/hc/ko/articles/51036157623449 | 2026-09-22 | Bithumb, Korea | under 19 excluded, section 1 |
| S12 | CoinGecko API, `/exchanges/bithumb` and `/derivatives/exchanges?per_page=250` | https://api.coingecko.com/api/v3/exchanges/bithumb | 2026-09-22 | CoinGecko | trust score 7, rank 51, 7,527 BTC volume, absent from 113 derivatives venues, sections 1 and 3 |
| S13 | CCXT 4.5.68 `bithumb.js` | `server/node_modules/ccxt/js/src/bithumb.js` | 2026-09-22 | CCXT | section 8 |
| S14 | 수수료는 어떻게 적용되나요? (how is the fee applied, TWAP), updated 2026-08-11 | https://support.bithumb.com/hc/ko/articles/55133079159449 | 2026-09-22 | Bithumb, Korea | "0.25%, 국내 최저 수수료 신청 시 0.04%", section 2 |
| S15 | 빗썸 회원가입은 어떻게 하나요? (how to sign up) | https://support.bithumb.com/hc/ko/articles/51036107406873 | 2026-09-22 | Bithumb, Korea | own name mobile phone, customer verification and real-name account, section 1 |
| S16 | Bithumb API documentation index `llms.txt` | https://apidocs.bithumb.com/llms.txt | 2026-09-22 | Bithumb, Korea | every public and private endpoint, no derivative endpoint, section 3 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/bithumb/rest-probe.mjs) `catalog`, run 1 at 03:13 UTC and run 2 at 03:35 UTC | local | 2026-09-23 UTC | this host | market counts, CCXT taker and ids, alert counts, sections 3, 7 and 8 |

The help center article pages answered this host with HTTP 403 on 2026-09-23 03:30 UTC, while the Zendesk Help Center API at `https://support.bithumb.com/api/v2/help_center/ko/articles/<id>.json` answered 200 with the same article body.
The rows above cite the public article URL, and the text was read from the API reply.
