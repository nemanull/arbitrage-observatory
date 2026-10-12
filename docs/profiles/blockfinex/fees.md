# Blockfinex Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 02:19 to 02:49 UTC on 2026-10-10, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the fees of the Blockfinex perpetual futures and names the other products in the coverage matrix.
Blockfinex has no CCXT class, see section 8.
Blockfinex runs on the ChainUp white label platform: its futures API is ChainUp's `fapi/v1` open API, its hosts sit behind an AWS load balancer named `cloong-alb-internet-h5-v6` in `ap-northeast-1`, and its web page loads ChainUp's `microspot.chainupcloud.com` fingerprint script, S1.
Every futures fee below is read from the public contract catalog by [`rest-probe.py`](../../../scripts/probes/venues/blockfinex/rest-probe.py) mode `catalog`, P1, unless a source is named.

## 1. Scope and freshness

| item | value |
|---|---|
| retrieval date | 2026-10-09 local, 2026-10-10 UTC |
| legal entity | Not publicly specified in what this host could read. The footer names "About Blockfinex", "Regulatory license" and "Terms of Use" articles, S1, but they render by script from a CMS call that answered `{"code":"10020","msg":"parameter error"}` to the bodies tried |
| who may trade the perpetuals | Not publicly specified in what this host could read |
| regions excluded | Not publicly specified. The web app carries the strings "Current regional IP does not support registration" and "The country/region this phone number belongs to is not supported due to policy constraint", S1, but no list |
| access from this host | every public REST call and both sockets answered from the Canadian exit, with no geoblock and no challenge |

## 2. Quick answer

Fees are set per contract, and the catalog carries them on every row as `openTakerFee`, `closeTakerFee`, `openMakerFee` and `closeMakerFee`.
The website's contract list carries the same rates under `feeRateVo` with `uid` null, on 74 of 74 trading contracts, P1.

| family | VIP 0 taker | VIP 0 maker | evidence |
|---|---|---|---|
| USDT-M linear perpetuals, the mode, 52 of 74 including BTC, ETH and SOL | 0.08 %, 800 ppm, open and close | 0.02 % on 46 contracts, 0.025 % on 28 | P1 |
| USDT-M, 11 contracts: BZ, TSLA, XMR, CL, CRCL, SPCX, AAPL, NATGAS, OPENAI, COPPER, XAG | 0.10 %, 1,000 ppm | as above | P1 |
| USDT-M, 5 contracts: LAB, DOT, XAU, ATOM, TRUMP | 0.09 %, 900 ppm | as above | P1 |
| USDT-M, 4 contracts: MU, TIA, IMX, CRV | 0.08 % to open, 0.05 % to close | as above | P1 |
| USDT-M, DYDX and BNB | 0.085 % and 0.075 % | as above | P1 |
| coin-margined inverse, 5 contracts | 0.08 %, LTC 0.05 % | 0.025 % or 0.02 % | P1 |

The engine's taker is the open taker of each contract, 750 to 1,000 ppm, with 800 ppm on 56 contracts including BTC, ETH and SOL.

## 3. Coverage matrix

| product | present | count on 2026-10-10 02:35 UTC | evidence |
|---|---|---|---|
| USDT-M linear perpetuals | yes | 74 trading, 2 closed (`E-TON-USDT`, `E-PAXG-USDT`) | `GET /fapi/v1/contracts`, `type` E, `side` 1, P1 |
| of which crypto | yes | 55 | `assetClass` 1 in the web list, P1 |
| of which equities and pre-IPO | yes | 14: AAPL, CRCL, META, MSFT, MU, NFLX, OPENAI, PLTR, SKHYNIX, SNDK, SPCX, SPY, TSLA, TSM | `assetClass` 2, P1 |
| of which metals | yes | 3: COPPER, XAG, XAU | `assetClass` 3, P1 |
| of which energy | yes | 2: BZ and CL, while NATGAS is filed under class 1 | `assetClass` 5, P1 |
| USDC-M perpetuals | no | 0 | no `-USDC` row in the catalog, P1 |
| coin-margined inverse perpetuals | yes | 5: `E-BTC-USD`, `E-ETH-USD`, `E-SOL1-USD`, `E-DOGE-USD`, `E-LTC-USD`, each 10 USD a contract | `side` 0, margined in the base, P1 |
| other | one row | `S-BTC-USDT`, `type` S, margined in `EXUSD`, which the ChainUp documentation calls a test futures type | P1, S2 |
| dated futures | no | 0 | no `type` other than E and S, P1 |
| options | no | none found | no options page or call in the futures bundle, S1 |
| spot | yes | named only | `wss://ws.blockfinex.com/kline-api/ws` carries `market_btcusdt_depth_step0`, see [`websocket.md`](./websocket.md) section 1 |

CoinMarketCap's derivatives ranking, read through its data API with `exType=2`, lists Blockfinex, which is why [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) placed it in wave 39, and these counts confirm it.

## 4. Perpetual tiers

No VIP tier table was retrieved.
The homepage FAQ says rates "vary by trading type and user tier", and it sends readers to "the fee schedule on the official website or app", S1.
The footer links a "Fee Structure" article, id 1670, but it is a script-rendered CMS article and its content call was not found, see section 1.
So every rate in section 2 is the base rate the public catalog states, and the tiers above it are Not publicly specified in what this host could read.

## 5. Discounts that change the perpetual taker

| discount | status |
|---|---|
| platform token | the web app carries the string "Pay The Fee In Platform's Token", S1, with no rate. Not publicly specified |
| referral | a partner program text names "Exchief partners" and a commission percentage, S1. It pays the referrer and does not change the taker |
| market maker | Not publicly specified |
| zero fee promotion | none seen in the catalog. No contract has a taker below 0.075 % |

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| interval | 8 h on 63 trading USDT contracts, 4 h on 10 (BZ, TSLA, VVV, CL, BTW, NATGAS, JUP, HOME, COPPER, XAG), 1 h on `E-LAB-USDT` | `capitalFrequency` of `/v1/inner/contract_config` and of the web list, P1 |
| settlement instants | BTC settled at 00:00, 08:00 and 16:00 UTC on all 10 rows of its history read, back to 2026-10-07 00:00 UTC | `common/funding_rate_list`, P2 |
| next settlement at 02:35 UTC | 08:00 UTC on 63, 04:00 UTC on 10, 03:00 UTC on LAB | `nextCapitalSettTime` of the web list, P1 |
| cap and floor | per contract, `capitalIntervalMin` and `capitalIntervalMax` of the web list: ±0.375 % on BTC and ETH, ±0.75 % on 27 contracts including SOL, ±2 % on 35, and ±0.08 % on VVV | P1 |
| premium clamp | `capitalPremiumMin` and `capitalPremiumMax` read −0.0005 and 0.0005 on all 80 rows of the config | P1 |
| formula | Not publicly specified. The ChainUp futures help center the web list links, `https://futuresdoc.gitbook.io/help-center/v/en/`, is generic to the platform and was not read for this profile | S1 |
| who pays | Not publicly specified beyond the sign convention of every venue on the platform | |

Which of the two published rates is charged at the next settlement is discussed in [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| liquidation fee | the web list's `liquidationRate` has the same distribution as `closeTakerFee`, 0.08 % on 52, 0.10 % on 11, 0.09 % on 5, 0.05 % on 4, 0.085 % on 1 and 0.075 % on 1 | P1 |
| settlement fee | none, since no dated future is listed | P1 |
| delisting | `E-TON-USDT` and `E-PAXG-USDT` are listed with `status` 0. No delisting charge is published | P1 |

## 8. CCXT

CCXT 4.5.68 has no Blockfinex class.
`node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no `blockfinex.js`, and no file under it contains the string `blockfinex`, P3.
CCXT master at commit `f0aca06`, dated 2026-10-08, has no `blockfinex.ts` under `ts/src`, P3.
So no `market.taker` exists to compare, and `ccxtTakerPpm` does not apply.

The engine's members of the ChainUp family load their catalog from `/fapi/v1/contracts` without CCXT, and the loader takes each contract's taker from `openTakerFee` when the row states one, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 122 to 129.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| per market taker | `openTakerFee` of each row, 750 to 1,000 ppm | every trading row states it, and the loader already reads it |
| profile `taker_ppm` fallback | 800 | the open taker of 56 of 74 contracts and of BTC, ETH and SOL, for a row that would lack `openTakerFee` |
| `ccxtTakerPpm` | none | no CCXT class |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Blockfinex homepage and futures web bundle `chunk-common.17813666.js` | https://www.blockfinex.com/en_US and https://futures.blockfinex.com/futures/js/chunk-common.17813666.js | 2026-10-10 UTC | Blockfinex, global | FAQ on fees, footer articles, registration strings, ChainUp script host, `fe-co-api` paths, sections 1 to 6 |
| S2 | ChainUp Open API v2 documentation, linked from the Blockfinex homepage | https://exchangedocsv2.gitbook.io/open-api-doc-v2/futures | 2026-10-10 UTC | ChainUp platform | contract fields and types, section 3 |
| P1 | `rest-probe.py catalog`, 02:35 UTC and the second pass | [`rest-probe.py`](../../../scripts/probes/venues/blockfinex/rest-probe.py) | 2026-10-10 UTC | this host | sections 2, 3, 6 and 7 |
| P2 | `rest-probe.py funding`, 02:36 UTC and the second pass | [`rest-probe.py`](../../../scripts/probes/venues/blockfinex/rest-probe.py) | 2026-10-10 UTC | this host | section 6 |
| P3 | a search of the installed CCXT 4.5.68 tree and a GitHub API listing of `ccxt/ccxt` `ts/src` at master | https://api.github.com/repos/ccxt/ccxt/contents/ts/src | 2026-10-10 UTC | CCXT | section 8 |
