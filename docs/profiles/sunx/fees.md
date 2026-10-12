# SunX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers the venue CoinMarketCap ranks 209 under the name SunX: exchange id 32686, slug `sunx`, website `https://sunx.vip/`, S9.
CoinMarketCap lists a second, unrelated venue under the same name: id 32630, slug `sunperp`, website `https://www.sunx.io/`, a perpetual DEX on TRON with an HTX style API.
That namesake is not the surveyed venue, and it is described only in section "Namesake" of each file.
SunX at sunx.vip publishes no API documentation and has no CCXT class.
Its site is a tenant of the same white-label bundle as AIA Exchange, see [`../aia/rest.md`](../aia/rest.md), and the fee numbers below come from its Zendesk help center and its public catalog.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/sunx/fees-probe.py), P1, and [`rest-probe.py`](../../../scripts/probes/venues/sunx/rest-probe.py), P2.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | Not publicly specified. The Service Agreement is "between you ... and SunX" and names no company or registration number. | Not publicly specified | S7 |
| disputes | Singapore International Arbitration Centre rules, heard in English in Singapore | Published | S7 |
| who may trade | "You represent and warrant that you are not a U.S. or Canadian resident", and no person on a sanctions list such as OFAC's | Region-specific | S7 |
| perpetual trading rules | forced liquidation when losses reach 90 %, positions closed once profit reaches 1000 %, and scalping may lead to bans, freezes or login restrictions | Published | S8 |
| website from this host | `sunx.vip` and its REST calls answered HTTP 200, while its own socket path answered HTTP 403, see [`websocket.md`](./websocket.md) section 1 | Probed | P2 section 3 |
| help center from this host | the browser URL and the Zendesk JSON API at `support.sunx.vip`, an alias of `sunbitex.zendesk.com`, both answered HTTP 200 | Probed | P1 section 1 |

The development host's exit is in Canada, and S7 excludes Canadian residents.
Reading public market data is not an account service, and the site served it without a challenge.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals, help center | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S1, S2, S3 |
| USDT-M perpetuals, catalog fields | `makerFee` 0.0004, 400 ppm | `takerFee` 0.0004, 400 ppm | P2 section 4 |

The help center and CoinMarketCap agree on 0.02 % and 0.06 %, S1 and S9.
The live catalog still carries 0.0004 on both sides of all 253 online rows, which matches the rates before the 2025-10-01 change in S3.
The catalog also carries `commissionRate` 0.0015 on 129 rows and 0.0008 on 124 rows, P2 section 4.
The bundle reads `commissionRate` and does not read `takerFee` or `makerFee`, P2 section 3, so which field the matching engine charges is Not verified without an account.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 253 online and 96 offline rows | P2 section 4 |
| coin-margined perpetuals | no row, every row has quote `usdt` and margin `usdt` | P2 section 4 |
| USDC-M perpetuals | no row | P2 section 4 |
| stock and metal perpetuals | yes, inside the USDT-M catalog: `xauusdt`, `xagusdt`, `tslausdt`, `nvdausdt` online | P2 section 4 |
| Quick Contracts | yes, a separate CFD product with a 0.075 % closing fee, a 0.03 % spread and a daily overnight fee | S4, S5 |
| dated futures | Not verified, none described | no help center article found |
| options | yes, an "Options Trading Fees" article exists and the bundle calls `/v1/cfd/public/option/instruments` | P1 section 2, P2 section 3 |
| spot | yes, 28 USDT pairs, maker and taker 0.1 % | S6, P2 section 7 |

## 4. Perpetual tiers

No tier table or VIP program is published.
S1, updated 2026-05-28, gives one rate pair: "Maker: 0.02%", "Taker: 0.06%", with "Fee = Trade Amount × Fee Rate".
S3 moved maker from 0.0004 to 0.0002 and taker from 0.0004 to 0.0006 from 2025-10-01.
S2, dated 2025-11-14, then says "The Taker trading fee will be reduced from 0.08% to 0.06%".
The 0.08 % step between S3 and S2 is not explained in any article found.

## 5. Discounts that change the perpetual taker

- No token discount, market maker program or zero fee promotion for perpetuals was found in searches for `fee`, `funding`, `overnight`, `terms`, `restricted` and `API`, P1 section 2.
- Spot was fee free until 2025-12-31, S3, and is 0.1 % on both sides since S6.
- Bonus and trial fund campaigns exist, P1 section 2, and S7 forbids using "multiple accounts or devices for illegal arbitrage (including fees manipulation, rebates, gifts, hedging, etc.)".

## 6. Funding as a cost

- Interval: "Every 8 hours (00:00, 08:00, and 16:00 UTC+8)", S1, which is 16:00, 00:00 and 08:00 UTC.
  The catalog gives `fundingIntervalHours` 8 on 149 rows and 4 on 104 rows, P2 section 4, so the interval is per symbol.
- Who pays: positive rate, longs pay shorts, and negative rate, shorts pay longs, on the net position, S1.
- The exchange takes no share, "SunX does not charge any funding fees", and the fees pass directly between users, S1.
- Formula, cap and floor: not published.
- The socket's funding channel sent `fr` 0.00001832 for BTC, see [`websocket.md`](./websocket.md) section 2.
- The catalog's `settlementRate` is 0.0015 on 198 rows, 0.004 on 45 and 0.0002 on 10, and it did not change over 15 polls, P2 sections 4 and 6.
  Its `settledAt` points to 20:00 UTC, which is 04:00 UTC+8, the hour at which S4 and S5 charge the Quick Contract overnight fee.
  So `settlementRate` looks like the overnight fee rate, not the perpetual funding rate, which is an inference.
- The settlement instant itself was not captured, because the survey does not wait for clock events.

## 7. Liquidation, settlement and delisting

- Forced liquidation when losses reach 90 %, and automatic close when profit reaches 1000 %, S8.
- The catalog carries `openSpread` and `closeSpread` of 0.001 on 124 rows and 0.0003 on 124 rows, P2 section 4.
  S4 describes the same kind of spread for Quick Contracts, "Buy price = Current Price × (1 + 0.03%)".
  Whether the spread applies to perpetual orders is Not verified.
- No liquidation fee, settlement fee or delisting charge is published.

## 8. CCXT

CCXT 4.5.68 has no SunX class.
The installed `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 class files and none matches `sun` or `swk`, P2 section 10.
The current master, listed through `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` on 2026-10-09, has 110 entries and none matches `sun`, P2 section 10.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
The venue does not fit the engine in its current shape, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.
If it ever did, `takerPpm` would be 600 from S1, and `ccxtTakerPpm` would stay unset.

## Namesake

The SunX DEX at `www.sunx.io`, CoinMarketCap id 32630, publishes maker 0.02 % and taker 0.04 % for USDT-M perpetuals on its documentation page "Trading Fees", N1.
CoinMarketCap shows 0 and 0 for it, S9.
It is not the surveyed venue.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | "SunX Perpetual Contract, Parameters and Fee Description", `https://support.sunx.vip/hc/en-001/articles/7655697171983`, read through `https://support.sunx.vip/api/v2/help_center/en-001/articles/7655697171983.json`, updated 2026-05-28 | 2026-10-09 |
| S2 | "Taker Fee Rate Adjustment Announcement", article 14333323439759 on the same help center, updated 2025-11-14 | 2026-10-09 |
| S3 | "Notice on Major Compliance Transformation Adjustments of SunX", article 13896801724559, dated 2025-09-29, updated 2025-12-25 | 2026-10-09 |
| S4 | "SunX Quick Contract, Parameter Details and Fee Description", article 7663768899087, updated 2025-10-22 | 2026-10-09 |
| S5 | "SUNX Overnight Fee Dynamic Adjustment Mechanism (Supplementary Notice)", article 13998911880975, updated 2025-10-22 | 2026-10-09 |
| S6 | "Spot Trading Fee Adjustment Announcement", article 14780005479567, updated 2026-01-04 | 2026-10-09 |
| S7 | "Service Agreement", article 14076014471311, updated 2025-10-18 | 2026-10-09 |
| S8 | "Contract Service Agreement", article 14075765676687, updated 2025-10-18 | 2026-10-09 |
| S9 | CoinMarketCap data API, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=sunx` and `?slug=sunperp`, and the listing `exchange/listing?exType=0` | 2026-10-09 |
| N1 | SunX DEX documentation, `https://sunx.gitbook.io/sunx/trade/trading-fees.md` | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/sunx/fees-probe.py), run twice | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/sunx/rest-probe.py), run twice | 2026-10-09 |
