# B2Z Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:39 to 05:50 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

B2Z Exchange runs on the BTSE white-label platform.
Its API host `api.b2z.exchange` serves BTSE's paths, and its perpetual books, index, mark, funding and open interest are BTSE's own, see [`rest.md`](./rest.md) section 2 and [`websocket.md`](./websocket.md) section 4.
Only the fee table, the region rules and the brand differ from BTSE.
The VIP 0 futures taker is 0.05 % = 500 ppm, against BTSE's 550 ppm on the same book.
Fee and access numbers come from [`fees-probe.py`](../../../scripts/probes/venues/b2z/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 US Pacific for every source row | | source ledger |
| operator | "B2Z BVI, incorporated in the British Virgin Islands, offers multi-currency digital assets exchange services", from the web app's footer string `footer.about-us.2` | Published | S1 |
| headquarters | Poland according to CoinMarketCap's description, which also gives 2022 as the founding year and 2022-11-14 as the launch date | Published | S4 |
| platform | BTSE white label: the same API paths, socket paths, catalog, books and anchor numbers as BTSE, see [`../btse/`](../btse/) | Probed | `rest-probe.py catalog anchor mirror`, `ws-probe.py book` |
| who may trade | an account holder who passes KYC. The public call `GET https://api.b2z.exchange/api/country/all` marks 23 countries `restricted` and `prohibitKyc`: BY, CF, CG, CK, CU, ER, IQ, IR, KP, LB, LR, LY, RU, SD, SG, SO, SY, TW, UA, US, VE, YE, ZW. Only RU also carries `prohibitRegistration` and `prohibitLogin` | Probed | `fees-probe.py regions` |
| US persons | may not trade. The United States is `restricted` with `prohibitKyc` true, and the KYC form asks the user to confirm "I am not resident of, or otherwise located in, any restricted jurisdiction" | Probed | `fees-probe.py regions brand` |
| Canada | carries no restriction flag on B2Z, while the same call on `api.btse.com` sets `prohibitRegistration` and `prohibitLogin` for CA | Probed | `fees-probe.py regions` |
| terms of service | the legal pages are rendered by script, so `/en/vip-program` and every other web path return the same 3,381 byte page shell to a plain request, and the terms text was not read | Probed | `fees-probe.py brand` |
| this host | the fee table, the country list, the strings file, the catalog, the anchor calls and both socket URLs all answered from the Canadian exit with no refusal or challenge | Probed | [`rest.md`](./rest.md) section 1 |

CoinMarketCap's description lists the same restricted countries in prose, ending with the United States, S4.
The country flags are what the web app's `getCountryList` client reads, so they are taken as the operative list.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-quoted perpetuals, one family | 0.015 % = 150 ppm | 0.05 % = 500 ppm | Published | S2, `fees` row `futures` level 0 |
| spot, for reference | 0.15 % = 1,500 ppm | 0.2 % = 2,000 ppm | Published | S2, `fees` row `spot` level 0 |

The table comes from `GET https://api.b2z.exchange/api/account/dashboard/tradingFees`, the call the VIP page reads, which answers without credentials.
It names one futures schedule for every perpetual, crypto, stock and commodity alike.
The fee basis, notional of mark price times size on opening and on closing, is BTSE's published rule and is assumed to carry over to the white label, see [`../btse/fees.md`](../btse/fees.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals, USDT-quoted, multi-collateral | yes, 218 active: 130 `CRYPTO`, 82 `STOCK`, 6 `COMMODITIES` | [`rest.md`](./rest.md) section 2 |
| coin-margined or inverse perpetuals | no, every perpetual has `quoteCurrency` `USDT` | [`rest.md`](./rest.md) section 2 |
| dated futures | yes, 4: `BTC-261225`, `ETH-261225`, `BTC-270326`, `ETH-270326` | `rest-probe.py catalog` |
| options | no, none in the catalog | `rest-probe.py catalog` |
| spot | yes, 917 markets | `rest-probe.py catalog` |

CoinMarketCap lists 650 spot pairs, 197 perpetual pairs and 4 futures pairs for B2Z, and prints the perpetuals as quoted in USD, S4.
CoinGecko's derivatives list holds 216 venues and no row whose id or name contains "b2z", S5.

## 4. Perpetual tiers

From S2, futures rows.

| level | 30-day spot volume, USD | 30-day futures volume, USD | token balance | maker | taker | taker ppm |
|---|---:|---:|---:|---|---|---:|
| 0 | 0 | 0 | 0 | 0.015 % | 0.05 % | 500 |
| 1 | 500,000 | 15,000,000 | 5,000 | 0.015 % | 0.0475 % | 475 |
| 2 | 1,000,000 | 50,000,000 | 15,000 | 0.01 % | 0.045 % | 450 |
| 3 | 5,000,000 | 100,000,000 | 25,000 | 0.008 % | 0.0425 % | 425 |
| 4 | 10,000,000 | 600,000,000 | 40,000 | 0.005 % | 0.04 % | 400 |
| 5 | 50,000,000 | 1,000,000,000 | 50,000 | 0 % | 0.036 % | 360 |

The reply gives the three thresholds per level and no rule joining them.
Whether one threshold is enough, as on BTSE where either spot or futures volume qualifies, is Not publicly specified for B2Z.
The token named by `tokenBalance` is not named in the reply, and `tokenStaking` is null on every row.

The same call on `api.btse.com` returns BTSE's own eleven levels, 0 to 10, with a futures VIP 0 of 200 ppm maker and 550 ppm taker, which matches [`../btse/fees.md`](../btse/fees.md) section 4.
So the white label sets its own schedule on the shared book.

## 5. Discounts that change the perpetual taker

| discount | effect on the VIP 0 taker | label | evidence |
|---|---|---|---|
| token balance | 5,000 tokens is one of the level 1 thresholds, 475 ppm | Published | S2 |
| referral | the web app has an affiliate program, with no rate in a public reply | Not publicly specified | |
| zero fee promotion | none found | Not publicly specified | |

## 6. Funding as a cost

B2Z publishes BTSE's funding numbers unchanged.
In one read of `ticker/24hr` from both hosts in the same second, all 218 perpetuals had the same `fundingRate`, `nextFundingTime` and `openInterest` on both, see [`rest.md`](./rest.md) section 3.

| item | value | label | evidence |
|---|---|---|---|
| formula, clamp, who pays | BTSE's, see [`../btse/fees.md`](../btse/fees.md) section 6 | Published by BTSE | S6 |
| interval | 480 minutes on 151 perpetuals and 240 minutes on 67, from `fundingIntervalMinutes` | Probed | `rest-probe.py anchor` |
| next settlement | `1791619200000`, 2026-10-10 08:00 UTC, on all 218 at 05:41 UTC | Probed | `rest-probe.py anchor` |
| BTC rate | `0.0000588` per 8 h | Probed | `rest-probe.py anchor` |

The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

No B2Z liquidation or delisting fee page could be read, since the help pages are rendered by script.
BTSE's rules are in [`../btse/fees.md`](../btse/fees.md) section 7, and whether B2Z applies them unchanged is Not publicly specified.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| CCXT 4.5.68 | no B2Z class. `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 classes and none matches `b2z` or `btse`, and the `exchanges` map at lines 232 to 337 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no such line | `fees-probe.py ccxt` |
| CCXT master | `exchanges.json` at commit `f0aca06` of 2026-10-08 lists 103 ids, among them `btse` and no `b2z`, and `ts/src/b2z.ts` answers 404 | S3 |
| `market.taker` | none, since no class loads B2Z. A `btse` class pointed at `api.b2z.exchange` would report BTSE's 550 ppm, not B2Z's 500 ppm | [`../btse/fees.md`](../btse/fees.md) section 8 |

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 500 | the futures level 0 taker of S2 |
| `ccxtTakerPpm` | none | no CCXT class loads B2Z, and the Rust adapters do not read CCXT |

B2Z can only enter the registry as the existing BTSE adapter pointed at the B2Z hosts, and it would then carry the same book as the BTSE leg.
The engine should carry at most one of BTSE and B2Z, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://www.b2z.exchange/i18n/en.json`, the web app's English strings, 12,392 keys | brand name "B2Z", the BVI entity line, the KYC jurisdiction checkbox, the region alert text |
| S2 | `https://api.b2z.exchange/api/account/dashboard/tradingFees`, and the same path on `api.btse.com` | the B2Z spot and futures VIP tables, and BTSE's for comparison |
| S3 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json`, `.../master/ts/src/b2z.ts`, and `https://api.github.com/repos/ccxt/ccxt/commits/master` | 103 ids with `btse` and without `b2z`, a 404, commit `f0aca06` |
| S4 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=b2z-exchange` and `.../exchange/market-pairs/latest?slug=b2z-exchange` with `category` `spot`, `perpetual` and `futures` | id 9584, Poland, launch date, the restricted country prose, fee URL, `makerFee` and `takerFee` 0.0, 650, 197 and 4 pairs |
| S5 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` | 216 derivatives venues, none named B2Z |
| S6 | [`../btse/fees.md`](../btse/fees.md) | BTSE's funding formula, liquidation rules and CCXT `btse` class |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/b2z/fees-probe.py), first run 05:39 UTC and second pass 05:49 UTC on 2026-10-10 | every row marked Probed above |
