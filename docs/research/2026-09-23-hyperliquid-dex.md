# Hyperliquid, the decentralised layer

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-23 local time, 2026-09-24 06:29 to 06:57 UTC, from the development laptop through the pre-existing Surfshark exit that geolocates to Canada.

Hyperliquid is the first decentralised venue the engine would read, and this doc covers what the venue template does not ask.
It answers task 4 of [`2026-09-23-hyperliquid-research-plan.md`](../plans/2026-09-23-hyperliquid-research-plan.md): the chain behind every price, the node that could replace the public API, the builder-deployed dexes of HIP-3, the USDC settlement asset, the survey venues that route to Hyperliquid, who may use it, and what trading would later need.
Fees and access are in [`fees.md`](../profiles/hyperliquid/fees.md), the socket is in [`websocket.md`](../profiles/hyperliquid/websocket.md), and the REST anchor is in [`rest.md`](../profiles/hyperliquid/rest.md).
The project only observes, so nothing here was signed, traded or sent to `/exchange`.

## 0. Method

Every probed number comes from [`dex-probe.mjs`](../../scripts/probes/venues/hyperliquid/dex-probe.mjs), run with `node --max-old-space-size=512`.
The TypeScript server moved to [`old_ts_server/`](https://github.com/nemanull/arbitrage-observatory/tree/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server) during the session, and `server/node_modules` went with the move, while ccxt and ws stayed in pnpm's store at the workspace root.
So the probe loads them from whichever of `server/`, `old_ts_server/` and pnpm's hoist directory has them.
Code citations below point at [`old_ts_server/`](https://github.com/nemanull/arbitrage-observatory/tree/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server), where the engine's TypeScript source is now.

| run | mode | what it did | info weight |
|---|---|---|---|
| P1 | `dexes` | `perpDexs`, `allPerpMetas`, `spotMeta`, one `metaAndAssetCtxs` per dex with live assets and one for a retired dex, `predictedFundings`, then ticker collisions | about 200 per run, five runs, the first two before the collision output worked |
| P2 | `lag` | DNS, 30 `exchangeStatus` calls one per 1.5 s with an `l2Book` BTC every third, then `gossipRootIps` and reverse DNS of each root peer | about 100 per run, run twice |
| P3 | `socket` | one socket for 60 s with `bbo`, `trades`, `l2Book`, `activeAssetCtx`, `allDexsAssetCtxs` and `explorerBlock`, then two 6 s sockets for a retired and an unknown dex coin | 40 per run, run three times, run A without `activeAssetCtx` |
| P4 | `ccxt` | CCXT 4.5.68 `loadMarkets` with default options | about 250 in one burst, run three times |

The IP budget is 1,200 weight a minute, `exchangeStatus` and `l2Book` weigh 2 and every other info call used here weighs 20, S18.
Calls were spaced 1.5 s apart, so no run went near the budget.
Only `POST https://api.hyperliquid.xyz/info` and `wss://api.hyperliquid.xyz/ws` were called.
The laptop clock was NTP-synchronised with an offset of +5.7 ms and a 3.0 ms delay at the time of P2, per `timedatectl timesync-status`.
Delays below are wall clock minus a server timestamp, so they carry that offset.

## 1. HyperCore and HyperBFT

### 1.1 What the docs say

| item | value | source |
|---|---|---|
| consensus | HyperBFT, "a variant of HotStuff consensus", blocks produced by validators in proportion to stake | S1 |
| active validators | "the top twenty-seven by stake" | S11 |
| finality | "one-block finality inherited from HyperBFT" | S0 |
| end-to-end latency | median 0.2 s and 99th percentile 0.9 s for "a geographically co-located client", from sending a request to the committed response | S1 |
| commit | "time to commit (usually 2 blocks in pipelined HyperBFT consensus)" | S6 item 4 |
| block time | Not publicly specified as a number | S1, S6 |
| ordering inside a block | 1 to 2 consensus batches per block, and within each batch: actions that send no GTC or IOC order, then cancels, then actions with a GTC or IOC | S2 |
| throughput | about 200k orders a second, bounded by execution | S1 |

The ordering rule matters to a reader of crosses.
A cancel or an ALO order sent at time `t` "will almost always execute before IOC and GTC orders sent at time `t`", S6 write-latency item 3.
So a taker that sees a crossed book on Hyperliquid loses the race to every maker that pulls its quote in the same block.

### 1.2 What the public API and socket expose

| field | where | meaning | source |
|---|---|---|---|
| `time` | `exchangeStatus` info reply, `{"specialStatuses":null,"time":1790231397199}` | L1 time in ms of the state the API server answers from | S10 line 229, P2 |
| `time` | `l2Book`, `bbo` and `trades` frames, and the `l2Book` info reply | block time in ms | S17 `WsBook`, `WsBbo`, `WsTrade` |
| `(block_time, coin, tid)` | trades | the globally unique trade id, since `tid` is a 50-bit hash of the two order ids | S17 `WsTrade` |
| `hash` | trades | the transaction hash | S17 |
| block height | none of the replies or frames above | Not exposed on the market-data paths probed | P2, P3 |
| `explorerBlock` | subscribe on `wss://api.hyperliquid.xyz/ws` | acked, then one frame `[]` and nothing more in 60 s | P3 |
| explorer API | `blockList` and block details, weight 40 each | not called, because this task only calls `/info` and `/ws` | S18 |
| `block_number` | node output with `--batch-by-block` or `--stream-with-block-info`, schema `{local_time, block_time, block_number, events}` | only from a self-run node | S10 lines 138 and 139 |

`activeAssetCtx` frames and `allDexsAssetCtxs` frames carry no timestamp, so the anchor numbers can only be stamped on arrival, P3.

### 1.3 Measured block spacing and API delay

| measure | P3 run A | P3 run B | P3 run C |
|---|---|---|---|
| distinct block times seen in 60 s across `bbo` BTC, ETH, `xyz:XYZ100`, `xyz:GOLD`, `trades` BTC and two `l2Book` | 579 | 588 | 469 |
| gap between successive distinct block times, ms, min, p10, median, p90 | 50, 65, 82, 201 | 44, 64, 71, 149 | 49, 65, 106, 203 |
| `bbo` arrival minus block time, ms, median per coin | 268 to 282 | 248 to 255 | 249 to 252 |
| `bbo` arrival minus block time, ms, lowest | 203 | 196 | 200 |
| `trades` arrival minus block time, ms, median, snapshot frame left out | not measured | 269 | 274 |

| measure | P2 run A | P2 run B |
|---|---|---|
| warm POST round trip, ms, min, median, p90 | 102, 108, 151 | 102, 104, 153 |
| `exchangeStatus` state age, arrival minus half the round trip minus `time`, ms, p10, median, p90 | 185, 220, 298 | 161, 209, 238 |
| `l2Book` BTC reply age, same rule, ms, median | 418 | 502 |

Not every block moves one of the watched coins, so each gap is at least one block and the gaps bound the block time from above.
The p10 gap was 64 to 65 ms in all three runs and the lowest gap 44 to 50 ms, so a block lands about every 65 to 70 ms, which is about 14 to 15 blocks a second.
That is an inference from timestamps, because the docs publish no block time.
The block time is the proposer's stamp, and a block commits about 2 blocks later, S6.
The public API answers from a state about 0.2 s behind that stamp, measured two ways.
`exchangeStatus` read 209 to 220 ms old at the median.
`bbo` pushes arrived 248 to 282 ms after their block time at the median, and about 52 to 54 ms of that is the one-way network, half the median round trip.
How much of that 0.2 s is commit, execution and the API server's own lag behind its node cannot be separated without running a node.
The engine's anchor reader allows 5 s between two legs and 10 s of age, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server/src/engine/opportunity/anchorReading.ts) lines 4 and 5, so a 0.2 s delay fits it with room.

## 2. The non-validator node as a data source

### 2.1 What a node writes and serves

The node is `hl-visor run-non-validator` from `hyperliquid-dex/node`, S10 line 80.
It needs one reachable peer in `~/override_gossip_config.json`, and `gossipRootIps` on the public API lists recent ones, S10 lines 511 to 516.

| output | flag | content | source |
|---|---|---|---|
| `replica_cmds/{start_time}/{date}/{height}` | always | every block parsed as transactions | S10 line 99, S7 |
| `periodic_abci_states/{date}/{height}.rmp` | always | a full state snapshot every 10,000 blocks, which `compute-l4-snapshots` turns into full order-level books | S10 lines 103 to 124 |
| `node_trades` | `--write-trades` | every trade with both users and both order ids | S10 line 131, S7 |
| `node_fills` | `--write-fills` | fills in the API format, with `deployerFee` on HIP-3 fills | S10 line 132 |
| `node_order_statuses` | `--write-order-statuses` | every order status | S10 line 133 |
| `node_raw_book_diffs` | `--write-raw-book-diffs` | every resting order added, resized or removed, with user, `oid`, side and price, which is an L4 book feed | S10 line 134, S7 |
| `hip3_oracle_updates` | `--write-hip3-oracle-updates` | every `setOracle` a HIP-3 deployer sends | S10 line 135 |
| `misc_events` | `--write-misc-events` | funding distributions, ledger updates, staking | S10 line 136, S7 |
| `mempool_txs` | `split_client_blocks: true` | uncommitted transactions, "70-150ms improvement in latency when reading inputs", without execution results | S10 line 553, S6 read item 6 |
| local info server | `--serve-info` | a subset of info requests that are a function of local state, including `meta` and `perpDexs`, with no `l2Book` and no WebSocket | S10 lines 173 to 227 |

A node writes "around 100 GB of logs per day" with default settings, S10 line 91.
The freshness check the README suggests is to poll `exchangeStatus` and compare L1 and local timestamps, S10 line 229.
The `hyperliquid-dex/order_book_server` example builds books on the node's machine from these outputs, and the docs say it is not actively maintained, S6 read item 4.

### 2.2 Hardware, bandwidth and place

| item | value | source |
|---|---|---|
| non-validator machine | 16 vCPUs, 128 GB RAM, 500 GB SSD, Ubuntu 24.04 only | S10 lines 5 to 10 |
| machine for low read latency | "at least 32 logical cores, 128 GB RAM, and 500 MB/s disk throughput" | S6 read item 3 |
| ports | 4001 and 4002 open to the public for gossip | S10 line 12 |
| bandwidth | Not publicly specified, and the Foundation's benchmark price for a peering service is under $1k a month, "which covers compute and egress costs" | S9 |
| place | "For lowest latency, run the node in Tokyo, Japan." | S10 line 14 |
| Foundation non-validator | AWS `apne1-az1`, open only to accounts with 10,000 HYPE staked and a maker tier of 1 or above, and closed to U.S. and Ontario persons | S8 |
| community root peers | 25 listed: 20 in Japan, 2 in South Korea, 2 in Singapore, 1 in Germany | S10 lines 523 to 547 |
| `gossipRootIps` on 2026-09-24 | 24 addresses, 19 reverse-resolve to AWS `ap-northeast-1`, 4 have no PTR record, 1 is `lstn.net` | P2 |
| paid peering | 14 infrastructure providers, from Alchemy to ZAN | S9 |

The two hardware lines disagree on cores, and both are written.
Either way a node needs its own host with 128 GB of RAM.

### 2.3 Where the API servers sit

"API servers listen to updates from a node and maintain the blockchain state locally", S4.
From this exit, `api.hyperliquid.xyz` resolved to four CloudFront addresses in `3.175.64.0/24`, with reverse names such as `server-3-175-64-89.yvr52.r.cloudfront.net`, P2.
Every reply came through the CloudFront point of presence `YVR52-P3` in Vancouver with `X-Cache: Miss from cloudfront`, and the origin answered as `nginx/1.30.3` or `nginx/1.22.1`, so at least two origin pools exist, P2 and P3.
A warm POST took 102 ms at best and 104 to 108 ms at the median, which fits a Tokyo origin behind a Vancouver edge, an inference that agrees with S8 and S10 line 14.

### 2.4 What a self-run node would save

A node in Tokyo would remove the Pacific crossing, about 52 to 54 ms one way from here, and the API server's own hop.
It would not remove commit, which is about 130 to 140 ms for 2 blocks at the measured spacing.
It would also give the full order-level book and every HIP-3 oracle update, which the public API does not, S7 and S10 line 135.
The default public `l2Book` channel pushed BTC every 1.6 to 5.5 s in P3, with a 5.4 s median in each run, and its `fast` variant pushes 5 levels about every 0.54 s, see [`websocket.md`](../profiles/hyperliquid/websocket.md).
So a node is also the only path to a 20-level book that changes every block.
The cost is a 128 GB, 16 to 32 core host in Tokyo, an L4 to L2 book builder the engine does not have, and about 100 GB of logs a day to rotate.
The engine does not need a node to observe Hyperliquid, and the node is a later latency option.

## 3. HIP-3 builder-deployed perpetual dexes

### 3.1 What a builder dex is

| rule | value | source |
|---|---|---|
| who deploys | anyone staking 500k HYPE, kept at least 183 days, one dex per deployer | S12 spec 1 and 2 |
| what the deployer sets | market definition, oracle definition, oracle prices, leverage, and settlement | S12 |
| dex name | 2 to 4 lowercase characters | S13 `RegisterAsset2` |
| coin name | always `{dex}:{coin}` | S14 |
| asset id | `100000 + perp_dex_index * 10000 + index_in_meta`, so the first builder dex starts at 110000 | S14 |
| collateral | any permissionless quote asset | S12 spec 3 |
| settlement | `haltTrading` cancels all orders and settles positions at the mark, and the same action resumes trading | S12 |
| oracle updater | `oracleUpdater`, or the deployer when it is null, plus `setOracle` sub-deployers | S13 `PerpDexSchemaInput`, P1 |
| `setOracle` cadence | at least 2.5 s between calls, "Deployers are expected to call setOracle every 3 seconds" | S13 `SetOracle` |
| stale oracle | "Stale mark prices will be updated to the local mark price after 10 seconds of no updates" | S13 `SetOracle` |
| mark | median of 0 to 2 deployer `markPxs` lists and the local mark, which is the median of best bid, best ask and last trade | S13 `SetOracle` |
| clamps | every price clamped to 10 times the start of day value, and each `markPx` move clamped to 1 % from the previous one | S13 `SetOracle` |
| funding | multiplier 0 to 10, 8 hour interest rate -0.01 to 0.01, 8 hour clamp 0 to 0.01 with a default of 0.0003 | S13 |
| cross margin | validators review a slash each time `externalPerpPx` moves more than 50 % from the start of day | S12 |

The protocol does not check the oracle.
"While the oracle is completely general at the protocol level", the deployer is only answerable through slashing by validator vote, S12.

### 3.2 The dexes on 2026-09-24

From `perpDexs`, `allPerpMetas`, `spotMeta` and `metaAndAssetCtxs`, P1.
"live" counts universe entries without `isDelisted: true`.

| index | name | full name | collateral | listed | live | oracle updater | `setOracle` signers | 24 h volume, USD | CCXT loads it by default |
|---|---|---|---|---:|---:|---|---:|---:|---|
| 0 | main | validator-operated | USDC | 234 | 178 | validators, S3 | | 9.59 to 9.61 bn | yes |
| 1 | `xyz` | XYZ | USDC | 124 | 109 | deployer | 1 | 2.09 to 2.10 bn | yes |
| 2 | `flx` | Felix Exchange | USDH | 16 | 0 | `0x94757f8dcb4bf73b850195660e959d1105cfedd5` | 2 | 0 | yes |
| 3 | `vntl` | Ventuals | USDH | 15 | 0 | deployer | 1 | 0 | yes |
| 4 | `hyna` | HyENA | USDE | 25 | 0 | `0xaab93501e78f5105e265a1eafda10ce6530de17e` | 2 | 0 | yes |
| 5 | `km` | Markets by Kinetiq | USDH | 23 | 0 | deployer | 1 | 0 | yes |
| 6 | `abcd` | ABCDEx | USDC | 1 | 0 | deployer | 0 | 0 | yes |
| 7 | `cash` | dreamcash | USDT0 | 17 | 0 | deployer | 2 | 0 | yes |
| 8 | `para` | Paragon | USDC | 36 | 27 | the deployer's own address | 2 | 5.09 to 5.14 m | yes |
| 9 | `mkts` | Markets By Kinetiq | USDC | 24 | 4 | deployer | 2 | 14.1 to 14.3 m | yes |
| 10 | `io` | EntropyIO | USDC | 10 | 8 | `0x94757f8dcb4bf73b850195660e959d1105cfedd5` | 1 | 25.0 to 25.1 m | no |

Every dex whose collateral is not USDC is retired, with all of its assets delisted.
`km` and `mkts` share the deployer `0x71f0019cc7fa79e4f42587fb7b9a817d8d2429ec`, so Kinetiq moved from USDH to USDC collateral on a new dex, an inference from the address.
`io` names the same oracle updater as the retired `flx`, so one key runs the oracle of two dexes.
PANews reports that Felix closed its dex on 19 and 20 June, that Ventuals is winding down, and that trade.xyz holds about 90 % of HIP-3 volume, S26.
The wire agrees: `xyz` carries 2.09 to 2.10 bn of the 2.13 to 2.14 bn builder volume.
A retired dex still answers, and its oracle is frozen: `flx:TSLA` showed `oraclePx` 400.53, `markPx` 395.5, no `midPx` and open interest 0, and none of the 16 `flx` oracles changed across the P3 socket.

The live builder markets are equity, commodity, FX and index contracts, not crypto tokens.
`xyz` lists US and Asian stocks, `GOLD`, `SILVER`, `CL`, `BRENTOIL`, `JPY`, `EUR`, `SP500` and `XYZ100`, S24 and P1.
`para` lists crypto market-cap indices `TOTAL2`, `OTHERS` and `BTCD` beside stocks, `mkts` lists `US500`, `USBOND`, `SMALL2000` and `USTECH`, and `io` lists pre-IPO `OAI` and `ANTH` beside stocks, P1.

### 3.3 How the names look

| where | main dex BTC | builder dex | source |
|---|---|---|---|
| info and socket coin | `BTC` | `xyz:TSLA` | S14, P3 |
| CCXT `id` | `"0"` | `"110001"`, the asset id | `hyperliquid.js` line 1023, P4 |
| CCXT `symbol` | `BTC/USDC:USDC` | `XYZ-TSLA/USDC:USDC` | `hyperliquid.js` lines 994 to 1003, P4 |
| CCXT `base` | `BTC` | `XYZ-TSLA`, the colon replaced by a dash | `hyperliquid.js` line 994 |
| CCXT `quote` and `settle` | `USDC` | the collateral token, `USDH` on `flx:TSLA` | `hyperliquid.js` line 990, P4 |
| CCXT `baseName` | `BTC` | `xyz:TSLA`, the wire name | `hyperliquid.js` line 1029, P4 |

The CCXT file is `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hyperliquid.js`, the same 4,939-line file the probe loaded from `server/node_modules` before the move.
CCXT loads builder dexes by walking `perpDexs` from index 1 while the index is below `options.fetchMarkets.hip3.limit`, which defaults to 10, at lines 246 to 251 and 597.
So it loads indexes 1 to 9 and skips `io`: P4 counted 318 active swaps, which is 178 main plus 109 `xyz` plus 27 `para` plus 4 `mkts`, and `io`'s 8 live markets were missing.
CCXT marks a delisted builder market `active: false`, so the connector's filter at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server/src/ccxt/connector.ts) line 201 drops the retired dexes.

Two socket behaviours follow from the names, P3.
Subscribing `bbo` to the retired `flx:TSLA` was acked in 106 to 308 ms and then silent, and the socket stayed open, in all three runs.
Subscribing `bbo` to `zzz:BTC`, a dex that does not exist, closed the whole socket with code 1006 after 104 to 117 ms, with no error frame, in all three runs.
The first version of the probe put `zzz:BTC` on the main socket, which closed 604 ms after opening, and that is how this was found.
So one stale or mistyped builder coin takes down every book on its socket.

### 3.4 Ticker collisions

The engine keys a cluster by `base|quote family`, at [`ClusterIndexBuilder.ts`](https://github.com/nemanull/arbitrage-observatory/blob/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server/src/engine/cluster/ClusterIndexBuilder.ts) line 284.
With CCXT's `XYZ-TSLA` bases, no builder market can cluster with any other venue.
If the dex prefix were stripped to reach other venues' stock perps, these bare tickers would meet, P1.

| collision | builder side | other side | effect if prefixes were stripped |
|---|---|---|---|
| `STX` | `para:STX`, oracle 908.73 to 910.0, a stock-priced contract under the Nasdaq ticker of Seagate Technology, not confirmed by a Paragon document | main-dex `STX` at 0.3100 to 0.3104, which Hyperliquid itself compares with Binance and Bybit perps in `predictedFundings` | a false cross of about 2,900 times, inside one venue and against Binance and Bybit |
| `BB` | `xyz:BB`, BlackBerry (NYSE: BB), oracle 8.45 in every run | BounceBit on Binance and Bybit, already `'BB\|USDT'` in `DENIED_PAIRS` | covered by the existing deny line |
| `QNT` | `xyz:QNT`, Quantinuum (Nasdaq: QNT), oracle 50.36 to 50.37 | Quant on Binance and Bybit, already `'QNT\|USDT'` in `DENIED_PAIRS` | covered by the existing deny line |
| one underlying on two live dexes | 11 tickers: `SNDK`, `EWY`, `DRAM`, `NBIS` on `xyz` and `io`, and `AVGO`, `UNITREE`, `IREN`, `NET`, `CRWD`, `RDDT`, `AAOI` on `xyz` and `para` | the other dex | two markets of one venue on one pair, so `marketFilter` has to pick one |
| a live and a retired dex | 27 bare tickers | a frozen retired market | none, because CCXT marks the retired one inactive |
| one underlying, different names | `xyz:SP500` against `mkts:US500`, `xyz:GOLD` against Gate's `XAU_USDT` | | no cluster forms, a missed pair rather than a false row |
| spot token names | 19 bare tickers such as `TSLA`, `NVDA`, `COIN` and `EUR` are also HyperCore spot tokens | spot | none, the engine reads swaps only |

The BB and QNT identities are from S24, and the deny lines are at [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server/src/engine/cluster/clusterOverrides.ts) lines 8 and 10.
The first run's OKX `BB-USDT` and `QNT-USDT` index components were `Hyperliquid_Oracle BB/USD 7.7359` and `Hyperliquid_Oracle QNT/USD 50.527`, see [`2026-09-05-first-run-data-audit.md`](../audits/2026-09-05-first-run-data-audit.md) lines 113 to 119.
Those prices match today's `xyz:BB` and `xyz:QNT` scale, so two of the engine's first ticker collisions were OKX stock perps priced off a HIP-3 deployer's oracle.
The collision check ran against Hyperliquid's own names, the spot tokens and `DENIED_PAIRS` only, because this task calls no other venue.

### 3.5 A deployer-set oracle and the fresh gate

The open gate reads each leg's touch against that venue's own mark, and a standing basis is refused when the anchors explain it, see [`index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md).
That rule fails when the index is the venue's own perp, because the mark trails the perp and the fresh edge reads momentum, see [`2026-09-15-one-self-index-fresh-gate.md`](./2026-09-15-one-self-index-fresh-gate.md).
A HIP-3 oracle is set by the deployer, and trade.xyz documents when it becomes its own book.

| trade.xyz rule | value | source |
|---|---|---|
| external session | "the externally-derived fair price is transmitted as the oracle price" | S22 |
| internal session | "the oracle advances via a continuous-time exponentially weighted moving average that incrementally adjusts the previous oracle price by a fraction of the impact price difference", with a 30 minute time constant | S22 |
| US stock hours | external "24/5, from Sunday 8:00 PM ET to Friday 8:00 PM ET", internal "Friday 8:00 PM to Sunday 8:00 PM ET" and on equity holidays, on the BB, QNT, COIN and NET rows | S24 |
| pre-IPO | `CXMT`, `OURA`, `SHEIN`, `SKHY` and `UNITREE` always run on the internal oracle | S25 |
| mark | median of the oracle, the oracle plus a 150 s EMA of mid minus oracle, and the protocol's median of bid, ask and last trade | S23 |
| relayer clamp | "Relayer updates are clamped to ±50 bps of the current value", on oracle and mark | S23 |

So an `xyz` stock leg has a self-referential index every weekend and holiday, and every pre-IPO leg has one always.
In those hours the oracle follows the dex's own impact prices with a 30 minute lag, which is the binance ONE shape, and the fresh premium on that leg reads the book's own momentum.
A builder mark is recomputed only on a `setOracle` call or on the 10 s fallback, S13.
In P3 runs B and C, `activeAssetCtx` pushed each coin once a second.
The oracles of `xyz:XYZ100`, `xyz:GOLD`, `xyz:CXMT` and `para:BTCD` changed with median gaps of 3,027 to 4,094 ms and never less than 2,028 ms apart, which fits the 2.5 s floor between `setOracle` calls seen through 1 s samples.
Their marks never changed twice within 2,028 ms either.
The main-dex oracles of BTC and ETH changed with median gaps of 3,872 to 5,194 ms, and once 990 ms apart.
A 1 % clamp per mark move, and a 50 bps clamp per relayer update on `xyz`, make a crashing builder leg read capped, the shape [`saturated-anchor.md`](../bestiary/saturated-anchor.md) describes on kraken.
The `xyz` oracle is set by its deployer or its one `setOracle` sub-deployer, P1, and if updates stop for 10 s the mark falls back to the local book mark, S13.
P1 read the live builder dexes in the external session, on Thursday between 06:30 and 06:55 UTC, with `xyz` absolute mark over oracle at a 392 to 444 ppm median and a 1,847 to 2,015 ppm p90.
The weekend was not probed, because the task forbids waiting for a clock event.

The same property leaks into centralised venues' anchors.
OKX priced BB and QNT off the Hyperliquid oracle, as above.
Gate's stock baskets list `Hyperliquid:XYZ` and 14 crypto baskets list `HyperliquidFutures`, at [`../profiles/gate/rest.md`](../profiles/gate/rest.md) lines 169, 170, 181 and 195.
MEXC has single-source stock contracts on `HYPERLIQUID`, at [`../profiles/mexc/rest.md`](../profiles/mexc/rest.md) line 204.
Bitget, Ourbit, Biconomy, Crypto.com's `CLUSD-INDEX`, Deribit's HYPE index and the Orderly `hyperliquidperp` source carry Hyperliquid too, at [`../profiles/bitget/rest.md`](../profiles/bitget/rest.md) line 186, [`../profiles/ourbit/rest.md`](../profiles/ourbit/rest.md) line 157, [`../profiles/biconomy/rest.md`](../profiles/biconomy/rest.md) line 129, [`../profiles/cryptocom/rest.md`](../profiles/cryptocom/rest.md) line 167, [`../profiles/deribit/rest.md`](../profiles/deribit/rest.md) line 148 and [`../profiles/nonkyc/rest.md`](../profiles/nonkyc/rest.md) lines 108 and 109.
A cross between Hyperliquid and a contract whose basket is Hyperliquid alone compares one number with itself.

The main dex's oracle is different in kind.
Validators publish every 3 s a weighted median of Binance, OKX, Bybit, Kraken, KuCoin, Gate, MEXC and Hyperliquid spot mids, weights 3, 2, 2, 1, 1, 1, 1 and 1, and the clearinghouse takes the stake-weighted median of the validators' prices, S3.
Assets whose main spot market is elsewhere leave Hyperliquid spot out, and assets whose main spot market is Hyperliquid, such as HYPE, use no external source "until sufficient liquidity is met", S3.
So HYPE's index can be Hyperliquid's own spot book alone, which is a venue-own index though not the perp, and whether HYPE has passed that liquidity bar is not published.
The index and mark formulas as the anchor reads them are in [`rest.md`](../profiles/hyperliquid/rest.md).

## 4. Spot, perps and the USDC settlement asset

| item | value | source |
|---|---|---|
| main-dex collateral | USDC, token index 0 | P1 |
| USDC on HyperCore | "natively minted on the Hyperliquid L1", reached through Circle CCTP, with the legacy Arbitrum bridge under 10 % of supply | S5 |
| builder collateral seen | USDC on `xyz`, `para`, `mkts`, `io` and the retired `abcd`, and USDH (token 360), USDE (235) and USDT0 (268) on the other retired dexes | P1 |
| CCXT quote | `USDC` on every main perp, and the collateral name on a builder market | `hyperliquid.js` line 990, P4 |
| engine quote family | USD and USDC sit under the USDT key | [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server/src/engine/cluster/quoteFamily.ts) lines 3 to 6 |
| spot pairs | 330, of which 313 quote USDC, 11 USDH, 5 USDT0 and 1 USDE | P1 |
| spot naming | `PURR/USDC`, then `@<index>` for every other pair, and wrapped tokens such as `UBTC` show as `BTC` in the app | S16 |
| spot in the engine | out of scope, the connector keeps swaps only | [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server/src/ccxt/connector.ts) lines 196 to 203 |

`BTC/USDC:USDC` lands on `BTC|USDT` and clusters with Binance `BTCUSDT`, like every USDC-margined venue under [`2026-09-06-quote-family-design.md`](../implemented/2026-09-06-quote-family-design.md).
A builder dex on USDH, USDE or USDT0 would form a cluster of its own, because none of those names is in the family.
All three are retired today, so that is a watch item, not a change.
Hyperliquid spot matters to the engine only through the oracle, since it is one of eight inputs and the whole index for HYPE-like assets, S3.

## 5. Survey venues that route perpetuals to Hyperliquid

[`2026-09-22-venue-survey.md`](./2026-09-22-venue-survey.md) was searched for Hyperliquid and HyperCore.

| venue | survey line | what routes | public book or API | source |
|---|---|---|---|---|
| VALR | 115 | VALR Perps, USDC, "routed to Hyperliquid and its trade[xyz] builder pairs", every order IOC, VALR fee 0.055 % plus a provider fee, funding passed through "generally every hour" | none, Perps v1 is REST only and signed | [`../profiles/valr/fees.md`](../profiles/valr/fees.md) lines 10, 35, 48 and 109, [`../profiles/valr/websocket.md`](../profiles/valr/websocket.md) line 20 |
| Blockchain.com | 181 | the app's Perps tab, "Trading happens within Hyperliquid", through a non-custodial wallet | none | [`../profiles/blockchaincom/fees.md`](../profiles/blockchaincom/fees.md) line 49 |
| Paribu | 185 and 4010 to 4034 | mobile-app DeFi perpetuals on "HyperCore", Hyperliquid by inference from the name | none | [`../profiles/paribu/fees.md`](../profiles/paribu/fees.md) lines 68 and 69 |
| Bitso | 78 and 535 to 536 | a web-app "Perps" entry behind the flag `defi-alpha-hyperliquid-perps-support`, announced as a Perps Aggregator, not seen live | none | [`../profiles/bitso/fees.md`](../profiles/bitso/fees.md) line 60 |
| Bilaxy | not a product | a testnet dashboard in the site bundle posts to `api.hyperliquid-testnet.xyz` | none | [`../profiles/bilaxy/fees.md`](../profiles/bilaxy/fees.md) line 49 |

None of these routers has a public book, so none enters the catalog, and the engine sees each of them zero times.
If one ever published a book, it would be Hyperliquid's book seen again, plus the router's fee.
A cross between that venue and Hyperliquid, or between two routers, would be the same orders twice and never an arbitrage.
The engine would then need a "same book as" link per venue so the cluster keeps only one of them.

## 6. Who may use Hyperliquid

Reading needs nothing.
Every info call and socket in P1 to P4 answered from the Canadian exit without a key, an account or a wallet.
The public limits are per IP: 1,200 weight a minute, 10 sockets, 30 new sockets a minute, 1,000 subscriptions and 2,000 messages a minute, S18.

Trading through the Interface is closed to Restricted Persons, which the Terms of Use define as persons in the United States or Ontario, persons in sanctioned jurisdictions, and citizens of Restricted Territories, and concealing location with a VPN is prohibited.
The quoted clauses, the operator and the dates are in [`fees.md`](../profiles/hyperliquid/fees.md) section 1.
That section also records that the development host sits in the United States, where trading through the Interface is not allowed.
The Foundation non-validator applies the same U.S. and Ontario exclusion to node access, S8.
Each HIP-3 front end, such as trade.xyz, has its own terms, which were not read.

## 7. What trading would later need

Named only, for a future execution stage.

- A wallet: an Ethereum-style private key whose address holds USDC on HyperCore, funded through CCTP or a bridge, S5 and S27.
- Account activation: 1 quote token of fees on the first transfer to a new account, S21.
- API wallets, also called agent wallets: approved by the master account, sign only, cannot be used to query, and pruned on deregistration, expiry or an empty account, S19.
- Nonces: the 100 highest per signer, each new one above the smallest and unused, within `(T - 2 days, T + 1 day)` of the block time, S19.
- Signing: two schemes, `sign_l1_action` and `sign_user_signed_action` in the Python SDK, msgpack field order and trailing zeros matter, S20.
- Address-based limits: 1 action per 1 USDC traded since the address's inception, on top of an initial buffer of 10,000, S18.
- Block ordering: cancels and ALO orders run before IOC and GTC in the same block, S2 and S6.
- Builder dex fees and deployer fee shares, see [`fees.md`](../profiles/hyperliquid/fees.md) section 4.
- A trading entity and host outside the restricted list of section 6.

## 8. What fits the engine as is and what needs a named change

| area | fits as is | named change |
|---|---|---|
| quote family | USDC-settled main perps land under the USDT key | none |
| contract size and linearity | CCXT gives `contractSize` 1 and `linear` true on every market, `hyperliquid.js` lines 1040 and 1044 | none from this angle, see [`rest.md`](../profiles/hyperliquid/rest.md) for the size unit |
| raw market id | | the connector stores `market.id` as `rawMarketId`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/132aa9944b03f1c2dbc830f5ee205d2528779ea6/old_ts_server/src/ccxt/connector.ts) line 170, and Hyperliquid's `id` is the numeric asset id while the socket and info use `baseName`, so the Hyperliquid adapter must map `rawMarketId` from `baseName` |
| builder dexes in the catalog | CCXT drops retired dexes as inactive, and its `XYZ-` bases cannot collide with anything | keep builder dexes out of the first integration with a `marketFilter` on `info.hip3`, because CCXT skips `io` and the prefixed bases never cluster anyway |
| builder dexes later | | pass `options.fetchMarkets.hip3.dexes` explicitly, strip the prefix, add `STX\|USDT` to `DENIED_PAIRS` when `para` is in, pick one dex per ticker with `marketFilter`, and add an alias map for `GOLD`, `SP500` and their kin |
| fresh gate on builder legs | the main dex's validator oracle is an external spot median, except for HYPE-like assets | refuse builder legs whose oracle runs internally: always on the pre-IPO names, and on `xyz` stocks from Friday 8 PM to Sunday 8 PM ET and on holidays |
| capped builder mark | | treat a builder mark that moved by the 1 % protocol clamp, or 50 bps on `xyz`, as saturated, the shape [`saturated-anchor.md`](../bestiary/saturated-anchor.md) describes on kraken |
| index baskets holding Hyperliquid | | once Hyperliquid is a venue, a cross against a MEXC, Gate or OKX contract whose basket is Hyperliquid alone is self-referential across venues, so those contracts need a basket check or a deny line |
| timestamps | every `bbo`, `l2Book` and `trades` frame carries block time, and arrival is about 0.25 s later from here, inside the 5 s skew and 10 s age windows | optional: store block time beside arrival as the venue's own clock |
| socket safety | | build the subscription list from the same `allPerpMetas` snapshot as the catalog, because one unknown dex coin closes the whole socket |
| data source | the public API and socket are enough to observe | a Tokyo node with 128 GB RAM and an L4 to L2 book builder is a later latency option, not a prerequisite |
| routing venues | none has a public book, so nothing enters the catalog | a "same book as" link if a router ever publishes a book |

## 9. Source ledger

| id | source | URL | retrieved | used for |
|---|---|---|---|---|
| S0 | About Hyperliquid | https://hyperliquid.gitbook.io/hyperliquid-docs | 2026-09-23 | one-block finality |
| S1 | HyperCore overview | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/overview | 2026-09-23 | consensus, latency, throughput |
| S2 | Order book | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/order-book | 2026-09-23 | ordering inside a block |
| S3 | Oracle | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle | 2026-09-23 | validator oracle sources and weights |
| S4 | API servers | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/api-servers | 2026-09-23 | what an API server is |
| S5 | USDC | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/usdc | 2026-09-23 | native USDC, CCTP, legacy bridge |
| S6 | Optimizing latency | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/optimizing-latency | 2026-09-23 | node specs, commit, split client blocks, cancel priority |
| S7 | L1 data schemas | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/nodes/l1-data-schemas | 2026-09-23 | node output formats |
| S8 | Foundation non-validating node | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/nodes/foundation-non-validating-node | 2026-09-23 | `apne1-az1`, eligibility |
| S9 | Foundation non-validating node for infra providers | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/nodes/foundation-non-validating-node-for-infra-providers | 2026-09-23 | peering providers, price benchmark |
| S10 | `hyperliquid-dex/node` README, main branch | https://github.com/hyperliquid-dex/node | 2026-09-23 | machine specs, flags, info server, root peers |
| S11 | Running a validator | https://hyperliquid.gitbook.io/hyperliquid-docs/validators/running-a-validator | 2026-09-23 | active set of 27 |
| S12 | HIP-3: Builder-deployed perpetuals | https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals | 2026-09-23 | stake, collateral, settlement, slashing |
| S13 | HIP-3 deployer actions | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions | 2026-09-23 | `SetOracle` rules and clamps, funding bounds |
| S14 | Asset IDs | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids | 2026-09-23 | coin names and asset ids |
| S15 | Info endpoint, perpetuals | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals | 2026-09-23 | `perpDexs`, `allPerpMetas`, `perpDexLimits` |
| S16 | Info endpoint | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint | 2026-09-23 | spot coin naming |
| S17 | WebSocket subscriptions | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions | 2026-09-23 | frame types and their `time` fields |
| S18 | Rate limits and user limits | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits | 2026-09-23 | IP weights, socket limits, address limits |
| S19 | Nonces and API wallets | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets | 2026-09-23 | agent wallets, nonce rule |
| S20 | Signing | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing | 2026-09-23 | signing schemes |
| S21 | Activation gas fee | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/activation-gas-fee | 2026-09-23 | new account fee |
| S22 | trade.xyz, Oracle Price | https://docs.trade.xyz/perpetuals/mechanics/oracle-price | 2026-09-23 | external and internal oracle |
| S23 | trade.xyz, Mark Price | https://docs.trade.xyz/perpetuals/mechanics/mark-price | 2026-09-23 | mark components, 50 bps clamp |
| S24 | trade.xyz, Specification Index | https://docs.trade.xyz/perpetuals/specifications-and-schedules/specification-index | 2026-09-23 | BB, QNT, COIN, NET identities and session hours |
| S25 | trade.xyz, Pre-IPO Perpetuals and Pre-IPO Specification Index | https://docs.trade.xyz/perpetuals/markets/pre-ipo-perpetuals | 2026-09-23 | pre-IPO names on the internal oracle |
| S26 | PANews, "The watershed moment for HIP-3" | https://panews.io/articles/019ecf58-5c89-7115-b50c-3ba9359c11cd | 2026-09-23 | Felix and Ventuals closures, trade.xyz share |
| S27 | `hyperliquid-dex/hyperliquid-python-sdk`, `info.py` and `utils/types.py` | https://github.com/hyperliquid-dex/hyperliquid-python-sdk | 2026-09-23 | request and subscription type names |

| id | probe | when, UTC | what it recorded |
|---|---|---|---|
| P1 | [`dex-probe.mjs`](../../scripts/probes/venues/hyperliquid/dex-probe.mjs) `dexes` | 2026-09-24, four runs between 06:32 and 06:50, and the last at 06:54:02 | the dex table, the ctx summaries, the collisions |
| P2 | `lag` | run A at 06:36:51, run B at 06:51:19 | round trip, state age, root peers |
| P3 | `socket` | runs A and B between 06:38 and 06:50, run C at 06:52:26 | block spacing, push delay, oracle cadence, bad coins |
| P4 | `ccxt` | between 06:44 and 06:50, at 06:53:45, and at 06:56:58 after the move | CCXT names, ids, quotes, the missing `io` |
