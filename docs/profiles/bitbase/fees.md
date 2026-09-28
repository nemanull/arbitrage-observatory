# Bitbase Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-23 06:44 to 07:10 UTC and 2026-09-24 06:28 to 06:40 UTC, which are the evenings of 2026-09-22 and 2026-09-23 on the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, edge `YVR`).

This profile covers the perpetual futures of Bitbase (www.bitbase.com, CoinMarketCap slug `bitbase-com`, id 33662), which has no CCXT class.
It is not BitBase.io (CoinMarketCap slug `bitbase`, id 318), which CoinMarketCap marks `inactive` with 0 market pairs, S1.
Bitbase publishes no API documentation, and every page and API path on www.bitbase.com except `robots.txt` answers this host with a Cloudflare challenge, see [`rest.md`](./rest.md) section 1.
The fee facts below therefore come from the Bitbase help center on Zendesk, from CoinMarketCap, and from an archived copy of the web app's own symbol list.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Bitbase Corp., the counterparty named in the Terms of Use, governed by the laws of the Republic of Panama with arbitration in Panama City | S4 |
| founded | 2023, CoinMarketCap lists a launch date of 2023-06-01 and a Panama headquarters with offices in Hong Kong, Singapore and Dubai | S1 |
| who may trade | any person who is not a Restricted Person, is not resident in or accessing from an Excluded Jurisdiction, and is 18 or older | S4 section 3.1 (c) and definitions |
| excluded regions | the Terms define a Prohibited Jurisdiction as any place under comprehensive OFAC, EU or UN sanctions, and never list the Excluded Jurisdictions they refer to | S4 |
| excluded regions, as listed to CoinMarketCap | "including but not limited to the United States, mainland China, Iran, North Korea, Syria, Cuba" | S1 description |
| US persons | may not trade, per the CoinMarketCap listing text, S1 | the Terms alone do not name the United States |
| VPN clause | "You are not accessing the Platform from any Excluded Jurisdiction, including through the use of a VPN, proxy server, or other means of circumventing geographic restrictions." | S4 section 3.1 (c) |
| KYC | the help center has an article on KYC requirements and account limits, not read beyond its title | S15 |
| this host | the web site and every REST path refuse this host with a Cloudflare managed challenge, HTTP 403 with `cf-mitigated: challenge`, and the futures and spot WebSockets accept it, see [`rest.md`](./rest.md) section 1 | P1, P2 |

The fee pages were read on 2026-09-23 UTC, and the help center, the VIP notice and the CoinMarketCap fees were read again on 2026-09-24 UTC.
The official fee page, `https://www.bitbase.com/rate`, answers this host with HTTP 403, the home page answered the WebFetch tool with HTTP 403 as well, and the archived fee page of 2026-07-21 shows the table as "Loading...", S12.

## 2. Quick answer

| family | maker | taker | ppm maker | ppm taker | source |
|---|---:|---:|---:|---:|---|
| USDT-M perpetuals, VIP 0 | 0.0200 % | 0.0600 % | 200 | 600 | S6, S1, S13 |
| USDC-M perpetuals, VIP 0 | 0.0200 % | 0.0600 % | 200 | 600 | S13, every USDC row of the archived symbol list |
| spot, VIP 0, context only | 0.1 % | 0.1 % | 1,000 | 1,000 | S1 description |

The 2026-09-04 tier change raised the taker of VIP 1 to VIP 5 and VIP 7 and left VIP 0 at 0.0600 %, S6.
The archived symbol list of 2026-09-10 carries `makerFee` `"0.0002"` and `takerFee` `"0.0006"` on 849 of its 853 rows, S13 and P3.
The four exceptions are `trx_usdt`, `stx_usdt` and `rave_usdt` with maker `"0.0004"`, and `gno_usdt` with taker `"0.0007"`, and `gno_usdt` had a delisting announced.
CoinMarketCap's exchange record gives `makerFee` 0.02 and `takerFee` 0.06, in percent, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 761 live on 2026-09-23 and 766 on 2026-09-24 | the `agg_tickers` stream carried 795 perpetuals, 761 of them `_usdt`, in every frame on 2026-09-23, and 800, 766 of them `_usdt`, in the union of the 2026-09-24 reads, P2 |
| USDC-M linear perpetuals | yes, 34 live | 34 `_usdc` rows in the same stream, P2 |
| TradFi perpetuals, stocks, commodities, indices and forex | yes, inside the USDT-M list, for example `nbis_usdt`, `xau_usdt`, `soxl_usdt` | S13, P2 |
| coin-margined (inverse) perpetuals | not listed | the archived list has `underlyingType` `U_BASED` on all 853 rows, S13. The Futures Services Agreement still defines Coin-M futures as a term, S5 |
| dated futures | not listed | `contractType` `PERPETUAL` on all 853 archived rows, S13, and CoinMarketCap counts 0 futures pairs, S2 |
| options | not listed | none on the site's product lists or in CoinMarketCap, S2 |
| spot | yes | 399 spot pairs on CoinMarketCap, S2, and `wss://stream.bitbase.com/public` served a BTC_USDT book, P2 |

CoinMarketCap counts 740 perpetual pairs, 3.38 billion USD of perpetual volume in 24 h and 891 million USD of open interest on 2026-09-23, S1 and S2.
The socket carried 795 perpetual symbols at the same time, P2.

## 4. Perpetual tiers

The only published tier table is the 2026-09-04 notice, which covers every futures contract, S6.
It took effect at 14:35 UTC on 2026-09-04.

| VIP | maker | taker before 2026-09-04 | taker from 2026-09-04 | taker ppm |
|---|---:|---:|---:|---:|
| VIP 0 | 0.0200 % | 0.0600 % | 0.0600 % | 600 |
| VIP 1 | 0.0180 % | 0.0500 % | 0.0550 % | 550 |
| VIP 2 | 0.0160 % | 0.0400 % | 0.0500 % | 500 |
| VIP 3 | 0.0140 % | 0.0375 % | 0.0450 % | 450 |
| VIP 4 | 0.0120 % | 0.0350 % | 0.0400 % | 400 |
| VIP 5 | 0.0100 % | 0.0320 % | 0.0350 % | 350 |
| VIP 6 | 0.0080 % | 0.0300 % | 0.0300 % | 300 |
| VIP 7 | 0.0050 % | 0.0200 % | 0.0250 % | 250 |

### Qualification

"The system automatically calculates the trading volume (USDT equivalent) over the past 30 days and updates user VIP levels and fees before 02:00 (UTC+0) daily.", S12.
The volume threshold of each tier sits in the client-side table of the fee page, which was not readable from here, so the thresholds are Not verified.
The fee page adds that "The fee rate may be adjusted according to platform promotions or the user's region.", S12.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| exchange token | none, Bitbase has no fee token | no article in the 309 help center articles names one, S15 |
| VIP level | the table in section 4 | S6 |
| referral and agent rebates | agent rebates are settled in USDT, rebate ratios are not published | S16 |
| trial funds and fee coupons | event trial funds offset fees at a 50 % deduction ratio, and a compensation plan handed out 100 USDT fee deduction coupons | S17 |
| market maker | registered market makers are exempt from the high frequency rules, and their fee terms are not published | S10 |
| zero fee promotion | none found | S15 |

The high frequency rules matter more than any discount for a taker strategy.
They flag "Ultra-Short-Term Scalping" with a holding time under 3 minutes, a short-term order share over 50 %, and the "Short-Term + Full Taker Combination" where makers are under 20 % of an account's orders, S10.
The penalties run from a warning to forfeited rebates, frozen privileges and a permanently blacklisted account, S10.
The rules name arbitrage as protected short-term trading, yet an engine that crosses with takers and closes within minutes matches the flagged pattern.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | longs and shorts exchange payments on position nominal value at the Funding Rate | S5, S14 |
| interval | "the times falling at each 8-hour interval or as may be amended or varied by Bitbase from time to time", and "the actual Funding Times may be subject to a deviation of up to 60 seconds" | S5 |
| settlement instants | Not publicly specified, and no REST call that would name them could be read from this host | [`rest.md`](./rest.md) section 3 |
| formula | Not publicly specified | S7, S14 |
| cap and floor | Not publicly specified | S14 |
| published rate | the `fund_rate@<symbol>` topic pushes one rate per symbol at each minute boundary, for example `-0.00000125` on `btc_usdt`, `0.00005981` on `eth_usdt` and `0.0001` on `doge_usdt` at 07:06 UTC on 2026-09-23. At 06:35 UTC on 2026-09-24, 340 of 795 perpetuals read exactly `0.00005`, 138 read 0 and 75 read `0.0001`, and the largest magnitude was `-0.0070758` on `cvc_usdt` | P2, [`websocket.md`](./websocket.md) section 2, [`rest.md`](./rest.md) section 4 |
| on delisting | "No funding fees or delivery fees will be charged during the settlement process." | S9 |

The settlement instant itself was not captured, and whether the pushed rate is the one for the upcoming settlement is Not verified.
The rate moved between the two minutely pushes on `btc_usdt` and `eth_usdt` on 2026-09-23, and on `btc_usdt`, `eth_usdt` and `doge_usdt` on 2026-09-24, which fits a predicted rate for the coming settlement rather than a settled one, P2.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | the mark price, when the maintenance margin ratio reaches 100 % | S8 |
| liquidation sequence | cancel orders, net hedged positions, partial liquidation to risk tier 1, then the Insurance Fund takes over at the bankruptcy price, then auto-deleveraging | S8 |
| liquidation fee | not stated in the liquidation article. The archived symbol list carries a `liquidationFee` field of `"0.0125"` on 748 rows, `"0.015"` on 67, `"0.01"` on 21, `"0.02"` on 12, `"0.125"` on 3 and `"0.025"` on 2, whose meaning is Not publicly specified | S8, S13 |
| auto-deleveraging | "No trading fee is charged for an ADL execution." | S8 |
| delisting | new positions stop at the announcement, open positions are settled at "the 30-minute average index price prior to delisting", with no funding or delivery fee | S9 |
| delisting pace | 22 help center articles announce perpetual delistings. The latest, of 2026-09-23 08:42 UTC, names `SPACEHOODUSDT` for 2026-09-28 and `TOADUSDT`, `AMPUSDT`, `MICRODUCKUSDT` and `SAYLORMOONUSDT` for 2026-09-29, and the ones before it named `PIPEDOGUSDT` for 2026-09-25, `RCATUSDT` for 2026-09-22 and `ICXUSDT` for 2026-09-18 | S15, S18 |
| maintenance | six upgrade windows in September 2026 up to the 22nd, on the 2nd, 5th, 9th, 16th, 19th and 22nd, each starting at 23:00 UTC with an estimated impact of 15 to 60 minutes, during which futures "orders placement, opening/closing positions may fail" | S11, S15 |

## 8. CCXT

CCXT 4.5.68 has no Bitbase class.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and none matches `bitbase`, P4.
The CCXT master branch on GitHub, `ts/src` at commit `0588dade44` of 2026-09-23 07:09 UTC, has 112 entries and none matches `bitbase`, and at commit `15b904507e` of 2026-09-24 06:29 UTC it has 111 entries and none matches, P4.
So there is no `market.taker` to report, and `ccxtTakerPpm` has nothing to declare.

The web app is built on the XT.com code base, see [`websocket.md`](./websocket.md) section 1, and CCXT has an `xt` class.
That class points at `fapi.xt.com` and `sapi.xt.com`, and Bitbase serves no such host, since `fapi.bitbase.com` has a Cloudflare CNAME and no address and `sapi.bitbase.com` does not resolve, P1.
So the `xt` class cannot be pointed at Bitbase by overriding its URLs.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 perpetual taker, unchanged by the 2026-09-04 notice, S6, and equal to the `takerFee` of 849 of 853 archived contracts, S13 |
| `ccxtTakerPpm` | unset | no CCXT class exists |

No registry entry is recommended today, because the catalog and the anchor cannot be read, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap exchange record, Bitbase | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bitbase-com | 2026-09-23 | Bitbase, global | fees 0.02 and 0.06, volumes, open interest, launch date, headquarters, restricted countries, spot fees. Also `slug=bitbase` for the inactive BitBase.io |
| S2 | CoinMarketCap market pairs, `category` spot, perpetual and futures | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bitbase-com&category=perpetual&start=1&limit=5 | 2026-09-23 | Bitbase | 740 perpetual, 399 spot and 0 futures pairs |
| S3 | CoinMarketCap derivatives ranking | https://coinmarketcap.com/rankings/exchanges/derivatives/ | 2026-09-23 | CoinMarketCap | Bitbase at position 45 of the page's structured data, with 1,140 markets. [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) records rank 42 |
| S4 | Terms Of Use, updated 2026-07-22 | https://bitbase-support.zendesk.com/hc/en-us/articles/5181225937566-Terms-Of-Use | 2026-09-23 | Bitbase Corp., Panama | counterparty, governing law, eligibility, Prohibited Jurisdiction, VPN clause |
| S5 | Futures Services Agreement, updated 2026-08-02 | https://bitbase-support.zendesk.com/hc/en-us/articles/5199905354910-Futures-Services-Agreement | 2026-09-23 | Bitbase | Funding Times every 8 hours, Coin-M term, fee discounts |
| S6 | Bitbase VIP Tier Adjustment Notice, 2026-09-04 | https://bitbase-support.zendesk.com/hc/en-us/articles/5628585245726-Bitbase-VIP-Tier-Adjustment-Notice | 2026-09-23 | Bitbase | the VIP 0 to VIP 7 futures fee table |
| S7 | Explanation of Bitbase futures Mark Price, 2026-08-25 | https://bitbase-support.zendesk.com/hc/en-us/articles/5605761537054-Explanation-of-Bitbase-futures-Mark-Price | 2026-09-23 | Bitbase | mark formula, no funding formula |
| S8 | Bitbase Contract Liquidation Mechanism, updated 2026-09-07 | https://bitbase-support.zendesk.com/hc/en-us/articles/5586652436382-Bitbase-Contract-Liquidation-Mechanism | 2026-09-23 | Bitbase | liquidation, Insurance Fund, ADL |
| S9 | Bitbase Delisting Announcement for PIPEDOGUSDT Perpetual Contract, 2026-09-23 | https://bitbase-support.zendesk.com/hc/en-us/articles/5675153758366-Bitbase-Delisting-Announcement-for-PIPEDOGUSDT-Perpetual-Contract | 2026-09-23 | Bitbase | delisting settlement rule |
| S10 | Explanation of High-Frequency Trading Management Rules, updated 2026-09-09 | https://bitbase-support.zendesk.com/hc/en-us/articles/5380234761502--Official-Announcement-Explanation-of-High-Frequency-Trading-Management-Rules | 2026-09-23 | Bitbase | holding time, taker share and penalties |
| S11 | Bitbase System Upgrade Announcement (September 22, 2026) | https://bitbase-support.zendesk.com/hc/en-us/articles/5673358764702-Bitbase-System-Upgrade-Announcement-September-22-2026 | 2026-09-23 | Bitbase | maintenance scope and length |
| S12 | Wayback Machine copy of the fee page, 2026-07-21 | https://web.archive.org/web/20260721014757/https://www.bitbase.com/rate | 2026-09-23 | Bitbase | VIP update rule, regional adjustment, the table renders client-side |
| S13 | Wayback Machine copy of the web app's symbol list, 2026-09-10 | https://web.archive.org/web/20260910123242id_/https://www.bitbase.com/fapi/market/v2/public/symbol/list?isPredict=true&isDelivery=true | 2026-09-23 | Bitbase | per contract `makerFee`, `takerFee`, `liquidationFee`, `underlyingType`, `contractType` |
| S14 | Risk Disclosure Statement, updated 2026-09-12 | https://bitbase-support.zendesk.com/hc/en-us/articles/5205541097374-Risk-Disclosure-Statement | 2026-09-23 | Bitbase | funding exchanged between longs and shorts |
| S15 | Bitbase help center article list, 306 articles on 2026-09-23 UTC and 309 on 2026-09-24 UTC | https://bitbase-support.zendesk.com/api/v2/help_center/en-us/articles.json | 2026-09-23 | Bitbase | titles, delisting and maintenance counts, absence of API docs and fee tokens |
| S16 | Bitbase Agent Rebate Settlement Unified to USDT | https://bitbase-support.zendesk.com/hc/en-us/articles/5625925740830--Important-Notice-Bitbase-Agent-Rebate-Settlement-Unified-to-USDT | 2026-09-23 | Bitbase | agent rebates |
| S17 | BWTC trading competition rules, and the risk control compensation statement | https://bitbase-support.zendesk.com/hc/en-us/articles/5458287528094 and https://bitbase-support.zendesk.com/hc/en-us/articles/5304559504670 | 2026-09-23 | Bitbase | trial funds and fee coupons |
| S18 | Bitbase Announcement on the Delisting of Multiple Perpetual Contracts, 2026-09-23 | https://bitbase-support.zendesk.com/hc/en-us/articles/5675490393502-Bitbase-Announcement-on-the-Delisting-of-Multiple-Perpetual-Contracts | 2026-09-23 | Bitbase | close-only and delisting dates for five contracts |
| P1 | `rest-probe.mjs access`, runs at 2026-09-23 07:01 and 07:09 UTC and 2026-09-24 06:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbase/rest-probe.mjs) | 2026-09-23 | this host | DNS, challenge on every REST path, sections 1 and 8 |
| P2 | `ws-probe.mjs catalog`, `anchor` and `errors`, two runs each between 2026-09-23 06:44 and 07:07 UTC, and one each between 2026-09-24 06:28 and 06:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | live perpetual counts, funding pushes, spot socket |
| P3 | `rest-probe.mjs archive`, runs at 2026-09-23 07:02 and 07:09 UTC and 2026-09-24 06:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbase/rest-probe.mjs) | 2026-09-23 | this host | archived fee fields summarised |
| P4 | `rest-probe.mjs ccxt`, runs at 2026-09-23 07:01 and 07:10 UTC and 2026-09-24 06:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbase/rest-probe.mjs) | 2026-09-23 | this host | no Bitbase class in CCXT 4.5.68 or master |
