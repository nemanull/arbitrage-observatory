# EXMO Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:41 to 04:56 UTC, and the second pass from 04:59 to 05:04 UTC, from the development host near Seattle, through the laptop's Surfshark WireGuard exit that geolocates to Canada.

EXMO (CCXT id `exmo`) is a spot exchange with a spot margin product and no perpetual, dated future or option of its own.
Its operator announced an orderly wind-down on 2026-07-14, closed new registrations and deposits, and keeps trading open only as asset conversion before withdrawal, S1.
This profile therefore covers EXMO spot as the survey plan's template change 1 asks, and it records the wind-down state as the main fact.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/exmo/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 Pacific time, 2026-09-23 UTC | this profile |
| operator of exmo.com | Blue Isthmus Technologies CORP., Republic of Panama, registration 155777354 | S4, S5 |
| other group entity | UAB Exmo Exchange, Lithuania, ceased all virtual asset services on 2025-12-31 when the Lithuanian transitional period for virtual asset service providers expired | S2 |
| platform state | wind-down announced 2026-07-14 after UK financial sanctions on legal entities of the EXMO.com group, as the notice states | S1 |
| who may trade | nobody new: "New account registrations are closed" and "New deposits will no longer be processed" | S1 |
| what existing users may do | withdraw, and convert assets on the remaining pairs: "Trading (assets conversion) will remain available in order to allow you to convert some assets into currencies that are available for withdrawal" | S1 |
| margin | "Trades are restricted to closing only- no new positions can be opened", which reads as the margin product, since conversion trading stays open | S1 |
| balance haircut | 29.4 % of every client balance was replaced by a non-tradable, non-withdrawable claim token, USDRecover (USDRec) | S1 |
| excluded regions | the terms bar anyone located in, resident in, or accessing from a jurisdiction under comprehensive UN, OFAC, EU or UK sanctions, or a jurisdiction where EXMO holds no authorization. They name no country, and they do not name the United States | S4, last updated 2026-06-26 |
| US persons | not named in the terms. Moot, since no account can be opened | S1, S4 |
| Ukraine | a mirror at `ua.exmo.com` was opened for users in Ukraine on 2026-06-01 | S3 |
| sister platform | `exmo.me`, operated by Forterra Alliance Corp, Seychelles, is itself in liquidation, and asks users to verify by 2026-09-30 to enter a claim in the liquidation balance | S10 |
| CoinGecko | trust score 3, trust rank 152 on 2026-09-23, 24 h volume 0.0354 BTC. Its 20 tracked tickers show a bid and ask spread of 17.9 to 18.7 %, and it flags 15 as stale and 16 as anomalies | S11 |

The UK sanctions designation itself was not checked against an official UK list, because the web search budget of this session was spent.
It is stated here as EXMO's own notice states it.

Access from this host is recorded in [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
Every public call answered 200 or opened, and nothing refused this host, whose traffic leaves through a Canadian VPN exit.
The exmo.com page data reported `"country":"CA"` for this host, S6.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, all 24 listed pairs, all quoted in USDC | 1 %, 10,000 ppm | 1 %, 10,000 ppm | `commission_maker_percent` and `commission_taker_percent` `"1"` on 24 of 24 pairs in `GET /v1.1/pair_settings`, P1, and `taker` `"1"` and `maker` `"1"` on 24 of 24 pairs in `GET https://exmo.com/ctrl/feesAndLimits`, S7 |
| spot before the wind-down, 2026-06-02 | 0.1 %, 1,000 ppm on 92 of 109 pairs | 0.1 %, 1,000 ppm on 92 of 109 pairs | S8 |
| perpetuals | none listed | none listed | section 3 |

The fee is irrelevant in practice, because every pair is quoted about 10 % either side of a reference price, see [`rest.md`](./rest.md) section 5.
A taker cross pays 1 % in fee and about 10 % in spread.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps, any settlement | absent | CCXT `'swap': false` at `server/node_modules/ccxt/js/src/exmo.js` line 30, 0 swap markets from `loadMarkets` in P1, no futures section in the API documentation S9, and no EXMO entry on CoinGecko's derivatives list of 2026-09-22 |
| dated futures | absent | CCXT `'future': false` at line 31, S9 |
| options | absent | CCXT `'option': false` at line 32, S9 |
| spot | present, conversion only | 24 pairs, every one quoted in USDC, P1. 109 other pairs on 2026-06-02, of which 86 were quoted in USDT, S8 |
| spot margin | closing only | the Margin API is documented, S9, and the notice restricts it to closing positions, S1. Without credentials CCXT marks every market `margin: false`, because the margin pair list is private, at `server/node_modules/ccxt/js/src/exmo.js` lines 851 to 853 and 916 |
| exmo.me | separate platform, one pair | `https://api.exmo.me/v1.1/pair_settings` lists only `BTC_USDT`, P1, and that platform is in liquidation, S10 |

Deposit, withdrawal and conversion fees are at `https://exmo.com/ctrl/feesAndLimits`, which on 2026-09-23 listed deposits as `-` and withdrawal fees as blank for 24 coins, S7.
The closing notice warns that withdrawal fees "might be increased", S1.

## 4. Spot tiers

No tier table is published in a form this host can read.
`https://exmo.com/en/docs/fees`, which CCXT names at `server/node_modules/ccxt/js/src/exmo.js` line 122, redirects to `https://exmo.com/commissions`.
That page renders the headings "30-day Trade Volume, $", "Maker" and "Taker" for four products, and fills the table from script, so the served HTML carries no tier rows, S6.
Its marketing line still reads "0.1% trading commission".

The per pair numbers on the wire are what an order pays at VIP 0.

| date | pairs | maker and taker | source |
|---|---|---|---|
| 2026-06-02 | 92 | 0.1 % | S8 |
| 2026-06-02 | 14, the fiat and stablecoin pairs such as `BTC/USD`, `ETH/USD`, `USDT/EUR`, `USDT/UAH` | 0.3 % | S8 |
| 2026-06-02 | 1, `BTT100K/USDT` | 0.2 % | S8 |
| 2026-06-02 | 2, `EXM/USDT` and `EXM/USDC` | 0 % | S8 |
| 2026-09-23 | 24 of 24 | 1 % | P1, S7 |

### Qualification

Not publicly specified in a readable form, see above.

## 5. Discounts that change the spot taker

The exmo.com home page still advertises "EXMO Premium", with "Up to 100% discount on trading fees with our Premium packages", the EXMO Coin, and a referral program paying "up to 40% reward from their trading fees", S5.
Whether any of these still applies during the wind-down is Not verified, and none is reachable by a new account, since registration is closed, S1.
No zero fee promotion is announced.

## 6. Funding as a cost

Spot carries no funding.
The margin product's funding terms sit behind the private `margin/funding/list` call named in S9, which this survey does not read.
No index, mark or perpetual funding rate exists, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

- The platform is being delisted as a whole: withdrawals are processed in order of request, sometimes over several days, and "Additional fees or restrictions may be introduced in the future", S1.
- 29.4 % of every balance was converted into USDRec, a claim on assets that may later be recovered from the 2020 hot wallet theft or released from frozen custodians, S1.
- None of the 109 pairs listed on 2026-06-02 is still listed, S8 and P1.
  The 24 pairs listed now are all quoted in USDC, and none of them was in the June list, whose only USDC pairs were `RENDER/USDC`, `HMSTR/USDC` and `EXM/USDC`.
- Margin positions can only be closed, S1.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `exmo`, 24 spot markets from `loadMarkets` without credentials, 0 swap | P1 |
| `market.taker` | 0.01, that is 10,000 ppm, on 24 of 24 markets | P1 |
| where it comes from | `commission_taker_percent` of `pair_settings` divided by 100 | `server/node_modules/ccxt/js/src/exmo.js` lines 901 and 924 |
| default constant | `fees.trading.taker` 0.004, used only before markets load | `server/node_modules/ccxt/js/src/exmo.js` line 195 |
| `market.active` | `undefined` | line 920 |
| `market.contractSize`, `linear` | `undefined`, as for any spot market | lines 922 and 926 |
| declared country | `['LT']`, Lithuania, which is the ceased UAB entity | line 23, S2 |
| www and referral URLs | `exmo.me`, the sister platform, while the API host is `api.exmo.com` | lines 113, 117 and 118 |

## 9. Recommended registry values

None.
EXMO lists no perpetual, so the engine's catalog path, which keeps only active swap markets at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203, would find nothing.
The platform is also winding down, closed to new users and quoting every pair about 10 % off its reference.
If a spot leg were ever wanted for research, `takerPpm` would be 10,000 and `ccxtTakerPpm` 10,000, because CCXT reads the per pair wire value, which today equals the published 1 %.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | EXMO.com is closing, notice dated 14-07-2026 | https://exmo.com/blog/en/notifications/exmo-com-is-closing-please-initiate-withdrawal-from-your-account | 2026-09-23 | EXMO.com | wind-down, closed registrations and deposits, conversion only trading, margin closing only, 29.4 % USDRec, withdrawal terms, sections 1, 3, 5, 7 |
| S2 | Important notice: UAB Exmo Exchange to Cease Providing Services on 31 December 2025, dated 17-12-2025 | https://exmo.com/blog/en/notifications/important-notice-uab-exmo-exchange-to-cease-providing-services-on-31-december-2025/ | 2026-09-23 | UAB Exmo Exchange, Lithuania | the Lithuanian entity ceased, sections 1 and 8 |
| S3 | Access update for users in Ukraine, dated 01-06-2026 | https://exmo.com/blog/en/notifications/access-update-for-users-in-ukraine/ | 2026-09-23 | EXMO.com, Ukraine | `ua.exmo.com` mirror, section 1 |
| S4 | Terms of Use, last updated June 26, 2026 | https://exmo.com/blog/en/terms-of-use/ | 2026-09-23 | Blue Isthmus Technologies CORP., Panama | operator, section 2.3 on sanctions and restricted jurisdictions, section 1 |
| S5 | exmo.com home page | https://exmo.com/ | 2026-09-23 | EXMO.com | closing banner, footer entity, Premium, EXMO Coin, referral, sections 1 and 5 |
| S6 | Fees and limits page, reached from `https://exmo.com/en/docs/fees` | https://exmo.com/commissions | 2026-09-23 | EXMO.com | script rendered tier table, "0.1% trading commission", `"country":"CA"` in the page data, sections 1 and 4 |
| S7 | Fee and limit endpoint, live | https://exmo.com/ctrl/feesAndLimits | 2026-09-23 | EXMO.com | 24 pairs at 1 % maker and taker, deposit and withdrawal columns, sections 2 to 4 |
| S8 | The same endpoint archived on 2026-06-02 | http://web.archive.org/web/20260602182910/https://exmo.com/ctrl/feesAndLimits | 2026-09-23 | EXMO.com | 109 pairs and their fees before the wind-down, sections 2 to 4, 7 |
| S9 | Exmo API, Postman documentation, reached from `https://exmo.com/en/api_doc` | https://documenter.getpostman.com/view/10287440/SzYXWKPi | 2026-09-23 | EXMO.com | product list, Margin API, section 3 |
| S10 | exmo.me home page | https://exmo.me/ | 2026-09-23 | Forterra Alliance Corp, Seychelles | the sister platform's liquidation and verification deadline, sections 1 and 3 |
| S11 | CoinGecko exchange API for `exmo` | https://api.coingecko.com/api/v3/exchanges/exmo | 2026-09-23 | CoinGecko | trust score, rank, volume, spreads, section 1 |
| S12 | CCXT 4.5.68 `exmo.js` | `server/node_modules/ccxt/js/src/exmo.js` | 2026-09-23 | CCXT | lines cited in sections 3, 4 and 8 |
| P1 | `rest-probe.mjs catalog` at 04:47 UTC, and the second pass at 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs) | 2026-09-23 | this host | pair count, per pair fees, CCXT market fields, exmo.me catalog, sections 2, 3, 8 |
| P2 | `rest-probe.mjs book` at 04:47 and 04:55 UTC, and the second pass at 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs) | 2026-09-23 | this host | the 10 % quotes, section 2 |
