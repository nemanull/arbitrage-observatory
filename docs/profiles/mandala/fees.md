# Mandala Exchange Fees Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:45 to 06:55 UTC by the host clock (evening of 2026-09-23 in Seattle), from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the USDT-margined perpetuals of Mandala Exchange, the only perpetual family the venue lists.
The public API at `api.trade.mandala.exchange` is shaped like the HitBTC API v3 (paths under `/api/3`, `_PERP` contract codes, the `take_rate` and `make_rate` catalog fields), and CCXT's `hitbtc` class parses it, see [`rest.md`](./rest.md) section 2.
Every number below carries a source or a probe reference, and the probes are [`rest-probe.mjs`](../../../scripts/probes/venues/mandala/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/mandala/ws-probe.mjs).

## 1. Scope and freshness

- Operator: Mandala Exchange, Ltd., per the Terms and Conditions updated 2025-10-29 (S3).
  Those terms are governed by the laws of Bulgaria (section 18 of S3).
  A search engine summary of an older version named the Seychelles, which the archived 2025-10-29 text does not say.
- Excluded regions, per the Restricted Countries article updated 2025-10-08 (S2): USA, Ontario (Canada), United Kingdom, Afghanistan, Algeria, Bangladesh, Bolivia, Dubai, Egypt, Indonesia, Iran, Iraq, North Korea, Kuwait, Nepal, Oman, Pakistan, Qatar, Saudi Arabia, Seychelles, Sudan, Syria, Thailand, Venezuela.
- US persons may not trade.
  The article gives no product level carve-out, so the list applies to the perpetuals as well.
- The help center at `support.mandala.exchange` answered this host with HTTP 403 and the Cloudflare page titled "Edge IP Restricted" on 2026-09-24, both on the article URLs and on the Zendesk JSON API.
  WebFetch, which does not originate here, got HTTP 403 as well.
  The fee, restricted countries and terms articles were therefore read from their Wayback Machine captures (S1, S2, S3).
- The public trading API at `api.trade.mandala.exchange` answered every public call from this host with HTTP 200, see [`rest.md`](./rest.md) section 1.
  All access results are from the Canadian VPN exit, and Ontario is on the excluded list, but no public market data call was refused.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.06 %, 600 ppm | 0.06 %, 600 ppm | S1 "Futures - based on volume" level 0, and `make_rate` `"0.0006"`, `take_rate` `"0.0006"` on all 24 perpetuals in the public `/api/3/public/symbol` reply (probe `catalog`) |

The maker fee equals the taker fee, so there is no maker rebate.
The S1 table "Futures - based on MDX holdings" prints 0.061 at level 0, while its heading says "0.06% Base fee" and the volume table and the wire both say 0.06 %.
The 0.061 is taken as a typo, and the wire value of 600 ppm is the one recorded.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 24 active | `type` `futures`, `contract_type` `perpetual`, `status` `working`, quote and fee currency USDT, probe `catalog` |
| USDC-M or other stablecoin perpetuals | no | none in the catalog |
| coin-margined perpetuals | no | none in the catalog |
| dated futures | no | the API documents a `cash_settled` contract type (S4), and the catalog lists none |
| options | no | not in the API reference (S4) |
| spot | yes, 402 symbols | quotes USDT 261, BTC 97, USDC 27, ETH 7, and 10 more on small fiat and stablecoin quotes, spot fee 0.2 % both sides (S1, and `take_rate` `"0.002"` in the catalog) |
| margin | yes | `/api/3/margin/*` in S4, not researched |

CoinMarketCap's derivatives ranking named 20 derivatives pairs, and the venue catalog listed 24 perpetuals on 2026-09-24.

## 4. Perpetual tiers

S1 publishes two futures tables, one by MDX holdings and one by 30 day USDT volume.
The fee applied is "on either the amount of MDX held, or the volume of trading made in the rolling 30 day period, whichever is the lower" (S1).
Maker and taker are the same number at every level.

| level | 30 day volume (USDT) | MDX held | fee, maker and taker | ppm |
|---|---|---|---|---|
| 0 | 0 to 250,000 | 0 | 0.06 % | 600 |
| 1 | 250,000 to 500,000 | 50,000 | 0.057 % (0.0571 in the MDX table) | 570 |
| 2 | 500,000 to 1,000,000 | 100,000 | 0.054 % (0.0541 in the MDX table) | 540 |
| 3 | 1,000,000 to 2,500,000 | 150,000 | 0.051 % | 510 |
| 4 | 2,500,000 to 5,000,000 | 200,000 | 0.048 % | 480 |
| 5 | 5,000,000 to 10,000,000 | 250,000 | 0.045 % | 450 |
| 6 | 10,000,000 and above | 300,000 | 0.042 % | 420 |

The heading of the volume table says "0.2% Base fee" while its rows start at 0.06, which is a copy of the spot heading.
The archived article was last updated 2024-02-21 (S1), so the tiers are older than this survey.

## 5. Discounts that change the perpetual taker

- MDX holding: up to 30 % off at 300,000 MDX, which is the same schedule as the volume tiers above (S1).
- Referral: the site links a referral page at `trade.mandala.exchange/settings/referral`, and no terms for it were readable from this host.
  Not verified.
- Market maker program: none found.
  Not verified.
- Zero fee promotions: none found in the catalog, where all 24 perpetuals report 0.0006 on both sides.

## 6. Funding as a cost

- Interval: 8 hours.
  The funding history of `BTCUSDT_PERP` and `ETHUSDT_PERP` shows settlements at 00:00 UTC and 8 hour gaps, and every contract's `next_funding_time` was `2026-09-24T08:00:00.000Z` (probe `anchor`, [`rest.md`](./rest.md) section 3).
- Rate fields: `funding_rate` is the rate "paid in the previous funding period", and `indicative_funding_rate` is the estimate "to be paid after the end of the current funding period" (S4).
  The documentation calls both a percent, while the wire value `0.0001` on BTC reads as a fraction (0.01 % per 8 hours), which is how CCXT `hitbtc` treats it.
- Formula, cap and floor: not publicly specified.
  The documentation names `premium_index`, `avg_premium_index` and a per period `interest_rate` of `0.0001` as inputs (S4), which suggests a premium plus interest formula, but no clamp is published.
- Who is charged: the documentation says funding is a percent of the contract's mark value (S4).
  The payer side is not stated in the readable sources.
  Not verified.
- The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting charges

Not publicly specified in the readable sources.
The help center that would hold them refused this host, see section 1.

## 8. CCXT

- CCXT 4.5.68 has no Mandala class.
  `node -e "console.log(require('ccxt').exchanges)"` from `server/` listed 104 ids and none matched `mandala`, and the current `ts/src` of the CCXT GitHub master has no such file either (checked through the GitHub contents API on 2026-09-24, the only near matches are `hitbtc.ts` and `fmfwio.ts`).
- Because the API is HitBTC v3 in shape, `new ccxt.hitbtc({ urls: { api: { public: 'https://api.trade.mandala.exchange/api/3', private: 'https://api.trade.mandala.exchange/api/3' } } })` loads the Mandala catalog (probe `catalog`).
  That instance reports `market.taker` `0.0006` and `market.maker` `0.0006` on all 24 swaps, read per market from `take_rate` and `make_rate` at `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hitbtc.js` lines 877 and 878.
  The class default of `0.0009` at lines 269 and 270 of the same file is not used for these markets.
- So `ccxtTakerPpm` would be 600 on that override, and `null` in the sense that no CCXT class exists under the venue's own name.

## 9. Recommended registry values

- `takerPpm`: 600, the VIP 0 perpetual taker from S1 and the public catalog.
- `ccxtTakerPpm`: 600, what the `hitbtc` class with the Mandala URL override reports, so the connector's expectation check passes without a warning.
- The registry entry would build the exchange with the override above in `createExchange`, the factory seen at `old_ts_server/src/venues/registry.ts` line 40.

## 10. Source ledger

- S1: Trading Fees article, `https://support.mandala.exchange/hc/en-us/articles/4419805629975-Trading-Fees`, updated 2024-02-21, read from the Wayback capture of 2026-04-20 at `https://web.archive.org/web/20260420005519/https://support.mandala.exchange/hc/en-us/articles/4419805629975-Trading-Fees`.
- S2: Restricted Countries article, `https://support.mandala.exchange/hc/en-us/articles/360053415414-Restricted-Countries`, updated 2025-10-08, read from the Wayback capture of 2026-03-13.
- S3: Terms and Conditions, `https://support.mandala.exchange/hc/en-us/articles/360055720074-Terms-and-Conditions`, updated 2025-10-29, read from the Wayback capture of 2026-04-20.
- S4: API v3 reference, `https://api.trade.mandala.exchange/`, fetched from this host with HTTP 200 on 2026-09-24.
- CCXT: `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hitbtc.js` lines 269, 270, 826, 840, 873, 877 and 878, version 4.5.68.
  The `server/node_modules` link to that package disappeared during this survey while the server was being moved, so the path is the root pnpm store.
- Probes: [`rest-probe.mjs`](../../../scripts/probes/venues/mandala/rest-probe.mjs) modes `catalog` and `anchor`.
