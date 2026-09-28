# TruBit Pro Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 local time, 2026-09-24 06:42 to 06:59 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocated to Canada (Cloudflare trace `loc=CA`, colo `YVR`).

This profile covers the fees of the TruBit Pro USDT-margined perpetuals, the only perpetual family the venue lists.
No CCXT class exists for TruBit, so section 8 records that absence instead of a CCXT constant.
Every access result below is from that Canadian VPN exit.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Lunexa Limited, a company duly incorporated in Saint Vincent and the Grenadines", registered at Euro House, Richmond Hill Road, Kingstown | S7, line 7 of the extracted text |
| excluded regions | "North Korea (call for action), Iran (call for action), Iraq, Syria, United States of America, Yemen, Zimbabwe, or any other state, country, territory, or other jurisdiction where TruBit Services may be considered illegal" | S7, section "Locality, Citizenship, and Residency" |
| US persons | may not trade, by the clause above, and the agreement defines "U.S. Citizen or U.S. Resident" including the substantial presence test | S7 |
| Argentina | TruBit and TruBit Pro "will discontinue their operations and services for users residing in Argentina" | S8, updated 2026-09-06 |
| main markets | Mexico, Argentina and Brazil fiat rails (SPEI, ARS and Pix bank transfer) | S4b, updated 2026-06-01 |

The help center at `help.trubit.com` answered this host with a JavaScript challenge page and HTTP 403, and it now redirects to `help.trubit.live`, which answered WebFetch with 403.
The same articles were read from the public Zendesk API of `help.trubit.live`, `GET /api/v2/help_center/en-001/articles/<id>.json`, which answered 200 with the article body.
The public market API answered 200 to every call, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S4, the worked example under "Contract Trading Fee" |

The documentation disagrees with itself on the taker.
S4, the fee chart article, gives "Trader A will be charged a Taker Fee: 100 × 0.06% = 0.06 USDT" and "Trader B will be charged a Maker Fee: 100 × 0.02% = 0.02 USDT".
S5, the perpetual overview, says "(Taker Fee: 0.04%, Maker Fee: 0.02%)" in its post-only paragraph.
The fee tier table itself is an image in S4, and its signed URL answered HTTP 410 on 2026-09-24, so the published tier table could not be read.
This profile takes 600 ppm as the working number because S4 is the dedicated fee article and was updated later, 2025-10-12 against 2025-10-10, and 400 ppm stays an open question.
The stock perpetual launch article says the equity perpetuals use the "Same fee schedule as regular USDT‑M perpetual contracts", S9.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 40 on 2026-09-24 | `GET /basic/refData` returned 40 rows, all `"type":"PERP"`, all ending in `USDT`, [`rest-probe.mjs`](../../../scripts/probes/venues/trubit-pro/rest-probe.mjs) `basic` |
| USDC-M perpetuals | absent | no `USDC` symbol in the catalog |
| coin-margined perpetuals | absent from the catalog | S5 describes BTC and ETH margin in prose, but every catalog row is a `USDT` symbol and the API documents only USDT contracts |
| dated futures | absent | only `PERP` in `refData` |
| options | documented, not listed | S1 lists an "Options Open API" page, and the spot `brokerInfo` reply carried an empty `options` array |
| spot | present, 48 symbols, all `TRADING` | `GET https://api-spot.trubit.com/openapi/v1/brokerInfo`, `rest-probe.mjs basic` |

The 40 perpetuals include two US equity contracts `TSLAUSDT` and `NVDAUSDT` launched 2026-02-27, S9, silver `XAGUSDT`, gold token `PAXGUSDT`, `1000PEPEUSDT`, and `TBTCTUSDT`, a second bitcoin contract with the same index as `BTCUSDT`, see [`rest.md`](./rest.md) section 2.
CoinMarketCap's count of 38 derivative pairs is close to the 40 the API returned.

## 4. Perpetual tiers

The tier table is published only as an image in S4, and the image URL answered 410 Gone on 2026-09-24.
S4 adds "Users in the Affiliate System will not apply to contract tier rates." and "If your monthly trading volume is large or you are high level of VIP for other platforms, please contact us".
Tiers above VIP 0 and their qualification rule are therefore Not verified.

## 5. Discounts that change the perpetual taker

| discount | what the source says | source |
|---|---|---|
| VIP by request | bespoke rates for high volume traders on request | S4 |
| affiliate | affiliate users are not on the contract tier rates | S4 |
| bonuses and coupons | contract bonuses and coupons exist and are margin credits, not fee rates | S5b, S5c titles, not read further |
| token holding | none found | |
| zero fee promotion | none found in the search of the help center for "fee" on 2026-09-24 | S12 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate = MA [ (Contract Price - Index Price)/Index Price]/Adjustment Coefficient", MA 60 minutes, coefficient 1 on every contract | S3 |
| update | "will be updated every 1 hour" | S3 |
| interval | "generated every 8 hours" and "the funding payment interval in TruBit Pro is 8 hours, i.e., funding charging is three times a day" | S3, S5 |
| interval, equity perps | "Settled every 4 hours (same mechanism as standard crypto perpetuals)" | S9 |
| settlement instants | Not publicly specified | |
| cap and floor | [-0.375 %, 0.375 %] for contracts with 125x maximum leverage, [-0.75 %, 0.75 %] for 50x | S3 |
| who pays | positive rate, longs pay shorts, negative rate, shorts pay longs, "TruBit Pro does not charge any funding fees" | S3 |
| charge | position value times rate, on notional, not margin | S3 |

The interval is contradictory in the sources, 8 h in S3 and S5 and 4 h in S9, and the API publishes neither the interval nor the next settlement, see [`rest.md`](./rest.md) section 3.
On 2026-09-24 at 06:42 UTC 35 of 40 contracts published a rate of exactly plus or minus 0.00001, which suggests a minimum magnitude of 0.001 % per interval, an inference not stated by any source.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

- Forced liquidation closes the position in isolated mode, and cancels orders and closes every position in cross mode, and the trader "will lose your maintenance margin", S10.
  No separate liquidation fee rate is published.
- Delisting follows announced dates, as in the "6:00 AM (UTC) on September 26, 2025, Trading Pair Delist Announcement", S12 search result, and no delisting charge is published.
- Deposit and withdrawal fees are in the "TruBit Fee Structure" article, S4b.

## 8. CCXT

CCXT 4.5.68 has no TruBit class.
`node -e "console.log(require('ccxt').exchanges)"` from `server/` listed 104 ids, and the only id matching `tru` was `bitrue`, `rest-probe.mjs basic`.
The CCXT master source tree `ts/src` on GitHub, listed through the GitHub contents API on 2026-09-24, has no file matching `trubit`, S11.
So no `market.taker` exists to report, and `ccxtTakerPpm` has no source line.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 taker from S4, with 400 from S5 as the documented alternative |
| `ccxtTakerPpm` | none | no CCXT class, so the catalog loader has to be written by hand and must set the taker itself |

## 10. Source ledger

| id | source | read |
|---|---|---|
| S1 | https://docs-api.trubit.com/trubit-pro/llms.txt and https://docs-api.trubit.com/trubit-pro/contract/contract-api.md | curl, 2026-09-24 |
| S3 | "Funding Fee", article 42050319003796, updated 2025-10-11, https://help.trubit.live/hc/en-001/articles/42050319003796 | Zendesk API, 2026-09-24 |
| S4 | "TruBit Pro Fee Chart", article 41954823425300, updated 2025-10-12 | Zendesk API, 2026-09-24 |
| S4b | "TruBit Fee Structure", article 42045246749076, updated 2026-06-01 | Zendesk API, 2026-09-24 |
| S5 | "TruBit Pro Perpetual Contract Overview", article 42049460153236, updated 2025-10-10 | Zendesk API, 2026-09-24 |
| S5b, S5c | "How to use Contract Bonuses?" 42008579410708 and "Increase TruBit Pro benefits by understanding various coupons and bonuses" 42011072797076 | titles only |
| S6 | "What are Index Price, Mark Price, and Last Price?", article 42051377552532, updated 2025-10-11 | Zendesk API, 2026-09-24 |
| S7 | "TruBit User Agreement", article 41958337263252, updated 2026-03-22 | Zendesk API, 2026-09-24 |
| S8 | "Discontinuation of Services in Argentina", article 49156239642516, updated 2026-09-06 | Zendesk API, 2026-09-24 |
| S9 | "TruBit Pro officially launches US stock perpetual contracts", article 46690837110420, created 2026-02-26 | Zendesk API, 2026-09-24 |
| S10 | "Forced Liquidation", article 42050414490516, updated 2025-10-10 | Zendesk API, 2026-09-24 |
| S11 | https://api.github.com/repos/ccxt/ccxt/contents/ts/src | curl, 2026-09-24 |
| S12 | https://help.trubit.live/api/v2/help_center/articles/search.json with `query=fee`, `funding` and `restricted` | curl, 2026-09-24 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/trubit-pro/rest-probe.mjs) | run 2026-09-24 |
