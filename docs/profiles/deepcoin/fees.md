# Deepcoin Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers perpetual trading on Deepcoin (CCXT id `deepcoin`), and nothing else.
Spot, deposit, withdrawal, card and earn schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/deepcoin/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entity | "Deepcoin (website: https://www.deepcoin.com) is a Cryptocurrency trading platform that is soley owned by DEEPCOIN LIMITED." The jurisdiction of that company is not stated in the terms. | Published | H14, edited 2023-11-06 |
| country labels | CCXT describes the venue as `countries: ['SG']`. CoinGecko lists the derivatives exchange as Singapore and the spot exchange as Seychelles. | Third party | `server/node_modules/ccxt/js/src/deepcoin.js` line 23, C1, C2 |
| restricted locations | "if you are located in or a resident of Hong Kong(China), Cuba, Iran, North Korea, Crimea, Sudan, Malaysia, Syria, United States, Puerto Rico, American Samoa, Guam, Northern Mariana Islands or any other jurisdiction where the Services offered by Deepcoin are restricted, you understand and acknowledge that you are prohibited from holding positions or entering into contracts" | Published | H14 |
| United States | "DEEPCOIN does not offer products or services to users in the United States or other restricted jurisdictions.", 2026-09-16 | Published | H13 |
| who may trade the perpetuals | An account holder outside the restricted locations. A person in the United States may not. | Region-specific | H13, H14 |
| website from this host | `https://www.deepcoin.com/`, `/en/` and `/docs` answered HTTP 403 with the CloudFront body "Request blocked. We can't connect to the server for this app or website at this time." from POP `SEA900-P10`. `support.deepcoin.com` does not resolve. | Probed | `curl` on 2026-09-22 at 03:15 UTC |
| public API from this host | `api.deepcoin.com` and `stream.deepcoin.com` answered every public call through CloudFront POP `SEA73`. | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The documentation and the fee pages were read through a fetch that does not originate from this host, because this host is refused.
The help center articles were read through the public Zendesk API at `deepcoin.zendesk.com`, which does answer this host.
The development host sits in the United States, which is a restricted location, so trading from it is not allowed under H13 and H14.
Reading public market data is not an account service, and the API hosts served it without any challenge.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined perpetuals | 0.04 % = 400 ppm | 0.06 % = 600 ppm | Published | H1, "2023 Fee Rate: taker 0.06%, maker 0.04%", article edited 2025-04-20 |
| coin-margined inverse perpetuals | 0.04 % = 400 ppm | 0.06 % = 600 ppm | Published | H2, "Fee Rate：taker 0.06%, maker 0.04%", article edited 2026-06-10 |
| PRO programme, lowest level (by application) | 0.019 % = 190 ppm | 0.042 % = 420 ppm | Published, not the retail tier | H6 |

The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters.
The retail rate table itself sits on a fee page of the web site that neither this host nor the fetch could read, see section 4.
So the 600 ppm rests on the two help center fee calculation articles, and a per-pair rate can differ, see section 5.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USDT-margined perpetuals | yes | 348, all `live` | Probed, `GET /deepcoin/market/instruments?instType=SWAP`, [`rest.md`](./rest.md) section 2 |
| of which stock, ETF and metal perpetuals | yes | the venue announced "96 stock and ETF underlying assets" on 2026-09-16, not counted by the probe | H13 |
| coin-margined inverse perpetuals | yes | 5: `LTC-USD-SWAP`, `ETH-USD-SWAP`, `XRP-USD-SWAP`, `BCH-USD-SWAP`, `LINK-USD-SWAP` | Probed, same call |
| USDC-margined perpetuals | no | 0 in the catalog, though 250 dead rows of the funding call include names such as `BTCUSDC` | Probed, [`rest.md`](./rest.md) section 3 |
| instruments outside the catalog | yes, not tradable through the catalog | 7 in the ticker and mark replies: `1BTC-USD-SWAP`, `1ETH-USD-SWAP`, `1XRP-USD-SWAP`, `2BTC-USDT-SWAP`, `2ETH-USDT-SWAP`, `dBTC-USDT-SWAP`, `dETH-USDT-SWAP` | Probed, [`rest.md`](./rest.md) section 2 |
| dated futures | no | 0, CCXT `future: false` | `deepcoin.js` line 33, C1 lists 0 futures pairs |
| options | no | 0, CCXT `option: false` | `deepcoin.js` line 34 |
| spot | yes, not detailed | 173, all `live` | Probed, `instType=SPOT` |

CoinGecko listed 349 perpetual pairs on 2026-09-22 (C1), one more than the 348 USDT contracts and four fewer than the 353 swaps in the catalog.
Spot fees are 0.1 % maker and taker on every pair since 2025-11-26 (H15).
Deposit, withdrawal and earn fees are looked up in the help center at `https://deepcoin.zendesk.com/hc/en-001`.

## 4. Perpetual tiers

### Retail VIP levels

The membership article names eleven levels by 30-day volume, in an image attached to H3.
The image gives the volume thresholds and no fee rates.

| level | 30-day volume, USDT | maker | taker |
|---|---|---|---|
| VIP 0 | < 10k | 0.04 % from H1 and H2 | 0.06 % from H1 and H2 |
| VIP 1 | ≥ 10k | Not publicly specified | Not publicly specified |
| VIP 2 | ≥ 5 million | Not publicly specified | Not publicly specified |
| VIP 3 | ≥ 25 million | Not publicly specified | Not publicly specified |
| VIP 4 | ≥ 50 million | Not publicly specified | Not publicly specified |
| VIP 5 | ≥ 100 million | Not publicly specified | Not publicly specified |
| VIP 6 | ≥ 200 million | Not publicly specified | Not publicly specified |
| VIP 7 | ≥ 500 million | Not publicly specified | Not publicly specified |
| VIP 8 | ≥ 1 billion | Not publicly specified | Not publicly specified |
| VIP 9 | ≥ 2 billion | Not publicly specified | Not publicly specified |
| VIP 10 | ≥ 5 billion | Not publicly specified | Not publicly specified |

The text of H3 contradicts the image: it says "VIP1 requires a trading volume of 1,000,000 USDT", where the image says 10k.
H3 counts "USDT Perpetual Pro Contract, Inverse Perpetual Contract, Spot and Options" volume and recalculates the level "in real time".
H4, from 2025-09-23, describes a second VIP scheme from VIP 4 to VIP 8 with the same volume thresholds, assessed monthly, whose rewards are gifts and not fee rates.
The rendered fee page linked as "Fee Structure" in the site footer could not be located: `/en/fee`, `/en/fees`, `/en/fee-rate`, `/en/fee-structure`, `/en/rate` and `/en/vip` answered 404 to the fetch, and `/ps/en/fee` rendered without a table.

### PRO levels

PRO is a separate programme entered by application with a balance of at least 100,000 USDT or proof of a VIP level elsewhere (H5).

| level | 30-day contract volume, USDT, H6 on 2026-09-22 | maker | taker | H5 on 2025-09-12 |
|---|---|---|---|---|
| Pro0 | < 1,000,000 | 0.019 % | 0.042 % | < 10 million, 0.018 % and 0.032 % |
| Pro1 | ≥ 1,000,000 | 0.017 % | 0.038 % | ≥ 10 million, 0.010 % and 0.028 % |
| Pro2 | ≥ 5,000,000 | 0.016 % | 0.036 % | ≥ 50 million, 0.008 % and 0.026 % |
| Pro3 | ≥ 10,000,000 | 0.013 % | 0.034 % | ≥ 100 million, 0.006 % and 0.024 % |
| Pro4 | ≥ 100,000,000 | 0.011 % | 0.027 % | ≥ 1 billion, 0.005 % and 0.018 % |
| Pro5 | ≥ 200,000,000 | 0.009 % | 0.025 % | ≥ 2 billion, 0.004 % and 0.015 % |
| Pro6 | ≥ 300,000,000 | 0.006 % | 0.020 % | ≥ 5 billion, 0.000 % and 0.010 % |

The live PRO page and the launch announcement disagree on every row, and the page is the newer.
Neither applies to an account that has not applied.

### Qualification

VIP levels follow 30-day volume across products (H3).
PRO levels follow 30-day contract volume after an approved application (H5).

## 5. Discounts that change the perpetual taker

| item | effect on the taker | evidence |
|---|---|---|
| per-pair rates | On 2023-12-27, 19 USDT pairs moved to 0.08 % maker and 0.12 % taker: NEAR, RIF, ATOM, CAKE, ID, USTC, AAVE, AR, PENDLE, STRAX, TOKEN, ALGO, MEME, IMX, STX, RNDR, AVAX, TRB and JTO. Whether those rates still hold is Not publicly specified. | H7 |
| per-pair maker | `SOLUSDT` maker went from -0.02 % to 0.04 % on 2024-12-20, taker unchanged at 0.06 %. | H8 |
| stock perpetual launch | "limited-time fee discounts" on 2026-09-16, with no rate or end date given | H13 |
| token holding | Not publicly specified | none found |
| referral | CCXT records a referral link with `discount: 0.1` | `deepcoin.js` lines 149 to 152 |
| zero fee promotions | four notices titled as limited-time zero-fee contract promotions, all last updated 2024-12-16, not read | help center search on 2026-09-22 |

The per-pair notices mean a registry value of 600 ppm can understate the taker on some pairs.
An account endpoint `GET /deepcoin/account/trade-fee` added on 2026-05-28 returns the account's own rates (S11), and it needs credentials, so it was not called.

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| formula | "Funding rate (F) = premium index (P) + clamp (interest rate (I)-premium index (P), 0.05%, -0.05%)" | H9 |
| interest rate | "By default, the interest rate is set to 0.00% per day", while the same article says the rate settles at "0.01% (interest rate)" inside the band | H9, the two sentences disagree |
| premium index | computed "every minute" from depth weighted prices of 80 BTC contracts or 800 contracts on other pairs, time weighted over the interval | H9 |
| cap | "The absolute upper limit of the funding rate is (initial margin-maintenance margin) * 75%", and the rate "shall not change more than 75% of the maintenance margin during the fund interval" | H9 |
| interval | 8 h on 201 contracts, 4 h on 146, 1 h on 1 (`CVCUSDT`), and 4 h on all 5 inverse contracts | Probed, `GET /deepcoin/trade/funding-rate`, [`rest.md`](./rest.md) section 3 |
| settlement instants | 8 h contracts settle at 00:00, 08:00 and 16:00 UTC, which H9 writes as "08:00, 16:00 and 24:00 (HKT)". 4 h contracts had `nextSettleTime` 04:00 UTC at 03:42 UTC | H9, probed history rows |
| who pays | "When the funding rate is positive, longs pay shorts. When the funding rate is negative, shorts pay longs." Only positions held at the instant pay. | H9 |
| amount | "Funding cost = position value * funding rate", with position value at the mark price | H9 |
| per interval or per 8 h | per interval: 99 of the 8 h contracts read exactly 0.0001 and 57 of the 4 h contracts read exactly 0.00005 on the second pass | Probed, [`rest.md`](./rest.md) section 4 |
| stock and RWA perpetuals | funding is paused while the underlying market is closed and resumes on the pair's schedule | H12 |

The settlement instant itself was not captured.
The behaviour across it is taken from the history rows, whose `CreateTime` falls exactly on the settlement hour, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- The liquidation price formula includes the trading fee rate and the maintenance margin rate (H11).
  A separate liquidation fee is Not publicly specified in the article read.
- Stock and RWA index perpetuals trade on a US market schedule, with the "market price" frozen during closures and new orders refused (H12).
- Delisting charges are Not publicly specified.
  Two notices from 2025 handled price incidents by delisting or adjusting single pairs, `AIAUSDT` and `LAUNCHCOINUSDT`, and they came up in the help center search but were not read.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` on every swap without credentials | 0.0015 = 1,500 ppm | `deepcoin.js` line 221, `'taker': this.parseNumber('0.0015')`, confirmed on 353 of 353 swaps by `rest-probe.mjs catalog` |
| `market.maker` | 0.0010 = 1,000 ppm | `deepcoin.js` line 222 |
| how it reaches the market | `parseMarket` spreads `this.safeDict2(this.fees, type, 'trading', {})`, and no `swap` key exists, so every market takes the one `trading` pair | `deepcoin.js` line 510 |

The CCXT constants match neither the perpetual rate of H1 and H2 nor the 0.1 % spot rate of H15.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 taker for USDT and inverse perpetuals in H1 and H2. The per-pair notice of H7 may put some pairs at 1,200 ppm, which a later check against the account endpoint could settle. |
| `ccxtTakerPpm` | 1,500 | CCXT 4.5.68 hardcodes 0.0015 at `deepcoin.js` line 221 on every market, so the connector should expect that and not warn |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| H1 | USDT Perpetual Contracts Trading Fee Calculation, edited 2025-04-20 | https://deepcoin.zendesk.com/hc/en-001/articles/360055930112-USDT-Perpetual-Contracts-Trading-Fee-Calculation | 2026-09-22 | Deepcoin, global | VIP 0 USDT perpetual rate, sections 2 and 4 |
| H2 | Inverse Perpetual Contract Trading Fee Calculation, edited 2026-06-10 | https://deepcoin.zendesk.com/hc/en-001/articles/360051033611-Inverse-Perpetual-Contract-Trading-Fee-Calculation | 2026-09-22 | Deepcoin, global | VIP 0 inverse rate, sections 2 and 4 |
| H3 | Deepcoin Membership, edited 2024-11-29, and its attached image | https://deepcoin.zendesk.com/hc/en-001/articles/4404834012045-Deepcoin-Membership | 2026-09-22 | Deepcoin, global | VIP thresholds, section 4 |
| H4 | Deepcoin VIP User System Rules, edited 2025-09-23 | https://deepcoin.zendesk.com/hc/en-001/articles/50633997315865-Deepcoin-VIP-User-System-Rules | 2026-09-22 | Deepcoin, global | gift scheme, section 4 |
| H5 | Announcement: Deepcoin PRO Service is Now Live!, edited 2025-09-12 | https://deepcoin.zendesk.com/hc/en-001/articles/50496518439833-Announcement-Deepcoin-PRO-Service-is-Now-Live | 2026-09-22 | Deepcoin, global | PRO eligibility and the 2025 PRO table, section 4 |
| H6 | Deepcoin PRO page | https://www.deepcoin.com/ps/en/pro | 2026-09-22, through the fetch | Deepcoin, global | current PRO table, sections 2 and 4 |
| H7 | Notice of transaction fee adjustment for some U-based contract trading pairs, 2023-12-23 | https://deepcoin.zendesk.com/hc/en-001/articles/26685961911449-Notice-of-transaction-fee-adjustment-for-some-U-based-contract-trading-pairs | 2026-09-22 | Deepcoin, global | per-pair rates, section 5 |
| H8 | Notification of transaction fee adjustment for SOLUSDT contract trading pair, edited 2024-12-20 | https://deepcoin.zendesk.com/hc/en-001/articles/27354093338777-Notification-of-transaction-fee-adjustment-for-SOLUSDT-contract-trading-pair | 2026-09-22 | Deepcoin, global | section 5 |
| H9 | Funding Costs of USDT Perpetual Pro Contract, edited 2021-10-08 | https://deepcoin.zendesk.com/hc/en-001/articles/360056527671-Funding-Costs-of-USDT-Perpetual-Pro-Contract | 2026-09-22 | Deepcoin, global | funding formula, cap, instants, section 6 |
| H11 | Liquidation Process and Calculation Formula for Liquidation of USDT Perpetual Pro Contract, edited 2024-08-11 | https://deepcoin.zendesk.com/hc/en-001/articles/360056456151-Liquidation-Process-and-Calculation-Formula-for-Liquidation-of-USDT-Perpetual-Pro-Contract | 2026-09-22 | Deepcoin, global | section 7 |
| H12 | Important Update: RWA Index Perpetual Contracts Trading Hours & Risk Management Adjustments, edited 2025-10-16 | https://deepcoin.zendesk.com/hc/en-001/articles/51027537396761-Important-Update-RWA-Index-Perpetual-Contracts-Trading-Hours-Risk-Management-Adjustments | 2026-09-22 | Deepcoin, global | trading hours, frozen price, paused funding, sections 6 and 7 |
| H13 | DEEPCOIN Launches Stock Perpetuals to Drive Multi-Asset Expansion, 2026-09-16 | https://deepcoin.zendesk.com/hc/en-001/articles/62298508520089-DEEPCOIN-Launches-Stock-Perpetuals-to-Drive-Multi-Asset-Expansion | 2026-09-22 | Deepcoin, excludes the United States | United States exclusion, stock perpetual count, sections 1, 3 and 5 |
| H14 | Deepcoin Terms of Use, edited 2023-11-06 | https://deepcoin.zendesk.com/hc/en-001/articles/360048193911-Deepcoin-Terms-of-Use | 2026-09-22 | DEEPCOIN LIMITED | entity and restricted locations, section 1 |
| H15 | Notice on Deepcoin Spot Trading Fee Adjustment, 2025-11-24 | https://deepcoin.zendesk.com/hc/en-001/articles/52713927580057-Notice-on-Deepcoin-Spot-Trading-Fee-Adjustment | 2026-09-22 | Deepcoin, global | spot fee, section 3 |
| S11 | Deepcoin API changelog | https://www.deepcoin.com/docs/changelog | 2026-09-22, through the fetch | Deepcoin, global | `account/trade-fee` added 2026-05-28, section 5 |
| C1 | CoinGecko derivatives exchange `deepcoin_derivatives` | https://api.coingecko.com/api/v3/derivatives/exchanges/deepcoin_derivatives | 2026-09-22 | third party | 349 perpetual pairs, 0 futures, Singapore, sections 1 and 3 |
| C2 | CoinGecko exchange `deepcoin` | https://api.coingecko.com/api/v3/exchanges/deepcoin | 2026-09-22 | third party | Seychelles, trust score 7, section 1 |
| X1 | CCXT 4.5.68 `deepcoin.js` | `server/node_modules/ccxt/js/src/deepcoin.js` | 2026-09-22 | CCXT | fee constants, market parsing, sections 3, 5 and 8 |
| P1 | `rest-probe.mjs catalog`, `anchor` and `misc` at 03:34 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deepcoin/rest-probe.mjs) | 2026-09-22 | this host | counts, CCXT taker, funding intervals, sections 3, 6 and 8 |
