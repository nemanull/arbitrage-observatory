# WOO X Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:05 to 04:37 UTC on 2026-09-23, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the fees of WOO X (CCXT id `woo`) on its one perpetual family, the USDT-margined linear perpetuals.
The fee numbers come from WOO X's own public tier endpoint, which the help center's fee article points to, and every other rule comes from the help center.
The help center pages refuse this host, so they were read through the Zendesk Help Center API of the same site, see section 1.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | WOOTECH Limited Corp, "WOOTECH Limited" in the terms | S6 |
| governing law | the Republic of Panama, arbitration seated in Panama City | S6 |
| who may trade perpetuals | users who complete KYC and are not citizens or residents of an unsupported country | S5, S6 |
| United States | excluded: "Our Services are not offered to entities or persons who have their registered office or place of residence in the United States of America or any Restricted Territory", and the United States is on the unsupported list for all services | S5, S6 |
| unsupported for all services, futures included | Afghanistan, American Samoa, Canada, China, Crimea and Sevastopol, Cuba, Democratic Republic of the Congo, Donetsk, Guam, Iran, Libya, Luhansk, Malaysia, Mali, Myanmar, North Korea, Northern Mariana Islands, Panama, Puerto Rico, South Sudan, Sudan, Syria, Taiwan, U.S. Virgin Islands, United States | S5, 24 rows, every row marked X in every column |
| European Economic Area | not excluded, but referral commissions, promotions and new products are withheld from EEA users | S13 |
| CoinGecko context | "WOO X (Futures)", country Panama, 224 perpetual pairs, 0 dated futures, 24 h volume 81.25 BTC, open interest 253.19 BTC | S12 |

So a US person may not trade WOO X perpetuals, and neither may a resident of Canada, where this host's VPN exit sits.
The public API did not act on that.
Every public REST call and every public socket answered normally from the Canadian exit, see [`rest.md`](./rest.md) section 1.

How each source was read on 2026-09-22 local time:

- `support.woox.io/hc/...` article pages answered HTTP 403 with a Cloudflare "Just a moment..." challenge to curl, to WebFetch, and to one headless Chrome load.
- The same articles came back as JSON with HTTP 200 from `https://support.woox.io/api/v2/help_center/en-us/articles/<id>.json`, and the sitemap at `https://support.woox.io/hc/sitemap.xml` listed their ids.
- `https://woox.io/fees` is a script-rendered page, so the fee table was read from the public endpoint its bundle calls, `https://api.woox.io/holding-program/holdingsWooxPublic/allTierPerks`.
- The developer documentation at `https://developer.woox.io/` served Markdown to curl.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M linear perpetuals | 0 % (0 ppm) | 0.03 % (300 ppm) | S2, tier `"0"`: `"futuresMakerTradingFee":0`, `"futuresTakerTradingFee":0.03` |

The tier endpoint gives bare numbers with no unit.
They are read as percent, because a fraction would make the base futures taker 3 %, and this reading is an inference.
The help center fee article states no number and sends the reader to "All tier perks", which is the page this endpoint feeds, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 223 active on 2026-09-23 04:15 UTC | `GET /v3/public/instruments`, 223 `PERP_*_USDT` rows all `TRADING`, P1 |
| USDC-M perpetuals | no | no `PERP_*_USDC` row, P1 |
| coin-margined or inverse perpetuals | no | none listed, and the futures overview says perpetuals "are settled in USDT", S11 |
| dated futures | no | CoinGecko reports 0 futures pairs, S12, and the catalog has none, P1 |
| options | no | none listed, P1 |
| spot | yes, 88 USDT pairs and 2 USDC pairs | P1 |
| index perpetuals | named in the help center as "Index PERP", none recognisable in the catalog on 2026-09-23 | sitemap article `30746145140761--Index-PERP-Introduction`, not read |

A few perpetuals track equities or funds rather than tokens.
`PERP_SNDK_USDT` had an index of 1883.81 and `PERP_EWT_USDT` an index of 114.56, while the Energy Web Token that other venues list as EWT trades near one dollar.
So `EWT` names a different asset here, see [`rest.md`](./rest.md) section 2.

## 4. Perpetual tiers

### Fee per tier

Read from S2 on 2026-09-23 at 04:07:33 UTC, the reply's `timestamp` 1790136453276.

| tier | futures maker | futures taker | taker ppm | spot maker | spot taker |
|---|---|---|---:|---|---|
| 0 | 0 % | 0.03 % | 300 | 0 % | 0.06 % |
| 1 | 0 % | 0.027 % | 270 | 0 % | 0.048 % |
| 2 | 0 % | 0.021 % | 210 | 0 % | 0.036 % |
| 3 | 0 % | 0.015 % | 150 | 0 % | 0.03 % |
| 4 | 0 % | 0.012 % | 120 | 0 % | 0.024 % |
| 5 | 0 % | 0.009 % | 90 | 0 % | 0.018 % |

The March 2026 notice says "Trading fee rates (Maker/Taker) for each tier remain unchanged at this time", S3.

### Qualification

| tier | daily average WOO holdings | 30 day spot volume, USDT | 30 day futures volume, USDT |
|---|---|---|---|
| 1 | 1,000,000 WOO | 10,000,000 | 10,000,000 |
| 2 | 5,000,000 WOO | 50,000,000 | 50,000,000 |
| 3 | 20,000,000 WOO | 100,000,000 | 100,000,000 |
| 4 | 30,000,000 WOO | 200,000,000 | 200,000,000 |
| 5 | 50,000,000 WOO | 500,000,000 | 500,000,000 |

The table is from S3, effective 2026-03-28, and S4 repeats it.
S2 publishes the same holding thresholds as `tierThreshold` `{"0":0,"1":1000000,"2":5000000,"3":20000000,"4":30000000,"5":50000000}`.
S4 says users "qualify for My WOO when they meet these minimum holding and trading requirements" and that higher tiers give deeper discounts "even more when meeting higher volume requirements".
Whether a tier needs the holding and the volume together, or either one, is Not publicly specified.

Other rules from S1 and S4:

- Holdings are sampled hourly at a random time across spot wallet, vault, staking and yield farming, and averaged per UTC day.
- The tier updates daily at 00:00 UTC from the previous day's average, and the fee rate follows within 10 minutes of the volume refresh.
- Volume aggregates the main account and its sub-accounts, and excludes wash trades and liquidations.
- Perpetual fees are charged in USDT.

## 5. Discounts that change the perpetual taker

| discount | effect on the VIP 0 taker | source |
|---|---|---|
| WOO holding tier (My WOO) | tier 1 needs 1,000,000 WOO held on average, see section 4 | S2, S3, S4 |
| referral | CCXT carries a referral link with `'discount': 0.35` at `server/node_modules/ccxt/js/src/woo.js` line 157, which is CCXT's own referral metadata, not a WOO X schedule | S14 |
| referral in the EEA | "Referral features ... will be hidden for EEA-based users, and registration via referral codes is disabled for referees in the EEA" | S13 |
| market maker, Retail Price Improvement | RPI orders are "only available to designated market makers by invitation only", are post-only, and so always pay the maker fee | S9 |
| zero fee promotions | none found in the fee article or the tier notices | S1, S3 |

RPI matters more for this venue than any discount.
RPI orders "only match with retail orders", which S9 lists as GUI-initiated orders and copy user orders.
API orders are not on that list, so an API taker cannot fill against RPI orders, and this reading is an inference from S9.
On 2026-09-23 the book an API taker can reach was 3,652 to 6,140 ppm wide on BTC and ETH while the book with RPI was 11 to 36 ppm wide, see [`rest.md`](./rest.md) section 5.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `Funding Rate = clamp[ average premium index / (8/N), funding cap, funding floor]`, N the symbol's funding interval in hours | S7 |
| premium index | `[(impact bid price + impact ask price) / 2 - index price] / index price`, sampled every 5 seconds | S7 |
| impact notional | per symbol `impactNotional`: 2,000 USDT on 140 perps, 1,000 on 54, 200 on 15, 100 on 11, 10,000 on 2, 5,000 on 1 | P1 |
| interval | 4 h on 149 perps and 8 h on 74, per symbol `fundingIntervalHours` | P1 |
| cap and floor | `fundingCap` and `fundingFloor` per symbol: ±0.02 on 202 perps, ±0.00375 on 8, ±0.0075 on 4, ±0.004875 on 3, ±0.003 on 2, ±0.0045 on 1 | P1 |
| charge | `Funding fee = Funding rate * Position notional = Funding rate * Holding * Mark price`, exchanged between longs and shorts, settled in USDT | S7 |
| who pays | holders of a position at the settlement instant, for 8 h symbols at 00:00, 08:00 and 16:00 UTC | S7 |

The published rates do not follow the documented formula alone.
190 and 188 of 223 upcoming rates in the two runs, and 188 of 223 last settled rates in both, were exactly 0.0001 × N / 8, that is 0.01 % per 8 h or 0.005 % per 4 h, P2.
A clamp of a premium average does not land on one value that often, so an unpublished baseline term is likely, and it is Not publicly specified.

Three perpetuals publish a positive floor equal to the cap, `0.02/0.02`: `PERP_SNDK_USDT`, `PERP_GRAM_USDT` and `PERP_EWT_USDT`.
Their published rates sat far below that floor, for example `-0.0000772` and `-0.00006101` on SNDK in the two runs, so the floor is not applied as written on them, P2.

The settlement instant itself was not captured.
The funding history shows BTC settled at 00:00, 08:00 and 16:00 UTC and TAO every 4 h from 00:00 UTC, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| event | charge | source |
|---|---|---|
| liquidation stage I, hedge netting | "Taker fees will be charged on both sides based on the user's fee rates." | S8 |
| liquidation stage II, market liquidation | "A trading fee of 0.1% will be charged and collected by the insurance fund." | S8 |
| liquidation stage III, liquidator takeover | "A liquidator fee of ACMM / 3 will be charged by liquidators." | S8 |
| unrealised PnL settlement | every 10 minutes when the absolute unrealised PnL is at least 10 USDT, no fee stated | S7 |
| collateral auto-conversion | "0.1% trading fee will be charged for the settlement" | S7 |
| delisting | open positions settle at "the average index prices (updated every second) in the last hour before the delisting time", no fee stated | S10 |
| ADL | "No additional trading fees will be incurred during the ADL process." | S8 |

Deposit and withdrawal schedules are out of scope, and the official lookup is the `token_network` public call, `GET /v3/public/tokenNetwork`.

## 8. CCXT

| item | value |
|---|---|
| class | `woo`, CCXT 4.5.68 |
| `market.taker` on every swap without credentials | `0.0005`, 500 ppm, on 223 of 223 swaps in both runs, P1 |
| `market.maker` | `0.0002`, 200 ppm, on 223 of 223 |
| source line | `server/node_modules/ccxt/js/src/woo.js` lines 336 to 342, `'fees': {'trading': {'tierBased': true, 'percentage': true, 'maker': this.parseNumber('0.0002'), 'taker': this.parseNumber('0.0005')}}`, the taker at line 341 |
| per market override | none, `parseMarket` at lines 759 to 845 sets no `taker` or `maker` |

CCXT's constant is 500 ppm while the published VIP 0 futures taker is 300 ppm, and the published maker is 0 against CCXT's 200 ppm.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 300 | the tier 0 futures taker, S2 |
| `ccxtTakerPpm` | 500 | the constant at `server/node_modules/ccxt/js/src/woo.js` line 341, so the connector warns only if a later CCXT release changes it |

A recommendation for a later design, not a decision.
The taker fee is the smaller cost on this venue, because the book an API taker can fill against is thousands of ppm wide, see [`rest.md`](./rest.md) section 5.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ▶ Trading Fees, edited 2026-05-18 | https://support.woox.io/hc/en-us/articles/29498930698777--Trading-Fees, read as `https://support.woox.io/api/v2/help_center/en-us/articles/29498930698777.json` | 2026-09-22 | WOO X, global | fee drivers, "All tier perks", fee currency, volume refresh, sections 2, 4, 5 |
| S2 | holding program tier perks, public API | https://api.woox.io/holding-program/holdingsWooxPublic/allTierPerks | 2026-09-22 | WOO X, global | fee per tier, tier thresholds, sections 2, 4 |
| S3 | WOO X VIP Tier Requirements and Fee Program Optimisation, March 26, 2026 | https://support.woox.io/hc/en-us/articles/56371176012185 | 2026-09-22 | WOO X, global | tier requirements, fees unchanged, section 4 |
| S4 | ▶ My WOO, edited 2026-03-26 | https://support.woox.io/hc/en-us/articles/44469977475481--My-WOO | 2026-09-22 | WOO X, global | holding calculation, KYC level 1, section 4 |
| S5 | ▶ List of unsupported countries/regions, edited 2025-07-31 | https://support.woox.io/hc/en-us/articles/4403838052761 | 2026-09-22 | WOO X, global | excluded regions, section 1 |
| S6 | ▶ Terms of Services, edited 2025-07-31 | https://support.woox.io/hc/en-us/articles/4403851854233--Terms-of-Services | 2026-09-22 | WOOTECH Limited | operator, United States exclusion, Panama law, section 1 |
| S7 | ▶ Funding rate and Settlement, edited 2025-10-28 | https://support.woox.io/hc/en-us/articles/4719603299737 | 2026-09-22 | WOO X, global | funding formula, charge, settlement, section 6 and 7 |
| S8 | ▶ Liquidation, ADL and insurance fund | https://support.woox.io/hc/en-us/articles/4719450837017 | 2026-09-22 | WOO X, global | liquidation charges, section 7 |
| S9 | ▶ Retail Price Improvement (RPI) Order | https://support.woox.io/hc/en-us/articles/48855786213913 | 2026-09-22 | WOO X, global | RPI matching and eligibility, section 5 |
| S10 | WOO X will delist one perpetual trading pair on Aug 28, 2026 | https://support.woox.io/hc/en-us/articles/61647742097177 | 2026-09-22 | WOO X, global | delisting settlement, section 7 |
| S11 | ▶ Futures Overview, updated 2025-03-04 | https://support.woox.io/hc/en-us/articles/4718422102937--Futures-Overview | 2026-09-22 | WOO X, global | USDT settlement, section 3 |
| S12 | CoinGecko derivatives exchange `woo_network_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/woo_network_futures | 2026-09-22 | CoinGecko | pair count, volume, country, section 1 |
| S13 | EU Regulations Compliance: Key Restrictions for EEA Users on WOO X, edited 2025-10-23 | https://support.woox.io/hc/en-us/articles/41423943968409 | 2026-09-22 | WOO X, EEA | EEA restrictions, section 1 and 5 |
| S14 | CCXT 4.5.68 `woo.js` | `server/node_modules/ccxt/js/src/woo.js` | 2026-09-22 | CCXT | fee constants, referral metadata, sections 5 and 8 |
| P1 | `rest-probe.mjs catalog`, runs at 04:15 and 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/woo/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog, funding parameters, CCXT fees, sections 3, 6, 8 |
| P2 | `rest-probe.mjs anchor`, runs at 04:15 and 04:33 UTC, with the saved first poll | [`rest-probe.mjs`](../../../scripts/probes/venues/woo/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | published rates against the baseline, section 6 |
