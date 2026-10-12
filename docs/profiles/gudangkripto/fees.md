# GudangKripto Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:44 to 04:14 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

GudangKripto lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
It is an Indonesian exchange with 36 coins, every one quoted in Indonesian rupiah (IDR).
GudangKripto publishes no API documentation.
Every number below comes from the web app at `https://gudangkripto.id`, from the public backend calls that app makes, or from third-party listings, all read by [`fees-probe.py`](../../../scripts/probes/venues/gudangkripto/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | PT Gudang Kripto Indonesia, a Pedagang Aset Keuangan Digital (digital financial asset trader) licensed and supervised by Otoritas Jasa Keuangan (OJK), and a member of the exchange PT Central Finansial X (CFX) and the clearing house PT Kliring Komoditi Indonesia (KKI) | Published | S2 |
| earlier registration | BAPPEBTI decree 013/BAPPEBTI/CP-AK/4/2022, from the app's About text | Published | S2 |
| addresses in the app | BAIC Tower, 11th floor, Jl. Gading Serpong Boulevard Barat No. 8, Kab. Tangerang, Banten 15810 in the help centre contact block, and Gedung Ventura, Jalan R.A. Kartini No. 26, Jakarta Selatan 12430 in the news footer | Published | S2 |
| futures entity | the app's disclaimer says "Futures contract trading on crypto assets is carried out by PT Porto Komoditi Berjangka, a Futures Broker licensed and supervised by Bappebti and a member of CFX and KKI." The web app has no route for such a product, see section 3. | Published | S2, `fees-probe.py coverage` |
| launched | 2021-06-20 according to CoinMarketCap | Published | S5 |
| who may trade | a KYC-verified member. CoinMarketCap lists Indonesia as the only country, every pair is quoted in IDR, and IDR deposits run through Indonesian bank virtual accounts. | Region-specific | S2, S5 |
| Canada | not stated anywhere read. The service is built for Indonesian residents with Indonesian identity documents, so the VPN exit's country is outside its market in practice. | Not publicly specified | S2 |
| web app from this host | `https://gudangkripto.id/trading-fees` answered HTTP 200 behind Cloudflare, and `https://market.gudangkripto.id/` answered HTTP 301 to `https://gudangkripto.id/market?tab=idr` | Probed | `fees-probe.py table`, [`rest.md`](./rest.md) section 1 |
| CoinMarketCap fee link | `https://gudangkripto.id/trading-rules` answers HTTP 200 with the app shell, and the app has no route of that name, so the page the link names is `/trading-fees` | Probed | S5, `fees-probe.py coverage` |

No refusal or geoblock was met from the Canadian exit.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, every IDR pair, trading fee | 0.18 %, 1,800 ppm | 0.18 %, 1,800 ppm | Published | S1, S3 |
| CFX exchange fee, charged on top | 0.005 %, 50 ppm | 0.005 %, 50 ppm | Published | S1 |
| income tax (PPh), sells only | 0 on a buy, 0.21 %, 2,100 ppm, on a sell | 0 on a buy, 0.21 %, 2,100 ppm, on a sell | Published | S1, S3 |

The fee table has columns for buy and sell, not for maker and taker.
Each of its 44 rows reads trading fee 0.18 % buy and 0.18 % sell, CFX fee 0.0050 % buy and sell, and tax 0 % buy and 0.21 % sell, S1.
The backend's public parameters agree on the trading fee and the tax, with `buy_fee_percent` "0.18", `sell_fee_percent` "0.18", `pph` "0.0021" and `ppn` "0", S3.
So the all-in cost of a taker buy is 1,850 ppm, a taker sell 3,950 ppm, and a round trip 5,800 ppm.
That is 3.7 times Gate's 500 ppm perpetual taker on the buy leg alone, see [`../gate/fees.md`](../gate/fees.md) section 2.
CoinMarketCap's exchange record carries `makerFee` 0.0 and `takerFee` 0.0, which is its placeholder for an unknown fee and not a zero fee, S5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | no app route, CoinMarketCap shows 0 perpetual pairs, S2, S5 |
| coin-margined perpetuals | no | same |
| dated futures | not in this app or API. The disclaimer names PT Porto Komoditi Berjangka as the futures broker, and nothing read links to it. | S2, S5 |
| options | no | no app route, S2 |
| spot order book | yes, 36 coins against IDR, with limit and market orders | [`rest.md`](./rest.md) section 2, S2 |
| instant buy and sell (quick trade) | yes, a separate route, not detailed | S2 |
| GIDR and GOIDR | IDR-pegged tokens with their own deposit parameters, not detailed | S3 |
| deposits and withdrawals | IDR by bank virtual account, crypto per network, see S1's withdrawal tab | S1, S3 |

Four checks agree that GudangKripto offers no perpetual.
The app's entry chunk holds 381 route entries, and none names futures, perpetual, derivative, margin, leverage, swap or contract in its name or path, S2.
The trade routes are `/market`, `/trade/:symbol`, `/quick-trade/:symbol` and their history and receipt pages, S2.
The entry chunk does define a menu label "Futures" in English and Indonesian, and no route or link that uses it was found, S2.
The public FAQ has 5 entries, all about the referral program, and none contains "futures", "perpetual", "leverage", "margin" or "derivative", S3.
CoinMarketCap's exchange record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of 35,262 USD and then 31,062 USD in the two runs, and its market pair lists hold 36 spot pairs, 0 perpetual and 0 futures, S5.
CoinMarketCap's derivatives ranking with `exType=2` lists 104 venues and not GudangKripto, S5.
CoinGecko's derivatives list of 216 venues and its exchange list of 1,503 venues have no GudangKripto row at all, S6.

## 4. Spot tiers

None published.
The `/trading-fees` page renders one flat rate per pair, the same 0.18 % on all 44 rows, and its page chunk contains neither "maker" nor "taker" nor any tier array, S1.
The app's string table still carries a "Spot Trading Fees" block that reads "Trading fees are calculated based on your 30-day trading volume. Higher volume means lower fees." with Tier, 30-Day Volume, Maker Fee and Taker Fee column labels, S2.
No page renders that block, and no tier numbers exist behind it.
A "VIP" member level exists, with eligibility and upgrade calls behind a login, and the withdrawal tab shows the same IDR 100,000,000 limit for basic and VIP members, S1, S2.
Whether VIP changes the trading fee is Not publicly specified.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | none published | Not publicly specified | S1 |
| VIP member level | no fee effect published | Not publicly specified | S2 |
| token holding | no exchange token seen | Not publicly specified | S1, S2 |
| referral | the referrer earns 5 % of a Level 1 referee's trading fees and 3 % of a Level 2 referee's, on spot limit and market orders. The referee's own fee does not change. | Published | S3 |
| zero fee promotions | none seen | Not publicly specified | S1 |

## 6. Funding as a cost

Not offered.
GudangKripto lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
A delisting charge is Not publicly specified.
The static fee table lags the catalog, S1, S4.
It lists 11 coins that the live coin list does not carry: AIA, ANDA, BGSC, CRCLX, FARTCOIN, FDUSD, GIDR, LAB, LEO, ONDO and SIREN.
The coin list carries 3 that the fee table lacks: ANOA, GOIDR and KITE.

## 8. CCXT

CCXT 4.5.68 has no GudangKripto class.
There is no `gudangkripto.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 class files, and the `exchanges` map that opens at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no line containing "gudang" or "kripto".
The current CCXT source agrees, S7.
`exchanges.json` on the `master` branch, read at commit `f0aca06` of 2026-10-08, lists 103 ids and none containing "gudang" or "kripto".
`ts/src/gudangkripto.ts` and `js/src/gudangkripto.js` on `master` answer HTTP 404.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, a book feed and an anchor, and GudangKripto has no perpetual and no CCXT class.
It cannot enter the registry as a perpetual leg.
If a later design added an IDR spot leg, `takerPpm` would be 1,800 from S1, plus 50 ppm CFX fee on every fill and 2,100 ppm tax on every sell, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://gudangkripto.id/trading-fees`, the "Trading Rules and Transactions Fees" page, whose tables ship in the Nuxt data chunk `/_nuxt/DKf4rZaA.js` that the page chunk `/_nuxt/gi_JTJ58.js` imports | 44 fee rows at 0.18 % trading fee, 0.0050 % CFX fee and 0.21 % sell tax, 44 minimum order rows such as 0.00002 BTC, 50 withdrawal rows such as 0.0001 BTC on the Bitcoin network |
| S2 | the web app's entry chunk `/_nuxt/BySqCzkc.js`, loaded by `https://gudangkripto.id/` | the route table, the endpoint map, the English and Indonesian strings for the legal footer, the futures disclaimer, the About text, the contact block and the unused tier labels |
| S3 | `https://be.gudangkripto.id/api/core/app-parameter` and `https://be.gudangkripto.id/api/core/faqs` | `buy_fee_percent` and `sell_fee_percent` "0.18", `pph` "0.0021", `ppn` "0", `cfx_buy_fee_fiat` and `cfx_sell_fee_fiat` "0.005", `cfx_buy_fee_crypto_pair` "0.01", `fee_cfx_idr_percentage` 0.0111, `fee_cfx_crypto_percentage` 0.0222, `cash_out_idr_fee` "10000", `min_deposit_idr` "51000", and the five referral FAQ entries |
| S4 | the coin list `https://be.gudangkripto.id/api/core/coin` | 36 coins, each with one IDR pair and `min_buy` and `min_sell` of 70,000 IDR, see [`rest.md`](./rest.md) section 2 |
| S5 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=gudangkripto`, `.../exchange/market-pairs/latest?slug=gudangkripto` with `category=spot`, `perpetual` and `futures`, and `.../exchange/listing?exType=2` | id 33201, launched 2021-06-20, country ID, fee link, fee fields 0.0, spot volume 31,062 to 35,262 USD, 36 spot pairs, 0 perpetual and 0 futures pairs, 104 derivatives venues without GudangKripto |
| S6 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/list` | 216 derivatives venues and 1,503 exchanges, no GudangKripto in either |
| S7 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json`, the two class paths on `master`, and `https://api.github.com/repos/ccxt/ccxt/commits?per_page=1&sha=master` | 103 CCXT ids without GudangKripto, two 404s, head commit `f0aca06` of 2026-10-08 |
