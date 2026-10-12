# Cryptomus Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time, 03:15 to 03:30 UTC on 2026-10-10, from the development host near Seattle through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the spot market of Cryptomus (CCXT id `cryptomus`), because the venue lists no perpetual, dated future or option.
The plan's template change 1 applies, so the tiers below are spot tiers.
Deposit, withdrawal, card and payment gateway schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/cryptomus/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/cryptomus/rest-probe.py) and [`ccxt-probe.py`](../../../scripts/probes/venues/cryptomus/ccxt-probe.py).
CCXT claims cite `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/cryptomus.js`, shortened below to `cryptomus.js`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-10-09 Pacific, the probes ran at 03:15 to 03:30 UTC on 2026-10-10 | P1 to P4 |
| operator named in the terms | "Cryptomus", with no legal entity, registry number or address on the terms page | S3 |
| legal entity named by the regulator | Xeltox Enterprises Ltd., operating as Cryptomus, previously Certa Payments Ltd., a money services business incorporated in British Columbia | S5 |
| regulatory record | FINTRAC imposed an administrative monetary penalty of CAD 176,960,190 on October 16, 2025, announced October 22, 2025 | S5 |
| who may trade | a registered user who completes KYC and AML verification | S3 sections 1.1 and 9 |
| US persons | excluded, "Cryptomus does not serve U.S. citizens or residents" | S3 preamble |
| other excluded regions | "the list of prohibited countries set forth in our website's AML policy", but the AML policy names no country and only says high-risk FATF jurisdictions may be restricted | S3 preamble, S4 |
| Canada | not named as excluded in the terms or the AML policy | S3, S4 |
| terms version | "Last Updated August 17, 2026" | S3 |

The terms say the list of unsupported regions "may change without notice", S3 section 3.2.
No public page lists the countries the exchange refuses, so who may trade from where is `Not publicly specified`.

### Access from this host

Every call in this profile went out through the Canadian VPN exit named in the Probed line, and a Cloudflare trace from this host said `loc=CA`, P1.
No public REST call was refused.

| endpoint | status from this host |
|---|---|
| `https://api.cryptomus.com/v2/user-api/exchange/markets`, `/v1/exchange/market/tickers`, `/v1/exchange/market/order-book/{pair}`, `/v1/exchange/market/trades/{pair}`, `/v2/user-api/exchange/markets/price` | 200, P1 |
| `https://api-app.cryptomus.com/v1/exchange/tariff/default` and `/v1/exchange/market` | 200, P1, P2 |
| `https://api.cryptomus.com/v1/exchange/market/trades/BTC_USDT` | one nginx 503 "Service Temporarily Unavailable" at the first manual call, 200 on every probe run, P1 |
| `wss://api-ws.cryptomus.com/ws` and `wss://exchange-ws.cryptomus.com/ws` | the host names return NXDOMAIN, so no socket opens, P3 and [websocket.md](./websocket.md) |
| `https://cryptomus.com/fees/trading`, `/tos`, `/aml` and `https://doc.cryptomus.com/` | 200 |

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, level 1, monthly turnover under USD 100,001 | 0.08 %, 800 ppm | 0.1 %, 1,000 ppm | `GET https://api-app.cryptomus.com/v1/exchange/tariff/default`, which the fee page S1 renders, P2 |

The VIP 0 spot taker is 1,000 ppm.
The same table applies to every pair, and the fee page names no per-pair exception, S1.

## 3. Coverage matrix

| product | present | how established |
|---|---|---|
| spot | yes, 103 pairs, 86 against USDT and 17 against USDC | P1 catalog |
| perpetual swaps | no | the catalog has only spot pairs, CCXT sets `'swap': false` at `cryptomus.js` line 32, the site footer and menus name only "Spot Exchange", `https://cryptomus.com/exchange/futures` and `https://cryptomus.com/futures` return 404, P1 |
| dated futures | no | CCXT `'future': false` at `cryptomus.js` line 33, nothing on the site or in the API docs, S2 |
| options | no | CCXT `'option': false` at `cryptomus.js` line 34, nothing on the site or in the API docs, S2 |
| margin | no | CCXT `'margin': false` at `cryptomus.js` line 31, no margin call in the API docs, S2 |
| convert | yes, a separate quote-and-convert service with its own calls | S2 "Converts" section, not detailed |
| deposit, withdrawal, card, payment gateway | official lookups at `https://cryptomus.com/fees/trading` section "Withdrawal fees and limits" and the payment gateway fee tab | S1, not detailed |

## 4. Spot tiers

The table is the reply of `GET https://api-app.cryptomus.com/v1/exchange/tariff/default`, P2.
The fee page's bundle calls that endpoint and maps `step + 1` to "Level", `from_turnover` to "Monthly turnover, USD", `maker_percent` to "Maker fee, %" and `taker_percent` to "Taker fee, %", S1.
The served HTML carries the column headers but none of the numbers, P2.

| level | monthly turnover from, USD | maker | maker ppm | taker | taker ppm |
|---|---|---|---|---|---|
| 1 | 0 | 0.08 % | 800 | 0.1 % | 1,000 |
| 2 | 100,001 | 0.06 % | 600 | 0.095 % | 950 |
| 3 | 250,001 | 0.055 % | 550 | 0.085 % | 850 |
| 4 | 500,001 | 0.05 % | 500 | 0.075 % | 750 |
| 5 | 2,500,001 | 0.04 % | 400 | 0.07 % | 700 |

The wire carries the percentages as long binary float expansions, for example `0.08000000000000000166533453693773481063544750213623046875`, P2.
The table rounds them to six decimals.

### Qualification

The level is set by monthly turnover in USD, S1 column header.
"The level is updated once every 24 hours at 9am (UTC)", S1.
The per-account level and turnover come from the signed call `GET /v2/user-api/exchange/account/tariffs`, S6, which answers 422 with `"The user id field is required."` and `"The sign field is required."` without credentials, P2.
The documentation's example reply for that call shows a different schedule, with a maker of -1.5 % and a taker of 4 % at step 0, S6.
That example is illustrative and does not match the public default table, so this profile uses the public table.

## 5. Discounts that change the spot taker

| discount | status | source |
|---|---|---|
| token holding | `Not offered`, Cryptomus has no exchange token named on the fee page | S1 |
| referral | a referral program exists at `https://app.cryptomus.com/settings/referral`, and its effect on the taker is `Not publicly specified` | S1 |
| market maker | "You can earn commissions as a market maker for Cryptomus Exchange", on terms that are `Negotiated` | S1 "Market Maker program" |
| zero fee promotion | none found on the fee page on 2026-10-09 | S1 |

## 6. Funding as a cost

`Not offered`.
The venue lists no perpetual, so no funding is charged.

## 7. Liquidation, settlement and delisting

`Not offered` for liquidation and settlement, since spot has no leverage and no expiry.
The terms reserve the right to suspend services or products without notice, S3 section 3.2.
No delisting fee is published, S1.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `cryptomus`, REST only, `'pro': false` | `cryptomus.js` line 27, no `pro/cryptomus.js` exists in 4.5.68 |
| exchange-level trading fee | `maker` `0.02`, `taker` `0.02`, `percentage` `true`, `feeSide` `get` | `cryptomus.js` lines 203 to 206 |
| `market.taker` for `BTC/USDT` without credentials | `0.02` | `parseMarket` copies the exchange fee into every market, `cryptomus.js` lines 323 and 345, P4 |
| `market.maker` | `0.02` | P4 |
| fee page URL in the class | `https://cryptomus.com/tariffs`, marked `// todo check` | `cryptomus.js` line 168 |
| signed tariff parser | `fetchTradingFees` divides `taker_percent` by 100, so it reads the venue's numbers as percentages | `cryptomus.js` lines 1042 and 1097 |

CCXT's fraction `0.02` is 2 %, which is 20,000 ppm.
The venue's VIP 0 taker is 0.1 %, which is 1,000 ppm, P2.
The CCXT constant is twenty times the published taker.
Its own signed parser at line 1097 treats `taker_percent` as a percentage, which suggests the constant was written as a percentage and stored as a fraction.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 1,000 | the level 1 spot taker from the public default tariff, P2 |
| `ccxtTakerPpm` | 20,000 | what CCXT 4.5.68 reports as `market.taker` for every pair without credentials, `cryptomus.js` line 206, P4 |

These values matter only for a future spot leg.
The venue has no perpetual, so the engine as it stands has no use for it.

## 10. Source ledger

| id | source |
|---|---|
| S1 | `https://cryptomus.com/fees/trading`, retrieved 2026-10-09, and its bundle `https://cryptomus.com/_next/static/chunks/` route chunk that calls `v1/exchange/tariff/default` |
| S2 | `https://doc.cryptomus.com/`, the API documentation index, retrieved 2026-10-09 |
| S3 | `https://cryptomus.com/tos`, "Last Updated August 17, 2026", retrieved 2026-10-09 |
| S4 | `https://cryptomus.com/aml`, retrieved 2026-10-09 |
| S5 | `https://fintrac-canafe.canada.ca/new-neuf/nr/2025-10-22-eng`, FINTRAC news release of 2025-10-22, retrieved 2026-10-09 |
| S6 | `https://doc.cryptomus.com/methods/exchange/tariffs`, retrieved 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/cryptomus/rest-probe.py), run 2026-10-10 UTC |
| P2 | [`fees-probe.py`](../../../scripts/probes/venues/cryptomus/fees-probe.py), run 2026-10-10 UTC |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/cryptomus/ws-probe.py), run 2026-10-10 UTC |
| P4 | [`ccxt-probe.py`](../../../scripts/probes/venues/cryptomus/ccxt-probe.py), CCXT 4.5.68 from PyPI, run 2026-10-10 UTC |
