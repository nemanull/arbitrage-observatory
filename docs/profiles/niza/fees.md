# Niza Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, in the local evening, which is 02:36 to 03:05 UTC on 2026-09-23.

This profile covers the perpetuals CoinGecko lists as Niza.fun (Futures), and names the Niza.io spot exchange once in the coverage matrix.
Niza.fun is not an exchange with its own matching engine.
It is a front end on Orderly Network, registered there as the builder `niza`, so its perpetuals trade on Orderly's shared order book.
The book, catalog, index, mark and funding in this profile are therefore Orderly's, and only the user fee is set by Niza.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/niza/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/niza/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | Niza.fun (Futures), CoinGecko id `niza-fun-futures`, "established 2025", country "United Kingdom", 80 perpetual pairs, 0 dated futures | S8 |
| related spot exchange | Niza.io (Niza Global), CoinGecko id `niza-global`, "established 2021", country "Lithuania" | S9 |
| builder id on Orderly | `niza`, name `Niza`, from `OrderlyConfigProvider` with `networkId:"mainnet"` in the niza.fun bundle, and `GET /v1/public/broker/name?broker_id=niza` answers `{"broker_id":"niza","broker_name":"Niza"}` | S10, P1 |
| matching and custody | Orderly Network, an omnichain order book shared by every builder | S1 |
| legal entity of Niza.fun | Not publicly specified. `https://niza.fun/terms`, `/terms-of-service`, `/privacy` and `/faq` answered 404 on 2026-09-22 | P1 |
| who may trade | Orderly's terms exclude any US Person under Regulation S, any access from a US IP address or a US location, and any Restricted Person, which includes sanctioned parties and residents of Cuba, North Korea and Iran | S6 |
| builders | Orderly's terms say an integrator "shall not offer or attempt to offer our Services to any US Person or any Restricted Person", so the exclusion binds Niza.fun | S6 |
| US persons | may not trade | S6 |
| access from this host | Orderly REST and WebSocket answered every public call, with no geoblock. `GET https://api.orderly.org/v1/ip_info` placed this host in Canada with `"checked": false` | P1 |
| Niza's own flow | `GET /v1/public/volume/stats?broker_id=niza` reported 0 USDC in the last 7 days, 1,227 USDC in the last 30 days and 3,566 USDC lifetime, and `/v1/public/broker/stats?broker_id=niza` reported 28 connected users | P1 |
| Orderly's flow | the same call without `broker_id` reported 38.3 million USDC in the last day, which matches the 453.97 BTC a day CoinGecko shows for Niza.fun, so CoinGecko's volume is Orderly's whole book | P1, S8 |

## 2. Quick answer

| family | maker | taker | status of the number |
|---|---|---|---|
| USDC-settled linear perpetuals, the 80 shared Orderly markets | Not publicly specified | 0.05 % = 500 ppm as the niza.fun order form estimates it | a front end estimate, not a published schedule |

Niza publishes no fee page for its perpetuals.
The only Niza-specific figure is the order form in the niza.fun bundle, which computes the fee it displays as `l=5e-4*i`, 0.05 % of the order's notional, for buy and sell and for market and limit orders alike, S10.
The rate actually charged is the builder's default fee rate stored on Orderly, which only the builder's private API or a per-wallet query can read, S2 and S12.
This profile did not query a trader's wallet to read it.
Orderly's rule bounds it from below: a builder's user taker fee cannot be less than its Orderly base taker fee, which is 3.00 bps, 300 ppm, at the Public tier, S1 and S2.
So the Niza taker is at least 300 ppm, and 500 ppm is what Niza shows its users.

## 3. Coverage matrix

| product | present | detail |
|---|---|---|
| USDC-settled linear perpetuals, shared | yes | 80 markets named `PERP_<BASE>_USDC` with `broker_id` null, all `ACTIVE`, exactly the 80 CoinGecko lists for Niza.fun, P1 |
| builder-listed perpetuals on Orderly | not Niza's | 59 more markets are listed by other builders under a suffix: 57 `_mythos`, 1 `_alpix` and 1 `_fastx`. None carries `_niza`, P1 |
| USDT or coin-margined perpetuals | no | every Orderly market settles in USDC, P1 |
| dated futures | no | CoinGecko reports 0 futures pairs, S8, and Orderly lists only `PERP_` symbols, P1 |
| options | no | none listed, P1 |
| spot | yes, on Niza.io | Niza Global spot at `https://app.niza.io/trade/v1`, 1,305 pairs on 2026-09-22. `https://niza.io/` answered 402 `DEPLOYMENT_DISABLED`, and `https://api.niza.io/` presents a Cloudflare Origin certificate that public clients cannot verify, P1, S11 |
| other Niza products | named only | the Niza ecosystem site at `https://nizaecosystem.com/` names a NIZA L1, a DEX and a REIT beside the Perp DEX, not researched |

The shared perpetuals include RWA markets, `EURUSD`, `USDJPY`, `NAS100`, `SPX500`, `GOOGL`, `NVDA`, `TSLA`, `XAU`, `XAG`, `CL` and `BZ`, whose index freezes while the underlying market is closed, S4.

## 4. Perpetual tiers

Niza publishes no user tier table.
Orderly lets a builder assign per user fee rates in increments of 0.00001, S2, so tiers may exist without being published.

The layer below the user fee is Orderly's base fee, which Orderly charges the builder, not the trader, S1.

| builder tier | qualification | base taker | maker rebate cap |
|---|---|---:|---:|
| Public | under 100K ORDER staked and under 50M USDC monthly volume | 3.00 bps, 300 ppm | 0.00 bps |
| Silver | 50M USDC monthly volume or 100K ORDER staked | 2.75 bps, 275 ppm | -0.05 bps |
| Gold | 200M USDC monthly volume or 300K ORDER staked | 2.50 bps, 250 ppm | -0.10 bps |
| Platinum | 750M USDC monthly volume or 3M ORDER staked | 2.00 bps, 200 ppm | -0.15 bps |
| Diamond | 2B USDC monthly volume or 7M ORDER staked | 1.00 bps, 100 ppm | -0.20 bps |

The same base fees apply to crypto and RWA markets, and a builder may set different user fees for each, S1.
Niza's monthly volume puts it at Public unless it stakes ORDER, which this profile could not observe.

## 5. Discounts that change the perpetual taker

- Token holding: none published by Niza.
  The NIZA coin is marketed with staking benefits on Niza Global spot, S9, and no perpetual fee discount is published for it.
- Referral: Orderly offers builders a referral and affiliate programme, S2, and Niza publishes no referral rate.
- Market maker: Not publicly specified.
- Zero fee promotions: none found.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `clamp[F(average premium) + clamp(interest - average premium, floor_ir, cap_ir) / (8/N), floor_funding, cap_funding]`, with the premium from impact bid and ask against the index sampled every 15 s | S3 |
| premium function | slope 1 under 0.5 %, slope 2 from 0.5 % to 1.5 %, slope 4 above 1.5 % | S3 |
| interest | 0.01 % per 8 h on most markets, `interest_rate` 0.0001 on the wire | S3, P1 |
| interval | 8 h on 40 shared markets and 4 h on 40, from `funding_period` | P1 |
| settlement times | 8 h at 00:00, 08:00 and 16:00 UTC, 4 h every four hours from 00:00 UTC, 1 h on the hour | S3 |
| cap and floor | per market: ±2 % on 52 shared markets, ±0.75 % on 4, ±0.5 % on 6, ±0.4875 % on 4, ±0.45 % on 1, ±0.375 % on 8, ±0.3 % on `BTC` and `ETH`, ±4 % on `MNT`, and -0.5 % to +0.05 % on `NAS100` and `SPX500` | P1 |
| unit | a fraction per funding period, so a 4 h market publishes half the 8 h interest: `CL` settled 0.00005029 against `BTC`'s 0.00005802 to 0.00010048 | P1 |
| who pays | positive rate: longs pay shorts. Negative: shorts pay longs | S3 |
| amount | position size times mark price times rate | S3 |
| booking | accrued at each settlement time, and moved into the balance when a PnL settlement runs on the account | S3 |

The documentation's funding table has 88 rows, S3.
Its interval matches the wire's `funding_period` on all 80 shared markets, P1.
Its cap matches `cap_funding` on 78 of them, and on `NAS100` and `SPX500` the table says ±0.2 % while the wire says a cap of 0.05 % and a floor of -0.5 %.
Eight rows, `DASH`, `ICP`, `IP`, `LDO`, `LINEA`, `SKR`, `WLFI` and `ZEN`, name markets the catalog no longer lists.
The settlement instant itself was not captured, and the history call is the evidence, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | 0.60 % of notional on `BTC`, `ETH` and `SOL`, 1.20 % on the other 77 shared markets, from `std_liquidation_fee` | S5, P1 |
| liquidator's share | 0.30 % and 0.60 %, from `liquidator_fee`, taken out of the liquidation fee, with the rest to the insurance fund | S5, P1 |
| trade fees | charged in USDC after every trade and folded into the position's average entry price | S1 |
| delisting | a market whose monthly volume stays under 20 million USDC is delisted directly | S7 |
| delisting charge | Not publicly specified | |
| deposit and withdrawal | the niza.fun deposit flow reads a per chain deposit fee from the Orderly SDK, see the bundle, and is out of scope | S10 |

Many shared markets sit below the 20 million USDC delisting floor on a monthly basis.
`AXS`, `1000SHIB` and `BASED` traded 0 USDC and `MERL` 11 USDC in the 24 h before the probe, P1.

## 8. CCXT

CCXT 4.5.68 has no class for Niza or Niza.fun.
`require('ccxt').exchanges` from `server/` lists 104 ids and none matches `niz`, P1.
The CCXT master tree `ts/src` on GitHub, at commit `1d8b674` of 2026-09-22 12:48 UTC, has no file matching `niz` either.

CCXT does have `woofipro`, the class for WOOFi Pro, another Orderly builder, and it reads the same public Orderly API at `https://api-evm.orderly.org`, `server/node_modules/ccxt/js/src/woofipro.js` line 153.
Its markets are Orderly's markets, so `loadMarkets` returns the same 139 symbols `GET /v1/public/info` lists, with ids identical to the wire, P1.

| field | value from `woofipro` without credentials | source |
|---|---|---|
| `market.taker` | 0.0005, 500 ppm, on all 139 markets | `server/node_modules/ccxt/js/src/woofipro.js` line 318, P1 |
| `market.maker` | 0.0002, 200 ppm | same file, line 317 |
| `contractSize` | 1 | same file, line 570 |
| `active` | `undefined` on every market | same file, line 566 |

The 500 ppm constant is WOOFi Pro's retail default in CCXT and not a Niza number.
It equals the niza.fun order form estimate by coincidence of round numbers, and neither is proof of what Niza charges.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| key | value | reason |
|---|---|---|
| `createExchange` | `() => new ccxt.woofipro()` | no Niza class exists, and `woofipro` loads the same Orderly catalog with matching ids |
| `takerPpm` | 500 | the fee niza.fun shows its users, section 2. It is above Orderly's 300 ppm floor, and it must be replaced by the builder's real default rate if Niza ever publishes it |
| `ccxtTakerPpm` | 500 | `woofipro.js` line 318 |
| `marketFilter` | `(m) => /^PERP_[A-Z0-9]+_USDC$/.test(m.id)` | keeps the 80 shared markets Niza.fun lists and drops the 59 builder-listed ones, see [`rest.md`](./rest.md) section 2 |

Registering Niza.fun is registering Orderly's shared book under Niza's fee.
Any other Orderly builder, WOOFi Pro included, would add the same book again, so the engine should carry at most one Orderly leg.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Orderly, Trading fees | https://orderly.network/docs/introduction/trade-on-orderly/trading-basics/trading-fees | 2026-09-22 | Orderly Network | two layer fee, builder tiers, fee booking, sections 1, 2, 4 and 7 |
| S2 | Orderly, Custom fees | https://orderly.network/docs/build-on-omnichain/user-flows/custom-fees | 2026-09-22 | Orderly Network | builder-set user fees, the base fee floor, 0.00001 increments, sections 2, 4 and 5 |
| S3 | Orderly, Funding Rate | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/funding-rate | 2026-09-22 | Orderly Network | formula, schedule, payer, booking, section 6 |
| S4 | Orderly, Mark Price, Index Price, and Last Price | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/mark-price-index-price-and-last-price | 2026-09-22 | Orderly Network | RWA index frozen off market, section 3 |
| S5 | Orderly, Liquidations | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/liquidations | 2026-09-22 | Orderly Network | liquidation and liquidator fees, section 7 |
| S6 | Orderly, Terms of Service | https://orderly.network/docs/introduction/terms-of-service | 2026-09-22 | Orderly Network, Panama arbitration | US Person and Restricted Person exclusion, integrator duty, section 1 |
| S7 | Orderly, Delisting Standards | https://orderly.network/docs/introduction/delisting-standards | 2026-09-22 | Orderly Network | 20 million USDC monthly floor, section 7 |
| S8 | CoinGecko derivatives exchange `niza-fun-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/niza-fun-futures?include_tickers=all | 2026-09-22 | CoinGecko | 80 perpetuals, 0 futures, volume, country, section 1 |
| S9 | CoinGecko exchange `niza-global` | https://api.coingecko.com/api/v3/exchanges/niza-global | 2026-09-22 | CoinGecko | Niza.io spot, country, NIZA coin, sections 1 and 5 |
| S10 | niza.fun Next.js bundle, chunks `a358826a986120cc.js` (builder id), `416c9fb852bf607b.js` (order form fee) and `f13c02127efabf3f.js` (deposit fee) | https://niza.fun/_next/static/chunks/ | 2026-09-22 | Niza.fun | builder id, displayed fee, sections 1, 2 and 7 |
| S11 | Niza Global API docs, General | https://docs.niza.io/general | 2026-09-22 | Niza Global | spot request URL `https://app.niza.io/trade/v1`, section 3 |
| S12 | Orderly Public Info API, Fee rate | https://orderly.network/docs/build-on-omnichain/public-info-api/account/fee-rate | 2026-09-22 | Orderly Network | fee rates readable only per wallet address, section 2 |
| S13 | CCXT 4.5.68 `woofipro.js` | `server/node_modules/ccxt/js/src/woofipro.js` | 2026-09-22 | CCXT | API host, fee constants, `contractSize`, `active`, section 8 |
| P1 | `rest-probe.mjs catalog` at 02:45 and 02:55 UTC on 2026-09-23, with curl reads of the niza hosts and CoinGecko from 02:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/niza/rest-probe.mjs) | 2026-09-22 | this host | builder stats, catalog, caps, liquidation fees, hosts, sections 1 to 8 |
