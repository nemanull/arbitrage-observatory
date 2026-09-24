# HashKey Global Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:06 to 03:43 UTC on 2026-09-23, the last run of each mode a second pass after the profiles were written, from the development host near Seattle.

This profile covers perpetual trading on HashKey Global (CCXT id `hashkey`), and nothing else.
HashKey Global is the Bermuda site of HashKey Group, served by `api-glb.hashkey.com`, and it is a separate venue from HashKey Exchange, see [`../hashkey-exchange/fees.md`](../hashkey-exchange/fees.md).
Spot, deposit, withdrawal, card and earn schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC, for every source row | | source ledger |
| legal entity | HashKey Bermuda Limited ("HBML"), under a Class F licence of the Bermuda Monetary Authority | Published | S1, S12 |
| who may trade the perpetuals | A client of HBML who passes onboarding, including its jurisdiction rules, and "the eligibility criteria determined by HBML from time to time" for the perpetual product | Published | S11 |
| excluded regions | "HashKey Global does not service users from Hong Kong, United States, Mainland China and certain other jurisdictions" | Published | S1 footer, S2 footer |
| excluded regions, full list | 91 of the 253 rows of the account opening table say "we are unable to provide services in this area", among them the United States of America, Puerto Rico, the U.S. Virgin Islands, Hong Kong, China, Russia, Ukraine, Israel, South Africa and Bulgaria | Published | S10, updated 2026-08-25 |
| US persons | may not open an account, the United States row is refused | Region-specific | S10 |
| app | the Global site of the former HashKey Global App now lives inside the HashKey Exchange App, with accounts carried over | Published | S21 |
| help centre pages from this host | `support.global.hashkey.com` redirects to `help.hashkey.com`, whose article pages answered HTTP 403 with a Cloudflare "Just a moment..." challenge to `curl` | Probed | `curl` on 2026-09-23 03:08 UTC |
| help centre API from this host | `https://help.hashkey.com/api/v2/help_center/en-us/articles/<id>.json` answered 200 with the article body, which is how every S row below was read | Probed | `curl` on 2026-09-23 |
| public API from this host | `api-glb.hashkey.com` and `stream-glb.hashkey.com` answered every public call with no challenge | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The development host sits in the United States, which is refused by S10, so trading from it is not allowed.
Reading public market data is not an account service, and the API hosts served it without a refusal.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals (`BTCUSDT-PERPETUAL`, `ETHUSDT-PERPETUAL`) | 0.025 % = 250 ppm | 0.060 % = 600 ppm | Published | S1, the futures columns of the VIP table effective 2025-04-30, page updated 2026-08-20 |

The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters.
The same VIP 0 pair, 0.025 % and 0.060 %, is the "Standard Fee" column of the two 2026 rate promotions, S2 and S4, and it is CCXT's swap constant, section 8.

## 3. Coverage matrix

| product | present | count on 2026-09-23 UTC | evidence |
|---|---|---:|---|
| USDT-M perpetuals | yes | 2, `BTCUSDT-PERPETUAL` and `ETHUSDT-PERPETUAL`, both `TRADING` | Probed, `GET /api/v1/exchangeInfo` field `contracts`, [`rest.md`](./rest.md) section 2 |
| USD-margined perpetual `BTCUSD-PERPETUAL` | delisted on 2026-09-04 02:00 UTC | 0 | S9, and `exchangeInfo?symbol=BTCUSD-PERPETUAL` answers 400 `{"code":"-1151","msg":"The trading pair is not open yet"}`, P1 |
| USDC-M or coin-M perpetuals | absent | 0 | Probed, no other `contracts` row, and the fee FAQ says "Perpetual Futures only support trading using USDT", S14 |
| dated futures | absent | 0 | Probed, no row in `exchangeInfo` |
| options | absent | 0 | Probed, `exchangeInfo` field `options` is an empty list |
| spot | yes, not detailed | 31, all quoted in USDT, VIP 0 maker and taker 0.120 % = 1,200 ppm | Probed `symbols`, and S1 |

CoinGecko's derivatives page for "HashKey Global (Futures)" still counted 3 perpetual pairs on 2026-09-23, S17.
The third is `BTCUSD-PERPETUAL`, whose CoinGecko `last_traded` is 1788486827, which is 2026-09-04 01:53:47 UTC, a few minutes before the delisting in S9.
Nine perpetuals were delisted in an emergency on 2026-04-03, among them the four that a notice of 2026-03-27 had scheduled for 2026-04-09, S19.
`BTCUSD-PERPETUAL` followed on 2026-09-04, S9, which leaves the two listed today.
Deposit and withdrawal fees are looked up with `GET /api/v1/coinInfo?coinId=<coin>`, named in the API change log, S22.
CCXT lists that call as private at `hashkey.js` line 227, yet it answered this host with 200 and no key in a `curl` check at 03:43 UTC.
The fiat channel closes to deposits on 2026-09-30, S20.

## 4. Perpetual tiers

The VIP table effective 2025-04-30, page updated 2026-08-20, S1.
A tier is reached by the 30-day spot volume or the 30-day futures volume, whichever qualifies, both in USDT.

| tier | futures maker | futures taker | 30-day futures volume (USDT) | or 30-day spot volume (USDT) |
|---|---|---|---|---|
| VIP 0 | 0.025 % = 250 ppm | 0.060 % = 600 ppm | < 1,000,000 | < 500,000 |
| VIP 1 | 0.020 % = 200 ppm | 0.050 % = 500 ppm | ≥ 1,000,000 | ≥ 500,000 |
| VIP 2 | 0.016 % = 160 ppm | 0.050 % = 500 ppm | ≥ 2,000,000 | ≥ 1,000,000 |
| VIP 3 | 0.014 % = 140 ppm | 0.045 % = 450 ppm | ≥ 8,000,000 | ≥ 4,000,000 |
| VIP 4 | 0.012 % = 120 ppm | 0.040 % = 400 ppm | ≥ 15,000,000 | ≥ 8,000,000 |
| VIP 5 | 0.008 % = 80 ppm | 0.035 % = 350 ppm | ≥ 30,000,000 | ≥ 15,000,000 |
| VIP 6 | 0.004 % = 40 ppm | 0.035 % = 350 ppm | ≥ 50,000,000 | ≥ 30,000,000 |
| VIP 7 | 0.000 % | 0.030 % = 300 ppm | ≥ 100,000,000 | ≥ 50,000,000 |
| VIP 8 | 0.000 % | 0.025 % = 250 ppm | ≥ 200,000,000 | ≥ 100,000,000 |
| VIP 9 | 0.000 % | 0.020 % = 200 ppm | ≥ 400,000,000 | ≥ 200,000,000 |

CCXT's swap tier table has the same VIP 0 row and different rows above it, for example 450 ppm taker from 5,000,000 and 400 ppm from 10,000,000, at `server/node_modules/ccxt/js/src/hashkey.js` lines 306 to 334.
The published S1 table is the one this profile records.
The fee is charged on the notional, price times quantity, in USDT, S14.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | status on 2026-09-22 | evidence |
|---|---|---|---|
| HSK fee deduction, 5 % off | none, "The deduction scope is spot trading" | active, spot only | S5 |
| "USD-margined Perpetual Futures ... Time-limited rate spree", VIP 0 taker 0.0300 % and maker −0.005 % | halved taker, rebated weekly | ended 2026-02-08 23:59 UTC | S4 |
| "Exclusive Full Rebate on Trading Fees", top 20 % of weekly futures traders by volume, up to 500 USDT a week | full rebate for the winners | ended 2026-02-22 23:59 UTC | S3 |
| "Limited-time Futures Rate Spree", VIP 0 taker 0.0300 % and maker −0.005 % | halved taker, rebated weekly | ended 2026-04-30 23:59 UTC | S2 |
| "30% Trading Fee rewards" on the HashKey Exchange App, up to 100 USDT | 30 % reward, and "Trades executed via the former HashKey Global App, Web, or API are not eligible" | ended 2026-07-31 23:59 UTC | S15 |
| market maker programmes | every promotion above excludes market makers, and an announcement titled "HashKey Global Launches New Strategic Market Maker Program" exists | not read | S2, S3, S4, S15, help centre search, 2026-09-23 |
| referral | a Referral Pro programme exists | not read | help centre search, 2026-09-23 |

No promotion that lowers the API taker was running on 2026-09-22 among the announcements read, and the help centre search for "futures", "fee" and "perpetual" returned no newer fee notice.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula | F = P + clamp(I − P, 0.05 %, −0.05 %), with P the average premium index and I the interest rate | Published | S6 |
| interest rate | 0.03 % a day, 0.01 % per 8-hour interval, "can change according to market conditions" | Published | S6 |
| premium index | [max(0, impact bid − price index) − max(0, price index − impact ask)] / price index, impact size 200 USDT of margin over the initial margin rate, measured every minute | Published | S6 |
| cap and floor | ± 0.75 × the maintenance margin rate | Published | S6 |
| cap in numbers | Not publicly specified for BTCUSDT and ETHUSDT. The first risk tier on the wire has `maintMargin` 0.0049, which gives ± 0.3675 %, and the tier notice publishes 0.5 %, which gives ± 0.375 %. The delisted BTCUSD was published at ± 0.375 % | Inference from S6, P1 and S8, and Published for BTCUSD in S7 | |
| interval | every 8 hours, at 00:00, 08:00 and 16:00 UTC | Published | S6, and S18 lists the same three instants in UTC+8 |
| interval on the wire | 100 settled rows per contract from 2026-08-21 00:00 UTC, every gap 8 h, settle hours 0, 8 and 16 UTC | Probed | P1, `historyFundingRate` |
| who pays | a positive rate: longs pay shorts, and a negative rate the reverse, between users, "exchanges do not charge any fees from the funding rate itself" | Published | S6 |
| amount | mark price × number of contracts × rate | Published | S6 |
| when | only a position open at the funding instant pays, with "a 15-second margin of error", so a position opened at 08:00:05 UTC still pays | Published | S6 |
| settled rates, 100 intervals to 2026-09-23 00:00 UTC | BTCUSDT from −0.0000125 to 0.0001, 49 of them exactly 0.0001. ETHUSDT from −0.000461 to 0.0001, 24 of them exactly 0.0001 | Probed | P1 |

A rate of exactly 0.0001 is the interest rate, which the formula returns whenever the premium sits within 0.05 % of it.
The settlement instant itself was not captured, and the numbers above come from the funding history call and the documentation.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| liquidation fee | none named. A position closed better than its bankruptcy price adds the remaining margin to the insurance fund, and a shortfall is taken from it | S13 |
| auto-deleveraging | triggered when the insurance fund reaches a threshold | S13 |
| scheduled delisting | positions settled at the average mark price recorded every 5 seconds over the last 30 minutes, "The settlement process will not incur any additional fees" | S9, S19 |
| emergency delisting on 2026-04-03 | positions settled at the "Moving Average Index Price recorded during the last 30 minutes prior to delisting", no additional fees | S19 |
| margin tiers | tier 1 of BTCUSDT runs to 1,000 USDT notional at 50x with a 2 % initial and 0.5 % maintenance margin, effective 2026-09-01 02:00 UTC, while the same notice says the maximum leverage remains 20x. On the wire the first tier's `maintMargin` is 0.0049 | S8, P1 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, `ccxt.version`, P1 |
| `market.taker` on both swaps without credentials | `0.0006` | Probed, P1, tag `ccxtSwap` |
| `market.maker` | `0.00025` | Probed, P1 |
| where it comes from | `parseMarket` picks the `swap` block of `fees.trading` for a non-spot market and copies its `taker` | `server/node_modules/ccxt/js/src/hashkey.js` lines 1083 and 1105 |
| the constant | `'taker': this.parseNumber('0.00060')` with `'maker': this.parseNumber('0.00025')` | `server/node_modules/ccxt/js/src/hashkey.js` lines 311 and 310 |
| spot for comparison | `0.0012` on `BTC/USDT` | P1, `hashkey.js` line 282 |
| the fee page CCXT names | `https://support.global.hashkey.com/hc/en-us/articles/13199900083612-HashKey-Global-Fee-Structure` | `hashkey.js` line 189. It redirects to a 403 challenge page, and the help centre API answers `{"error":"RecordNotFound"}` for id 13199900083612, so the article is gone. S1 is its current replacement |

The CCXT constant is 600 ppm and equals the published VIP 0 perpetual taker.
The connector compares CCXT's number to `ccxtTakerPpm` or, when that is unset, to the market's own `takerPpm`, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 29 to 31.

## 9. Recommended registry values

```ts
hashkey: {
  takerPpm: 600,
  // ccxt/js/src/hashkey.js:311 sets the swap taker to 0.00060, which equals the published VIP 0 perpetual taker.
}
```

`takerPpm: 600` is the published VIP 0 futures taker, S1.
`ccxtTakerPpm` stays unset, because CCXT's constant already equals 600 and the connector then expects 600.

## 10. Source ledger

Every S row was read through the help centre JSON API named in section 1, and its URL is the article page.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Adjustment of VIP Rate, created 2025-04-22, updated 2026-08-20 | https://help.hashkey.com/hc/en-us/articles/19678434866460-Adjustment-of-VIP-Rate | 2026-09-23 | HashKey Global, HBML | VIP table, entity, excluded regions, sections 1, 2 and 4 |
| S2 | Limited-time Futures Rate Spree, 2026-04-09 | https://help.hashkey.com/hc/en-us/articles/26676806759196-Limited-time-Futures-Rate-Spree-Negative-Maker-Fees-and-Half-Price-Taker-Fees | 2026-09-23 | HashKey Global | standard and promotional futures fees, sections 2 and 5 |
| S3 | Exclusive Full Rebate on Trading Fees for Eligible Users of Futures Trading Services, 2026-01-26 | https://help.hashkey.com/hc/en-us/articles/25074538391196-Exclusive-Full-Rebate-on-Trading-Fees-for-Eligible-Users-of-Futures-Trading-Services | 2026-09-23 | HashKey Global | section 5 |
| S4 | USD-margined Perpetual Futures Trading Service Now Opens to Retail Users, 2026-01-14 | https://help.hashkey.com/hc/en-us/articles/24824274946972-USD-margined-Perpetual-Futures-Trading-Service-Now-Opens-to-Retail-Users-Time-limited-rate-spree | 2026-09-23 | HashKey Global | sections 2 and 5 |
| S5 | Announcement on Using HSK for Trading Fee Deduction | https://help.hashkey.com/hc/en-us/articles/17348959676572-Announcement-on-Using-HSK-for-Trading-Fee-Deduction | 2026-09-23 | HashKey Global | section 5 |
| S6 | Funding Rate Overview, updated 2025-02-19 | https://help.hashkey.com/hc/en-us/articles/14205661959708-Funding-Rate-Overview | 2026-09-23 | HashKey Global | section 6 |
| S7 | HashKey Global Adjusts Funding Rate Cap for BTCUSD Perpetual Futures, 2026-02-07 | https://help.hashkey.com/hc/en-us/articles/25365848852636-HashKey-Global-Adjusts-Funding-Rate-Cap-for-BTCUSD-Perpetual-Futures | 2026-09-23 | HashKey Global | section 6 |
| S8 | HashKey to Adjust Leverage and Margin Tiers for BTCUSDT, ETHUSDT, and BTCUSD Contracts, 2026-08-17 | https://help.hashkey.com/hc/en-us/articles/29636094415516-HashKey-to-Adjust-Leverage-and-Margin-Tiers-for-BTCUSDT-ETHUSDT-and-BTCUSD-Contracts | 2026-09-23 | HashKey Global | sections 6 and 7 |
| S9 | HashKey Global to Delist BTCUSD Perpetual Contract and USD/USDT Spot, 2026-08-20, updated 2026-09-04 | https://help.hashkey.com/hc/en-us/articles/29719555206812-HashKey-Global-to-Delist-BTCUSD-Perpetual-Contract-and-USD-USDT-Spot | 2026-09-23 | HashKey Global | sections 3 and 7 |
| S10 | HashKey Global supported Countries/Regions for Account Opening, updated 2026-08-25 | https://help.hashkey.com/hc/en-us/articles/13086918687004-HashKey-Global-supported-Countries-Regions-for-Account-Opening | 2026-09-23 | HashKey Global | section 1 |
| S11 | Additional Terms Applicable to the Perpetual Futures Products, updated 2025-03-11 | https://help.hashkey.com/hc/en-us/articles/13490602139932-ADDITIONAL-TERMS-APPLICABLE-TO-THE-PERPETUAL-FUTURES-PRODUCTS | 2026-09-23 | HBML | section 1 |
| S12 | Investor Business Terms, updated 2026-09-21 | https://help.hashkey.com/hc/en-us/articles/13000983371036-Investor-Business-Terms | 2026-09-23 | HBML | entity, prohibited jurisdictions clause, section 1 |
| S13 | Forced Liquidation Process (USDT Perpetual Futures) | https://help.hashkey.com/hc/en-us/articles/17827772666140-Forced-Liquidation-Process-USDT-Perpetual-Futures | 2026-09-23 | HashKey Global | section 7 |
| S14 | Fee calculation method | https://help.hashkey.com/hc/en-us/articles/14206130287004-Fee-calculation-method | 2026-09-23 | HashKey Global | USDT only, fee on notional, sections 3 and 4 |
| S15 | Trade on the HashKey Exchange App, Enjoy 30% Trading Fee rewards, 2026-07-16 | https://help.hashkey.com/hc/en-us/articles/28949415859356-Trade-on-the-HashKey-Exchange-App-Enjoy-30-Trading-Fee-rewards | 2026-09-23 | HashKey Global | section 5 |
| S16 | CCXT 4.5.68 `hashkey.js` | `server/node_modules/ccxt/js/src/hashkey.js` | 2026-09-23 | CCXT | sections 4 and 8 |
| S17 | CoinGecko derivatives exchange `hashkey-global-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/hashkey-global-futures?include_tickers=all | 2026-09-23 | CoinGecko | 3 pairs, the stale `BTCUSD-PERPETUAL`, section 3 |
| S18 | Perpetual Futures Overview, updated 2026-08-19 | https://help.hashkey.com/hc/en-us/articles/14205786678684-Perpetual-Futures-Overview | 2026-09-23 | HashKey Global | settlement instants, section 6 |
| S19 | Emergency delisting of 2026-04-03, and Notice of Delisting of 2026-04-09 | https://help.hashkey.com/hc/en-us/articles/26548556077596-Important-Notice-of-Emergency-Delisting-of-Perpetual-Contract-Trading-Pairs-2026-04-03 and https://help.hashkey.com/hc/en-us/articles/26394704187548-Notice-of-Delisting-of-Perpetual-Contract-Trading-Pairs-2026-04-09 | 2026-09-23 | HashKey Global | sections 3 and 7 |
| S20 | Notice on the Suspension and Maintenance of Fiat Services on Global Station, 2026-09-23 | https://help.hashkey.com/hc/en-us/articles/30512719374620-Notice-on-the-Suspension-and-Maintenance-of-Fiat-Services-on-Global-Station | 2026-09-23 | HashKey Global | section 3 |
| S21 | HashKey Exchange Platform Service Upgrade, 2026-06-30 | https://help.hashkey.com/hc/en-us/articles/28558161847324--Important-Notice-HashKey-Exchange-Platform-Service-Upgrade | 2026-09-23 | HashKey Group | section 1 |
| S22 | HashKey Global API change log | https://hashkeyglobal-apidoc.readme.io/reference/change-log | 2026-09-23 | HashKey Global | `coinInfo` call, section 3 |
| P1 | `rest-probe.mjs main`, at 03:12 UTC and in the second pass at 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey/rest-probe.mjs) | 2026-09-23 | this host | CCXT fees, catalog, funding history, sections 3, 6 and 8 |
