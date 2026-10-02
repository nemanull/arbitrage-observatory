# Ourbit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 01:29 to 02:08 UTC), from the development host near Seattle.

This profile covers perpetual trading on Ourbit, which CCXT 4.5.68 does not list, and nothing else.
Spot, deposit, withdrawal, card and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs).
The Ourbit futures API is a copy of the MEXC contract API v1: the same paths, the same field names and the same WebSocket protocol, see [`rest.md`](./rest.md) section 2.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entity | "Ourbit Holdings Ltd. (Company No. 2138612), a company incorporated in 3rd Floor, Johnson's Ghut, Road Town, Tortola, British Virgin Islands" | Published | S1, clause 44, terms last updated 2026-05-30 |
| excluded jurisdictions | "the United States, China, Singapore, North Korea, Cuba, Iran, Sudan, France, Germany, the Netherlands, Spain, Italy, Austria, Portugal, the Province of Ontario (Canada), Russian-controlled regions of Ukraine (currently including the Crimea, Donetsk, and Luhansk regions), or any other jurisdictions in which we may determine from time to time to terminate the services" | Published | S1, section "Prohibited Countries" |
| sanctioned parties | no service to persons on the OFAC SDN list, the EU consolidated list or the UK sanctions list, or entities 50 % or more owned by them | Published | S1 |
| who may trade the perpetuals | an account holder outside the excluded jurisdictions. A person in the United States may not. | Region-specific | S1 |
| regional fee schedules | "Fees may vary by region", and Taiwanese VIP users have their own futures schedule | Published | S9, S5 |
| API trading of perpetuals | the old contract doc marks every order and cancel endpoint "(Under maintenance)" since 2022-07-25, and the current contract doc of 2026-07-08 lists only two history endpoints | Published | S11 update log, S12 |
| website and help center from this host | `www.ourbit.com`, the fee page, the VIP page, the terms and every help article read answered HTTP 200 | Probed | `curl` on 2026-09-22 |
| public API from this host | `futures.ourbit.com` REST and WebSocket answered every public call, through Cloudflare, whose trace placed this host at `loc=CA` | Probed | [`rest.md`](./rest.md) section 1 |

The development host sits in the United States, which is an excluded jurisdiction, so trading from it is not allowed under S1.
Cloudflare geolocates the host to Canada, and only Ontario is excluded there, but the host's real location is what S1 binds.
Reading public market data is not an account service, and no endpoint refused or challenged this host.
Even an eligible account could not trade perpetuals through the API today, because the order endpoints are closed, S11 and S12.
That matters for a later execution stage, not for the observatory.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals, crypto and TradFi | 0.02 % = 200 ppm | 0.04 % = 400 ppm | Published and Probed | S2 static string "Maker 0.02% / Taker 0.04%", S3, S4 VIP 0 row, and `takerFeeRate` 0.0004 with `makerFeeRate` 0.0002 on 735 of 735 contracts of `/api/v1/contract/detail`, `rest-probe.mjs catalog` tag `fees` |
| USDT-M perpetuals, Taiwanese users | 0.02 % = 200 ppm | 0.05 % = 500 ppm | Region-specific | S5, effective 2025-04-23 |

The engine models a taker cross at the base retail tier, so 400 ppm is the number that matters.
Two older pages disagree.
The Common Q&As of 2024-03-22 still say "the trading fees for regular users are 0.01% for Maker and 0.05% for Taker", S6.
The spot zero fee notice of 2024-09-03 says "The trading fee rates for Futures remain unchanged, with a 0.02% fee for Makers and a 0.04% fee for Takers", S3.
The catalog, the fee page string and the 2025 VIP table all give 0.04 %, so this profile takes 400 ppm and records 500 ppm as the stale Q&A and the Taiwanese schedule.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USDT-M perpetuals, crypto | yes | 529 | Probed, 735 contracts in `/detail` less the 206 whose `conceptPlate` names a TradFi zone, `rest-probe.mjs catalog` tag `tradfi` |
| USDT-M perpetuals, TradFi | yes | 206 by `conceptPlate`: 155 tagged stock or a stock sector, 33 ETF, 5 index, 11 commodity or metal, 8 forex, 8 pre-IPO or private company, with overlaps | Probed, same call and tag. 142 contracts carry the source `REAL-TIME US STOCK QUOTE2` in their index basket, and that set includes crypto tokens such as `PIPPIN_USDT` and `FOLKS_USDT` |
| USDC-M perpetuals | no | 0 | Probed, `/api/v1/contract/support_currencies` answered `["USDT"]`, and every contract settles in USDT |
| coin-M perpetuals | no | 0 | Probed, `quoteCoin` equals `settleCoin` on 735 of 735. The funding help page still carries a COIN-M formula, S7 |
| dated futures | no | 0 | Probed, `futureType` 1 on 735 of 735, and CoinGecko lists 0 futures pairs, S13 |
| options | no | 0 | none in the contract catalog, and no options API or product page was found |
| spot | yes, not detailed | 862 symbols | Probed, `https://api.ourbit.com/api/v3/exchangeInfo`, and CCXT `loadMarkets` through the mexc class counted 862 spot markets, `rest-probe.mjs catalog` tag `ccxtMexcLoadMarkets` |

CoinGecko's derivatives entry lists 770 perpetual pairs, S13, and the catalog listed 735 at the same hour.
The first `push.tickers` frame of one WebSocket run carried 808 rows and the next run's carried 735, see [`websocket.md`](./websocket.md) section 2, so the venue keeps some contracts that the catalog does not list.
Those extra rows were not identified.
Spot has had zero maker and taker fees since 2024-09-03, S3, and the fee page's public default read `{"taker":0,"maker":0}` at `https://www.ourbit.com/api/platform/member/trade_fee/default/get`.
Deposit, withdrawal and other schedules are looked up on the fee page at `https://www.ourbit.com/fee`, which renders its tables only in a browser session.

## 4. Perpetual tiers

### The last published general table, March 2025

The VIP page draws its tier table in the browser, and the static HTML carries only empty cells, S9.
The last general futures table found is an image in the airdrop notice of 2025-03-12, S4.

| tier | maker | taker | ppm taker |
|---|---:|---:|---:|
| VIP 0 | 0.02 % | 0.04 % | 400 |
| VIP 1 | 0.02 % | 0.04 % | 400 |
| VIP 2 | 0.01 % | 0.03 % | 300 |
| VIP 3 | 0.005 % | 0.02 % | 200 |
| VIP Supreme | 0 % | 0.01 % | 100 |

From 2025-03-13 16:00 UTC to 2025-04-14 15:59:59 UTC the VIP 3 and VIP Supreme makers were raised to 0.01 %, and S4 says both "will be restored to their original rates of 0.005% and 0%, respectively".
Whether this table still holds on 2026-09-22 is Not verified.
The VIP 0 row agrees with the catalog's `takerFeeRate` of 0.0004 on every contract.

### Taiwanese users, effective 2025-04-23

| tier | 30D futures volume | or total equity | maker | taker |
|---|---|---|---:|---:|
| VIP 0 | - | - | 0.02 % | 0.05 % |
| VIP 1 | ≥ 5M USDT | ≥ 30,000 | 0.016 % | 0.04 % |
| VIP 2 | ≥ 20M USDT | ≥ 50,000 | 0.014 % | 0.035 % |
| VIP 3 | ≥ 100M USDT | ≥ 200,000 | 0.01 % | 0.03 % |
| VIP Supreme | ≥ 200M USDT | ≥ 400,000 | 0.008 % | 0.025 % |

Source S5.

### Qualification

The VIP page qualifies a level on "Total Equity" or "30D Futures Vol", and it excludes "futures trading volume for USDC/USDT trading pairs and stablecoins", S9.
The general thresholds are drawn in the browser and were not read, so they are Not publicly specified in a static page.
The Taiwanese thresholds above are the only ones published as text.
A VIP of another exchange (Binance, OKX, Bybit, BingX, Bitunix, MEXC, KuCoin, Gate.io, Bitget or Bitmart) may apply for 30 days of Ourbit VIP 1 or above, S9.

## 5. Discounts that change the perpetual taker

| discount | terms | label | evidence |
|---|---|---|---|
| VIP | "Up to 50% Off Trading Fees" | Published | S9 |
| OUR deduction | "Enjoy {{discountRatio}} off trading fees when you transfer OUR into your futures account and offset USDT-margined futures trading fees with OUR." The ratio is filled in the browser | Published, ratio Not publicly specified | S2 page strings |
| OUR spot holding | "Holding OUR position quantity ≥ {{maxQuantity}} over the recent {{maxDay}} days allows you to instantly enjoy a {{spotRatio}} discount on futures trading fees." | Published, numbers Not publicly specified | S2 page strings |
| zero fee US stock futures | "a limited-time promotion of 0 trading fees and funding fees" on US stock futures, with no end date given | Published 2025-09-03, not reflected on the wire | S8. On 2026-09-22 all 206 TradFi contracts carried `takerFeeRate` 0.0004, and `/api/v1/contract/specialFee` returned `[]` |
| market maker, referral | Not publicly specified | | |

None of these applies to an account the observatory does not hold, so the registry keeps the VIP 0 taker.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula | Not publicly specified. The help page defines only the fee: "Funding Fee = Position Value x Funding Rate", with "Position Value = Position Size (Token) x Fair Price" | Published fee, formula Not publicly specified | S7 |
| who pays | "If the funding rate is positive, the long trader will pay the funding fee to the short trader", and "Ourbit does not charge any funding fees to the users" | Published | S7 |
| interval, documented | "every 8 hours at 00:00 (UTC), 08:00 (UTC) and 16:00 (UTC)", with a right to change the cycle "in the event of extreme market volatility" | Published | S7, dated 2024-03-18 |
| interval, on the wire | `collectCycle` in hours: 4 h on 452, 8 h on 280, 1 h on 2 (`LSK_USDT`, `G_USDT`), 24 h on 1 (`US30_USDT`) | Probed | `rest-probe.mjs anchor` tag `fundingSnapshot`, three runs |
| settlement instants | whole UTC hours: `nextSettleTime` read 02:00, 04:00, 08:00 and 16:00 UTC on 2026-09-23 for the 1 h, 4 h, 8 h and 24 h contracts at 01:50 UTC | Probed | same tag |
| cap and floor | per contract, symmetric on 735 of 735. `maxFundingRate` 0.02 on 616 contracts, 0.03 on 48, 0.025 on 17, 0.005 on 14, 0.015 on 8, 0.00375 on 6, 0.002 on 5 (`BTC_USDT` and `ETH_USDT` among them), 0.0075 on 4, and other values on the rest | Probed | `/api/v1/contract/funding_rate`, first read at 01:29 UTC, and tag `fundingSnapshot` capSymmetric 735 |
| rate at the cap | 0 of 735 contracts in three snapshots | Probed | tag `fundingSnapshot` atCap |
| window | "Any orders executed 15 seconds before or after the time of funding fee settlement may or may not be included in the most recent funding fee settlement" | Published | S7 |

The published rate is a live estimate for the coming settlement, and it moved inside the interval.
`LSK_USDT` read -0.000563 at 01:36 UTC, -0.000725 at 01:53 UTC and -0.000765 at 01:59 UTC for the settlement at 02:00 UTC, `rest-probe.mjs history`.
S7 says "The current rates shown on the page are non-fixed rates and shall be adjusted according to the market dynamics."
Whether the settled rate equals the last published estimate was not captured, because no probe waited for a settlement instant.
The funding history shows settled rates of exactly 0.0001 on 8 h `BTC_USDT` at two 08:00 UTC settlements and 0.00005 on 4 h `HYPE_USDT` at five of six settlements, which looks like a default rate of 0.01 % per 8 h scaled to the interval.
That reading is an inference from `rest-probe.mjs history`, and no page states it.
Funding is charged on the fair price, which follows the perpetual's own trades, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation condition | "If Position Margin + Floating PNL <= Maintenance Margin, liquidation will occur." | Published | S6 |
| liquidation fee | Not publicly specified in the pages read | Not publicly specified | S6, S7 |
| insurance fund | a public risk fund balance per contract, `/api/v1/contract/risk_reverse`, 75,568 bytes on 2026-09-23 01:29 UTC, `BTC_USDT` 1,986,499 USDT available | Probed | `curl` on 2026-09-22 |
| delisting | trading is suspended at a stated instant, and after the suspension "users will no longer be able to open or close positions". The settlement price of the remaining positions is not stated | Published | S10, `UNFI_USDT`, 2024-11-23 |
| US stock perpetuals out of market hours | "during market closures, you can cancel orders, adjust margin, or change leverage, but you can't place new orders" | Published | S8 |

The `AMD_USDT` book and index kept moving between 01:36 and 01:58 UTC, outside NYSE hours, see [`websocket.md`](./websocket.md) section 4.
Whether new orders were accepted then was not checked.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68, 104 exchange ids | Probed, `ccxt.version` and `ccxt.exchanges` from `server/`, `rest-probe.mjs catalog` tag `ccxt` |
| Ourbit class in 4.5.68 | none | `ccxt.exchanges` holds no id matching `ourbit`, and `server/node_modules/ccxt/js/src/` has no `ourbit.js` |
| Ourbit class on CCXT master | none | `ts/src` on `github.com/ccxt/ccxt` at commit `1d8b674` of 2026-09-22 12:48 UTC lists 105 files and no `ourbit.ts`, `ts/src/pro/ourbit.ts` answers 404, and a search of the repository's issues for "ourbit" returned 0 results, S14 |
| `market.taker` without credentials | none, because no class exists | |
| `market.taker` through `ccxt.mexc` pointed at Ourbit | `0.0004` on 735 of 735 active swaps | Probed, `rest-probe.mjs catalog` tag `ccxtMexcOnOurbit` |
| where that comes from | `'taker': this.safeNumber(market, 'takerFeeRate')` in `fetchSwapMarkets`, which reads the catalog's own field | `server/node_modules/ccxt/js/src/mexc.js` line 1465, with `makerFeeRate` on line 1466 |

The mexc class loads Ourbit's catalog unchanged once two public hosts are overridden, see [`rest.md`](./rest.md) section 2.
So `market.taker` then equals whatever Ourbit's catalog publishes per contract, and on 2026-09-22 that was the VIP 0 taker.
The connector compares CCXT's number with `ccxtTakerPpm` or, when that is unset, with the market's own `takerPpm`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 32 to 38.

## 9. Recommended registry values

```ts
ourbit: {
  takerPpm: 400,
  // No ourbit class in CCXT 4.5.68 or on master. The futures API copies the MEXC contract API, so the mexc class loads it with Ourbit's public hosts.
  // ccxt/js/src/mexc.js:1465 reads takerFeeRate from Ourbit's /api/v1/contract/detail, which was 0.0004 on 735 of 735 contracts on 2026-09-22.
  createExchange: () =>
    new ccxt.mexc({
      id: 'ourbit',
      name: 'Ourbit',
      urls: { api: { spot: { public: 'https://api.ourbit.com' }, contract: { public: 'https://futures.ourbit.com/api/v1/contract' } } },
    }),
}
```

`takerPpm: 400` is the published VIP 0 taker, S2, S3 and S4, and it pins the rate against a later per contract change in the catalog.
`ccxtTakerPpm` stays unset, because the catalog rate that CCXT reads is 400 ppm, and the connector then expects 400.
If Ourbit changes a contract's `takerFeeRate`, for example for a zero fee promotion, the connector's warning fires, which is the watch this venue needs.
The `id` and `name` overrides matter, because the connector keys the venue by the exchange id, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 91, and the mexc default would collide with a MEXC registration.
The private hosts stay on `api.mexc.com` in this construction, which is harmless while no private call is made, and a later execution stage would have to override them too.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Ourbit User Agreement, last updated 2026-05-30 | https://www.ourbit.com/terms | 2026-09-22 | Ourbit Holdings Ltd., BVI | entity, excluded jurisdictions, sanctions, section 1 |
| S2 | Ourbit Trading Fees page, static strings only | https://www.ourbit.com/fee | 2026-09-22 | Ourbit, global | "Maker 0.02% / Taker 0.04%", OUR deduction strings, sections 2 and 5 |
| S3 | Ourbit: Zero Trading Fees on All Spot Pairs!, 2024-09-03 | https://www.ourbit.com/support/articles/17827791510072 | 2026-09-22 | Ourbit, global | futures 0.02 % and 0.04 %, spot zero fees, sections 2 and 3 |
| S4 | Ourbit Futures Fee Rate Adjustments & $BITCH Airdrop Event, 2025-03-12, with its table image | https://www.ourbit.com/support/articles/17827791510911 | 2026-09-22 | Ourbit, global | VIP table, section 4 |
| S5 | Futures Trading Fee Adjustment for Taiwanese VIP Users, 2025-04-23 | https://www.ourbit.com/support/articles/17827791511088 | 2026-09-22 | Ourbit, Taiwan | Taiwanese tiers and thresholds, sections 2 and 4 |
| S6 | Common Q&As, 2024-03-22 | https://www.ourbit.com/support/articles/360044646991 | 2026-09-22 | Ourbit, global | 0.01 % and 0.05 % regular fees, liquidation condition, sections 2 and 7 |
| S7 | Funding Rate Mechanism, 2024-03-18 | https://www.ourbit.com/support/articles/13322295212313 | 2026-09-22 | Ourbit, global | funding payer, fee formula, 8 h schedule, 15 s window, section 6 |
| S8 | Ourbit US Stock Futures Trading Guide, 2025-09-03 | https://www.ourbit.com/support/articles/17827791511905 | 2026-09-22 | Ourbit, global | market hours, fair price of stock perpetuals, zero fee promotion, sections 5 and 7 |
| S9 | Ourbit VIP page, static text only | https://www.ourbit.com/vip | 2026-09-22 | Ourbit, global | "Up to 50% Off", qualification axes, regional note, VIP matching, sections 1, 4 and 5 |
| S10 | UNFIUSDT to be Delisted on Ourbit Futures, 2024-11-22 | https://www.ourbit.com/support/articles/17827791510428 | 2026-09-22 | Ourbit, global | delisting procedure, section 7 |
| S11 | Ourbit contract API v1 documentation, English, 2021 to 2024, kept in the `gh-pages` branch but no longer served at `https://ourbitdevelop.github.io/apidocs/contract_v1_en/` (HTTP 404) | https://raw.githubusercontent.com/ourbitdevelop/apidocs/gh-pages/contract_v1_en/index.html | 2026-09-22 | Ourbit, global | update log, order endpoints under maintenance, section 1 |
| S12 | Ourbit contract API documentation, 2026-07-08 | https://ourbitdevelop.github.io/apishortdocs/contract_en/ | 2026-09-22 | Ourbit, global | the current doc lists only order and deal history, section 1 |
| S13 | CoinGecko derivatives exchange `ourbit-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/ourbit-futures | 2026-09-22 | CoinGecko | 770 perpetual pairs, 0 futures pairs, BVI, established 2020, section 3 |
| S14 | CCXT master `ts/src` listing and issue search | https://api.github.com/repos/ccxt/ccxt/contents/ts/src | 2026-09-22 | CCXT | no Ourbit class, section 8 |
| S15 | CCXT 4.5.68 `mexc.js` | `server/node_modules/ccxt/js/src/mexc.js` | 2026-09-22 | CCXT | `takerFeeRate` mapping, section 8 |
| P1 | `rest-probe.mjs catalog`, eight runs from 01:35 to 02:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) | 2026-09-22 | this host | fees in the catalog, counts, CCXT through mexc, sections 2, 3 and 8 |
| P2 | `rest-probe.mjs anchor` and `history`, runs at 01:36, 01:50, 01:57 and 01:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) | 2026-09-22 | this host | funding intervals, caps, live rate, section 6 |
