# KuCoin Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers perpetual trading on KuCoin Futures (CCXT ids `kucoinfutures` and `kucoin`), and nothing else.
Spot, margin, deposit, withdrawal, card and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/kucoin/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/kucoin/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entity | The Terms of Use call the operator "the Platform" and "this Company" and name no company in the text read. Every activity is "deemed to take place within the Turks and Caicos Islands", the agreement is governed by Turks and Caicos law, and disputes go to the Singapore International Arbitration Centre (Articles 101 to 104). | Not publicly specified in the terms | S9 |
| operator named by US authorities | Peken Global Limited, "Seychelles-based", pleaded guilty on 2025-01-27 and a CFTC consent order of 2026-03-30 names it as the company "which operates KuCoin" | Published, press reports | S13, S14 |
| restricted locations | "the United States (including its territories such as Puerto Rico, Guam, the Northern Mariana Islands, American Samoa, etc), Singapore, the mainland of China and Hong Kong, Malaysia, Kazakhstan, Uzbekistan, Ontario, and British Columbia of Canada, France, Netherlands, the Crimea, Donetsk, Luhansk, Zaporizhzhia and Kherson regions of Ukraine", terms dated 2026-07-29 | Published | S9 |
| futures in restricted regions | "Users from restricted countries and regions cannot open futures trading." | Published | S6, S7 |
| access by IP | the terms allow restricting access "from internal protocol addresses ("IPs") associated with restricted jurisdictions/regions" and forbid proxies and VPNs used to misrepresent location | Published | S9 |
| United States persons | May not trade. The terms list the United States as restricted. Under the 2025 plea "KuCoin will exit the U.S. market for at least two years", and the 2026 CFTC order requires Peken Global "to permanently prohibit U.S. participants from accessing the exchange unless it registers as a foreign board of trade". | Region-specific | S9, S13, S14 |
| who may trade the perpetuals | An account holder who is not a resident of, or registered in, a restricted location | Region-specific | S9 |
| website from this host | `https://www.kucoin.com/` and every docs, support and announcement page fetched answered HTTP 200 through a Cloudflare edge, `cf-ray` suffix `SEA` or `YVR` | Probed | `curl` on 2026-09-22 |
| public API from this host | `api-futures.kucoin.com`, `api.kucoin.com`, `ws-api-futures.kucoin.com` and `x-push-futures.kucoin.com` answered every public call and socket, see [`rest.md`](./rest.md) section 1 | Probed | P1 |

The development host sits in the United States, which is a restricted location, so trading from it is not allowed under S9.
Reading public market data is not an account service, and neither the website nor the API hosts refused this host.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals, crypto and stocks | 0.02 % = 200 ppm | 0.06 % = 600 ppm | Published and Probed | S1 row VIP 0, "Futures Maker/Taker 0.02%/0.06%". Every contract row of `/api/v1/contracts/active` carries `makerFeeRate` 0.0002 and `takerFeeRate` 0.0006, 684 of 684 |
| USDC-M perpetuals | 0.02 % = 200 ppm | 0.06 % = 600 ppm | Published and Probed | S1 has one Futures column, and the 5 USDC rows carry the same two fields |
| coin-margined inverse perpetuals | 0.02 % = 200 ppm | 0.06 % = 600 ppm | Published and Probed | same, 4 inverse rows |

The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters for every KuCoin perpetual.
S1 publishes one futures column for all contracts, and no page read gives stocks, USDC-M or inverse contracts their own schedule.
The per contract fields in the catalog reply agree with S1 at VIP 0 on every row, see section 8.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USDT-M perpetuals, crypto | yes | 518, plus 6 metal and 3 commodity contracts listed as `assetClass` `METAL` and `COMMODITY` | Probed, `/api/v1/contracts/active` |
| USDT-M perpetuals, stocks | yes | 146: 128 US, 12 Hong Kong, 5 Korea, 1 Japan, `marketType` `NASDAQ` | Probed, same call |
| USDT-M pre-market perpetuals | yes, counted in the rows above | 3, `marketStage` `PRE_MARKET`: `ANTHROPICUSDTM` and `OPENAIUSDTM` with `assetClass` `STOCK`, and `BPUSDTM` with `CRYPTO` | Probed, same call |
| USDC-M perpetuals | yes | 5: `ETHUSDCM`, `SOLUSDCM`, `SUIUSDCM`, `XBTUSDCM`, `XRPUSDCM` | Probed, same call |
| coin-margined inverse perpetuals | yes | 4: `ETHUSDM`, `SOLUSDM`, `XBTUSDM`, `XRPUSDM` | Probed, same call |
| dated futures | yes, not detailed | 2 inverse: `XBTMU26` expiring 2026-09-25 and `XBTMZ26` expiring 2026-12-25, type `FFICSX` | Probed, same call |
| options | none in the futures catalog | 0 | Probed, same call, and CCXT sets `option` undefined at `server/node_modules/ccxt/js/src/kucoinfutures.js` line 31 |
| spot | yes, not detailed | 992 CCXT `spot` markets from the `kucoin` class | Probed, CCXT `loadMarkets` |

The active perpetual count is 682 on the wire and in CCXT, against 689 perpetual pairs on CoinGecko's derivatives list the same day (S17).
Spot, margin, deposit, withdrawal, card and earn fees are looked up on the VIP fee table in S1 and on the fee pages it links.

## 4. Perpetual tiers

S1 is the fee table of record, modified 2026-05-07.
S2 moved the VIP 9 to VIP 12 maker to 0 % from 2026-03-23, and S1 already shows that change.
S3 raised the VIP 4 taker from 0.053 % to 0.060 % from 2026-05-18, and S1 does not show it yet.
The table below is S1 with the S3 change applied.

| VIP | maker | taker | note |
|---|---|---|---|
| 0 | 0.02 % = 200 ppm | 0.06 % = 600 ppm | |
| 1 | 0.018 % = 180 ppm | 0.06 % = 600 ppm | |
| 2 | 0.015 % = 150 ppm | 0.06 % = 600 ppm | |
| 3 | 0.01 % = 100 ppm | 0.06 % = 600 ppm | |
| 4 | 0.008 % = 80 ppm | 0.060 % = 600 ppm | S1 reads 0.053 %, S3 raised it on 2026-05-18 |
| 5 | 0.006 % = 60 ppm | 0.048 % = 480 ppm | |
| 6 | 0.004 % = 40 ppm | 0.043 % = 430 ppm | |
| 7 | 0.002 % = 20 ppm | 0.039 % = 390 ppm | |
| 8 | 0 % | 0.036 % = 360 ppm | |
| 9 | 0 % | 0.033 % = 330 ppm | maker was -0.002 % before 2026-03-23, S2 |
| 10 | 0 % | 0.03 % = 300 ppm | maker was -0.004 %, S2 |
| 11 | 0 % | 0.028 % = 280 ppm | maker was -0.006 %, S2 |
| 12 | 0 % | 0.025 % = 250 ppm | maker was -0.008 %, S2 |

### Qualification

The per level volume and asset thresholds sit on the VIP page, S15, which renders them only in a browser session.
The fetch of S15 returned "View tier fees and how to upgrade" and no table, so the thresholds are Not verified.
S1 lists a 24 hour withdrawal limit per level and no qualification rule.

## 5. Discounts that change the perpetual taker

| discount | what it does | label | evidence |
|---|---|---|---|
| KCS holding | S1 lists "Spot Discount via KCS" at 20 % and "Spot Discount via KCS Loyalty" at 0.5 % to 2 %, both named for spot. No futures discount column exists | Published, spot only | S1 |
| market maker program | Tier S maker -0.007 % and taker 0.018 %, Tier A maker -0.005 % and taker 0.020 %, Tier B maker -0.003 % and taker 0.020 %, from 2026-03-23 | Negotiated | S2 |
| futures trading incentive program | VIP 8 rates (maker 0 %, taker 0.036 %) plus a 50 % taker rebate for accounts with no futures volume since 2026-03-01, campaign 2026-05-06 16:00 to 2026-05-12 16:00 UTC+8 | Account-gated, ended | S5 |
| referral | Not publicly specified in the pages read | Not publicly specified | |
| zero fee promotion on perpetuals | None found in the announcements read. The announcement list was not surveyed | Not publicly specified | |

## 6. Funding as a cost

S6, modified 2026-07-24, is the formula of record.
N is the settlement interval in hours.

```text
Funding rate = clamp [ ( Average premium index + clamp ( Interest rate − Average premium index, 0.05%, −0.05% ) ) / ( 8 / N ), Funding rate cap, Funding rate floor ]
Premium index = [ Max (0, Impact bid price – Index price) – Max (0, Index price – Impact ask price) ] / Index price
Impact value = depth unit × max leverage
Average premium index = (1 × Premium₁ + 2 × Premium₂ + … + n × Premiumₙ) / (1 + 2 + … + n), one sample a minute over the current interval
Funding Fee = Position Value × Funding Rate
U-margined: Position Value = Position Size × Mark Price
Coin-margined: Position Value = contract value in USD ÷ Mark Price
```

| item | documented | probed | evidence |
|---|---|---|---|
| who pays | positive rate: longs pay shorts, negative rate: shorts pay longs. "The fee is settled entirely among users, with no charges from the platform." | | S6, S7 |
| interest term | "Interest Rate: Fixed at 0.01% for all funding settlement intervals" in S6. The 2023 upgrade plan, S8, gave a daily 0.06 % for USDT-margined and 0.03 % for coin-margined contracts | `dailyInterestRate` 0.0003 on 679 perpetuals, which is 0.01 % per 8 h as S6 says, and 0.00015 on the 3 pre-market contracts. The per symbol `/api/v1/interest/query?symbol=.XBTINT8H` read 0.0003 | S6, S8, P1 |
| recalculation | the premium index is sampled once a minute | the published `fundingFeeRate` changed 0 or 1 times per 60 one second polls on six contracts, and up to 3 times in the rerun, see [`rest.md`](./rest.md) section 4 | S6, P1 |
| which rate is published | the 2023 plan says the moving average "within a cycle" is the predicted rate and "at the end of a cycle" the rate used for settlement | across the 22:00 and 23:00 UTC settlements of `GUSDTM` and `ONEUSDTM`, the rate charged was a fresh calculation at the instant and differed from the estimate shown in the last minute. For about a minute afterwards the reply showed the settled rate beside the next settlement time, see [`rest.md`](./rest.md) section 4 | S8, P2 |
| intervals | "major trading pairs" every 8 h, "most other trading pairs" every 4 h, and a temporary 1 h cycle "when the funding rate reaches the upper or lower limit" | `fundingRateGranularity` 8 h on 251, 4 h on 429, 1 h on 2 (`GUSDTM`, `ONEUSDTM`) | S6, P1 |
| settlement instants | 8 h at 00:00, 08:00 and 16:00 UTC, 4 h every four hours from 00:00 UTC, and "The exact times at which funding fee payments are collected may vary by up to 60 seconds." | 428 of the 429 four-hour contracts named 2026-09-23 00:00 UTC as next, and `TRUSTUSDTM` settled at 23:00 UTC and then named 03:00 UTC, from a cycle that started at 03:00 UTC | S7, P1, P2 |
| interval changes | a changed `fundingRateGranularity` moves the next settlement, and `effectiveFundingRateCycleStartTime` gives the exact start, S16 | 14 contracts read `currentFundingRateGranularity` null beside an 8 h `fundingRateGranularity` | S16, P1 |
| cap and floor | "Varies by contract" in S6. S8 gives cap = (IM − MM) × 0.75 and floor its negative | `fundingRateCap` equals minus `fundingRateFloor` on every perpetual. The S8 formula reproduced the cap on 45 of 682. Values in use: 0.02 on 608, 0.00525 on 20, 0.005 on 16, 0.01 on 10, 0.0375 on 7, and 21 contracts at ten other values from 0.003 (`XBTUSDTM`) to 0.0465 | S6, S8, P1 |
| rates against the cap | | no perpetual sat at its cap at 22:07 UTC, and the largest rate was 36 % of its cap | P1 |
| pre-market contracts | the premium index is set to 0, "resulting in a fixed funding rate", settled every 4 hours | the three pre-market contracts read 0.00005, which is their daily interest of 0.00015 over three, with an 8 h interval | S12, P1 |
| positions near the instant | "if you open a position at 00:00:20 UTC, you could still be subject to the funding fee" | | S6 |

The cap the engine can trust is `fundingRateCap`, since it is the published per contract limit.
The S8 formula does not reproduce it on most contracts, so the formula is stale or describes a different bound.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation fee | the liquidation price formula carries a "Liquidation Fee Rate", and both worked examples use 0.06 % | Published, example | S10 |
| insurance fund and auto-deleveraging | the insurance fund covers a deficit beyond the bankruptcy price, then ADL reduces opposite positions by profit and leverage | Published | S10 |
| settlement fee | "Settlement Fee 0.025%", which applies when a contract is settled (2020 page) | Published, dated contracts only | S4 |
| perpetual settlement fee | none, perpetuals do not expire | | |
| delisting | the mark becomes the average index price over the last 30 minutes, blended in over 180 s, and "the contract settlement price upon delisting is based on the average index price" | Published | S11 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, `ccxt.version` |
| classes | `kucoinfutures` extends `kucoin` and only narrows `fetchMarkets` to `['swap', 'future', 'contract']` | `server/node_modules/ccxt/js/src/kucoinfutures.js` lines 15 and 36 |
| `market.taker` on every active swap without credentials | `0.0006` on 682 of 682, from both classes | Probed, `rest-probe.mjs main`, tag `ccxt_catalog` |
| where it comes from | the contract row's own `takerFeeRate` in `fetchContractMarkets` | `server/node_modules/ccxt/js/src/kucoin.js` line 1969 |
| `market.maker` | `0.0002` from the row's `makerFeeRate` on the next line | `server/node_modules/ccxt/js/src/kucoin.js` line 1970 |
| the exchange-level contract fee block | `'taker': 0.0006` and `'maker': 0.0002`, with a maker tier list whose values 0.02, 0.015 and 0.01 read as percent and not as fractions | `server/node_modules/ccxt/js/src/kucoin.js` lines 843 to 880 |
| the unified account path | with `options.uta` true, `fetchUTAMarkets` sets `taker` from `makerFeeRate` and `maker` from `takerFeeRate`, which swaps them, and reads `contractSize` from `unitSize`. The default is false | `server/node_modules/ccxt/js/src/kucoin.js` lines 1617 to 1621 and 2149 to 2151 |

The CCXT number is 600 ppm on every perpetual and matches the published VIP 0 taker.
The connector compares CCXT's number to `ccxtTakerPpm` or, when that is unset, to the market's own `takerPpm`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 33 to 39 and 120.

## 9. Recommended registry values

```ts
kucoinfutures: {
  // ccxt/js/src/kucoin.js:1969 reads each contract's takerFeeRate, 0.0006 on all 682 perpetuals on 2026-09-22, so the connector warns the day KuCoin changes one.
  takerPpm: 600,
  // The 5 USDC-M and 4 inverse contracts all share a pair with a USDT-M contract, which the quote family ranks first.
  // The inverse contracts count 1 USD per contract, and the feed and poller then need only the USDT-M rows.
  marketFilter: (market) => market.linear === true && market.settle === 'USDT',
  createExchange: () => new ccxt.kucoinfutures(),
}
```

`takerPpm: 600` is the published VIP 0 taker in S1 and the per contract field on every row.
`ccxtTakerPpm` stays unset, because CCXT reads the per contract rate and already reports 600.
The id is `kucoinfutures` rather than `kucoin`, because the `kucoin` class also loads 992 spot markets and the spot tickers on every `loadMarkets`, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | KuCoin VIP Fee Structure, modified 2026-05-07 | https://www.kucoin.com/support/48142946141635 | 2026-09-22 | KuCoin, global | VIP fee table, KCS discount columns, sections 2, 4 and 5 |
| S2 | KuCoin Futures VIP and Market Maker Fee Adjustment Notice, published 2026-03-19 | https://www.kucoin.com/announcement/en-kucoin-futures-VIP-Market-Maker-Fee-Adjustment-Notice | 2026-09-22 | KuCoin, global | VIP 9 to 12 maker, market maker tiers, sections 4 and 5 |
| S3 | KuCoin Futures VIP4 Fee Adjustment Announcement, published 2026-05-12 | https://www.kucoin.com/announcement/en-kucoin-futures-vip4-fee-adjustment-announcement | 2026-09-22 | KuCoin, global | VIP 4 taker 0.060 % from 2026-05-18, section 4 |
| S4 | KuCoin Futures Fee Structure, published 2020-04-01 | https://www.kucoin.com/announcement/en-futures-fee | 2026-09-22 | KuCoin, global | settlement fee, section 7 |
| S5 | KuCoin VIP & Institutional Futures Trading Incentive Program, published 2026-05-05 | https://www.kucoin.com/announcement/en-kucoin-vip-institutional-fast-track-to-vip8-0-maker-fee-50-taker-rebate | 2026-09-22 | KuCoin, global | ended incentive, section 5 |
| S6 | Funding Fee - Futures Trading, modified 2026-07-24 | https://www.kucoin.com/support/26686295987353 | 2026-09-22 | KuCoin, global | funding formula, interest, intervals, section 6 |
| S7 | Funding Rate Tutorial, modified 2026-06-05 | https://www.kucoin.com/support/26695933047705 | 2026-09-22 | KuCoin, global | settlement instants, restricted regions note, sections 1 and 6 |
| S8 | KuCoin Futures Funding Rate Upgrades Plan, published 2023-10-18 | https://www.kucoin.com/announcement/en-kucoin-futures-funding-rate-upgrades-plan | 2026-09-22 | KuCoin, global | predicted and settled rate wording, cap formula, section 6 |
| S9 | Terms of Use, dated 2026-07-29 | https://www.kucoin.com/legal/terms-of-use | 2026-09-22 | KuCoin, global | restricted locations, governing law, IP restriction, section 1 |
| S10 | Liquidation and Liquidation Price, modified 2026-01-05 | https://www.kucoin.com/support/26694703491737 | 2026-09-22 | KuCoin, global | liquidation fee in the formula, section 7 |
| S11 | Mark Price for USDT-Margined Futures, modified 2025-12-30 | https://www.kucoin.com/support/26684973273625 | 2026-09-22 | KuCoin, global | delisting mark, section 7 |
| S12 | Pre-Market Perpetual Contracts, published 2025-09-22 | https://www.kucoin.com/support/48142946141285 | 2026-09-22 | KuCoin, global | pre-market funding, section 6 |
| S13 | KuCoin operator ordered to block US traders, pay $500,000 CFTC penalty, The Block, 2026-03-31 | https://www.theblock.co/post/395839/kucoin-ordered-block-us-traders | 2026-09-22 | press | CFTC consent order, section 1 |
| S14 | Crypto Exchange KuCoin to Exit US Amid Resolution of Lawsuit, PYMNTS | https://www.pymnts.com/legal/2025/crypto-exchange-kucoin-to-exit-us-amid-resolution-of-lawsuit/ | 2026-09-22 | press | Peken Global plea and US exit, section 1 |
| S15 | VIP Benefits, VIP Program | https://www.kucoin.com/vip/privilege | 2026-09-22 | KuCoin, global | the page returned no fee table, section 4 |
| S16 | Get All Symbols, KuCoin API docs, OpenAPI export | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-all-symbols.md | 2026-09-22 | KuCoin, global | field meanings for granularity and cycle start, section 6 |
| S17 | CoinGecko derivatives exchanges API, entry `kumex` | https://api.coingecko.com/api/v3/derivatives/exchanges | 2026-09-22 | CoinGecko | 689 perpetual pairs, section 3 |
| P1 | `rest-probe.mjs main` and `baskets`, 21:42 to 21:49 UTC, and the rerun at 22:06 to 22:12 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kucoin/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 3, 6 and 8 |
| P2 | `rest-probe.mjs settlement`, 21:58 to 22:02 UTC, and the rerun at 22:58 to 23:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kucoin/rest-probe.mjs) | 2026-09-22 | this host | section 6 |
