# IMBX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:12 to 04:37 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard exit that geolocates to Canada, and the second pass at 05:04 to 05:06 UTC was refused by a load balancer block, see [`rest.md`](./rest.md) section 6.

This profile covers the fees of IMBX USDT-margined perpetuals, the only perpetual family IMBX lists.
IMBX has no CCXT class and publishes no API documentation.
Its help center article titled "API Docs" says only "Contact us - support@imbx.io", S12.
Every live number below therefore comes from the endpoints IMBX's own web client calls, which [`rest.md`](./rest.md) section 2 names, or from the help center.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator, web copy | "Bull Market labs UAB", in the Terms of Use served at `https://www.imbx.io/legal/`, "Last Updated: Nov 19, 2025", governed by the laws of Lithuania | S1 |
| operator, help center copy | "IMBX, SOCIEDAD ANONIMA DE CAPITAL VARIABLE", in the Terms of Use article the site footer links to, also "Last Updated: Nov 19, 2025", article updated 2026-04-02, governed by the laws of El Salvador | S2 |
| country on CoinGecko | El Salvador, established 2023, trust score 2, trust score rank 167 on 2026-09-23 (the survey list said 158) | S3 |
| registration claim on CoinGecko | "Leveraging Lithuania's VASP (Virtual Asset Service Provider) registration", incorporated in El Salvador as IMBX, S.A. DE C.V. in December 2025 and "actively undergoing the registration process" as a BSP and DASP there | S3 |
| perpetuals today | 29 USDT-margined linear perpetuals, of which 9 are tagged `Stocks` and 5 `Commodity` | P1 `catalog` |
| excluded regions | "Crimea, Donetsk, Luhansk, Cuba, Hong Kong, Iran, North Korea, Singapore, Sudan, the United States (including the following U.S. Territories: Puerto Rico, Guam, U.S. Virgin Islands, American Samoa and the Northern Mariana Islands and the following U.S. Minor Outlying Islands …), Iraq, Libya, Yemen, Afghanistan, the Central African Republic, the Democratic Republic of the Congo, Guinea-Bissau, Haiti, Lebanon, Somalia and South Sudan." | S1 and S2, the same list |
| US corporates | "We have adopted methodology and process to determine whether a corporate entity is a U.S. user (as defined by applicable U.S. regulatory regimes), and thus, prohibited from using the Platform." | S1, S2 |
| futures eligibility | the user warrants "you do not reside in the prohibited countries as set out in Terms of Use, or in any other jurisdictions in which imbx has restricted the offering of any service provided under this Agreement" | S9 clause (f) |
| KYC | "Users must complete at least Level 1 Know Your Customer (KYC) verification to unlock unrestricted trading features." | S4 |
| VPN | "You must not attempt in any way to circumvent any such restriction, including by use of any virtual private network to modify your internet protocol address." | S1 and S2, section 8.5 |
| Canada | not in the Prohibited Countries list | S1, S2 |

A US person may not trade IMBX perpetuals, because the United States and its territories are Prohibited Countries in both copies of the Terms.
The two copies name different operators under different governing law, and which one contracts with a given user is Not publicly specified.

Access from this host, through the Canadian VPN exit, depended on the request's User-Agent and then on volume.
From 04:12 to 04:34 UTC the REST hosts answered HTTP 200 and the futures socket answered 101 when the request carried `User-Agent: node`, which Node's `fetch` sends by default.
A request with a curl User-Agent or with none got HTTP 403 from `awselb/2.0` with a bare `403 Forbidden` HTML body, on REST and on the socket upgrade alike, see [`rest.md`](./rest.md) section 1.
From 04:37 UTC every REST call and socket upgrade got the same 403 even with `User-Agent: node`, after about 250 requests between 04:27 and 04:32 UTC, see [`rest.md`](./rest.md) section 6.
The block still held at 05:05 UTC, so the second pass rechecked every number against the first run's output rather than a rerun.
No header other than the User-Agent was varied, and nothing was done to get around either refusal.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M linear perpetuals | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S7 `VIP 0` `futuresMakerFee` 0.0002 and `futuresTakerFee` 0.0005, S4, S5, S6 |
| spot, coverage only | 0.1 %, 1,000 ppm | 0.1 %, 1,000 ppm | S7 `spotMakerFee` and `spotTakerFee` 0.001, and `quoteFeeRate` 0.001 on all 8 spot pairs, P1 `catalog` |

The futures catalog also carries a fee on each contract, and two contracts differ from the table.

| contract | `openTakerFee` | `closeTakerFee` | `openMakerFee` | `closeMakerFee` |
|---|---|---|---|---|
| 27 of 29, among them `E-BTC-USDT` | 0.0005 | 0.0005 | 0.0002 | 0.0002 |
| `E-ETH-USDT` | 0.00075 | 0.00075 | 0.00025 | 0.00025 |
| `E-TRUMP-USDT` | 0.00005 | 0.0005 | 0.0002 | 0.0002 |

Source: P1 `catalog`, fields of `POST https://lf-api.imbx.io/common/public_info`.
Whether a user is charged the per contract field or the VIP table is Not publicly specified.
Read at face value, an ETH taker cross costs 750 ppm, and a TRUMP taker open costs 50 ppm while the close costs 500 ppm.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 29 | every contract has `contractType` `E`, `contractShowType` `Perpetual`, `contractSide` 1, `marginCoin` `USDT`, P1 `catalog` |
| USDC-M perpetuals | no | `marginCoinList` is `["USDT"]`, P1 `catalog` |
| coin-margined perpetuals | no | no contract has another `marginCoin` or `contractSide`, P1 `catalog` |
| dated futures | no | `deliveryKind` is `"0"` on all 29, and the help center describes delivery futures only in general terms, S5 |
| options | no | no product, route or endpoint found in the web client, S16 |
| spot | yes, 8 USDT pairs: BTC, XAUT, ETH, TRX, SOL, XRP, DOGE, USDC | `POST https://ls-api.imbx.io/common/public_info`, P1 `catalog`, and 7 of them are the pairs CoinGecko tracks, S3 |

CoinGecko's derivatives exchange list of 2026-09-23 has 214 entries and none is IMBX, so CoinGecko tracks only the spot pairs.
The perpetuals are the larger product, and the CoinGecko description says IMBX "specializes in derivatives trading", S3.
The funding endpoints still list 7 more symbols, `STX`, `SUI`, `IMX`, `W`, `TON`, `PYTH` and `BEAMX`, which the catalog no longer carries, see [`rest.md`](./rest.md) section 2.

## 4. Perpetual tiers

From `GET https://api.imbx.io/vip/levels`, P3 `funding`, rows last modified between 2026-04-14 and 2026-04-16.

| level | 30 d spot volume, USDT | 30 d futures volume, USDT | token balance | total assets, USDT | futures maker | futures taker | futures taker ppm |
|---|---:|---:|---:|---:|---:|---:|---:|
| VIP 0 | 0 | 0 | 0 | 0 | 0.02 % | 0.05 % | 500 |
| VIP 1 | 500,000 | 2,500,000 | 30,000 | 30,000 | 0.019 % | 0.05 % | 500 |
| VIP 2 | 2,000,000 | 5,000,000 | 50,000 | 50,000 | 0.016 % | 0.04 % | 400 |
| VIP 3 | 5,000,000 | 8,000,000 | 20,000,000 | 250,000 | 0.014 % | 0.0375 % | 375 |
| VIP 4 | 10,000,000 | 20,000,000 | 50,000,000 | 750,000 | 0.012 % | 0.035 % | 350 |
| VIP 5 | 30,000,000 | 50,000,000 | 100,000,000 | 2,000,000 | 0.01 % | 0.032 % | 320 |
| VIP 6 | 50,000,000 | 100,000,000 | 300,000,000 | 5,000,000 | 0.008 % | 0.03 % | 300 |
| VIP 7 | 100,000,000 | 1,000,000,000 | 1,000,000,000 | 10,000,000 | 0 % | 0 % | 0 |

### Qualification

The reply names four thresholds per level, `spotTradingVolume30dUsdt`, `tradingVolume30dUsdt`, `tokenBalanceRequired` and `totalAssetUsdt`.
Whether a level needs one of them or all of them, and which token `tokenBalanceRequired` counts, is Not publicly specified.
The web client calls `POST /vip/apply` and `POST /vip/apply-special` on the same host, so a level is applied for rather than granted automatically, S16.
The help center has no VIP article, and a search for "VIP" on 2026-09-23 returned one unrelated article.

## 5. Discounts that change the perpetual taker

| discount | finding | source |
|---|---|---|
| token holding | a `tokenBalanceRequired` threshold exists per VIP level, and no fee discount for paying in a token was found | S7 |
| referral | an affiliate program article exists, "IMBX Affiliate Program Policy", updated 2025-12-03, not read | help center search |
| market maker | no program found | help center search for "market maker" |
| promotion | "IMBX Beta Open Commemorative Event _ Voucher Coupons", updated 2026-01-14, not read | help center search |
| per contract fee | `E-TRUMP-USDT` opens at 0.005 % taker, section 2 | P1 `catalog` |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate = average premium index (P) + clamp {interest rate (I)− average premium index (P), a, b}", where `a` and `b` are not given | S8 |
| averaging | I and P are computed every minute and weighted over the interval, "Closer to the settlement time, a higher weight is assigned to recent premium index values." | S8 |
| premium index | "[Max (0, impact bid price − index price) − Max (0, index price − impact ask price)] ÷ index price", impact notional 200 USDT divided by the minimum maintenance margin rate | S8 |
| interest rate | "BTC,ETH : 0.008%, Other : 0.01%" | S8, and `baseInterestRate` 0.00008 on BTC and ETH, 0.0001 on the other 34 rows, P2 `anchor` |
| cap and floor | ±0.375 % on 31 of 36 rows, ±0.4875 % TRX, ±0.75 % SUI and TRUMP, ±2 % PEPE, ±3 % STX, in `maxFundingRate` and `minFundingRate` of the bulk reply. S8's table agrees except that it gives TRUMP ±0.375 % | P2 `anchor`, S8 |
| cap on 4 h contracts | the bulk funding reply gives ±0.00375 for the 5 four hourly contracts, and `public_market_info` gives `fundingRateCap` 0.001875 for `E-COPPER-USDT` | P2 `anchor`, both are written because they disagree |
| interval | 8 h on 24 contracts and 4 h on the 5 commodity contracts, `capitalFrequency` in the catalog and `timePeriod` in the funding reply | P1 `catalog`, P2 `anchor` |
| instants | "Funding occurs at 00:00 UTC, 08:00 UTC, and 16:00 UTC.", and "Some futures may settle the funding fees every 2 or 4 hours." | S4, S8 |
| next settlement | `nextCapitalSettTime` 1790150400000, 2026-09-23 08:00 UTC, on all 29 contracts at 04:27 UTC | P1 `catalog` |
| who pays | positive rate, longs pay shorts, and "The exchange does not collect funding fees" | S4 |
| position value | S4 says quantity times entry price, S8 says "futures position size × index price × funding rate", and S8's worked example uses the mark price | S4, S8, all three are written because they disagree |
| timing tolerance | "the actual Funding Times may be subject to a deviation of up to 60 seconds", and a position opened or closed "within five seconds before or after the funding timestamp does not guarantee the charging or avoidance of the funding fee" | S9 clause 6.6, S8 |

The rate for the next settlement is fixed well before it.
At 04:22 and again at 04:29 UTC the BTC funding history already held a row dated `2026-09-23T08:00:00` at 0.00007885, and `public_market_info` returned `currentFundRate` 0.0000788458795124 for BTC on every one of 60 polls, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | "Liquidation fee = position value × liquidation fee rate", with an example rate of 0.5 %, the actual rate per contract is Not publicly specified | S5 |
| delisting | IMBX "may, at its sole discretion, conceal, suspend, or delist any Token", and after concealment "users may continue to hold existing positions" | S11 |
| settlement price on delisting | Not publicly specified | S9, S11 |
| deposit and withdrawal fees | the official lookup is the help center article "What Is the Deposit/Withdrawal Fee?", `https://imbxhelp.zendesk.com/hc/en-us/articles/52714589955865` | help center search |

## 8. CCXT

No CCXT class exists for IMBX.
`require('ccxt').exchanges` in CCXT 4.5.68, run from `server/`, lists 104 ids and none matches `imb`, `iamb` or `chainup`, and the one id matching `bull` is `bullish`, an unrelated venue.
The `ts/src` folder of `github.com/ccxt/ccxt` at master commit `1d8b674`, dated 2026-09-22 12:48 UTC, lists 112 entries, 105 of them files, and none matches `imb` or `iamb`.
IMBX was earlier named IAMBIT, since its spot `public_info` still names `openapi.iambit.com` and `https://iambit.com`, and no CCXT class carries that name either, see [`rest.md`](./rest.md) section 2.
So `market.taker` for an IMBX swap is undefined, and `ccxtTakerPpm` has nothing to declare.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 500 | the VIP 0 `futuresTakerFee` 0.0005, the help center's 0.05 %, and `closeTakerFee` on 28 of 29 contracts agree. `E-ETH-USDT` would cost 750 ppm if its catalog field is what is charged |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |

This is context for the verdict and not a request to register IMBX.
The engine's catalog is a CCXT class, so IMBX cannot be registered as the code stands, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Terms of Use, web copy, "Last Updated: Nov 19, 2025" | https://www.imbx.io/legal/ | 2026-09-23 | Bull Market labs UAB, Lithuania | operator, Prohibited Countries, VPN clause, section 1 |
| S2 | Terms of Use, help center copy, article updated 2026-04-02 | https://imbxhelp.zendesk.com/hc/en-us/articles/52984705205529 | 2026-09-23 | IMBX, S.A. de C.V., El Salvador | operator, Prohibited Countries, governing law, section 1 |
| S3 | CoinGecko exchange record `imbx` | https://api.coingecko.com/api/v3/exchanges/imbx | 2026-09-23 | CoinGecko | country, trust rank, description, spot pairs, sections 1 and 3 |
| S4 | Futures Trading Fees, Limits, and Rules, updated 2026-01-22 | https://imbxhelp.zendesk.com/hc/en-us/articles/52715192209689 | 2026-09-23 | IMBX, global | 0.02 % and 0.05 %, funding instants, KYC, sections 1, 2 and 6 |
| S5 | Understanding futures fees, updated 2026-06-01 | https://imbxhelp.zendesk.com/hc/en-us/articles/52712026144281 | 2026-09-23 | IMBX, global | 0.02 % and 0.05 %, liquidation fee example, sections 2, 3 and 7 |
| S6 | Fee Schedule and Calculation, updated 2025-11-24 | https://imbxhelp.zendesk.com/hc/en-us/articles/52712633373465 | 2026-09-23 | IMBX, global | worked example at 0.05 % and 0.02 %, section 2 |
| S7 | VIP levels reply | https://api.imbx.io/vip/levels | 2026-09-23 | IMBX, live | VIP table, sections 2 and 4 |
| S8 | Perpetual futures funding rate calculation, updated 2025-12-03 | https://imbxhelp.zendesk.com/hc/en-us/articles/52712586546329 | 2026-09-23 | IMBX, global | funding formula, interest, caps, instants, section 6 |
| S9 | Futures Services Agreement, updated 2025-12-03 | https://imbxhelp.zendesk.com/hc/en-us/articles/52984938199705 | 2026-09-23 | IMBX, global | eligibility warranty, funding time deviation, sections 1, 6 and 7 |
| S10 | Perpetual Futures on Traditional Assets, updated 2026-03-06 | https://imbxhelp.zendesk.com/hc/en-us/articles/55759177417113 | 2026-09-23 | IMBX, global | TradFi index and mark rules, [`rest.md`](./rest.md) section 4 |
| S11 | Trading Concealment, Suspension and Token Delisting, updated 2026-01-22 | https://imbxhelp.zendesk.com/hc/en-us/articles/54481528009625 | 2026-09-23 | IMBX, global | delisting, section 7 |
| S12 | API Docs, updated 2025-12-03 | https://imbxhelp.zendesk.com/hc/en-us/articles/52989418374425 | 2026-09-23 | IMBX, global | the whole body is "Contact us - support@imbx.io" |
| S16 | IMBX web client bundles, chunks `4083-367f78b32b08a08e.js`, `4313-f76e79e21745dc68.js` and `2666-faf07c25c3e5980f.js` | https://www.imbx.io/_next/static/chunks/ | 2026-09-23 | IMBX web client | API hosts and paths, VIP apply calls, socket frames, sections 3 and 4 |
| P1 | `rest-probe.mjs catalog` at 04:27 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | catalog fields, spot pairs, User-Agent refusals |
| P2 | `rest-probe.mjs anchor` at 04:28 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | bulk funding reply, caps, interest, current rate |
| P3 | `rest-probe.mjs funding` at 04:29 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/imbx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | VIP table, funding history |
