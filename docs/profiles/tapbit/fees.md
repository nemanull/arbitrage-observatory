# Tapbit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:21 to 03:37 UTC, from the development host near Seattle.
Every documented perpetual REST path and the WebSocket refused this host with HTTP 403, so no perpetual fee or funding number below was read from the venue's API.

This profile covers the USDT-margined perpetuals of Tapbit, which has no CCXT class.
The pages on `www.tapbit.com` answer this host with a Cloudflare challenge and HTTP 403, and the WebFetch tool got 403 on `https://www.tapbit.com/fee` too.
So the fee schedule, the rules and the restrictions below come from the Tapbit help center, read through its Zendesk Help Center API at `https://tapbitcex.zendesk.com/api/v2/help_center/en-us/articles/<id>.json`, which answered this host with HTTP 200.
The article pages themselves at `https://tapbitcex.zendesk.com/hc/en-us/articles/<id>` answered 403, so each source below names the article id.
The API documentation at `https://www.tapbit.com/openapi-docs/` is served outside the challenge and answered 200.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22, Seattle time | this profile |
| operator | the Terms of Use name "Tapbit Exchange", and the site footer of the archived fees page reads "©2026 Tapbit LLC" | S8, S22 |
| licensing claim | "Tapbit is registered as a Money Services Business with FinCEN" and "is currently applying to obtain money transmitter licenses from multiple States within the United States" | S7, updated 2025-03-20 |
| excluded regions | 38 jurisdictions, among them the United States, China, India, France, Norway, Thailand and the sanctioned states. Corporate accounts may be restricted in Antigua and Barbuda and Bermuda, and Hong Kong SAR is partly restricted | S6, updated 2026-06-25 |
| US persons | may not trade. The United States is on the restricted list, which contradicts the FinCEN and state licence wording of S7 | S6, S7 |
| perpetual API access | "Futures API access still requires an application" by email to `api@tapbit.com`, KYC, and in every 14-day cycle a perpetual volume of at least 5,000,000 USDT with maker volume at least 50 % of it, or the access is revoked with no right to reapply | S9 updated 2025-10-24, S10 |
| spot API access | "available to all KYC-verified and eligible users" | S9 |
| API firewall | "Update our firewall rules. All clients should be added into whitelist so that they can visit the API.", changelog entry of 2024-12-13 in the perpetual, spot and spot v2 docs | S2 |
| CoinGecko listing | "Tapbit (Futures)", country United States, established 2021, 116 perpetual pairs, 0 dated futures | S23, P5 |

So the perpetual market data API is gated twice.
The firewall refuses a host that is not on the whitelist, and the whitelist is granted only to an approved, KYC-verified account that keeps trading 5,000,000 USDT per 14 days.
The refusal this host received is in [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S3, "Trading Fees on Derivatives 0.02 % \| 0.06 %", updated 2025-12-29 |

The table in S3 gives one derivatives rate for maker and one for taker and names no VIP level, so it is read as the base retail rate.
The fees page on the site shows "Maker--" and "Taker--" to a visitor who is not logged in, in the Wayback capture of `https://www.tapbit.com/en/fees` of 2026-02-17, S22.
The rate an account pays is therefore not public, and it was not read from an account.

History, from S4 and S5.
The derivatives taker was cut from 0.06 % to 0.04 % on 2022-08-16 and set back to 0.06 % in the announcement of 2022-12-14.
The maker stayed at 0.02 % through both.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 116 | S2 documents only a "USDT Perpetual API". CoinGecko lists 116 perpetuals, all quoted in USDT, on 2026-09-22, P5 |
| USDC-M perpetuals | no | no API section, and 0 of 116 CoinGecko perpetuals quote USDC, P5 |
| coin-margined perpetuals | no | no API section, P5 |
| dated futures | no | CoinGecko `number_of_futures_pairs` 0, P5 |
| options | no | no API section, and the help center hits for "options" are earn products, S2 |
| spot | yes, 64 pairs | the spot v2 catalog answered this host with 58 USDT and 6 USDC pairs, P4 |

The 116 perpetuals mix crypto with TradFi contracts.
On CoinGecko 60 of the 116 carry no CoinGecko coin id, and they include equities such as `AAPL`, `NVDA` and `TSLA`, ETFs such as `SPY`, `QQQ` and `SOXL`, commodities such as `GOLD`, `SILVER(XAG)` and `OIL(WTI)`, and the pre-IPO names `OPENAI` and `ANTHROPIC`, P5.
`TRUMP` also has no coin id there, and it is a crypto token.
Pre-IPO contracts can be rebased, which divides the mark price and multiplies the position size by the disclosed share count over 1,000,000,000, with trading restricted around the rebase, S18.
The TradFi listing of 2026-06-17 gives multipliers such as "1 = 0.01 SPY" and "1 = 0.001 OPENAI", S19.

## 4. Perpetual tiers

VIP levels exist from VIP 0 to VIP 5, reviewed every 30 days since 2026-03-13, with a 15-day protection period for VIP 3 to VIP 5, S17.
The tier table with each level's maker and taker and its qualification rule lives on `https://www.tapbit.com/en/vip`.
That page refuses this host with the Cloudflare challenge, and the Wayback Machine holds no capture of it, so the tier table is Not verified.

| tier | maker | taker | qualification |
|---|---|---|---|
| VIP 0 | 0.02 % | 0.06 % | none, S3 |
| VIP 1 to VIP 5 | Not verified | Not verified | Not verified |

## 5. Discounts that change the perpetual taker

| discount | finding | source |
|---|---|---|
| token holding | none found. Tapbit has no exchange token named in the fee articles read | S3 |
| referral | Not found in the fee articles read. The referral events found pay cash rewards | S3 |
| market maker | none published. The futures API conditions require at least 50 % maker volume and give no rebate | S9, S10 |
| zero fee promotions | spot only. BTC/USDT and ETH/USDT spot at 0 % continue, SOL/USDT, DOGE/USDT and XRP/USDT ended on 2025-12-26 08:00 UTC. None on perpetuals was found | S21, S3 |

The spot v2 catalog agrees: `taker_fee_rate` and `maker_fee_rate` are `"0"` on BTC/USDT and ETH/USDT and `"0.001"` on the other 62 pairs, P4.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `F = P + clamp(I - P, 0.05%, -0.05%)`, with `P` the premium index from the impact bid and ask against the mark, and `I = (quote interest index - base interest index) / funding interval` | S11 |
| cap | the absolute rate is capped at 75 % of the initial margin minus the maintenance margin, for example 0.375 % at 1 % and 0.5 % | S11 |
| change limit | the rate "may not change by more than 75% of the Maintenance Margin between Funding Intervals" | S11 |
| interval | 8 h by default at 00:00, 08:00 and 16:00 UTC. "for certain trading pairs, it may be every 1 hour or 4 hours" | S11, S15 updated 2026-08-07 |
| interval changes | announced per contract, for example HYPE-SWAP moved to 4 h at 2026-09-04 10:37 UTC | S20 |
| who pays | position value times rate, long pays short when the rate is positive, short pays long when negative, "exchanged directly by way of peer-to-peer", and Tapbit takes no fee on it | S11 |
| who is charged | only a position held at the settlement instant | S11 |

The API documents no funding history call for the perpetuals, only `GET /api/usdt/instruments/funding_rate`, "the latest funding rate of the current contract", S2.
Whether that rate is the upcoming or the last settled one is Not publicly specified.
The settlement instant itself was not captured, because the API refused this host and this survey does not wait for a clock event.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation | the position passes to the liquidation engine at the bankruptcy price. A fill better than bankruptcy goes to the insurance fund, a shortfall draws on it, and after that auto-deleveraging | S16 |
| liquidation fee | none stated in S16 | S16 |
| maintenance margin tiers | `https://www.tapbit.com/contract/content/positionTiers`, behind the Cloudflare challenge, Not verified | S16 |
| settlement | "Perpetual Contracts do not expire or settle." | S15 |
| pre-IPO rebase | position size times the multiplier and mark price divided by it, trading restricted before and during, TP and SL orders cancelled | S18 |
| delisting | spot delistings are announced a few days ahead, 27 pairs on 2026-09-04. No perpetual delisting charge was found | help center article 17459546448527 |

## 8. CCXT

CCXT 4.5.68 has no Tapbit class.
`require('ccxt').exchanges` run from `server/` lists 104 ids and none contains "tap", P6.
The current CCXT master, version 4.5.82 in its `package.json`, has none either: its `exchanges.json` lists 105 ids with no Tapbit entry, and `ts/src/tapbit.ts` and `ts/src/pro/tapbit.ts` return 404 on `raw.githubusercontent.com`, S24.
The GitHub contents API was rate limited for this host, so the directory listing itself was not read.
So there is no `market.taker` to report, and no CCXT source line exists.

## 9. Recommended registry values

None today.
The venue cannot join: the engine's catalog is a CCXT exchange instance, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 21 and 68, and Tapbit has none, and its market data API refuses this host.
If an approved account ever puts a host on the whitelist and a hand-written catalog replaces CCXT, `takerPpm` would be 600, from S3, and `ccxtTakerPpm` would not apply.

## 10. Source ledger

The ids are shared by the three Tapbit profiles, so an id missing here is cited in [`websocket.md`](./websocket.md) or [`rest.md`](./rest.md).

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tapbit Open API Docs, index | https://www.tapbit.com/openapi-docs/ | 2026-09-22 | Tapbit, global | "You must apply for a whitelist to access all APIs!", sections 1 and 8 |
| S2 | Tapbit USDT Perpetual API: base endpoint, funding rate, change log, and the spot and spot v2 change logs | https://www.tapbit.com/openapi-docs/usdt_perpetual/ | 2026-09-22 | Tapbit, global | the firewall whitelist of 2024-12-13, the funding rate call, no history call, sections 1, 3 and 6 |
| S3 | Fees (Spot & Derivatives), article 12198533844879, updated 2025-12-29 | https://tapbitcex.zendesk.com/hc/en-us/articles/12198533844879 | 2026-09-22 | Tapbit, global | derivatives 0.02 % and 0.06 %, spot 0 % and 0.1 %, sections 2, 4 and 5 |
| S4 | Updates on Trading Fees for Derivatives, article 12196942544911, dated 2022-08-15 | https://tapbitcex.zendesk.com/hc/en-us/articles/12196942544911 | 2026-09-22 | Tapbit, global | taker 0.06 % to 0.04 % on 2022-08-16, section 2 |
| S5 | Updates on Trading Fees for Derivatives, article 12196949010319, dated 2022-12-14 | https://tapbitcex.zendesk.com/hc/en-us/articles/12196949010319 | 2026-09-22 | Tapbit, global | taker back to 0.06 %, section 2 |
| S6 | Location Restrictions, article 12197830391439, updated 2026-06-25 | https://tapbitcex.zendesk.com/hc/en-us/articles/12197830391439 | 2026-09-22 | Tapbit, global | the 38 restricted jurisdictions, section 1 |
| S7 | Jurisdiction, regulations, licensing and practices, article 12197851945359, updated 2025-03-20 | https://tapbitcex.zendesk.com/hc/en-us/articles/12197851945359 | 2026-09-22 | Tapbit, United States | FinCEN MSB claim, section 1 |
| S8 | Terms of Use, article 12197851946895, updated 2026-01-20 | https://tapbitcex.zendesk.com/hc/en-us/articles/12197851946895 | 2026-09-22 | Tapbit, global | "Tapbit Exchange", Restricted Territories, section 1 |
| S9 | Spot API Access Fully Open to KYC Users, Futures API Requires Application, article 14100706940687, updated 2025-10-24 | https://tapbitcex.zendesk.com/hc/en-us/articles/14100706940687 | 2026-09-22 | Tapbit, global | futures API application and conditions, section 1 |
| S10 | API Access Evaluation Policy, article 12659986855567, updated 2025-05-29 | https://tapbitcex.zendesk.com/hc/en-us/articles/12659986855567 | 2026-09-22 | Tapbit, global | 14-day evaluation, section 1 |
| S11 | Funding Fee, article 12198856091919, updated 2025-03-20 | https://tapbitcex.zendesk.com/hc/en-us/articles/12198856091919 | 2026-09-22 | Tapbit, global | formula, caps, 8 h schedule, section 6 |
| S15 | Terms of Use for USDT Perpetual Contract Trading, article 12198856090895, updated 2026-08-07 | https://tapbitcex.zendesk.com/hc/en-us/articles/12198856090895 | 2026-09-22 | Tapbit, global | 1 h and 4 h intervals, no expiry, sections 6 and 7 |
| S16 | Liquidation, article 12198871059087, updated 2025-03-20 | https://tapbitcex.zendesk.com/hc/en-us/articles/12198871059087 | 2026-09-22 | Tapbit, global | liquidation path, section 7 |
| S17 | VIP Level Review and Protection Mechanism Upgrade, article 15678963234191, updated 2026-04-02 | https://tapbitcex.zendesk.com/hc/en-us/articles/15678963234191 | 2026-09-22 | Tapbit, global | VIP 0 to VIP 5 exist, section 4 |
| S18 | Pre-IPO Perpetual Futures, article 16830886547855, updated 2026-07-24 | https://tapbitcex.zendesk.com/hc/en-us/articles/16830886547855 | 2026-09-22 | Tapbit, global | rebase, sections 3 and 7 |
| S19 | Tapbit Lists TradFi Perpetual Contracts (SPY, QQQ, EWY, OPENAI, BZ, GOLD), article 16510876069647, 2026-06-17 | https://tapbitcex.zendesk.com/hc/en-us/articles/16510876069647 | 2026-09-22 | Tapbit, global | TradFi multipliers, section 3 |
| S20 | HYPEUSDT Perpetual Funding Rate Interval Adjustment, article 17493256901903, 2026-09-04 | https://tapbitcex.zendesk.com/hc/en-us/articles/17493256901903 | 2026-09-22 | Tapbit, global | a 4 h interval, section 6 |
| S21 | Notice on the end of zero trading fees for SOL, DOGE and XRP, article 14698912053647, 2025-12-23 | https://tapbitcex.zendesk.com/hc/en-us/articles/14698912053647 | 2026-09-22 | Tapbit, global | spot promotions, section 5 |
| S22 | Wayback Machine capture of the Tapbit fees page, 2026-02-17 | https://web.archive.org/web/20260217082650/https://www.tapbit.com/en/fees | 2026-09-22 | Tapbit, global | "Maker--" and "Taker--" when logged out, "Tapbit LLC" footer, sections 1 and 2 |
| S23 | CoinGecko derivatives exchange `tapbit-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/tapbit-futures?include_tickers=unexpired | 2026-09-22 | CoinGecko | 116 USDT perpetuals, country, sections 1 and 3 |
| S24 | CCXT master `exchanges.json` and `package.json` | https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json | 2026-09-22 | CCXT | no Tapbit id in 4.5.82, section 8 |
| P4 | `rest-probe.mjs spotv2` at 03:28 and 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tapbit/rest-probe.mjs) | 2026-09-22 | this host | spot catalog and fee fields, sections 3 and 5 |
| P5 | `rest-probe.mjs coingecko` at 03:30 and 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tapbit/rest-probe.mjs) | 2026-09-22 | this host | perpetual count and mix, sections 1 and 3 |
| P6 | `rest-probe.mjs ccxt`, run twice | [`rest-probe.mjs`](../../../scripts/probes/venues/tapbit/rest-probe.mjs) | 2026-09-22 | this host | no class in 4.5.68, section 8 |
