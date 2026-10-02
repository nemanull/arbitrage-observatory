# Paymium Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:40 to 05:15 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the one order book of Paymium (CCXT id `paymium`), the BTC/EUR spot market, because the venue lists no perpetual, dated future or option.
The plan's template change 1 applies, so the tiers below are spot tiers.
Deposit, withdrawal, card and inactivity schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 Pacific, the probes ran at 04:40 to 05:15 UTC on 2026-09-23 | P1 to P5 |
| legal entity | Paymium SAS, a French simplified joint-stock company, RCS Nanterre 533 264 800, 73 rue du Château, 92100 Boulogne-Billancourt | S4 section 2.2, S5 |
| share capital | €21,250 in the terms of July 6, 2026, and €16,270 in the legal notice of the same date | S4, S5 |
| regulator | CASP authorised in France by the AMF under MiCA, obtained June 2026, after PSAN registration in March 2021 | S4 section 2.4, S6, S7 |
| who may trade | a verified client who is not resident, domiciled or established in a sanctioned country or in a country Paymium refuses | S4 section 5.1.1, "No Restricted Residence" |
| accepted residence | `GET /api/v1/countries` marks 181 of 250 countries `accepted: true` | P1, P2 |
| US persons | `US` is `accepted: false` in `/countries`, so a US resident cannot open an account | P1, P2 |
| other refused countries | AF, AS, AI, AG, BS, BB, BY, BZ, BA, BW, BF, KH, KY, CF, CD, CU, DM, ER, ET, GH, GI, GU, GN, GY, HT, IR, IQ, JM, JO, KP, LA, LB, LR, LY, ML, MN, MZ, MM, NI, NG, OM, PK, PW, PA, PH, RU, WS, SA, SN, SC, SO, SS, LK, SD, SY, TZ, TT, TR, TC, UG, UA, AE, VU, VE, VG, VI, YE, ZW | P1, P2 |
| Canada, France, United Kingdom, Switzerland | `accepted: true` | P1, P2 |
| API trading | "Authenticating users is only available to developers that have a fully verified and approved Paymium account", public data is open to everyone | S8, General information |
| hours | the trading platform "operates 24/7" except maintenance, status at `https://account.paymium.com/status` | S3 section 4.5 |

The `accepted` field is not described in the API documentation, S8.
The terms say "The list of accepted countries as countries of residence for opening Accounts is available and up-to-date on the Website at the time of registration", S4, and this profile reads `/countries` as that list.
That reading is an inference.

### Access from this host

Every call in this profile went out through the Canadian VPN exit named in the Probed line, and a Cloudflare trace from this host said `loc=CA`.
No public call was refused.

| endpoint | status from this host |
|---|---|
| `https://paymium.com/api/v1/data/eur/ticker`, `/depth`, `/trades`, `/ohlcv`, `/currencies`, `/countries` | 200 on every call, P1, P2 |
| `https://paymium.com/api/v2/markets`, `/markets/BTC-EUR/ticker`, `/markets/BTC-EUR/trades` | 200, P1, P2, P6 |
| `wss://paymium.com/ws/socket.io/?EIO=3&transport=websocket` | 101 and a working stream on every socket, P3 to P5 |
| `https://www.paymium.com/en/pricing` and the other site pages in the ledger | 200 |
| `https://paymium.github.io/api-documentation/` | 200 |
| `https://api.github.com/repos/Paymium/api-documentation` | 403 "API rate limit exceeded" for this IP, a GitHub limit, so the repository was read through its web page and commit feed instead |

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| BTC/EUR limit order, 30-day volume under €10,000 | 0.40 %, 4,000 ppm | 0.6 %, 6,000 ppm | S1, and `defaultMakerFee` `"0.004"` and `defaultTakerFee` `"0.006"` in `GET /api/v2/markets`, P1, P2 |
| BTC/EUR market order | not applicable | 1.49 %, 14,900 ppm | S1 "Exchange, market orders and merchant payments", and the `market-order` feature `fee` `"0.0149"` in `GET /api/v2/markets`, P1, P2 |

A taker cross placed as a marketable limit order pays 6,000 ppm.
The same cross placed as a market order pays 14,900 ppm.
The engine models a taker cross, so 6,000 ppm is the number that matters, and only if the order is a limit order.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M, USDC-M or coin-margined perpetuals | absent | CCXT `swap: false` at `server/node_modules/ccxt/js/src/paymium.js` line 30, `GET /api/v2/markets` lists one market `BTC-EUR`, CoinGecko's derivatives exchange list of 214 venues has no Paymium, P1, P2, S10 |
| dated futures | absent | CCXT `future: false` at line 31, no product on the site or in the API |
| options | absent | CCXT `option: false` at line 32 |
| margin | absent | CCXT `margin: undefined` at line 29, no margin product in S3 or S4 |
| spot order book | present, one pair, BTC/EUR | the only currency pair with a non-empty `trading` list in `GET /api/v1/currencies` is `BTC/EUR`, P2 |
| broker conversions, "Exchange Service" | present, 30 pairs in `/currencies` `swap` lists and 33 keys in the socket `prices` object | Paymium is the counterparty at its own price, not an order book, S4 section 10.3, P2, P3 |

Deposit and withdrawal fees, card fees up to 3.5 %, and inactivity fees are on the pricing page, S1.

## 4. Spot tiers

The tiers apply to limit orders on BTC/EUR, by 30-day volume in euros, S1.

| 30-day volume, EUR | maker | maker ppm | taker | taker ppm |
|---|---:|---:|---:|---:|
| 0 to 10K | 0.40 % | 4,000 | 0.6 % | 6,000 |
| 10K to 50K | 0.25 % | 2,500 | 0.4 % | 4,000 |
| 50K to 100K | 0.15 % | 1,500 | 0.3 % | 3,000 |
| 100K to 1M | 0.12 % | 1,200 | 0.25 % | 2,500 |
| 1M to 20M | 0.08 % | 800 | 0.18 % | 1,800 |
| 20M to 100M | 0.05 % | 500 | 0.15 % | 1,500 |
| 100M to 300M | 0.02 % | 200 | 0.10 % | 1,000 |
| 300M to 500M | 0.00 % | 0 | 0.08 % | 800 |
| 500M and over | 0.00 % | 0 | 0.05 % | 500 |

Market orders pay 1.49 % at every volume, S1 and P1.
The pricing page lists the broker service at 1.49 % standard, 0.90 % for stablecoin transactions in USDC and EURCV, and 0 % for EURCV to EUR, S1.

### Qualification

"Decreasing fees are applied according to the trading volume of the last 30 days", S3 section 8.
The fee "only applies to executed Bitcoin orders", and a partly executed order pays pro rata on the executed part, S1 and S3 section 8.
Placing and cancelling an order is free, S3 sections 4.2 and 4.4.
The pricing page does not say when the 30-day volume is measured or whether volume on the broker service counts.
That is Not publicly specified.

## 5. Discounts that change the taker

None is published.
The pricing page, the trading rules and the terms name no token discount, no referral rebate on trading fees and no zero-fee promotion, S1, S3, S4.
The trading rules allow "Dedicated Accounts, subject to eligibility (quoting obligations, information barriers, and disclosure of incentives)" for market makers, with no published fee, S3 section 11.
The site advertises "€5 offered to start investing!" for the mobile app, which is a sign-up credit and not a fee change, S1.
CCXT carries a referral URL at `paymium.js` line 67, which is not a fee discount.

## 6. Funding as a cost

Not applicable.
Paymium lists no perpetual, so there is no funding rate, interval or cap.

## 7. Liquidation, settlement and delisting

- No liquidation exists, since there is no margin or derivative product.
- "Settlement of completed Orders is immediate", off-chain on the platform's own ledger, S3 section 7.
- A market order cannot "change the market price by more than 2% compared to the last price", the "market protection" of S3 section 4.5, and `GET /api/v2/markets` shows it as the `market-protection` feature with `maxSlippage` 2, P1.
- Paymium may cancel or reverse an executed trade in the cases S3 section 4.4 lists, including a price "substantially inconsistent with prevailing market levels".
- "The minimum liquidity threshold is €50,000 for both the sale and purchase of Crypto-Assets", and below it "the Trading Platform may suspend trading activity", S3 section 4.5.
- Delisting and suspension notices and the conversion of a delisted asset are described in S3 section 3.3, with no fee named.
- Self-trade prevention is `decrement-and-cancel`, from `GET /api/v2/markets`, P1.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `paymium`, REST only | `server/node_modules/ccxt/js/src/paymium.js`, no `pro/paymium.js` exists, P1 |
| catalog | one hard-coded market `BTC/EUR`, `id` `"eur"`, `type` `"spot"` | `paymium.js` line 108 |
| `fetchMarkets` | not overridden, the base class returns the hard-coded markets without a network call | `server/node_modules/ccxt/js/src/base/Exchange.js` lines 1241 to 1248 |
| exchange-level trading fee | `maker` `-0.001`, `taker` `0.005` | `paymium.js` lines 112 and 113 |
| `market.taker` for BTC/EUR | `undefined` | P1, P2 |
| `market.maker`, `active`, `contractSize`, `linear` | `undefined` | P1, P2 |

The market at line 108 is built with `safeMarketStructure`, which sets `taker` and `maker` to `undefined`, at `base/Exchange.js` lines 3653 and 3654.
`setMarkets` then deep-extends the exchange fee first and the market last, at `base/Exchange.js` lines 3732 to 3735, so the market's own `undefined` wins.
So `market.taker` is `undefined` without credentials, and `ccxtTakerPpm` would be `null`.

The CCXT constants also disagree with the venue.
CCXT's taker of 5,000 ppm is below the published 6,000 ppm, and CCXT's maker rebate of 1,000 ppm is a 4,000 ppm charge on the pricing page and in `GET /api/v2/markets`, S1 and P1.

## 9. Recommended registry values

None, because Paymium is spot only and the engine consumes perpetuals, see [`rest.md`](./rest.md) section 2.

If a later design ever adds this spot book, it needs `takerPpm` 6,000 in the registry.
The connector takes `this.takerPpm ?? toPpm(market.taker)` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 162, and `market.taker` is `undefined` for Paymium, so without a registry value the fee is unknown.
`ccxtTakerPpm` would stay unset, since CCXT reports no per-market taker.
The engine would also have to place marketable limit orders, because a market order costs 14,900 ppm.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Crypto fees and pricing | https://www.paymium.com/en/pricing, redirected from `https://www.paymium.com/page/help/fees` | 2026-09-22 | Paymium SAS | tiers, market order and broker fees, deposit and card fees, sections 2, 4, 5 |
| S2 | Paymium API v2 market list, undocumented | `https://paymium.com/api/v2/markets` | 2026-09-22 | Paymium SAS | default maker and taker, market order fee, market protection, self-trade prevention, read by P1 and P2 |
| S3 | Rules of the Trading Platform, July 6, 2026 | https://paymium-public-files.s3.fr-par.scw.cloud/rules/rules_of_the_trading_platform.pdf | 2026-09-22 | Paymium SAS | maker and taker model, 30-day volume, order types, 24/7, liquidity threshold, market protection, trade reversal, sections 1, 4, 7 |
| S4 | Terms and Conditions, July 6, 2026 | https://paymium-public-files.s3.fr-par.scw.cloud/TOS/Paymium_TOS.pdf | 2026-09-22 | Paymium SAS | entity, residence rule, trading platform and Exchange Service, sections 1 and 3 |
| S5 | Legal notice, July 6, 2026 | https://paymium-public-files.s3.fr-par.scw.cloud/legal/legal_notice.pdf | 2026-09-22 | Paymium SAS | entity, share capital, section 1 |
| S6 | About us | https://www.paymium.com/en/about-us | 2026-09-22 | Paymium SAS | PSAN March 2021, MiCA June 2026, section 1 |
| S7 | Security and compliance | https://www.paymium.com/en/security-and-compliance | 2026-09-22 | Paymium SAS | "CASP authorised in France by the AMF", section 1 |
| S8 | Paymium API 1.1.1 | https://paymium.github.io/api-documentation/ | 2026-09-22 | Paymium SAS | API access rule, section 1 |
| S9 | CCXT 4.5.68 `paymium.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/paymium.js` | 2026-09-22 | CCXT | catalog and fee constants, section 8 |
| S10 | CoinGecko public API, `/exchanges/paymium` and `/derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/paymium | 2026-09-22 | CoinGecko | one ticker BTC/EUR, 2.24 BTC 24 h volume, trust score 3 and trust rank 140, no derivatives listing, section 3 |
| S11 | Regulatory documents | https://www.paymium.com/en/regulatory-documents | 2026-09-22 | Paymium SAS | links to S3 and S4 |
| P1 | `rest-probe.mjs all`, run 1 at 04:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 3, 7, 8 |
| P2 | `rest-probe.mjs all` at 05:03 UTC and `catalog` at 05:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the second readings |
| P3 | `ws-probe.mjs book`, runs at 04:47 and 04:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket access, `prices` keys |
| P4 | `ws-probe.mjs variants`, runs at 04:49 and 05:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket access |
| P5 | `ws-probe.mjs silence`, runs at 04:51 and 05:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket access |
| P6 | `rest-probe.mjs all` at 05:10 UTC and `errors` at 05:13 UTC, the verification reruns of the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | v2 ticker and trades, section 1 |
