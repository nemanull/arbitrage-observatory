# BlockFin Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 04:11 to 04:40 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada, where BlockFin's fee and VIP pages answered with its restricted region page on 9 of 10 tries.

This profile covers the fees of BlockFin's perpetual futures, which come in three families: USDT-M, USDC-M and coin-M inverse.
BlockFin has no CCXT class, see section 8.
BlockFin runs on BloFin's platform as far as the wire shows, see [`rest.md`](./rest.md) section 1, and BloFin's fees are in [`../blofin/fees.md`](../blofin/fees.md).
BlockFin's fee and VIP pages refused this exit on 9 of 10 tries, and the Internet Archive refused its copies of them, so the fee facts come from CoinMarketCap, read by [`fees-probe.py`](../../../scripts/probes/venues/blockfin/fees-probe.py), P1 and P2.
No proxy, VPN or other route around the refusal was used.

## 1. Scope and freshness

| item | value |
|---|---|
| venue | BlockFin, `https://blockfin.com/`, launched 2024-03-06 by CoinMarketCap's date, S1 |
| legal entity | Not publicly specified in what this host could read. BlockFin's docs, fee and VIP pages refused this exit on all but one try, P1, P2 and [`rest.md`](./rest.md) section 1 |
| who may trade the perpetuals | Not publicly specified beyond the refusal page, which says this exit's region is one of "BlockFin's restricted countries or regions" and that BlockFin "is not able to provide service to users in these regions under our Terms and Conditions", P1 and [`rest.md`](./rest.md) section 1 |
| exit as seen | `149.22.81.161`, Vancouver, Canada, and Cloudflare's trace says `loc=CA`, [`rest-probe.py`](../../../scripts/probes/venues/blockfin/rest-probe.py) mode `access` |
| regions excluded | Canada at least, by the refusal. The full list would be in BlockFin's terms, which this host could not reach, since BlockFin's pages refused this exit on all but one try |
| CoinMarketCap listing | 319 perpetual pairs and 271 spot pairs, status `active`, countries and fiat lists empty, S1 and S2 |

BloFin's 2024 terms name the United States, Canada, Singapore, mainland China and about 35 other places as restricted locations, see [`../blofin/fees.md`](../blofin/fees.md) section 1.
Whether BlockFin's terms carry the same list is Not verified.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label |
|---|---|---|---|
| USDT-M perpetuals, 357 live | 0.02 %, 200 ppm | 0.06 %, 600 ppm | CoinMarketCap's exchange fee, S1 |
| USDC-M perpetuals, 10 live | 0.02 %, 200 ppm | 0.06 %, 600 ppm | inferred from the single futures rate |
| coin-M inverse perpetuals, 14 live | 0.02 %, 200 ppm | 0.06 %, 600 ppm | inferred from the single futures rate |

CoinMarketCap gives `makerFee` 0.02 and `takerFee` 0.06 in percent for BlockFin, and its fee link is `https://blockfin.com/login?redirect=account/trading-fees`, a page behind login, S1.
BloFin's VIP 0 futures rates are the same 0.02 % and 0.06 %, see [`../blofin/fees.md`](../blofin/fees.md) section 2.
BlockFin's own fee page could not be read, so these rates rest on CoinMarketCap alone.

| page | what this exit got |
|---|---|
| `https://blockfin.com/en/fees` | HTTP 200 with 324,066 bytes on the first try of P1, which the first version of the probe wrongly took for the refusal page and did not keep, then the 9,831 byte refusal page on 4 of 4 tries in P2 |
| `https://blockfin.com/en/vip` | the refusal page on 1 of 1 try in P1 and 4 of 4 in P2 |
| Internet Archive copy of the fee page, captured 2026-03-12 15:44 UTC | HTTP 429 "Too Many Requests" from `web.archive.org` on 4 of 4 tries in P1 and 3 of 3 in P2 |
| Internet Archive copy of the VIP page, captured 2026-03-07 18:13 UTC | HTTP 429 on 4 of 4 tries in P1 and 3 of 3 in P2 |

The archive's lookup call, `archive.org/wayback/available`, answered normally and named both captures, P1 and P2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes | 357 live `SWAP` rows settled in USDT, [`rest.md`](./rest.md) section 2, and 319 USDT perpetual pairs on CoinMarketCap, S2 |
| USDC-M perpetuals | yes | 10 live rows such as `BTC-USDC`, [`rest.md`](./rest.md) section 2. CoinMarketCap lists none |
| coin-M perpetuals | yes | 14 live `inverse` rows such as `BTC-USD`, settled in the base coin, [`rest.md`](./rest.md) section 2 |
| dated futures | no | every catalog row is `SWAP`, and CoinMarketCap lists 0 futures pairs, S2 |
| options | no | no option row or option pair anywhere |
| spot | yes | 271 spot pairs on CoinMarketCap, 262 quoted in USDT and 9 in USDC, with URLs such as `https://blockfin.com/spot/SOL-USDT`, S2, not detailed |

## 4. Perpetual tiers

BlockFin's VIP page refused this exit, and the archive refused its copy, see section 2.
The tier table is therefore Not publicly specified as far as this host could read.
BloFin's tiers are in [`../blofin/fees.md`](../blofin/fees.md) section 4, and whether BlockFin uses the same table is Not verified.

## 5. Discounts that change the perpetual taker

Not publicly specified in what this host could read.
No token, referral or market maker discount appears on CoinMarketCap, S1.

## 6. Funding as a cost

Funding is charged on every perpetual, as the public `funding-rate` call shows a rate and a next settlement time for all 381 instruments, [`rest.md`](./rest.md) section 3.
380 contracts named 2026-10-10 08:00 UTC as the next settlement and `KAIA-USDT` named 05:00 UTC.
CoinMarketCap showed the same funding rate as BloFin's on 309 of 310 shared pairs when both venues' rows were stamped 2 s apart, see [`rest.md`](./rest.md) section 1, so BlockFin's funding likely follows BloFin's formula, interval and cap, see [`../blofin/fees.md`](../blofin/fees.md) section 6.
The formula, the cap and who pays whom are Not publicly specified by BlockFin in what this host could read.

## 7. Liquidation, settlement and delisting

Not publicly specified in what this host could read.

## 8. CCXT

CCXT 4.5.68 has no BlockFin class.
The installed source folder `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` has no `blockfin.js`, and the names that come closest are `bitfinex.js`, `blockchaincom.js`, `blofin.js` and `digifinex.js`, [`rest-probe.py`](../../../scripts/probes/venues/blockfin/rest-probe.py) mode `ccxt`.
CCXT master on GitHub at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08 has no `ts/src/blockfin.ts` among the 103 files of `ts/src` either, same mode.
The `blofin` class is BloFin's, with id `blofin` at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/blofin.js` line 21 and REST root `https://openapi.blofin.com` at line 164.
Its default fees are `taker` 0.00060 and `maker` 0.00020 at lines 278 and 279, the same as the rates CoinMarketCap gives for BlockFin.
`market.taker` for a BlockFin swap market without credentials is therefore undefined, because there is no class to load.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 taker 0.06 % on CoinMarketCap, S1, and the same as BloFin's |
| `ccxtTakerPpm` | none | no CCXT class |

These values matter only if BlockFin becomes reachable, since its edge refuses most calls and every socket from this exit.

## 10. Source ledger

| id | source | retrieved | covers |
|---|---|---|---|
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/blockfin/fees-probe.py), first version | 2026-10-10 04:20 UTC | CoinMarketCap's fee fields, the live fee and VIP pages once each, their archived copies |
| P2 | `fees-probe.py`, second pass, with the refusal matched by its sentence and up to four tries per live page | 2026-10-10 04:32 UTC | the same |
| S1 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=blockfin` | 2026-10-10 | maker and taker, fee link, launch date, status |
| S2 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=blockfin&category=perpetual`, and the same with `spot` and `futures` | 2026-10-10 | 319 perpetual, 271 spot and 0 futures pairs |
| S3 | Internet Archive copy of `https://blockfin.com/en/fees`, `https://web.archive.org/web/20260312154458id_/https://blockfin.com/en/fees` | 2026-10-10 | refused with HTTP 429, section 2 |
| S4 | Internet Archive copy of `https://blockfin.com/en/vip`, `https://web.archive.org/web/20260307181304id_/https://blockfin.com/en/vip` | 2026-10-10 | refused with HTTP 429, section 2 |
| S5 | [`../blofin/fees.md`](../blofin/fees.md) | 2026-09-22 | BloFin's fees, terms and funding, for comparison |
