# IBIT Global Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 07:07 to 07:08 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the USDT-margined perpetuals of IBIT Global, the venue CoinMarketCap ranks 166 among exchanges.
IBIT Global publishes no public API documentation, and every endpoint its web app uses is signed, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
So the fee numbers below come only from the help center, which [`rest-probe.mjs`](../../../scripts/probes/venues/ibit-global/rest-probe.mjs) reads through the public Zendesk article API.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "IBIT Limited (hereinafter referred to as 'the Company') is a company incorporated in Singapore under the laws of Singapore." | S3 |
| web host | `https://www.ibitglobal.ai`, and `ibit.global` answers 301 to it | P1, [`rest.md`](./rest.md) section 1 |
| who may trade | anyone not on the FATF, OFAC SDN or UN sanctions lists, subject to local law | S3 |
| excluded regions | Not publicly specified. The terms say IBIT "may restrict or deny the Services in certain countries at its discretion" | S3 |
| US persons | not named as excluded in the Terms of Use or the Perpetual Contract Terms of Use | S3, S4 |
| automated arbitrage | the Perpetual Contract Terms list "Quantitative arbitrage, third-party automated arbitrage" and "high-frequency or ultra-short-term trading within an extremely short time (60 seconds)" as abnormal behaviour the platform may act against | S4, section 4.6 |
| API trading | the API key page offers only the permissions "Allow reading" and "Allow Spot Trading" | [`rest.md`](./rest.md) section 1 |

The terms and the rebate notice pull in opposite directions.
The Perpetual Contract Terms treat trades inside 60 s as abnormal, S4.
The High-Frequency Rebate notice of 2026-06-28 raises the affiliate rebate share on "orders with a holding duration of less than 3 minutes" from 80 % to 85 %, S6.
The access results in this profile were read from the Canadian VPN exit named above, and no region refusal was seen on the web host.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals, VIP 0 | 0.040 %, 400 ppm | 0.060 %, 600 ppm | S1 and S2, read by P1 |
| spot, VIP 0 | 0.100 %, 1,000 ppm | 0.100 %, 1,000 ppm | S2, read by P1 |

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 96 on CoinMarketCap, not counted on the venue | S7: 96 pairs, all quoted in USDT. The venue's own catalog call refused this host, see [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | Not verified, none on CoinMarketCap | S7 |
| coin-margined perpetuals | Not verified, none on CoinMarketCap | S7. The funding article gives a coin-margined formula, S5 |
| dated futures | none on CoinMarketCap | S7 `category=futures` returned 0 pairs |
| options | none seen | the web app bundle names only futures and spot pages |
| spot | yes, 36 pairs on CoinMarketCap | S7 `category=spot` |

## 4. Perpetual tiers

From "About IBIT VIP Benefits", S2, as P1 parsed it.

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
Whether the two thresholds are joined by "and" or "or" is Not publicly specified in the table, and the application guide was not read.

## 5. Discounts that change the perpetual taker

- Token holding discount: none found.
  IBIT has no exchange token named in the fee or VIP articles.
- Referral: the affiliate program shares fees with the referrer and can return a "rebate rate" to the invited user, 10 % in the notice's example, S6.
  That rebate is paid after the fact, and it does not change the published taker.
- Market maker: announcements from 2025-01-29 and 2025-02-11 name a "做市商 API", a market maker API, S8.
  Its terms and rates are Not publicly specified.
- Zero fee promotions: none found in the help center search on 2026-09-24.

## 6. Funding as a cost

From "Funding Rate", S5, updated 2024-04-10.

- Funding Amount = Nominal Value of Positions × Funding Rate, where the nominal value is Mark Price × position size for USDⓈ-margined contracts.
- "Funding payments with a settlement frequency of every eight hours occur at 00:00 (UTC), 08:00 (UTC), and 16:00 (UTC)."
- The funding is paid between long and short holders, and "IBIT does not charge any service fees."
- Settlement runs without pausing trading, so "Traders opening or closing positions at 08:02:00 may be charged or paid funding fees", and a holder at 08:00:00 who closes at 08:02:00 may not be charged "if the snapshot was not successful".
- The rate formula, its cap and its floor are Not publicly specified.
  The mark price article uses a "Latest Funding Rate" but does not define it, S9.
- Whether the displayed rate is the upcoming or the last settled one is Not publicly specified, and no funding history could be read, see [`rest.md`](./rest.md) section 4.
- The settlement instant itself was not captured.

CoinMarketCap reported a `fundingRate` of 0.0003 on 78 pairs, -0.0003 on 16 and 0.0002 on 2, S7.
Only three distinct values across 96 pairs suggests these are not live per contract rates, and they are recorded here as reported, not verified.

## 7. Liquidation, settlement and delisting

- Forced liquidation triggers when the mark price reaches the liquidation price, and the position's margin is lost, S10.
  A liquidation fee is Not publicly specified.
- On a futures delisting, "All open positions will be automatically settled and closed at the prevailing Mark Price", and "Settlement fees will follow IBIT's standard fee schedule", S11.
- The Perpetual Contract Terms let IBIT cancel or roll back trades it deems abnormal, S4.

## 8. CCXT

No CCXT class exists.
`require('ccxt').exchanges` in CCXT 4.5.68, run from `server/`, matches only `deribit` for `/ibi/i`.
The GitHub listing of `ts/src` on `master` at commit `5df62a3eef`, committed 2026-09-24 06:45 UTC, has 111 entries, and none contains `ibit` except `deribit.ts`.
So `market.taker` has no value to report.

## 9. Recommended registry values

None.
The venue cannot be added in its current shape, see [`rest.md`](./rest.md) section 8.
If it ever publishes an API, `takerPpm` would be 600 from S1 and S2, and `ccxtTakerPpm` has no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | IBIT Trading Fee, updated 2026-02-11 | https://ibitglobal.zendesk.com/hc/en-us/articles/21506118458900-IBIT-Trading-Fee | 2026-09-24 | IBIT Limited | perpetual maker 0.040 % and taker 0.060 %, sections 2 and 9 |
| S2 | About IBIT VIP Benefits, updated 2025-04-21 | https://ibitglobal.zendesk.com/hc/en-us/articles/21321062998804 | 2026-09-24 | IBIT Limited | tier table, section 4 |
| S3 | Terms of Use | https://ibitglobal.zendesk.com/hc/en-us/articles/21082148024852 | 2026-09-24 | IBIT Limited, Singapore | operator, sanctions, discretionary country restriction, section 1 |
| S4 | Perpetual Contract Terms of Use, section 4.6 | https://ibitglobal.zendesk.com/hc/en-us/articles/21082446611604 | 2026-09-24 | IBIT Limited | abnormal behaviour list, sections 1 and 7 |
| S5 | Funding Rate, updated 2024-04-10 | https://ibitglobal.zendesk.com/hc/en-us/articles/21253361384980 | 2026-09-24 | IBIT Limited | funding amount, 8 h schedule, section 6 |
| S6 | IBIT High-Frequency Rebate Rule Upgrade Notice, 2026-06-28 | https://ibitglobal.zendesk.com/hc/en-us/articles/49272267049876 | 2026-09-24 | IBIT Limited | rebate share for orders held under 3 minutes, sections 1 and 5 |
| S7 | CoinMarketCap data API, market pairs for `ibit-global`, categories perpetual, spot and futures | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=ibit-global&category=perpetual&start=1&limit=200 | 2026-09-24 07:08 UTC | third party | pair counts, reported funding rates, section 3 and 6 |
| S8 | IBIT 合约交服务流动性调整公告 and its restoration notice | https://ibitglobal.zendesk.com/hc/zh-cn/articles/34341298907924 and https://ibitglobal.zendesk.com/hc/zh-cn/articles/34708558100372 | 2026-09-24 | IBIT Limited | market maker API, section 5 |
| S9 | Mark Price, updated 2024-01-25 | https://ibitglobal.zendesk.com/hc/en-us/articles/23137908674580 | 2026-09-24 | IBIT Limited | "Latest Funding Rate" in the mark formula, section 6 |
| S10 | Forced Liquidation | https://ibitglobal.zendesk.com/hc/en-us/articles/21288463260180 | 2026-09-24 | IBIT Limited | liquidation trigger, section 7 |
| S11 | About Delisting NFP/USDT Futures Trading Pair | https://ibitglobal.zendesk.com/hc/en-us/articles/51150820764052 | 2026-09-24 | IBIT Limited | delisting settlement at mark, section 7 |
| S12 | CCXT on GitHub, `ts/src` on `master` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-24 | CCXT | no class, section 8 |
| P1 | `rest-probe.mjs` at 07:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ibit-global/rest-probe.mjs) | 2026-09-24 | this host, Canadian VPN exit | fee and VIP numbers as the help center API served them |
