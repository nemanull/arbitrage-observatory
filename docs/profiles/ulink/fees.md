# Ulink Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers the venue CoinMarketCap lists as Ulink: exchange id 33326, slug `ulink`, website `https://ulinkex.com/`, S11.
Ulink publishes no API documentation and has no CCXT class, see section 8.
Its site is a tenant of the same white-label bundle as SunX and AIA Exchange, see [`../sunx/fees.md`](../sunx/fees.md) and [`../aia/rest.md`](../aia/rest.md).
The fee numbers below come from its Zendesk help center at `ulinkinc.zendesk.com` and its public catalog.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/ulink/fees-probe.py), P1, and [`rest-probe.py`](../../../scripts/probes/venues/ulink/rest-probe.py), P2.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | "Ulink LTD, a Ulink company" in an announcement about a US MSB registration, with no registration number or address | Not publicly specified | S9 |
| registrations claimed | a US MSB and a Canadian FINTRAC MSB registration, and an SEC filing, none with a number | Published, not verified | S9, S10 |
| who may trade perpetuals | "You represent and warrant that you are neither from the United States or Canada, nor on any trade or economic sanctions list", section 8.2 Contract transaction | Region-specific | S7 |
| automated access | the Service Agreement forbids using "deep links", "page scraping", "bots", "spiders" or other automatic programs to access or monitor the service | Published | S7 |
| trading rules | multiple accounts for arbitrage of fees, rebates or bonuses are forbidden, and ultra-short-term trades may be voided or given a minimum holding time | Published | S8 |
| website from this host | `ulinkex.com` and its REST calls answered HTTP 200, while its own socket path answered HTTP 403, see [`websocket.md`](./websocket.md) section 1 | Probed | P2 section 3 |
| help center from this host | the browser page and the Zendesk JSON API both answered HTTP 200 through Cloudflare | Probed | P1 section 1 |

The development host's exit is in Canada, and S7 excludes Canadian residents from contract trading.
Reading public market data is not an account service, and the site served it without a challenge.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals, help center | 0.04 %, 400 ppm | 0.04 %, 400 ppm | S1 |
| USDT-M perpetuals, catalog fields | `makerFee` 0.0004, 400 ppm | `takerFee` 0.0004, 400 ppm | P2 section 4 |
| USDT-M perpetuals, CoinMarketCap | 0.04 % | 0.04 % | S11 |

The three sources agree on 237 of the 238 online rows.
The one exception is `riverusdt`, with `takerFee` 0.0006 and `makerFee` 0.0002, P2 section 4.
The catalog also carries `commissionRate` 0.00075 on every online row, which is the 0.075 % closing fee of the Lightning Contract in S6.
The bundle reads `commissionRate` only in its Lightning position code and does not read `takerFee` or `makerFee`, P1 section 4.
So which field the matching engine charges on a perpetual order is Not verified without an account.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 238 online and 62 offline rows | P2 section 4 |
| coin-margined perpetuals | no row, every row has quote `usdt` and margin `usdt` | P2 section 4 |
| USDC-M perpetuals | no row | P2 section 4 |
| stock and metal perpetuals | yes, inside the USDT-M catalog: `xauusdt`, `xagusdt`, `tslausdt`, `aaplusdt` and `nvdausdt` online | P2 section 4 |
| Lightning Contract | yes, a CFD product with a 0.075 % closing fee and a daily overnight fee | S6 |
| Infinity Contract | yes, a simulated mode funded by rewards | S12 |
| dated futures | none described, and no catalog call for them in the bundle | P2 section 3 |
| options | yes, `/v1/cfd/public/option/instruments` returned 223,679 bytes of option rows, the first `BTC-260619-65000-C`, and S13 sets a 0.02 % transaction fee | P2 section 7, S13 |
| spot | yes, 18 USDT pairs, maker and taker 0.1 % | S5, P2 section 7 |

CoinMarketCap counts 219 perpetual pairs and 18 spot pairs, and it excludes the price and volume of each one, P2 section 1.

## 4. Perpetual tiers

No VIP tier table is published.
S1 gives one rate pair, "Taker: 0.04%" and "Maker: 0.04%", unchanged since its last update on 2023-08-07.

## 5. Discounts that change the perpetual taker

- Fee Subsidy Program, S2, a long-term monthly cashback that needs KYC and a monthly sign-up form.
  Its tiers are in an image, read by eye, P1 section 3: 1 % back at 1,000 USDT of monthly perpetual fees, then 2 % at 3,000, 3 % at 5,000, 5 % at 10,000, 6 % at 20,000, 8 % at 50,000 and 10 % at 100,000.
  The rebate is paid on the 1st of the next month, so it does not change the fee charged per trade.
- Personal Rebate Program, S3, credited in real time, with rates in an image read by eye: 30 % for all users, rising to 35 %, 40 %, 45 % and 50 % at 1,000, 5,000, 10,000 and 30,000 USDT of monthly fees or 3, 8, 12 and 20 active referrals.
  The article says it is for individual accounts and not for team promotion, but whether the rate applies to the holder's own fees or to referred users' fees is not stated.
- 20 % Direct Fee Rebate, S4, from 2025-09-19, for KYC users who apply through customer service, with no end date.
- No token discount or market maker program was found in the 60 articles of the help center, P1 section 1.

## 6. Funding as a cost

- Interval: "every 8 hours, respectively at UTC+8 00:00, UTC+8 8:00 and UTC+8 16:00", S1 and S14, which is 16:00, 00:00 and 08:00 UTC.
  The catalog gives `fundingIntervalHours` 8 on 150 rows and 4 on 88 rows, P2 section 4, so the interval is per symbol.
- Who pays: positive rate, longs pay shorts, and negative rate, shorts pay longs, on the net position, S14.
- The exchange takes no share, "Ulink Exchange does not charge any funding fees", S14.
- Formula: "Funding rate (F) = premium index (P) + clamp (interest rate (I)-premium index (P), 0.05%, -0.05%)", S14.
- Cap: "The absolute upper limit of the funding rate is 0.15%", S14.
- The socket's funding channel sent `fr` from -0.00002057 to -0.00002012 for BTC, see [`websocket.md`](./websocket.md) section 2.
- The catalog's `settlementRate` is 0.0002 on every online row and did not change over 15 polls, P2 sections 4 and 6.
  Its `settledAt` points to 20:00 UTC, which is 04:00 UTC+8, the hour at which S6 charges the Lightning Contract overnight fee of "Order Value x leverage x 0.02%".
  So `settlementRate` is the overnight fee rate, not the perpetual funding rate, which is an inference from the matching rate and hour.
- The settlement instant itself was not captured, because the survey does not wait for clock events.

## 7. Liquidation, settlement and delisting

- Forced liquidation when the risk rate, position funds over opening margin, falls below 10 %, S1.
- A risk protection fund covers negative balances, so the loss in cross margin is capped at the account, S1.
- The catalog carries `openSpread` and `closeSpread` of 0.0003 on 183 rows, 0.001 on 39 and 0.0005 on 16, P2 section 4.
  Whether a spread applies to perpetual orders or only to Lightning Contracts is Not verified.
- No liquidation fee, settlement fee or delisting charge is published.

## 8. CCXT

CCXT 4.5.68 has no Ulink class.
The installed `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 class files and none matches `ulink` or `rmex`, P2 section 9.
The current master has none either: its `ts/src` listing through the GitHub API has 110 entries, its `exchanges.json` lists 103 ids, and `ts/src/ulink.ts` answers HTTP 404, P2 section 9.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
The venue does not fit the engine in its current shape, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.
If it ever did, `takerPpm` would be 400 from S1, and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | "Ulink Perpetual Contract Guides", `https://ulinkinc.zendesk.com/hc/en-us/articles/7617336092815-Ulink-Perpetual-Contract-Guides`, read through `https://ulinkinc.zendesk.com/api/v2/help_center/en-us/articles/7617336092815.json`, updated 2023-08-07 | 2026-10-09 |
| S2 | "Trade & Get Cashback, Ulink Perpetual Futures Fee Subsidy Program", article 15184642171279 on the same help center, updated 2026-02-14, with its tier image attachment 15184642171023 | 2026-10-09 |
| S3 | "Ulink Futures Personal Rebate Program", article 16725080662543, updated 2026-07-05, with its image attachment 16725080662159 | 2026-10-09 |
| S4 | "20% DIRECT REBATE ON TRANSANCTION FEES", article 13808478095631, updated 2025-09-18 | 2026-10-09 |
| S5 | "Ulink Spot Trading Parameter Details", article 7853411658639, updated 2024-08-22, which says maker and taker "are both 0" and then "0.1% fees will be charged" | 2026-10-09 |
| S6 | "Ulink Lightning Contract Guides", article 7617363761167, updated 2023-08-07 | 2026-10-09 |
| S7 | "Service Agreement", article 7617423580559, updated 2023-08-07 | 2026-10-09 |
| S8 | "Contract Prohibitions", article 7617401184911, updated 2023-08-07 | 2026-10-09 |
| S9 | "Ulink obtains US MSB license", article 7617491271311, updated 2026-02-03 | 2026-10-09 |
| S10 | "Ulink Exchange Completes SEC Filing", article 15323587942927, updated 2026-03-01 | 2026-10-09 |
| S11 | CoinMarketCap data API, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=ulink`, its market pairs, and the listings `exchange/listing?exType=0` and `exType=1` | 2026-10-09 |
| S12 | "Ulink Infinity Contract Guides", article 7617385903375, updated 2023-08-07 | 2026-10-09 |
| S13 | "Options Trading Fees", article 7853520993167, updated 2023-09-08 | 2026-10-09 |
| S14 | "Funding rate (perpetual contract)", article 7617335375631, updated 2023-08-07, which repeats the funding part of S1 | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/ulink/fees-probe.py), run twice | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/ulink/rest-probe.py), run twice | 2026-10-09 |
