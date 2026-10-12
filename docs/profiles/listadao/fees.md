# ListaDao Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:57 to 05:01 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Vancouver, Canada (`ipinfo.io` reports AS212238 Datacamp Limited).

ListaDao is CoinMarketCap's name for Lista DAO, a decentralized lending, stablecoin and liquid staking protocol on BNB Smart Chain, S1.
It runs no order book and lists no perpetuals, so by change 1 of the survey plan's template the researched product is its spot surface.
That surface is the one pair CoinMarketCap lists, `slisBNBx/BNB`, which is a non-transferable certificate minted 1:1 against BNB rather than a traded market, and the Lista V3 Dex, an on-chain Uniswap V3 fork, see section 3.
Neither has an exchange fee schedule in the sense the engine needs.
[`fees-probe.py`](../../../scripts/probes/venues/listadao/fees-probe.py) reads the fee facts below, and [`rest-probe.py`](../../../scripts/probes/venues/listadao/rest-probe.py) reads the CoinMarketCap listing.

## 1. Scope and freshness

The website is `lista.org`, which CoinMarketCap names as the venue's site, S1.
The documentation lives at `docs.bsc.lista.org`, a GitBook site, S2.
`docs.lista.org` does not resolve from this host.
No legal entity is named in the terms of use, S6, or in the web app bundle, P2.
The terms forbid use by any U.S. Person and by anyone in a country or territory under U.S., U.K., EU or UN sanctions, S6.
Nothing in the terms or on the site restricts Canada.
No page or call was refused from the Canadian exit.

## 2. Quick answer

| product | maker | taker | label |
|---|---|---|---|
| perpetuals | none | none | `Not offered` |
| `slisBNBx/BNB`, the pair CoinMarketCap lists | none | none | not a trade. slisBNBx is issued 1:1 when BNB is deposited as collateral and burned on withdrawal, S3 |
| Lista V3 Dex swap | no maker side | the pool's fee tier: 2, 100, 500, 3,000 or 10,000 ppm | `Published` and `Probed`, S4 and P1 |

CoinMarketCap records `makerFee 0.0` and `takerFee 0.0` and an empty fee link list for the venue, P2.
That zero is CoinMarketCap's placeholder, and Lista publishes no exchange fee page.
There is no single VIP 0 taker to record, so the survey value is unknown.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| perpetual futures | no | CoinMarketCap lists 0 perpetual and 0 futures pairs for the venue, P2. The documentation index has no "perpetual futures", "order book" or "funding rate", P2. The only words in the web app bundle that contain "perp" in any case are `superposition` and `Superposition`, a chain name, and `isHyperPay`, a wallet flag, P2 |
| dated futures | no | as above |
| options | no | as above |
| order book spot | no | the web app bundle has no `orderbook`, `orderBook` or `depth`, and every exchange style path on `api.lista.org` returns 404, see [`rest.md`](./rest.md) section 2 |
| `slisBNBx/BNB` on CoinMarketCap | listed, not tradable | the only pair, with `volumeBase` equal to `volumeQuote` at 5,396.4267 and an empty `marketUrl`, P2. The documentation calls slisBNBx "non-transferable", S3 |
| Lista V3 Dex, an AMM | yes, on chain | a Uniswap V3 fork on BNB Smart Chain, S4. The four pools the documentation names are `slisBNB/WBNB` at 100 and 500 ppm with zero active liquidity, `USDT/USDC` at 2 ppm and `lisUSD/USDT` at 100 ppm, P2 |
| lending and the lisUSD CDP | yes | the core product. 193 borrow markets in the default zone, P2 |

The lending API's `termType` field calls an open-ended loan "perpetual", S5.
That word means a loan with no fixed term and has nothing to do with perpetual futures.

## 4. Tiers

Lista publishes no VIP or volume tiers.
The Lista V3 Dex charges each swap the fee tier of the pool it routes through, paid to that pool's liquidity providers, as in Uniswap V3, S4.

| tier | `fee`, ppm | `tickSpacing`, documented | `tickSpacing`, on chain | documented note |
|---|---|---|---|---|
| 0.0002% | 2 | 1 | 1 | used by Lista stablecoin pools |
| 0.01% | 100 | 1 | 1 | used by Lista LST pools |
| 0.05% | 500 | 10 | 10 | constructor |
| 0.30% | 3,000 | 60 | 60 | constructor |
| 1.00% | 10,000 | 200 | 200 | constructor |

The on-chain column is `feeAmountTickSpacing` on the live `ListaV3Factory` at `0xcb010ed373523942706F730b89792aA1C1597b20`, read through a public BNB Smart Chain node, P1.
The controls 1, 50, 250 and 2,500 return a spacing of 0, so no other tier is enabled, P1.
A swap also pays BNB Smart Chain gas, which is not a venue fee.

## 5. Discounts that change the taker

None published.
No token holding, referral or market maker program changes a swap fee, S4.
The veLISTA and LISTA holder programs share protocol revenue and emissions, not swap fees, S1.

## 6. Funding as a cost

`Not offered`, since there are no perpetuals.
The lending product charges borrow interest, and the protocol keeps 10% of that interest, adjustable between 0 and 25%, S7 and P1.
That is a lending cost, not funding.

## 7. Liquidation, settlement and delisting

Not applicable to a perpetual leg.
Lending liquidations exist and are served by `/api/liquidation/...`, which is out of scope here, S5.

## 8. CCXT

CCXT 4.5.68 has no ListaDao class.
No file in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` has "lista" in its name, P2.
The current CCXT master on GitHub has none either: its `ts/src` listing has 110 entries and none matches "lista", read 2026-10-10, P2.

## 9. Recommended registry values

None.
The venue has no perpetual and no order book, so there is no `takerPpm` or `ccxtTakerPpm` to set.
For reference only, a swap through the Dex's stablecoin pool costs 2 ppm and through its LST pools 100 ppm, P1.

## 10. Source ledger

| id | source |
|---|---|
| S1 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=listadao`, and `https://lista.org/`, read 2026-10-10 |
| S2 | Lista documentation index, `https://docs.bsc.lista.org/llms.txt`, read 2026-10-10 |
| S3 | slisBNBx pages, `https://docs.bsc.lista.org/introduction/binance-launchpool-clisbnb.md` and `https://docs.bsc.lista.org/for-developer/clisbnb.md`, read 2026-10-10 |
| S4 | Lista V3 Dex pages, `https://docs.bsc.lista.org/for-developer/dex.md`, `https://docs.bsc.lista.org/for-developer/dex/mechanics.md` section "Fee tiers and tick spacing", and `https://docs.bsc.lista.org/for-developer/dex/smart-contract.md`, read 2026-10-10 |
| S5 | Moolah Lending API pages, `https://docs.bsc.lista.org/for-developer/services/lending-api.md` and its "Market" page, read 2026-10-10 |
| S6 | Terms of use, `https://docs.bsc.lista.org/introduction/terms-of-use.md`, read 2026-10-10 |
| S7 | Lending fees, `https://docs.bsc.lista.org/introduction/lista-lending/fees.md`, read 2026-10-10 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/listadao/fees-probe.py) |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/listadao/rest-probe.py) |
