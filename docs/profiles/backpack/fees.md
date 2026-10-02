# Backpack Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in the local evening, which is 2026-09-23 from 03:20 UTC, from the development host near Seattle.

This profile covers perpetual trading on Backpack Exchange (CCXT id `backpack`), and nothing else.
Spot, prediction markets, deposit, withdrawal, lending and staking schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/backpack/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/backpack/ws-probe.mjs).
All times in this profile are UTC.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entities | Trek Labs Ltd FZE, licensed by Dubai VARA under an Exchange Services License, No. VL/23/07/001, which "does not cover Futures or Margin Trading". Trek Labs, Inc. is a FinCEN money services business with state licences in the United States. The Exchange Trading Rules say the order book "is operated at group level by a Backpack Exchange group affiliate", which they do not name. An EU arm answers at `support@eu.backpack.exchange`, and its company was not read. | Published | S12, S13, S14 |
| regions not served | North Korea, Iran, Cuba, and the Crimea, Sevastopol, Luhansk and Donetsk regions. Canada, Japan and New Zealand are "not currently able to serve you". | Published | S10 |
| who may trade the perpetuals | The public permissions list sets `isPerpEnabled` false for 12 of 212 countries: AE, AU, CA, CK, CU, GB, IR, JP, KP, NZ, US and VI. Every other country has perpetuals at a leverage limit of 75 (172 countries), 20 (27 countries, which are 25 EU members with Iceland and Norway) or 10 (Cyprus). | Probed | S11, `rest-probe.mjs main`, tag `country_permissions` |
| United States persons | May not trade perpetuals. The US row reads `isPerpEnabled: false`, `isSpotEnabled: true`, `leverageLimit: "1"` and KYC level `us-individual-onboarding`. The state table lists Washington, where this host sits, as "Coming Soon", so spot is not offered there either. | Probed and Published | S11, S13 |
| UAE | Spot only, `isPerpEnabled: false`, which matches the VARA licence text | Probed and Published | S11, S12 |
| blocked countries | `blocked: true` on CA, CU, CY, IR, KP, LT and NZ, and `sanctioned: true` on CU, IR, KP and SY | Probed | S11, tag `country` |
| public API from this host | Every public REST and WebSocket call answered, with no refusal, no challenge and no rate limit reply | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |
| route from this host | The host's default route is a WireGuard tunnel, `surfshark_wg`, set up before this research and not for it. CloudFront served every request from its Seattle point of presence, so the exit is in the United States, the same country as the host, and nothing was refused | Probed | [`rest.md`](./rest.md) section 1 |
| documentation from this host | `docs.backpack.exchange`, `support.backpack.exchange` and `backpack.exchange/fees` answered HTTP 200 | Probed | `curl` on 2026-09-22 |

The permissions list is the one the web app reads, and it is public at `/wapi/v1/country/permissions`.
It is the most exact statement of who may trade the perpetuals, and it says a US person may not.
Cyprus is marked `blocked` while its row keeps `isPerpEnabled: true`, and what that combination means is Not publicly specified.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDC-settled linear perpetuals, crypto and equity | 0.02 % = 200 ppm | 0.05 % = 500 ppm | Published and Probed | S1 `futures` Tier 1, S2 table image |

Backpack names its base tier "Tier 1", and it is the VIP 0 of this survey.
The public tier call and the help centre table agree on every row, see section 4.
One schedule covers every perpetual, and no page read gives equity perpetuals a separate taker.
The engine models a taker cross at the base tier, so 500 ppm is the number that matters.

Every taker order, market or limit, waits 100 ms before it reaches the book, and only post-only orders skip the wait, S8.
That delay is not a fee, and it is recorded here because it is a cost a taker cross pays in time.

## 3. Coverage matrix

| product | present | count on 2026-09-23 03:23 UTC | evidence |
|---|---|---:|---|
| USDC-settled linear perpetuals, crypto | yes | 74 `Open`, 11 `Closed` (2 of them not visible) | Probed, `/api/v1/markets`, tag `markets_by_kind` |
| USDC-settled linear perpetuals, equities and equity indices (`rwaMarketType` `STOCK` or `INDEX`) | yes | 17 `Open` (14 stocks, 3 indices), 1 `PostOnly` and not visible (`MSFT.US_USDC_PERP`) | Probed, same call, tag `perp_rwa` |
| USDT-settled, coin-margined or inverse perpetuals | no | 0 | Probed, every `PERP` row has `quoteSymbol` `USDC` |
| `IPERP`, `DATED` and `RFQ` market types | listed in the API enum, no market | 0 each | Probed, `/api/v1/markets?marketType=...`, tag `markets_family` |
| dated futures | no | 0 | same call with `DATED` |
| options | no | 0 | no market type exists for them |
| prediction markets | yes, not detailed | 194 rows, 6 `Open` | Probed, `marketType=PREDICTION` |
| spot | yes, not detailed | 87 rows, 52 `Open` | Probed, `marketType=SPOT` |

The survey's CoinGecko list names 93 perpetual pairs, and the wire has 91 open and 1 post-only.
CCXT counts 91 active swaps, because it keeps only `orderBookState` `Open`, at `server/node_modules/ccxt/js/src/backpack.js` line 754.
Spot fees are in the same public tier call, with a Tier 1 of 0.08 % maker and 0.10 % taker, S1.
Withdrawal fees are looked up at `https://support.backpack.exchange/exchange/deposit-and-withdraw/crypto/withdrawals/withdrawal-fees`.

## 4. Perpetual tiers

The futures tiers from `GET https://api.backpack.exchange/wapi/v1/feeTiers`, probed at 03:23 UTC, S1.
The help centre image S2 prints the same eleven rows and adds the staked BP column.

| tier | staked BP | or 30 day futures volume (USD) | maker | taker | taker ppm |
|---|---:|---:|---:|---:|---:|
| Tier 1 | 0 | 0 | 0.020 % | 0.050 % | 500 |
| Tier 2 | 350 | 500,000 | 0.019 % | 0.045 % | 450 |
| Tier 3 | 1,500 | 1,000,000 | 0.018 % | 0.040 % | 400 |
| Tier 4 | 3,500 | 5,000,000 | 0.016 % | 0.035 % | 350 |
| Tier 5 | 15,000 | 10,000,000 | 0.013 % | 0.030 % | 300 |
| Tier 6 | 30,000 | 25,000,000 | 0.010 % | 0.028 % | 280 |
| VIP1 | 50,000 | 50,000,000 | 0.010 % | 0.026 % | 260 |
| VIP2 | 100,000 | 100,000,000 | 0 % | 0.024 % | 240 |
| VIP3 | 200,000 | 150,000,000 | 0 % | 0.022 % | 220 |
| VIP4 | 350,000 | 200,000,000 | 0 % | 0.020 % | 200 |
| VIP5 | 500,000 | 300,000,000 | 0 % | 0.018 % | 180 |

### Qualification

- "Fee tiers are recalculated hourly", S2 and S3.
- "Your effective tier is determined by your BP stake, trading volume, and pre-TGE Mad Lad NFT holding, whichever tier is highest.", S3.
- The image prints "or" between the staked BP column and the volume columns, S2.
- The USDT/USDC spot pair trades at 0 % and does not count toward the 30 day volume, S3.
- How many Mad Lad NFTs map to which tier is Not publicly specified in the pages read.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | evidence |
|---|---|---|
| BP token stake | reaches a tier by stake alone, from 350 BP for Tier 2 to 500,000 BP for VIP5, section 4 | S2 |
| pre-TGE Mad Lad NFT | can set the tier, mapping Not publicly specified | S3 |
| referral | the referrer earns 10 % of the referred user's fees, and no page read gives the referred user a lower taker. Equity perpetual fees pay no referral rebate. | S16 |
| market maker program | maker rebates and a monthly pool of $325,000, of which $250,000 is for perpetuals, by application to `vip@backpack.exchange`. No taker change is named. | S9 |
| zero fee promotion | none found for perpetuals in the pages read | S2, S3 |

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| formula | "Funding rate = Clamp[(mean_premium_index + Clamp(interest_rate – mean_premium_index, -0.05%, 0.05%)) / 8, Funding rate cap, Funding rate floor]" | S4 |
| premium | "premium = (mark price − index price) / index price", recorded every second and averaged over the funding interval | S4 |
| interest add-on | "interest_rate = 0.03 % × (funding_interval_hours / 24)" | S4 |
| interval | 1 h on 103 of 103 perpetual rows, `fundingInterval` 3600000 ms. "on Wednesday August 20 at 08:00 UTC, the funding rate intervals across all perpetual futures markets were changed to hourly." | Probed, tag `perp_funding_interval_ms`, and S4 |
| settlement grid | every hour on the hour: the history of `BTC_USDC_PERP` has 1,000 rows from 2026-08-12 13:00 to 2026-09-23 04:00, 999 gaps of exactly 1 h | Probed, tag `funding_history_spacing` |
| cap and floor | `fundingRateUpperBound` and `fundingRateLowerBound`, "In basis points": 150 and -150 on 100 perpetuals, 100 and -100 on 3, so 1.5 % or 1 % per hour | Probed, tag `perp_funding_bounds_bps`, and S17 |
| who pays | "If positive, longs pay shorts, if negative, shorts pay longs." | S5 |
| when | "Funding payments are debited/credited at the end of the interval", and a position closed before the countdown ends "will neither pay nor receive" | S4, S5 |
| amount | "payment = funding rate × position quantity × mark price", settled in USDC | S4, S7 |

The formula as written and the wire disagree by a factor of 8.
Read literally for a 1 h interval, the interest add-on is 0.03 % × 1/24 = 0.00125 %, and a market whose premium sits near zero would publish that divided by 8, which is 0.00015625 %.
The wire shows 0.0000125, which is 0.00125 %, on 32 of 92 perpetuals at 03:23 UTC and 33 of 92 at 03:45 UTC, and on `BTC_USDC_PERP` and `SOL_USDC_PERP` for every minute of polling.
So the published rate for a quiet market equals the interest add-on itself, and the `/ 8` does not apply to it as written.
The number a poller reads is the per-interval fraction, and the engine takes it as published.

The funding settlement instant itself was not captured.
The history call lists the interval still in progress, see [`rest.md`](./rest.md) section 4, so the settled rate is expected to be the last value of that row, which is Not verified.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| liquidation fee | "1% per fill" on system-triggered perpetual liquidations, "Deducted from liquidation proceeds" | S6 |
| liquidation path | first through the order book in steps of 10 % of the position, then to Backstop Liquidity Providers with "A portion of remaining account equity" paid to the backstop fund | S6 |
| PnL settlement | unrealized PnL is realized into USDC "Every 10 seconds" without changing the position | S7 |
| settlement asset | USDC, and a missing USDC balance is covered by redeeming lends, borrowing, or converting collateral, in that order | S7 |
| delisting charge | Not publicly specified in the pages read | |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, `ccxt.version`, tag `ccxt_load` |
| `market.taker` on every active swap without credentials | `undefined` on 91 of 91 | Probed, tag `ccxt_active_by_settle` |
| where it comes from | the literals `'taker': undefined, // todo check commission` and `'maker': undefined` in `parseMarket` | `server/node_modules/ccxt/js/src/backpack.js` lines 758 and 759 |
| exchange-level fee block | none, the file has no `'fees'` or `'trading'` key anywhere | `server/node_modules/ccxt/js/src/backpack.js`, `grep` for both keys finds nothing |
| `contractSize` | 1 on every swap | `server/node_modules/ccxt/js/src/backpack.js` line 736, Probed |

CCXT reports no taker at all, so there is no CCXT constant to compare.
The connector maps a market whose `takerPpm` is unset and whose CCXT taker is not a number to `null`, and skips it, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 162 to 166 and 180 to 186.
With no registry value every Backpack market would be skipped and the venue would log "no usable swap markets", at the same file, line 51.
The mismatch warning never fires either, because it runs only when CCXT's number is a number, at line 120.

## 9. Recommended registry values

```ts
backpack: {
  takerPpm: 500,
  // ccxt/js/src/backpack.js:758 sets market.taker to undefined, so the registry number is the only fee the connector sees.
}
```

`takerPpm: 500` is the published and probed Tier 1 perpetual taker, S1 and S2.
It is required, not optional, because without it the connector drops every market, section 8.
`ccxtTakerPpm` stays unset, because CCXT reports no number and the comparison never runs.
The public tier call at `/wapi/v1/feeTiers` is the watch for a later fee change.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public fee tier call, `futures` and `spot` arrays | https://api.backpack.exchange/wapi/v1/feeTiers | 2026-09-22, probed 03:23 UTC | Backpack, global | sections 2, 3 and 4 |
| S2 | Trading Fees, help centre page with the fee structure image | https://support.backpack.exchange/exchange/trading/trading-fees | 2026-09-22 | Backpack, global | tier table with staked BP, sections 2, 4 and 5 |
| S3 | Trading Fees, exchange page | https://backpack.exchange/fees | 2026-09-22 | Backpack, global | hourly recalculation, effective tier rule, USDT/USDC at 0 %, sections 4 and 5 |
| S4 | Futures Specs | https://support.backpack.exchange/technical-docs/trading/futures-specs | 2026-09-22 | Backpack, global | funding formula, hourly switch, payment, section 6 |
| S5 | Futures Fees, funding section | https://support.backpack.exchange/exchange/trading/futures/fees | 2026-09-22 | Backpack, global | who pays, closing before the countdown, section 6 |
| S6 | Liquidation | https://support.backpack.exchange/technical-docs/trading/liquidation | 2026-09-22 | Backpack, global | liquidation fee and path, section 7 |
| S7 | Settlement and Realization | https://support.backpack.exchange/technical-docs/trading/settlement-and-realization | 2026-09-22 | Backpack, global | USDC settlement, 10 s PnL realization, sections 6 and 7 |
| S8 | Taker Speed Bump | https://support.backpack.exchange/technical-docs/trading/taker-speed-bump | 2026-09-22 | Backpack, global | 100 ms taker delay, section 2 |
| S9 | Market Maker Program | https://support.backpack.exchange/exchange/programs/market-maker-program | 2026-09-22 | Backpack, global | maker rebates and reward pool, section 5 |
| S10 | Supported Regions | https://support.backpack.exchange/exchange/exchange-account/identity-verification/supported-regions | 2026-09-22 | Backpack, global | regions not served, section 1 |
| S11 | Public country and permission calls | https://api.backpack.exchange/wapi/v1/country/permissions and https://api.backpack.exchange/wapi/v1/country | 2026-09-22, probed 03:23 UTC | Backpack, per country | perpetual access by country, blocked and sanctioned flags, section 1 |
| S12 | VARA License Information | https://support.backpack.exchange/legal/vara-disclosures/vara-license-information | 2026-09-22 | Trek Labs Ltd FZE, UAE | licence number, no futures in the UAE, section 1 |
| S13 | States Where We Operate, "As of September 2026" | https://support.backpack.exchange/legal/us-licenses-registrations-and-regulatory-disclosures/states-where-we-operate | 2026-09-22 | Trek Labs, Inc., United States | FinCEN registration, Washington "Coming Soon", section 1 |
| S14 | Exchange Trading Rules | https://support.backpack.exchange/legal/vara-disclosures/exchange-trading-rules | 2026-09-22 | Trek Labs Ltd FZE | group affiliate operates the order book, section 1 |
| S15 | Equity Futures Specs | https://support.backpack.exchange/technical-docs/trading/equity-futures-specs | 2026-09-22 | Backpack, global | equity perpetuals share the standard funding formula, section 2 |
| S16 | Referrals | https://support.backpack.exchange/exchange/programs/referrals | 2026-09-22 | Backpack, global | referral rebate terms, section 5 |
| S17 | Backpack Exchange API, `Market` schema | https://docs.backpack.exchange/ | 2026-09-22 | Backpack, global | funding bounds are in basis points, section 6 |
| S18 | CCXT 4.5.68 `backpack.js` | `server/node_modules/ccxt/js/src/backpack.js` | 2026-09-22 | CCXT | sections 3 and 8 |
| P1 | `rest-probe.mjs main`, runs at 03:23 UTC and in the second pass at 03:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/backpack/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 3, 4, 6 and 8 |
| P2 | `rest-probe.mjs poll`, runs at 03:24, 03:34 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/backpack/rest-probe.mjs) | 2026-09-22 | this host | section 6 |
