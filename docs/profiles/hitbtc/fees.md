# HitBTC Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:04 to 04:20 UTC and again 04:24 to 04:31 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the perpetual contracts of HitBTC (CCXT id `hitbtc`), and nothing else.
HitBTC lists one perpetual family, USDT-margined linear contracts named `<BASE>USDT_PERP`, and spot is named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/hitbtc/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/hitbtc/ws-probe.mjs).
Every access result below was seen from the Canadian VPN exit, and a US address may be answered differently.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 local, for every source row | | source ledger |
| legal entity | "Htechno Business LTD. and its subsidiaries", Terms of Services modified 2026-09-16 | Published | S3 |
| governing law | "the laws of the Saint Vincent and the Grenadines", arbitration seated there | Published | S3, clauses 10.4, 10.5 and 10.7 |
| restricted jurisdictions | "(I) the United States of America, (II) North Korea, (III) Sudan, (IV) Crimea and Sevastopol, (V) Cuba, (VI) Syria, (VII) Canada, (VIII) United Kingdom, (IX) Russia, (X) Ukraine, (XI) Singapore, (XII) Japan, (XIII) Iran, (XIV) Brazil, (XV) Australia, (XVI) Cambodia, (XVII) South Korea, (XVIII) Hong Kong, (XIX) any Member State of the European Economic Area", plus any US-embargoed jurisdiction and any place whose law forbids the use | Published | S3, clause 2.2 (g) |
| EEA | "HitBTC does not target, advertise, solicit, or market its Services to residents of the EEA Member States", and EEA use is at the user's own risk | Published | S3, clauses 2.3 and 2.4 |
| who may trade the perpetuals | an account holder aged 18 or over outside the restricted jurisdictions | Region-specific | S3 |
| US persons | may not use the services, the United States is restricted jurisdiction (I) | Published | S3 |
| website from this host | `https://hitbtc.com/`, `/fees-and-limits`, `/futures`, `/terms-of-use` and `/robots.txt` answered HTTP 403 from Cloudflare with the page "You are unable to access HitBTC.com", "You are attempting to log in using an IP address of a restricted region. Please note that HitBTC does not provide its service in this region.", "Cloudflare Location CA" | Probed | `curl` on 2026-09-23 04:05 UTC, cf-ray edge YVR |
| website through WebFetch | `https://hitbtc.com/fees-and-limits` answered HTTP 403 as well | Probed | WebFetch on 2026-09-22 |
| help centre from this host | `https://support.hitbtc.com/` redirected to `/en/support/home` and answered 200, and every article in this ledger was read there | Probed | `curl` on 2026-09-23 UTC |
| public API from this host | `api.hitbtc.com` REST and `wss://api.hitbtc.com/api/3/ws/public` answered every public call with no refusal | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The development host's exit sits in Canada, which is restricted jurisdiction (VII), so trading from it is not allowed under S3.
Reading public market data is not an account service, and the API host served it without a challenge while the website refused the same exit.
CoinGecko lists "HitBTC (Derivatives)" with 48 perpetual pairs, 0 futures pairs, 37.42 BTC of open interest and 241.62 BTC of 24 h volume, and gives the exchange's country as Hong Kong, S9.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals (`*USDT_PERP`) | 0.02 % = 200 ppm | 0.07 % = 700 ppm | Published | S1, row "Starter / General" and row 1 "For Upgraded Accounts", columns "Futures / Maker Fee" and "Futures / Taker Fee" |
| the same, on the wire | `make_rate` `"0.0002"` | `take_rate` `"0.0007"` | Probed | `GET /api/3/public/symbol`, all 55 futures rows, `rest-probe.mjs catalog` |

The engine models a taker cross at the base retail tier, so 700 ppm is the number that matters.
The public symbol call carries the same rate on every perpetual, and its spot rows carry `0.0025` and `0.0012`, which is the Starter and General spot rate of S1, so the public per symbol rate is the base retail rate.

## 3. Coverage matrix

| product | present | count on 2026-09-23 UTC | evidence |
|---|---|---:|---|
| USDT-M linear perpetuals | yes | 50 `working`, plus 4 `suspended` and 1 `expired` | Probed, `/public/symbol`, `type` `futures`, `contract_type` `perpetual` |
| USDC-M perpetuals | no | 0 | Probed, every futures row has `quote_currency` and `fee_currency` `USDT` |
| coin-margined perpetuals | no | 0 | Probed, same call, and CCXT marks all 55 swaps `linear` |
| dated futures | no listing, the API still documents `cash_settled` contracts such as `UFO-1217` | 0 | Probed, no row has a non-null `expiry`, S4 |
| options | no | 0 | Probed, CCXT `option` is hard-coded false at `server/node_modules/ccxt/js/src/hitbtc.js` line 825 |
| spot | yes, not detailed | 1,170 `working`, 3 `suspended` | Probed, `/public/symbol` |

The five contracts that are not `working` are `TONUSDT_PERP` (`expired`), `PEPEUSDT_PERP`, `TONCOINUSDT_PERP`, `100PEPEUSDT_PERP` and `SUSDT_PERP` (`suspended`).
CoinGecko's 48 against the 50 `working` rows was not reconciled.
Spot, margin, deposit and withdrawal fees are looked up on the help centre article S1 and on `https://hitbtc.com/fees-and-limits`, which refuses this host.

## 4. Perpetual tiers

From S1, "Trading fees", modified 2024-11-27.
The volume column is headed "30-days Trading Volume(BTC)" and every row is written in USDT, so the unit is ambiguous in the source.

| level | 30-day trading volume | futures maker | futures taker | spot maker | spot taker |
|---|---|---:|---:|---:|---:|
| Starter / General | ≥ 0 USDT | 0.02 % | 0.07 % | 0.12 % | 0.25 % |
| 1 | ≥ 0 USDT | 0.02 % | 0.07 % | 0.12 % | 0.20 % |
| 2 | ≥ 10,000 USDT | 0.02 % | 0.07 % | 0.09 % | 0.15 % |
| 3 | ≥ 250,000 USDT | 0.02 % | 0.06 % | 0.08 % | 0.12 % |
| 4 | ≥ 500,000 USDT | 0.02 % | 0.06 % | 0.07 % | 0.10 % |
| 5 | ≥ 1,000,000 USDT | 0.01 % | 0.05 % | 0.06 % | 0.08 % |
| 6 | ≥ 5,000,000 USDT | 0.01 % | 0.05 % | 0.04 % | 0.06 % |
| 7 | ≥ 10,000,000 USDT | 0 % | 0.05 % | 0.02 % | 0.05 % |
| 8 | ≥ 50,000,000 USDT | 0 % | 0.05 % | 0 % | 0.03 % |
| 9 | ≥ 100,000,000 USDT | 0 % | 0.05 % | -0.01 % | 0.02 % |
| 10 | ≥ 500,000,000 USDT | 0 % | 0.05 % | -0.01 % | 0.015 % |

### Qualification

- Levels 1 to 10 apply to "upgraded accounts", which S1 does not define further and S2 ties to verification.
  Starter and General accounts pay the fixed first row.
- "every day at 00:00 am UTC the system is calculating your trading volume for the last 30 days", and the new rates apply "within an hour", S1.
- Whether futures volume and spot volume are pooled into one 30-day figure is Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | rule | effect on the VIP 0 perpetual taker | evidence |
|---|---|---|---|
| HIT token holding | levels 1 and 2: 3 % off at 500 HIT, rising to 40 % off at 16,000,000 HIT. Levels 3 to 10: 5 % off at 50,000 HIT, rising to 45 % at 16,000,000 HIT | "HIT holdings cannot decrease Taker fees below 0.02%", and the discount needs a verified account, so a level 1 perpetual taker could fall from 0.07 % to 0.042 % at the largest holding. Whether the table applies to futures at all is Not publicly specified, since its worked example uses the old 0.09 % spot rate | S2 |
| HIT trading pairs | lower fees on pairs quoted in HIT, from the token release | not a perpetual | S2 |
| referral | CCXT carries a referral URL, `server/node_modules/ccxt/js/src/hitbtc.js` line 126 | Not publicly specified | none read |
| market maker programme | none found in the help centre | Not publicly specified | none read |
| zero fee promotion | none found | none | none read |

The engine uses the undiscounted 700 ppm.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| interval | 8 h, "The Funding Rate is charged and paid every 8 hours" | Published | S5 |
| settlement instants | 00:00, 08:00 and 16:00 UTC | Probed | 155 of 156 gaps between consecutive history rows of the 55 contracts are 8.00 h, and 30 BTC rows fall 2 to 4 ms after those hours, `rest-probe.mjs history`. The one exception is `TONUSDT_PERP` at its expiry |
| premium index, per minute | `ip = (max(0, P_IB - P_i) - max(0, P_i - P_IA)) / P_i`, with impact bid and ask at "200 USDT / Initial Margin rate at maximum leverage level", 20,000 USDT on BTC | Published | S5, first formula image |
| funding rate | `r_f = avg(ip) + clamp(avg(r_I) - avg(ip), -0.05 %, 0.05 %)` over one funding period, with `r_I` "fixed at 0.01% per funding period" | Published | S5, second formula image |
| rate check | 207 of 208 settled history rows equal `avg_premium_index + clamp(interest_rate - avg_premium_index, -0.0005, 0.0005)` to 1e-9, the exception being `TONUSDT_PERP` at its expiry | Probed | `rest-probe.mjs history` |
| cap and floor on the rate | none, only the interest leg is clamped, so the rate follows the average premium beyond ±0.05 % of the interest rate | Published | S5. `BCHUSDT_PERP` published -0.0942 % on 2026-09-23 |
| who pays | "If the Funding Rate is greater than 0 at the moment when the countdown reaches 0 […] traders in long positions will pay 0.01% from the size of their position (by Mark Price) to the traders in short positions", and the reverse when negative | Published | S5 |
| who is charged | only a position open at the instant: "if you've placed a position after the counter started, and the position was realized before the counter expired, you will neither pay nor receive the funding" | Published | S5 |
| exchange share | "HitBTC receives no profit from the funding payments because they are made directly between our traders" | Published | S5 |
| published rate | `funding_rate` is fixed for the interval and is read as the rate charged at `next_funding_time`, while the API documentation describes it both ways | Not verified | see [`rest.md`](./rest.md) section 4 |
| rate at a settlement | the settlement instant itself was not captured | Not verified | see [`rest.md`](./rest.md) section 4 |

A 1 h or 4 h contract was not seen, and no row of `/public/futures/info` carries an interval field.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| liquidation trigger | the mark price reaching the position's liquidation price | S6 |
| liquidation penalty | "Upon liquidation, a certain amount of penalty is debited from the user (0.3% of the position volume)" | S6 |
| insurance fund and ADL | losses beyond the margin go to the insurance fund, then to auto-deleveraging of the most profitable opposite positions, ranked 0 to 4 | S6, S7 |
| settlement fee | none published, perpetuals do not settle | |
| delisting | an expired contract keeps its row with `status` `expired`, and a suspended contract keeps its row with mark 0, see [`rest.md`](./rest.md) section 2 | Probed |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` for a swap without credentials | `0.0007` on all 55 swaps, which is 700 ppm | `rest-probe.mjs catalog`, read from `take_rate` at `server/node_modules/ccxt/js/src/hitbtc.js` line 877 |
| `market.maker` | `0.0002` on all 55 swaps | same probe, `make_rate` at line 878 |
| exchange constant | `taker` and `maker` `0.0009`, with a ten row tier table from 0.09 % down to 0.02 % | lines 265 to 298, an old spot schedule that `market.taker` overrides |
| spot `market.taker` | `0.0025` on 1,170 markets and `0.001875` on 3 | `rest-probe.mjs catalog` |

CCXT's per-market rate comes from the venue's own public symbol call, so it tracks the published base rate and not the stale constant.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 700 | the Starter, General and level 1 futures taker of S1, equal to the wire's `take_rate` |
| `ccxtTakerPpm` | 700 | CCXT 4.5.68 reads `take_rate` at `server/node_modules/ccxt/js/src/hitbtc.js` line 877, so a change of the venue's public rate shows up as a mismatch |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading fees, modified 2024-11-27 | https://support.hitbtc.com/en/support/solutions/articles/63000224917-trading-fees | 2026-09-22 | HitBTC, global | tiers, VIP 0 maker and taker, qualification, sections 2 and 4 |
| S2 | HitBTC Token (HIT) FAQ, modified 2024-08-09 | https://support.hitbtc.com/en/support/solutions/articles/63000263386-hitbtc-token-hit-faq | 2026-09-22 | HitBTC, global | HIT discount tables and the 0.02 % taker floor, section 5 |
| S3 | Terms of Services, modified 2026-09-16 | https://support.hitbtc.com/en/support/solutions/articles/63000289523-terms-of-services | 2026-09-22 | Htechno Business LTD. | entity, restricted jurisdictions, governing law, section 1 |
| S4 | HitBTC API v3 reference, changelog latest 27.08.2026 | https://api.hitbtc.com/ | 2026-09-22 | HitBTC, global | symbol and futures info fields, `cash_settled` contracts, section 3 |
| S5 | What Is the Futures Funding Rate?, modified 2023-03-22 | https://support.hitbtc.com/en/support/solutions/articles/63000268177-what-is-the-futures-funding-rate- | 2026-09-22 | HitBTC, global | funding, premium, mark and index formulas, section 6 |
| S6 | Futures Liquidation, modified 2022-06-17 | https://support.hitbtc.com/en/support/solutions/articles/63000264945-futures-liquidation | 2026-09-22 | HitBTC, global | liquidation penalty, section 7 |
| S7 | Insurance Fund, modified 2022-09-01 | https://support.hitbtc.com/en/support/solutions/articles/63000264510-insurance-fund | 2026-09-22 | HitBTC, global | insurance fund and ADL, section 7 |
| S8 | CCXT 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | fee constant, per-market rate, section 8 |
| S9 | CoinGecko API, `derivatives/exchanges/hitbtc_derivatives` | https://api.coingecko.com/api/v3/derivatives/exchanges/hitbtc_derivatives | 2026-09-22 | CoinGecko | perpetual count, open interest, volume, section 1 |
| P1 | `rest-probe.mjs catalog`, `history` and `errors`, at 04:10 to 04:13 and again 04:24 to 04:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hitbtc/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 2, 3, 6 and 8 |
