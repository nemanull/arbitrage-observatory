# WhiteBIT Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers perpetual trading on WhiteBIT (CCXT id `whitebit`), and nothing else.
Spot, margin, deposit, withdrawal and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/whitebit/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/whitebit/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entity of the global platform | Not publicly specified in any page this research could read. CCXT lists the country as `EE`, CoinGecko lists WhiteBIT as Lithuania, and a third-party summary names UAB Clear White Technologies of Lithuania | Not publicly specified | S15 line 24, S14, S9 |
| derivatives entity in Georgia | "WhiteBIT Broker", licensed by the National Bank of Georgia in April 2026 for "crypto derivatives trading, including perpetual futures, in the Georgian market" | Published | S6 |
| United States | "WhiteBIT is not currently available in the US. Services will be accessible upon regulatory approval.", from the terms of WhiteBIT US, Inc., last modified 2025-06-19 | Published | S5 |
| restricted jurisdictions, first party | the developer documentation says "For a current list of restricted and prohibited jurisdictions, contact compliance@whitebit.com" | Not publicly specified | S4 |
| restricted jurisdictions, third party | a list of about thirty, among them the United States and its territories, the United Kingdom, Canada, Russia, Belarus, Iran and North Korea, attributed to WhiteBIT's identity verification article | Not verified | S9 |
| region gate in the API | the docs name HTTP 451 `api.futures.unavailable` on `/futures` and `/collateral/markets` "when the service is not available in the caller's region", and TradFi perpetuals "are region-gated and omitted from the response entirely where not available" | Published | S2, S16 |
| region gate from this host | `/collateral/markets` answered HTTP 451 `{"errors":[],"message":"Margin trading is not available in your country.","success":false}`, while `/futures`, `/markets` and `/ticker` answered 200 and `/markets` listed all 93 TradFi perpetuals | Probed | `rest-probe.mjs main`, tags `access` and `markets_reply` |
| where Cloudflare places this host | `loc=CA` in all four runs, with `colo=YVR` three times and `colo=SEA` once, from `https://www.cloudflare.com/cdn-cgi/trace` | Probed | `rest-probe.mjs main`, tag `access_geo` |
| website from this host | every `whitebit.com`, `blog.whitebit.com` and `help.whitebit.com` page tried answered HTTP 403 with a Cloudflare page titled "Security check" and the header `cf-mitigated: challenge`. `institutional.whitebit.com/market-making-program` answered 200 | Probed | `curl` and `rest-probe.mjs main`, tag `access_site` |
| website through a fetch that does not originate here | HTTP 403 on S7, the blog page of S8, the fee schedule, the terms, the AML policy and two help center articles | Probed | WebFetch on 2026-09-22 |
| who may trade the perpetuals | an account holder outside the restricted jurisdictions. A person in the United States may not | Region-specific | S5, S9 |

The fee page, the VIP page, the terms and the help center refuse this host and the fetch alike, so their numbers below come from search engine extracts and are labelled Not verified.
The Market-Making Program page on `institutional.whitebit.com` did answer, and it is the one first-party page with futures rates, S18.
The developer documentation at `docs.whitebit.com` answered this host with HTTP 200 and is the first-party source used wherever it covers a point.
The region gate is enforced on the margin catalog and not on the futures catalog, since `/collateral/markets` refused this host with 451 while `/futures` served it.
Reading public market data is not an account service, and neither the API nor the socket challenged this host.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined crypto perpetuals (`_PERP`, type `futures`) | 0.01 % = 100 ppm | 0.055 % = 550 ppm | Published by the API, Probed | `/markets` field `makerFee` `"0.01"` and `takerFee` `"0.055"` on 304 of 304 rows, documented as "Default maker fee as a percentage value" and "Default taker fee as a percentage value" in S1 |
| USDT-margined TradFi perpetuals (`_PERP`, type `tradfiFutures`) | 0.01 % = 100 ppm | 0.055 % = 550 ppm | Published by the API, Probed | same fields on 93 of 93 rows |

A search engine extract of the fee page reads "The standard trading fees for futures contracts are 0.055% for takers and 0.01% for makers", which agrees with the API, see S7.
The engine models a taker cross at the base retail tier, so 550 ppm is the number that matters for every WhiteBIT perpetual.
Spot rows in the same reply carry `"0.1"` for both, which is 1,000 ppm, and do not concern this profile.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USDT-margined crypto perpetuals | yes | 304 | Probed, `/markets` type `futures` and `/futures` |
| USDT-margined TradFi perpetuals (stocks, ETFs, metals, energy) | yes, region-gated | 93 | Probed, `/markets` type `tradfiFutures` and `/futures` |
| all perpetuals in `/futures` | yes | 397, all `product_type` `Perpetual` and `money_currency` `USDT` | Probed, `/futures` |
| coin-margined (inverse) perpetuals | Not offered | 0 | Probed, no `/futures` row settles in anything but USDT, and CCXT sets `inverse` false on every swap at `server/node_modules/ccxt/js/src/whitebit.js` line 511 |
| USDC-margined perpetuals | Not offered | 0 | Probed, same reply |
| dated futures | Not offered | 0 | the docs say `product_type` is "Currently always `Perpetual`", S2, and CCXT sets `future` false at line 32 |
| options | Not offered | 0 | CCXT `option` false at line 33, and no options endpoint in the docs index |
| spot | yes, not detailed | 802 | Probed, `/markets` type `spot` |
| margin on spot pairs | yes, not detailed | pairs with `isCollateral` true, and `/collateral/markets` refused this host with 451 | Probed |

CoinGecko's derivatives list showed "WhiteBIT Futures" with 398 perpetual pairs on 2026-09-22, one more than the 397 rows of `/futures` read the same day, see S14.
The premium index socket pushed 404 records, the 397 plus `HOOK_PERP`, `MKR_PERP`, `OMNI_PERP`, `RDNT_PERP`, `IP_PERP`, `ICX_PERP` and `PI_PERP`, which no REST catalog lists, see [`websocket.md`](./websocket.md) section 2.
Spot, margin, deposit and withdrawal fees are looked up at `GET /api/v4/public/fee` for transfers and on the fee page `https://whitebit.com/trading-data/trading-fees`, which refuses this host.

## 4. Perpetual tiers

The tier table is on `https://whitebit.com/trading-data/trading-fees` and `https://whitebit.com/vip-program`, and both answered HTTP 403 to this host and to the fetch, see section 1.
No per-level futures table could therefore be read, and none is reproduced.

The Market-Making Program page, which answered, publishes the ends of the futures range, S18.

| claim | text on the page | label |
|---|---|---|
| futures market maker floor | "Futures fee rates \| -0.012% \| Maker lowest \| 0.025% \| Taker lowest" | Published |
| best VIP rate, product not named | "VIP customers may benefit from rebates of up to -0.001% for makers and as low as 0.03% fees for takers." | Published |
| ceiling | "Trading fees on WhiteBIT do not exceed 0.1%." | Published |

The same page's FAQ also writes the futures market maker rates as "-0.012% for makers and-0.025% for takers", a negative taker that contradicts its own table, and the table is taken as the intended figure.

What search engine extracts of the refused pages say, labelled Not verified:

| claim | text of the extract | source |
|---|---|---|
| qualification | the VIP level is set by "trading volume for 30 days and account balance, both of which are calculated in USDT equivalent." | S8 |
| futures thresholds | "the volume requirements for futures trading will differ, with higher trading volumes required on the futures market to reach the same VIP levels compared to spot and margin markets." | S8 |
| futures floor | "To keep VIP status, the minimum trading volume on futures market must be equal to or exceed 5,000,000 USDT." | S8 |
| best VIP rate | "discounts that can reach as low as -0.001% for makers and 0.03% for takers" | S8 |

The developer documentation confirms only that "Maker-fee rebates are tiered by 30-day rolling volume, with separate breakpoints for spot and futures", and it does not restate the rates, see S10.
The `/markets` reply publishes one default rate per market and no tier, so the VIP 0 row and the floors of S18 are the only futures rates this research verified.

## 5. Discounts that change the perpetual taker

| discount | what it does | label | evidence |
|---|---|---|---|
| WBT holding | "By holding our native exchange’s coin, WBT, maker fees can be reduced by up to 100% and taker fees by up to 90%." A search extract of the fee page says "up to 80% for takers and up to 100% for makers" for WBT in Owning, applied "to the base fees for both spot and futures markets", the most favourable discount winning when several apply | Published at 90 %, and 80 % Not verified | S18, S7, S8 |
| VIP program | lower rates by 30-day volume and balance, see section 4 | Not verified | S8 |
| Market-Making Program | maker rebates tiered by 30-day volume down to a maker of -0.012 % and a taker of 0.025 % on futures, confirmed individually at onboarding | Negotiated | S10, S18 |
| RPI maker premium | "an additional fee component applied on top of the maker rate when a Retail Price Improvement (RPI) order executes", field `futures_rpi_maker_fee_premium` on the private fee call | Account-gated, maker only | S11, 2026-07-23 entry |
| per-account fee | `POST /api/v4/market/fee` returns "the account's default fees and every custom override" | Account-gated | S11, 2026-08-19 entry |
| zero-fee promotion on perpetuals | none found in the documentation changelog read on 2026-09-22 | Not publicly specified | S11 |

A discount lowers the taker for the account that holds it, and the engine's base retail tier stays at 550 ppm.

## 6. Funding as a cost

No page this research could read publishes the funding formula, the interest term or the premium sampling.
The help center article "WhiteBIT Futures" holds it and refused this host and the fetch, and a search extract of it says only that "funding is calculated every 8 hours, but this interval may change to a different one on each futures contract", see S17.

| item | documented | probed | evidence |
|---|---|---|---|
| who pays | "Positive rate = longs pay shorts (contract price above index). Negative rate = shorts pay longs." | | S3 |
| interval | "The `funding_interval_minutes` field ... returns the cadence for each pair" | 480 minutes on 173 perpetuals and 240 on 224, in all four reads | S3, `rest-probe.mjs main`, tag `futures_reply` |
| next settlement | `next_funding_rate_timestamp`, "Unix timestamp in milliseconds of the next funding settlement" | all 397 read `"1790121600000"`, 2026-09-23 00:00 UTC, at 21:34, 21:47, 22:02 and 22:08 UTC | S2, same tag |
| published rate | `funding_rate`, "Predicted funding rate for the next settlement interval. Fluctuates in real time until settlement occurs." | the rate changed at most once a minute on the contracts tracked, on a step of the mark, see [`rest.md`](./rest.md) section 4 | S2 |
| cap and floor | `funding_cap` and `funding_floor`, "Upper bound that the funding rate can reach for the market", added 2026-07-29 | `±0.02` on 378 perpetuals, `±0.0075` on 6, `±0.00375` on 13 including `BTC_PERP`, `ETH_PERP` and `SOL_PERP` | S2, S11, same tag |
| rate on the socket | the premium index channel documents the rate "in the range -0.1 to 0.1 with up to 16 decimal places" | | S12 |
| settled history | `GET /api/v4/public/funding-history/{market}` with `fundingTime`, `fundingRate`, `settlementPrice` ("Mark price ... at the time of funding settlement") and `rateCalculatedTime` ("The rate is computed before the actual settlement") | on `BTC_PERP` 100 rows, 28,800 s apart, and `rateCalculatedTime` exactly 28,800 s before `fundingTime` on all 100 | S13, tag `funding_history` |
| which rate is charged | the settled row's `rateCalculatedTime` is one interval before `fundingTime` | Not captured, since the only settlement in reach was at 00:00 UTC, after the probing window, see [`rest.md`](./rest.md) section 4 | S13 |
| fee on the position | Not publicly specified in the pages read | | |

The last 100 `BTC_PERP` settlements read exactly `"0.0001"`, 0.01 % per 8 h, on 42 rows, and no row was higher, while the lowest was `-0.00010702`.
That cluster fits an interest term of 0.01 % per 8 h that the rate sits on while the premium is small, and it is an inference, because no readable page states the formula.
The rate is a fraction per interval, so a 240 minute contract publishes a rate for 4 h and not an 8 h equivalent.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation price | "Mark price (not last traded price) is used for liquidation calculations." Partial liquidation first, then full | Published | S3 |
| maintenance margin | a maintenance margin rate of 3 % for leverage from 1x to 10x, with per-market brackets on a page that refuses this host | Published | S3 |
| liquidation fee | Not publicly specified in the pages read | Not publicly specified | |
| auto-deleveraging | the final stage, which closes profitable opposite positions at a price derived from the last price | Published | S19 |
| perpetual settlement fee | none, perpetuals do not expire | | |
| delisting | `delistedAt` on `/markets` gives the announced date. "once the delisting runs, the platform cancels the active orders on the market and drops the market from the response" | Published | S11, 2026-07-28 entry |
| delisting seen on the wire | `STG_PERP` with `delistedAt` 2026-09-23 09:30 UTC | Probed | tag `markets_reply` |
| what happens to open positions at a delisting | Not publicly specified in the pages read | Not publicly specified | |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, `ccxt.version` |
| `market.taker` on every active swap without credentials | `0.00055` on 304 of 304 | Probed, `rest-probe.mjs main`, tag `ccxt` |
| where it comes from | the reply's own `takerFee` divided by 100, `const taker = Precise.stringDiv(takerFeeRate, '100')` | `server/node_modules/ccxt/js/src/whitebit.js` lines 516 and 517, set on the market at line 540 |
| `market.maker` | `0.0001` on 304 of 304, from `makerFee` the same way | lines 518, 519 and 541 |
| the exchange-level fee block | `'taker': this.parseNumber('0.001')` and `'maker'` the same, which no swap market uses because `parseMarket` sets its own | lines 291 to 298 |
| TradFi perpetuals | `parseMarket` sets `swap` only when `type === 'futures'`, so the 93 `tradfiFutures` rows load as `spot` markets such as `XAU/USDT` | line 497, Probed, tag `ccxt` |

The CCXT number is 550 ppm and equals the published VIP 0 perpetual taker.
Because CCXT reads the reply rather than a literal, it follows WhiteBIT the day the default rate changes.
The connector compares CCXT's number to `ccxtTakerPpm` or, when that is unset, to `takerPpm`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 38.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

```ts
whitebit: {
  takerPpm: 550,
  // ccxt/js/src/whitebit.js:517 divides each market's takerFee by 100, "0.055" on all 304 perpetuals on 2026-09-22, so the connector warns the day WhiteBIT changes the default.
  contractSize: 1,
  // ccxt/js/src/whitebit.js:501 copies the amount step into contractSize (0.001 on BTC_PERP, 1,000,000 on PEPE_PERP), while books and volumes are in base coins.
}
```

`takerPpm: 550` is the default taker the API publishes for every perpetual, S1.
`ccxtTakerPpm` stays unset, because CCXT reads the same field and reports 550 ppm, so the connector's warning fires only if the reply changes.
`contractSize: 1` is the named change this venue needs, and [`rest.md`](./rest.md) section 2 holds the evidence.
No `marketFilter` is needed, since CCXT loads the TradFi perpetuals as spot and the connector keeps swaps only.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Market info, `GET /api/v4/public/markets` | https://docs.whitebit.com/api-reference/market-data/market-info.md | 2026-09-22 | WhiteBIT, global | `makerFee` and `takerFee` as default percentages, `stockPrec`, `stepSize`, `delistedAt`, sections 2 and 8 |
| S2 | Available futures markets list, `GET /api/v4/public/futures` | https://docs.whitebit.com/api-reference/market-data/available-futures-markets-list.md | 2026-09-22 | WhiteBIT, global | funding fields, cap and floor, HTTP 451, sections 1, 3 and 6 |
| S3 | Futures Trading overview | https://docs.whitebit.com/products/futures/overview.md | 2026-09-22 | WhiteBIT, global | funding direction and interval, liquidation, MMR, sections 6 and 7 |
| S4 | Regulatory Compliance | https://docs.whitebit.com/institutional/compliance.md | 2026-09-22 | WhiteBIT, EEA and global | restricted list only on request, section 1 |
| S5 | WhiteBIT US, Inc. Terms of Use, last modified 2025-06-19 | https://coming-soon.whitebit.us/terms-of-use | 2026-09-22 | WhiteBIT US, Inc., United States | not available in the US, section 1 |
| S6 | WhiteBIT Secures Broker License in Georgia, 2026-04-07 | https://www.globenewswire.com/news-release/2026/04/07/3269336/0/en/WhiteBIT-Secures-Broker-License-in-Georgia.html | 2026-09-22 | WhiteBIT Broker, Georgia | Georgian derivatives entity, section 1 |
| S7 | Trading fees and Trading rules, refused, read as a search engine extract | https://whitebit.com/trading-data/trading-fees | 2026-09-22 | WhiteBIT, global | futures 0.055 % and 0.01 %, WBT discount, sections 2 and 5 |
| S8 | VIP program pages and "Trading Fees on WhiteBIT", refused, read as search engine extracts | https://whitebit.com/vip-program and https://blog.whitebit.com/en/whitebit-trading-fee/ | 2026-09-22 | WhiteBIT, global | VIP qualification and rates, sections 4 and 5 |
| S9 | WhiteBIT Perpetuals Restricted Countries List, a third party, dated 2026-07-25 | https://www.coinperps.com/learn/whitebit-restricted-countries | 2026-09-22 | third party | restricted list and entity names, section 1 |
| S10 | Market-Making Program overview and FAQ | https://docs.whitebit.com/guides/market-maker-overview.md | 2026-09-22 | WhiteBIT, global | maker rebates tiered by volume, sections 4 and 5 |
| S11 | Changelog | https://docs.whitebit.com/changelog.md | 2026-09-22 | WhiteBIT, global | funding cap and floor, mark price, delisting, RPI premium, sections 5 to 7 |
| S12 | Premium index channel | https://docs.whitebit.com/websocket/market-streams/premium-index.md | 2026-09-22 | WhiteBIT, global | rate range, section 6 |
| S13 | Funding history, `GET /api/v4/public/funding-history/{market}` | https://docs.whitebit.com/api-reference/market-data/funding-history.md | 2026-09-22 | WhiteBIT, global | history fields, section 6 |
| S14 | CoinGecko derivatives exchanges and exchange API | https://api.coingecko.com/api/v3/derivatives/exchanges | 2026-09-22 | CoinGecko | 398 perpetual pairs, country, section 3 |
| S15 | CCXT 4.5.68 `whitebit.js` | `server/node_modules/ccxt/js/src/whitebit.js` | 2026-09-22 | CCXT | fees, catalog mapping, sections 1, 3 and 8 |
| S16 | Markets and Trading Pairs concept | https://docs.whitebit.com/concepts/markets.md | 2026-09-22 | WhiteBIT, global | TradFi region gate and account permission, section 1 |
| S17 | WhiteBIT Futures help article, refused, read as a search engine extract | https://help.whitebit.com/hc/en-gb/articles/14308839429661-WhiteBIT-Futures | 2026-09-22 | WhiteBIT, global | funding interval wording, section 6 |
| S18 | Crypto Market-Making Program | https://institutional.whitebit.com/market-making-program | 2026-09-22 | WhiteBIT, global | futures market maker and VIP floors, fee ceiling, WBT discount, sections 4 and 5 |
| S19 | Auto-Deleveraging concept | https://docs.whitebit.com/concepts/auto-deleveraging.md | 2026-09-22 | WhiteBIT, global | ADL at a price from the last price, section 7 |
| P1 | `rest-probe.mjs main`, 21:34, 21:47, 22:02 and 22:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/whitebit/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 3 and 6 to 8 |
