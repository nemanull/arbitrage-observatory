# Byte Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:08 to 03:50 UTC, from the development host near Seattle.

Byte Exchange (bexc.io) is CoinGecko's trust rank 38 on 2026-09-22.
It lists no perpetual that trades with real funds, and it has no CCXT 4.5.68 class.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says, and names the demo perpetuals in the coverage matrix.
The developer portal `docs.bexc.io` is behind a Cloudflare Access login, so every documented number here comes from the public web app at `bexc.io`, its JavaScript bundles, and the public JSON endpoints those bundles call.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/byte-exchange/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/byte-exchange/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local, 2026-09-23 UTC | this profile |
| contracting entity | the Terms of Service name "ByteExchange Limited" | S3 |
| governing law | "the laws of the Republic of Turkey", Terms section 14 | S3 |
| entities named by CoinGecko | Bytedex Technologies OU of Tallinn, Estonia, operating with Bytedex Kripto Varlık Alım Satım Platformu A.Ş. of İzmir, Turkey | S8, not checked against a registry |
| excluded regions | "the United States of America, the People's Republic of China (mainland), Cuba, Iran, North Korea, Syria, Crimea, Donetsk, and Luhansk regions of Ukraine" | S3 |
| US persons | may not use the platform | S3 |
| who may trade spot | anyone of legal age outside those regions and not on a sanctions list, subject to KYC | S3 |
| who may trade real perpetuals | nobody on 2026-09-22, see section 3 | S5, S6 |
| legal pages dated | Terms, Privacy, AML, Risk, Cookie and Exchange Fees all `lastUpdated` 2026-04-12 | S3 |

Access from this host on 2026-09-22 was as follows.

- Every public REST call named in this profile answered 200 through Cloudflare's Seattle edge (`cf-ray` suffix `SEA`), see [`rest.md`](./rest.md) section 1.
- The WebSocket refused a handshake without an `Origin` header with HTTP 403 and the body `Origin header required`, and a foreign origin with 403 `Origin not allowed`, see [`websocket.md`](./websocket.md) section 1.
- `https://docs.bexc.io/api/v1` answered 302 to `bytedex.cloudflareaccess.com`, a login for the operator's staff.
  The signed redirect metadata carried `"real_country":"CA"` for this host, so Cloudflare places this host in Canada, and a United States geoblock, if one exists, was not exercised.
- No page or endpoint refused this host on region grounds.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, fee schedule tier 0 "Bronze" | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S1, S12, S3 |
| spot, per market field on 804 of 851 markets | 0.10 %, 1,000 ppm | 0.20 %, 2,000 ppm | S2 |
| spot, per market field on the other 47 markets | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S2 |
| demo perpetuals, no real funds | not published | 5 bps, 500 ppm | S5, S7 |

The fee schedule and the market list disagree on the taker for 804 of 851 markets.
The schedule, the legal fee page and the tier endpoint all say 0.10 % for both sides at the base tier.
`GET /api/v1/markets` says `"maker_fee":"0.001000","taker_fee":"0.002000"` on 804 markets and `"0.001000"` for both on 47, in `rest-probe.mjs catalog` on both runs.
Which one a fill is charged cannot be settled without an account, so this profile writes both and recommends the higher, see section 9.
The 47 markets with a 0.10 % taker are 36 USDC pairs such as `XEC_USDC`, `WBTC_USDC` and `XMR_USDC`, 10 USDT pairs such as `BILL_USDT` and `AI_USDT`, and `SUI_ETH`.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 851 active markets: 460 USDT, 334 USDC, 42 BTC, 15 ETH quoted | S2, `rest-probe.mjs catalog` |
| perpetuals with real funds | no | `/perp/status` reports `"clearing_rail":{"state":"pending"}`, the web route `/futures` redirects to `/demo`, and the geo disclosure says "Perpetual futures open region by region as each review completes", S5, S6, S14 |
| demo perpetuals | yes, 124 paper markets under `/api/v1/perp-demo`, which the app labels as practice with "no real funds" | S7, S14 |
| dated futures | no endpoint, route or listing found | S13, S14 |
| options | no endpoint, route or listing found | S13, S14 |
| convert, P2P, staking, cards | present, out of scope | S1 |

CoinGecko's derivatives exchange list held 214 venues at about 03:31 UTC on 2026-09-23, and none was Byte Exchange, S9.

The perpetual product exists on paper as "the Byte book".
Its disclosure says "Byte Exchange is your counterparty on every fill", and "Your fill price is the validated mark price for the market", S5.
So a real Byte perpetual, once open, would be a house-quoted contract filled at the venue's own mark, not an order book an arbitrage leg can cross.
The demo list splits into 102 `*_USDT_PERP_DEMO` contracts, 11 `*_USD_DEMO` index contracts such as `BTCDOM_USD_DEMO`, `TOTAL_USD_DEMO` and `AISECTOR_USD_DEMO`, 10 tokenized equity and gold contracts such as `AAPLX_PERP_DEMO` and `XAUT_PERP_DEMO`, and `ETHBTC_DEMO`.
All 124 are quoted in USDT with a 3,600 s funding interval and 100x maximum leverage, in `rest-probe.mjs perp`.
The demo vault stats reported 70 active players and 1 open position at 03:18 and at 03:42 UTC, S7.

## 4. Spot tiers

The live schedule, from `GET /api/v1/fees` (S1) and `GET /api/v1/wallet/volume-discount-tiers` (S12), which agreed on every row in both runs.

| rank | name | 30 day USD volume from | maker | taker | taker ppm |
|---:|---|---:|---:|---:|---:|
| 0 | Bronze | 0 | 0.10 % | 0.10 % | 1,000 |
| 1 | Silver | 50,000 | 0.09 % | 0.095 % | 950 |
| 2 | Gold | 250,000 | 0.075 % | 0.085 % | 850 |
| 3 | Platinum | 1,000,000 | 0.06 % | 0.07 % | 700 |
| 4 | Diamond | 5,000,000 | 0.04 % | 0.055 % | 550 |
| 5 | VIP1 | 25,000,000 | 0.02 % | 0.04 % | 400 |
| 6 | VIP2 | 100,000,000 | 0.01 % | 0.03 % | 300 |
| 7 | VIP3 | 500,000,000 | -0.01 % | 0.02 % | 200 |

The fee page says "Tiers snapshot on the 1st of each month at 00:00 UTC", S4.
It adds that "Your trailing 30-day USD volume determines the bracket you fall into for the month ahead", S4.
The fee page also says "Fees come out of what you spend", and the trade records name the model `"buyer_fee_model":"inclusive"`, see [`rest.md`](./rest.md) section 5.

The legal Exchange Fees page, `lastUpdated` 2026-04-12, still shows an older five tier ladder, S3.

| legal tier | 30 day spot volume | maker | taker |
|---|---|---:|---:|
| Regular | under $50,000 | 0.100 % | 0.100 % |
| VIP 1 | $50,000 to $250,000 | 0.080 % | 0.090 % |
| VIP 2 | $250,000 to $1,000,000 | 0.060 % | 0.080 % |
| VIP 3 | $1,000,000 to $5,000,000 | 0.040 % | 0.060 % |
| VIP 4 | over $5,000,000 | 0.020 % | 0.040 % |

It says "VIP tier levels are recalculated daily", which contradicts the monthly snapshot of the live fee page.
Both agree on 0.10 % maker and taker at the base tier.

## 5. Discounts that change the spot taker

| discount | terms | active on 2026-09-22 | source |
|---|---|---|---|
| BEXC token | 25 % off every trading fee when paid in BEXC and enabled in settings | no, `"bexc_discount_active":false`, and the fee page says "Soon you will be able to pay every trading fee in BEXC" | S1, S3, S4 |
| VIP3 maker rebate | -1.0 bps with a daily cap of 10,000 USD | no, `"maker_rebate_active":false`, "This program is coming soon." | S1, S4 |
| referral | pays the referrer 1,500 to 3,500 bps, 15 % to 35 %, of the referee's fee by tier, with L2 at 0.5 and L3 at 0.25 of L1, gated on a 100 BEXC stake | does not change the referee's taker | S1 |
| affiliate | five tiers paying 2,500 to 5,000 bps of referee fee revenue, `"public_application_open":false` | does not change the taker | S1 |
| per market 0.10 % taker | 47 markets carry `taker_fee` 0.001 instead of 0.002 | yes, if the market field is what is charged | S2 |
| zero fee promotion | none found | | S1, S4 |

## 6. Funding as a cost

Spot carries no funding.

The demo perpetuals publish `current_funding_rate` and `funding_interval_secs` 3600 on all 124 markets, S7.
The rates ranged from -8.36e-7 to 0.00046875 at 03:18 UTC and from -1.26e-6 to 0.00046875 at 03:42 UTC, median 0.0000125 both times, with `BTC_USDT_PERP_DEMO` at the maximum, in `rest-probe.mjs perp`.
The disclosure says funding "is charged and paid every epoch you hold a position, between you and Byte Exchange as your counterparty", and "The rate tracks the market rate for the same instrument, steepened by the balance of our own book, so the crowded side pays and the lighter side receives", S5.
No formula, cap or floor is published, and no real position pays it.
No settlement instant was captured, because no real contract settles.

## 7. Liquidation, settlement and delisting

Spot has no liquidation charge.
The Terms reserve the right to "cancel, reverse, or modify any trade that results from system errors" and to "adjust prices or orderbooks to correct errors", S3.
No delisting fee or settlement charge is published.

Instant convert takes a fixed spread, `"convert_spread_pct":"0.005"`, S1.
Withdrawal fees are listed per token and chain in the `withdrawal_fees` array of `GET /api/v1/fees`, 616 rows on 2026-09-23, S1.

For the demo perpetuals the disclosures describe liquidation "with a safety buffer", auto-deleveraging ranked by profit against margin, and `/perp/status` names an insurance fund of 25,000 USDT, S5, S6.

## 8. CCXT

| check | result | evidence |
|---|---|---|
| CCXT 4.5.68 exchange list | 104 ids, none matching `byte` or `bexc` | `node -e "console.log(require('ccxt').exchanges)"` from `server/`, and `rest-probe.mjs catalog` |
| CCXT master, `ts/src` | no `byteexchange.ts` or similar among 112 entries at commit `1d8b674`, 2026-09-22 12:48 UTC | S11 |
| open pull request | #28769 "byteexchange" by `bytexcglobal`, opened 2026-06-03, last updated 2026-06-09, open and unmerged | S10 |

The pull request adds `ts/src/byteexchange.ts` at head `0f63de1`.
It is spot only, with `'swap': false` at line 27, and `'rateLimit': 34, // published limit is 30 req/s per IP / per key` at line 20.
Its `parseMarket` takes `maker` and `taker` from the market's `maker_fee` and `taker_fee` at lines 231 and 232, so it would report `market.taker` 0.002 on 804 markets and 0.001 on 47.
Since no class exists in 4.5.68, `market.taker` is not available to the engine today.

## 9. Recommended registry values

No registry entry is recommended, because the venue lists no perpetual the engine could trade, see [`rest.md`](./rest.md) section 3.

If a spot leg were ever modelled, `takerPpm` should be 2,000.
That is the per market taker the API returns for 804 of 851 markets, and it is the higher of the two published numbers, so a fill charged at the schedule's 1,000 ppm only makes the model conservative.
`ccxtTakerPpm` stays unset, because there is no CCXT class to cross check.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fee schedule endpoint | https://api.bexc.io/api/v1/fees | 2026-09-22 | Byte Exchange, global | tiers, discounts, rebate, convert spread, withdrawal fees, referral, sections 2, 4, 5, 7 |
| S2 | Markets endpoint | https://api.bexc.io/api/v1/markets | 2026-09-22 | Byte Exchange, global | per market `maker_fee` and `taker_fee`, counts by quote, sections 2 and 3 |
| S3 | Legal pages bundle: Terms of Service and Exchange Fees, `lastUpdated` 2026-04-12 | https://bexc.io/assets/LegalPage-D0UOZ02s.js | 2026-09-22 | ByteExchange Limited, Turkish law | entity, excluded regions, legal fee ladder, error reversal, sections 1, 4, 7 |
| S4 | Fee page and its bundle | https://bexc.io/fees and https://bexc.io/assets/FeesPage-BwJh7P2Z.js | 2026-09-22 | Byte Exchange, global | monthly tier snapshot, inclusive fees, BEXC discount "soon", rebate "coming soon", sections 4 and 5 |
| S5 | Perpetual disclosures endpoint | https://api.bexc.io/api/v1/perp/disclosures | 2026-09-22 | Byte Exchange, global | house counterparty, mark fills, funding, geo rollout, 5 bps taker, sections 2, 3, 6, 7 |
| S6 | Perpetual status endpoint | https://api.bexc.io/api/v1/perp/status | 2026-09-22 | Byte Exchange, global | clearing rail pending, 124 markets priced, insurance fund, sections 3 and 7 |
| S7 | Demo perpetual markets and vault stats | https://api.bexc.io/api/v1/perp-demo/markets and https://api.bexc.io/api/v1/perp-demo/vault-stats | 2026-09-22 | Byte Exchange, demo | 124 paper markets, funding fields, 5 bps, sections 2, 3, 6 |
| S8 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/byte-exchange | 2026-09-22 | CoinGecko | trust rank 38, Estonian and Turkish entities, section 1 |
| S9 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | no Byte Exchange entry among 214, section 3 |
| S10 | CCXT pull request 28769 and its connector at head `0f63de1` | https://github.com/ccxt/ccxt/pull/28769 | 2026-09-22 | CCXT | spot only class, fee fields, rate limit comment, section 8 |
| S11 | CCXT master `ts/src` listing | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no class in master, section 8 |
| S12 | Volume discount tiers endpoint | https://api.bexc.io/api/v1/wallet/volume-discount-tiers | 2026-09-22 | Byte Exchange, global | tier table with discount percent, section 4 |
| S13 | API documentation page and its Postman collection | https://bexc.io/api-docs and https://bexc.io/data/spot.json?v=v3 | 2026-09-22 | Byte Exchange, global | spot only public API, no futures endpoints, section 3 |
| S14 | Web app route table and demo futures bundles | https://bexc.io/assets/index-B0y2Yr87.js and https://bexc.io/assets/ticketTheme-CIqTDYF7.js | 2026-09-22 | Byte Exchange, global | `/futures` redirects to `/demo`, the `/perp-demo` API paths, section 3 |
| P1 | `rest-probe.mjs catalog` and `perp` at 03:18 UTC, rerun at 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/byte-exchange/rest-probe.mjs) | 2026-09-22 | this host | sections 2, 3, 4, 6, 8 |
