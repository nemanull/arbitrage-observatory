# Upbit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:06 to 03:30 UTC), from the development host near Seattle.

Upbit (CCXT id `upbit`) is the South Korean spot exchange of Dunamu Inc., and it lists no perpetual, dated future or option.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | 두나무 (주), Dunamu Inc., business registration 119-86-54968 | S1 page footer |
| licence | virtual asset service provider registration No. 2021-01 (가상자산사업자 등록번호 2021-01) | S1 page footer |
| products | spot only, in three markets: KRW, BTC and USDT | S1, P1 `catalog` |
| sign-up conditions | a mobile phone in the member's own name on a Korean carrier, and a Korean bank or securities account in the member's own name | S6 |
| identity check | Korean nationals: resident card or driver's licence, and a passport is not accepted. Foreigners: an alien registration card, a domestic residence report card for overseas Koreans, or a permanent residence card, plus a certificate of residence issued within 90 days | S7, S8 |
| KRW trading | needs a K Bank account in the member's own name and a second channel authentication | S6, S8 |
| excluded persons | nationals of, and persons connecting from, FATF high-risk countries, UN sanctioned countries, OFAC sanctioned countries and US state sponsors of terrorism cannot complete the identity check | S7 |
| US persons | no rule names US persons. A US person without Korean residence documents cannot pass the identity check, so cannot trade. A US national resident in Korea with an alien registration card is not excluded by any rule found | S6, S7, S8 |
| use from abroad | allowed for an existing member who keeps the Korean phone and K Bank account and has not turned on "block overseas login" | S9 |
| cross trading | the BTC and USDT markets are shared with Upbit Indonesia and Upbit Thailand, so a fill there may be against their members | S5 |
| regional siblings | Upbit Singapore, Indonesia and Thailand are separate venues on `sg-api`, `id-api` and `th-api.upbit.com`, with 12, 444 and 270 pairs at about 03:25 UTC on 2026-09-23. They are not profiled here | S12, P3 |

The fee schedule is the same for every member, individual or corporate, and includes VAT, S4.
The fee page is rendered in the browser, so it was captured once with a headless browser on 2026-09-23 03:11 UTC, see S1.

## 2. Quick answer

| market | maker | taker | ppm | status on 2026-09-22 |
|---|---|---|---|---|
| KRW, general order | 0.05 % | 0.05 % | 500 and 500 | base rate, S1 |
| KRW, reserved (stop) order | 0.139 % | 0.139 % | 1,390 and 1,390 | base rate, S1 |
| BTC | 0.25 % | 0.25 % | 2,500 and 2,500 | base rate, S1 |
| USDT | 0.25 % | 0.25 % | 2,500 and 2,500 | base rate, S1 |
| BTC and USDT, event | 0.05 % | 0.05 % | 500 and 500 | in force from 2026-08-29 00:00 to 2026-11-20 23:59:59 KST, S2 |
| BTC and USDT, API maker event | 0 % | not changed | 0 maker | same period, maker orders placed through the API, S3 |

The VIP 0 spot taker is 500 ppm on the KRW market, which is Upbit's main market.
The USDT market, the only one in the engine's USD, USDC and USDT quote family, is 2,500 ppm at its base rate and 500 ppm until 2026-11-20.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | CCXT `has.swap` false at `server/node_modules/ccxt/js/src/upbit.js` line 33, 0 swap markets in `loadMarkets`, P1 `catalog` |
| USDC-M perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | CCXT `has.future` false at line 34, no futures route in either developer index, S10 and S11 |
| options | absent | CCXT `has.option` false at line 35 |
| spot | present, 855 pairs: 289 KRW, 328 BTC, 238 USDT | P1 and P2 `catalog` |
| margin | absent | no margin or lending route in either developer index, S10 and S11 |

CoinGecko's derivatives exchange list held 214 exchanges at about 03:23 UTC on 2026-09-23, and none of them was Upbit, S13.
Neither developer index, S10 for Korea and S11 for the regional sites, contains the words futures, perpetual, funding, margin or lending, in English or Korean.

## 4. Spot tiers

There are no tiers.
The fee page shows one "기본 수수료" (base fee) table with columns for general and reserved orders and a Maker and a Taker column under each, with maker and taker sharing one cell, S1.

```text
기본 수수료        일반주문 Maker/Taker   예약주문 Maker/Taker
KRW 마켓           0.05%                  0.139%
BTC 마켓           0.25%                  0.25%
USDT 마켓          0.25%                  0.25%
```

The help center adds that the rate applies equally to every member, individual or corporate, that it includes VAT, and that an event can change it with the order's submission time deciding which rate applies, S4.
A reserved order is a stop order that is submitted when a watch price is reached, and during the BTC and USDT event it "may be charged the base rate even if submitted in the event period", S2.
TWAP orders exist on the KRW market only and pay 0.139 % per filled slice, according to the TWAP terms in the web client bundle, S17.

## 5. Discounts that change the spot taker

| discount | effect | period | source |
|---|---|---|---|
| BTC and USDT market fee cut | 0.25 % to 0.05 % for maker and taker on every pair of both markets | 2026-08-29 00:00:00 to 2026-11-20 23:59:59 KST, extended on 2026-09-11 from an original end of 2026-09-11 | S2 |
| Maker Plus+ | 0 % maker fee on API maker orders in the BTC and USDT markets, plus a reward of 0.04 % of API maker turnover for members who opt in | same period, paid every two weeks | S3 |
| token holding | none found | | S1, S4 |
| referral | none found | | S1, S4 |
| VIP or volume tiers | none, one rate for every member | | S4 |

The event notices wrap the new end date in `~~`, which in their markdown would be a strike through, as in `~ ~~2026-11-20(금) 23:59:59~~`.
The same notices wrap sentences that are plainly still in force in `~~`, and the compliance approval number reads "26.08.28~26.11.20", so this profile reads `~~` as emphasis and 2026-11-20 as the end, S2 and S3.
The rendered fee page also says both events "are running now", S1.
Earlier events on these markets were short: a three day 0 % USDT market event from 2026-08-15 and a USDT fee cut announced 2025-08-22, both marked ended in the notice list, S16.

## 6. Funding as a cost

Upbit has no perpetual, so there is no funding rate, interval, cap or settlement.
There is no margin product, so there is no borrowing interest either.
Deposit and withdrawal fees are on the second tab of the fee page, S1, and are not recorded here.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement charge.
The pair catalog marks a pair under investment warning with `market_event.warning` true and under caution with five `market_event.caution` flags, S14.
On 2026-09-23 03:26 UTC 18 of 855 pairs carried `warning`, and 234 carried at least one caution flag, 187 of them `GLOBAL_PRICE_DIFFERENCES`, P2 `catalog`.
A delisting shows up in the ticker as `market_state` `DELISTED` with a `delisting_date`, S15, and no delisting fee is published.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `upbit`, spot only, `countries` KR, ID, SG and TH | `server/node_modules/ccxt/js/src/upbit.js` lines 22 to 35 |
| default trading fee | maker and taker 0.0025 | same file, lines 177 to 183 |
| per quote override | `tradingFeesByQuoteCurrency` `KRW` 0.0005 | same file, lines 277 and 278 |
| how a market gets its fee | `parseMarket` reads the override for the quote and falls back to the default | same file, lines 546 and 547 |
| `market.taker` on a KRW pair | 0.0005, 500 ppm, on all 289 | P1 and P2 `catalog` |
| `market.taker` on a BTC or USDT pair | 0.0025, 2,500 ppm, on all 566 | P1 and P2 `catalog` |
| `market.maker` | the same as `taker` on every pair | P1 and P2 `catalog` |
| `active` | hard coded `true` on every market | same file, line 542 |
| `contractSize` and `linear` | `undefined` on every market | same file, lines 544 and 548 |
| currency rename | `TON` is mapped to `Tokamak Network`, and no `TON` pair was listed on 2026-09-23 | same file, line 282, P1 `catalog` |

CCXT matches the base schedule and does not model the reserved order rate or the BTC and USDT event.

## 9. Recommended registry values

Upbit cannot be registered today, because the connector keeps only active swap markets, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 201, and Upbit has none.
If a spot leg is ever added, these are the values.

| field | value | reason |
|---|---|---|
| `takerPpm` for a KRW pair | 500 | S1 general order rate, which CCXT already reports |
| `takerPpm` for a USDT pair | 2,500, or 500 while the event runs | S1 base rate, S2 event until 2026-11-20 23:59:59 KST |
| `ccxtTakerPpm` | 500 for KRW and 2,500 for BTC and USDT | CCXT lines 177 to 183, 277 and 278 |

The USDT market, the one a USD family spot leg could use, turned over about 1.07 million USDT in 24 h against about 1,745 million USDT equivalent on the KRW market, see [`rest.md`](./rest.md) section 2.
The KRW market holds the depth, and it would need a KRW to USD conversion that the quote family does not provide.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 수수료 안내, trading fee tab, rendered once with a headless browser | https://upbit.com/service_center/fees | 2026-09-23 03:11 UTC | Dunamu, Korea | fee table, events in force, operator and licence in the footer, sections 1, 2, 4, 5 and 6 |
| S2 | BTC 마켓 및 USDT 마켓 거래 수수료 인하 이벤트 안내 (이벤트 연장 안내), notice 6527, updated 2026-09-11 18:16 KST | https://www.upbit.com/service_center/notice?id=324365610&view=share | 2026-09-23 | Dunamu, Korea | 0.25 % to 0.05 % event and its dates, sections 2 and 5 |
| S3 | API Maker 거래 수수료 0%, 리워드 0.04%! 업비트 메이커 플러스+ 이벤트 (BTC, USDT 마켓) (이벤트 연장 안내), notice 6528 | https://www.upbit.com/service_center/notice?id=1793218405&view=share | 2026-09-23 | Dunamu, Korea | API maker 0 % and reward, section 5 |
| S4 | 거래 수수료는 얼마인가요?, help center, read through the help center API because the page answers 403 to this host | https://support.upbit.com/hc/ko/articles/900006143046 | 2026-09-23 | Dunamu, Korea | one rate for all members, VAT included, event timing rule, sections 1 and 4 |
| S5 | 원화 마켓, BTC 마켓, USDT 마켓이 어떻게 다른가요? | https://support.upbit.com/hc/ko/articles/900006664426 | 2026-09-23 | Dunamu, Korea | cross trading with Upbit Indonesia and Thailand, section 1 |
| S6 | 회원 가입은 어떻게 하나요? | https://support.upbit.com/hc/ko/articles/900006825383 | 2026-09-23 | Dunamu, Korea | sign-up conditions, section 1 |
| S7 | 외국인도 고객확인을 할 수 있나요? | https://support.upbit.com/hc/ko/articles/4407470509593 | 2026-09-23 | Dunamu, Korea | foreigners' documents, excluded countries, section 1 |
| S8 | 고객확인을 위해 필요한 것들이 있나요? | https://support.upbit.com/hc/ko/articles/4407470410777 | 2026-09-23 | Dunamu, Korea | identity documents, K Bank for KRW, section 1 |
| S9 | 해외에서도 이용 가능한가요? | https://support.upbit.com/hc/ko/articles/900005872106 | 2026-09-23 | Dunamu, Korea | use from abroad, section 1 |
| S10 | Upbit developer center index, Korea | https://docs.upbit.com/kr/llms.txt | 2026-09-23 | Dunamu, Korea | no derivative or margin route, section 3 |
| S11 | Upbit developer center index, regional sites | https://global-docs.upbit.com/llms.txt | 2026-09-23 | Upbit Singapore, Indonesia, Thailand | no derivative or margin route, section 3 |
| S12 | Upbit WebSocket orderbook, regional sites | https://global-docs.upbit.com/reference/websocket-orderbook | 2026-09-23 | Upbit Singapore, Indonesia, Thailand | regional hosts, section 1 |
| S13 | CoinGecko API, `exchanges/upbit` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23, about 03:23 UTC | CoinGecko | trust rank 37, 24 h volume 20,341 BTC, no derivatives listing, section 3 |
| S14 | 페어 목록 조회 | https://docs.upbit.com/kr/reference/list-trading-pairs | 2026-09-23, page updated 2026-07-29 | Dunamu, Korea | `market_event` fields, section 7 |
| S15 | 현재가 (Ticker) WebSocket | https://docs.upbit.com/kr/reference/websocket-ticker | 2026-09-23, page updated 2026-09-09 | Dunamu, Korea | `market_state` and `delisting_date`, section 7 |
| S16 | Upbit notice list, `event` category, pages 1 to 3 | https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=20&category=event | 2026-09-23 | Dunamu, Korea | earlier fee events, section 5 |
| S17 | Upbit web client bundle, TWAP terms under "수수료 및 이용 조건" | https://upbit-web-dist.upbit.com/upbit-web/sri-v2-KR_PC-bundle-BNf3c3bH.js | 2026-09-23 | Dunamu, Korea | TWAP rate, section 4 |
| C1 | CCXT 4.5.68 `upbit.js` | `server/node_modules/ccxt/js/src/upbit.js` | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs host`, `catalog`, `ticker`, `book`, `errors` at 03:14 to 03:15 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit/rest-probe.mjs) | 2026-09-23 UTC | this host | CCXT fees and catalog counts, sections 3 and 8 |
| P2 | `rest-probe.mjs all`, second pass at 03:25 to 03:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit/rest-probe.mjs) | 2026-09-23 UTC | this host | the same, second reading, and the `market_event` counts |
| P3 | one `curl` of `/v1/market/all` on each regional host at about 03:25 UTC | `https://{sg,id,th}-api.upbit.com/v1/market/all` | 2026-09-23 UTC | this host | regional pair counts, section 1 |
