# CEX.IO Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:16 to 03:55 UTC, from the development host near Seattle, whose traffic Cloudflare's trace places in Canada (`loc=CA`, colo `YVR`).

CEX.IO (CCXT id `cex`) is a spot exchange, and its API product is called CEX.IO Spot Trading, formerly Exchange Plus.
It lists no perpetual, so this profile covers CEX.IO spot, as the survey plan's template change 1 asks, and names every other product in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/cex/ws-probe.mjs).

The website, the fee schedule and the API documentation redirect this host to a Canadian notice, see section 1.
So the fee pages and the API documentation were read as Internet Archive copies, dated in the source ledger.
The public API itself answered this host without a refusal.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 Pacific time for every source row | | source ledger |
| CoinGecko listing | "CEX.IO", country United Kingdom, established 2013, trust score 7, trust score rank 78, 281 coins, 699 pairs, 808.14 BTC of 24 h volume | Probed | S13, `https://api.coingecko.com/api/v3/exchanges/cex` |
| CoinGecko derivatives list | no entry whose id or name matches `cex` among 214 venues, only `btcex_futures` and `kcex-futures` contain the string | Probed | S13, `https://api.coingecko.com/api/v3/derivatives/exchanges/list` |
| legal entities | "CEX.IO Corp., CEX.IO EU VASP, UAB and CEX OVRS LLC are collectively managing the CEX.IO platform." CEX.IO Corp. (NMLS# 1804170) "serves United States residents only in jurisdictions where it is licensed to operate as a Money Service Business". CEX.IO EU VASP, UAB (306186479) is registered in Lithuania as a Virtual Asset Service Provider. CEX OVRS LLC (No. L 22275), Nevis, "serves customers all over the world except from the countries which are specified in the respective Terms of Use" | Published, archived 2025-04-08 | S3 footer |
| who may trade | a verified customer outside the unsupported list, through the entity that serves the customer's region | Published | S3, S4 |
| excluded regions | "Afghanistan, Belarus, Canada, The Democratic Republic of Congo, Cuba, Guam, Guinea Bissau, Haiti, Honduras, India, Iran, Iraq, Japan, Lebanon, Libya, Mali, Myanmar, Nicaragua, North Korea, Palestinian Territory, Puerto Rico, Russian Federation, Singapore, Somalia, South Sudan, Sudan, Syria, United States Virgin Islands, Venezuela, Yemen", 30 entries | Published, updated 2026-09-10 | S4 |
| whether US persons may trade | Yes, in eligible states. "Eligible U.S. users can choose to access the cryptocurrency ecosystem, and select digital asset services in compliance with their state's local regulatory landscape", and S5 lists 195 pairs "available for trading in the U.S.". Hawaii deposits stopped on 2023-04-21 (S15) | Published | S4, S5, S15 |
| Canada | services ended on 2023-07-15, withdrawals ended on 2023-10-05, and CEX.IO was asked "to block access to the CEX.IO website and application for anyone using an IP address from Canada" | Published | S6 |
| website and docs from this host | `https://cex.io/`, `https://cex.io/fee-schedule`, `https://cex.io/limits-commissions`, `https://cex.io/terms-of-use`, `https://trade.cex.io/` and `https://trade.cex.io/docs/` each answered 302 to `https://cex.io/canadian-regulations/`, whose text reads "we regret that CEX.IO is currently unable to offer services to customers based in Canada". The help center at `https://support.cex.io/en/` answered 200. A fetch tool asked for the documentation page got the same 302 | Probed | `curl` at 03:16 UTC, S7 |
| public API from this host | `https://trade.cex.io/api/spot/rest-public`, `wss://trade.cex.io/api/spot/ws-public`, the legacy `https://cex.io/api` and `wss://ws.cex.io/ws` all answered, through Cloudflare colos `YVR` and `SEA`. The only refusals were HTTP 429 on `get_ticker`, see [`rest.md`](./rest.md) section 6, and the legacy socket's login requirement for its book | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

Reading public market data is not an account service, and the API refused none of it on geography.
Trading is another matter: Canada is unsupported and the website blocks Canadian addresses, so an operator behind this host's egress cannot open the account an execution stage would need.
A US operator could, in an eligible state, through CEX.IO Corp.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, default strategy, 30 day volume up to 10,000 USD | 0.25 % = 2,500 ppm | 0.25 % = 2,500 ppm | Published, archived 2026-04-26 and 2026-05-09 | S2 `spotFee.strategyConfig.default[0]` `{"fee":"0.25","volume":10000}`, and the identical first row in S1's `get_fee_strategy` example |
| spot, "Reduced Rate Pairs" `EURC-EUR`, `USDC-USD`, `USDT-USD`, `USDC-USDT` | 0.01 % = 100 ppm | 0.01 % = 100 ppm | Published, archived 2026-04-26 | S2 `perTier.reducedFee` |
| perpetuals | none | | see section 3 | |

The current schedule has one rate per pair, not a maker and a taker rate.
S1 describes a "Fixed commission rate" and a "Floating commission rate", charged "only for executed order amount" and in the quote currency, and its private `get_my_current_fee` returns a single `percent` per pair.
The 2025 fee schedule (S3) still showed a "Maker-Taker Fee Schedule" of 0.25 % taker and 0.15 % maker at the first tier, for the legacy exchange.
The live fee schedule could not be read from this host, so which of the two a new account gets today is Not verified, and 2,500 ppm for both sides is the reading of the 2026 sources.

2,500 ppm is five times the 500 ppm VIP 0 perpetual taker of Gate in [`../gate/fees.md`](../gate/fees.md) section 2, so a leg paying it needs a gross cross above 0.25 % before any other cost.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | evidence |
|---|---|---:|---|
| spot | yes, researched | 898 pairs: 295 `USDT`, 287 `USD`, 210 `USDC`, 73 `EUR`, 19 `GBP`, 11 `BTC`, 3 `USD1` quoted | Probed, `get_pairs_info`, see [`rest.md`](./rest.md) section 2 |
| margin trading | yes, not detailed | pairs are being removed: 18 on 2026-08-13 (S8), and earlier lists on 2026-07-30 and 2026-08-06 | S2 "Margin" tab, S3 "Trade crypto with up to x10 leverage. Country restrictions apply.", S8. No public API call covers it, S1 has no occurrence of "margin" |
| perpetuals | Not offered | 0 | CCXT `'swap': false` at `server/node_modules/ccxt/js/src/cex.js` line 30. S1 has no occurrence of "perpetual", "futures", "funding rate" or "leverage". The help center lists no derivatives collection. `broker.cex.io`, `futures.cex.io` and `derivatives.cex.io` do not resolve (`dig`, 2026-09-23) |
| dated futures | Not offered | 0 | CCXT `'future': false` at line 31, S1 |
| options | Not offered | 0 | CCXT `'option': false` at line 32, S1 |
| CoinGecko derivatives list | absent | | S13 |

CCXT's own comment on margin reads `'margin': false, // has, but not through api`, at `server/node_modules/ccxt/js/src/cex.js` line 29.

Deposit, withdrawal and network fees are looked up on the Wallet tab of `https://cex.io/limits-commissions` (S2), and per currency through the public `get_processing_info` call (S1).

## 4. Spot tiers

### Default strategy, volume in USD over 30 days

| 30 day volume up to, USD | fee | ppm |
|---:|---:|---:|
| 10,000 | 0.25 % | 2,500 |
| 100,000 | 0.23 % | 2,300 |
| 500,000 | 0.19 % | 1,900 |
| 1,000,000 | 0.17 % | 1,700 |
| 2,500,000 | 0.15 % | 1,500 |
| 5,000,000 | 0.13 % | 1,300 |
| 10,000,000 | 0.11 % | 1,100 |
| 20,000,000 | 0.10 % | 1,000 |

Source: S2 `spotFee.strategyConfig.default`, and the same eight rows in S1's `get_fee_strategy` example.
The rate applies to maker and taker alike, see section 2.

The legacy maker and taker schedule of 2025 (S3) had 16 rows, from 0.25 % taker and 0.15 % maker up to 10,000 USD, down to 0.01 % taker and 0 % maker above 5,000,000,000 USD.
It is recorded here only because the live fee page could not be read.

### Qualification

The tier follows the 30 day trade volume over all pairs, recalculated at 00:00 GMT each day and including the current day's trades, per S3.
S1 adds that fees can differ by pair, group of pairs and day of week, and names weekends as one case.
Above 20,000,000 USD the 2026 sources publish no tier, and S10 offers "custom fees that match your trading volume" to VIP clients.

## 5. Discounts that change the spot taker

| discount | effect | evidence |
|---|---|---|
| reduced rate pairs | 0.01 % on `EURC-EUR`, `USDC-USD`, `USDT-USD` and `USDC-USDT` | S2, archived 2026-04-26 |
| lower fee pairs | 67 pairs at 0.10 % from 2023-10-09, "The offer is prolonged and is permanent for now" (2024-01-08). The pairs are mid caps against `USD`, `USDT` and `EUR`, and none is `BTC` or `ETH`. Whether it still applies after the 2026 reduced rate list is Not verified | S9 |
| Trading Fee Balance | a separate USDC balance, granted in promotions, that pays fees | S11 |
| VIP | custom fees by agreement | S10 |
| token holding, referral | none that changes the trading fee was found | S1, S2 |

No zero fee promotion with an end date was found.

## 6. Funding as a cost

Spot has no funding.
A margin position pays rollover instead: every asset listed in S2 carries an annual rate of 10 %, charged on a calendar schedule of `0 */1 * * *`, which S2 shows as an HPR of 0.00114160 % and explains as "Hourly Percentage Rate. Charged each calendar hour."
A settlement instant was not captured, because spot has none.

## 7. Liquidation, settlement and delisting

| charge | value | evidence |
|---|---|---|
| margin open position | 0.1 % | S2 `marginFee.trading.default.open` |
| margin close position | 0.1 % | S2 |
| margin liquidate position | 1 % | S2 |
| margin settle position | 0.1 % | S2 |
| spot settlement | none, spot settles at the trade | |
| delisting | purchases and new trades stop first, trading and open orders stop four to seven days later in the three 2026 notices, and remaining balances are "automatically converted to USDC" at removal. The 19 assets of the current notice stop buying on 2026-09-21, stop trading on 2026-09-28 and are removed on 2026-10-15 | S12, S17, S18 |
| margin pair removal | "Any positions that remain open at the time of delisting will be automatically closed" | S8 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| class | `cex`, REST at `https://trade.cex.io/api/spot/rest-public` and `/rest`, CCXT Pro on the legacy `wss://ws.cex.io/ws` | `server/node_modules/ccxt/js/src/cex.js` lines 126 to 129, `server/node_modules/ccxt/js/src/pro/cex.js` line 40 |
| market type | every market is `type: 'spot'`, and the class declares `'swap': false`, `'future': false`, `'option': false` | `server/node_modules/ccxt/js/src/cex.js` lines 28 to 32 and 476 to 481 |
| `market.taker` for `BTC/USD`, no credentials | `undefined`, and `maker` too, on all 898 markets | Probed, `rest-probe.mjs catalog`, tags `ccxt_btc_usd` and `ccxt_fields`, both runs |
| where it comes from | `describe()` sets no `fees.trading` block, so the base defaults `'taker': undefined` and `'maker': undefined` are merged into every market | the only `fees` key in the `describe()` of `cex.js` is the URL list at line 132, and `server/node_modules/ccxt/js/src/base/Exchange.js` lines 2370 to 2375 and 3732 to 3735 |
| the private fee trap | `fetchTradingFees` copies the private `percent`, `"0.25"` in CCXT's own comment, straight into `maker` and `taker` with no division by 100, so it would report 0.25, meaning 25 % | `server/node_modules/ccxt/js/src/cex.js` lines 842 to 860 and 882 to 891 |
| `rateLimit` | 300 ms, commented "200 req/min" | `server/node_modules/ccxt/js/src/cex.js` line 24 |

## 9. Recommended registry values

None today, because CEX.IO lists no perpetual and the connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203.
Registering CEX.IO as it stands would load 898 spot markets, keep 0, and skip the venue with "no usable swap markets", at the same file line 51.

If a later design adds spot legs on the USD family, the entry would read as follows.

```ts
cex: {
  takerPpm: 2_500, // default strategy tier 1, one rate for maker and taker, archived limits page of 2026-04-26
  // ccxtTakerPpm stays unset: CCXT 4.5.68 reports no taker for cex, server/node_modules/ccxt/js/src/base/Exchange.js lines 2370 to 2375
}
```

`takerPpm` is required, not optional, for this venue.
Without it `toMarket` finds no taker on any market and skips all of them, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 162 to 166.
The four reduced rate stablecoin pairs would carry 100 ppm, which the registry cannot express per market today.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CEX.IO Spot Trading API documentation, "Last updated: 2026-03-19" | `https://trade.cex.io/docs/`, read as `https://web.archive.org/web/20260509143348/https://trade.cex.io/docs/` because the live page answers this host with 302 | 2026-09-22 | CEX.IO, global | commission strategies, `get_fee_strategy` and `get_my_current_fee` examples, absence of derivative terms, sections 2 to 5 |
| S2 | Limits and Commissions | `https://cex.io/limits-commissions`, read as `https://web.archive.org/web/20260426231722/https://cex.io/limits-commissions` | 2026-09-22 | CEX.IO, global | spot tiers, reduced rate pairs, margin fees and rollover, sections 2 to 7 |
| S3 | Fee schedule | `https://cex.io/fee-schedule`, read as `https://web.archive.org/web/20250408224614/https://cex.io/fee-schedule`, the newest copy | 2026-09-22 | CEX.IO, global | legacy maker and taker schedule, qualification rule, legal entities, margin leverage, sections 1 to 4 |
| S4 | The following countries and territories are currently not supported by CEX.IO | https://support.cex.io/en/articles/4560858-the-following-countries-and-territories-are-currently-not-supported-by-cex-io | 2026-09-22, article updated 2026-09-10 | CEX.IO, global | excluded regions, US licensing, section 1 |
| S5 | Supported currencies and trading pairs for U.S. customers | https://support.cex.io/en/articles/5465666-supported-currencies-and-trading-pairs-for-u-s-customers | 2026-09-22, article updated 2026-09-08 | CEX.IO Corp., US | US eligibility and 195 US pairs, section 1 |
| S6 | Update regarding our services in Canada | https://support.cex.io/en/articles/8403870-update-regarding-our-services-in-canada | 2026-09-22 | CEX.IO, Canada | Canadian exit and IP block, section 1 |
| S7 | To our esteemed Canadian customers | https://cex.io/canadian-regulations/ | 2026-09-23 03:16 UTC, from this host | CEX.IO, Canada | the page every website URL redirects this host to, section 1 |
| S8 | Margin Trading Pairs Removal (August 13, 2026) | https://support.cex.io/en/articles/16308280-margin-trading-pairs-removal-august-13-2026 | 2026-09-22 | CEX.IO, global | margin pair removals and forced closes, sections 3 and 7 |
| S9 | Trade certain pairs with lower fees | https://support.cex.io/en/articles/8455859-trade-certain-pairs-with-lower-fees | 2026-09-22 | CEX.IO, global | 0.10 % pairs, section 5 |
| S10 | CEX.IO VIP Services | https://support.cex.io/en/articles/12069901-cex-io-vip-services | 2026-09-22, article updated 2026-09-08 | CEX.IO, global | custom fees, sections 4 and 5 |
| S11 | Trading Fee Balance at Spot Trading | https://support.cex.io/en/articles/8178067-trading-fee-balance-at-spot-trading | 2026-09-22 | CEX.IO, global | fee balance, section 5 |
| S12 | We're removing 19 assets from CEX.IO on October 15, 2026 | https://support.cex.io/en/articles/16944466-we-re-removing-19-assets-from-cex-io-on-october-15-2026 | 2026-09-22, article updated 2026-09-14 | CEX.IO, global | delisting steps, section 7 |
| S13 | CoinGecko API, exchange `cex` and derivatives exchanges list | https://api.coingecko.com/api/v3/exchanges/cex | 2026-09-23 UTC | CoinGecko | listing context, sections 1 and 3 |
| S14 | Exchange Plus is rebranding to CEX.IO Spot Trading | https://support.cex.io/en/articles/8889817-exchange-plus-is-rebranding-to-cex-io-spot-trading | 2026-09-22 | CEX.IO, global | product name and domain, preamble |
| S15 | An update regarding our services in the state of Hawaii | https://support.cex.io/en/articles/7172789-an-update-regarding-our-services-in-the-state-of-hawaii | 2026-09-22 | CEX.IO Corp., US | Hawaii, section 1 |
| S16 | CCXT 4.5.68 `cex.js` and `pro/cex.js` | `server/node_modules/ccxt/js/src/cex.js` | 2026-09-22 | CCXT | section 8 |
| S17 | Asset delisting notice (September 2026) | https://support.cex.io/en/articles/16249960-asset-delisting-notice-september-2026 | 2026-09-22 | CEX.IO, global | suspension on 2026-08-13, trading end on 2026-08-20, section 7 |
| S18 | Asset delisting notice (September 21, 2026) | https://support.cex.io/en/articles/16441248-asset-delisting-notice-september-21-2026 | 2026-09-22 | CEX.IO, global | suspension on 2026-09-07, trading end on 2026-09-11, section 7 |
| P1 | `rest-probe.mjs catalog`, runs at 03:21 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs) | 2026-09-23 | this host | catalog counts and CCXT fields, sections 3 and 8 |
