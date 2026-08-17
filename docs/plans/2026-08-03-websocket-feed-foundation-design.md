# WebSocket feed foundation design

Status: Accepted.
Date: 2026-08-03.
Rewritten 2026-08-04, when the quote boundary was removed and `submit` was given a body.

## 1. Purpose

This document defines the `VenueFeed` contract in `server/src/ws/ws.ts`.
It records which parts of a venue feed are venue-specific and which are shared, and where a normalized quote lands.

The foundation deliberately contains no socket opening, no reconnect loop, no keepalive timer, and no chunker.
Section 7 lists what is deferred and why.

## 2. The shape

Three things differ between venues, and they are the three abstract members.
Everything else is either a constant the shared code reads, or shared code itself.

```ts
export abstract class VenueFeed {
  public abstract readonly venueId: string;
  public abstract readonly spec: VenueSpec;

  public unknownSymbols = 0;

  constructor(protected readonly index: ClusterIndex) {}

  public abstract getAllEndpoints(markets: Market[]): EndpointPlan[];
  public abstract getSubscribeFrames(markets: Market[]): object[];

  protected abstract handleMessages(raw: Buffer, connection: VenueConnection): void;

  protected submit(connection: VenueConnection, quote: NormalizedQuote): void { /* section 4 */ }
}
```

The reason only three members are abstract is recorded in [`../research/2026-07-30-venue-ws-protocol-differences.md`](../research/2026-07-30-venue-ws-protocol-differences.md).
That research enumerates sixteen axes on which the five venues differ.
Thirteen of them differ as data, which `VenueSpec` carries.
Three of them differ as behaviour, which is why there are three abstract methods and not thirteen.

## 3. The three venue-specific members

### 3.1 `getAllEndpoints`

It decides which URLs to connect to and which markets belong to each one.
It returns a list because no venue puts everything on one socket once more than one channel is needed.
Binance splits by data class, Bybit by market family, and OKX by channel class, per section 2 of the research doc.

```ts
public getAllEndpoints(markets: Market[]): EndpointPlan[] {
  return [{ url: 'wss://stream.bybit.com/v5/public/linear', markets }];
}
```

One logical endpoint may later become several physical connections.
The chunker will split a plan when the venue's topic budget is reached.
That split is driven by `VenueSpec.chunk` and does not belong in this method.

### 3.2 `getSubscribeFrames`

It converts the markets assigned to one connection into that venue's subscription objects.
Five venues use five genuinely different shapes, listed in section 3 of the research doc.

```ts
public getSubscribeFrames(markets: Market[]): object[] {
  return [{ op: 'subscribe', args: markets.map((m) => `orderbook.1.${m.rawMarketId}`) }];
}
```

It returns objects rather than strings so that `VenueSpec.sign` can rewrite a frame before it is serialized.
Only Coinbase International needs that, per section 7 of the research doc.

Binance is the case that breaks the obvious assumption.
Its `!bookTicker` firehose carries the subscription in the URL, so its implementation returns an empty array and ignores its argument.
Frame count does not scale with market count on every venue.

### 3.3 `handleMessages`

It understands one venue's inbound wire format.
It drops acknowledgements and other non-quote frames, parses the quotes it recognises, and calls `submit` once per quote.

```ts
protected handleMessages(raw: Buffer, connection: VenueConnection): void {
  const message = JSON.parse(raw.toString());
  if (!message.topic?.startsWith('orderbook.1.')) return;

  this.submit(connection, {
    rawMarketId: message.data.s,
    bid: Number(message.data.b[0][0]),
    ask: Number(message.data.a[0][0]),
    receivedAtMs: Date.now(),
  });
}
```

It returns `void` rather than a quote or an array of quotes.
One inbound frame produces zero quotes on an acknowledgement, one on Bybit, and several on an OKX `data` array.
Returning an array would allocate one per message, and most of them would be empty.

It is `protected` because only the feed's own connection code should call it.
It is abstract because the routing key sits in a different place on all five venues, per section 8 of the research doc.

## 4. `submit`

`submit` is concrete, because every venue crosses the same boundary once its message is parsed.
It resolves the venue's wire symbol to a `Slot` and writes the quote into that slot's cluster.

The implementation is at `server/src/ws/ws.ts:26-42`.

```ts
protected submit(connection: VenueConnection, quote: NormalizedQuote): void {
  const slot = this.index.idBySymbol.get(this.venueId)?.get(quote.rawMarketId);

  if (slot === undefined) {
    this.unknownSymbols++;
    return;
  }

  const { cluster, i } = slot;

  cluster.bid[i] = quote.bid;
  cluster.ask[i] = quote.ask;
  cluster.recvTs[i] = quote.receivedAtMs;
}
```

Three things in those nine lines are load bearing.

**The lookup is keyed on the venue first.**
`idBySymbol` at `server/src/engine/types.ts:28-32` is a map of venue to a map of wire symbol to slot.
The two levels are not decoration.
`BTCUSDT` is a Binance market and a different Bybit market, so the wire symbol alone cannot identify a slot.
The feed supplies the venue from its own `venueId`, so nothing has to be threaded through the message.

**The index is read through `this.engine`, not captured.**
Section 5 explains why.

**An unresolved symbol is counted, not thrown.**
Binance delivers the whole market on `!bookTicker`, so a miss is the normal case there and an error on the other four venues.
`VenueSpec.unknownSymbolIsExpected` is the flag that tells the two apart when this counter is reported.

`connection` is currently unused by the write.
It is kept in the signature because the connection lifecycle needs it for the invalidation path in section 7.

## 5. Why the feed can hold the index directly

A feed captures the `ClusterIndex` at construction and keeps it for the life of the process.
That is safe only because the index object is never replaced, which is what this section establishes.

Holding a reference to an object gives you that object forever.
It does not give you whatever the previous owner points at later.
So if refresh rebuilt the index and reassigned the owner's field, every feed would keep the object it was handed at construction.
It would write into arrays no comparator reads, and resolve every newly listed market as an unknown symbol.
Nothing would throw and nothing would log, so the feed would report as healthy while it was blind.

The index is therefore mutated in place and never reassigned.
This replaces decision 10 of [`./2026-07-31-instrument-index-design.md`](./2026-07-31-instrument-index-design.md), which rebuilt the index into new arrays and swapped the reference.

### 5.1 What makes in place refresh possible

The only refresh event that ever forced a reallocation was a cluster gaining a member, because a `Float64Array` cannot grow.

The venue set is fixed for the life of the process.
Adding or removing a venue means adding or removing a `VenueFeed` subclass, which is a deploy and a restart.
So the largest a cluster can ever be is the venue count, and that number is known when the index is built.

Every cluster is therefore allocated at full venue width.
No cluster has to grow, so no array has to be replaced.

A venue that does not list a pair holds a zero receive timestamp in its slot.
That is indistinguishable from a venue that has not spoken yet, which decision 9 of the instrument index design already skips.
Full width allocation needs no new mechanism to express an empty slot.

### 5.2 Every refresh event as a mutation

| event | operation |
|---|---|
| a new pair is listed on two or more venues | build the cluster fully, then push it onto `clusters`, then add its `idBySymbol` entries |
| an existing pair is listed on one more venue | one `idBySymbol` set, because the slot already exists at a zero receive timestamp |
| a market is delisted | delete the `idBySymbol` entry first, then zero the receive timestamp |
| a taker fee changes | one write into `bidMul` and one into `askMul` |
| a venue is added or removed | restart |

Each row is one operation, or a sequence whose order is stated.
A new cluster is fully built before anything can reach it, so a comparator that sees it early sees only zero receive timestamps and makes no comparison.
A delisted market has its lookup entry removed before its timestamp is zeroed, so no quote can arrive between the two steps.

In place refresh also deletes work.
Rebuild and swap had to carry every live quote from the old index into the new one, which is the nested loop in section 6 of the instrument index design.
Mutation disturbs no quote, so that loop is not needed at all.

### 5.3 What `readonly` does and does not do

`readonly` is a type annotation.
It is erased at compile time and the emitted JavaScript is unchanged, so it costs nothing at runtime.
It is not `Object.freeze`, which is a runtime operation and would reject the hot path writes.

It forbids replacing a property, not writing through it.

```ts
cluster.bid[i] = quote.bid;   // allowed, and is the hot path
cluster.bid = newArray;       // rejected
```

That is the correct statement for this design.
The shape of a cluster is fixed once it is built, and the numbers inside it are live.

The load bearing use is on the field that owns the index.

```ts
class Engine {
  readonly index: ClusterIndex;
}
```

A later `this.index = next` is then a compile error, rather than a silent return of the stale reference failure described above.

## 6. `WSVenueLogic`

`WSVenueLogic` at `server/src/ws/ws.ts:45-49` owns the collection of feeds that the composition root builds.

```ts
const logic = new WSVenueLogic([
  new BinanceFeed(index),
  new BybitFeed(index),
  new OkxFeed(index),
]);
```

It holds only the array today, and the class is a placeholder until it does more.
What it will own is the work that is genuinely process wide rather than per venue.
Starting and stopping every feed is the first of those.
The handshake budget is the second, because the venue rate limits in section 6 of the research doc are per IP, so five feeds reconnecting at once breach a limit that each of them respects alone.

It will never see a raw message.
Each socket is already owned by one feed, so that feed calls its own `handleMessages` without a venue lookup on the hot path.

## 7. Deferred

None of the following exists yet.
Each one is listed with the field or the research section that already specifies it, so none of them has to be rediscovered.

| deferred | already specified by |
|---|---|
| socket opening, with compression and UTF-8 validation disabled | section 12 of the research doc |
| `start` and `stop` for one feed, and for `WSVenueLogic` | this doc, section 6 |
| jittered backoff and reconnect, floored by the venue handshake rate | section 6 of the research doc |
| resubscribe after reconnect, deferred to the next reconnect on OKX | section 6.1 of the research doc |
| marking every market on a dropped connection stale before reconnecting | section 12 of the research doc |
| keepalive timer and its four modes | `VenueSpec.keepalive` |
| idle and pong watchdog, which is separate from sending keepalive | section 5 of the research doc |
| connection splitting by topic budget | `VenueSpec.chunk` |
| frame signing before serialization | `VenueSpec.sign` |
| first subscribe deadline | `VenueSpec.firstSubscribeDeadlineMs` |
| proactive reconnect before the venue drops the socket | `VenueSpec.maxConnectionAgeMs` |
| handshake pacing | `minHandshakeIntervalMs`, in section 13 of the research doc and not yet in `VenueSpec` |
| a control message hook, for OKX notice `64008` and Bybit `u` equal to 1 | section 15 of the research doc |
| subscribe acknowledgement and error handling | section 9 of the research doc |
| the ordering guard, keyed on a sequence `NormalizedQuote` does not carry yet | section 10.5 of the research doc |
| the unchanged quote check, which refreshes liveness without waking the comparator | section 11 of the research doc |
| top of book sizes, needed before an opportunity can be sized | section 5 of [`./2026-07-31-instrument-index-design.md`](./2026-07-31-instrument-index-design.md) |
| a socket factory seam, so the lifecycle can be tested without a network | this doc, section 8 decision 7 |

Two of these are correctness rather than completeness, and should land with the lifecycle rather than after it.

Marking a dropped connection stale is the first.
Without it a dead socket leaves its last prices in `cluster.bid` and `cluster.ask` until they age out.
Those frozen prices diverge from the live venues during exactly the seconds a real move is happening, which is when a fictional opportunity is published.

The control message hook is the second.
OKX notice `64008` is a warning about 60 seconds before the venue closes the socket, and Bybit `u` equal to 1 means the book being held is void.
Both are in band signals that change connection state rather than quote state, so neither belongs in `handleMessages`.

## 8. Decisions

1. `VenueFeed` is the only abstract class in this foundation.
2. Endpoint planning, subscription frame construction, and message parsing are the three abstract members, because they are the only three axes that differ as behaviour.
3. `VenueSpec` carries the thirteen axes that differ as data, and shared code reads it.
4. `submit` is concrete and writes into the cluster arrays directly.
   The feed layer therefore owns the hot path write, and the engine owns the comparison.
5. A feed resolves its slot with its own `venueId` and the wire symbol, in that order, because a wire symbol alone is ambiguous across venues.
6. The index object is never replaced.
   Refresh mutates it in place, so a feed can hold it directly and no indirection is needed on the hot path.
   This is possible because the venue set is fixed at boot, so every cluster is allocated at full venue width and never has to grow.
7. `Cluster` and `ClusterIndex` fields are `readonly`, which forbids replacing an array while still allowing the hot path to write into one.
   The owner declares `readonly index`, which makes reintroducing the swap a compile error.
8. The socket factory will be injected when the lifecycle is written, so that the lifecycle can be tested without a network.
   Deciding this before `connect` exists is one line.
   Deciding it after is a rewrite of every lifecycle method.
9. `WSVenueLogic` coordinates feeds and never sees a raw message.
10. `getSubscribeFrames` returns objects rather than strings, so signing happens before serialization.
11. The foundation ships no placeholder socket, keepalive, or retry code.

## 9. Rejected alternatives

### 9.1 An injected quote handler between the feed and the index

The previous version of this design gave `VenueFeed` a `QuoteHandler` callback and had `submit` call it.
The engine would then own the resolve and the write.

Rejected because it did not remove a dependency, it renamed one.
The feed needs a constructor argument either way, and the `ClusterIndex` is a narrower thing to be handed than a callback that closes over the same index.
The write is nine lines, and a boundary that exists to relocate nine lines is not paying for itself.

The consequence is recorded as decision 4 and is accepted.
The guards that section 12 of the research doc places in the shared engine now land in `submit` rather than in the engine.

### 9.2 Rebuilding the index and swapping the reference

This is decision 10 of [`./2026-07-31-instrument-index-design.md`](./2026-07-31-instrument-index-design.md), and section 5 replaces it.

Its advantage was that refresh reused the boot time build function, so there was one code path and no ordering to reason about.
Rejected because the swap is invisible to anything already holding the old index.
Every holder then needs either an indirection on the hot path or a rewiring step on refresh, and both exist only to serve the swap.

Its cost was also larger than it looked.
A swap has to carry every live quote from the old index into the new one, which mutation does not.

### 9.3 An indirection so that a swap stays safe

The feed would hold a small `{ readonly index: ClusterIndex }` and read `index` on every message, picking up whichever object the owner currently points at.

Rejected together with 9.2.
It is correct and it costs only one property load, but once the index is never replaced there is nothing for it to protect against.

### 9.4 Re-injecting the index into every feed on refresh

Rejected because it is manual wiring that has to be remembered for every new feed.
It also reintroduces a window where a feed exists but is not yet pointed at an index.

### 9.5 Compacting a cluster when a market is delisted

Compaction moves a surviving market to a lower slot, which changes the `i` inside its `Slot`.
Rejected because a feed can already be inside `submit`, holding a destructured `i` that now belongs to a different market.
A delisted market instead keeps its slot, loses its `idBySymbol` entry, and holds a zero receive timestamp.
Holes accumulate slowly, and a restart clears them.

### 9.6 `Object.freeze` on the index or the clusters

Rejected because it is a runtime operation rather than a type annotation.
It would reject the hot path writes into the quote arrays, which is the opposite of what is wanted.
`readonly` expresses the intended rule and costs nothing.

### 9.7 A separate abstract class per subsystem

Rejected because keepalive, chunking, and reconnect are shared operations driven by `VenueSpec`.
Splitting them into abstract classes adds structure without adding capability.

### 9.8 Concrete venue adapters in this foundation

Rejected so that the base contract compiles and is understood before five venues depend on it.

### 9.9 A `start` that throws until the lifecycle exists

Rejected because a callable method that cannot work is a worse signal than an absent one.

## 10. What is verified

`server/src/ws/ws.spec.ts` covers five behaviours of `submit`.

1. A quote is written into the slot for the feed's own venue.
2. A quote is not written into another venue that shares the same wire symbol.
3. An unresolved symbol increments `unknownSymbols` and writes nothing.
4. A market that refresh added after the feed was constructed resolves and is written.
5. A market that refresh removed stops resolving and is counted as unknown.

Tests 4 and 5 are the ones that hold decision 6 in place.
They construct the feed, mutate the index the way refresh will, and assert that the feed sees the change without being rewired.
