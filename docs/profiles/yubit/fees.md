# YUBIT Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 06:26 to 06:58 UTC), two runs of every probe mode, from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the fees of the YUBIT perpetual contracts, for every perpetual family the venue lists.
YUBIT publishes no public API documentation.
Its Open API documentation is handed "to each partner individually" by customer support, S9, so every number probed here comes from the calls the www.yubit.com web app makes for an anonymous visitor.
Those calls are undocumented, see [`rest.md`](./rest.md) section 2.
No CCXT class exists for YUBIT, see section 8.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 Pacific, 2026-09-23 UTC | this profile |
| legal entity | SafeTrading Ltd, "an international business company formed in the Republic of Seychelles, with registration number 240257" | S5, S6 |
| footer | "© 2026 SafeTrading Ltd All Rights Reserved" on www.yubit.com | S3 |
| offices | registered in Seychelles, primary offices in Hong Kong and Singapore, per the CoinMarketCap exchange description | S8 |
| who may trade | a natural person with full civil capacity, or a duly formed entity, who is not on the FATF, OFAC SDN or UN sanctions lists | S5, S6 |
| excluded regions | none named. The terms say "YUBIT may restrict or refuse Services in certain jurisdictions (including, without limitation, where derivatives access is prohibited)." CoinMarketCap's description says "YUBIT does not provide services to users from countries under international sanctions." | S5, S8 |
| US persons | not excluded by name in the terms or the user agreement. The web app's list of regions where the Google Play app is unavailable names Canada, China and the United States, which is app distribution and not a trading rule | S5, S6, P2 |
| automated access | the terms forbid use that "Uses automated data collection (scraping, crawling, mining) without prior written consent". The futures trading rules forbid "Probing, scanning, or accessing undisclosed APIs", VPNs used "to conceal identity, trading origin", and list "arbitrage and short-term operations using small currency spreads" as abnormal trading | S5, S7 |
| what this host got | the web app answered every public call with 200, and its region check answered `{"banned":false,"threatLevel":"none","accessDecision":"allow"}` with country `CA`. The Open API host `openapi.yubit.com` answered 403 `Forbidden` on every path tried except the web app's own `/mapi/` prefix. Details in [`rest.md`](./rest.md) section 1 | P2 |

The access results are from the Canadian VPN exit and not from a US address.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, 514 contracts | 0.04 %, 400 ppm | 0.08 %, 800 ppm | S1, S2, live tier table P1 |
| inverse USD perpetuals, `BTCUSD` and `ETHUSD` | 0.04 %, 400 ppm | 0.08 %, 800 ppm | S2 names one futures schedule, P1 |

Two other numbers disagree with the schedule, and both are what an anonymous visitor is served, not what an account pays.

- Every contract in the web app's catalog carries `defaultTakerFeeRateE8` and `defaultMakerFeeRateE8` of `"50000"`, which is 0.05 % or 500 ppm for both, on 514 of 514 USDT-M and 2 of 2 inverse contracts, P1.
- `GET /mapi/trade/public/v1/market/fee-rate` without a session answers `{"feeRateMaker":"0.0005","feeRateTaker":"0.0005"}`, P1.

The published schedule, the VIP announcement, the live tier table and CoinMarketCap all say 0.04 % maker and 0.08 % taker at VIP 0, S1, S2, S8.
This profile takes 800 ppm as the VIP 0 taker.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | source |
|---|---|---|---|
| USDT-M perpetuals (`LinearPerpetual`) | yes | 514, all `contractStatus` `Trading` | P1 |
| USDC-M perpetuals | no | 0 | P1, `SupportedCoins` names only BTC, ETH, FreeU and USDT |
| coin-M or inverse perpetuals (`InversePerpetual`) | yes | 2, `BTCUSD` and `ETHUSD`, margined in BTC and ETH | P1 |
| dated futures (`InverseFutures`) | no | 0, the key exists and is empty | P1 |
| demo perpetuals (`FreeUPerpetual`) | yes, not tradable for money | 2, `BTCFreeU` and `ETHFreeU`, fees 0 | P1 |
| options | no | none in the catalog or the help center index | P1, S10 |
| spot | yes | 278 USDT pairs in the web app's spot summary | P1 |
| TradFi CFDs and prediction markets | yes, separate products | not perpetuals, not counted | S10 |

The USDT-M list includes stock, ETF and commodity perpetuals such as `NVDAUSDT`, `QQQUSDT` and `XAUUSDT`, whose index source is `BitgetFuture`, see [`rest.md`](./rest.md) section 4.
CoinMarketCap's derivatives ranking showed YUBIT at rank 36 with 483 derivatives market pairs, about 601 million USD of open interest and about 2.32 billion USD of 24 h derivatives volume when read on 2026-09-23 UTC, S16.
Its exchange page showed about 571 million USD of open interest at its 06:19 UTC update, S8.
The survey brief's rank 32 was read earlier the same day.
CoinGecko lists YUBIT in neither its 1,495 exchange list nor its 214 derivatives exchange list, S15.

## 4. Perpetual tiers

The live tier table is `GET https://www.yubit.com/mapi/desk/vipfee/config`, which the public VIP page loads for a visitor who is not logged in, P1.
Its rows 1 to 8 carry `updatedAt` `2026-08-24T07:07:44`.

| VIP | 30 day futures volume, USDT | 30 day spot volume, USDT | account assets, USDT | futures maker | futures taker | taker ppm |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0.04 % | 0.08 % | 800 |
| 1 | 1,000,000 | 200,000 | 200 | 0.035 % | 0.07 % | 700 |
| 2 | 3,000,000 | 500,000 | 5,000 | 0.03 % | 0.06 % | 600 |
| 3 | 5,000,000 | 1,000,000 | 20,000 | 0.025 % | 0.05 % | 500 |
| 4 | 10,000,000 | 2,000,000 | 50,000 | 0.02 % | 0.04 % | 400 |
| 5 | 50,000,000 | 10,000,000 | 100,000 | 0.015 % | 0.035 % | 350 |
| 6 | 100,000,000 | 20,000,000 | 300,000 | 0.01 % | 0.03 % | 300 |
| 7 | 200,000,000 | 40,000,000 | 500,000 | 0.008 % | 0.025 % | 250 |
| 8 | 500,000,000 | 100,000,000 | 1,000,000 | 0 % | 0.02 % | 200 |

The VIP announcement of 2026-03-11 prints a rounded or older futures table: VIP 1 maker 0.04 %, VIP 3 maker 0.03 %, VIP 5 maker 0.02 % and taker 0.04 %, VIP 7 maker 0.01 % and taker 0.03 %, S2.
The two agree at VIP 0.

### Qualification

"VIP levels are calculated based on the highest value among the following metrics within the past 30 days: 30-day Futures Trading Volume, 30-day Spot Trading Volume, Total Account Assets", S2.
Upgrades run "Daily at 00:00 UTC" and downgrades are reviewed "every Monday at 00:00 UTC", S2.

## 5. Discounts that change the perpetual taker

| discount | finding | source |
|---|---|---|
| token holding | none found. The help center index has no platform token or fee token | S10 |
| referral | an affiliate program exists, and no referral discount on the trader's own taker rate is published | S10 |
| market maker | not published | S10 |
| zero fee promotion | none found for perpetuals on 2026-09-22. The FreeU demo contracts carry fee 0 and are not tradable for money | S10, P1 |
| bonus and trial funds | "Futures bonus and trial funds" exist, and they are margin credits, not fee discounts | S10 |
| Coin-M rebates | an announcement suspends "Coin-M Perpetual Rebates", with no detail on the rate | S10 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate = Clamp( MA( (Bid1 + Ask1)/2 – Spot Index Price ) / Spot Index Price – Interest, a, b )", with "Interest is currently set to 0" | S4 |
| cap and floor | `a` and `b` are not published, and the catalog has no cap field | S4, P1 |
| fee | "Funding Fee = Position Value × Current Funding Rate" | S4 |
| who pays | "When the funding rate is positive: longs pay shorts. When the funding rate is negative: shorts pay longs." Peer to peer, "YUBIT does not take any funding fees" | S4 |
| who is charged | "Only users holding positions at the settlement time are subject to funding fees." | S4 |
| interval | "Commonly every 8 hours (e.g., 08:00, 16:00, 24:00 HKT)" and "Some contracts settle every 4 hours" | S4 |
| settled instants | `BTCUSDT`, `ETHUSDT` and `NVDAUSDT` settled every 8 h at 00:00, 08:00 and 16:00 UTC over three days, and `ONDOUSDT` every 4 h | P3 |
| timing | "Settlement does not always occur at the exact hour mark. It is triggered automatically within a short window around the scheduled time." | S4 |
| settled rates seen | `BTCUSDT` -0.01 % on 9 of 9 settlements, `ETHUSDT` -0.01 % on 8 of 9 and +0.027385 % once, `ONDOUSDT` +0.01 % on 18 of 18, `NVDAUSDT` between 0 and +0.017408 % | P3 |

The settlement instant itself was not captured, so whether the settled rate equals the last published one is Not verified.
The published rate and its units are in [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- Liquidation triggers on the mark price, S12.
- On liquidation, "If the position is closed at a better price than the liquidation price, the remaining margin is injected into the insurance fund", and an insufficient insurance fund hands the position to auto-deleveraging, S11.
- No separate liquidation fee is published, and the worked examples say only that the "Actual liquidation price may slightly differ due to closing fees.", S11.
- "If a contract is delisted before the settlement time, no funding fee will be charged or received for that period.", S4.
- The `STORJUSDT` delisting was announced on 2026-08-21 for 2026-08-24 03:00 UTC, three days ahead, and positions left open "will be handled according to platform rules", S13.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 class | none. `require('ccxt').exchanges` has 104 ids, and the only ids matching `yu` or `ybit` are `bybit` and `bybiteu` | P1 |
| CCXT master | none. `ts/src` on master at commit `1c996ee07ed6f5c03c7097b2d46d8a8c0eeb5adb` (2026-09-23) lists `bybit.ts`, `bybiteu.ts` and `bybitid.ts` and no YUBIT file, and `ts/src/pro` has no YUBIT file either | S14 |
| `market.taker` | none, since no class exists | |

## 9. Recommended registry values

YUBIT should not be added to the registry today, see [`rest.md`](./rest.md) section 8.
If a documented API is ever granted and the venue is added, the values are these.

| field | value | reason |
|---|---|---|
| `takerPpm` | 800 | VIP 0 perpetual taker in S1, S2 and the live tier table |
| `ccxtTakerPpm` | unset | no CCXT class exists |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading Fee Rate | https://yubit.gitbook.io/yubit/derivatives-trading/trading-fee-rate | 2026-09-22 | SafeTrading Ltd, global | VIP 0 maker 0.04 %, taker 0.08 %, sections 2 and 9 |
| S2 | VIP Program Launch, Unlock Lower Trading Fees, 2026-03-11 | https://yubit.gitbook.io/yubit/other-help/announcements/feature-upgrade/vip-program-launch-unlock-lower-trading-fees | 2026-09-22 | SafeTrading Ltd, global | tier tables, qualification, sections 2 and 4 |
| S3 | VIP details page | https://www.yubit.com/en-US/vip-details | 2026-09-22 | SafeTrading Ltd, global | the page that loads the live tier table, section 4 |
| S4 | Funding Fee Mechanism Explained | https://yubit.gitbook.io/yubit/derivatives-trading/futures-faq/liquidation-and-funding/funding-fee-mechanism-explained | 2026-09-22 | SafeTrading Ltd, global | funding formula, interval, payer, sections 6 and 7 |
| S5 | YUBIT Terms of Service | https://yubit.gitbook.io/yubit/other-help/yubit-terms-of-service | 2026-09-22 | SafeTrading Ltd, Seychelles | entity, eligibility, automated collection clause, section 1 |
| S6 | YUBIT User Agreement | https://yubit.gitbook.io/yubit/other-help/yubit-user-agreement | 2026-09-22 | SafeTrading Ltd, Seychelles | entity and registration number, sanctions eligibility, section 1 |
| S7 | Futures Trading Rules | https://yubit.gitbook.io/yubit/derivatives-trading/futures-trading-rules | 2026-09-22 | SafeTrading Ltd, global | undisclosed API, VPN and arbitrage clauses, section 1 |
| S8 | CoinMarketCap exchange page, data updated 2026-09-23 06:19 UTC | https://coinmarketcap.com/exchanges/yubit/ | 2026-09-22 | CoinMarketCap | offices, sanctions line, 0.04 % and 0.08 %, open interest and volume, sections 1 to 3 |
| S9 | Open API Signature Upgrade Notice | https://yubit.gitbook.io/yubit/other-help/announcements/feature-upgrade/openaiskill | 2026-09-22 | SafeTrading Ltd, global | Open API docs sent to partners individually, intro |
| S10 | Help center index | https://yubit.gitbook.io/yubit/llms.txt | 2026-09-22 | SafeTrading Ltd, global | products, rebates, bonus funds, no options, sections 3 and 5 |
| S11 | Liquidation Mechanism and Liquidation Price Calculation (USDT-M Futures) | https://yubit.gitbook.io/yubit/derivatives-trading/futures-faq/liquidation-and-funding/liquidation-mechanism-and-liquidation-price-calculation-usdt-m-futures | 2026-09-22 | SafeTrading Ltd, global | insurance fund and ADL, section 7 |
| S12 | Latest Price vs. Mark Price | https://yubit.gitbook.io/yubit/derivatives-trading/futures-faq/prices-and-references/latest-price-vs.-mark-price | 2026-09-22 | SafeTrading Ltd, global | liquidation on mark, section 7 |
| S13 | Notice on the Delisting of STORJUSDT Perpetual Futures | https://yubit.gitbook.io/yubit/other-help/announcements/trading-pairs/notice-on-the-delisting-of-storjusdt-perpetual-futures | 2026-09-22 | SafeTrading Ltd, global | delisting notice period, section 7 |
| S14 | CCXT master `ts/src` and `ts/src/pro` listings | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no YUBIT class, section 8 |
| S15 | CoinGecko exchange and derivatives exchange lists | https://api.coingecko.com/api/v3/exchanges/list and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | YUBIT absent from both, section 3 |
| S16 | CoinMarketCap derivatives exchange ranking | https://coinmarketcap.com/rankings/exchanges/derivatives/ | 2026-09-22 | CoinMarketCap | rank, derivatives market pairs, open interest, section 3 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/yubit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog, fee fields, live tier table, CCXT list, sections 2 to 4 and 8 |
| P2 | `rest-probe.mjs access` | [`rest-probe.mjs`](../../../scripts/probes/venues/yubit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | status codes and region answers, section 1 |
| P3 | `rest-probe.mjs anchor` | [`rest-probe.mjs`](../../../scripts/probes/venues/yubit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | funding history, section 6 |
