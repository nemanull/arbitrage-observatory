# NonKYC Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, from the development host near Seattle, between 04:49 and 05:05 UTC on 2026-09-23, and again in the second pass between 05:07 and 05:14 UTC, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

Nonkyc.io (no CCXT class) runs its own spot exchange, and its perpetuals live on a separate front end, `perp.nonkyc.io`.
That front end is registered on Orderly Network as the builder `nonkyc`, so its perpetuals trade on Orderly's shared order book.
The same book is already profiled as Niza.fun in [`../niza/fees.md`](../niza/fees.md), and this profile records what is specific to NonKYC.
The spot exchange appears only in the coverage matrix, as the survey plan's scope guard asks.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/nonkyc/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | NonKYC fee page, terms, perp front end config and bundle, Orderly documentation and terms, read on 2026-09-22 Pacific time | S1 to S13 |
| perpetual front end | `https://perp.nonkyc.io/`, linked as "DEX / PERP" in the nonkyc.io menu, a single-page app served from GitHub Pages behind Cloudflare | S3, S4 |
| builder id on Orderly | `nonkyc`, from `"VITE_ORDERLY_BROKER_ID": "nonkyc"` and `"VITE_DEPLOYMENT_ENV": "mainnet"` in `https://perp.nonkyc.io/config.js`, and `GET /v1/public/broker/name?broker_id=nonkyc` answers `{"broker_id":"nonkyc","broker_name":"NonKYC"}` | S3, P1 |
| matching and custody | Orderly Network, an omnichain order book shared by every builder, run by Orderly Network Ltd. under the laws of Panama | S5, S6 |
| NonKYC operator | the terms say the site is "operated by Nonkyc.io" and name no company, address or governing law, last updated April 21, 2024 | S2 |
| NonKYC country | CoinGecko lists Nonkyc.io as Seychelles, established 2023, trust score 3, trust rank 148 on the API at probe time | S10 |
| who may trade the perpetuals | Orderly "does not offer its Services to any "United States person" as defined under Regulation S", and users "shall also not access our Services via any U.S. IP address or from a location within the U.S." | S5 |
| sanctioned persons | Orderly excludes any "Restricted Person", the subject of sanctions or on a restricted party list of the UN, the US, the EU or others | S5 |
| builders | Orderly's terms say "as an Integrator of Orderly's Services, you shall not offer or attempt to offer our Services to any US Person or any Restricted Person", so the exclusion binds NonKYC | S5 |
| NonKYC's own rules | the NonKYC terms exclude no region and require only age 18 and legal capacity, and the perp front end config sets `"VITE_RESTRICTED_REGIONS": ""` and `"VITE_WHITELISTED_IPS": ""` | S2, S3, P1 |
| US persons | may not trade, by Orderly's terms | S5 |
| NonKYC's own perpetual flow | `GET /v1/public/volume/stats?broker_id=nonkyc` reported 9,903.70 USDC in the last day, 148,538.81 USDC in the last 7 days, 618,371.50 USDC in the last 30 days and 912,810.47 USDC lifetime, which equals its year to date, and `/v1/public/broker/stats?broker_id=nonkyc` reported 219 connected users | P1 |
| Orderly's flow | the same call without `broker_id` reported 38,344,440 USDC in the last day and 264,296,777 USDC in the last 7 days, so NonKYC is about 0.026 % of the book it trades on | P1 |
| CoinGecko | the derivatives exchange list of 214 entries has no NonKYC entry, and lists Orderly as `orderly_network_derivatives_evm` | S10 |
| access from this host | every public Orderly REST call answered 200, the Orderly socket opened in 155 to 255 ms, and `https://perp.nonkyc.io/`, `https://nonkyc.io/` and `https://api.nonkyc.io/` answered 200. Orderly's `/v1/ip_info` answered `{"city":"Vancouver","ip":"216.246.31.78","checked":false,"region":"Canada"}`. These results are from the Canadian VPN exit, not from a US address | P1, P2 |

## 2. Quick answer

| family | maker | taker | status of the number |
|---|---|---|---|
| USDC-settled linear perpetuals, the 80 shared Orderly markets | 0.15 % = 1,500 ppm on the builder's own account | 0.15 % = 1,500 ppm on the builder's own account | the only NonKYC-specific rate found, not a published schedule |

NonKYC publishes no fee page for its perpetuals, and the nonkyc.io fee page describes the spot exchange only, S1.
The perp front end reads the fee from the logged-in account (`futures_taker_fee_rate` from the account info), and it hardcodes no estimate, S3.
The rate actually charged is the builder's default fee rate stored on Orderly, and Orderly exposes that default only through the builder's private API, S7.
Orderly's zero-auth query API returns the fee rate of any account by wallet address, S8.
The front end config publishes the builder's own address as `VITE_BROKER_EOA_ADDRESS`, `0x7ef1da01fad1d4bbef316008bd3155ba50258a68`, S3.
For that address under `broker_id` `nonkyc`, the `feeRate` query returned one main account with `"maker_fee_rate":"0.0015"`, `"taker_fee_rate":"0.0015"` and `"30d_volume":"0"`, P1.
The unit is a decimal rate, `bps / 10000`, S8, so this is 15 bps, 0.15 %, 1,500 ppm, for maker and taker alike.
It is the builder's own account, which has never traded, and whether ordinary users get the same default rate is an inference.
Orderly's rule bounds the user taker from below: a builder's user taker fee "cannot be less than the Orderly base fee", which is 3.00 bps, 300 ppm, at the Public tier, S6 and S7.
No trader wallet was queried.

## 3. Coverage matrix

| product | present | note |
|---|---|---|
| USDC-settled linear perpetuals, shared Orderly markets | yes | 80 markets named `PERP_<BASE>_USDC` with `broker_id` null, all `ACTIVE`, 40 on 8 h funding and 40 on 4 h, including RWA markets such as `PERP_XAU_USDC`, `PERP_SPX500_USDC` and `PERP_EURUSD_USDC`, P1 |
| builder-listed perpetuals on Orderly | not NonKYC's | 59 more markets carry another builder's suffix: 57 `_mythos`, 1 `_alpix` and 1 `_fastx`, and none carries `_nonkyc`, P1 |
| USDT-margined perpetuals | no | Orderly settles everything in USDC, P1 |
| coin-margined perpetuals | no | P1 |
| dated futures | no | no dated contract in `/v1/public/info`, P1 |
| options | no | P1 |
| spot, NonKYC's own exchange | yes | its own order book, not Orderly's. 323 markets on `GET https://api.nonkyc.io/api/v2/market/getlist`, all `isActive` true, 232 quoted in USDT, 32 in BTC, 17 in USDC and 11 in XMR, P1. VIP 0 fee 0.2 % on the fee grid of 30 day volume and NKYC holdings, S1. REST API described by `https://api.nonkyc.io/openapi.json`, and the socket at `wss://ws.nonkyc.io` opened in 699 and 700 ms, P2. CCXT 4.5.68 has no class, and CCXT pull request #26713 would add a spot-only one, S11 |
| deposits and withdrawals | not recorded | the NonKYC fee page says "All withdrawal fees are $1, except for expensive networks such as ERC-20, BTC, and similar chains", S1. Orderly deposit and withdrawal fees are on Orderly's documentation |

## 4. Perpetual tiers

NonKYC publishes no user tier table for its perpetuals.
Orderly lets a builder set a default rate and per user rates in increments of 0.00001, S7, so tiers may exist without being published.
The spot fee grid on nonkyc.io, from 0.2 % down by 30 day volume and NKYC holdings, is not stated to apply to the perpetuals, S1.

The layer below the user fee is Orderly's base fee, which Orderly charges the builder, not the trader, S6.

| builder tier | qualification | base taker | maker rebate cap |
|---|---|---:|---:|
| Public | under 100K ORDER staked and under 50M USDC monthly aggregate volume | 3.00 bps, 300 ppm | 0.00 bps |
| Silver | 50M USDC monthly aggregate volume or 100K ORDER staked | 2.75 bps, 275 ppm | -0.05 bps |
| Gold | 200M USDC monthly aggregate volume or 300K ORDER staked | 2.50 bps, 250 ppm | -0.10 bps |
| Platinum | 750M USDC monthly aggregate volume or 3M ORDER staked | 2.00 bps, 200 ppm | -0.15 bps |
| Diamond | 2B USDC monthly aggregate volume or 7M ORDER staked | 1.00 bps, 100 ppm | -0.20 bps |

The same base fees apply to crypto and RWA markets, S6.
NonKYC's 618,371.50 USDC over 30 days puts it at Public unless it stakes ORDER, which this profile could not observe, P1.
The `feeRate` reply for the builder's own account carried `"tier":null`, P1.

## 5. Discounts that change the perpetual taker

- Token holding: the fee page offers "Pay trade fees with NonKYC (NKYC) and get a 25% discount" on the spot exchange, S1.
  No perpetual discount is published.
- Referral: nonkyc.io links a `/referralprogram` page for the spot exchange, which was not read, and no perpetual referral rate is published.
  Orderly offers builders a referral programme, S7.
- Market maker: nonkyc.io links `/marketmaking` for spot, and nothing for perpetuals.
- Zero fee promotions: none found.
  The perp front end config sets `"VITE_ENABLE_CAMPAIGNS": "false"`, S3.

## 6. Funding as a cost

Funding is Orderly's, identical for every builder, S9.

| item | value | source |
|---|---|---|
| formula | `Funding Rate = clamp[Funding Function(Average Premium) + clamp(Interest Rate - Average Premium, cap_ir, floor_ir) / (8/N), Cap Funding, Floor Funding]` | S9 |
| premium | `[Max(0, Impact Bid Price - I) - Max(0, I - Impact Ask Price)] / I`, sampled every 15 s and averaged over the period, 1,920 samples for 8 h | S9 |
| funding function | slope 1 under 0.5 %, slope 2 from 0.5 % to 1.5 %, slope 4 above 1.5 % of average premium | S9 |
| interest rate | 0.01 % for most markets, `interest_rate` 0.0001 on `PERP_BTC_USDC` | S9, P1 |
| interval | `funding_period` 8 h on 40 shared markets and 4 h on 40, settling at 00:00, 08:00 and 16:00 UTC for 8 h and every 4 h from 00:00 UTC for 4 h | S9, P1 |
| cap and floor | per market `cap_funding` and `floor_funding`: ±2 % on 52 shared markets, ±0.3 % on `PERP_BTC_USDC` and `PERP_ETH_USDC`, and seven other values on the rest | P1 |
| who pays | "Positive funding rate: longs pay shorts", "Negative funding rate: shorts pay longs", accrued as `Position Size × Mark Price × Funding Rate` | S9 |
| when it is booked | accrued at each settlement time, and settled into the balance when a PNL settlement is triggered on the account | S9 |
| NonKYC's share | none. Funding flows between traders on Orderly's book | S9 |

Settlement behaviour here comes from the documentation and the funding history call, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

- Liquidation: `std_liquidation_fee` is 1.2 % on 77 shared markets and 0.6 % on 3, and `liquidator_fee` is 0.6 % on 77 and 0.3 % on 3, from `/v1/public/info`, P1.
  `PERP_BTC_USDC` has 0.6 % and 0.3 %.
  The fee is split between the liquidator and Orderly's Insurance Fund, S12.
- Settlement: perpetuals have no expiry.
- Delisting: Orderly's standard says a project "whose monthly trading volume consistently falls below the absolute threshold of $20 million will be directly delisted", S12.
- NonKYC charges no perpetual-specific withdrawal or settlement fee that this profile found.

## 8. CCXT

CCXT 4.5.68, the version pinned in `server/`, has no NonKYC class.
`node -e "console.log(require('ccxt').exchanges)"` run from `server/` lists 104 ids and none matches `nonk` or `kyc`, and `server/node_modules/ccxt/js/src/` holds no such file, P1.
CCXT master on GitHub has no class either on 2026-09-22: `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/nonkyc.ts` and `.../ts/src/pro/nonkyc.ts` return 404, and `exchanges.json` on master has no `nonkyc` id, S11.
Pull request #26713, "new exchange: NonKyc", opened 2025-08-23 by GitHub user tblock0x, is open and unmerged, and it adds a spot-only REST class with `'swap': undefined` and `'fees': { 'trading': { 'tierBased': false, 'percentage': true, 'taker': 0.002, 'maker': 0.002 }}` at line 99 of its `ts/src/nonkyc.ts`, S11.
Issue #21401, "New Exchange: NonKYC", opened 2024-02-27, is also open, S11.

For the perpetuals, CCXT does have `woofipro`, the class for WOOFi Pro, another Orderly builder, which reads the same public Orderly API at `https://api-evm.orderly.org`, `server/node_modules/ccxt/js/src/woofipro.js` line 153.

| field | what `woofipro` reports without credentials | source |
|---|---|---|
| `market.taker` | 0.0005, 500 ppm, on all 139 swaps | `woofipro.js` line 318, P1 |
| `market.maker` | 0.0002, 200 ppm | `woofipro.js` line 317, P1 |
| `tierBased` | true | `woofipro.js` line 315 |
| `contractSize` | 1 on all 139 | `woofipro.js` line 570, P1 |
| `active` | `undefined` on all 139, which the connector's `market.active !== false` lets through | `woofipro.js` line 566, [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203 |

The 500 ppm constant belongs to WOOFi Pro's schedule and says nothing about NonKYC's builder rate.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `createExchange` | `() => new ccxt.woofipro()` | no NonKYC class exists, and `woofipro` loads the same Orderly catalog |
| `takerPpm` | 1,500 | the rate on the builder's own `nonkyc` account, section 2. It is above Orderly's 300 ppm floor, and it must be replaced by the builder's real default rate if NonKYC ever publishes it |
| `ccxtTakerPpm` | 500 | what `woofipro.js` line 318 reports, so the connector does not warn |
| `marketFilter` | `(m) => /^PERP_[A-Z0-9]+_USDC$/.test(m.id)` | keeps the 80 shared markets and drops the 59 builder-listed ones, see [`rest.md`](./rest.md) section 2 |

Registering NonKYC would not add a new book.
Every Orderly builder, Niza.fun and WOOFi Pro included, shares this one book, so the engine should carry at most one Orderly leg, and the leg's taker should be the builder the engine would actually trade through.
At 1,500 ppm NonKYC is the dearest Orderly route found so far, against 500 ppm shown by niza.fun, see [`../niza/fees.md`](../niza/fees.md).

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | NonKYC Fees | https://nonkyc.io/fees | 2026-09-22 | Nonkyc.io | spot fee grid, NKYC discount, withdrawal line, sections 2 to 5 |
| S2 | NonKYC Terms and Conditions, last updated April 21, 2024 | https://nonkyc.io/legal/terms | 2026-09-22 | Nonkyc.io | operator, eligibility, no region exclusion, section 1 |
| S3 | perp.nonkyc.io front end: `config.js` and bundle `assets/index-BepQawLP.js` | https://perp.nonkyc.io/config.js | 2026-09-22 | NonKYC perp | builder id, mainnet, builder address, empty restricted regions, campaigns off, fee read from the account, sections 1, 2 and 5 |
| S4 | nonkyc.io home page | https://nonkyc.io/ | 2026-09-22 | Nonkyc.io | the "DEX / PERP" menu link to `https://perp.nonkyc.io/`, section 1 |
| S5 | Orderly Network Ltd. Terms of Use | https://orderly.network/docs/introduction/terms-of-service | 2026-09-22 | Orderly Network Ltd., Panama law and arbitration | US Person, US IP and Restricted Person exclusion, integrator duty, section 1 |
| S6 | Orderly, Trading fees | https://orderly.network/docs/introduction/trade-on-orderly/trading-basics/trading-fees | 2026-09-22 | Orderly Network | shared book, two layer fee, base fee tiers, builder floor, sections 1, 2 and 4 |
| S7 | Orderly, Custom fees | https://orderly.network/docs/build-on-omnichain/user-flows/custom-fees | 2026-09-22 | Orderly Network | default rate readable through the private `GET /v1/broker/fee_rate/default`, 0.00001 increments, base fee floor, sections 2, 4 and 5 |
| S8 | Orderly Public Info API, Fee rate and Overview | https://orderly.network/docs/build-on-omnichain/public-info-api/account/fee-rate | 2026-09-22 | Orderly Network | per address fee query, decimal unit `bps / 10000`, section 2 |
| S9 | Orderly, Funding Rate | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/funding-rate | 2026-09-22 | Orderly Network | formula, schedule, payer, booking, section 6 |
| S10 | CoinGecko exchange `nonkyc_io` and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/nonkyc_io | 2026-09-22 | CoinGecko | country, trust rank, no NonKYC derivatives entry, section 1 |
| S11 | CCXT master and pull request #26713 at head `a8161c4b`, issue #21401 | https://github.com/ccxt/ccxt/pull/26713 | 2026-09-22 | CCXT | no class on master, spot-only proposal, section 8 |
| S12 | Orderly, Liquidations and Delisting Standards | https://orderly.network/docs/introduction/delisting-standards | 2026-09-22 | Orderly Network | liquidation fee split, 20 million USD monthly floor, section 7 |
| S13 | CCXT 4.5.68 `woofipro.js` | `server/node_modules/ccxt/js/src/woofipro.js` | 2026-09-22 | CCXT | API host, fee constants, `contractSize`, `active`, section 8 |
| P1 | `rest-probe.mjs catalog`, `anchor`, `book` and `errors` at 04:49 to 04:51 UTC on 2026-09-23, `catalog` again at 05:04 UTC, and all four rerun at 05:07 to 05:09 UTC, with curl reads of nonkyc.io, CoinGecko and GitHub from 04:40 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/nonkyc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | builder id, flow and fee rate, catalog, caps, liquidation fees, spot catalog, CCXT, sections 1 to 9 |
| P2 | `ws-probe.mjs book`, `batch`, `cap`, `silence`, `deflate` and `spot` at 04:53 to 04:59 UTC on 2026-09-23, rerun at 05:09 to 05:14 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket access, spot socket access, sections 1 and 3 |
