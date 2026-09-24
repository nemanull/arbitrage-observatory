# Digital X Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:12 to 03:40 UTC, from the development host near Seattle.

Digital X is the South Korean exchange that was Korbit until its 2026 rebrand under Mirae Asset.
CoinGecko keeps it under the exchange id `korbit` with the name Digital X, and its notice says "Korbit has recently rebranded to Digital X", S1.
It lists no perpetual, and neither CCXT 4.5.68 nor the current CCXT master has a class for it.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The web pages are client rendered, so the fee page, the fee notices, the terms and the FAQ were read from one headless browser render each, S2 to S6.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/digital-x/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/digital-x/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC | this profile |
| legal entity | 디지털엑스 주식회사 (Digital X Co., Ltd.), formerly Korbit, a member of the Mirae Asset group | S3, S5 |
| terms in force | the terms applied from 2026-09-16, replacing the terms of 2026-08-11 | S5, addendum |
| governing law | Republic of Korea | S5, last article |
| who may trade | individuals who complete customer verification and link a real-name bank account for KRW | S5 Article 14 ①, S2 |
| who may be refused | an applicant under 19, a non-resident, or a foreign corporation, S5 Article 5 ③ 1 | S5 |
| foreigners | "외국인 회원도 회원가입이 가능합니다. 단, 신규 고객확인이 제한되어 거래소 이용이 어려운 점 참고 부탁드립니다." A foreigner may sign up, but new customer verification is restricted, so the exchange is hard to use | S6, FAQ Q5 |
| non-residents | "비거주자는 신규 고객확인이 제한되어 이용이 제한됩니다." New verification of a non-resident is restricted | S6, FAQ Q10 |
| US persons | no rule names the United States. A US person who is not a Korean resident is a non-resident and falls under the two rules above | inference from S5 and S6 |
| public data from this host | REST answered 200 on every documented public call, and the public WebSocket opened with 101 | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

| product | maker | taker | ppm maker / taker | valid |
|---|---:|---:|---:|---|
| KRW spot, every member, now | 0 % | 0 % | 0 / 0 | from 2026-08-24 09:00 KST for one year, S3 |
| KRW spot, the "free plan" before the promotion | 0 % | 0.2 % | 0 / 2,000 | since 2025-02-01 00:00 KST, S2 |

The promotion notice says every pair trades free for one year from Monday 2026-08-24 09:00 KST, applied to every member without sign-up, S3.
Its compliance approval number carries the period 2026.08.24 to 2027.08.24, S3.
When the promotion ends, "기존 수수료율 및 메이커 인센티브가 적용되며, 세부 내용은 추후 공지를 통해 안내드립니다."
The previous rates and the maker incentive return, with details in a later notice, S3.
An order accepted during the free period stays free even if it fills after the end, S3.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot, KRW quote | yes, 227 pairs, 193 `launched` and 34 `stopped` | `GET /v2/currencyPairs`, P1 |
| spot, other quotes (USDT, BTC) | absent, every pair quotes `krw` | P1 |
| perpetual swaps | absent | the Open API lists quotation, trading, asset, deposit and withdrawal endpoints only, S7, the site's page manifest has no futures or derivatives page, S8, and CoinGecko's derivatives list of 113 exchanges does not include it, S1 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| margin | absent from the Open API | S7 |
| other products | coin lending (코인 렌딩), Staking Plus and recurring purchase exist on the site, not researched | S8 |

`usdt_krw` and `usdc_krw` are spot books like any other pair.
`usdt_krw` was the busiest pair on the venue, 69,984 million KRW of 24 h quote volume of 96,791 million across the launched pairs, and 70,254 of 97,011 million in the rerun, P1.

## 4. Spot tiers

No tier table by volume is published on the fee page as rendered on 2026-09-22, S2.
The page names a "free plan" whose taker became 0.2 % from 2025-02-01 00:00 KST while its maker stayed 0 %, S2.
It also says a member may change plan, which suggests other plans existed, but the captured page does not list them, so they are Not publicly specified here.
Plan changes need customer verification and a linked Shinhan Bank account, cannot be made twice within 7 days, and cannot be made with open orders, S2.

The Open API example for `GET /v2/tradingFeePolicy` shows `"takerFeeRate": "0.0015"`, `"makerFeeRate": "0"` and `"maxFeeRate": "0.002"` for `btc_krw`, S7.
That is an illustration in the reference, not a schedule.
The call itself needs a signed request and answered `400 {"code":400,"message":"NO_TIMESTAMP"}` unsigned, P1.

## 5. Discounts that change the spot taker

| discount | effect | dates | source |
|---|---|---|---|
| free trading promotion | maker and taker 0 for every member | 2026-08-24 09:00 KST to 2027-08-24, one year | S3 |
| VIP fee benefit | a VIP member may choose a fee benefit among the VIP premium benefits, rate not stated | ongoing | S2 |
| VIP maker incentive | 0.01 % of monthly maker fill value up to 10 billion KRW, 0.005 % on the part above, at most 3 million KRW per member per month, paid on the 5th of the next month in KRW points, only when at least 10,000 KRW | from 2026-09-17 00:00 KST until a separate end notice | S4 |
| VIP qualification | 3 billion KRW of trading value in the last month, or 200 million KRW of holdings in the last month, on Digital X or another exchange, then an internal review | ongoing | S4 |

The documents disagree on the maker incentive during the promotion.
The promotion notice of 2026-08-23 says "수수료 무료 기간 동안 메이커 인센티브는 지급되지 않습니다."
No maker incentive is paid during the free period, S3.
The maker incentive notice of 2026-09-15, updated 2026-09-21, starts it for VIP members on 2026-09-17, S4, and the fee page repeats it, S2.
The later notice is the newer statement.
No token holding, referral or market maker discount was found.

## 6. Funding as a cost

Not applicable.
Digital X lists no perpetual, so it has no funding rate, interval or cap.

## 7. Liquidation, settlement and delisting

- No liquidation or settlement fee exists, since there is no leveraged product in the Open API, S7.
- A buy of any asset other than BTC, ETH, USDT and USDC holds 0.2 % of the order value in KRW as unfilled even when the applied rate is lower or zero, and refunds the difference when the order fills or is cancelled, S2.
- Buy fees are taken in the acquired coin for BTC, ETH, USDT and USDC and in KRW for every other coin, and sell fees in KRW, S2.
- A pair leaving trading shows `status` `stopped` in the catalog, and 34 pairs were stopped on 2026-09-23, P1.
- Market warnings (시장경보제) are public at `GET /v2/marketAlerts`, and one pair, `doge_krw`, carried a `concentration` warning at 03:26 and 03:35 UTC, P1.
- Deposit and withdrawal fees are listed on the fee page's `입출금 수수료` tab and per coin in `withdrawalTxFee` of `GET /v2/currencies`, S2 and P1.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 `exchanges` | 104 ids, none matching `korbit`, `digital` or `mirae`, run from `server/`, P1 |
| CCXT 4.5.68 source | no file under `server/node_modules/ccxt/js/src` mentions `korbit` or `digitalx` |
| CCXT master | `ts/src` at commit `1d8b674434` of 2026-09-22 12:48 UTC holds 112 entries and no `korbit.ts`, `digitalx.ts` or `miraeasset.ts`, and the raw URLs of those three names answered 404, S9 |
| `market.taker` | none, there is no class |

The Korean venues CCXT does carry are `bithumb`, `coinone` and `upbit`.

## 9. Recommended registry values

None.
Digital X has no perpetual, so it cannot join the engine as a leg in its current shape, and there is no CCXT class to build a catalog from.
If a later design adds KRW spot legs, the honest `takerPpm` is 0 until 2027-08-24 and 2,000 after it unless the end notice says otherwise, and `ccxtTakerPpm` stays unset because no CCXT constant exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinGecko exchange `korbit` and derivatives exchange list, public API | https://api.coingecko.com/api/v3/exchanges/korbit and https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=250 | 2026-09-23 UTC | CoinGecko | name, rebrand notice, trust rank 68 in the API that day, 820 BTC 24 h volume, KRW-only tickers, no derivatives entry, sections 1 and 3 |
| S2 | 수수료 안내, 거래 수수료 tab | https://digitalx.miraeasset.com/info/fee?tab=trade | 2026-09-22, headless render | Digital X, Korea | promotion line, free plan 0 % maker and 0.2 % taker, plan rules, fee currency, 0.2 % hold, VIP incentive, sections 2, 4, 5, 7 |
| S3 | 가상자산 거래 수수료 전면 무료 시행, registered 2026-08-23 16:30 | https://digitalx.miraeasset.com/notice/detail/?noticeId=4VPZQ0BT3UHTO92lTOhhFk | 2026-09-22, headless render | Digital X, Korea | one year free from 2026-08-24 09:00 KST, period 2026.08.24 to 2027.08.24, no maker incentive during the promotion, rename to 디지털엑스 주식회사, sections 1, 2, 5 |
| S4 | [업데이트] 메이커 거래하고 인센티브 받아가세요!, registered 2026-09-15 23:00, updated 2026-09-21 18:30 | https://digitalx.miraeasset.com/notice/detail/?noticeId=3FrmkTm0exfUvM46EaPXGp | 2026-09-22, headless render | Digital X, Korea | VIP maker incentive, VIP qualification, exclusion of foreigners and non-resident Koreans from that service, section 5 |
| S5 | 디지털엑스 이용약관 | https://digitalx.miraeasset.com/terms/terms-and-conditions | 2026-09-22, headless render | Digital X, Korea | Article 5 ③ 1, Article 14 ①, Korean law, effective 2026-09-16, section 1 |
| S6 | 자주 묻는 질문 | https://digitalx.miraeasset.com/faq | 2026-09-22, headless render | Digital X, Korea | Q5 foreigners, Q10 non-residents, section 1 |
| S7 | Digital X Open API v2, llms bundle: `introduction.md`, `rest_api.md`, `rest_api/other.md` | https://docs.digitalx.miraeasset.com/llms.txt | 2026-09-22 | Digital X | endpoint list, `tradingFeePolicy` schema and example, sections 3 and 4 |
| S8 | Next.js build manifest of the web app | https://digitalx.miraeasset.com/_next/static/MJxm3w6B2ebLWvSkA5n0x/_buildManifest.js | 2026-09-22 | Digital X | page list: markets, lending, staking, no futures, section 3 |
| S9 | CCXT master `ts/src` listing and raw file URLs | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no class, section 8 |
| P1 | `rest-probe.mjs all`, two runs at 03:25 and 03:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digital-x/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog counts, volume, CCXT list, `tradingFeePolicy` refusal, market alerts, sections 3, 4, 7, 8 |
