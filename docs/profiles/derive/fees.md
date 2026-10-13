# Derive Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:20 to 22:42 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers perpetual trading on Derive (CCXT id `derive`), the decentralised options and perpetuals exchange that was called Lyra.
Derive moved to its v3 API on 2026-10-06, and CCXT 4.5.68 still reads the v2 host, as [`rest.md`](./rest.md) section "Decentralised layer" shows.
Every number carries a source ledger row, a probe reference, or a CCXT file and line, with the evidence labels of the venue survey.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/derive/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/derive/rest-probe.py), each run twice with `uv run` from the repository root.
P1 is the first run of each mode and P2 the rerun: the fees probe ran at 22:29 and 22:37 UTC, and the REST modes as [`rest.md`](./rest.md) lists them.
Every number quoted below held in both runs unless a range is given.
The socket is covered in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer in [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| retrieved | 2026-10-12, from the v3 documentation at `docs.derive.xyz`, the Terms of Use and the app's announcement feed | | S1 to S12 |
| legal entity | "we", "us" and "our" refer to Lyra Technologies Corp | Published | S5 section 1.5 |
| Terms dates | "Updated: 23 September 2026" and "Effective: 3 October 2026" | Published | S5 |
| Terms date in the app | the announcement of 2026-09-28 says the updated Terms "will take effect on 2 October 2026", one day earlier | Published | S6 |
| who may not trade | a Restricted Person, which names United States persons and residents, Australian tax residents, Canada residents and citizens including Ontario residents, and Panama residents | Region-specific | S5 |
| places named | Iran, Iraq, Libya, Mali, Nicaragua, Cuba, North Korea, Russia, Somalia, Sudan, Syria, Yemen, Zimbabwe, Myanmar, Côte d'Ivoire, the Democratic Republic of Congo, Crimea, Donetsk and Luhansk | Region-specific | S5 |
| geoblock | HTTP 403 with code `restricted_region` and the message "You are in a restricted region that violates our terms of service." | Published | S7 |
| account | a self-custodial Ethereum wallet, an EOA or a multisig, whose first deposit creates its subaccount | Published | S11 |

So a US person may not trade Derive, and neither may anyone resident in Canada, where this host's exit sits.
No public call from this host met the geoblock, [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | maker | taker | evidence |
|---|---|---|---|
| USDC-settled linear perpetuals, 15 contracts | 0.01 %, 100 ppm | 0.03 % of notional plus 0.01 USDC per order, 300 ppm plus the base fee | S1 `Published`. Every perpetual row of `public/get_all_instruments` carried `taker_fee_rate` `0.0003`, `maker_fee_rate` `0.0001` and `base_fee` `0.01`, P1 and P2 `Probed` |

The base fee is a flat charge on each taker order, "regardless of order size", S1.
It adds 100 ppm on a 100 USDC fill, 10 ppm on 1,000 USDC and 1 ppm on 10,000 USDC, as the fees probe prints.
S1's worked example agrees: a 0.1 BTC perpetual taker fill at 43,000 pays 0.01 + 0.03 % × 4,300 = 1.30 USDC.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDC-settled linear perpetuals | yes, 15 | `instrument_type` `perp`, every row `is_active` true and `quote_currency` `USDC` on v3, P1 and P2 |
| USDT-margined perpetuals | no | no perpetual quotes or settles in USDT, P1 and P2 |
| coin-margined or inverse perpetuals | no | none listed, P1 and P2 |
| dated futures | no | the `AssetType` enum is `option`, `perp` and `erc20` only, S10 and the OpenAPI file of S12 |
| options | yes, 4,876 live rows | `pagination.count` of `instrument_type` `option` with `expired` false, P1 and P2. Not detailed |
| spot | yes, 11 pairs | `instrument_type` `erc20`, for example `ETH-USDC` and `DRV-USDC`, P1 and P2. Spot pays no maker or taker fee, S1. Not detailed |

## 4. Every published perpetual tier

| tier | qualification | perpetual taker | evidence |
|---|---|---|---|
| base | none | 0.03 % plus 0.01 USDC per order | S1 `Published`, and the instrument rows, P1 and P2 |
| discounted tiers | "trading more volume or staking DRV" | not tabulated | S1 points to "live fee tiers in the Derive app", and the HTML of that app page holds no tier table, S6. `Not publicly specified` |
| institutional market makers | the Institutional Trading Rewards Program | not tabulated | "additional discounts and rebates", S1 and S8. `Negotiated` |

The tier table exists only in the app, so the profile records no tier below the base rate.
The engine models the base retail tier, so the base row is the one that matters.

## 5. Discounts that change the perpetual taker

- DRV staking lowers the fee, S1, and the announcement of 2026-09-28 says "DRV stakers keep their fee discounts", S6.
  The size of the discount is `Not publicly specified`.
- DRV trading rewards were paused from the epoch that began on 2026-09-30 at 00:00 UTC, S6.
  They are a rebate, not a fee rate.
- The Institutional Trading Rewards Program pays up to 500,000 USDC and 1M DRV per 28-day epoch to qualifying market makers, S8, and its terms are `Negotiated`.
- The API Broker Program pays a referrer 10 % to 50 % of the net fees of the users it brings, S8.
  It does not change what the taker pays.
- A builder fee, `extra_fee`, is charged on top of the exchange fee when a front end sets it, S1.
  It raises the taker's cost on that front end and never lowers it.
- No zero-fee promotion for perpetuals was found in the documentation or the app's announcements, S1 and S6.

## 6. Funding as a cost

S2 is the formula of record, and S3 repeats it with one convergence of 8 h for every market and older caps.

| item | value | evidence |
|---|---|---|
| premium | `(max(0, IBP - Spot) - max(0, Spot - IAP)) / Spot`, where IBP and IAP are the average fill prices of a market sell and buy of the impact notional | S2 `Published` |
| impact notional | 4,000 | S2 and S3 |
| rate per hour | `Premium / perpConvergence + clamp(UnderlyingRate - Premium / perpConvergence, -0.00625 %, 0.00625 %)` | S2 |
| `UnderlyingRate` | 0.00125 % per hour on every market, "Equivalently 0.01% per 8 hours" | S2 |
| `perpConvergence` | 16 h on BTC, ETH and SOL, 24 h on HYPE, 8 h on LIT, PUMP, VVV and all others | S2 |
| documented cap | ±0.017123 % per hour on BTC, ETH, SOL and HYPE, ±0.4 % on LIT, PUMP and VVV, ±0.068493 % on all others | S2 |
| older documented cap | ±0.057 % per hour on ETH and BTC and 0.4 % on all others | S3 |
| cap on the wire | `max_rate_per_hour` `0.000171232876` and `min_rate_per_hour` `-0.000171232876` on 15 of 15 perpetuals, which is ±0.0171 % per hour | P1 and P2 `Probed` |
| unit | a rate per hour, "not a per-8-hour rate" | S2 and S3 |
| who pays | longs pay shorts when the rate is positive, `Funding = -Perp Size x Funding Rate x Spot x Time Held`, with time in hours | S3 |
| when it is charged | continuously: unrealised funding and PnL settle "whenever a user adjusts their position", and anyone may call settle on an account | S4 and S9 |

So the wire cap agrees with S2 for BTC, ETH, SOL and HYPE and is tighter than S2 on the other eleven perpetuals.
A cap of 0.0171 % per hour is 150 % a year, since 0.000171232876 × 8,760 = 1.5.
There is no settlement instant, so funding produces no settlement dip in the books.
`public/get_funding_rate_history` returns hourly candles of the per-hour rate, and its first v3 row on every perpetual is 2026-10-06 18:00 UTC, [`rest.md`](./rest.md) section 4.
The funding instant itself was not captured, because there is none to capture.

## 7. Liquidation, settlement and delisting charges

- A liquidated subaccount pays 10 % of the liquidated portfolio value, marked to market, S1.
- A negative USDC balance pays interest on a utilisation curve, S1.
- Perpetuals have no expiry settlement, so they carry no settlement fee, S4 and S9.
- A retired perpetual is given a `frozen_price` and is force-closed at that price the next time its account is touched, S4 and S9.
  No fee for that close is documented.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` on a perpetual, no credentials | `0.0003`, 300 ppm, on 15 of 15 swaps | P1 and P2 `Probed` |
| where it comes from | each market's own `taker_fee_rate` field | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/derive.js` line 702, and `maker` from `maker_fee_rate` at line 703 |
| class constant | none, `fees` is `{}` | the same file, line 280 |
| host it reads | `https://api.lyra.finance/public`, the v2 API | the same file, line 143 |
| `quote` on every swap | `USD`, from the v2 row's `quote_currency`, while v3 says `USDC` | the same file, lines 633 and 635, and P1 and P2 |

The v2 rows that CCXT reads carry the same taker and maker rates as v3, `0.0003` and `0.0001`, P1 and P2.
So CCXT's taker is right today, although the host it reads stopped trading on 2026-10-06, [`rest.md`](./rest.md) section "Decentralised layer".
CCXT ignores `base_fee`, since `parseMarket` at lines 623 to 731 never reads it.

## 9. Recommended registry values

- `takerPpm` 300.
  It is the base perpetual taker rate of S1 and of every instrument row.
  The 0.01 USDC base fee is left out because the engine's fee is a rate, and it adds 10 ppm or less on any fill of 1,000 USDC or more.
- `ccxtTakerPpm` 300.
  It is what CCXT 4.5.68 reports per market, read from the venue's own field at line 702, so it has no source constant to cite.

## 10. Source ledger

| id | source | used for |
|---|---|---|
| S1 | [Trading Fees on Derive](https://docs.derive.xyz/integrators/trading/trading-fees), retrieved 2026-10-12 | maker, taker, base fee, tiers, discounts, liquidation fee |
| S2 | [Perpetuals](https://docs.derive.xyz/perpetuals), retrieved 2026-10-12 | funding formula, convergence, caps, mark clamp |
| S3 | [Perp Funding](https://docs.derive.xyz/perp-funding), retrieved 2026-10-12 | older caps, per-hour unit, who pays |
| S4 | [Supported Products](https://docs.derive.xyz/supported-products), retrieved 2026-10-12 | continuous settlement, frozen price |
| S5 | [Terms of Use](https://www.derive.xyz/terms-of-use), retrieved 2026-10-12, updated 2026-09-23, effective 2026-10-03 | legal entity, Restricted Person |
| S6 | [app fee page](https://app.derive.xyz/fees), its embedded announcement feed, retrieved 2026-10-12 | Terms date, paused rewards, staking discounts, v3 migration |
| S7 | [Error Codes](https://docs.derive.xyz/error-codes), retrieved 2026-10-12 | `restricted_region` |
| S8 | [Integrators and Market Makers](https://docs.derive.xyz/integrators/introduction), retrieved 2026-10-12 | institutional and broker programs |
| S9 | [Settlement](https://docs.derive.xyz/settlement), retrieved 2026-10-12 | perpetual settlement |
| S10 | [Changelog](https://docs.derive.xyz/changelog), retrieved 2026-10-12 | `AssetType` enum |
| S11 | [Migration skill for your coding agent](https://docs.derive.xyz/migrating/breaking-changes), retrieved 2026-10-12 | v3 wallets and hosts |
| S12 | [Introduction](https://docs.derive.xyz/getting-started/introduction), retrieved 2026-10-12, and its OpenAPI file `https://docs.derive.xyz/openapi.json` | endpoints, schemas |
| P1, P2 | [`fees-probe.py`](../../../scripts/probes/venues/derive/fees-probe.py) at 22:29 and 22:37 UTC, and [`rest-probe.py`](../../../scripts/probes/venues/derive/rest-probe.py) modes `catalog` and `funding` | CCXT taker, instrument fee fields, caps, coverage counts |
| CCXT | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/derive.js` | lines 143, 280, 623 to 731, 633, 635, 702 and 703 |
