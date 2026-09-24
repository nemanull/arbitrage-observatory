# INEX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:38 to 05:06 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

INEX is CoinGecko's trust rank 130 in the survey list and 134 in the CoinGecko API on 2026-09-23 04:50 UTC.
It lists no perpetual and has no CCXT class, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The fee numbers come from INEX's help center, which is a Zendesk site that answers its public article API, S2 to S5.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/inex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/inex/ws-probe.mjs).
Every access result below was seen from the Canadian VPN exit of this laptop, and Cloudflare's trace read `loc=CA`, `colo=YVR` during the probes.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC, for every source row | source ledger |
| operator | Infinity Exchange Korea Co., Ltd., (주)인피니티익스체인지코리아, CEO Lee Jae-gang, 116 Teheran-ro 12th floor (Dongkyung Building), Gangnam-gu, Seoul, business registration 783-81-02738 | footer of S1 |
| licence | Korean Virtual Asset Service Provider registration number 2024-03. CoinGecko says the registration completed on 2024-10-15 and the exchange launched in December 2024 | S1 footer, S9 |
| markets | a USDT market only, 11 pairs, no KRW market, no margin, no derivatives | S6 and [`rest.md`](./rest.md) section 2 |
| who may trade | Korean nationals who pass customer verification (KYC). Foreigners "may sign up, but customer verification is restricted, so the exchange cannot be used". Corporate members are accepted since 2025-11-07 | S7, S8 |
| excluded regions | an IP block list of 31 rows naming 30 countries, updated 2026-05-11: North Korea, Iran, Myanmar, China, Russia, Vietnam, Cambodia, Laos (twice), Thailand, Algeria, Angola, Bolivia, Bulgaria, Cameroon, DR Congo, Côte d'Ivoire, Haiti, Kenya, Kuwait, Lebanon, Monaco, Namibia, Nepal, Papua New Guinea, South Sudan, Syria, Venezuela, the British Virgin Islands, Yemen and Ukraine | S10 |
| earlier block | a notice of 2025-05-13 blocked every IP outside Korea "temporarily" from 18:00 that day, with the end to be announced later | S11 |
| US persons | the United States is not on the IP block list. A US national is a foreigner in Korea, so S7 and S8 keep a US person from trading. A Korean national living in the US is Not publicly specified | S7, S8, S10 |
| API eligibility | an API key is issued only to an account that finished KYC, and every Open API call needs a JWT signed with that key, S12 | [`rest.md`](./rest.md) section 1 |
| CoinGecko listing | "INEX", South Korea, established 2022, trust score 4, trust rank 134, 11 coins, 11 pairs, all against USDT, 24 h volume 0.205 to 0.206 BTC, 17,871 to 17,934 USD | S9, P1 |
| derivatives on CoinGecko | absent from the 214 derivatives exchanges CoinGecko lists | P1 |
| official pages from this host | `www.inexcoin.com` answered 200 through CloudFront POP `SEA900-P6`, `docs.inex.im` answered 200, and the help center answered 200 through Cloudflare | P2 |
| API from this host | every documented REST path and the documented WebSocket handshake answered HTTP 400 `empty_token`, which is an authentication refusal and not a geoblock | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

INEX lists no perpetual, so there is no perpetual VIP 0 fee.
The spot numbers are below, and one rate applies to every pair.

| market | maker | taker | evidence |
|---|---|---|---|
| USDT market, 11 pairs, orders accepted from 2026-09-23 00:00 KST | 0 %, 0 ppm | 0 %, 0 ppm | S2 and S3, one "0 %" cell spanning Maker and Taker, S4 "USDT 마켓 Maker 0%, Taker 0%" |
| USDT market, general orders before that instant | 0.1 %, 1,000 ppm | 0.1 %, 1,000 ppm | S5, one "0.1%" cell spanning Maker and Taker under "일반주문", general orders |

The zero rate started at 2026-09-23 00:00 KST, which is 2026-09-22 15:00 UTC, about 14 hours before these probes, S4.
It applies to every member, new members included, and to orders placed after that instant only.
An open order placed before it keeps the old rate.
The notice gives no end date and says a change will be announced in advance, S4.
The trading guide S5 was last updated on 2026-09-04 and still shows 0.1 %, with a note that a zero rate applies to orders from 2025-04-23 10:00, so the two sources disagree only because S5 predates S4.

Crossing an INEX book costs the half spread on top of the fee.
The quoted spread on the website socket ran from 1,582 ppm on ONDO to 9,229 ppm on QI over two runs, and CoinGecko showed 0.18 % to 0.92 % in both reads, see [`websocket.md`](./websocket.md) section 4.
No touch level held more than 34.40 USDT, and a whole side near the touch held 70 to 242 USDT in the rerun, so a zero fee does not make the book tradable at any size that matters.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | the website catalog lists one market, `USDT`, with 11 spot pairs, P3 |
| USDC-M perpetuals | absent | P3 |
| coin-M perpetuals | absent | P3 |
| dated futures | absent | P3, and no product page or help article names one |
| options | absent | P3 |
| spot | present: 11 USDT pairs, all `isOpen` 1 | P3, S9 |
| margin | absent: `is_open_lever` is 0 on all 11 pairs | P3 |
| KRW market | absent: the trading guide says INEX supports USDT market trading, and S4 speaks of "other markets" opening later | S4, S5 |

The Open API documentation uses `BTC-KRW` in every example, S12, but no KRW pair exists in the catalog, P3.

## 4. Spot tiers

No tier table is published.
One rate applies to every member, 0 % since 2026-09-23 and 0.1 % for general orders before that, S2 to S5.

A volume program called Pro-Trader gave qualifying members a 0 % rate plus a share of their maker fills paid in a coin, S13.
The 2024 events that granted it named the maker reward as 0.03 % of filled maker value in BTC, S14.
A notice titled "Pro-Trader 이벤트 종료 안내", Pro-Trader event end notice, was published on 2025-05-19, and its body was not read, S14.

## 5. Discounts that change the spot taker

| discount | effect | evidence |
|---|---|---|
| zero fee policy | taker and maker 0 % for every member on orders from 2026-09-23 00:00 KST, no end date | S4 |
| Pro-Trader | 0 % plus a maker reward, for members meeting a volume condition, whose current status is Not verified | S13, S14 |
| referral | referral reward articles exist, and their effect on the taker is Not verified | S14 titles |
| token holding | none, INEX has no exchange token in its catalog | P3 |

## 6. Funding as a cost

None.
INEX lists no perpetual, so no funding is charged.

## 7. Liquidation, settlement and delisting

None for spot.
No margin exists, so there is no liquidation charge.
Withdrawal fees are flat per coin and are listed in the fee guide S2, for example 5 USDT on Tron and 0.0008 BTC.

## 8. CCXT

No CCXT class exists.
CCXT 4.5.68 lists 104 exchange ids, and none matches `inex` or `infinity`, the only name hits being `bitfinex`, `coinex` and `digifinex`, P1.
The CCXT master `exchanges.json` read on 2026-09-23, for version 4.5.82, lists 105 ids and none is INEX, and `ts/src/inex.ts` and `ts/src/pro/inex.ts` answer 404 on `raw.githubusercontent.com`, S15.
The GitHub contents API for `ts/src` answered 403 with a rate limit message to this shared address, so the master list was read from `exchanges.json` instead.
So `market.taker` has no value to report, and `ccxtTakerPpm` has no source line.

## 9. Recommended registry values

None.
INEX should not be registered, because it lists no perpetual and its Open API refuses every call without a KYC-bound key, see [`rest.md`](./rest.md) section 8.
If a spot leg were ever modelled, `takerPpm` would be 0 from S4, with `ccxtTakerPpm` unset since no CCXT class exists, and the notice's lack of an end date means the rate should be re-read before use.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | INEX Open API page and site footer | https://www.inexcoin.com/en/open-api | 2026-09-23 | Infinity Exchange Korea, Korea | operator, address, registration numbers, docs host |
| S2 | [안내] 수수료 안내, fee guide, updated 2026-09-22 18:46 UTC | https://support.inexcoin.com/hc/ko/articles/25725101566745 | 2026-09-23 | Korea | maker and taker 0 %, withdrawal fees, sections 2 and 7 |
| S3 | 매매(체결) 수수료, trading fee, created 2026-09-18 | https://support.inexcoin.com/hc/ko/articles/62386883960473 | 2026-09-23 | Korea | maker and taker 0 %, section 2 |
| S4 | [공지] 인엑스(INEX) 거래 수수료 무료 정책 시행 안내, zero fee policy notice, created 2026-09-14 | https://support.inexcoin.com/hc/ko/articles/62230063811353 | 2026-09-23 | Korea | start instant, scope, no end date, section 2 |
| S5 | [안내] 거래이용 안내, trading guide, updated 2026-09-04 | https://support.inexcoin.com/hc/ko/articles/27520190445593 | 2026-09-23 | Korea | 0.1 % general orders, USDT market only, order limits, tick table |
| S6 | website catalog `market-coins` | https://www.inexcoin.com/client-api/service/market-coins | 2026-09-23 | Korea | 11 USDT pairs, no leverage |
| S7 | 외국인도 회원가입이 가능한가요?, can foreigners sign up | https://support.inexcoin.com/hc/ko/articles/35678525985689 | 2026-09-23 | Korea | foreigners cannot use the exchange |
| S8 | 외국인도 고객확인(KYC)이 가능한가요?, and the corporate sign-up FAQ | https://support.inexcoin.com/hc/ko/articles/35682233143961 and https://support.inexcoin.com/hc/ko/articles/35681125893913 | 2026-09-23 | Korea | foreign customers restricted, corporations since 2025-11-07 |
| S9 | CoinGecko exchange API, `inex` | https://api.coingecko.com/api/v3/exchanges/inex | 2026-09-23 04:50 UTC | CoinGecko | trust rank, volume, pairs, country, launch history |
| S10 | [안내] 해외 IP 접속 차단 안내, overseas IP block, updated 2026-09-15 | https://support.inexcoin.com/hc/ko/articles/57801539032217 | 2026-09-23 | Korea | the 31 row IP block list |
| S11 | [안내] 해외 IP 접속 임시 차단 안내, temporary overseas IP block, 2025-05-13 | https://support.inexcoin.com/hc/ko/articles/46862677486873 | 2026-09-23 | Korea | all non-Korean IPs blocked from 2025-05-13 18:00 |
| S12 | INEX Developer, quickstart and authentication | https://docs.inex.im/docs/quickstart and https://docs.inex.im/docs/auth | 2026-09-23 | Korea | KYC before an API key, JWT on every private call, `BTC-KRW` examples |
| S13 | Pro-Trader는 무엇인가요?, what is Pro-Trader | https://support.inexcoin.com/hc/ko/articles/35748538416537 | 2026-09-23 | Korea | 0 % plus a maker reward |
| S14 | help center search for 수수료 and Pro-Trader, titles and snippets | https://support.inexcoin.com/api/v2/help_center/articles/search.json | 2026-09-23 | Korea | 0.03 % BTC maker reward in 2024 events, event end notice of 2025-05-19, referral articles |
| S15 | CCXT master `exchanges.json` and raw source paths | https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json | 2026-09-23 | CCXT | no INEX class in 4.5.82 |
| P1 | `rest-probe.mjs context`, 04:50 UTC and the rerun at 05:01 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inex/rest-probe.mjs) | 2026-09-23 | this host | CCXT ids, CoinGecko listing and derivatives list |
| P2 | `rest-probe.mjs official`, 04:50 UTC and the rerun at 05:01 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inex/rest-probe.mjs) | 2026-09-23 | this host | page and API reachability |
| P3 | `rest-probe.mjs web`, 04:50 UTC and the rerun at 05:01 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inex/rest-probe.mjs) | 2026-09-23 | this host | the catalog |
