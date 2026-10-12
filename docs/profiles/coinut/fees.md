# Coinut Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:42 to 05:06 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers Coinut, the Singapore venue at `coinut.com`, which CCXT does not implement.
Coinut lists no perpetuals, so it is profiled on its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The spot exchange is no longer a product on the website.
Coinut now sells payments, OTC, on and off ramp and a custodial wallet, and its legacy exchange API still answers with a frozen spot book, see section 1.
The probes are [`fees-probe.py`](../../../scripts/probes/venues/coinut/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/coinut/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/coinut/ws-probe.py).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-10-09 | |
| entities | Coinut Pte. Ltd. (Singapore, registration 201332271K), Coinut Canada Ltd. (Markham, Ontario), Coinut Switzerland AG (Zug) and Coinut USA Inc. (Dover, Delaware), from the home page footer | S9 |
| who may use the services | the Terms of Services, updated 2026-03-25, say Coinut Pte. Ltd. provides its services "only for Singapore citizens, Singapore permanent residents or those residing and domiciled in Singapore" | S3, P3 |
| excluded regions | United States residents, by clause, with account suspension for one found behind a VPN. Everyone outside Singapore, by the scope sentence above | S3, P3 |
| licence | the Terms say Coinut Pte. Ltd. is exempted by the Monetary Authority of Singapore from holding a licence for e-money issuance and for digital payment token services | S3, P3 |
| current products | COINUT Payment, COINUT OTC, COINUT Ramp, COINUT Swap and the Wrapped Litecoin token WLTC, from the home page. The mobile app is "COINUT Digital Assets Wallet", a custodial wallet for "storing, holding, transferring, converting, on-ramping, off-ramping" | S9, S10, P1 |
| exchange | the old exchange pages are gone. `coinut.com/spot/BTCUSDT/` and `coinut.com/trade/` answer 302 to `/404`. The only web bundle, `umi.4429ef99.js`, holds no `wss://` URL, no `inst_` request and no mention of `api.coinut.com`, and its routes are a payments dashboard | P1 |
| legacy API | `api.coinut.com` and `wsapi.coinut.com` both answer, with 26 spot instruments. The newest trade on any of them is 2026-02-04 23:54:48 UTC, and 20 of 26 had no trade in the last 365 days | P1 |
| CoinMarketCap standing | rank 222 in the survey list. Its data API gives status `active`, 25 spot pairs with a summed `volumeUsd` of 18,326.02 and 18,331.12 in two reads, 0 perpetual pairs, and maker and taker fees of 0.0 | S6, S7, P3 |
| CoinGecko standing | `exchanges/coinut` answers 404 "exchange not found", and the derivatives exchange list does not name Coinut | P3 |

CoinMarketCap's USDT pair prices track Coinut's frozen `last` fields, P1 and P3.
Its BTC/USDT price is 110,924.11 against a `last` of 111,024.84 USDT, ETH/USDT is 1,998.19 against 2,000, and LTC/USDT is 119.89 against 120.
No instrument traded in the day before the probe, so the roughly 18,330 USD of daily volume CoinMarketCap shows does not describe live trading.
The access results in every file of this profile are what the Canadian VPN exit received.
Nothing on the API hosts was refused from that exit, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| perpetuals | absent | absent | section 3 |
| spot, crypto against crypto, Normal tier | Free, 0 ppm | 0.1 %, 1,000 ppm | S2, P3 |
| spot, crypto against USD or XSGD, Normal tier | 0.45 %, 4,500 ppm | 0.50 %, 5,000 ppm | S2, P3 |

The fee page names two tables, "Pure Crypto Trading" and one for crypto against USD and XSGD, S2.
It does not say which table the CAD and XIDR pairs use, and it does not say whether USDT counts as crypto.
USDT is not named in the fiat table, so the USDT pairs read as crypto pairs at 1,000 ppm, and that reading is not confirmed.
The USD pairs the second table names were delisted on 2023-03-24, S4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | `inst_list` accepts `sec_type` `SPOT`, `OPTION` and `FUTURE`, and rejects `FUTURES`, `SWAP`, `PERPETUAL` and `MARGIN` with `JSON_VALIDATION_FAILED`. CoinMarketCap's perpetual pair count is 0, P1 and P3 |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | `inst_list` with `sec_type` `FUTURE` answers `OK` with no instrument key, P1 |
| options | absent | `inst_list` with `sec_type` `OPTION` answers `OK` with no instrument key, P1 |
| spot | present on the legacy API, dormant | 26 instruments, quoted in BTC 5, LTC 4, USDT 6, XSGD 6, CAD 4 and XIDR 1, with no trade since 2026-02-04 and no book change seen, P1 and P2 |

## 4. Spot tiers

The tier is set by 30 day trading volume in USD, and a change of level takes 24 hours to apply, S2.

| level | 30 day volume in USD | crypto pairs taker | crypto pairs maker | USD and XSGD pairs taker | USD and XSGD pairs maker |
|---|---|---|---|---|---|
| Normal | 0 or more | 0.1 % | Free | 0.50 % | 0.45 % |
| VIP 1 | 10,000 or more | 0.1 % | Free | 0.45 % | 0.40 % |
| VIP 2 | 100,000 or more | 0.1 % | Free | 0.40 % | 0.35 % |
| VIP 3 | 500,000 or more | 0.1 % | Free | 0.35 % | 0.30 % |
| VIP 4 | 2,000,000 or more | 0.1 % | Free | 0.30 % | Free |

The article was created on 2018-03-01 and last updated on 2024-10-16, S2 and P3.
WLTC minting and redeeming cost 0.3 % each, S2.

## 5. Discounts that change the taker

"Designated market makers will be fixed at level VIP 4", by contacting `support@coinut.com`, S2.
That leaves the crypto pair taker at 0.1 %, because every level pays 0.1 % there.
No token discount, referral rebate or zero fee promotion is published on the fee page, S2.

## 6. Funding as a cost

Not offered.
Coinut lists no perpetual, see section 3.

## 7. Liquidation, settlement and delisting

There is no margin or derivative product, so there is no liquidation or settlement charge.
The 2023 delisting of the USD pairs gave seven days of notice and named no charge, S4.
Withdrawal fees are on a separate help center page that the fee article links, and they are not recorded here.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` | 104 class files, none named `coinut`, P3 |
| CCXT master `exchanges.json` on 2026-10-10 UTC | no id matching `coinut`, S8 and P3 |
| CCXT master `ts/src/coinut.ts` | answers 404, S8 and P3 |

So there is no `market.taker` to read, and no CCXT source line exists.

## 9. Recommended registry values

None.
Coinut has no perpetual to register and no CCXT class for a catalog, and its spot market has not traded since 2026-02-04, see [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).
If a spot leg on this book were ever wanted, `takerPpm` would be 1,000 for crypto pairs, and `ccxtTakerPpm` has nothing to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coinut API wiki, Home | https://github.com/coinut/api/wiki | 2026-10-09 | Coinut | REST and WebSocket endpoints, public requests, `top_n` values, heartbeat, nonce range, sections in [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md) |
| S2 | Trading fees, help center article 360001416133, updated 2024-10-16 | https://help.coinut.com/api/v2/help_center/en-us/articles/360001416133.json | 2026-10-10 UTC | Coinut | tiers, both tables, designated market makers, WLTC fees, sections 2, 4 and 5 |
| S3 | Terms of Services, help center article 115008686648, updated 2026-03-25 | https://help.coinut.com/api/v2/help_center/en-us/articles/115008686648.json | 2026-10-10 UTC | Coinut Pte. Ltd., Singapore | entity, Singapore only scope, US exclusion, MAS exemption, section 1 |
| S4 | USD denominated trading pairs delisting from Coinut, article 16615432928153 | https://help.coinut.com/api/v2/help_center/en-us/articles/16615432928153.json | 2026-10-10 UTC | Coinut | BTCUSD, LTCUSD, ETHUSD, ZECUSD and USDTUSD ceased on 2023-03-24 at 23:59 SGT, sections 2 and 7 |
| S5 | Can I trade through API?, article 360005115273, updated 2024-03-19 | https://help.coinut.com/api/v2/help_center/en-us/articles/360005115273.json | 2026-10-10 UTC | Coinut | REST and WebSocket supported, links the wiki S1 |
| S6 | CoinMarketCap data API, exchange detail | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinut | 2026-10-10 UTC | CoinMarketCap | status, fee link, fees 0.0, section 1 |
| S7 | CoinMarketCap data API, market pairs | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinut&category=spot&start=1&limit=50 | 2026-10-10 UTC | CoinMarketCap | 25 spot pairs and their volumes, 0 perpetual pairs, sections 1 and 3 |
| S8 | CCXT master id list and sources | https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json | 2026-10-10 UTC | CCXT | no Coinut class, section 8 |
| S9 | Coinut home page and web bundle | https://coinut.com/ | 2026-10-10 UTC | Coinut | entities, current products, no exchange client, section 1 |
| S10 | App Store lookup for app 1331328939 | https://itunes.apple.com/lookup?id=1331328939&country=sg | 2026-10-10 UTC | Apple, Singapore store | the app is a custodial wallet, released 2026-09-18, section 1 |
| P1 | `rest-probe.py`, 04:45 to 04:47 and 04:56 to 04:58 UTC on 2026-10-10, rerun in the second pass at 05:03 to 05:05 UTC | [`rest-probe.py`](../../../scripts/probes/venues/coinut/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | catalog, sec_type checks, last trades, website paths, web bundle, sections 1 and 3 |
| P2 | `ws-probe.py`, 04:47 to 04:55 UTC on 2026-10-10, rerun in the second pass at 05:01 to 05:03 UTC | [`ws-probe.py`](../../../scripts/probes/venues/coinut/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | no book change in 120 s on 26 instruments, section 3 |
| P3 | `fees-probe.py`, 04:58 to 05:00 UTC on 2026-10-10, rerun in the second pass at 05:05 UTC | [`fees-probe.py`](../../../scripts/probes/venues/coinut/fees-probe.py) | 2026-10-09 | this host, Canadian VPN exit | fee article text and parsed rows, Terms clauses, CCXT, CoinGecko and CoinMarketCap checks, sections 1 to 4 and 8 |
