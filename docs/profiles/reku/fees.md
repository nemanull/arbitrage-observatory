# Reku Fees Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:42 to 02:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada, in AS212238 Datacamp Limited.

This profile covers the trading fees of Reku, the Indonesian exchange at `reku.id`, formerly Rekeningku, which CoinMarketCap lists at rank 99 under the slug `rekeningku-com`.
The researched product is its perpetuals, sold as Reku Futures since February 2025, see section 3.
Every Reku host refused this exit with Cloudflare error 1005, which says the site owner banned the autonomous system number 212238, see [`rest.md`](./rest.md) section 1.
So no Reku page was read from this host, and every venue claim below comes from a third party or from a search engine's excerpt of a Reku page, and says which.
It has no CCXT class, see section 8.
Source ids are shared with [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | PT Rekeningku Dotcom Indonesia | S3, and the CFX member row, P2 |
| perpetual partner | PT Pasar Forex dan Komoditi Berjangka, named in Reku's perpetual terms as the strategic partner that runs the perpetual contract product | S3, search excerpt |
| licence | Bappebti registration 006/BAPPEBTI/CP-AK-03-2020, as Reku's own description on CoinMarketCap says | S2, P2 |
| exchange membership | spot member of CFX, Indonesia's crypto asset exchange, SPAB-017/PFAK/CFX/08/2024, dated 2024-08-14 | S13, P2 |
| supervision of the perpetuals | Bappebti and CFX at the February 2025 launch, S9, and "dukungan CFX dan OJK", the backing of CFX and OJK, in September 2025, S10 | S9, S10 |
| who may trade | Not publicly specified as far as this host could read, since the terms page refused this host | S3, P1 |
| regions excluded | Not publicly specified as far as this host could read | P1 |
| fiat | IDR only, as CoinMarketCap lists | S2, P2 |
| access from this host | every Reku host returned HTTP 403 with Cloudflare error 1005, an ASN ban, see [`rest.md`](./rest.md) section 1 | P1 |

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT perpetuals, `<BASE>USDT-PERP` | 0.1665 %, 1,665 ppm | 0.2775 %, 2,775 ppm | S1, search excerpt, summed below |

The futures fee page lists three parts for each side, S1.
The taker pays 0.1 % Reku fee, plus 0.011 % VAT, plus 0.1665 % "CFX Fee".
The maker pays 0.1 % Reku fee, plus 0.011 % VAT, plus 0.0555 % "CFX Fee".
The page notes that the VAT is 11 % of the 0.1 % Reku fee.
The sums, 0.2775 % and 0.1665 %, are this profile's arithmetic, since the page shows only the parts.
The figures were read through a search engine's excerpt of `https://reku.id/en/fees/futures`, because the page refused this host.
The newest Wayback Machine capture of that page is dated 2025-11-11, and the Wayback Machine refused to serve it to this host with 429, P1.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT perpetuals | yes, live count unknown | launched 14 February 2025, S9, and announcements through 2026 delist contracts by name, S6 |
| USDC margined perpetuals | Not publicly specified | no Reku page could be read, and every contract name seen ends in `USDT-PERP` |
| coin margined perpetuals | Not publicly specified | as above |
| dated futures | no sign of any | CFX registers only `USDT-PERP` contracts, 49 of them, P2 |
| options | no sign of any | none named in any source read |
| spot | yes, 42 pairs, all quoted in IDR | CoinMarketCap market pairs, P2, named here and not detailed |
| staking and US stocks | named in Reku's description and the launch article | S2, S9, not detailed |

A trading rules page title found in the search index reads "kontrak berjangka aset kripto denominasi USDT dengan margin IDR", USDT denominated contracts with IDR margin, S17.
Whether the margin is IDR, USDT or both could not be read.

The live contract count is unknown.
Reku cut leverage on 125 lower volume perpetuals from 25x to 10x on 5 December 2025, S5, so it listed at least 125 then.
It then announced delistings of 30 contracts on 22 January 2026, S6, 50 in a later notice, S7, and 37 in a notice whose address names 26 March, S8.
CFX's list of registered derivative crypto assets held 49 `USDT-PERP` contracts on 2026-10-10, P2.
If Reku may list only contracts that CFX registers, it lists at most 49, but that rule is an inference from the delisting announcements citing regulator requirements, S6, and was not read in a rule.
CoinMarketCap tracks no Reku perpetual and CoinGecko has no Reku entry at all, P2.

## 4. Perpetual tiers

| tier | maker | taker | qualification |
|---|---|---|---|
| all users | 0.1665 % | 0.2775 % | none shown, S1 |

The search excerpt of the fee page shows one row per side and no VIP table, S1.
Whether a tier table exists below it is Not publicly specified as far as this host could read.

## 5. Discounts that change the perpetual taker

None found.
The "CFX Fee" part is an exchange charge and the VAT is statutory, so a Reku discount could at most touch the 0.1 % part.
For spot, Reku's own description on CoinMarketCap names 0.1 % for Pro Mode and 0 % for Lightning Mode, S2.
CoinMarketCap itself lists maker and taker 0 for Reku, P2, which matches only the Lightning Mode figure.

## 6. Funding as a cost

Reku's perpetual terms, read through a search excerpt, define the mark price as a weighted average index of global crypto exchanges and say it is also used to set the funding rate, S3.
The same excerpt shows the funding interval column of the contract table as "Bervariasi", which means varies, S3.
The formula, cap and floor, and who receives the payment are Not publicly specified as far as this host could read.
No funding settlement was observed, since no Reku host answered.

## 7. Liquidation, settlement and delisting charges

From 4 December 2025 a liquidation pays the normal trading fees, the broker fee and the exchange fee, where it was free before, S4.
The same announcement caps each user's position at the greater of 50,000 USDT and 20 % of the contract's total open interest, S4.
Reku's terms, through a search excerpt, say a liquidated position and its margin balance move to a clearing liquidation account, S3.
Reku's delisting announcements, as a search engine summarized them, say open orders are cancelled and open positions are closed automatically by TWAP, S6.
The January 2026 notice set a close deadline of 11 February 2026 15:00 WIB, S6, and was not read in full.

## 8. CCXT

CCXT 4.5.68 has no Reku class.
The installed `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` imports `poloniex` and then `tokocrypto` at lines 137 and 138, and its `exchanges` map holds `'poloniex'` and `'tokocrypto'` at lines 326 and 327, with no `reku` or `rekeningku` between them, S15.
The folder `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no file whose name contains `reku` or `rekening`, P2.
The current CCXT source on GitHub has none either: `ts/src/reku.ts` and `ts/src/rekeningku.ts` return 404 at master, and `ts/ccxt.ts` imports 103 exchange classes with none matching, at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`, S16, P2.
So there is no `market.taker` to report.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 2775, provisional | the sum of the three taker parts on the futures fee page, read through a search excerpt, S1. Confirm it on the page from an exit Reku admits before use |
| `ccxtTakerPpm` | none | no CCXT class exists |

The venue should not be added to the registry from this host, because no catalog, book or anchor could be read, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | Reku futures fee page `https://reku.id/en/fees/futures`, read through a search engine excerpt because the page refused this host | 2026-10-10 UTC | the maker and taker parts, sections 2 and 4 |
| S2 | CoinMarketCap `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=rekeningku-com`, read by [`catalog-probe.py`](../../../scripts/probes/venues/reku/catalog-probe.py) | 2026-10-10 UTC | Reku's description, licence number, Pro and Lightning fees, fiat, the 0 fees CoinMarketCap lists |
| S3 | Reku perpetual terms `https://reku.id/en/help/syarat-dan-ketentuan-kontrak-berjangka-perpetual-aset-kripto-en`, read through search engine excerpts | 2026-10-10 UTC | operator, partner, mark price, funding interval, liquidation account |
| S4 | Reku announcement `https://reku.id/en/information/penyesuaian-pada-sistem-perpetual-futures-di-reku`, 3 December 2025, read through a search engine excerpt | 2026-10-10 UTC | open interest cap, liquidation fee |
| S5 | Reku announcement `https://reku.id/en/information/penyesuaian-leverage-crypto-futures-di-reku`, 4 December 2025, read through a search engine excerpt | 2026-10-10 UTC | 125 contracts moved from 25x to 10x |
| S6 | Reku announcement `https://reku.id/en/information/delisting-kontrak-perpetual-di-reku`, 22 January 2026, read through a search engine excerpt | 2026-10-10 UTC | 30 delisted contracts, the regulator reason, TWAP close |
| S7 | Reku announcement `https://reku.id/en/information/delisting-50-kontrak-perpetual-di-reku`, read through a search engine result | 2026-10-10 UTC | 50 more delisted contracts |
| S8 | Reku announcement `https://reku.id/en/information/delisting-37-kontrak-perpetual-di-reku-26maret`, read through a search engine result | 2026-10-10 UTC | 37 more delisted contracts |
| S9 | investortrust.id, "Perluas Strategi Trading Kripto, Reku Rilis Crypto Futures dengan 25x Leverage", 14 February 2025, `https://investortrust.id/market/56601/perluas-strategi-trading-kripto-reku-rilis-crypto-futures-dengan-25x-leverage` | 2026-10-10 UTC | launch date, perpetual contracts, Bappebti and CFX supervision |
| S10 | investortrust.id, "Minat 'Crypto Futures' Meningkat, Reku Luncurkan Fitur Flexible Leverage hingga 25 Kali", 22 September 2025, `https://investortrust.id/market/79764/minat-crypto-futures-meningkat-reku-luncurkan-fitur-flexible-leverage-hingga-25-kali` | 2026-10-10 UTC | 1x to 25x leverage, CFX and OJK |
| S13 | CFX member list `https://www.cfx.co.id/en/exchanges-and-participants/members?page=2`, read by [`catalog-probe.py`](../../../scripts/probes/venues/reku/catalog-probe.py) | 2026-10-10 UTC | Reku's member row |
| S15 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js`, CCXT 4.5.68 | 2026-10-09 | no class |
| S16 | `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts` and `ts/src/reku.ts`, read by [`catalog-probe.py`](../../../scripts/probes/venues/reku/catalog-probe.py) | 2026-10-10 UTC | no class on master |
| S17 | Reku trading rules page `https://reku.id/en/help/peraturan-perdagangan-kontrak-berjangka-aset-kripto-denominasi-usdt-dengan-margin-idr-en`, title only, from a search engine result | 2026-10-10 UTC | USDT denominated, IDR margin |
| P1 | [`access-probe.py`](../../../scripts/probes/venues/reku/access-probe.py) | 2026-10-10 UTC | the 1005 refusals, the Wayback Machine 429 |
| P2 | [`catalog-probe.py`](../../../scripts/probes/venues/reku/catalog-probe.py) | 2026-10-10 UTC | CoinMarketCap, CoinGecko, CCXT and CFX reads |
