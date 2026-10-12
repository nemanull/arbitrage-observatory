# IBIT Global Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22, rechecked 2026-10-09.

**Probed:** 2026-10-09 by the Seattle calendar, 2026-10-10 02:18 to 02:45 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

This profile covers the USDT-margined perpetuals of IBIT Global, the venue CoinMarketCap ranks 166 among exchanges.
It was started on 2026-09-24 and stopped part way, and every claim of that draft was checked again on 2026-10-09.
IBIT Global publishes no public API documentation, and every REST path its web app calls is signed, see [`rest.md`](./rest.md) section 1.
So the fee numbers below come only from the help center, which [`fees-probe.py`](../../../scripts/probes/venues/ibit-global/fees-probe.py) reads through the public Zendesk article API.
The 2026-09-24 draft read the same articles with [`rest-probe.mjs`](../../../scripts/probes/venues/ibit-global/rest-probe.mjs), which stays as frozen evidence.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "IBIT Limited (hereinafter referred to as 'the Company') is a company incorporated in Singapore under the laws of Singapore." | S3, P1 |
| web host | `https://www.ibitglobal.ai`, and `ibit.global` answers 301 to it | P2, [`rest.md`](./rest.md) section 1 |
| who may trade | anyone not on the FATF list, the OFAC SDN list or another sanctions list such as the UN list, subject to local law | S3, P1 |
| excluded regions | Not publicly specified. The Terms of Use, updated 2026-09-19, say IBIT "may restrict or deny the Services in certain countries at its discretion" | S3, P1 |
| US persons | not named as excluded. The phrase "United States" does not occur in the Terms of Use | S3, P1 |
| automated arbitrage | the Perpetual Contact Trading User Agreement, updated 2026-05-19, lists "Quantitative arbitrage, third-party automated arbitrage" and "high-frequency or ultra-short-term trading within an extremely short time (60 seconds)" as abnormal behaviour the platform may act against | S4, P1 |
| API trading | the API key page offers only the permissions "Allow reading" and "Allow Spot Trading" | P2, [`rest.md`](./rest.md) section 1 |

The agreement and the rebate notices pull in opposite directions.
The agreement treats trades inside 60 s as abnormal, S4.
The risk control notice of 2025-12-17 removed the limits on orders held under 3 minutes and gave their fees an 80 % affiliate rebate share, S13.
That share rose to 85 % from 2026-05-16, S6, and to 90 % from 2026-07-03, S14.
The access results in this profile were read from the Canadian VPN exit named above, and no region refusal was seen on the web host or the help center.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals, VIP 0 | 0.040 %, 400 ppm | 0.060 %, 600 ppm | S1 and S2, read by P1 |
| spot, VIP 0 | 0.100 %, 1,000 ppm | 0.100 %, 1,000 ppm | S2 and S15, read by P1 |

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 99 live on the venue's socket, 96 on CoinMarketCap | P3 lists 106 symbols on the all-market mark channel, and the mark of 99 moved within 60 s. The 7 frozen ones are contracts the help center announced as delisted. CoinMarketCap lists 96, S7. See [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | none seen | every symbol on the socket and on CoinMarketCap ends in `usdt`, P3 and S7 |
| coin-margined perpetuals | none seen | same evidence. The funding article still gives a coin-margined formula, S5 |
| dated futures | none on CoinMarketCap | S7 `category=futures` returned 0 pairs |
| options | none seen | the web app's request paths name futures and spot only, P2 |
| spot | yes, 36 pairs on CoinMarketCap, 40 symbols on the spot socket | S7 `category=spot`, P3 |

## 4. Perpetual tiers

From "About IBIT VIP Benefits", S2, updated 2025-04-21, as P1 parsed it.

| level | 30 day perpetual volume (USDT) | total balance (USDT) | contract taker | contract maker | spot taker | spot maker |
|---|---|---|---|---|---|---|
| VIP 0 | ≧0 | ≧0 | 0.060 % | 0.040 % | 0.100 % | 0.100 % |
| VIP 1 | ≧10,000,000 | ≧50,000 | 0.060 % | 0.040 % | 0.100 % | 0.100 % |
| VIP 2 | ≧30,000,000 | ≧500,000 | 0.060 % | 0.040 % | 0.100 % | 0.100 % |
| VIP 3 | ≧50,000,000 | ≧1,000,000 | 0.060 % | 0.040 % | 0.100 % | 0.100 % |
| VIP 4 | ≧80,000,000 | ≧2,000,000 | 0.060 % | 0.040 % | 0.100 % | 0.100 % |
| VIP 5 | ≧120,000,000 | ≧3,000,000 | 0.060 % | 0.040 % | 0.100 % | 0.100 % |

Every level carries the same rates.
The page says "More VIP rights will be supported in the future".
The table also lists withdrawal limits, which are out of scope here.
Whether the two thresholds are joined by "and" or "or" is Not publicly specified in the table.

## 5. Discounts that change the perpetual taker

- Token holding discount: none found.
  No exchange token is named in the fee or VIP articles.
- Referral: the affiliate program shares fees with the referrer and can return a "rebate rate" to the invited user, 10 % in the notices' example, S6 and S14.
  That rebate is paid after the fact, and it does not change the published taker.
- Market maker: announcements from 2025-01-29 and 2025-02-11 name a market maker API, S8.
  A notice of 2025-07-11 upgrades the "Spot Trading API" for "market maker partners", S16.
  Its terms, rates and documentation are Not publicly specified.
- Zero fee promotions: none found in the help center search for "fee" on 2026-10-09.

## 6. Funding as a cost

From "Funding Rate", S5, updated 2024-04-10.

- Funding Amount = Nominal Value of Positions × Funding Rate, where the nominal value is Mark Price × position size for USDⓈ-margined contracts.
- "Funding payments with a settlement frequency of every eight hours occur at 00:00 (UTC), 08:00 (UTC), and 16:00 (UTC)."
- The funding is paid between long and short holders, and "IBIT does not charge any service fees."
- Settlement runs without pausing trading, so "Traders opening or closing positions at 08:02:00 may be charged or paid funding fees", and a holder at 08:00:00 who closes at 08:02:00 may not be charged "if the snapshot was not successful".
- The rate formula, its cap and its floor are Not publicly specified.
  The mark price article uses a "Latest Funding Rate" but does not define it, S9.
- Whether the published rate is the upcoming or the last settled one is Not publicly specified.
- The settlement instant itself was not captured.

The web app's socket publishes a `positionFeeRate` per contract, P3.
It read 0.0003 on 86 contracts, -0.0003 on 19 and 0.0002 on 2, and every `updateTime` fell within a second after a five minute boundary.
CoinMarketCap reported the same three values, S7.
Only three distinct values across 107 contracts suggests a rate clamped at ±0.03 % per 8 h, but the clamp is Not publicly specified.

## 7. Liquidation, settlement and delisting

- Forced liquidation triggers when the mark price reaches the liquidation price, and the position's margin is lost, S10.
  A liquidation fee is Not publicly specified.
- On a futures delisting, "All open positions will be automatically settled and closed at the prevailing Mark Price", and "Settlement fees will follow IBIT's standard fee schedule", S11.
  The PROMPT/USDT notice of 2026-10-01 says the same, S12.
- The agreement lets IBIT cancel or roll back trades it deems abnormal, S4.

## 8. CCXT

No CCXT class exists.
CCXT 4.5.68 is installed at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/`, whose `package.json` line 3 reads `"version": "4.5.68"`.
Its `js/src/` holds 104 `.js` files, and the only name containing `ibit` is `deribit.js`.
No file under `js/src/` contains `ibitglobal` or `ibit.global`.
The GitHub listing of `ts/src` on `master` at commit `f0aca06eb7`, committed 2026-10-08 09:28 UTC, has 110 entries, and the only one containing `ibit` is `deribit.ts`, S17.
So `market.taker` has no value to report.

## 9. Recommended registry values

None.
The venue cannot be added in its current shape, see [`rest.md`](./rest.md) section 8.
If it ever publishes an API, `takerPpm` would be 600 from S1 and S2, and `ccxtTakerPpm` has no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | IBIT Trading Fee, updated 2026-02-11 | https://ibitglobal.zendesk.com/hc/en-us/articles/21506118458900 | 2026-10-09 | IBIT Limited | perpetual maker 0.040 % and taker 0.060 %, sections 2 and 9 |
| S2 | About IBIT VIP Benefits, updated 2025-04-21 | https://ibitglobal.zendesk.com/hc/en-us/articles/21321062998804 | 2026-10-09 | IBIT Limited | tier table, sections 2 and 4 |
| S3 | Terms of Use, updated 2026-09-19 | https://ibitglobal.zendesk.com/hc/en-us/articles/21082148024852 | 2026-10-09 | IBIT Limited, Singapore | operator, sanctions, discretionary country restriction, section 1 |
| S4 | IBIT Perpetual Contact Trading User Agreement, updated 2026-05-19 | https://ibitglobal.zendesk.com/hc/en-us/articles/21082446611604 | 2026-10-09 | IBIT Limited | abnormal behaviour list, sections 1 and 7 |
| S5 | Funding Rate, updated 2024-04-10 | https://ibitglobal.zendesk.com/hc/en-us/articles/21253361384980 | 2026-10-09 | IBIT Limited | funding amount, 8 h schedule, section 6 |
| S6 | IBIT High-Frequency Rebate Rule Upgrade Notice, 2026-06-28 | https://ibitglobal.zendesk.com/hc/en-us/articles/49272267049876 | 2026-10-09 | IBIT Limited | rebate share 80 % to 85 % from 2026-05-16, sections 1 and 5 |
| S7 | CoinMarketCap data API, market pairs for `ibit-global`, categories perpetual, spot and futures | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=ibit-global&category=perpetual&start=1&limit=200 | 2026-10-10 02:20 UTC | third party | pair counts, reported funding rates, sections 3 and 6 |
| S8 | IBIT Contract Trading Liquidity Adjustment Announcement and its resumption notice | https://ibitglobal.zendesk.com/hc/en-us/articles/34341298907924 and https://ibitglobal.zendesk.com/hc/en-us/articles/34708558100372 | 2026-10-09 | IBIT Limited | market maker API, section 5 |
| S9 | Mark Price, updated 2024-01-25 | https://ibitglobal.zendesk.com/hc/en-us/articles/23137908674580 | 2026-10-09 | IBIT Limited | "Latest Funding Rate" in the mark formula, section 6 |
| S10 | Forced Liquidation, updated 2024-03-06 | https://ibitglobal.zendesk.com/hc/en-us/articles/21288463260180 | 2026-10-09 | IBIT Limited | liquidation trigger, section 7 |
| S11 | About Delisting NFP/USDT Futures Trading Pair, 2026-07-10 | https://ibitglobal.zendesk.com/hc/en-us/articles/51150820764052 | 2026-10-09 | IBIT Limited | delisting settlement at mark, section 7 |
| S12 | IBIT PROMPT/USDT Perpetual Contract Delisting Announcement, 2026-10-01 | https://ibitglobal.zendesk.com/hc/en-us/articles/54116995016212 | 2026-10-09 | IBIT Limited | delisting on 2026-10-03 and settlement fees, section 7 |
| S13 | IBIT Risk Control System Upgrade, 2025-12-17 | https://ibitglobal.zendesk.com/hc/en-us/articles/44420425068308 | 2026-10-09 | IBIT Limited | 80 % rebate share for orders held under 3 minutes, section 1 |
| S14 | About IBIT High-Frequency Trading Rebate Rate Upgrade, 2026-07-02 | https://ibitglobal.zendesk.com/hc/en-us/articles/50909476364180 | 2026-10-09 | IBIT Limited | rebate share 85 % to 90 % from 2026-07-03, sections 1 and 5 |
| S15 | IBIT Spot Trading Fee, updated 2024-08-26 | https://ibitglobal.zendesk.com/hc/en-us/articles/29637203318420 | 2026-10-09 | IBIT Limited | spot maker and taker 0.1 %, section 2 |
| S16 | About IBIT Spot Trading API Optimization, 2025-07-11 | https://ibitglobal.zendesk.com/hc/en-us/articles/39219520993300 | 2026-10-09 | IBIT Limited | spot API for market maker partners, section 5 |
| S17 | CCXT on GitHub, `ts/src` on `master` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-10-10 | CCXT | no class, section 8 |
| P1 | `fees-probe.py` | [`fees-probe.py`](../../../scripts/probes/venues/ibit-global/fees-probe.py) | 2026-10-10 | this host, Canadian VPN exit | fee and VIP numbers and every quoted sentence as the help center API served them |
| P2 | `rest-probe.py` | [`rest-probe.py`](../../../scripts/probes/venues/ibit-global/rest-probe.py) | 2026-10-10 | this host, Canadian VPN exit | web host, API key permissions, request paths, section 1 |
| P3 | `ws-probe.py` mode book and spot | [`ws-probe.py`](../../../scripts/probes/venues/ibit-global/ws-probe.py) | 2026-10-10 | this host, Canadian VPN exit | live contract count and funding values, sections 3 and 6 |
