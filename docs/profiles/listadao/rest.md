# ListaDao REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:57 to 05:01 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Vancouver, Canada (`ipinfo.io` reports AS212238 Datacamp Limited).

ListaDao is CoinMarketCap's name for Lista DAO, a lending, stablecoin and liquid staking protocol on BNB Smart Chain, S1.
It lists no perpetuals and runs no order book, see [`fees.md`](./fees.md) section 3, so the researched product is its spot surface.
Its one public REST API, the Moolah Lending API on `api.lista.org`, serves lending markets, vaults and positions, and no exchange market data.
So no catalog, no book and no price feed exist in the sense this survey needs, and the venue has no public API for the engine.
Every probed fact below comes from [`rest-probe.py`](../../../scripts/probes/venues/listadao/rest-probe.py).

## 1. Host and latency from this machine

### What was looked for

The probe read CoinMarketCap's listing for the venue, the website, its main script bundle, the documentation index, the lending API, twelve exchange style paths on `api.lista.org`, and the Lista V3 Dex pools on chain.

### Hosts

| host | resolved | note |
|---|---|---|
| `lista.org` | 143.204.1.11, .26, .76, .88 | CloudFront in front of nginx, the web app |
| `api.lista.org` | 143.204.1.22, .31, .38, .72 | CloudFront, the Moolah Lending API and other app routes |
| `static.lista.org` | 3.163.24.65, .70, .73, .88 | CloudFront, the web app's scripts |
| `logapi.lista.org` | 143.204.1.6, .43, .49, .59 | named in the bundle, not called |
| `docs.bsc.lista.org` | 104.18.40.47, 172.64.147.209 | GitBook on Cloudflare |
| `docs.lista.org` | does not resolve | |

No host refused the Canadian exit, and no reply looked like a geoblock.

### Latency

| request | status | time |
|---|---|---|
| `GET https://lista.org/`, three in a row, two runs | 200, 5,086 bytes | 237 to 745 ms |
| `GET https://api.lista.org/`, three in a row, two runs | 404, `{"code":"404","msg":"Not Found","timestamp":...}` | 214 to 676 ms |
| `GET https://api.lista.org/api/moolah/overall`, two runs | 200, 15,270 bytes | 369 and 372 ms |
| `GET https://docs.bsc.lista.org/`, two runs | 200, 559,201 bytes | 124 and 144 ms |

Each call opens a new connection, so cold and warm are not separated.

## 2. Catalog

### What CoinMarketCap lists

CoinMarketCap's exchange 11016, slug `listadao`, has status `active` and the tags `order-book-exchange` and `auto-order-book-exchange`, P1.
Its description is the Lista DAO protocol's own, a "decentralized stablecoin lending protocol powered by LSDfi", P1.
It lists one spot pair and no perpetual or futures pair, P1, with the values of the two runs:

| pair | price | 24 h volume, USD | `volumeBase` | `volumeQuote` | `marketUrl` |
|---|---|---|---|---|---|
| `slisBNBx/BNB` | 745.50 and 745.58 | 4,023,059 and 4,023,479 | 5,396.4267 | 5,396.4267 | empty |

slisBNBx is "a non-transferable certificate" that Lista issues 1:1 when a user deposits BNB as collateral and burns on withdrawal, S2.
Equal base and quote volume fit that 1:1 mint and burn, so CoinMarketCap's pair counts collateral flow, not trades.
No order book or trade history exists behind it.

### What the venue serves

The web app bundle has no `orderbook`, `orderBook`, `depth`, `funding`, `markPrice` or `indexPrice`, P1.
Its 47 `/api/` paths fall under `/api/cdp`, `/api/credit`, `/api/liquidation`, `/api/lisaster`, `/api/moolah`, `/api/v2`, `/api/veboost` and `/api/WagmiProvider`, all lending, rewards and wallet routes, P1.
Its swap links leave for PancakeSwap and Thena, P1.

Twelve exchange style paths on `api.lista.org`, such as `/api/v1/ticker`, `/api/v1/depth?symbol=slisBNBx_BNB`, `/api/v3/exchangeInfo`, `/api/dex/pairs` and `/api/futures/contracts`, each returned 404 with the body above, P1.

The documented API is the Moolah Lending API, S3.
`GET /api/moolah/borrow/markets?page=1&pageSize=3` returned 200 with 193 markets in total, each row a loan and collateral pair with fields such as `rate`, `lltv`, `liquidity`, `utilization` and `termType`, P1.
Its `termType` 0 means a loan with no fixed term, which the documentation calls "perpetual", S3.
That is not a perpetual future.

### The Lista V3 Dex on chain

The Lista V3 Dex is a Uniswap V3 fork on BNB Smart Chain with no off-chain API, S4.
The documentation names four pools, and the probe read each through the public node `bsc-rpc.publicnode.com`, which the web app itself lists, P1:

| pool | pair | fee, ppm | active liquidity |
|---|---|---|---|
| `0xd501...228d` | slisBNB/WBNB | 100 | 0 |
| `0x46eE...f568` | USDT/USDC | 2 | nonzero |
| `0x8b94...6e15` | lisUSD/USDT | 100 | nonzero |
| `0x9f0E...f4a1` | slisBNB/WBNB | 500 | 0 |

An AMM has no order book, and reading it means reading the chain, which is outside the engine's catalog, book feed and anchor shape.

### How CCXT maps it

CCXT 4.5.68 has no ListaDao class, and the current CCXT master on GitHub has none either, P1 and [`fees.md`](./fees.md) section 8.

## 3. Anchor

ListaDao publishes no index, mark or funding, because it lists no perpetuals.
The lending API publishes borrow rates and lending market totals, which are not a market reference price for a trading leg, S3.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable.

## 5. REST book snapshot

None exists.
`GET /api/v1/depth?symbol=slisBNBx_BNB` and `GET /api/v1/market/orderbook` returned 404, P1.

## 6. Rate limits and errors

The documentation publishes no rate limit, S3.
The probe makes 17 requests to `api.lista.org` per run, and across two runs none was limited, P1.
Unknown paths return HTTP 404 with `{"code":"404","msg":"Not Found","timestamp":...}`.
Lending API successes carry `"code":"000000000"` and `"msg":"success"` in the same envelope, S3 and P1.

## 7. Server time and clock offset

There is no time call, but every `api.lista.org` reply carries a `timestamp` in ms, S3.
In both runs the local clock read about 95 ms ahead of the first 404's `timestamp`, a figure that includes the reply's flight time, P1.

## 8. Recommended poller shape

None.
There is no perpetual, no order book, no catalog of tradable markets and no anchor to poll.

## 9. Source ledger

| id | source |
|---|---|
| S1 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=listadao`, read 2026-10-10 |
| S2 | slisBNBx pages, `https://docs.bsc.lista.org/introduction/binance-launchpool-clisbnb.md` and `https://docs.bsc.lista.org/for-developer/clisbnb.md`, read 2026-10-10 |
| S3 | Moolah Lending API pages, `https://docs.bsc.lista.org/for-developer/services/lending-api.md`, its "API Conventions" page and its "Market" page, read 2026-10-10 |
| S4 | Lista V3 Dex pages, `https://docs.bsc.lista.org/for-developer/dex.md`, `https://docs.bsc.lista.org/for-developer/dex/mechanics.md` and `https://docs.bsc.lista.org/for-developer/dex/smart-contract.md`, read 2026-10-10 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/listadao/rest-probe.py) |
