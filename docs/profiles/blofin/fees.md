# BloFin Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, between 03:23 and 03:38 UTC on 2026-09-23, from the development host near Seattle, where every BloFin host answered HTTP 403 with a restricted region page.

This profile covers the fees of BloFin (CoinGecko trust rank 68, CCXT id `blofin`) on its perpetual swaps, with spot named only in the coverage matrix.
Every BloFin host refuses this machine, including the fee page and the API documentation, see section 1.
So every published number below comes from an Internet Archive copy of the official page, and each source row gives the capture date.
No proxy, VPN or other route to the live pages was used.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | BLF Global Limited, Reg. No. 11983, called "Blofin Global" in the Terms of Use | S3 |
| governing law | "the laws of England and Wales" | S3 |
| country on CoinGecko | Marshall Islands, established 2021 | S9 |
| restricted locations | "the Marshall Island, Belarus, Burundi, Central African Republic, China Mainland, Crimea, Cuba, Democratic People's Republic of Korea, Democratic Republic of the Congo, Donetsk, Eritrea, Guinea Bissau, Guinea, Haiti, Iran, Iraq, Lebanon, Liberia, Libya, Luhansk, Mali, Myanmar, Canada, Russia, Rwanda, Sevastopol, Serbia, Sierra Leone, Somalia, South Sudan, Sudan, Syria, Singapore, Trinidad and Tobago, United States of America, Venezuela, Yemen, Zimbabwe" | S3, the 2024-09-11 copy |
| US persons | may not trade, since the United States of America is a Restricted Location | S3 |
| what this host saw | HTTP 403 from Cloudflare on `openapi.blofin.com`, `demo-trading-openapi.blofin.com`, `docs.blofin.com`, `blofin.com` and `www.blofin.com`, with the body "We noticed that your IP address is from one of BloFin's restricted countries or regions. Unfortunately, BloFin is not able to provide service to users in these regions under our Terms and Conditions." | P1, P3 |

The Terms of Use copy is from 2024-09-11, because the current article `blofin.com/en/support/Terms/7296238795279-TERMS-OF-USE` has no archived copy and refuses this host.
The 2026 support index still links that article, S10.
Whether the 2026 list still names Venezuela and Canada is Not verified, so the list above is the latest readable version and not proof of the current one.
The United States is excluded by both the 2024 terms and the live refusal on 2026-09-22.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S2, `general_fee_rate` `futures_taker_fee_rate` `"0.0006"` |
| USDC-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S2 publishes one "Futures" row, so the same rate is inferred |
| coin-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | same inference |

The support article on futures fees prints the same 0.02 % and 0.06 % and the formula "Contract Value * Number of Contracts * Average Transaction Price * Fee Rate", S7.
The live fee page on 2026-09-22 could not be read, so a change after 2026-06-11 would be invisible here.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes | 461 live `SWAP` rows settling in USDT in the 2026-09-16 archived instruments reply, S8, and 481 USDT perpetuals on CoinGecko on 2026-09-22, S9 |
| USDC-M perpetuals | yes | 10 rows, `BTC-USDC`, `ETH-USDC`, `SOL-USDC` and 7 more, S8, and the site menu item "USDC-M Futures", S2 |
| coin-M perpetuals | yes | 14 rows with `contractType` `inverse`, quote `USD` and settlement in the base coin, such as `BTC-USD`, S8, and the menu item "Coin-M Futures", S2 |
| dated futures | no | every catalog row is `instType` `SWAP`, S8, CoinGecko lists 0 futures pairs, S9, and CCXT declares `'future': false` at `server/node_modules/ccxt/js/src/blofin.js` line 32 |
| options | no | CCXT declares `'option': false` at line 33, and no option product appears in the menu, S2 |
| spot | yes, not in CCXT | 0.1000 % maker and taker, S2, and CCXT declares `'spot': false` at line 29 |

The USDT-M set holds 22 stock, 2 commodity and 2 index perpetuals by `assetClass`, among them `SPY-USDT`, `QQQ-USDT`, `NVDA-USDT`, `CL-USDT` and `NG-USDT`, S8.

## 4. Perpetual tiers

From the `vip_fee_rate_configs` block of the fee page, S2.
A user qualifies by 30 day futures volume, or 30 day spot volume, or total assets, and gets the best tier any one of them reaches.

| tier | futures maker | futures taker | 30 day futures volume, USDT | or 30 day spot volume, USDT | or assets, USDT |
|---|---|---|---|---|---|
| VIP 0 | 0.0200 % | 0.0600 % | below VIP 1 | below VIP 1 | below VIP 1 |
| VIP 1 | 0.0060 % | 0.0500 % | 10,000,000 | 1,000,000 | 50,000 |
| VIP 2 | 0.0040 % | 0.0450 % | 25,000,000 | 2,000,000 | 500,000 |
| VIP 3 | 0.0020 % | 0.0425 % | 50,000,000 | 4,000,000 | 1,000,000 |
| VIP 4 | 0.0010 % | 0.0400 % | 200,000,000, or 160,000,000 non-API | 6,000,000, or 4,800,000 non-API | 2,000,000 |
| VIP 5 | 0.0000 % | 0.0350 % | 500,000,000, or 400,000,000 non-API | 8,000,000, or 6,400,000 non-API | 3,000,000 |

The page says "VIP levels are updated every morning at 12:00 (UTC)", and that volume is reset at 00:00 UTC and assets are snapshotted at 00:00 UTC, S2.
Sub-accounts take the main account's rate, S2.

## 5. Discounts that change the perpetual taker

| discount | effect | evidence |
|---|---|---|
| new listing | "0 Maker fees and 50% off Taker fees for the first 48 hours", "with the maximum Taker fee being only 0.03%" | S4, the KAT pre-market listing |
| time-limited symbols | `GME-USDT`, `BMNR-USDT`, `GLW-USDT` and `ASML-USDT` at 0 maker and 0.03 % taker, expiring 2026-06-13 08:00 and 09:45 UTC | S2, `futures_discount_symbols` |
| high risk symbols | none for futures on 2026-06-11, while 26 spot pairs pay 0.2 % | S2 |
| referral | CCXT's describe block carries a referral URL with `'discount': 0.05` | `server/node_modules/ccxt/js/src/blofin.js` lines 169 to 172, not a published BloFin rule |
| token holding | none found | S2 |
| market maker program | Not verified | the support center refuses this host |

The two time-limited windows had ended by 2026-09-22, so no discount is known to apply to a steady-state taker today.

## 6. Funding as a cost

The funding formula, the cap and the floor are Not verified.
The help center articles that hold them refuse this host, and none of them has an archived copy.
What the readable sources do say:

- The interval is set per contract and changes by announcement: `PRCLUSDT` moved from "Every 8 hour" to "Every 1 hours" on 2025-10-15, S5, and `KATUSDT` listed with "Funding Fee Settlement Frequency Every 4 hours", S4.
- The rate has an interest rate term and a cap, since BloFin may update "funding rates (such as the interest rate and capped funding rate)" on a contract under review, S6.
- The API's funding-rate call returns `fundingRate` and `fundingTime`, and its history call pages by `fundingTime`, S1.
- CoinGecko's snapshot of 2026-09-22 showed funding rates between -0.456 % and 0.099 %, median 0.007 %, across 481 USDT perpetuals, S9.

Who pays whom, and at which instant, is Not verified.
The settlement instant itself was not captured, and the funding history call refuses this host, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

A delisted perpetual first goes reduce-only, then all orders are cancelled and "BloFin Futures will close all positions and conduct an automatic settlement" in a stated one hour window, as for `FORTHUSDT` and `LRCUSDT` from 07:00 to 08:00 UTC on 2026-03-24, S6.
The price used for that settlement is not stated in the readable copy.
The liquidation fee and the insurance fund rule are Not verified.

## 8. CCXT

`market.taker` is 0.0006 and `market.maker` is 0.0002 on every swap market, without credentials.
`parseMarket` reads `this.safeDict2(this.fees, type, 'trading', {})` with `type` `swap`, at `server/node_modules/ccxt/js/src/blofin.js` lines 532 to 534, and `fees.swap` is `'taker': this.parseNumber('0.00060')` and `'maker': this.parseNumber('0.00020')` at lines 277 to 280.
[`rest-probe.mjs`](../../../scripts/probes/venues/blofin/rest-probe.mjs) `ccxt` ran `parseMarket` offline on the documented instruments row and printed `"taker":0.0006,"maker":0.0002`, P2.
`loadMarkets` itself fails from this host with `ExchangeNotAvailable`, because the base class maps HTTP 403 to that error at `server/node_modules/ccxt/js/src/base/Exchange.js` line 2408, P2.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 futures taker, S2 and S7 |
| `ccxtTakerPpm` | leave unset | CCXT reports the same 600 ppm, so the connector check at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 38 passes without it |

These values only matter from a host that BloFin serves, see the verdict in [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BloFin API Documents, Internet Archive copy of 2025-10-31 | https://web.archive.org/web/20251031005137/https://docs.blofin.com/index.html | 2026-09-22, live page HTTP 403 | BloFin, global | funding-rate call fields, section 6 |
| S2 | BloFin Fee Schedule, Internet Archive copy of 2026-06-11, read from the page and its `__NEXT_DATA__` `feeRateSchedule` block | https://web.archive.org/web/20260611100556/https://blofin.com/en/fees | 2026-09-22, live page HTTP 403 | BloFin, global | VIP 0 and tiers, discounts, product menu, sections 2 to 5 |
| S3 | Terms of Use, Internet Archive copy of 2024-09-11 | https://web.archive.org/web/20240911040900/https://blofin.com/en/terms | 2026-09-22, live URL 404 in the archive since 2025-11-18 | BLF Global Limited | entity, law, Restricted Location list, section 1 |
| S4 | "BloFin Pre-Market Listing: Trade KATUSDT with 0% Maker Fees & 50% Off Taker Fees!", copy of 2026-08-26 | https://web.archive.org/web/20260826190426/https://blofin.com/en/support/Announcement/Futures-Listing/15331342000783-BloFin-Pre-Market-Listing-Trade-KATUSDT-with-0-Maker-Fees-50-Off-Taker-Fees | 2026-09-22 | BloFin | listing discount, 4 h interval, contract size 10 KAT, sections 5 and 6 |
| S5 | "Adjustment of Funding Rate Intervals for PRCL Perpetual Contract (2025-10-15)", copy of 2026-07-26 | https://web.archive.org/web/20260726233020/https://blofin.com/en/support/Announcement/Trading-Updates/14044544134031-Adjustment-of-Funding-Rate-Intervals-for-PRCL-Perpetual-Contract-2025-10-15 | 2026-09-22 | BloFin | 8 h default and 1 h interval, section 6 |
| S6 | "BloFin Will Delist FORTHUSDT and LRCUSDT Perpetual Contracts", copy of 2026-08-30 | https://web.archive.org/web/20260830150452/https://blofin.com/en/support/Announcement/Delisting/15504988317711-BloFin-Will-Delist-FORTHUSDT-and-LRCUSDT-Perpetual-Contracts | 2026-09-22 | BloFin | delisting settlement, interest rate and cap, index constituents, sections 6 and 7 |
| S7 | "How Are Futures Trading Fees Calculated", copy of 2026-05-15 | https://web.archive.org/web/20260515100245/https://blofin.com/en/support/FAQ/Top-Questions/9049331029775-How-Are-Futures-Trading-Fees-Calculated | 2026-09-22 | BloFin | 0.02 % and 0.06 %, fee formula, section 2 |
| S8 | `GET /api/v1/market/instruments?instType=SWAP`, Internet Archive copy of 2026-09-16 | https://web.archive.org/web/20260916172500/https://openapi.blofin.com/api/v1/market/instruments?instType=SWAP | 2026-09-22, live call HTTP 403 | BloFin | families and counts, asset classes, section 3 |
| S9 | CoinGecko derivatives exchange `blofin` with unexpired tickers | https://api.coingecko.com/api/v3/derivatives/exchanges/blofin?include_tickers=unexpired | 2026-09-22 | CoinGecko | 482 perpetual pairs, 481 USDT tickers, country, funding range, sections 1, 3 and 6 |
| S10 | BloFin support index and Terms index, copies of 2026-05-15 | https://web.archive.org/web/20260515081431/https://blofin.com/en/support/Terms | 2026-09-22 | BloFin | the current Terms of Use article exists, section 1 |
| S11 | CCXT 4.5.68 `blofin.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/blofin.js` | 2026-09-22 | CCXT | fee constants, has flags, 403 mapping, sections 3, 5 and 8 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/blofin/rest-probe.mjs) `access` | | 2026-09-23 03:23 and 03:33 UTC | this host | the 403 refusal on every host, section 1 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/blofin/rest-probe.mjs) `ccxt` | | 2026-09-23 03:23 and 03:33 UTC | this host | `loadMarkets` error, offline `parseMarket`, section 8 |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/blofin/ws-probe.mjs) `access` | | 2026-09-23 03:24, 03:33 and 03:37 UTC | this host | the socket refusal, section 1 |
