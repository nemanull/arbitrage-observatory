# Pionex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:05 to 03:50 UTC), from the development host near Seattle.

Pionex lists perpetual futures on its public API, although the CoinGecko derivatives list of 2026-09-22 does not show it.
The catalog call `GET /api/v1/common/symbols?type=PERP` returned 606 perpetuals, all `TRADING`, see [`rest.md`](./rest.md) section 2.
So this profile covers every perpetual family, and spot appears only in the coverage matrix.
No CCXT 4.5.68 class exists for Pionex, and none exists in CCXT master either, see section 8.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22, probe runs 2026-09-23 03:05 to 03:50 UTC | P1 to P5 |
| operator | "Pionex Operator: shall mean Marketa Trading Inc." The terms add "neither Pionex Pte. Ltd. nor Pionex Inc. is a Pionex Operator." | S7 |
| restricted jurisdictions | "Mainland China, Hong Kong, United States, Singapore, Afghanistan, Cuba, Iran, North Korea, Syria, United Kingdom, Canada, Netherlands, Spain, France", plus persons on sanctions lists | S7 |
| no phone service and no KYC | Iran, North Korea, Central African Republic, Cuba, Crimea, Lebanon, Libya, Somalia, South Sudan, Sudan, Venezuela, Yemen, Afghanistan, Congo DR, Zimbabwe, Singapore, China, Hong Kong, Guam, Puerto Rico, Hawaii, Canada, United States, United Kingdom, France, Austria, Netherlands, Japan, in the article updated 2025-12-01 | S8 |
| US persons | may not trade. The United States is a Restricted Jurisdiction and US phone numbers get no KYC | S7, S8 |
| who may trade the perpetuals | a verified account holder outside the lists above. No separate derivatives entity or eligibility test for futures was found in the pages read | S7 |

This profile covers the global Pionex exchange only, and not Pionex US.

Access from this host was split by hostname on 2026-09-23.
`api.pionex.com` and `ws.pionex.com` answered every public call, behind Cloudflare, see [`rest.md`](./rest.md) section 1.
The documentation site `https://www.pionex.com/docs/` answered 200 and serves each page as Markdown when `.md` is appended, S1.
Every other `www.pionex.com` page tried, among them `/en/fees`, `/en/vip`, `/blog/` and `/robots.txt`, answered 403 with `cf-mitigated: challenge` and a "Just a moment..." page.
`support.pionex.com` answered 403 to a plain request, and its Zendesk API at `/api/v2/help_center/en-us/articles/24972845418649.json` answered 403 with the body `error code: 1034`.
The same fee page refused WebFetch with 403, and one headless Chrome instance on this host got only the challenge page.
So the fee schedule and the help center articles were read from Wayback Machine snapshots, each dated in section 10, and the live pages were not read.
The newest snapshot of `/en/fees` (2026-05-18) holds only the "Your browser is not supported" shell, so the fee page itself was not readable at all.

## 2. Quick answer

| family | VIP 0 ("Regular") maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, 561 contracts | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S4 |
| coin-quoted perpetuals, 23 contracts such as `BTC_ETH_PERP` | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S4 |
| `USDT_<coin>` perpetuals, 22 contracts such as `USDT_BTC_PERP` | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S4 |
| spot, context only | 0.05 %, 500 ppm | 0.05 %, 500 ppm | S4 |

The VIP table has one "Futures" column, so every perpetual family pays the same rate.
The family counts are from P1.
The Liquidation article also says a trader closing before liquidation pays a "trading fee ratio is up to 0.05%", S6.
No fee number was readable from a live Pionex page, see section 1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals, `<BASE>_USDT_PERP` | yes, 561, mixing crypto with tokenized stocks and ETFs whose symbols end in `X`, such as `AAPLX_USDT_PERP`, and commodities such as `XAU_USDT_PERP` and `WTI_USDT_PERP` | P1 |
| coin-quoted perpetuals, `<BASE>_<ETH\|BTC\|SOL>_PERP` | yes, 23: 9 quoted in ETH, 11 in BTC, 3 in SOL | P1 |
| `USDT_<coin>_PERP`, USDT priced in a coin | yes, 22, for example `USDT_BTC_PERP`, whose index read `0.0000115263844` BTC per USDT at 03:38 UTC | P1, P2 |
| USDC-M perpetuals | absent from the catalog | P1 |
| dated futures | absent. The catalog `type` enum is `SPOT` or `PERP`, the `contractType` enum is `PERPETUAL`, and `type=FUTURES` answers `MARKET_PARAMETER_ERROR` | S2, P1 |
| options | absent from the market API. Dual Investment under the Earn API is a structured product, not an order book | S3 |
| spot | yes, 410 symbols, 338 with `enable` true | P1 |
| leveraged tokens, XStock spot, Spot Innovation Zone, MEME Guru | yes, on spot, each at a fixed fee outside the VIP table | S4 |

What margins the `USDT_<coin>` and coin-quoted families was not documented in the pages read.
The margin asset of a coin-quoted contract is presumably its quote coin, which is an inference and not verified.
The engine's quote family keeps USD, USDC and USDT, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), so only the USDT-M family matters for it.

## 4. Perpetual tiers

The VIP table below is the appendix image of "Pionex VIP Tier System Upgrade", dated 2025-10-22 and effective 2025-11-01 00:00 UTC+8, S4.
A search result for the older article "Pionex VIP Fee Rate Adjustment" says it was updated on 2026-01-25 and that the latest VIP fee rate took effect on 2025-11-01, S9, so no later schedule was found.

| tier | 30-day futures volume, USDT | futures maker | futures taker | or 30-day average equity, USDT | spot 30-day volume, BTC | spot maker | spot taker |
|---|---:|---|---|---:|---:|---|---|
| Regular | ≥ 0 | 0.02 %, 200 ppm | 0.05 %, 500 ppm | 0 | ≥ 0 | 0.05 % | 0.05 % |
| VIP1 | ≥ 3,000,000 | 0.019 %, 190 ppm | 0.048 %, 480 ppm | ≥ 50,000 | ≥ 20 | 0.048 % | 0.05 % |
| VIP2 | ≥ 5,000,000 | 0.018 %, 180 ppm | 0.045 %, 450 ppm | ≥ 100,000 | ≥ 30 | 0.045 % | 0.05 % |
| VIP3 | ≥ 10,000,000 | 0.016 %, 160 ppm | 0.040 %, 400 ppm | ≥ 200,000 | ≥ 75 | 0.040 % | 0.05 % |
| VIP4 | ≥ 50,000,000 | 0.014 %, 140 ppm | 0.040 %, 400 ppm | ≥ 500,000 | ≥ 120 | 0.035 % | 0.05 % |
| VIP5 | ≥ 100,000,000 | 0.012 %, 120 ppm | 0.035 %, 350 ppm | ≥ 1,000,000 | ≥ 180 | 0.030 % | 0.05 % |
| VIP6 | ≥ 250,000,000 | 0.010 %, 100 ppm | 0.030 %, 300 ppm | ≥ 2,000,000 | ≥ 300 | 0.025 % | 0.05 % |
| VIP7 | ≥ 500,000,000 | 0.008 %, 80 ppm | 0.030 %, 300 ppm | ≥ 5,000,000 | ≥ 750 | 0.020 % | 0.05 % |
| VIP8 | ≥ 1,000,000,000 | 0.006 %, 60 ppm | 0.025 %, 250 ppm | ≥ 10,000,000 | ≥ 1,500 | 0.015 % | 0.05 % |
| VIP9 | ≥ 2,500,000,000 | 0.004 %, 40 ppm | 0.025 %, 250 ppm | ≥ 20,000,000 | ≥ 3,000 | 0.010 % | 0.05 % |
| VIP10 | ≥ 5,000,000,000 | 0.001 %, 10 ppm | 0.020 %, 200 ppm | ≥ 50,000,000 | ≥ 6,000 | 0.010 % | 0.05 % |

### Qualification

- "Meeting any one of the following criteria will upgrade your VIP tier: 30-day futures trading volume, 30-day spot and leveraged token trading volume, or 30-day average total account assets.", S4.
- The tier is recalculated "daily at 01:30 (UTC)" with no application, S4.
- The equity figure counts the Primary Account, the Futures Account and the Pionex Card Account, S4.
- The same table also sets an Arbitrage VIP-Only product quota and a monthly bonus coupon, which do not change a trading fee, S4.

## 5. Discounts that change the perpetual taker

| discount | finding | source |
|---|---|---|
| exchange token | none. Pionex has no fee token in any page read, and the VIP table has no token column | S4 |
| referral or rebate | "Pionex Rebate Rules Update Announcement" is listed beside the VIP article, and its terms were not read | S4 |
| market maker program | no official page found. Third-party reviews describe a 0 % maker program, which is not verified here | none |
| zero fee or discount promotions | the help center title "Limited Event: ETH/BTC Futures Fee Discount 50% Off!" exists with a Wayback capture of 2023-08-07, and its dates and terms were not read | S9 |
| fixed fee products | XStock spot 0.1 %, leveraged tokens 0.1 %, Spot Innovation Zone 0.5 %, MEME Guru 1 %, none eligible for VIP discounts. These are spot products and do not touch the perpetual taker | S4 |

The engine models a VIP 0 taker, so none of these changes the recommended value.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate (F) = Average Premium Index (P) + clamp(Interest Rate Differential (I) – Average Premium Index (P), 0.05%, -0.05%)" | S5 |
| premium sampling | "Pionex calculates the premium index every 5 seconds and then calculates its mean (P) every N* hours. N* = Funding Interval." The premium index formula itself is not published | S5 |
| interest rate | "Interest Rate Differential (I) = (Quoted Currency Daily Interest Rate – Base Currency Daily Interest Rate) / Funding Rate Frequency", where "Funding Rate Frequency = 24 / Funding Interval" | S5 |
| payment | "Funding Fee = Position Size x Mark Price x Funding Rate". Longs pay shorts when the rate is positive, and shorts pay longs when it is negative | S5 |
| interval | 8 h, 4 h or 1 h, set per contract. The funding history showed 8 h gaps on `BTC_USDT_PERP`, `ETH_USDT_PERP`, `USDT_BTC_PERP` and `BTC_ETH_PERP`, 4 h on `ACE_USDT_PERP` and `KERNEL_USDT_PERP`, and 1 h on `AAX_USDT_PERP`. A sample of every eighth contract, 76 of 605, read 8 h on 29, 4 h on 44 and 1 h on 3 | P3, P5 |
| interval changes | the help center announces them one contract at a time, with titles such as "Pionex Updates the Funding Rate Settlement Frequency of DRIFTUSDT Perpetual Futures" | S9 |
| settlement instants | 00:00, 08:00 and 16:00 UTC for 8 h contracts, every fourth hour for 4 h contracts, and every hour for 1 h contracts, from the `fundingTime` values of the history | P3 |
| settlement jitter | "the actual settlement time may have a deviation of 1 minute" | S5 |
| cap and floor | none published. The clamp bounds only `I - P`, and `P` is unbounded in the formula | S5 |
| observed extremes | `KERNEL_USDT_PERP` settled at -1.235754 % on its 4 h interval at 00:00 UTC, and `nextFundingRate` spanned -0.726859 % to +0.0989 % over 605 contracts at 03:18 UTC, and -0.588756 % to +0.0926 % at 03:38 UTC | P2, P3 |

The settlement instant itself was not captured, and no probe waited for one.
The published `nextFundingRate` is the estimate for the upcoming settlement, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- "Liquidation Fee = Value of the position closed by liquidation * Liquidation fee ratio of the trading pair", S6.
- The ratio is per contract and public as `liquidationFeeRate` in the catalog, P1.
  It ranged from 0.006 to 0.125 over the 606 contracts, with 0.025 the most common.
  `BTC_USDT_PERP` read 0.0115, while the article's example quotes 1.75 % and warns "The fee ratios in the document may not be the latest data.", S6.
- A liquidated position is taken over at the mark price, and an Insurance Fund first funded by Pionex covers a negative balance, S6.
- No dated futures exist, so no settlement or delivery fee applies.
- Perpetual delistings are announced one by one, for example "Pionex Futures Will Delist BLZUSDT Perpetual Contract", S9, and the delisting terms were not read.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `pionex`, and no `pionex.js` under `server/node_modules/ccxt/js/src/` | P1 |
| CCXT master, `ts/src` | 112 entries at commit `1d8b674` of 2026-09-22 12:48 UTC, none matching `pionex`. `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/pionex.ts` answered 404, and `ts/src/pro` has no Pionex file either | S10 |
| pull request #27466 | "fix(pionex): golang sdk support", opened 2025-12-08 by `pionex-official`, still open and unmerged. It adds only `go/v4/pionex.go`, `go/v4/pionex_api.go` and `go/v4/pionex_wrapper.go` plus `go.work.sum`, with no TypeScript class | S10 |
| pull request #27465 | "Feat pionex support ccxt", closed on 2025-12-08 without merging | S10 |
| issue #18847 | "New Exchange: PIONEX", open since 2023-08-10 | S10 |

So `market.taker` has no value for any Pionex market, and `ccxtTakerPpm` has no CCXT source line to cite.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 500 | the Regular futures taker of 0.05 %, S4, which is the same for every perpetual family |
| `ccxtTakerPpm` | none | there is no CCXT class. The catalog would come from a stand-in exchange object that maps `GET /api/v1/common/symbols?type=PERP` to CCXT-shaped markets and sets `taker` to 0.0005 itself, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Pionex Docs index | https://www.pionex.com/docs/llms.txt | 2026-09-22 | Pionex, global | the Markdown page list, section 1 |
| S2 | Futures API, Common | https://www.pionex.com/docs/api-docs/futures-api/common.md | 2026-09-22 | Pionex, global | catalog enums, section 3 |
| S3 | API change log | https://www.pionex.com/docs/api-docs/readme/change-log.md | 2026-09-22 | Pionex, global | Earn Dual Investment endpoints, section 3 |
| S4 | Pionex VIP Tier System Upgrade, 2025-10-22, and its appendix image `/hc/article_attachments/51746640692249` | https://support.pionex.com/hc/en-us/articles/51746121935641-Pionex-VIP-Tier-System-Upgrade, read as Wayback snapshot `20260521225916` | 2026-09-22 | Pionex, global | sections 2, 4 and 5 |
| S5 | Funding Fee, updated 2025-08-01 | https://support.pionex.com/hc/en-us/articles/45028729414041-Funding-Fee, Wayback snapshot `20251010023717` | 2026-09-22 | Pionex, global | section 6 |
| S6 | Liquidation, updated 2025-03-27 | https://support.pionex.com/hc/en-us/articles/45032139183769-Liquidation, Wayback snapshot `20250916232121` | 2026-09-22 | Pionex, global | sections 2 and 7 |
| S7 | Pionex Terms of Service, dated 2024-07-09 | https://www.pionex.com/blog/pionex-terms-of-service/, Wayback snapshot `20260519194316` | 2026-09-22 | Marketa Trading Inc. | section 1 |
| S8 | List of Unsupported Countries'/Regions' Phone Numbers & KYC Verification, updated 2025-12-01 | https://support.pionex.com/hc/en-us/articles/5929910517273-List-of-Unsupported-Countries-Regions-Phone-Numbers-KYC-Verification, Wayback snapshot `20260217033254` | 2026-09-22 | Pionex, global | section 1 |
| S9 | web search results and Wayback listings of support.pionex.com article titles | https://support.pionex.com/hc/en-us/articles/24972845418649-Pionex-VIP-Fee-Rate-Adjustment and the article titles quoted | 2026-09-22 | Pionex, global | the 2026-01-25 update, interval and delisting announcements, the 2023 promotion, sections 4 to 7 |
| S10 | CCXT repository | https://github.com/ccxt/ccxt/tree/master/ts/src, https://github.com/ccxt/ccxt/pull/27466, https://github.com/ccxt/ccxt/pull/27465, https://github.com/ccxt/ccxt/issues/18847 | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 03:17 and 03:36 UTC | this host | sections 2, 3, 7 and 8 |
| P2 | `rest-probe.mjs anchor` | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 03:17 and 03:37 UTC | this host | section 6 |
| P3 | `rest-probe.mjs funding` | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 03:18, 03:36 and 03:37 UTC | this host | section 6 |
| P4 | curl of `www.pionex.com`, `support.pionex.com` and the Wayback availability API, one headless Chrome load | none kept | 2026-09-23 03:06 to 03:12 UTC | this host | section 1 |
| P5 | `rest-probe.mjs intervals` | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 03:48 and 03:49 UTC | this host | section 6 |
