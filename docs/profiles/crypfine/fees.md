# CrypFine Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 06:34 to 06:46 UTC, from the development host near Seattle through its Canadian VPN exit, and every documented API path refused this host, see [`rest.md`](./rest.md) section 1.

This profile covers the USDT-margined perpetuals of CrypFine, which CCXT 4.5.68 does not implement.
Every fee number below comes from the CrypFine help center, and no fee could be read from an API reply, because the API refused this host.
Where CoinMarketCap reports a different number, both are written.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Crypfine LLC, incorporated in Colorado, United States, Entity ID 20248322898, 6312 S Fiddlers Green Circle, Suite 300E, Greenwood Village, CO 80111 | S3, updated 2026-09-17 |
| disputes | arbitration in Singapore under the SIAC rules | S3, clause 26.2 |
| launch | 2024-12-15, with the USDT perpetual system running by 2025-06-19 according to CoinMarketCap's profile | S9 |
| who may trade | individuals over 18 and institutions that register and pass KYC | S3, clauses 5.1 and 7.1 |
| excluded regions | the United States, the Chinese Mainland, Hong Kong, Singapore, Canada, France, the United Kingdom, North Korea, Cuba, Iran, Uzbekistan, the Russian-controlled regions of Ukraine, Sevastopol, Sudan, Syria, and persons on U.S. Treasury sanctions lists | S3, clauses 11.3 and 12.3 |
| US persons | may not trade, the United States is an Excluded Jurisdiction even though the operator is a Colorado company | S3, clause 11.3 |
| countries CoinMarketCap lists | `KR` and `JP` | S9 |
| API trading | spot API open to KYC users, futures API only by emailed application with a UID, see section 5 | S6 |

The host that ran the probes sits near Seattle and reaches the internet through a Surfshark WireGuard tunnel whose exit Cloudflare places in Canada (`loc=CA`).
Both the United States and Canada are Excluded Jurisdictions, so neither the machine nor its exit could open an account.

## 2. Quick answer

| family | maker | taker | maker ppm | taker ppm | source |
|---|---:|---:|---:|---:|---|
| USDT-margined perpetuals ("Derivatives") | 0.02 % | 0.06 % | 200 | 600 | S1 |
| spot, for the coverage matrix only | 0.1 % | 0.1 % | 1,000 | 1,000 | S1 |

The help center states one rate per product and publishes no tier table.
CoinMarketCap's exchange record carries `takerFee` 0.06 and `makerFee` 0.22, S9.
The 0.22 maker disagrees with both the help center's 0.02 % and the 0.02 % that CoinMarketCap's own description text states, so it reads as a data entry error on CoinMarketCap's side.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined linear perpetuals | yes | API document S4 names only this family, contract codes spelled `BTC-SWAP`. CoinMarketCap listed 31 perpetual pairs on 2026-09-23 at 06:12 UTC, S9 |
| USDC-margined perpetuals | absent | no USDC family in S4, S5 or the help center |
| coin-margined (inverse) perpetuals | absent | no inverse family in S4 or the help center |
| dated futures | absent | the USDT futures terms say "USDT Futures have no expiration date", S7 clause 2.3, and CoinMarketCap reports `futuresVolume24h` 0, S9 |
| options | absent | not named anywhere in the documents or help center |
| spot | yes | Spot V2 API, S5, with delisting notices in 2026 for spot pairs only, S10 |

The active perpetual count could not be read from the venue, because `GET /api/usdt/instruments/list` returned HTTP 403 to this host, see [`rest.md`](./rest.md) section 2.
The survey brief quotes CoinMarketCap's derivatives ranking on 2026-09-23 with 28 derivatives pairs and about 188M USD of open interest.
The CoinMarketCap exchange page read at 06:12 UTC the same day listed 31 perpetual pairs and 197,043,730 USD of open interest, S9.

## 4. Perpetual tiers

No tier table is published.
The Fees article, S1, gives a single maker and taker for "Derivatives" and says "Discounts may apply for users participating in special promotions or loyalty programs".
CoinMarketCap's description says "actual trading fees varying depending on the user's membership level", S9, but the help center returned no article for the searches `VIP` (0 results) and `tier` (1 result, the liquidation article), S2.
So the qualification rules of any higher level are Not publicly specified, and the engine's VIP 0 taker is 600 ppm.

## 5. Discounts that change the perpetual taker

| discount | status | source |
|---|---|---|
| token holding | none, CrypFine has no exchange token named in any document | S1, S4 |
| referral | an affiliate program exists, and the perpetual API exposes two affiliate calls, but no taker discount for the invitee is published | S4 |
| market maker | the futures API itself is gated on market making: each 14 day cycle needs at least 5,000,000 USDT of futures volume with maker volume at least 50 % of it, or access may be revoked | S6 |
| zero fee promotions | none found on 2026-09-22 | S2 |

The same article says that "For Korean affiliates, CrypFine may enable Futures API access through a whitelist mechanism based on business review", S6.

Two further rules would bind any automated taker.
The notice of 2026-07-30 classifies 300 or more trades per UID per day, or 20 or more orders in one hour with less than 2 minutes between consecutive orders, as "high-frequency order brushing", S8.
The listed penalties are restricted trading and withdrawal, and deduction of commissions, rebates or profits, S8.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | peer to peer, CrypFine keeps nothing. A positive rate means longs pay shorts, and a negative rate means shorts pay longs | S11 |
| interval | 8 h, at 00:00, 08:00 and 16:00 UTC, the same for every contract as far as the documents say | S11, S7 clause 2.3 |
| charged to | holders of an open position at the timestamp, on the net position when both directions are held | S11 |
| amount | Position Value times Funding Rate, on notional value | S11 |
| rate formula | F = P + clamp(I minus P, 0.05 %, minus 0.05 %) | S11 |
| premium index | P = (Max(0, Impact Bid minus Mark) minus Max(0, Mark minus Impact Ask)) / Spot Price + Basis Adjustment | S11 |
| interest rate | I = (Quote Interest Index minus Base Interest Index) / Funding Interval, value Not publicly specified | S11 |
| absolute cap | "Funding Rate cannot exceed 75% of the lower value between Initial Margin and Maintenance Margin", with the worked example 75 % times (1 % minus 0.5 %) = 0.375 % | S11 |
| change cap | the rate may not move by more than 75 % of the maintenance margin between intervals | S11 |

The cap text and its worked example disagree: the sentence says 75 % of the lower margin, and the example uses the difference of the two margins.
The Mark Price article uses the funding rate inside the mark, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured, because no API call answered this host.
CoinMarketCap's pair table showed a rate of exactly 0.0001 on 22 of 31 pairs at 06:12 UTC, S9, which is the common 0.01 % default of an interest-only rate.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation | the liquidation engine takes the position at the bankruptcy price, a close better than bankruptcy goes to the insurance fund, a worse close is covered by it, and ADL follows when the fund is short. No separate liquidation fee rate is published | S12 |
| settlement | none, the contracts have no expiry | S7 |
| delisting | only spot delistings were announced in 2026, for example ADA, APT, 0G and WLD spot pairs on 2026-05-29 | S10 |
| maintenance | the USDT perpetual system was down 2026-09-18 23:00 to 2026-09-19 00:00 UTC with liquidation paused, and a platform upgrade including "OpenAPI services" ran on 2026-05-15 from 23:00 UTC | S13, S14 |

Deposits are free and withdrawal fees vary by token, see the withdrawal page named in S1.

## 8. CCXT

CCXT 4.5.68 has no CrypFine class.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and the only ids matching `cryp` or `fine` are `bitfinex`, `cryptocom`, `cryptomus`, `digifinex` and `tokocrypto`, P1.
The current CCXT master on GitHub has no `crypfine.ts` among the 112 entries of `ts/src` returned by `https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master` on 2026-09-22, S15.
So `market.taker` does not exist for any CrypFine market, and no CCXT source line can be cited.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600, if the venue is ever added | the single published derivatives taker, S1 |
| `ccxtTakerPpm` | unset | no CCXT class exists, so the catalog would need a hand-written loader instead of the CCXT connector |

The recommendation is not to add the venue, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees | https://crypfine.zendesk.com/hc/en-001/articles/11619945335823-Fees | 2026-09-22, article updated 2026-05-08 | Crypfine, global | maker and taker, discounts note, sections 2, 4 and 5 |
| S2 | Help center article search, queries `fee`, `VIP`, `tier`, `level`, `discount`, `rebate` | https://crypfine.zendesk.com/api/v2/help_center/articles/search.json | 2026-09-22 | Crypfine | absence of a tier table or promotion, sections 4 and 5 |
| S3 | Terms of Use | https://crypfine.zendesk.com/hc/en-001/articles/11619674540815-Terms-of-Use | 2026-09-22, updated 2026-09-17 | Crypfine LLC | entity, excluded jurisdictions, arbitration, section 1 |
| S4 | CrypFine USDT Perpetual API | https://www.crypfine.com/openapi-docs/usdt_perpetual/ | 2026-09-22 | Crypfine | families, affiliate calls, whitelist notice, sections 3 and 5 |
| S5 | CrypFine Spot V2 API | https://www.crypfine.com/openapi-docs/spot/ | 2026-09-22 | Crypfine | spot presence, section 3 |
| S6 | Spot API Access Fully Open to KYC Users, Futures API Requires Application | https://crypfine.zendesk.com/hc/en-001/articles/16158246859407 | 2026-09-22, updated 2026-05-18 | Crypfine, Korean affiliates named | futures API application and evaluation rules, sections 1 and 5 |
| S7 | Terms of Use for USDT Futures Trading | https://crypfine.zendesk.com/hc/en-001/articles/12463595456143 | 2026-09-22, updated 2025-04-21 | Crypfine | no expiry, 8 h funding at 00, 08, 16 UTC, sections 3, 6 and 7 |
| S8 | Notice on the Definition and Handling of Abnormal Trading Activities | https://crypfine.zendesk.com/hc/en-001/articles/17029159091471 | 2026-09-22, published 2026-07-30 | Crypfine | order brushing thresholds and penalties, section 5 |
| S9 | CoinMarketCap exchange page `crypfine`, perpetual tab, `__NEXT_DATA__` | https://coinmarketcap.com/exchanges/crypfine/?type=perpetual | 2026-09-23 06:12 UTC | CoinMarketCap, third party | pair count, open interest, fee fields, countries, launch, sections 1 to 3 and 6 |
| S10 | Crypfine to Delist ADA, APT, 0G, DOT and WLD on 2026-05-29 | https://crypfine.zendesk.com/hc/en-001/articles/16363152559759 | 2026-09-22 | Crypfine | spot delisting, sections 3 and 7 |
| S11 | Funding Fee | https://crypfine.zendesk.com/hc/en-001/articles/12468587361679-Funding-Fee | 2026-09-22, updated 2025-04-21 | Crypfine | funding formula, interval, caps, section 6 |
| S12 | Liquidation on Crypfine Futures | https://crypfine.zendesk.com/hc/en-001/articles/12468603644559 | 2026-09-22, updated 2025-04-21 | Crypfine | liquidation and insurance fund, section 7 |
| S13 | USDT Perpetual System Maintenance Notice | https://crypfine.zendesk.com/hc/en-001/articles/17620042057231 | 2026-09-22, published 2026-09-15 | Crypfine | maintenance window, section 7 |
| S14 | Announcement on CrypFine System Upgrade and Maintenance (2026-05-15) | https://crypfine.zendesk.com/hc/en-001/articles/16103015337999 | 2026-09-22, published 2026-05-13 | Crypfine | OpenAPI maintenance, section 7 |
| S15 | CCXT master `ts/src` listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-22 | CCXT | no class on master, section 8 |
| P1 | `rest-probe.mjs`, runs at 06:37, 06:40 and 06:44 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/crypfine/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | CCXT 4.5.68 ids, section 8 |
