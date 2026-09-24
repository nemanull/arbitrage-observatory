# Blockchain.com Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:23 to 04:39 UTC, and the second pass at 04:44 to 04:52 UTC, from the development host near Seattle through the Surfshark WireGuard exit that geolocates to Canada.

Blockchain.com Exchange (CCXT id `blockchaincom`) is the spot order book behind `api.blockchain.com/v3/exchange` and `wss://ws.blockchain.info/mercury-gateway/v1/ws`.
It lists no perpetual, so this profile covers its spot market, as template change 1 of the survey plan asks, and names every other product in the coverage matrix.
Blockchain.com's own help center says trading on the Exchange was suspended on 19 October 2025, and the probes below found a public API that still answers but carries almost no market, see section 1.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/blockchaincom/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| CoinGecko listing | "Blockchain.com", country United Kingdom, established 2012, trust score 5, trust score rank 102, 4 tickers, 0.2806 BTC of 24 h volume, bid and ask spread 1.98 to 2.03 % on every ticker | Probed | S7. The survey list gave rank 99 on the same day |
| CoinGecko derivatives list | no entry matching "Blockchain" | Probed | S8 |
| operating entity | by residence: EEA and Switzerland, and the rest of the world, Blockchain.com Operations (Malta) Limited. US, Blockchain.com, Inc. UK, Blockchain.com Operations (UK) Limited. Nigeria, BC Access (Nigeria) Limited. Ghana, BC Access (Ghana) Limited. A list of 35 "IM countries", Blue Cube Access (Global) Limited | Documented | S2, the entity table of the User Agreement, last updated 27 August 2026 |
| Exchange terms | section 9 "Exchange" of the same agreement, provided "exclusively by the Blockchain.com entity outlined above", and "Exchange may not be available in all markets and jurisdictions" | Documented | S2 |
| trading status | "Trading on the Blockchain.com Exchange will be suspended on October 19th. You will lose the ability to trade on that platform." The FAQ asks Exchange users to move funds to the Trading Account inside the Blockchain.com app | Documented | S3, created 2025-09-18, edited 2026-09-18 |
| trading on the wire | the REST tickers still showed 8 of 194 symbols with 24 h volume, and the BTC-USD `volume_24h` rose from 0.12205461 to 0.13035325 between 04:28 and 04:31 UTC, so something still matches on the REST side. The socket's l2 books did not change once in 45 s on 60 symbols | Probed | P1, P2, P4, and [`rest.md`](./rest.md) section 5 |
| excluded regions | "Restricted Locations", defined as any country sanctioned by OFAC, the UN, the EU or an EU member state, or HM Treasury | Documented | S2 section 15.1 and the definitions |
| Canada | a banner on the Legal Center says "Blockchain.com is pausing the availability of custodial and exchange services to customers residing in Canada." | Documented | S2 |
| US persons | the agreement names Blockchain.com, Inc. as the US entity, and no page read states whether the Exchange order book itself was ever offered to US residents | Not publicly specified | S2 |
| access from this host | REST 200 on every public call, Cloudflare edge SEA. WebSocket 101 once the documented `Origin` header is sent, Cloudflare edge YVR or SEA. All results are from the Canadian VPN exit | Probed | P1, P4 |
| fee page | `https://exchange.blockchain.com/fees` answered 404 to curl from this host and 403 to a web fetch that does not originate here, so the schedule below is the last archived copy | Probed | S1 |

## 2. Quick answer

| product | maker | taker | evidence |
|---|---|---|---|
| spot, tier 1, 30 day volume under 10,000 USD | 0.40 %, 4,000 ppm | 0.45 %, 4,500 ppm | S1, and CCXT `server/node_modules/ccxt/js/src/blockchaincom.js` lines 143 and 157 |
| perpetuals | none listed | none listed | section 3 |

The live page is gone, so these are the last published numbers, archived on 2025-11-16, four weeks after the documented trading suspension.
CCXT 4.5.68 carries the same twelve tiers, see section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes: 194 symbols, 60 `open` and 134 `close`, the open ones 12 bases across USD, EUR, GBP, USDC and USDT, 12 each | P1, [`rest.md`](./rest.md) section 2 |
| spot margin | named: the socket's `symbols` snapshot for BTC-USD carries `"margin_enabled": true` and `"leverage_ratio": [2.0, 3.0, 4.0, 5.0]`, and the archived fee page lists a margin trading fee of 0.02 % and a recurring fee of 0.02 % per 4 h | P3, S1 |
| perpetual swaps on the Exchange | absent: no symbol matches `PERP`, `SWAP` or `FUT`, every CCXT market is `spot`, and CCXT declares `'swap': false` | P1, CCXT `blockchaincom.js` line 31 |
| perpetuals in the Blockchain.com app | a Perps tab that settles in USDC, where "Trading happens within Hyperliquid", reached through a non-custodial "Perpetuals Software" provided by Blockchain.com Labs Limited. It is not a Blockchain.com order book, so it is out of scope here | S4, S5, S2 |
| dated futures | absent, CCXT line 32 | CCXT |
| options | absent, CCXT line 33 | CCXT |
| deposit and withdrawal fees | not detailed here. The official lookup is the help center article "Deposit and Withdrawal Fees (Crypto)" | S6 |

## 4. Spot tiers

The archived page titles the table "Spot Trading Fees" and qualifies each tier by "Volume in 30 Days" in US dollars, S1.

| tier | 30 day volume, USD | maker | taker |
|---:|---|---:|---:|
| 1 | 0 to 9,999.99 | 0.40 % | 0.45 % |
| 2 | 10,000 to 49,999.99 | 0.17 % | 0.35 % |
| 3 | 50,000 to 99,999.99 | 0.15 % | 0.18 % |
| 4 | 100,000 to 499,999.99 | 0.08 % | 0.18 % |
| 5 | 500,000 to 999,999.99 | 0.07 % | 0.18 % |
| 6 | 1,000,000 to 2,499,999.99 | 0.06 % | 0.18 % |
| 7 | 2,500,000 to 4,999,999.99 | 0.05 % | 0.18 % |
| 8 | 5,000,000 to 24,999,999.99 | 0.04 % | 0.16 % |
| 9 | 25,000,000 to 99,999,999.99 | 0.03 % | 0.14 % |
| 10 | 100,000,000 to 499,999,999.99 | 0.02 % | 0.11 % |
| 11 | 500,000,000 to 999,999,999.99 | 0.01 % | 0.08 % |
| 12 | 1,000,000,000 and above | 0.00 % | 0.06 % |

CCXT 4.5.68 lists the same thresholds and rates as `tiers.taker` and `tiers.maker` at `server/node_modules/ccxt/js/src/blockchaincom.js` lines 142 to 169, with `'tierBased': true` at line 139.
The private `GET /fees` call returns a `makerRate`, `takerRate` and `volumeInUSD` per account, S9, and it was not called.

## 5. Discounts that change the spot taker

| discount | value | evidence |
|---|---|---|
| market maker | "If you are a market maker and you expect to be trading higher volumes than those specified in our rate card, please contact for a customized fee arrangement." | S1 |
| token holding, referral, zero fee promotion | none named on the archived page | S1 |

## 6. Funding as a cost

Spot carries no funding.
The only periodic charge named is the margin recurring fee of 0.02 % per 4 h on the archived page, S1, which a spot taker cross does not pay.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
134 of the 194 symbols have `status` `close`, and their REST tickers read 0 for price and volume, P1.
The REST book of a closed symbol is empty with HTTP 200, and the socket acknowledges it and sends an empty snapshot, see [`websocket.md`](./websocket.md) section 4.
The whole Exchange was documented as suspended for trading from 19 October 2025, S3.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| class | `blockchaincom`, spot only, `'swap': false`, `'future': false`, `'option': false` | `server/node_modules/ccxt/js/src/blockchaincom.js` lines 20 and 29 to 33 |
| `market.taker` without credentials | `undefined` on all 194 markets, and `market.maker` too | P1 `catalog` |
| why | `fees.trading` at lines 136 to 171 holds only `tiers` and no flat `taker`, `fetchMarkets` at lines 306 to 425 sets no fee, and the base default `taker: undefined` at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 2370 to 2375 is what the market merge at line 3735 copies in | CCXT |
| tier 1 in the tier list | taker `[0, 0.0045]`, maker `[0, 0.004]` | P1, lines 143 and 157 |
| test URL | `urls.test` points at `https://testnet-api.delta.exchange`, another venue's testnet, and is unused here | lines 84 to 87 |

## 9. Recommended registry values

No registry entry is recommended, because the engine takes only active swaps from CCXT, at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 79 and the `isActiveSwapMarket` filter at line 196, and this venue has none.
Were a spot leg ever modelled, `takerPpm` would be 4,500 from section 2, and `ccxtTakerPpm` would stay unset, since CCXT reports no number for it to expect.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Blockchain.com Exchange fees page, Wayback Machine capture of 2025-11-16 11:11 UTC | https://web.archive.org/web/20251116111124/https://exchange.blockchain.com/fees | 2026-09-22 | Blockchain.com Exchange | spot tiers, margin fees, market maker note, sections 2 to 6. The live URL answered 404 to curl and 403 to a web fetch |
| S2 | Blockchain.com User Agreement, last updated 27 August 2026 | https://www.blockchain.com/legal/terms | 2026-09-22 | all Blockchain.com entities | entity table, section 9 Exchange, Restricted Locations, Canada banner, Perpetuals Software, sections 1 and 3 |
| S3 | How to Migrate Your Funds from the Exchange to Your Wallet, help center article 22422379791516 | https://support.blockchain.com/hc/en-us/articles/22422379791516-How-to-Migrate-Your-Funds-from-the-Exchange-to-Your-Wallet | 2026-09-22 | Blockchain.com | trading suspension on 19 October 2025, sections 1 and 7 |
| S4 | How to start trading Perpetual Futures, help center article 26444985603740 | https://support.blockchain.com/hc/en-us/articles/26444985603740-How-to-start-trading-Perpetual-Futures | 2026-09-22 | Blockchain.com app | Perps tab, USDC settlement, section 3 |
| S5 | Why do I need to approve tokens and pay gas fees when depositing to Perps?, help center article 26671951970716 | https://support.blockchain.com/hc/en-us/articles/26671951970716 | 2026-09-22 | Blockchain.com app | "Trading happens within Hyperliquid", section 3 |
| S6 | Deposit and Withdrawal Fees (Crypto), help center article 7900178385820 | https://support.blockchain.com/hc/en-us/articles/7900178385820-Deposit-and-Withdrawal-Fees-Crypto | 2026-09-22 | Blockchain.com | official lookup, section 3 |
| S7 | CoinGecko exchange API, `blockchain_com` | https://api.coingecko.com/api/v3/exchanges/blockchain_com | 2026-09-22 | CoinGecko | listing context, section 1 |
| S8 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | no derivatives entry, section 1 |
| S9 | Blockchain.com Exchange REST API reference | https://api.blockchain.com/v3/ | 2026-09-22 | Blockchain.com Exchange | private `GET /fees` fields, section 4 |
| S10 | CCXT 4.5.68 `blockchaincom.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/blockchaincom.js` | 2026-09-22 | CCXT | tiers, market type, fee defaults, section 8 |
| P1 | `rest-probe.mjs catalog`, 04:28 UTC, and the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/blockchaincom/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog counts, CCXT `market.taker`, sections 1, 3, 7 and 8 |
| P2 | `rest-probe.mjs books`, `poll` and `errors`, 04:28 to 04:31 UTC, and the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/blockchaincom/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | volume change, section 1 |
| P3 | `ws-probe.mjs book`, 04:33 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `symbols` snapshot with margin fields, section 3 |
| P4 | `ws-probe.mjs origin` and `batch`, 04:33 and 04:35 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | access, 60 static books, section 1 |
