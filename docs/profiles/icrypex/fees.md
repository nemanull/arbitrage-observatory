# Icrypex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:58 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers ICRYPEX (www.icrypex.com), which CoinGecko lists as "Icrypex", Turkey, established 2018.
CCXT 4.5.68 has no class for it, and neither does CCXT master, section 8.
CoinGecko's derivatives list does not show it, yet the venue's own catalog lists 53 pairs whose `marketTypes` is `PERPETUAL`, spelled like `BTCUSDT/P`, see [`rest.md`](./rest.md) section 2.
So this profile researches that perpetual family, and names spot only in the coverage matrix.
The venue calls the product "ICRYPEX Futures" and describes it as borrowing from ICRYPEX to hold a leveraged position, with "funding" being interest on the borrowed funds, section 6.
The official documentation is the GitHub repository `icrypex-glb/apidoc`, S1, which covers spot only.
Everything about the perpetual product comes from the web app's own JavaScript bundles, S2 to S6, and from the public API, P1 and P2.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator of www.icrypex.com | "Icrypex S.A. de C.V." in the Russian text of the usage agreement, and "an online exchange for Digital Assets trading in El Salvador" regulated under Article 19 of the Digital Assets Law of El Salvador in the English text | S5 |
| registrations the site claims | Banco Central de Reserva of El Salvador for Bitcoin services, and licences in Poland, Lithuania and Bulgaria | S3 |
| Turkish sister site | www.icrypex.com.tr with its own API host `api.icrypex.com.tr`, which returned 0 pairs, 0 tickers and 404 on `/v1/future/info` to this host, so it lists no perpetuals | P3 |
| CoinGecko record | "Icrypex", Turkey, 2018, URL `https://www.icrypex.com/en`, trust score 5, trust score rank 101 when read during this probe window, 24 h volume 365 BTC, 100 tickers all quoted in USDT | S8 |
| eligibility | 18 or older, not a Restricted Person, and not located, incorporated or resident in a jurisdiction where use is illegal or in "ICRYPEX List of Prohibited Countries" | S5 |
| regions named as high risk | Cuba, Iran, North Korea, Syria and the Crimea region, plus persons on US, UK, EU or UN sanctions lists | S5 |
| prohibited country list | Not publicly specified. The list is named in the agreement and was not found in any bundle or public endpoint | S5 |
| United States persons | not named as excluded anywhere found. The registration form offers United States as a nationality, and omits AF, CU, IR, KP, SY, SD, SS and IQ | S7 |
| who may trade the perpetuals | Not publicly specified beyond the eligibility above. The web app fetches the funding rate only when its `isGlobal` flag is set, and the Turkish API has no futures endpoint | S4, P3 |
| automated access | the usage agreement forbids "bots, spiders or other automatic devices" to "access, obtain, copy or monitor any part of the platform", while the site advertises an API for developers | S5, S3 |
| access from this host | every public REST call and the WebSocket answered, with no refusal, through the Canadian VPN exit, see [`rest.md`](./rest.md) section 1 | P1 |

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT perpetual (`/P`), published Beginner level, 0 to 150,000 USDT a month | 0.20 %, 2,000 ppm | 0.25 %, 2,500 ppm | fee page table, S6 |
| USDT perpetual, published "Individual API Customers" row | 0.35 %, 3,500 ppm | 0.35 %, 3,500 ppm | S6 |
| USDT perpetual, live level 1 from `GET /v1/trades/fees` | 0 | 0 | P1 at 04:43 UTC and P2 at 04:57 UTC |

The fee page table has no separate perpetual schedule, and the futures FAQ links to that same page for "ICRYPEX Futures Transaction Fee Information", S3.
The live fee levels carry one row per level with `pairSymbol` `"*"`, so they do not split spot from perpetual either.
The live zero matches the zero fee campaign in section 5, whose stated end date has passed.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetual, `marketTypes` `PERPETUAL` | yes, 53 pairs, all `Running` | P1 |
| of which crypto bases | 23: SOL, AVAX, ETH, BTC, XMR, ARB, RENDER, TRUMP, XRP, SUI, PEPE, HYPE, DOGE, S, ADA, ALGO, XAUT, LTC, ENA, LINK, APT, ETHFI, LDO | P1, asset `categories` |
| of which synthetic bases | 30: 12 `FX / INDEX`, 12 `EQUITIES`, 2 `COMMODITIES`, 2 `RWA` and 2 tagged `STABLECOIN` (XAGX silver, OILX oil) | P1 |
| USDC or coin-margined perpetuals | absent | P1 |
| dated futures | absent | P1 |
| options | absent | P1 |
| spot | present, 157 pairs: 151 quoted in USDT and 6 in ICPX, 144 `Running` and 13 `CancelOnly` | P1 |
| margin | the perpetual is itself a borrow product, and the order API takes `insertType` `DEFAULT`, `BORROW` or `REPAY` | S1, S3 |

## 4. Perpetual tiers

The fee page renders this table from constants in its own bundle, S6.

| level | monthly trading volume | maker | taker |
|---|---|---|---|
| Beginner | 0 to 150,000 USDT | 0.20 % | 0.25 % |
| Intermediate trader | 150,001 to 250,000 USDT | 0.18 % | 0.22 % |
| Advanced trader | 250,001 to 1,000,000 USDT | 0.15 % | 0.20 % |
| Professional trader | 1,000,001 to 5,000,000 USDT | 0.12 % | 0.18 % |
| Institutional trader | 5,000,001 to 10,000,000 USDT | 0.10 % | 0.15 % |
| VIP trader | 10,000,001 USDT and higher | 0.08 % | 0.10 % |
| Individual API customers | none | 0.35 % | 0.35 % |

The same page calls `GET /v1/trades/fees`, P1, which returned six levels with the same volume bounds up to 10,000,000 USDT and 0 maker and 0 taker on every level.
The Turkish site's `GET https://api.icrypex.com.tr/v1/trades/fees` returned nine different levels, starting at 0.25 % maker and 0.35 % taker below 1,000,000, P3.
The account's own level comes from `GET /v1/accounts/fee-level`, which answered 401 with `www-authenticate: Bearer`, P1.
The table heading is "Trading Volume (Monthly)", and the qualification rule beyond that is Not publicly specified.
The futures trade conditions notice says "ICRYPEX reserves the right to modify leverage ratios, trading fees, margin requirements, and other trading conditions for futures pairs in accordance with market conditions", S3.

## 5. Discounts that change the perpetual taker

| discount | terms | source |
|---|---|---|
| zero fee campaign | "ICRYPEX users will not pay any comission fees on buy and sell transactions until 20.08.2026. This applies to all crypto transactions, including spot trading, staking, farming, and futures." The terms say it starts 08.11.2024 and ends 20.08.2026 | S3 |
| live state of that campaign | `GET /v1/trades/fees` still returned 0 maker and 0 taker on all six levels on 2026-09-23 UTC, 34 days after the stated end | P1, P2 |
| ICPX token holding | "The more ICPX Tokens you hold, the greater the discount on your fees", with a level table whose amounts and percentages are template placeholders filled at run time. The numbers were not found in any public reply | S3 |
| referral | a referral program exists, "only users who have registered with their TC ID number can benefit" | S3 |
| market maker | Not publicly specified | |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| what it is | "Interest payment on borrowed funds while the position is open, made three times daily." | S3, `OPEN_POSITIONS_FUNDING_INFO` |
| interval | "calculated every 4, 8, 12, and 24 hours and applied to open positions" in the FAQ, and three times daily in the position help text | S3 |
| who sets it | "This rate is announced by ICRYPEX and applies to all open positions at the specified date and time. The rate applied can be positive or negative." | S3 |
| formula | Not publicly specified. No premium index or basket is published, see [`rest.md`](./rest.md) section 4 | |
| cap and floor | Not publicly specified | |
| where the rate is read | the web app reads `fundingRate` from `GET /v1/future/get-future-settings?pairSymbol=BTCUSDT/P&positionSide=LONG`, which answered 401 `Bearer` to an anonymous call | S4, P1 |
| next settlement shown in the web app | a countdown to the next multiple of 8 h after the browser's local midnight, computed in the browser and not read from the server | S4 |
| per position record | positions carry `fundingFee` and `fundingFeeCount`, so the charge is booked per position | S2 |

The settlement instant itself was not captured, and no public funding history endpoint was found, so when the charge lands and whether both sides pay is Not publicly specified.

## 7. Liquidation, settlement and delisting

- Liquidation price is "The price at which assets can cover the borrowed amount. When the pair's mark price reaches this, the system closes the position.", S3.
- The positions screen prints the pair's ticker `price`, the last trade, under the "Mark Price" label, S9, so the mark that triggers liquidation appears to be the last price of the `/P` pair.
- Liquidation is driven by "Liquidation Risk Ratio", defined as Position Size over Borrow Size, and a lower "Margin Call Ratio" alert, with per pair thresholds and a maximum leverage in a "Future Pairs Trade Conditions" table, S3.
- A liquidation fee, a settlement fee and a delisting procedure are Not publicly specified.

## 8. CCXT

- `node -e "console.log(require('ccxt').exchanges)"` run from `server/` lists 104 ids for CCXT 4.5.68, and none matches `icr` or `crypex`, P1.
- `server/node_modules/ccxt/js/src/` holds no Icrypex file.
- The GitHub listing of `ts/src` on the `master` branch at commit `1d8b674434fde39ef282988b066812adf8d19b9e`, committed 2026-09-22 12:48 UTC, holds 105 TypeScript files and none for Icrypex, and `ts/src/pro` holds none either, S10.
- So `market.taker` cannot be read for any Icrypex market, and there is no source line to cite.

## 9. Recommended registry values

No registry entry is recommended, because the venue has no CCXT class, no public mark, index or funding, and a borrow product rather than a premium-anchored perpetual, see [`rest.md`](./rest.md) section 8.
If it were ever wired in, `takerPpm` should be 3,500, the published "Individual API Customers" rate, because an engine trades through the API and the live zero is a campaign past its stated end.
`ccxtTakerPpm` has no value, since no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Icrypex API Documentation, repository `icrypex-glb/apidoc`, last pushed 2025-04-29 | https://github.com/icrypex-glb/apidoc | 2026-09-22 | ICRYPEX, global | spot REST, order `insertType`, sections 3 and 4 |
| S2 | web app main bundle | https://www.icrypex.com/main.345fafe890bea77b.js | 2026-09-22 | www.icrypex.com | API host, socket host, futures endpoints, position fields, section 6 |
| S3 | web app English strings | https://www.icrypex.com/521.56180672de06cc99.js | 2026-09-22 | www.icrypex.com | futures FAQ, funding text, zero fee campaign, ICPX discount, licences, API link, trade conditions, sections 1 to 7 |
| S4 | web app pair ticker component | https://www.icrypex.com/6063.39d9d02dbe19b9b2.js | 2026-09-22 | www.icrypex.com | `getFutureSettings`, `isGlobal`, 8 h countdown, sections 1 and 6 |
| S5 | web app legal texts, usage agreement | https://www.icrypex.com/4965.fdc51c8856eeb59a.js | 2026-09-22 | Icrypex S.A. de C.V., El Salvador | operator, eligibility, high risk jurisdictions, automation clause, section 1 |
| S6 | web app fee page | https://www.icrypex.com/7356.1aa2cfecacc8f426.js | 2026-09-22 | www.icrypex.com | tier table, API customer row, call to `/v1/trades/fees`, sections 2 and 4 |
| S7 | registration form | https://account.icrypex.com/register | 2026-09-22 | www.icrypex.com | nationality list, section 1 |
| S8 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/icrypex | 2026-09-22 | CoinGecko | name, country, trust rank, volume, section 1 |
| S9 | web app positions component | https://www.icrypex.com/2290.b8f265750f59c494.js | 2026-09-22 | www.icrypex.com | "Mark Price" shows `ticker.price`, section 7 |
| S10 | CCXT source listing on `master` | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-22 | CCXT | no Icrypex class, section 8 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/icrypex/rest-probe.mjs) `catalog` at 04:43 UTC | `https://api.icrypex.com` | 2026-09-23 UTC | this host, Canadian VPN exit | catalog, fee levels, 401 paths, CCXT ids, sections 1 to 8 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/icrypex/rest-probe.mjs) `catalog`, second pass at 04:57 UTC | `https://api.icrypex.com` | 2026-09-23 UTC | this host, Canadian VPN exit | second reading of the catalog and the live fee levels, sections 2, 3 and 5 |
| P3 | curl of `api.icrypex.com.tr` `/v1/exchange/info`, `/v1/tickers`, `/v1/trades/fees` and `/v1/future/info` | `https://api.icrypex.com.tr` | 2026-09-23 UTC | this host, Canadian VPN exit | Turkish site has no pairs visible here and no futures endpoint, sections 1 and 4 |
