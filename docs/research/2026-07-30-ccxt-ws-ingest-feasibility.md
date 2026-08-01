# CCXT Pro WebSocket ingest feasibility

Date: 2026-07-30.
Question: can `ccxt.pro` `watch*` loops carry the live best bid and ask feed for every perpetual swap on five venues, and does throughput depend on the number of subscribed symbols?

Scope of the investigation: CCXT 4.5.68 as installed at `server/node_modules/ccxt`, plus the venue limits already recorded in [`profiles/`](../profiles/).
Every claim below carries a file and line reference.
Claims marked "verified in main context" were read a second time directly, because they decide the architecture.

## 1. Answer to the throughput question

Per-message cost is what matters, not the symbol count by itself.
Subscribing to 1,000 symbols does not poll 1,000 sockets in sequence, because one connection multiplexes many topics.
What scales with symbol count is subscribe-time work, memory for the latest quote per symbol, and the total message rate arriving at one event loop.

The decisive finding is that CCXT's consumer model makes per-message cost scale with the size of the batch you asked for.
That is the opposite of what a market data feed needs.
See section 3.

## 2. Live market counts

Counted with the installed CCXT against public endpoints on 2026-07-30, filter `swap && active !== false`, which matches `isActiveSwapMarket` at `server/src/ccxt/connector.ts:52-59`.

| ccxt id | total markets | active swaps | linear | inverse |
|---|---:|---:|---:|---:|
| `binance` | 4,550 | 742 | 722 | 20 |
| `binanceusdm` | 851 | 722 | 722 | 0 |
| `bybit` | 3,103 | 753 | 731 | 22 |
| `okx` | 4,322 | 432 | 417 | 15 |
| `coinbaseinternational` | 308 | 149 | 149 | 0 |
| `krakenfutures` | 294 | 274 | 270 | 4 |

Total for the five exchanges instantiated at `server/src/ccxt/connector.ts:13-19` is 2,350 active swap markets.
This is the real target, and it is roughly twice the 1,000 figure the question assumed.

## 3. CCXT Pro internals that decide the design

Paths in this section are relative to `server/node_modules/ccxt/js/src/`.

### 3.1 The consumer model rebuilds the whole request on every message

`watchBidsAsks(symbols)` returns after one message.
To keep reading you call it again, and the whole N-symbol request is derived from scratch each time.

- Binance loops all symbols building `subscriptionArgs` and `messageHashes` on every call at `pro/binance.js:2091-2098`, calls `marketSymbols` twice at `pro/binance.js:2032` and `pro/binance.js:2040`, and joins the full symbol list into a stream hash at `pro/binance.js:2117-2119`.
  Verified in main context.
- OKX rebuilds N market ids, N `extend` calls, and N hashes at `pro/okx.js:625-634`.
- Bybit rebuilds market symbols, market ids, topics, and hashes at `pro/bybit.js:641-653`.
- Kraken Futures calls `getMessageHash`, `this.market`, and `subscriptionExistsForHash` once per symbol at `pro/krakenfutures.js:1517-1524`.

`watchMultiple` then builds a `Future.race` over all N hashes at `base/Exchange.js:1411`, which allocates one handler and one unsubscriber closure per hash, and on settle iterates every unsubscriber doing `indexOf` and `splice` at `base/ws/Future.js:64-69` and `base/ws/Future.js:100-102`.
Verified in main context.

Consequence: a batch of 1,000 symbols costs roughly four thousand string and object allocations for every single quote delivered.
This is the dominant cost, well above JSON parsing.
Smaller batches reduce it, which is why the batching advice is directionally right, but the cost never disappears, because it is inherent to the pull-shaped API.

### 3.2 Messages that arrive while you are not awaiting are dropped

`Client.resolve` is a no-op unless a future for that hash exists right now, and it deletes the future after resolving, at `base/ws/Client.js:83-92`.
Verified in main context.
There is no buffering and no coalescing.
The only survivor is the exchange-level cache `exchange.bidsasks[symbol]`.

With `newUpdates` true, which is the default at `base/Exchange.js:162`, each await returns only the symbols carried by the single winning message.
Binance returns a one-key dict at `pro/binance.js:2151-2155`, OKX at `pro/okx.js:640-643`, Kraken Futures at `pro/krakenfutures.js:217-221`.
So a 500-symbol batch yields one symbol per loop iteration, and the rest of that burst is visible only by reading the cache.

This is not a correctness problem for a "latest quote wins" observer.
It is a correctness problem for anything that wants to see every tick.

### 3.3 Concurrent batches are safe, which was worth confirming

All five venues build symbol-scoped message hashes.
Binance at `pro/binance.js:2095`, Bybit at `pro/bybit.js:651`, OKX at `pro/okx.js:633`, Kraken Futures at `pro/krakenfutures.js:1519`.
Two concurrent `watchBidsAsks` loops with different symbol arrays on one instance do not collide or cross-deliver.
Overlapping symbols share one future and both consumers receive the same correct value at `base/ws/Client.js:72-76` and `base/ws/Future.js:53-70`.

Binance additionally shards by batch, because the stream hash is the joined symbol list at `pro/binance.js:2117-2120`, so different batches open different sockets.
That index wraps at `streamLimits` 50 for futures at `pro/binance.js:129-134`, and `streamBySubscriptionsHash` is never freed, so a caller that varies its symbol list will eventually hit the `subscriptionLimitByStream` of 200 at `pro/binance.js:226-228`.

### 3.4 CCXT does not chunk large symbol arrays

None of the five venues split an oversized symbol array into multiple subscribe frames.
Binance sends one frame with all params at `pro/binance.js:2122-2126`.
Bybit sends one `subscribe` with all args at `pro/bybit.js:2314-2322`.
OKX sends one `subscribe` with all args at `pro/okx.js:635-638`.
Kraken Futures sends one frame, and is the only one that subscribes incrementally, skipping already-subscribed products, at `pro/krakenfutures.js:1520-1531`.

So the venue payload caps must be respected by the caller.
Bybit caps the args payload at 21,000 characters per connection at `docs/profiles/bybit/websocket.md:260`.
OKX caps a subscribe payload at 64 KB at `docs/profiles/okx/websocket.md:216`.

### 3.5 The channel CCXT picks is not always the best channel

| venue | channel used by `watchBidsAsks` | evidence | assessment |
|---|---|---|---|
| binance | `<sym>@bookTicker` | `pro/binance.js:2094` | correct and cheap |
| bybit | `orderbook.1.<id>` | `pro/bybit.js:649` | correct channel, expensive handler |
| okx | `tickers` | `pro/okx.js:628-631` | wrong channel, `bbo-tbt` is the fast one |
| krakenfutures | `ticker_lite` | `pro/krakenfutures.js:1527-1531` | omits bid and ask sizes |
| coinbaseinternational | not implemented | `pro/coinbaseinternational.js:30` | `watchTickers` on `LEVEL1` is the fallback |

OKX `bbo-tbt` pushes one-level snapshots every 10 milliseconds and requires no VIP tier, at `docs/profiles/okx/websocket.md:353`.
Verified in main context.
The `tickers` channel CCXT uses instead is a full 24-hour ticker, and `handleTicker` parses the bid and ask a second time at `pro/okx.js:591`.

### 3.6 Two per-message hot spots

Bybit parses the depth-one book into a ticker by calling `sortBy(aggregate(...))` on both sides for every message, at `pro/bybit.js:659-673`, reached from `pro/bybit.js:1046-1052`.
Verified in main context.
It also maintains a full `OrderBook` object per symbol at `pro/bybit.js:1026-1042`.
A latent trap sits in the same function: `sortBy(bids, 0)` sorts ascending, so `bids[0]` would be the worst bid if that helper were ever reused with depth greater than one.

Every inbound frame is converted to a string and then run through `message.replace(/:(\d{15,}),/g, ':"$1",')` before `JSON.parse`, at `base/ws/Client.js:330-332`.
Verified in main context.
That is a full regex scan plus two string allocations per message, on every venue.

Binance and Bybit also allocate a large method-dispatch object literal on every message, at `pro/binance.js:4766-4794` and `pro/bybit.js:2469-2492`.

### 3.7 There is no automatic reconnect

On error or close, `Client.reset` rejects every pending future at `base/ws/Client.js:128-132`, and the exchange deletes the client at `base/Exchange.js:1555-1570`.
The awaiting call throws.
Resubscription only happens because the next call builds a fresh client.
Backoff exists in the signature but every call site passes zero, at `base/Exchange.js:1399` and `base/Exchange.js:1492`, with a `todo` comment.

`unWatchBidsAsks` is not implemented for any of the five venues, and the base throws `NotSupported` at `base/Exchange.js:7754-7763`.

### 3.8 Compression is left on

CCXT passes its options straight to the `ws` constructor at `base/ws/WsClient.js:54`, and `ws` defaults `perMessageDeflate` to true for clients at `node_modules/ws/lib/websocket.js:677`.
Verified in main context.
Every frame therefore pays zlib inflate on any venue that accepts the extension.

### 3.9 The escape hatch exists

`handleMessage` is a plain overridable method bound once per client at `base/Exchange.js:1342` and `base/Exchange.js:1350`.
`exchange.client(url)` returns the live client at `base/Exchange.js:1347`, and `client.send` plus `client.resolve` are usable directly at `base/ws/Client.js:72-93`.
So CCXT can be used as a transport with its parsing bypassed.
The string conversion and the regex at `base/ws/Client.js:330-332` are still paid unless `onMessage` itself is intercepted.

## 4. Venue constraints that shape the connection plan

Sourced from the profiles already in this repo.

| venue | best BBO channel | interval | firehose | endpoint split |
|---|---|---|---|---|
| Binance USD-M | `<sym>@bookTicker` | not published for USD-M, `docs/profiles/binance/websocket.md:366-372` | `!bookTicker`, `docs/profiles/binance/websocket.md:369` | USD-M `fstream` and COIN-M `dstream`, plus `/public/ws` against `/market/ws` data-class routing, `docs/profiles/binance/websocket.md:88` and `:358-361` |
| Bybit | `orderbook.1.{id}` | 10 ms, `docs/profiles/bybit/websocket.md:371` | none, `docs/profiles/bybit/websocket.md:135-147` | linear and inverse are different paths, `docs/profiles/bybit/websocket.md:76-77` |
| OKX | `bbo-tbt` | 10 ms, `docs/profiles/okx/websocket.md:353` | none, `docs/profiles/okx/websocket.md:245-264` | one public path for linear and inverse, `docs/profiles/okx/websocket.md:31-40` |
| Kraken Futures | `ticker` | at most 1 per second, `docs/profiles/kraken/websocket.md:491` | none, `docs/profiles/kraken/websocket.md:502-511` | one `ws/v1` for all futures, `docs/profiles/kraken/websocket.md:65` |
| Coinbase International | `LEVEL1` | real time, no number published, `docs/profiles/coinbase/websocket.md:343` | none, `docs/profiles/coinbase/websocket.md:360-368` | single market data endpoint, `docs/profiles/coinbase/websocket.md:61` |

Limits that bind:

- Binance USD-M allows 1,024 streams per connection and 10 inbound messages per second, `docs/profiles/binance/websocket.md:442-443`, and forces a reconnect every 24 hours, `docs/profiles/binance/websocket.md:435-443`.
  CCXT's own ceiling is lower, 50 streams and 200 subscriptions per stream, `pro/binance.js:128-139`.
- Bybit allows 1,000 connections per IP per category and 500 new connections per 5 minutes, `docs/profiles/bybit/websocket.md:258-259`, with the 21,000 character args cap as the real constraint on a single subscribe.
- OKX allows 3 handshakes per second per IP and only 480 subscribe, unsubscribe, and login operations per connection per hour, `docs/profiles/okx/websocket.md:222-223`.
  Subscription churn is therefore expensive and must be avoided.
- Kraken Futures allows 100 concurrent connections and 100 requests per second per connection, `docs/profiles/kraken/websocket.md:683-684`.
- Coinbase International allows 10 connection attempts per 30 seconds and requires the first subscribe within 3 seconds, `docs/profiles/coinbase/websocket.md:423` and `:374-375`.

Payload and recovery details that matter for arbitrage correctness:

- Binance `bookTicker` carries both the matching-engine time `T` and the event time `E`, `docs/profiles/binance/websocket.md:24-44`.
- Bybit carries both `ts` and the matching-engine `cts`, `docs/profiles/bybit/websocket.md:312-322`, repeats an identical depth-one snapshot with the same `u` after 3 idle seconds, `docs/profiles/bybit/websocket.md:371-374`, and signals a service restart with `u == 1`, `docs/profiles/bybit/websocket.md:359-360`.
- OKX re-emits a `bbo-tbt` snapshot after about 60 idle seconds, `docs/profiles/okx/websocket.md:435-437`.
- Kraken Futures `ticker` resends full state on every push and carries no sequence number, `docs/profiles/kraken/websocket.md:516-537`.
- Coinbase International's `sequence` is session-wide rather than per product, `docs/profiles/coinbase/websocket.md:415-416`.
- Every venue requires a full rebuild after reconnect, with no replay token anywhere.

## 5. Risks found that are not about performance

1. `server/src/ccxt/connector.ts:14` instantiates `binance`, whose `defaultType` is `spot`.
   Per-symbol swap calls still route correctly, because CCXT prefers the market's own type.
   The `!bookTicker` firehose is unreachable, because with no symbols the market type falls back to spot and the code throws `ArgumentsRequired` at `pro/binance.js:2100`.
   Verified in main context.
   Using `binanceusdm` also drops the 20 inverse COIN-M swaps whose limits the profile says must not be inferred from USD-M, `docs/profiles/binance/websocket.md:526-527`.
2. Coinbase International derivatives move to a Deribit-powered gateway on 2026-09-09, with no parallel-running window, `docs/profiles/coinbase/websocket.md:13` and `:426-430`.
   That is 41 days after this research.
   No CCXT id targets the new gateway, and the migration guide and the AsyncAPI spec disagree on the identifier format, `docs/profiles/coinbase/websocket.md:440-442`.
   `coinbaseinternational` also requires API credentials for market data, `pro/coinbaseinternational.js:86`.
3. Cross-venue symbol equality is not instrument equality.
   Kraken Futures perpetuals settle in USD, Coinbase International in USDC, and the others in USDT.
   Comparing them without a stablecoin basis adjustment produces false opportunities.
4. Bybit's `u` on `orderbook.1` is not consecutive and legitimately repeats, `docs/profiles/bybit/websocket.md:363-374`.
   A naive gap detector will fire continuously.
5. OKX sequence rules are documented for the `books` family only, and `bbo-tbt` carries no checksum, `docs/profiles/okx/websocket.md:383-387` and `:454`.
6. Every profile in this repo is documentation-only, with no live capture recorded, `docs/profiles/binance/websocket.md:800-809`.
   Cadence numbers should be confirmed against a real socket before they are trusted in a latency budget.

## 6. Conclusion

CCXT Pro is an excellent REST and metadata layer and a poor high-rate market data consumer.
The pull-shaped `watch*` API forces O(batch size) work per delivered message, drops messages that arrive between awaits, picks a suboptimal channel on two of five venues, does not implement the method at all on a third, leaves compression on, and does not reconnect.
None of these are bugs.
They are the cost of a general-purpose unified API.

A dedicated ingest layer for one channel type is small, because the per-venue work is a subscribe frame builder and a single parse function.
The venue schemas are already documented in [`profiles/`](../profiles/).
The design that follows from this research is recorded in [`plans/2026-07-30-market-data-ingest-design.md`](../plans/2026-07-30-market-data-ingest-design.md).
