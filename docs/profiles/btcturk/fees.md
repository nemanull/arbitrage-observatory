# BtcTurk Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:14 to 03:38 UTC, from the development host near Seattle.

This profile covers BtcTurk | Kripto (CCXT id `btcturk`), a Turkish exchange that lists spot pairs only, so it is profiled on its spot market as the survey plan's template change 1 asks.
The fee numbers come from the public tier list that the exchange's own web app reads, S1, because the fee page and the help center refuse this host and the fetch tool, section 1.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/btcturk/rest-probe.mjs), run 1 from 03:29 to 03:31 UTC and run 2 from 03:36 to 03:38 UTC.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | BtcTurk Kripto Varlık Alım Satım Platformu A.Ş., Mersis No 0332045014600001 | footer string in the `kripto.btcturk.com` web app bundle, S2 |
| venue named by CoinGecko | "BtcTurk \| Kripto", Turkey, established 2013, trust score 7, trust score rank 66 on 2026-09-22, 24 h volume 1,945 BTC | `https://api.coingecko.com/api/v3/exchanges/btcturk`, S6 |
| account kinds | "Turkish citizen accounts" verified against the NVI identity system, and "Global accounts" that confirm an email and enable two-factor authentication | web app strings, S2 |
| countries offered to foreign citizens | 62 countries, among them the United Kingdom, Canada and Germany, and neither the United States nor Turkey | `GET https://api.btcturk.com/api/v2/help/register-countries`, S3 |
| fiat rails | "You can deposit to your BtcTurk account only from a bank account under your name located in Turkey", for TRY and EUR | web app strings, S2 |
| US persons | the United States is absent from the country list, so a US citizen cannot pick it at registration | S3 |

The web app says "BtcTurk provides services to the citizens of the following countries.", S2.
That the list behind this sentence is the `register-countries` reply is an inference from the method name `getRegisterCountries` in the bundle, since no page that renders it was read.
Turkey is missing from the list because Turkish citizens register on the NVI path, which is also an inference.
The regulatory licence of the operator is Not verified, because no official page that states it could be read.

What this host could read on 2026-09-22 and 2026-09-23 UTC:

| URL | reply to this host |
|---|---|
| `https://www.btcturk.com/` | 403, `cf-mitigated: challenge`, a Cloudflare challenge page |
| `https://btcturkpro.zendesk.com/hc/en-us/articles/360013452417` (the "Commissions" article the web app links) | 403, a Cloudflare "Just a moment..." page, and the WebFetch tool also got 403 |
| `https://www.btcturk.com/komisyonlar` through the WebFetch tool | 403 |
| `https://kripto.btcturk.com/` | 200, an Angular app whose bundle and `/assets/environment.json` carry the strings and API hosts quoted here |
| `https://docs.btcturk.com/docs/...` | 200, the API documentation, S4 |
| `https://pro-bff.btcturk.com/v1/buy-sell-commissions` | 200, the tier list, S1 |
| `https://api.btcturk.com/api/v2/...` and `wss://ws-feed-pro.btcturk.com/` | 200 and 101, see [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md) |

The web search tool had no budget left in this session, so no third party page was consulted.

## 2. Quick answer

BtcTurk lists no perpetual, so there is no perpetual fee.
The spot fee at Level 1, the base tier, depends on the quote asset, S1.

| spot family | maker | taker |
|---|---|---|
| USDT pairs, "crypto/crypto" | 0.10 %, 1,000 ppm | 0.14 %, 1,400 ppm |
| TRY pairs, "crypto/fiat" | 0.12 %, 1,200 ppm | 0.24 %, 2,400 ppm |

The web app picks the pair's rate with `symbols[i].denominator == 'TRY' ? cryptoFiat… : cryptoCrypto…`, so every pair not quoted in TRY uses the crypto/crypto column, S2.
The engine's quote family can only use the USDT pairs, see [`rest.md`](./rest.md) section 2, so 1,400 ppm is the taker that would matter.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | no symbol in `exchangeinfo` beyond 379 spot pairs, CCXT `'swap': false` at `server/node_modules/ccxt/js/src/btcturk.js` line 30 |
| USDC or coin-margined perpetuals | absent | same |
| dated futures | absent | CCXT `'future': false` at line 31, no symbol in `exchangeinfo` |
| options | absent | CCXT `'option': false`, no symbol in `exchangeinfo` |
| margin | absent | CCXT `'margin': false` at line 29 |
| spot | present | 379 pairs, all `TRADING`, 190 quoted in TRY and 189 in USDT, [`rest.md`](./rest.md) section 2 |

CoinGecko's derivatives exchange list returned 214 entries on 2026-09-22 and none of them is BtcTurk, S6.
The API documentation names only spot endpoints, S4.

## 4. Spot tiers

Retrieved from S1 on 2026-09-23 03:16 UTC.
The fields are fractions, and the web app multiplies them by 100 to print a percent, S2.
Values such as `0.001400000000000040` are rounded here to whole ppm.

| level | 30 day volume, TRY | TRY pairs maker | TRY pairs taker | USDT pairs maker | USDT pairs taker |
|---|---|---:|---:|---:|---:|
| 1 | 0 to 5,000,000 | 1,200 | 2,400 | 1,000 | 1,400 |
| 2 | 5,000,000 to 25,000,000 | 1,100 | 2,100 | 800 | 1,300 |
| 3 | 25,000,000 to 100,000,000 | 1,000 | 1,900 | 600 | 1,100 |
| 4 | 100,000,000 to 250,000,000 | 800 | 1,700 | 500 | 900 |
| 5 | 250,000,000 to 500,000,000 | 600 | 1,500 | 400 | 700 |
| 6 | 500,000,000 to 1,000,000,000 | 400 | 1,200 | 300 | 500 |
| 7 | 1,000,000,000 to 2,000,000,000 | 200 | 1,000 | 200 | 300 |
| 8 | 2,000,000,000 and above | 100 | 800 | 100 | 200 |

All figures in the four fee columns are ppm.

### Qualification

- "When trade volumes are being calculated, 30 days volume of Turkish Lira and Tether trades are being calculated as TRY.", S2.
- "After your transactions are completed, your commission level will be updated within approximately an hour.", S2.
- Trades on BtcTurk | Hisse count toward the level only when that account is linked to the BtcTurk | Kripto account, S2.
- A maker is an order "recorded in the order book without matching the moment they are transmitted", S2.
- Every tier row carries `brokerId` 1, which is the `BrokerId` of the web app's `environment.json`, S2.

## 5. Discounts that change the spot taker

- Coupons exist: the web app defines a coupon campaign type `CommissionRateDiscount` with value 2, S2.
  Their size and eligibility are Not publicly specified.
- The web app flags a pair as zero fee when its internal ticker carries `noFee` true, S2.
  The public `GET /api/v2/ticker` rows carry no such field, so which pairs are zero fee, if any, is Not verified.
- No exchange token discount, referral rebate or market maker programme was found in the documentation, S4, and the help center could not be read, section 1.
- Whether any tax is added on top of these rates is Not verified.
  The web app's `getTaxIncludedFeeRate` only rounds the rate to five decimals, S2.

## 6. Funding as a cost

None, because BtcTurk lists no perpetual.

## 7. Liquidation, settlement and delisting

There is no margin or derivative product, so there is no liquidation or settlement charge.
Delisting rules are Not verified, since the help center refuses this host.
Deposit and withdrawal fees are shown in the web app at `kripto.btcturk.com` and are not recorded here, per the scope guard of the survey plan.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `btcturk`, spot only, no CCXT Pro class (`'pro': false`) | `server/node_modules/ccxt/js/src/btcturk.js` lines 25 to 32, and no `pro/btcturk.js` in 4.5.68 |
| `market.taker` | 0.0009, 900 ppm, on all 379 markets without credentials | lines 236 to 241, and `rest-probe.mjs catalog` in both runs |
| `market.maker` | 0.0005, 500 ppm | same lines |
| market type | `spot`, `swap` false, `contractSize` undefined | `parseMarket` at lines 309 to 346 |
| CCXT master on 2026-09-23 | same constants, still spot only, and `ts/src/pro/btcturk.ts` returns 404 | `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/btcturk.ts` lines 245 and 246 |

The CCXT constant is below the published Level 1 rate on both quote families: 900 against 1,400 ppm for USDT pairs and 2,400 ppm for TRY pairs.

## 9. Recommended registry values

None today.
The connector keeps only active swap markets, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, and BtcTurk has none, so the venue would load zero markets.
If a spot leg is ever modelled, `takerPpm` 1,400 for the USDT pairs and `ccxtTakerPpm` 900, because the CCXT constant is stale against S1.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Commission tier list read by the web app | `https://pro-bff.btcturk.com/v1/buy-sell-commissions` | 2026-09-23 03:16 UTC | BtcTurk Kripto Varlık Alım Satım Platformu A.Ş. | sections 2 and 4 |
| S2 | BtcTurk \| Kripto web app bundle `main.266c82ed8beb38e9.js` and `assets/environment.json` | `https://kripto.btcturk.com/` | 2026-09-23 03:15 UTC | same | operator, account kinds, fiat rails, tier rules, fee selection by quote, discounts, sections 1 to 5 |
| S3 | Registration countries | `https://api.btcturk.com/api/v2/help/register-countries` | 2026-09-23 03:17 UTC | same | 62 countries, no United States, section 1 |
| S4 | BtcTurk \| Kripto API Documentation | https://docs.btcturk.com/ | 2026-09-23 03:15 UTC | same | spot only endpoints, section 3 |
| S5 | CCXT 4.5.68 `btcturk.js` | `server/node_modules/ccxt/js/src/btcturk.js` | 2026-09-22 | CCXT | section 8 |
| S6 | CoinGecko exchange and derivatives exchange list | `https://api.coingecko.com/api/v3/exchanges/btcturk` and `/api/v3/derivatives/exchanges/list` | 2026-09-23 03:18 UTC | CoinGecko | venue context, no derivatives listing, sections 1 and 3 |
| P1 | `rest-probe.mjs catalog`, runs at 03:29 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcturk/rest-probe.mjs) | 2026-09-23 | this host | CCXT `taker` and `maker` per market, section 8 |
