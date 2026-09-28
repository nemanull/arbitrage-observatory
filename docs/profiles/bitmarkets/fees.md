# BITmarkets Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:41 to 06:56 UTC by the host clock, from the development host near Seattle, whose traffic exits a Surfshark WireGuard tunnel geolocated to Canada.

This profile covers the fees of BITmarkets (CoinMarketCap rank 103), a venue with no CCXT class and no public API documentation.
The survey's nominal date is kept in the Retrieved line, while the host clock read 2026-09-24 during every probe.
Every live page of `bitmarkets.com` answered this host with a Cloudflare challenge, so the fee and legal pages were read from Wayback Machine captures, see section 10.
Access results below are from that Canadian VPN exit.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| spot entity | UAB BITmarkets, Lithuania, registration no. 306062346, a virtual currency exchange and depository wallet operator supervised by the Financial Crime Investigation Service | S3 |
| futures and margin entity | "Margin Trading and Futures Trading Services related to derivative products are exclusively offered by Unicorn Technologies Limited", St. Vincent and the Grenadines, registration no. 27217BC2025 | S3 |
| restricted jurisdictions | a list of 38 including the United States of America, Puerto Rico, Guam, American Samoa, the US Virgin Islands and the United Kingdom, from the capture of 2024-08-05 | S2 |
| US persons | may not trade, since the United States is on the restricted list | S2 |
| Canada | not on the 2024-08-05 list | S2 |
| fee page freshness | the capture of 2025-10-25 says "lastUpdated" 18/09/2025 | S1 |

The live pages could not be read from this host, so a change after 2025-10-25 to the fee page, or after 2024-08-05 to the restricted list, would not be seen here.
The newer restricted list at `bitmarkets.com/en/documents/restricted-jurisdictions-new` has no Wayback capture, since the archive answered 404.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-margined perpetuals ("Futures Trading Fees", General User) | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S1 |

The page states "For futures trading, both open and close positions will be charged trading fees.", S1.
With 20 % off for paying in BTMT, the General User rate is 0.080 % maker and 0.080 % taker, 800 ppm, and it needs a BTMT holding of at least 2,500 USD, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes, 129 pairs | CoinMarketCap `market-pairs/latest` with `category=perpetual` returned 129 pairs, all quoted in USDT, all linking to `https://bitmarkets.com/en/trade/futures-trading`, 2026-09-24, S4 |
| USDC-margined perpetuals | none seen | no USDC quote among the 129 pairs, S4 |
| coin-margined perpetuals | none seen | CoinMarketCap's exchange text mentions "settlement in USD, BTC or any other crypto" as multi-asset margin, but no inverse pair is listed, S4 and S5 |
| dated futures | Not verified | the site menu has a "Futures Trading" entry and a separate "Perpetuals" entry, S6, but no dated contract appears on CoinMarketCap |
| options | none seen | no menu entry, S6 |
| spot | yes | UAB BITmarkets spot, S3, and spot fees in S1 |
| margin | yes | "Margin Trading Fees" table, S1 |

## 4. Perpetual tiers

"Futures Trading Fees" from the capture of 2025-10-25, S1.
Rates are percent.
The level is set on "a 30-day rolling window of trading volume and will be recalculated daily at 00:00 (UTC)".

| level | 30-day futures volume (USD) | maker | taker | maker with BTMT 20 % off | taker with BTMT 20 % off | BTMT holding in USD |
|---|---:|---:|---:|---:|---:|---:|
| General User | 0 | 0.10 | 0.10 | 0.080 | 0.080 | ≥2,500 |
| VIP 1 | ≥5,000,000 | 0.07 | 0.08 | 0.056 | 0.064 | ≥10,000 |
| VIP 2 | ≥20,000,000 | 0.04 | 0.06 | 0.032 | 0.048 | ≥50,000 |
| VIP 3 | ≥500,000,000 | 0.02 | 0.05 | 0.016 | 0.040 | ≥100,000 |
| VIP 4 | ≥2,000,000,000 | 0.01 | 0.04 | 0.008 | 0.032 | ≥250,000 |
| VIP 5 | ≥5,000,000,000 | 0.00 | 0.03 | 0.000 | 0.024 | ≥500,000 |
| VIP 6 | ≥10,000,000,000 | -0.01 | 0.02 | -0.010 | 0.016 | ≥1,000,000 |

### Qualification

"VIP clients can get discounts automatically by meeting any one of the below-listed requirements to reach a specific tier level", S1.
So either the volume column or the BTMT holding column qualifies.
"Non-USD trading volume is converted into the USD equivalent volume at the spot exchange rate.", S1.

For context, the spot General User rate on the same page is 0.16 % maker and 0.18 % taker, S1.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| BTMT fee payment | 20 % off every tier, General User taker 0.080 % | S1 |
| referral | the page footer offers "35% of trading fees of your friends" to the referrer, which does not change the referee's taker | S1 |
| market maker programme | Not publicly specified | none found |
| zero fee promotion | articles titled "Revolutionizing Crypto: BITmarkets Introduces Zero Spot Trading Fees" and "Trade More, Pay Zero" were archived in 2024, and both concern spot, not perpetuals | S7 |

## 6. Funding as a cost

BITmarkets publishes no funding formula, interval, cap or floor that this host could read, since every live page is behind a Cloudflare challenge and no funding article was found in the Wayback index.
CoinMarketCap reports a funding rate for each of the 129 perpetuals, S4.
On 2026-09-24 at 06:42 UTC those rates ran from -0.00010348 to 0.0001, and 62 of 129 were exactly 0.0001.
That clustering at 0.01 % is consistent with a default interest term, but the formula is Not verified.
Who pays whom, the settlement instant and the interval are Not verified, and no settlement instant was captured.

## 7. Liquidation, settlement and delisting

Not publicly specified in any page this host could read.

## 8. CCXT

CCXT 4.5.68 has no BITmarkets class.
`node -e "console.log(require('ccxt').exchanges)"` from `server/` lists `bitmart`, `bitmex` and `btcmarkets` as the only names near it, and none is BITmarkets, P1.
The current CCXT source at `github.com/ccxt/ccxt`, folder `ts/src`, listed 111 entries on 2026-09-24 and none is BITmarkets, P1.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
BITmarkets cannot be registered, because it has no CCXT class, no public API, and no socket that serves market data to an unauthenticated client, see [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).
If it ever publishes an API, `takerPpm` would be 1,000 from the General User futures taker in S1.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tiered Discounts of Trading Fees, Wayback capture of 2025-10-25, page dated 18/09/2025 | https://web.archive.org/web/20251025144711/https://bitmarkets.com/en/support-desk/category/trading/tiered-discounts-of-trading-fees | 2026-09-24 | BITmarkets, global | sections 1, 2, 4 and 5 |
| S2 | Restricted Jurisdictions, Wayback capture of 2024-08-05 | https://web.archive.org/web/20240805042151/https://bitmarkets.com/en/company/legal/restricted-jurisdictions | 2026-09-24 | BITmarkets, global | section 1 |
| S3 | License and Regulation PDF, Wayback capture of 2025-07-22 | https://web.archive.org/web/20250722121043/https://bitmarkets.com/en/documents/licensure-and-regulation-new | 2026-09-24 | UAB BITmarkets, Unicorn Technologies Limited | section 1 |
| S4 | CoinMarketCap market pairs, `category=perpetual`, two pages of 100 | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bitmarkets&category=perpetual&start=1&limit=100 | 2026-09-24 | CoinMarketCap | sections 3 and 6 |
| S5 | CoinMarketCap exchange page | https://coinmarketcap.com/exchanges/bitmarkets/ | 2026-09-24 | CoinMarketCap | section 3 |
| S6 | `bitmarkets.com/en/api`, answered 404 with the site menu and no challenge | https://bitmarkets.com/en/api | 2026-09-24 | BITmarkets | section 3 |
| S7 | Wayback URL index of `bitmarkets.com` | https://web.archive.org/cdx/search/cdx?url=bitmarkets.com&matchType=domain | 2026-09-24 | Internet Archive | section 5 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitmarkets/rest-probe.mjs), CCXT line, and the GitHub contents listing of `ts/src` | https://api.github.com/repos/ccxt/ccxt/contents/ts/src | 2026-09-24 | this host | section 8 |
