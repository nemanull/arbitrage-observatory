# 4E Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:40 to 06:50 UTC by the host clock, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=YVR`).

This profile covers 4E (brand domain `www.eeee.com`, CoinMarketCap slug `4e`) for the survey of 2026-09-22.
The fetches ran on the host clock date above, which is two days after the survey date.
4E publishes a USDT-margined perpetual schedule, but no public API documentation, so the numbers below are the retail schedule of its help centre and cannot be checked against an API field.
The API side is in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

- Operator: the Terms of Use say "4E ... is one of brands under Global Digital Finance Ltd, based in Malaysia", S5.
- CoinMarketCap names a Labuan (Malaysia) licence and CySEC, MiFID II and BaFin registrations, S8, and this profile did not verify any of them.
- Restricted registration regions, from the help article "Client IP restriction issue" updated 2024-04-15, S6: North Korea, Cuba, Syria, Iran, Venezuela, Sudan, South Sudan, Crimea, Russia, Lebanon, Iraq, Libya, Singapore, United States, Bangladesh, India, Pakistan.
- US persons may not register, S6.
- The Terms of Use add that a user must not be "located in, or a citizen or a resident of a country prohibited by us", without naming the list, S5 clause (h).
- The public site served this host normally through the Canadian exit, and its bootstrap call answered `country_code2` `CA` and `is_specific_country_ip` false, see [`rest.md`](./rest.md) section 1.
- The fee articles were last updated 2024-05-15, S1 and S2, so the schedule is at least that old and may not be current.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals, VIP 0 ("User") | 0.0400 %, 400 ppm | 0.0550 %, 550 ppm | S1 |
| spot, VIP 0 ("User"), context only | 0.1000 %, 1,000 ppm | 0.1000 %, 1,000 ppm | S2 |

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes | S1 says "4E supports USDT perpetual Futures quoted and settled in USDT". CoinMarketCap lists 47 perpetual pairs, all quoted in USDT, S8 and [`rest-probe.mjs`](../../../scripts/probes/venues/four-e/rest-probe.mjs) |
| USDC-margined perpetuals | absent | none in S1 or S8 |
| coin-margined perpetuals | absent | none in S1 or S8 |
| dated futures | absent on CoinMarketCap, which counts 0 `futures` pairs, S8 | "Mini Futures" articles exist in the help centre, and this profile did not read them |
| options | absent | none found |
| spot | yes | 94 pairs on CoinMarketCap, S8 |
| forex, indices, commodities, stocks | yes, per the site description | site description and help articles, S7 and the home page title |

## 4. Perpetual tiers

The USDT perpetual schedule of S1, "a flat rate shown below".

| level | maker | taker |
|---|---|---|
| User | 0.0400 % | 0.0550 % |
| VIP1 | 0.0350 % | 0.0500 % |
| VIP2 | 0.0300 % | 0.0450 % |
| VIP3 | 0.0250 % | 0.0400 % |
| VIP4 | 0.0200 % | 0.0400 % |
| VIP5 | 0.0150 % | 0.0350 % |
| VIP6 | 0.0100 % | 0.0300 % |
| VIP7 | 0.0100 % | 0.0250 % |
| VIP8 | 0.0050 % | 0.0100 % |
| VIP9 | 0.0000 % | 0.0100 % |

The fee is "Filled Price × Filled amount × Fee Rate", S1.
The VIP qualification rule is Not publicly specified in S1 or any English help article title found.

## 5. Discounts that change the perpetual taker

- No token discount is published.
- A spot promotion "Spot Trading Week, Highest 50% Rebate on Trading Fee" dated 2024-05-03 exists in the help centre and concerns spot, S7.
- Referral and market maker terms are Not publicly specified.

## 6. Funding as a cost

- Charged three times a day at 08:00, 16:00 and 24:00 UTC+8, which is 00:00, 08:00 and 16:00 UTC, every 8 hours, and "the actual collection time ... may have a deviation of 15 seconds", S3.
- Transferred between longs and shorts, and "the platform does not collect these fees", S3.
- Only positions held at the funding time pay or receive, S3.
- Funding fee is position value times the current funding rate, S3.
- The funding rate formula, its cap and its floor are Not publicly specified.
- CoinMarketCap reported a funding rate of 0.0004 on all 47 perpetuals at 2026-09-24 06:45 UTC, with open interest 0 on all 47, S8 and [`rest-probe.mjs`](../../../scripts/probes/venues/four-e/rest-probe.mjs).
  In the same CoinMarketCap feed Binance BTC/USDT read 0.0000571 while Binance's own `premiumIndex` read `lastFundingRate` 0.00005662, so the field is a fraction per interval, and 4E's 0.0004 is 0.04 % on every contract.
  A single constant on 47 contracts suggests a placeholder rather than a computed rate, and it could not be checked on the venue.
- The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

Not publicly specified in the English help article titles found on 2026-09-24.
Leverage runs from 1 to 125x, S7.

## 8. CCXT

- CCXT 4.5.68 has no 4E class: `node -e "console.log(require('ccxt').exchanges)"` from `server/` listed 104 ids and none matched `4e`, `four`, `eeee` or `bitda`, [`rest-probe.mjs`](../../../scripts/probes/venues/four-e/rest-probe.mjs).
- Current CCXT master has none either: the GitHub listing of `ts/src` on 2026-09-24 held no file matching those names, S9.
- So `market.taker` is not available.

## 9. Recommended registry values

None.
4E cannot be registered, because no CCXT class, public catalog, book feed or anchor exists for it, see [`rest.md`](./rest.md) section 2.
If that changed, `takerPpm` would be 550 from S1, and `ccxtTakerPpm` would depend on the class.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Futures Trading Fees and Calculation, updated 2024-05-15 | https://hcapi.eeee.com/api/news/155?locale=en | 2026-09-24 | 4E, global | perpetual tiers, sections 2 and 4 |
| S2 | Trading Fees, updated 2024-05-15 | https://hcapi.eeee.com/api/news/149?locale=en | 2026-09-24 | 4E, global | spot VIP 0, section 2 |
| S3 | Funding Fee Introduction and Calculation, updated 2024-05-15 | https://hcapi.eeee.com/api/news/158?locale=en | 2026-09-24 | 4E, global | section 6 |
| S4 | Mark Price and Index Price, updated 2024-04-15 | https://hcapi.eeee.com/api/news/159?locale=en | 2026-09-24 | 4E, global | [`rest.md`](./rest.md) section 4 |
| S5 | Terms of Use, updated 2024-04-11 | https://hcapi.eeee.com/api/news/1?locale=en | 2026-09-24 | Global Digital Finance Ltd, Malaysia | section 1 |
| S6 | Client IP restriction issue, updated 2024-04-15 | https://hcapi.eeee.com/api/news/209?locale=en | 2026-09-24 | 4E, global | section 1 |
| S7 | Perpetual Futures Trading Tutorial, updated 2024-07-24, and the help centre title list | https://hcapi.eeee.com/api/news/433?locale=en | 2026-09-24 | 4E, global | leverage, promotions, sections 3, 5 and 7 |
| S8 | CoinMarketCap 4E page and its data API for perpetual, futures and spot pairs | https://coinmarketcap.com/exchanges/4e/ and https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=4e&category=perpetual | 2026-09-24 | third party | pair counts, funding and open interest as reported, sections 1, 3 and 6 |
| S9 | CCXT master `ts/src` listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src | 2026-09-24 | CCXT | section 8 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/four-e/rest-probe.mjs), run at 06:47 UTC | | 2026-09-24 | this host, Canadian VPN exit | sections 1, 3, 6 and 8 |

The help centre articles are rendered at `https://www.eeee.com/help-center/en?...&articleId=<uuid>`, and this profile read the same articles from the CMS API the page itself calls.
