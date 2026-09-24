# HashKey Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 01:25 to 01:58 UTC on 2026-09-23, from the development host near Seattle, with a REST recheck after the profiles were written.

This profile covers HashKey Exchange, the Hong Kong platform of Hash Blockchain Limited, which CoinGecko ranks 21st by trust (id `hashkey_exchange`), S1.
HashKey Exchange lists no live perpetual, so this profile is written on its spot market, as the survey plan's template change 1 asks.
Two sister sites answer on the same API host or a neighbouring one, the MENA site and HashKey Global, and they are named in the coverage matrix only.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 | |
| legal entity | Hash Blockchain Limited, trading as HashKey Exchange, licensed by the Hong Kong SFC for Type 1 and Type 7 regulated activities | S1, S7 |
| who may trade spot | retail investors and Professional Investors (PI), corporate and omnibus clients | S7, and the per pair flags below |
| retail pairs | 7 of 38: `AVAXUSD`, `BTCHKD`, `BTCUSD`, `ETHHKD`, `ETHUSD`, `LINKUSD`, `SOLUSD` carry `retailAllowed: true` | P1 |
| PI pairs | 38 of 38 carry `piAllowed: true` | P1 |
| excluded regions | "HashKey Exchange does not provide services to users in Mainland China, the United States, and certain other jurisdictions." | S7 |
| US persons | may not trade, per the sentence above | S7 |
| perpetuals for Hong Kong clients | the SFC framework of 2026-02-11 permits licensed platforms to offer perpetual contracts "only to professional investors" | S8 |
| perpetuals on HashKey Exchange on 2026-09-22 | not launched, see section 3 | P1, S3 |
| age | 18 to 80 for retail account opening | S9 |

The API documentation is written for institutional clients, and production REST or FIX keys are issued through an account manager, S3.
Public market data needs no key, and every public call and socket probed from this host answered, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

Spot at VIP 0, effective 2026-08-01 16:00 UTC+8, S4.

| product | maker | taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|
| spot, all pairs | 0.29 % | 0.29 % | 2,900 | 2,900 |
| spot, paid in HSK | 0.275 % | 0.275 % | 2,750 | 2,750 |
| perpetuals | none live | none live | | |

A minimum fee of USD 1.99 per fully executed order was introduced on 2025-07-30, S5.
At a 0.29 % taker rate it binds on any fully executed order under about USD 686 of notional, which is 1.99 divided by 0.0029.
The live fee page still carries the sentence "The minimum trading fee for a single fully completed spot order is USD", with the amount filled in by script, S6, so the current amount was not read from the page itself.

## 3. Coverage matrix

| product | HashKey Exchange, site HK | evidence |
|---|---|---|
| spot | present, 38 pairs, all `TRADING` | P1, [`rest.md`](./rest.md) section 2 |
| USDT-M perpetuals | absent | P1 |
| USD-margined perpetual | one contract listed, `BBTCUSD-PERPETUAL`, not a live product | P1, P2 |
| USDC-M, coin-M perpetuals | absent | P1 |
| dated futures | absent | P1 |
| options | absent, `options` is an empty list | P1 |
| margin | absent, `allowMargin` false on 38 of 38 pairs | P1 |

The one contract has base asset `BBTC`, underlying `BBTC`, index `BBTC` and margin token `USD`, and it is `TRADING` in the catalog.
Its book was empty on REST and on both sockets, its last three trades were on 2026-01-28, and its 24 h ticker is stamped 2026-02-26, P1, P2.
Its mark price still ticks once a second near the BTC spot price, see [`rest.md`](./rest.md) section 4.
The documentation lists `"fundingFee"` and `"futuresTrade"` fund statement types as "To be released", and names a Futures Account type, S3.
The web site's script carries `isFuturesWhiteList` and a Derivatives menu, S6.
This profile reads the contract as a staging instrument behind a whitelist, not a tradable perpetual, which is an inference from the empty book and the "To be released" labels.

Sister sites, for the record only.

| site | host | spot | perpetuals | relation |
|---|---|---:|---|---|
| MENA | `https://api-pro.hashkey.com` with `site=MENA` | 9, quoted in AED, USD, USDT, USDC | 6 USDT-M: `BTCUSDT-PERPETUAL`, `ETHUSDT-PERPETUAL`, `QQQUSDT-PERPETUAL`, `SOXLUSDT-PERPETUAL`, `SKHYNIXUSDT-PERPETUAL`, `SPCXUSDT-PERPETUAL` | moved from `api-glb.hashkey.com` to `api-pro.hashkey.com` in July 2026, S3 |
| HashKey Global, site `BMU` | `https://api-glb.hashkey.com` | 31, all quoted in USDT | 2 USDT-M: `BTCUSDT-PERPETUAL`, `ETHUSDT-PERPETUAL` | Bermuda, a separate CoinGecko venue, and the target of CCXT's `hashkey` class |

Both are separate venues from the one this profile covers, and neither is researched here.
The MENA perpetuals had live books on REST and on the V2 socket, P1, P2.

Deposit, withdrawal, fiat and earn schedules are on the official fee page, S6.

## 4. Spot tiers

Effective 2026-08-01 16:00 UTC+8, from the table in S4.
The struck values in that table are the rates before the change, and they are not repeated here.

| tier | 30-day spot volume, USD | maker | taker | maker, HSK | taker, HSK |
|---|---|---:|---:|---:|---:|
| VIP 0 | < 50,000 | 0.29 % | 0.29 % | 0.275 % | 0.275 % |
| VIP 1 | ≥ 50,000 | 0.25 % | 0.29 % | 0.237 % | 0.275 % |
| VIP 2 | ≥ 100,000 | 0.20 % | 0.29 % | 0.19 % | 0.275 % |
| VIP 3 | ≥ 1,000,000 | 0.15 % | 0.20 % | 0.142 % | 0.19 % |
| VIP 4 | ≥ 5,000,000 | 0.08 % | 0.15 % | 0.076 % | 0.142 % |
| VIP 5 | ≥ 10,000,000 | 0.05 % | 0.10 % | 0.047 % | 0.095 % |
| VIP 6 | ≥ 50,000,000 | 0.03 % | 0.08 % | 0.028 % | 0.076 % |
| VIP 7 | ≥ 100,000,000 | 0.0 % | 0.05 % | 0.00 % | 0.047 % |

### Qualification

- The tier follows 30-day rolling spot volume in USD, converted at day end, and computed at 00:00 UTC+8 every day, S6.
- Tier changes are applied at 07:00 UTC+8 daily, S6.
- A main account's tier counts the volume of the main account and all its sub-accounts, and sub-accounts inherit it, S6.
- PI clients start at VIP 0 from 2026-08-01, where they started at VIP 1 before, S4.
- The fee is charged at the rate in force when the order fills, S4.
- The fee currency is the quote currency on fiat pairs and security token pairs, and the received currency on crypto to crypto pairs, S10.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| HSK fee payment | 5 % off the rate, spot only, the table's HSK columns. The 2024 notice floors the taker after the HSK discount at 0.015 % | S4, S11 |
| trading rewards seasons | rebates paid after the season, capped at 30 % of the fees a client paid that day, by daily volume. June 2026 paid 5 % to 30 %, and July 2026 paid per USD 100,000 of daily volume | S12, S16 |
| Golden Autumn challenge | 2026-09-15 to 2026-10-31 UTC+8, a prize pool for accounts above USD 200,000 of spot volume per period, Omnibus accounts excluded | S17 |
| market maker program | exists, terms not read | S6, S13 |
| zero fee periods | the VIP program does not apply during a zero fee period, and none was announced on 2026-09-22 in the articles read | S6 |

The rebates are paid after a season and depend on volume, so the VIP 0 taker at the moment of a trade is 0.29 %, or 0.275 % paid in HSK.

## 6. Funding as a cost

Not applicable.
HashKey Exchange publishes no funding rate, and the funding endpoints CCXT's `hashkey` class calls, `/api/v1/futures/fundingRate` and `/api/v1/futures/historyFundingRate`, return HTTP 404 on `api-pro.hashkey.com`, P1.
The settlement instant itself was not captured, because there is no settlement on this venue.

## 7. Liquidation, settlement and delisting

- Minimum fee per fully executed spot order: USD 1.99 since 2025-07-30, with partly executed orders and 0 % fee orders exempt, S5.
  The current amount is filled into the fee page by script, section 2.
- The HSK discount also applies to the minimum fee, S5.
- No liquidation or settlement fee applies to spot.
- Delisting: the bulk `bookTicker` reply still lists 18 pairs that are not in the catalog, each with bid and ask `"0"`, see [`rest.md`](./rest.md) section 2.
  No delisting charge is published.

## 8. CCXT

| item | value |
|---|---|
| CCXT 4.5.68 class for HashKey Exchange | none. `require('ccxt').exchanges` lists 104 ids, and the only HashKey id is `hashkey` |
| what `hashkey` is | "HashKey Global", country `BM`, at `server/node_modules/ccxt/js/src/hashkey.js` lines 22 and 23, with REST host `https://api-glb.hashkey.com` at line 180 |
| CCXT master on GitHub, `ts/src`, read on 2026-09-23 UTC | still only `hashkey.ts`, still `api-glb.hashkey.com` at its line 181, last touched 2026-09-21 |
| `hashkey` spot constant | maker and taker `0.0012` at `hashkey.js` lines 281 and 282, 1,200 ppm |
| `hashkey` swap constant | maker `0.00025` and taker `0.00060` at lines 310 and 311, 600 ppm |
| `market.taker` without credentials, default host | `0.0012` on `BTC/USDT` spot and `0.0006` on the two HashKey Global swaps, P1 |
| `market.taker` with `urls.api` pointed at `api-pro.hashkey.com` | `0.0012` on `BTC/USD`, and `0.0006` on `BBTC/USD:USD`, P1 |

With its URLs overridden, the `hashkey` class loads the HK catalog, since both sites share one API layout: 38 spot markets whose ids equal the catalog symbols, and one swap, `BBTC/USD:USD`, P1.
Its fee constants are HashKey Global's and do not describe HashKey Exchange, whose VIP 0 spot taker is 2,900 ppm.

## 9. Recommended registry values

None.
HashKey Exchange lists no live perpetual, so there is nothing for [`registry.ts`](../../../server/src/venues/registry.ts) to register.
If a later design wanted HK spot through CCXT, the values would be `takerPpm: 2900` from S4, and `ccxtTakerPpm: 1200` for the `hashkey` class pointed at `api-pro.hashkey.com`, the constant at `hashkey.js` line 282.
The registry would also have to keep the connector from loading `BBTCUSD-PERPETUAL` as an active swap, because CCXT marks it `active: true`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinGecko exchange API, `hashkey_exchange` | https://api.coingecko.com/api/v3/exchanges/hashkey_exchange | 2026-09-22 | HashKey Exchange, Hong Kong | trust rank 21, trust score 8, 37 pairs, 800.55 BTC 24 h volume, legal name, licences |
| S2 | CoinGecko exchange list | https://api.coingecko.com/api/v3/exchanges/list | 2026-09-22 | | ids `hashkey_exchange`, `hashkey-global`, `hashkey-global-futures` |
| S3 | HashKey Exchange API reference, monthly reports, change log, fund statement types | https://docs.hashkey.com/hk/en/ | 2026-09-22 | HashKey Exchange | MENA consolidation in July 2026, "To be released" futures types, key issuance, sections 1 and 3 |
| S4 | Announcement on HashKey Exchange Trading Fee Structure and Fee Adjustment, 2026-07-20, and its table image | https://support.hashkey.com/hc/en-gb/articles/60221273702809-Announcement-on-HashKey-Exchange-Trading-Fee-Structure-and-Fee-Adjustment | 2026-09-22 | HashKey Exchange | the tier table, PI start at VIP 0, sections 2 and 4 |
| S5 | Notice on Adjustment of Trading Fee on HashKey Exchange, 2025-07-23, updated 2026-06-20 | https://support.hashkey.com/hc/en-gb/articles/49134161022745 | 2026-09-22 | HashKey Exchange | USD 1.99 minimum fee, sections 2 and 7 |
| S6 | HashKey Exchange VIP Tier page | https://www.hashkey.com/en-US/user/fee-rate | 2026-09-22 | HashKey Exchange | qualification rules, HSK terms, minimum fee sentence, Derivatives menu, `isFuturesWhiteList` in the page script |
| S7 | HashKey Exchange Launches New Flagship Crypto Trading App, 2026-07-27 | https://group.hashkey.com/en/newsroom/hashkey-exchange-launches-new-flagship-crypto-trading-app | 2026-09-22 | HashKey Group | excluded regions, retail and PI clients |
| S8 | Hong Kong expands crypto rules to allow margin financing and perpetual contracts, The Block, 2026-02-11 | https://www.theblock.co/post/389377/hong-kong-expands-crypto-rules | 2026-09-22 | Hong Kong SFC | perpetuals for professional investors only |
| S9 | Guidance of account opening for retail customers in HashKey Exchange Hong Kong | https://support.hashkey.com/hc/en-gb/articles/39954789987225 | 2026-09-22 | HashKey Exchange | age 18 to 80 |
| S10 | HashKey Exchange Trading Fee Mechanism, updated 2026-08-13 | https://support.hashkey.com/hc/en-gb/articles/20690154339609-HashKey-Exchange-Trading-Fee-Mechanism | 2026-09-22 | HashKey Exchange | fee currency |
| S11 | Announcement on Using HSK for Trading Fee Deduction, 2024-11-18 | https://support.hashkey.com/hc/en-gb/articles/40140391759513 | 2026-09-22 | HashKey Exchange | 5 % discount, 0.015 % taker floor |
| S12 | June Trading Rewards Season, 2026-06-07 | https://support.hashkey.com/hc/en-gb/articles/58713431775257 | 2026-09-22 | HashKey Exchange | rebate tiers and dates |
| S13 | Announcement of HashKey Exchange Market Maker Program | https://support.hashkey.com/hc/en-gb/articles/26032230422681 | 2026-09-22 | HashKey Exchange | market maker program exists |
| S14 | CCXT 4.5.68 `hashkey.js` | `server/node_modules/ccxt/js/src/hashkey.js` | 2026-09-22 | CCXT | section 8 |
| S15 | CCXT master `ts/src/hashkey.ts` and the `ts/src` listing | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 UTC | CCXT | section 8 |
| S16 | July Spot Trading Rewards Season, 2026-06-30 | https://support.hashkey.com/hc/en-gb/articles/59523139904153 | 2026-09-22 | HashKey Exchange | 30 % daily cap, reward per USD 100,000 |
| S17 | Golden Autumn Spot Advanced Trading Rewards, 2026-09-14 | https://support.hashkey.com/hc/en-gb/articles/62234508020633 | 2026-09-22 | HashKey Exchange | dates, eligibility |
| P1 | `rest-probe.mjs main`, runs at 01:33 and 01:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/rest-probe.mjs) | 2026-09-23 UTC | this host | catalogs, CCXT loads, 404s, contract state |
| P2 | `ws-probe.mjs book`, runs at 01:36 and 01:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | empty contract book, live MENA book |
