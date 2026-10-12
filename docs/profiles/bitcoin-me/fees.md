# Bitcoin.me Fees Profile

**Status:** Done.
Bitcoin.me lists no perpetuals, and its order book exchange has not traded since 2026-02-11, so the venue is profiled on its spot market as a defunct one.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:53 to 05:06 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the trading fees of Bitcoin.me, the exchange that CoinMarketCap ranks at 234 under its old slug `klever-exchange`, with the notice "Klever Exchange has rebranded as Bitcoin.me", S11.
The brand now runs two things.
The legacy order book exchange (CEX) lives at `cex.bitcoin.me` and is linked from the home page as "CEX (legacy)", S7.
A KleverChain AMM DEX lives at `bitcoin.me`, S8, and it is what CoinMarketCap and CoinGecko track today, S11 and S12.
Every probed number comes from [`fees-probe.py`](../../../scripts/probes/venues/bitcoin-me/fees-probe.py), P1, or [`rest-probe.py`](../../../scripts/probes/venues/bitcoin-me/rest-probe.py), P2.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-10-09 | all sources |
| legal entity | Not publicly specified in anything read, the bundle and CoinMarketCap name only "Bitcoin.me" and "Klever" | S1, S11 |
| who may trade perpetuals | nobody, the venue offers none | S1 |
| products | crypto-to-crypto spot on the legacy CEX, and AMM swaps on the DEX | S1, S8 |
| regions excluded | Not publicly specified in anything read | none |
| state of the CEX | no trade on any of its 28 pairs after 2026-02-11 13:18 UTC, and its documented public API answers 503 | P2, [`rest.md`](./rest.md) section 2 |

The Terms of Use in the CEX bundle say: "Bitcoin.me is a platform for Crypto-to-Crypto spot trading and does not contain at the moment capabilities to provide Futures, Leverage, or other non-crypto-to-crypto trading", S1.
The same bundle's fee page carries two template lines about a "futures market", S2.
The 777,884 byte main bundle matches "futures" three times, the Terms sentence and those two lines, and matches "perpetual" and "funding" zero times, P1.
Its 10 matches of "contract" are legal text, NFT collection fields and explorer links, and its 2 matches of "leverage" are the Terms sentence and a game description.
So the two fee page lines are read as leftover copy and not as evidence of a futures product.

## 2. Quick answer

There is no perpetual family, so the quick answer is the spot fee of the legacy CEX.

| market | maker | taker | maker ppm | taker ppm | label |
|---|---|---|---|---|---|
| CEX spot, Regular level, fee paid in the traded asset | 0.10 % | 0.20 % | 1,000 | 2,000 | Published, S2 |
| CEX spot, Regular level, fee paid in KLV | 0.075 % | 0.15 % | 750 | 1,500 | Published, S2 |
| DEX swaps | Not publicly specified | Not publicly specified | none | none | the API and docs carry no fee rate, S9 |

The CEX numbers describe a market that no longer trades, see section 1.

## 3. Coverage matrix

| product | present | how established |
|---|---|---|
| USDT-M perpetuals | absent | Terms of Use, S1, and no contract call in the bundle, P1 |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | same |
| spot, legacy CEX | present on paper, not trading | 28 pairs in the catalog, last trade 2026-02-11, P2 |
| spot, KleverChain AMM DEX | present | 48 pools, all quoted in KLV, about USD 161,000 of liquidity, P2 |

## 4. Spot tiers

The VIP table comes from the manager API the CEX web app calls, `GET https://manager.exchange.klever.io/v1/get-vip-level-table`, S2.
Rates are fractions in the reply, shown here in ppm.
The level is set by KLV holding, and the fee page says the level and rates are updated daily at 02:00 UTC, S2.

| level | KLV holding | maker ppm | taker ppm | maker ppm paid in KLV | taker ppm paid in KLV |
|---|---|---|---|---|---|
| Regular | 0 | 1,000 | 2,000 | 750 | 1,500 |
| Vip 0 | 200,000 | 900 | 2,000 | 680 | 1,500 |
| Vip 1 | 400,000 | 700 | 2,000 | 530 | 1,500 |
| Vip 2 | 800,000 | 500 | 2,000 | 380 | 1,500 |
| Vip 3 | 2,000,000 | 300 | 2,000 | 230 | 500 |
| Vip 4 | 4,000,000 | no field | 2,000 | no field | 500 |
| Vip 5 | 8,000,000 | no field | 2,000 | no field | 500 |
| Vip 6 | 20,000,000 | no field | 2,000 | no field | 500 |
| Vip 7 | 40,000,000 | no field | 2,000 | no field | 500 |
| Vip 8 | 60,000,000 | no field | 2,000 | no field | 500 |
| Vip 9 | 120,000,000 | no field | 2,000 | no field | 500 |
| Vip 10 | 200,000,000 | no field | 2,000 | no field | 500 |

From Vip 4 up the reply omits both maker fields, P1.
That most likely means a zero maker fee, since protobuf JSON drops zero values, but the venue does not say so.
The taker paid in the traded asset stays at 2,000 ppm on every level.

The "Regular" row is the base retail tier, so the CEX's VIP 0 in the sense of this survey is 1,000 ppm maker and 2,000 ppm taker.
The venue's own "Vip 0" is a holding tier above it.
Every catalog pair carries `"TradingFee": 1`, P2, which reads as a fee class index and not as a rate.

## 5. Discounts

- Paying the fee in KLV cuts the Regular taker from 2,000 to 1,500 ppm and the maker from 1,000 to 750 ppm, S2.
- Holding KLV raises the VIP level, section 4.
- The bundle holds one call to `v1/set-trade-fee-klv?key=`, the switch for KLV payment, so it is a per account setting, P1.
- No referral rate, market maker programme or zero fee promotion was found in the bundle or the docs.

## 6. Funding as a cost

Not offered.
The venue lists no perpetuals, S1.

## 7. Liquidation, settlement and delisting charges

Not offered for liquidation and settlement, since there is no leveraged product, S1.
No delisting charge is published.
Deposit and withdrawal fees per network are in `GET https://manager.exchange.klever.io/v1/tokens?Currency=USD`, as `WithdrawFee` per network, and are not recorded here.

## 8. CCXT

CCXT 4.5.68 has no class for Bitcoin.me or Klever.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` is named for either, and the only mention of Klever is a commented currency alias at [`kucoin.js`](../../../node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/kucoin.js) line 1321, `// 'KLEVER': 'klv',`.
The current CCXT source on GitHub has no class either: the `js/src` listing of master at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`, 2026-10-08, holds 213 entries and none matches `klever`, `bitcoin` or `btcme`, S13.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The venue has no perpetual, and its order book market stopped trading on 2026-02-11, so it should not enter the registry.
If a spot leg were ever built and the CEX reopened, `takerPpm` would be 2,000 from the Regular level of S2, and `ccxtTakerPpm` would stay unset because CCXT has no class.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Terms of Use string `subtitle_line6` in the CEX web bundle | https://cex.bitcoin.me/static/js/main.3ee5ce88.js | 2026-10-09 | Bitcoin.me | spot only, no futures or leverage |
| S2 | VIP table and fee page strings `list_2` to `list_4` | https://manager.exchange.klever.io/v1/get-vip-level-table and the bundle of S1 | 2026-10-09 | Bitcoin.me, Klever infrastructure | spot tiers, KLV payment rates, daily update at 02:00 UTC |
| S3 | Bitcoin.me Documentation, Introduction | https://docs.bitcoin.me/docs/intro/ | 2026-10-09 | Bitcoin.me | API URL `https://api.exchange.bitcoin.me/` |
| S7 | Bitcoin.me DeFi home page | https://bitcoin.me/ | 2026-10-09 | Bitcoin.me | "CEX (legacy)" link to `cex.bitcoin.me` |
| S8 | Bitcoin.me DeFi Documentation, Introduction | https://docs.defi.bitcoin.me/ | 2026-10-09 | Bitcoin.me, KleverChain | the DEX is an AMM on KleverChain |
| S9 | Bitcoin.me DeFi API reference and its OpenAPI file | https://docs.defi.bitcoin.me/api/ and https://docs.defi.bitcoin.me/redocusaurus/api.yaml | 2026-10-09 | Bitcoin.me | DEX REST API at `https://api.bitcoin.me`, pool `fees` field without a rate |
| S11 | CoinMarketCap exchange page | https://coinmarketcap.com/exchanges/klever-exchange/ | 2026-10-09 | CoinMarketCap | id 1524, rebrand notice, category spot, 6 pairs linking to `bitcoin.me/en/trade/` |
| S12 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/bitcoin-me | 2026-10-09 | CoinGecko | `centralized` false, one KFI/KLV ticker |
| S13 | CCXT `js/src` listing on master | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/js/src | 2026-10-09 | CCXT | no Bitcoin.me or Klever class |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/bitcoin-me/fees-probe.py) | local | 2026-10-09 | probe | VIP table, bundle strings and term counts, CoinMarketCap and CoinGecko records |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/bitcoin-me/rest-probe.py) | local | 2026-10-09 | probe | catalog, last trade per pair, DEX pools |

Ids S4 to S6 and S14 are used by [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).
