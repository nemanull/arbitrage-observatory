# ListaDao WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:57 to 05:01 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Vancouver, Canada (`ipinfo.io` reports AS212238 Datacamp Limited).

ListaDao, CoinMarketCap's name for the Lista DAO lending protocol, has no public market data socket.
It lists no perpetuals and runs no order book, see [`fees.md`](./fees.md) section 3, so the researched product would be a spot book channel, and there is none.
Every probed fact below comes from [`ws-probe.py`](../../../scripts/probes/venues/listadao/ws-probe.py), which holds each socket attempt for at most five seconds.

## 1. Endpoints

None.
The documentation index never says "websocket", "order book" or "orderbook", S1 and P2.
The web app's main bundle holds ten `wss://` URLs, and every one is a public or keyed BNB Smart Chain or Ethereum JSON-RPC node, P1:

| host | role |
|---|---|
| `bsc-rpc.publicnode.com`, `bsc.drpc.org` | BNB Smart Chain RPC |
| `ethereum-rpc.publicnode.com`, `eth.drpc.org` | Ethereum RPC |
| `lb.drpc.org`, four keyed paths | BNB Smart Chain, Ethereum and their testnets through dRPC |
| `bsc-testnet.nodereal.io`, `eth-sepolia.nodereal.io` | testnet RPC with an embedded key |

No `wss://` URL in the bundle is under `lista.org`, P1.

The probe tried one handshake on each likely URL of the venue's own hosts, P1:

| URL | result |
|---|---|
| `wss://api.lista.org/ws` | refused, HTTP 404, `{"code":"404","msg":"Not Found","timestamp":...}` |
| `wss://api.lista.org/` | refused, HTTP 404, same body |
| `wss://api.lista.org/socket.io/?EIO=4&transport=websocket` | refused, HTTP 404, same body |
| `wss://api.lista.org/api/ws` | refused, HTTP 404, same body |
| `wss://lista.org/ws` | refused, HTTP 200 with the web app's HTML, the single page app fallback |

None of these answers is a geoblock.
The 404 body is the same one `api.lista.org` gives any unknown REST path, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | present |
|---|---|
| order book, any depth | no |
| best bid and ask | no |
| trades | no |
| ticker | no |
| mark, index, funding | no, the venue has no perpetuals |

The Lista V3 Dex is an on-chain AMM, S2.
Its price moves come only from BNB Smart Chain itself, as `Swap` events of each `ListaV3Pool` and as the pool's `slot0`, which a node's own `eth_subscribe` could stream.
That is chain data, not a venue feed, and it carries no order book, so it is named here and not detailed.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
With no socket, every axis is the same.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | no socket published | no socket found, section 1 |
| subscribe frame shape | no socket published | no socket found |
| unknown symbol expectation | no socket published | no socket found |
| chunk unit and budget | no socket published | no socket found |
| keepalive mechanism | no socket published | no socket found |
| connection lifetime and maintenance notice | no socket published | no socket found |
| handshake and operation rate limits | no socket published | five handshakes, each refused at the HTTP stage |
| public market data authentication | no socket published | no socket found |
| message parse and routing | no socket published | no socket found |
| subscribe acknowledgement shape | no socket published | no socket found |
| symbol identifier format | no socket published | no socket found |
| number representation | no socket published | no socket found |
| timestamp representation | no socket published | no socket found |
| size unit | no socket published | no socket found |
| sequence semantics | no socket published | no socket found |
| idle repeat behaviour | no socket published | no socket found |

## 4. The book channel in detail

There is no book channel, so snapshot, delta, sequence, checksum, level order, size unit, empty books, idle repeats and unknown symbols cannot be described.
The one pair CoinMarketCap lists, `slisBNBx/BNB`, is a non-transferable certificate minted 1:1 against BNB, S3, so it could never have a book.

## 5. Session

Not applicable.

## 6. Captured frames

No frame was received.
The only captured replies are the HTTP refusals in section 1, for example from `wss://api.lista.org/ws`:

```json
{"code":"404","msg":"Not Found","timestamp":1791608279407}
```

## 7. Private channels

None published.
The protocol's private actions are wallet signed BNB Smart Chain transactions, and the lending API's few private reads take a wallet signature over a message, S4.

## 8. Recommended feed shape

None.
No feed can be built, because the venue publishes no market data socket and has no order book.

## 9. Source ledger

| id | source |
|---|---|
| S1 | Lista documentation index, `https://docs.bsc.lista.org/llms.txt`, read 2026-10-10 |
| S2 | Lista V3 Dex pages, `https://docs.bsc.lista.org/for-developer/dex.md` and `https://docs.bsc.lista.org/for-developer/dex/mechanics.md`, read 2026-10-10 |
| S3 | slisBNBx pages, `https://docs.bsc.lista.org/introduction/binance-launchpool-clisbnb.md` and `https://docs.bsc.lista.org/for-developer/clisbnb.md`, read 2026-10-10 |
| S4 | Moolah Lending API conventions, `https://docs.bsc.lista.org/for-developer/services/lending-api/conventions.md` section "Signature-gated endpoints", read 2026-10-10 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/listadao/ws-probe.py) |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/listadao/rest-probe.py) |
