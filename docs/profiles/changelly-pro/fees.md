# Changelly PRO Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:23 to 04:57 UTC), from the development host near Seattle, through its Surfshark WireGuard exit in Canada.

This profile covers the fees of Changelly PRO's USDT-margined perpetuals, the venue's only perpetual family.
CCXT 4.5.68 has no Changelly PRO class, see section 8.
Changelly PRO fronts HitBTC's matching engine, so its perpetual books, trades, open interest and funding are HitBTC's, see [`rest.md`](./rest.md) section 2.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/changelly-pro/rest-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Changelly Pro which operates through the legal entity Alqentra LLC" | S2, S3 |
| jurisdiction of Alqentra LLC | Not publicly specified in the terms or the privacy policy | S2, S3 |
| other names | the site footer reads "Changelly PRO Solution Inc.", and CoinGecko lists the country as Seychelles, established 2020 | S5, S7 |
| sibling entity | Changelly, the instant exchange, "operates through legal entity Marella LLC" | S3 |
| excluded regions | "Crimea and Sevastopol, Cuba, North Korea, Sudan, Syria, Spain, the United States of America", any territory embargoed by the United States, and any territory whose law prohibits use | S2 |
| US persons | may not use the service, as citizens, residents, or anyone located or incorporated there | S2 |
| futures access | the app asks a user to "Complete Account Verification" and "Enable 2FA" before "Access Futures trading" | S6 |
| country restriction on futures | the app has the message "Unfortunately, Margin and Futures trading is not available in your country yet", and the country list behind it is Not publicly specified | S6 |
| terms version | "Last update 2026-09-16" | S2 |

The terms do not mention futures, perpetuals or funding at all, and they cover margin trading only.
The futures product is described by the API documentation S1 and by the app strings S6.
The help center at `support.changelly.com` answered every request from this host with 302 to a login page, so no help article could be read, S10.
The public API answered this host with 200 on every public call, and nothing was refused, see [`rest.md`](./rest.md) section 1.
Those access results are from the Canadian VPN exit, where Cloudflare reported `loc=CA` and `colo=YVR`.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.05 %, 500 ppm | `make_rate` `"0.0002"` and `take_rate` `"0.0005"` on all 19 futures rows of `GET /api/3/public/symbol`, P1 |

The API documentation calls `take_rate` the "Default fee rate." and `make_rate` the "Default fee rate for market making trades.", S1.
The published fee tier page has Futures Maker and Futures Taker columns, and every one of their 12 rows shows a dash, S5.
So the catalog default is the only published perpetual rate, and no page states it in words.
HitBTC's catalog lists the same contracts at `"0.0007"` taker and `"0.0002"` maker, P3.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | source |
|---|---|---|---|
| USDT-M linear perpetuals | yes | 18 `working`, and `LUNAUSDT_PERP` `expired` since 2022-05-13 | P1 |
| USDC-M perpetuals | no | 0 | P1 |
| coin-margined or inverse perpetuals | no | 0 | P1 |
| dated futures | no | 0 rows of `contract_type` `cash_settled`, though the API documents that type | P1, S1 |
| options | no | none in the catalog or the documentation | P1, S1 |
| spot | yes | 328 `working` and 3 `suspended`, 21 with margin, all at `take_rate` and `make_rate` `"0.001"` | P1 |

HitBTC lists 50 working perpetuals on the same engine, and Changelly PRO shows 18 of them, P3.
CoinGecko's derivatives list does not carry Changelly PRO, and it carries the same books as "HitBTC (Derivatives)" with 48 perpetuals, S7.

## 4. Perpetual tiers

No perpetual tier is published.
The fee tier page renders this table for an anonymous visitor, S5, and the two futures columns show a dash on every level, written as none below.

| level | 30-day volume | spot and margin maker | spot and margin taker | futures maker | futures taker |
|---|---|---|---|---|---|
| 1 | ≥ 0 BTC | 0.1 % | 0.1 % | none | none |
| 2 | ≥ 5 BTC | 0.09 % | 0.1 % | none | none |
| 3 | ≥ 10 BTC | 0.08 % | 0.09 % | none | none |
| 4 | ≥ 50 BTC | 0.075 % | 0.085 % | none | none |
| 5 | ≥ 250 BTC | 0.07 % | 0.08 % | none | none |
| 6 | ≥ 500 BTC | 0.06 % | 0.08 % | none | none |
| 7 | ≥ 1,000 BTC | 0.04 % | 0.06 % | none | none |
| 8 | ≥ 5,000 BTC | 0.03 % | 0.06 % | none | none |
| 9 | ≥ 10,000 BTC | 0.02 % | 0.06 % | none | none |
| 10 | ≥ 20,000 BTC | 0.01 % | 0.05 % | none | none |
| 11 | ≥ 50,000 BTC | 0 % | 0.04 % | none | none |
| 12 | ≥ 100,000 BTC | 0 % | 0.03 % | none | none |

### Qualification

The page says the fees depend on "your trading volume over the past 30 days, converted into BTC and your average token balance over the past 30 days", S5.
The older fees page says "the fee schedule is applied only to TRADER and PRO accounts" and "The fees for Starter accounts are fixed at 0.1% Maker Fee and 0.1% Taker Fee.", with "Last update 2021-08-16", S4.
Both statements concern spot and margin.
A personal futures rate would come from the private `GET /api/3/futures/fee` calls, S1, which this survey does not call.

## 5. Discounts that change the perpetual taker

| discount | state on 2026-09-22 | source |
|---|---|---|
| token holding | the tier page text mentions a token balance, but the app's feature flags carry `"discounts":{"value":false}` and no holder table rendered | S5, S6 |
| referral | the app has a referral module, and no rate is published | S6 |
| market maker | Not publicly specified | |
| zero fee promotion | the app has the string "Discounted trading fee till 24 February", and it did not render on the page, so no promotion is live | S5, S6 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 8 h, settling at 00:00, 08:00 and 16:00 UTC on every perpetual | 1,602 of 1,602 consecutive history gaps were 8 h over 30 days, P1 |
| published rate | `funding_rate` is the rate settled at the last settlement, and `indicative_funding_rate` the estimate for the next one | S1, and 19 of 19 `funding_rate` values equalled the latest history row, P1 |
| formula | rate = P + clamp(I − P, −0.05 %, +0.05 %), where P is `avg_premium_index` and I is `interest_rate` | inferred, it reproduces 1,604 of 1,620 settled rows over 30 days, P1 |
| interest rate | `"0.0001"` per period on every row | P1 |
| cap and floor | not documented, and the rows the formula misses sit at `-0.003` on `BCHUSDT_PERP` (15 rows) and `-0.0029` on `MANAUSDT_PERP` (1 row), where the formula gave a lower number | P1 |
| range seen in 30 days | −0.003 to +0.0001 per 8 h | P1 |
| who pays | Not publicly specified in the pages read | |
| settlement instant | history rows are stamped 2 to 32 ms after the hour, and the instant itself was not captured | P1 |

`BCHUSDT_PERP` settled negative on 90 of 90 periods in the last 30 days, between −0.003 and −0.00091, and at the −0.003 floor 15 times, P1.
`MANAUSDT_PERP` settled negative 10 times, `AVAXUSDT_PERP` 9 times and `ADAUSDT_PERP` once, and no other perpetual settled below zero, P1.
That is a standing discount of the `BCHUSDT_PERP` book against its index, and funding on it is a cost the engine's taker model does not carry.

## 7. Liquidation, settlement and delisting

- "If a position is liquidated - either by reaching the liquidation price or by the trader, a Liquidation Fee in the amount of 0.5% of the position's value is charged in the quote currency", for margin and for futures, S5.
- `LUNAUSDT_PERP` stayed in the catalog with `status` `expired` and a `futures/info` row frozen at 2022-05-13, P1.
  The documented status values are `working`, `suspended` and `clearing`, S1, so `expired` is undocumented.
- A delisting charge is Not publicly specified.

## 8. CCXT

CCXT 4.5.68 has no Changelly PRO class.
`require('ccxt').exchanges` in `server/` lists 104 ids, and none contains "changelly", and no file under `server/node_modules/ccxt/js/src` mentions it.
The current master on GitHub, version 4.5.82 at commit `1d8b674434` of 2026-09-22 12:48 UTC, has 105 files in `ts/src` and none is a Changelly class, and its README does not mention Changelly, S9.

The API is HitBTC's API v3 on another host, so CCXT's `hitbtc` class loads it when its URLs are overridden.
`new ccxt.hitbtc({ id: 'changellypro', urls: { api: { public: 'https://api.pro.changelly.com/api/3', private: 'https://api.pro.changelly.com/api/3' } } })` loaded 350 markets and 19 swaps with id `changellypro`, P1.

| field | value on the 19 swaps | CCXT source |
|---|---|---|
| `market.taker` | 0.0005 | `take_rate`, at `server/node_modules/ccxt/js/src/hitbtc.js` line 877 |
| `market.maker` | 0.0002 | `make_rate`, line 878 |
| exchange default | `fees.trading.taker` and `maker` 0.0009, which the per market rate overrides | lines 269 and 270 |

So `ccxtTakerPpm` for this setup is 500, read live from the catalog rather than from a constant.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 500 | the published catalog default for every perpetual, and the fee tier page publishes nothing lower for VIP 0 |
| `ccxtTakerPpm` | 500 | what `hitbtc` reports on this host, section 8 |

Both numbers come from one field, so a change of the catalog default would move them together.
The registry comment should cite the catalog field and not a CCXT constant, since no constant is involved.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChangellyPRO API Documentation, changelog up to 27.08.2026 | https://api.pro.changelly.com/ | 2026-09-22 | Changelly PRO, global | `take_rate` and `make_rate` meaning, status values, funding fields, private fee calls, sections 2, 4, 6, 7 |
| S2 | Terms of Service, "Last update 2026-09-16" | https://pro.changelly.com/terms-of-use | 2026-09-22 | Alqentra LLC | operator, excluded regions, section 1 |
| S3 | Privacy and Data Retention Policy, "Last update 2026-01-13" | https://pro.changelly.com/privacy-policy | 2026-09-22 | Alqentra LLC, Marella LLC | operator and sibling entity, section 1 |
| S4 | Changelly PRO Fee Structure, "Last update 2021-08-16" | https://pro.changelly.com/fees | 2026-09-22 | Changelly PRO | Starter and TRADER account rules, section 4 |
| S5 | Fees, Trading Fee Tiers, rendered once in headless Chrome because the table loads in the browser | https://pro.changelly.com/fee-tier/fees | 2026-09-22 | Changelly PRO | tier table, liquidation fee, footer entity, sections 2, 4, 5, 7 |
| S6 | App strings and feature flags embedded in the app page | https://pro.changelly.com/fee-tier | 2026-09-22 | Changelly PRO | futures access steps, country restriction message, discount flags, sections 1 and 5 |
| S7 | CoinGecko API, `exchanges/changelly` and `derivatives/exchanges/hitbtc_derivatives` | https://api.coingecko.com/api/v3/exchanges/changelly | 2026-09-22 | CoinGecko | country, trust rank 127, 1,707.8 BTC spot volume, HitBTC Derivatives with 48 perpetuals, sections 1 and 3 |
| S8 | CCXT 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | market fee fields, section 8 |
| S9 | CCXT master `ts/src` listing and README | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Changelly class, section 8 |
| S10 | Changelly support center | https://support.changelly.com/support/home | 2026-09-22 | Changelly | 302 to a login page, section 1 |
| P1 | `rest-probe.mjs main`, runs at 04:36, 04:38 and 04:54 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/changelly-pro/rest-probe.mjs) | 2026-09-22 | this host | catalog fees, coverage, CCXT mapping, funding history and formula fit, sections 2, 3, 6, 7, 8 |
| P3 | `rest-probe.mjs mirror`, runs at 04:38 and 04:55 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/changelly-pro/rest-probe.mjs) | 2026-09-22 | this host | HitBTC catalog fees and perpetual count, sections 2 and 3 |
