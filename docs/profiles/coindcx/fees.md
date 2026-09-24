# CoinDCX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:25 PDT, which is 03:25 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the fees of CoinDCX perpetual futures, the only derivatives the public API exposes.
CoinDCX has no class in CCXT 4.5.68 or in current CCXT master, see section 8.
The fee page `https://coindcx.com/fees` refuses this host, so the numbers below come from the public instrument API and from the support centre, see section 1.
Every CoinDCX perpetual is a brokered copy of a Binance USD-M perpetual, see [`rest.md`](./rest.md) section 2, and that shapes every section below.
All probe times are UTC on 2026-09-23.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Neblio Technologies Private Limited, "an Indian company having corporate identification number U74999MH2018PTC304533 registered with the Financial Intelligence Unit bearing No. VA00030982" | S2, preamble |
| who may trade | a user represents that "you are an Indian citizen and/or an authorised person of an entity registered in India" and "You are an Indian resident under the ITA (as amended) and the Foreign Exchange Management Act, 1999" | S2, clause 11.1 (b) and (c) |
| US persons | excluded, since every user must be an Indian resident | S2, clause 11.1 |
| routing around a block | the terms prohibit "use of VPNs, proxies, GPS-" spoofing to evade "geographic restriction, or eligibility requirement" | S2, prohibited usage |
| how futures execute | "we act as a broker on your behalf in connection with Futures and place corresponding orders with third party exchanges which will be fulfilled on such third party exchanges" | S2, Part IV paragraph I, clause 4 |
| CoinGecko | trust rank 99, trust score 5, 24 h volume 22.9 BTC over 5 tracked tickers, country field "Singapore", not in the derivatives exchange list of 214 | S9, read 03:47 UTC |

The terms name no third-party exchange.
The wire does: every perpetual is spelled `B-<base>_USDT`, the mark and both funding fields equal Binance USD-M's on all 504 active pairs, and every book update carries the event time of a Binance diff event, see [`rest.md`](./rest.md) section 2 and [`websocket.md`](./websocket.md) section 4.

What this host could read, on 2026-09-22 and 2026-09-23 UTC:

| URL | result |
|---|---|
| `https://coindcx.com/fees`, `/futures`, `/terms`, `/blog/`, `/robots.txt`, `/sitemap.xml` | HTTP 403 from Cloudflare with the "Just a moment..." JavaScript challenge, `cf-ray` ending `-SEA` |
| `https://coindcx.com/fees` in one headless Chrome run | "Sorry, you have been blocked. You are unable to access coindcx.com", Cloudflare Ray ID `a3f66d3cbd6776f2` |
| `https://coindcx.com/fees` and `/documentation/crypto-futures` through WebFetch | HTTP 403 |
| `https://docs.coindcx.com/` | 200, 1.12 MB, read in full |
| `https://coindcx.s3.amazonaws.com/static/documents/terms-of-use.pdf` | 200, 8 pages |
| `https://support.coindcx.com/` category pages | 200, the answers are embedded URL encoded in each page |
| `api.coindcx.com`, `public.coindcx.com`, `stream.coindcx.com` | 200 and 101, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 |

The block on `coindcx.com` was not routed around.
The VIP tier table therefore stays Not verified, see section 4.

## 2. Quick answer

| family | maker | taker | ppm, maker and taker | source |
|---|---|---|---|---|
| USDT-M perpetuals, USDT margin, anonymous API | 0.0236 % | 0.059 % | 236 and 590 | `maker_fee` and `taker_fee` of the instrument call on 495 of 504 pairs, P1 |
| USDT-M perpetuals, INR margin | 0.02 % plus GST | 0.05 % plus GST | 200 and 500 before GST, 236 and 590 with it | S3, "INR Margin Futures: Standard trading fees apply to all users Maker Fee: 0.02% & Taker Fee: 0.05%", and the same API values, 0.0236 and 0.059, under `margin_currency_short_name=INR` on `B-BTC_USDT`, `B-ETH_USDT` and `B-DOGE_USDT`, P2 |

The API figures are the support figures times 1.18.
0.05 % times 1.18 is 0.059 %, and 0.02 % times 1.18 is 0.0236 %.
India charges 18 % GST on trading fees, and the support centre states it for Insta orders: "a 0.59% trading fee on the order value and an additional 18% GST applicable on the trading fee", S3.
That the API figure includes GST is an inference from the ratio, and the engine should model the 590 ppm the account is charged.
USDT margin fees "are based on your VIP Level", S3, and the anonymous API returns the INR margin standard fee, so the VIP 0 USDT margin fee is taken to be the same 0.05 % before GST.
That equality is Not verified, because the tier table sits behind the block in section 1.

Nine pairs differ from the common fee, and the second pass names them in section 5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals, USDT margin | present, 504 active | `active_instruments?margin_currency_short_name[]=USDT`, P2 |
| USDT-M linear perpetuals, INR margin | present, the same 504 contracts | the INR list equals the USDT list as a set, P2. The margin is converted at a CoinDCX rate that only an authenticated call returns, S1 "Get Currency Conversion" |
| other margin currencies | absent | `margin_currency_short_name[]=BTC` returns `[]`, P2 |
| coin-margined or inverse perpetuals | absent | `is_inverse` "Ignore this. This will be false", S1, and false on 504 of 504 |
| commodity perpetuals | present, 6 of the 504 | `B-XAU_USDT`, `B-XAG_USDT`, `B-CL_USDT`, `B-BZ_USDT`, `B-NATGAS_USDT`, `B-COPPER_USDT`, which Binance files as `TRADIFI_PERPETUAL`, P2 |
| Global Futures, stock and index perpetuals in INR | present in the product, absent from the public API | "CoinDCX is introducing Global Perpetual Futures, enabling Indian users to trade futures contracts on leading Global stocks & Indices such as Tesla, NVIDIA, Apple", S7. No such pair is in either active list |
| dated futures | absent | "CoinDCX only supports perpetual contracts for now, so this value will always be "perpetual"", S1, and `kind` is `perpetual` on 504 of 504, P1 |
| options | present in the product, absent from the public API | Part IV paragraph H "Options" of S2, and the support category `crypto-options-trading`. The API documentation names no options call |
| spot | present, 995 markets | `markets_details` by `ecode`: `I` 338 INR markets, and `B` 378, `KC` 239 and `G` 40 markets under other exchange codes, P2 |
| margin trading on spot | present | the margin order calls of S1 |

The API FAQ still says "Is Futures trading available through Public APIs: No, currently this feature is not available", while the same page documents futures order calls, S1.

## 4. Perpetual tiers

The tier table is published at `https://coindcx.com/fees`, which refused this host, see section 1.
So no tier row, threshold or discount below VIP 0 is recorded here, and the table is Not verified.

What the support centre states about qualification, S4:

- "Your VIP Level is calculated based on your trading volume over the last 30 days. This includes both Spot and Futures trading across INR and USDT pairs."
- "Your VIP Level is reviewed weekly based on your last 30 days of trading volume. Updates are processed every Monday."
- "No, VIP Levels are automatically assigned based on your trading volume. No separate opt-in is required."
- "Starting May 2026, your INR Futures trading volume will be included in VIP Level calculations."
- INR margin futures keep the standard fee at every level: "No, there are no changes in the fee structure. INR Margin Futures continue to have standard fees applicable to all users."
- "No, Options and Global Futures trading volume is not included in the VIP Level calculation."
- "As your tier increases, you can enjoy reduced fees on Spot and Futures (USDT Margin)".

The API has no call for the account's own tier: "Can I get my fee tier via APIs: We currently don't have this available on our APIs", S1 FAQ.

## 5. Discounts that change the perpetual taker

| item | finding | source |
|---|---|---|
| VIP level | lowers the USDT margin fee only, table Not verified | S4 |
| emerging pairs | "Some Futures pairs may have different fee structures because they are classified as Emerging Pairs. These are newly listed pairs or pairs with relatively lower market liquidity and trading activity." | S3 |
| coverage fee | "the Coverage Fee applies only to selected Futures trading pairs" that "are newly listed, less established, or have lower market liquidity" | S3 |
| per pair fees on the wire | 495 pairs at 0.0236 and 0.059, 7 at 0.0118 and 0.0118, 2 at 0.0413 and 0.1003, all in percent | P1 |
| token holding, referral, market maker | none found in the readable sources | S1, S3, S4 |
| zero fee promotions | none found in the readable sources | S3 |

0.0118 % is 0.01 % with GST, and 0.1003 % is 0.085 % with GST, by the same 1.18 ratio.
The seven pairs at 0.0118 % pay one fifth of the common taker, and the two pairs at 0.1003 % are the dearest.

| maker and taker, API | pairs, P1 |
|---|---|
| 0.0118 % and 0.0118 % | `B-XAU_USDT`, `B-XAG_USDT`, `B-CL_USDT`, `B-BZ_USDT`, `B-NATGAS_USDT`, `B-COPPER_USDT`, `B-PAXG_USDT` |
| 0.0413 % and 0.1003 % | `B-B2_USDT`, `B-CELR_USDT` |
| 0.0236 % and 0.059 % | the other 495 |

The cheap group is the six commodity perpetuals and the gold token PAXG.
The dear group matches the "Emerging Pairs" and "Coverage Fee" wording, and the API does not label it, so that match is an inference.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula of the payment | "Position Quantity × Mark Price × Funding Rate (%)" | S5 |
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative | S5 |
| venue fee on funding | "No. CoinDCX does not charge any funding fees." | S5 |
| rate | CoinDCX publishes no rate formula. `efr` equals Binance USD-M `lastFundingRate` on 504 of 504 pairs in every read, and `fr` equals the last Binance settlement on 504 of 504 away from a settlement | P2, see [`rest.md`](./rest.md) section 4 |
| cap and floor | not published by CoinDCX. The published rate is Binance's, so Binance's caps apply, see [`../binance/fees.md`](../binance/fees.md) section "Futures funding" | inference from P2 |
| interval, documented | "Most Crypto Futures markets have a funding interval of 8 hours. Some Futures markets have a funding interval of 4 hours. During periods of high market volatility, the funding interval for certain Futures ma[rkets]" changes | S5 |
| interval, on the wire | `funding_frequency` is 4 h on 397 pairs, 8 h on 105 including `B-BTC_USDT` and `B-ETH_USDT`, and 1 h on `B-G_USDT` and `B-LSK_USDT`, and equals Binance `fundingInfo` on 504 of 504 | P1 |
| next settlement instant | not published by CoinDCX | S1 |
| isolated margin | "any funding fee you pay is deducted from the margin allocated to your position, while any funding fee you receive is added to it" | S10 |
| before a delisting | "Funding fees will continue to apply as per the normal funding schedule until the Futures pair is settled" | S11 |

The documentation and the wire disagree on which interval is common: the support page says most pairs are 8 hourly, and the instrument call says 397 of 504 are 4 hourly.
The settlement instant itself was not captured.
The nearest reads came after the 04:00 UTC settlement of the 4 hourly pairs.
At 04:03:49 UTC, `fr` differed from Binance's newest settled rate on 13 of 504 pairs, and at 04:04:13 UTC it equalled the newest rate on 502 and the previous rate on 2, P2.
So `fr` takes up to about 4 minutes after a settlement to show it.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | "This happens when the Last Traded Price (LTP) reaches your liquidation price." | S10 |
| liquidation fee | `liquidation_fee` is 1.5 on 469 pairs and 1 on 35, described as "Applicable fee if the trade received for the order is a trade for the liquidation order". The unit is Not publicly specified, and percent is the likely reading | S1, P1 |
| maintenance margin | stepped by position size in `dynamic_safety_margin_details`, for example 1.5 % up to 50,000 USDT in the documented sample | S1 |
| settlement | none, since every contract is perpetual. `expiry_time` is "Ignore this" | S1 |
| delisting | "If your position remains open at the time of delisting, it will be automatically settled at the prevailing market price." | S11 |
| exit only pairs | `B-STG_USDT` had `exit_only` true, which blocks new positions | P1 |
| TDS | "TDS is not applicable on trading in Futures. TDS is applicable only on Spot trading & Insta trading." | S6 |

Deposit and withdrawal schedules are out of scope, and their official lookup is `https://coindcx.com/fees`, which refused this host.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `dcx` or `coind`. The two India ids present are `mudrex` and `zebpay` |
| CCXT master on GitHub | `ts/ccxt.ts` at version 4.5.82, commit `1d8b674` of 2026-09-22 12:48 UTC, imports no CoinDCX class. `ts/src/coindcx.ts` and `ts/src/pro/coindcx.ts` answer 404 on `raw.githubusercontent.com` |
| requests | issue 22708 "new exchange: coindcx integration" is open since 2024-06-03, and issues 4878, 5034, 6235 and 9816 asked the same between 2019 and 2021 |

So `market.taker` does not exist for CoinDCX, and `ccxtTakerPpm` has no value.

## 9. Recommended registry values

No registry entry is recommended.
The venue has no CCXT class to build its catalog, only Indian residents may trade it, and its books and marks are Binance USD-M's relayed with a delay, see [`rest.md`](./rest.md) section 8.
If it were ever added as a read-only leg, `takerPpm` would be 590, the VIP 0 taker with GST, and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinDCX API documentation | https://docs.coindcx.com/ | 2026-09-22 | CoinDCX, India | instrument fields, fee fields, FAQ, currency conversion, perpetual only, sections 2 to 7 |
| S2 | CoinDCX Exchange Terms of Use | https://coindcx.s3.amazonaws.com/static/documents/terms-of-use.pdf | 2026-09-22 | Neblio Technologies Private Limited, India | entity, eligibility, broker model, options and futures parts, sections 1 and 3 |
| S3 | Support, Trading Fees | https://support.coindcx.com/categories/trading-fees/6a6703f0afcc3948e7d1431e | 2026-09-22 | CoinDCX, India | futures fee, emerging pairs, coverage fee, GST on Insta orders, sections 2 and 5 |
| S4 | Support, VIP Levels | https://support.coindcx.com/categories/vip-levels/6a6703dfafcc3948e7d0a954 | 2026-09-22 | CoinDCX, India | VIP qualification, section 4 |
| S5 | Support, Funding | https://support.coindcx.com/categories/funding/6a621abd5060288302176db3 | 2026-09-22 | CoinDCX, India | funding formula, interval, no venue fee, section 6 |
| S6 | Support, Fees & Taxes | https://support.coindcx.com/categories/fees-taxes/6a621e7050602883021d5347 | 2026-09-22 | CoinDCX, India | TDS, section 7 |
| S7 | Support, Introduction to Global Futures | https://support.coindcx.com/categories/introduction-to-global-futures/6aa79fd6476186e39c3be9cb | 2026-09-22 | CoinDCX, India | stock and index perpetuals, section 3 |
| S8 | CoinDCX fee page | `https://coindcx.com/fees` | refused 2026-09-22 | CoinDCX | tier table, Not verified |
| S9 | CoinGecko exchange API | https://api.coingecko.com/api/v3/exchanges/coindcx | 2026-09-23 03:47 UTC | CoinGecko | rank, volume, section 1 |
| S10 | Support, Liquidation | https://support.coindcx.com/categories/liquidation/6a621ca850602883021abdaa | 2026-09-22 | CoinDCX, India | liquidation trigger, funding and isolated margin, sections 6 and 7 |
| S11 | Support, Futures Pair Delisting | https://support.coindcx.com/categories/futures-pair-delisting/6a71b362fda418ffbfb97564 | 2026-09-22 | CoinDCX, India | delisting settlement and funding, sections 6 and 7 |
| S12 | CCXT master | https://github.com/ccxt/ccxt/blob/master/ts/ccxt.ts | 2026-09-22 | CCXT | no CoinDCX class, section 8 |
| S13 | CCXT issue 22708 | https://github.com/ccxt/ccxt/issues/22708 | 2026-09-22 | CCXT | open integration request, section 8 |
| P1 | `rest-probe.mjs instruments` at 03:26 to 03:31 and 03:49 to 03:53 UTC, the second run naming the pairs | [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs) | 2026-09-23 UTC | this host | fees, intervals, liquidation fee, exit only, sections 2 to 7 |
| P2 | `rest-probe.mjs catalog` at 03:25 to 03:27, 03:54 and 04:03 to 04:04 UTC, the last two runs with the fee check under both margins | [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs) | 2026-09-23 UTC | this host | active lists, the fee check under both margins, the Binance comparison, spot markets, sections 2, 3 and 6 |
