# Bitunix Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Seattle time, which was 2026-09-23 01:14 to 01:43 UTC, from the development host near Seattle.

This profile covers the fees of the Bitunix perpetual futures for every perpetual family the venue lists: USDT-M, USDC-M and coin-M.
Bitunix has no CCXT class in 4.5.68 or in the current CCXT master, see section 8.
The catalog counts come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs), and the protocol is in [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22, which was 2026-09-23 in UTC for the whole session | this profile |
| legal entity | No official page read names the contracting entity. The user agreement says "Bitunix, a crypto asset trading platform, operates, together with its affiliates" and names no company | S3, S4 |
| country | CoinGecko lists Saint Vincent and the Grenadines and the year 2021 | S10 |
| entity named by third parties | Bitunix Fintech LLC, Saint Vincent and the Grenadines, not confirmed on any official page read | S12 |
| prohibited jurisdictions | the United States and all its territories, Canada including Alberta, Mainland China, Hong Kong, Singapore, North Korea, Cuba, Sudan, South Sudan, Syria, Iran, Iraq, Libya, Yemen, Afghanistan, the Central African Republic, the Democratic Republic of the Congo, Guinea-Bissau, Haiti, Lebanon, Somalia, the United Arab Emirates, France, the Russian-controlled regions of Ukraine, Sevastopol, Malaysia and Seychelles, notice last updated 2026-08-05 | S2 |
| US persons | may not trade. The notice also forbids reaching the services through a VPN or proxy, and says Bitunix may close open positions if that happens | S2 |
| sanctions | no service to anyone on the US SDN, EU consolidated or UK sanctions lists | S2 |
| public API from this host | every public REST and WebSocket call answered with HTTP 200 or 101 through a Cloudflare edge in Seattle or Vancouver, with no refusal, see [`rest.md`](./rest.md) section 1 | P1, P5 |

The help center at `support.bitunix.com` answered with HTTP 403 and a Cloudflare bot challenge, see [`rest.md`](./rest.md) section 1, while the help articles under `www.bitunix.com/hub/` answered HTTP 200.
The public data is reachable from the development host, and the venue refuses service to US persons.
So the engine could read Bitunix from here, and it could not trade Bitunix from a US account.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S1 |
| USDC-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S1, one futures column for every family |
| coin-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S1, one futures column for every family |

The fee page publishes a single "Futures Trading Fees" column and does not split it by margin asset, S1.
No separate schedule for USDC-M or coin-M was found, so the column is taken to apply to all three families.
That is an inference from the absence of a split, and it was not verified with an account.

## 3. Coverage matrix

Counts from `GET /api/v1/futures/market/trading_pairs` on 2026-09-23 at 01:24 UTC, P2.

| product | present | detail |
|---|---|---|
| USDT-M perpetuals | yes | 720 `OPEN`, of which 685 have `isApiSupported` true and 35 false, plus 1 `PREVIEW` (`FDUSDUSDT`) |
| USDC-M perpetuals | yes | 25 `OPEN`, all API enabled |
| coin-M perpetuals | yes | 15 `OPEN` with quote `USD`, such as `BTCUSD` and `ETHUSD`, margined and settled in the coin, S7 |
| dated futures | no | CoinGecko lists 0 futures pairs, S10, and the catalog carries no expiry field |
| options | no | not in the API documentation, S9, or the site navigation of the fee page, S1 |
| spot | yes | a separate spot API at `https://www.bitunix.com/api-docs/spots/en_us/`, not researched here |

CoinGecko showed 757 perpetual pairs on 2026-09-22, S10, against 760 `OPEN` rows in the catalog.

The 35 API-disabled USDT contracts are equity, ETF and pre-market contracts: `QQQUSDT`, `SPYUSDT`, `EWJUSDT`, `EWYUSDT`, `PAYPUSDT`, `PLTRUSDT`, `MSFTUSDT`, `NFLXUSDT`, `TSMUSDT`, `BABAUSDT`, `AVGOUSDT`, `USARUSDT`, `QCOMUSDT`, `ARMUSDT`, `COSTUSDT`, `SHLDUSDT`, `COHRUSDT`, `QNTXUSDT`, `LLYUSDT`, `NVOUSDT`, `ANTHROPICUSDT`, `HYUNDAIUSDT`, `ASTSUSDT`, `EWTUSDT`, `CSCOUSDT`, `DISUSDT`, `SMCIUSDT`, `SONYUSDT`, `CIENUSDT`, `WENUSDT`, `GIGADEVUSDT`, `KOUSDT`, `RDDTUSDT`, `INFQUSDT` and `QBTSUSDT`, P2.
The API documentation defines `isApiSupported` false as "API Trading Disabled", S9.
Their books still stream on the public socket, see [`websocket.md`](./websocket.md) section 4.

## 4. Perpetual tiers

The fee page, S1, retrieved 2026-09-22.
A level is reached through any one of the three columns, since the page separates them with "or".

| level | 30-day spot volume, USDT | 30-day futures volume, USDT | balance, USDT | futures maker | futures taker | taker ppm |
|---|---|---|---|---|---|---:|
| VIP 0 | 100,000.00 | < 1,000,000.00 | < 300.00 | 0.0200 % | 0.0600 % | 600 |
| VIP 1 | 100,000.00 | ≥ 1,000,000.00 | ≥ 300.00 | 0.0200 % | 0.0500 % | 500 |
| VIP 2 | 500,000.00 | ≥ 5,000,000.00 | ≥ 5,000.00 | 0.0160 % | 0.0500 % | 500 |
| VIP 3 | 800,000.00 | ≥ 8,000,000.00 | ≥ 25,000.00 | 0.0140 % | 0.0400 % | 400 |
| VIP 4 | 2,000,000.00 | ≥ 20,000,000.00 | ≥ 140,000.00 | 0.0120 % | 0.0375 % | 375 |
| VIP 5 | 4,000,000.00 | ≥ 50,000,000.00 | ≥ 700,000.00 | 0.0100 % | 0.0350 % | 350 |
| VIP 6 | 6,000,000.00 | ≥ 100,000,000.00 | ≥ 1,400,000.00 | 0.0080 % | 0.0315 % | 315 |
| VIP 7 | 8,000,000.00 | ≥ 200,000,000.00 | ≥ 2,400,000.00 | 0.0060 % | 0.0300 % | 300 |
| VIP 8 | 100,000,000.00 | ≥ 500,000,000.00 | ≥ 99,999,999,999.00 | 0.0000 % | 0.0260 % | 260 |

The spot volume column is printed without a comparison sign on every row, and the VIP 0 and VIP 1 rows both read 100,000.00, S1.
That is how the page renders it, and the spot column is context only.
The VIP 0 spot fees on the same page are 0.0800 % maker and 0.1000 % taker.

### Qualification

The page names 30-day spot volume, 30-day futures volume and balance, each in USDT, S1.
It does not say when the level is recomputed or how the balance is measured.
It invites VIP users of other exchanges to email their UID and a 30-day volume screenshot for a better level, S1.

## 5. Discounts that change the perpetual taker

| discount | what was found | source |
|---|---|---|
| VIP level | the table in section 4 | S1 |
| VIP match from another exchange | by email with a screenshot, no published rate | S1 |
| fee discount voucher | a help article "How to Use the Fee Discount Voucher on Bitunix (App)" is listed, and error code 20010 names a coupon that needs a futures balance | S6 listing, S9 error codes |
| platform token | none found | S1, S13 |
| referral | a referral program exists, and no fee rate for it was found on the fee page | S1 |
| zero fee promotion | none found on the fee page or the official fees blog | S1, S13 |

The engine models the base retail taker, so none of these changes the recommended value.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula of the fee | "Funding fee = net position held * contract par value * settlement price * funding fee rate" | S5 |
| direction | a positive rate makes the long side pay the short side | S5 |
| who is charged | only positions held at the settlement moment | S5 |
| documented schedule | "usually charged every 8 hours, at 00:00, 08:00 and 16:00 (UTC)", adjustable per pair | S5 |
| intervals on the wire | 8 h on 310 catalog rows, 4 h on 449, 1 h on 2 (`GUSDT` and `LSKUSDT`), from `fundingInterval` in the funding batch | P2 |
| cap and floor | per contract `maxFundingRate` and `minFundingRate`, in percent and symmetric on all 761 rows: 2 % on 646, 1 % on 45, 1.875 % on 22, 0.375 % on 17, 0.5 % on 10, 0.3 % on 5 including `BTCUSDT`, and 0.4875 % on 5, 0.75 % on 5, 0.45 % on 2, 1.125 % on 2, 0.9 % on 1 and 3.75 % on 1 | P2 |
| rate unit on the REST anchor | percent per interval, so `"0.01"` is 0.0001 as a fraction | P3, [`rest.md`](./rest.md) section 4 |
| rate unit in the history | a fraction per interval | P4 |
| isolated margin | the fee comes from the futures balance, then open orders are cancelled to free funds, then it is taken from the position | S5 |

The funding help article says each period's rate is fixed at the start of the period from the previous period's data, and a predicted rate for the following period is computed every minute, S5.
The REST rate held still for a whole minute of polls on every row, and it had changed between reads seven minutes apart, see [`rest.md`](./rest.md) section 4.
Whether the REST rate is the one the next settlement will charge is Not verified, and [`rest.md`](./rest.md) section 4 records the one comparison made.
The settlement instant itself was not captured.
The settled rates come from `get_funding_rate_history`, whose `fundingTime` values are on the hour and spaced by the contract's interval on the seven contracts read, P4.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation fee | Not publicly specified. The two liquidation articles give the maintenance margin rule and state their examples "excluding handling fees and funding rates" | S8 |
| maintenance margin example | 0.5 % for 100x BTC futures, "standard platform setting, not applicable to extreme market conditions" | S8 |
| delivery or settlement fee | none, perpetuals only | section 3 |
| delisting | the help center has a "Delisting" section at `support.bitunix.com`, which answers this host with HTTP 403. 133 symbols that are no longer in the catalog still appear in the funding batch with a rate of 0, see [`rest.md`](./rest.md) section 3 | P2 |

The trading fee is charged on opening and on closing, on position value and not on margin, S6.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `unix` | P2, `node -e "console.log(require('ccxt').exchanges)"` run from `server/` |
| CCXT master on GitHub | no `bitunix.ts` in `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC, 105 files listed, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/bitunix.ts` returns 404 | S11 |
| exchange requests | issue #24729 "New Exchange: Bitunix" opened 2025-01-03 and issue #28131 "BitUnix Exchange Request" opened 2026-03-11 are open, and #26493, #27215 and #28130 are closed | S11 |
| `market.taker` for a swap | none, since there is no class to load | |

So there is no CCXT source line to cite, and no `ccxtTakerPpm` to declare.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 futures taker of 0.0600 % on the fee page, S1, for every family |
| `ccxtTakerPpm` | unset | CCXT has no Bitunix class, so the connector at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68 has no `loadMarkets` to call |

The registry entry cannot be added as it stands, because every venue in [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) builds its catalog from a CCXT class, as at lines 40 to 77.
A Bitunix leg needs a catalog loader that reads `trading_pairs` directly, and that loader would carry the 600 ppm.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitunix Fee Structure, VIP spot and futures rates | https://www.bitunix.com/service/handling-fee | 2026-09-22 | Bitunix, global | sections 2 to 5, 9 |
| S2 | Bitunix Restricted Regions and User Eligibility Notice, last updated 2026-08-05 | https://www.bitunix.com/hub/helpcenter/article/bitunix-restricted-regions-and-user-eligibility-notice?id=146 | 2026-09-22 | Bitunix, global | section 1 |
| S3 | Bitunix User Agreement, last updated 2026-07-23 | https://www.bitunix.com/hub/helpcenter/article/bitunix-user-agreement?id=144 | 2026-09-22 | Bitunix, global | section 1 |
| S4 | Legal Statement, last updated 2026-05-18, and Risk Disclosure, last updated 2026-07-20 | https://www.bitunix.com/hub/helpcenter/article/legal-statement?id=148 and https://www.bitunix.com/hub/helpcenter/article/risk-disclosure?id=149 | 2026-09-22 | Bitunix, global | section 1, no entity named |
| S5 | Introduction to Futures Funding Rate, last updated 2026-05-28 | https://www.bitunix.com/hub/helpcenter/article/introduction-to-futures-funding-rate?id=79 | 2026-09-22 | Bitunix, global | section 6 |
| S6 | Trading Fees Explanation and Calculation (Bitunix Futures), last updated 2026-05-28 | https://www.bitunix.com/hub/helpcenter/article/trading-fees-explanation-calculation-bitunix-futures?id=224 | 2026-09-22 | Bitunix, global | sections 5 and 7 |
| S7 | FAQ to Coin-M Perpetual Futures, last updated 2026-05-28 | https://www.bitunix.com/hub/helpcenter/article/faq-to-coin-m-perpetual-futures?id=179 | 2026-09-22 | Bitunix, global | section 3 |
| S8 | Forced Liquidation in Futures Trading and Its Calculation Rules, and Futures Liquidation Mechanism and Tiered Risk Limit, both last updated 2026-05-28 | https://www.bitunix.com/hub/helpcenter/article/forced-liquidation-in-futures-trading-and-its-calculation-rules?id=151 and https://www.bitunix.com/hub/helpcenter/article/bitunix-futuresliquidation-mechanism-and-tiered-risk-limit?id=77 | 2026-09-22 | Bitunix, global | section 7 |
| S9 | Bitunix futures OpenAPI: Get Trading Pairs, Error Code | https://www.bitunix.com/api-docs/futures/market/get_trading_pairs.html and https://www.bitunix.com/api-docs/futures/ErrorCode/error_code.html | 2026-09-22 | Bitunix, global | sections 3 and 5 |
| S10 | CoinGecko derivatives exchange `bitunix_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/bitunix_futures | 2026-09-22 | CoinGecko | sections 1 and 3: 757 perpetual pairs, 0 futures pairs, open interest 24,476.95 BTC, 24 h volume 77,421.06 BTC |
| S11 | CCXT repository, `ts/src` listing and issue search | https://github.com/ccxt/ccxt/tree/master/ts/src and https://github.com/ccxt/ccxt/issues/28131 | 2026-09-22 | CCXT | section 8 |
| S12 | Bitunix review, TradersUnion, third party | https://tradersunion.com/brokers/crypto/view/bitunix/ | 2026-09-22, from a search result | third party | section 1, entity name only |
| S13 | Bitunix Fees 2026, official blog | https://www.bitunix.com/hub/blog/bitunix-features/bitunix-fees-spot-futures-vip-trading-discounts | 2026-09-22 | Bitunix, global | section 5 |
| P1 | `rest-probe.mjs latency` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 UTC | this host | section 1 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 6, 8 |
| P3 | `rest-probe.mjs units` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
| P4 | `rest-probe.mjs history` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
| P5 | `ws-probe.mjs book` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 UTC | this host | section 1 |
