# Instrument index design

Status: In progress.
Date: 2026-07-31.


## 1. What this document is for

Section 0 of the design of record put the instrument model, the registry that builds it, and the grouping keyed off it under review.
The stated reason was overcomplexity relative to the reliability it buys.
The stated blocker was that no simpler replacement had been found.

This document is that replacement.
It answers the narrow question section 0 asked, which was which of the eleven registry fields the comparison path actually needs.

The answer is that the field count was never the problem.
The problem was that one structure was being asked to serve two paths with opposite requirements.
Splitting those two paths removes most of the weight without removing any capability.

Decisions here are numbered independently of the design of record.
Where a decision here replaces one there, the replacement is named.

## 2. The split

Two paths exist, and they are not alike.

The cold path runs at startup and on a scheduled market refresh.
It runs a few times a day.
It may use strings, `Map`, plain objects, CCXT, and Prisma freely.
Complexity there costs nothing measurable.

The hot path runs once per inbound WebSocket message.
Section 8 of the design of record budgets 5 microseconds per message at a sustained 50,000 messages per second.
It may use integers indexing flat arrays.
It may perform exactly one string lookup, at the socket boundary, because the venue identifies the market by name and nothing can change that.

Eleven fields per instrument is not overcomplex.
Eleven fields read at message rate is.
So the registry keeps every field it had, in a plain object array that only the HTTP layer and the persistence layer ever read.
It projects the five numbers the comparator needs into typed arrays.

That is the whole simplification.
Everything below is the mechanics of it.

## 3. Decisions

1. **The dense instrument id is private, runtime only, and rebuildable.**
   Nothing durable references it.
   Persistence references `Market.id` at `server/prisma/schema.prisma:102`, which is a database identity and is unaffected by anything here.
   This replaces the id stability requirement in task 2 of the plan, which no longer has a reason to exist.

2. **Ids are assigned in group order, so a group is a contiguous id range.**
   Group `g` owns the ids from `groupStart[g]` to `groupStart[g + 1]`, the upper bound excluded.
   There is no membership list and no adjacency array.
   This replaces the group id assignment in decision 5 of the design of record.

3. **The group key is a string built once and then discarded.**
   It is the base asset joined to the settlement currency.
   It is used to bucket, and it never appears again after ids are assigned.
   This preserves the correctness rule in decision 6 of the design of record, which is that USD, USDC, and USDT settled contracts never share a group.

4. **The raw symbol lookup map is per venue, not shared.**
   A single map keyed on the venue joined to the symbol would build a new string on every message.
   At 50,000 messages per second that is 50,000 allocations per second to avoid one array index.
   The venue is known when the feed is constructed, so the feed holds its own map and never looks the venue up again.

5. **Taker fees are baked into two multiplier columns at build time.**
   `bidMul` holds one minus the taker rate, and `askMul` holds one plus the taker rate.
   The comparator performs no fee lookup and no join.
   A fee change is applied by rebuilding the index, which is a cold path.

6. **Fee multipliers are applied before the best bid and best ask are selected, not after.**
   Taker rates differ across venues, so the highest raw bid is not always the best venue to sell on.
   Because the rate is a per instrument constant, the maximum and the minimum remain separable and the scan stays a single pass.
   Rationale and the failure mode are in section 8.1.

7. **Version one indexes linear contracts only.**
   Inverse contracts quote price in a different unit and size in contracts, so they cannot share a group with a linear contract.
   They are excluded at the filter step rather than handled and then dropped later.

8. **A group with fewer than two members is dropped at build time.**
   It can never produce a comparison.
   The dropped count is logged with a breakdown by reason, because a silent drop here is indistinguishable from a working system.

9. **Staleness is expressed as a zero receive timestamp, not as a flag bit read on the hot path.**
   `markStale` writes zero into `recvTs`, which makes a stale instrument and a never received instrument both fail the same single comparison.
   The flags column in section 4 of the design of record is retained for diagnostics and reporting, and is not read inside the group scan.

10. **Refresh rebuilds the index into new arrays and swaps the reference.**
    Live quotes are carried across by matching the venue and the raw venue id.
    There is no in place mutation of the index, so a partially rebuilt index is never observable.

## 4. The three step construction

The whole build is one function.
It is presented here as three steps with the intermediate data shown after each one, because the shape of the result is not obvious from the code alone.

The worked example uses eight markets across four venues.
The real input is the 2,350 active swap markets recorded at section 1 of the design of record.

### 4.1 The input

This is what `getExchangeSwapMarkets` at `server/src/ccxt/connector.ts:21-49` produces, flattened to one row per market.

```
venue          rawId            symbol           base   settle   taker
binanceusdm    BTCUSDT          BTC/USDT:USDT    BTC    USDT     0.00045
binanceusdm    ETHUSDT          ETH/USDT:USDT    ETH    USDT     0.00045
binanceusdm    SOLUSDT          SOL/USDT:USDT    SOL    USDT     0.00045
bybit          BTCUSDT          BTC/USDT:USDT    BTC    USDT     0.00055
bybit          ETHUSDT          ETH/USDT:USDT    ETH    USDT     0.00055
okx            BTC-USDT-SWAP    BTC/USDT:USDT    BTC    USDT     0.00050
okx            ETH-USDT-SWAP    ETH/USDT:USDT    ETH    USDT     0.00050
krakenfutures  PF_XBTUSD        BTC/USD:USD      BTC    USD      0.00050
```

Two things in this table drive the design.

`BTCUSDT` appears twice and means a different instrument each time.
That is why decision 4 makes the lookup map per venue.

Kraken settles in USD while the other three settle in USDT.
Those are different instruments with different prices, and comparing them reports the stablecoin spread as arbitrage.
That is why decision 3 puts the settlement currency in the group key.

### 4.2 Step 1, bucket by group key

```ts
const buckets = new Map<string, Row[]>();

for (const r of rows) {
  // The settlement currency is part of the key and is never collapsed.
  const key = `${r.base}|${r.settle}`;
  let bucket = buckets.get(key);
  if (!bucket) buckets.set(key, (bucket = []));
  bucket.push(r);
}
```

After step 1:

```
buckets
  'BTC|USDT'   [ binanceusdm BTCUSDT, bybit BTCUSDT, okx BTC-USDT-SWAP ]
  'ETH|USDT'   [ binanceusdm ETHUSDT, bybit ETHUSDT, okx ETH-USDT-SWAP ]
  'SOL|USDT'   [ binanceusdm SOLUSDT ]
  'BTC|USD'    [ krakenfutures PF_XBTUSD ]
```

`BTC|USD` sits apart from `BTC|USDT`, which is the point of the key.

### 4.3 Step 2, drop singletons and sort

```ts
const groups = [...buckets.entries()]
  .filter(([, members]) => members.length >= 2)
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));

// Member order is fixed too, so ids are reproducible across restarts.
for (const [, members] of groups) {
  members.sort((a, b) => (a.venue < b.venue ? -1 : 1));
}
```

After step 2:

```
groups
  0   'BTC|USDT'   [ binanceusdm, bybit, okx ]
  1   'ETH|USDT'   [ binanceusdm, bybit, okx ]

dropped
  'SOL|USDT'   1 member, no venue to compare against
  'BTC|USD'    1 member, no venue to compare against
```

Both sorts exist for reproducibility rather than for speed.
The same market set produces the same ids on every boot, which makes a log line from one run readable against another.

### 4.4 Step 3, walk in group order and assign ids

This is the step that does the work.
Ids are handed out while walking the groups in order, which is what makes a group a contiguous range instead of a list.

```ts
const n = groups.reduce((sum, [, members]) => sum + members.length, 0);
const groupCount = groups.length;

// Cold columns, read by the HTTP layer and by persistence.
const instruments = new Array<Row>(n);

// Hot columns, read at message rate.
const symbolToId = new Map<VenueId, Map<string, number>>();
const group = new Int32Array(n);
const groupStart = new Int32Array(groupCount + 1);
const bidMul = new Float64Array(n);
const askMul = new Float64Array(n);
const sizeMul = new Float64Array(n);
const maxAgeMs = new Float64Array(n);

let id = 0;

for (let g = 0; g < groupCount; g++) {
  groupStart[g] = id;

  for (const r of groups[g][1]) {
    instruments[id] = r;
    group[id] = g;
    bidMul[id] = 1 - r.takerPpm / 1e6;
    askMul[id] = 1 + r.takerPpm / 1e6;
    sizeMul[id] = r.contractSize;
    maxAgeMs[id] = STALENESS_MS[r.venue];

    let byVenue = symbolToId.get(r.venue);
    if (!byVenue) symbolToId.set(r.venue, (byVenue = new Map()));
    // Keyed on the venue spelling, because that is what arrives on the socket.
    byVenue.set(r.rawId, id);

    id++;
  }
}

// One past the last id, so the last group has an upper bound like every other.
groupStart[groupCount] = id;
```

`STALENESS_MS` carries 2,000 milliseconds by default and 3,000 for Kraken Futures, per section 7 of the design of record.

### 4.5 The result

```
                   0         1         2         3         4         5
              +---------+---------+---------+---------+---------+---------+
instruments   | bin BTC | byb BTC | okx BTC | bin ETH | byb ETH | okx ETH |
group         |    0    |    0    |    0    |    1    |    1    |    1    |
bidMul        | 0.99955 | 0.99945 | 0.99950 | 0.99955 | 0.99945 | 0.99950 |
askMul        | 1.00045 | 1.00055 | 1.00050 | 1.00045 | 1.00055 | 1.00050 |
bid           | 61000.1 | 61000.4 | 60999.8 |  3410.2 |  3410.5 |  3410.1 |
ask           | 61000.6 | 61000.9 | 61000.3 |  3410.7 |  3411.0 |  3410.6 |
recvTs        |   ...   |   ...   |   ...   |   ...   |   ...   |   ...   |
              +---------+---------+---------+---------+---------+---------+
              '---------- group 0 ----------'
                                            '---------- group 1 ----------'
```

```
groupStart = [ 0, 3, 6 ]
               |  |  |
               |  |  '-- fence, one past the last id
               |  '----- group 1 owns ids 3, 4, 5
               '-------- group 0 owns ids 0, 1, 2
```

```
symbolToId
  'binanceusdm'    Map { 'BTCUSDT': 0,       'ETHUSDT': 3       }
  'bybit'          Map { 'BTCUSDT': 1,       'ETHUSDT': 4       }
  'okx'            Map { 'BTC-USDT-SWAP': 2, 'ETH-USDT-SWAP': 5 }
```

The combining that the design of record described as grouping has already happened.
It happened while ids were being assigned, and it left no trace except adjacency.
There is no per group object to walk, and no nested map to traverse.

The bid row and the ask row are the live quote columns from section 4 of the design of record.
They are shown here alongside the static columns only to make the layout legible.
They are the same arrays task 3 of the plan allocates.

## 5. Reading the index

Three lookups exist, and only the first one is a map.

| from | to | structure | cost |
|---|---|---|---|
| venue raw id | instrument id | `Map<string, number>`, one per venue | one string hash |
| instrument id | group id | `Int32Array` | one indexed load |
| group id | member ids | `Int32Array` pair, read as a range | two indexed loads |

A Bybit message for `BTCUSDT` resolves like this.

```ts
// Held on the feed instance, resolved once at construction.
const ids = index.symbolToId.get('bybit')!;

// Per message.
const id = ids.get('BTCUSDT');
if (id === undefined) { this.unknownSymbols++; return; }
book.submit(id, bid, ask, bidQty, askQty, seq, now);
```

`submit` writes the quote columns and marks `group[id]` dirty.
Its body is specified in section 3.4 of the design of record and is not restated here.

The comparator then reads the group as a range.

```ts
/**
 * Finds the best fee adjusted buy and sell venue inside one group.
 * Only fresh members take part, so a dead feed cannot contribute a price.
 *
 * @param g The group id, which is an index into the group range table.
 * @param now Local receive clock in milliseconds, read once per drain.
 * @returns The best pair and its net edge, or null when no comparison is possible.
 *
 * @example
 * const best = evaluate(book.group[instrumentId], Date.now());
 */
function evaluate(g: number, now: number): Best | null {
  const lo = groupStart[g];
  const hi = groupStart[g + 1];

  let bestBid = 0;
  let bestBidId = -1;
  let bestAsk = Infinity;
  let bestAskId = -1;

  for (let i = lo; i < hi; i++) {
    // A stale or never received instrument holds a zero receive timestamp.
    if (now - recvTs[i] > maxAgeMs[i]) continue;

    const effBid = bid[i] * bidMul[i];
    if (effBid > bestBid) { bestBid = effBid; bestBidId = i; }

    const effAsk = ask[i] * askMul[i];
    if (effAsk < bestAsk) { bestAsk = effAsk; bestAskId = i; }
  }

  if (bestBidId < 0 || bestAskId < 0 || bestBidId === bestAskId) return null;

  const netPpm = (bestBid / bestAsk - 1) * 1e6;
  if (netPpm > SANITY_CEILING_PPM) { absurd[g]++; return null; }

  return {
    netPpm,
    buyId: bestAskId,
    sellId: bestBidId,
    qty: Math.min(askQty[bestAskId], bidQty[bestBidId]),
  };
}
```

The loop runs at most once per venue in the group, which is five for the current venue set.
Every column it touches is contiguous across those ids, because of decision 2.
Five float64 values occupy 40 bytes, so a group fits inside one cache line on every column it reads.

This is the body of task 11 of the plan, which the hold had left without a structure to iterate.

## 6. Refresh

Because the dense id is private and rebuildable, refresh is a rebuild and a swap.

```ts
/**
 * Rebuilds the index from a fresh market load and carries live quotes across.
 * Ids may change, which is safe because nothing durable references them.
 *
 * @param feeds One entry per venue, from the connector.
 *
 * @example
 * await registry.refresh(await connector.getAllSwapMarkets());
 */
async refresh(feeds: ExchangeSwapMarkets[]): Promise<void> {
  const next = buildIndex(feeds, this.takerPpmByVenue);

  for (const [venue, ids] of this.index.symbolToId) {
    const nextIds = next.symbolToId.get(venue);
    if (!nextIds) continue;

    for (const [rawId, oldId] of ids) {
      const newId = nextIds.get(rawId);
      if (newId !== undefined) next.book.copyFrom(this.book, oldId, newId);
    }
  }

  this.index = next;
  this.logger.log(`index rebuilt, ${next.n} instruments in ${next.groupCount} groups`);
}
```

A market that disappeared is simply absent from the new index.
A market that appeared starts with a zero receive timestamp, which decision 9 already treats as not fresh.
No caller observes a half built index, because the swap is a single reference assignment.

Feeds resubscribe on the next scheduled reconnect rather than immediately, which section 6 of the design of record requires for OKX because that venue caps subscription operations per connection per hour.

## 7. Cost

The index is small enough that its size is worth stating rather than measuring.

| item | size |
|---|---|
| ten float64 columns at 2,350 instruments | 188 KB |
| `group`, one int32 per instrument | 9 KB |
| `groupStart`, one int32 per group plus a fence | under 5 KB |
| total | under 210 KB |

2,350 is the full active swap count from section 1 of the design of record, so this is an upper bound.
Decision 7 and decision 8 both reduce it, and the real figure comes from the first registry build log rather than from this table.

The intent is that the entire live state of five exchanges stays inside the L2 cache of one core.
That is a design intent and not a measured result.
Task 13 of the plan is where it is confirmed.

What this design adds to the per message budget in section 8 of the design of record is one map hit and one indexed load.
What it adds to the per quote comparison is a bounded loop of at most five iterations.
`JSON.parse` remains the dominant cost, which is the correct place for the cost to sit.

The property worth protecting is that none of these costs depend on how many instruments are subscribed.
Adding the two thousandth market adds one map entry and ten array slots.
It does not make any existing market slower.

## 8. Correctness guards

Three guards live in this path.
Each one exists because the failure it prevents is silent.

### 8.1 Fees are applied before selection

Buying one unit on venue A costs the ask multiplied by one plus A's taker rate.
Selling one unit on venue B returns the bid multiplied by one minus B's taker rate.
The net edge is the ratio of those two, minus one.

Taker rates differ across the venue set, so the venue with the highest raw bid is not always the venue with the highest proceeds.
Selecting the best bid and the best ask first and subtracting fees afterwards picks the wrong leg whenever the rates differ.
Applying the multiplier inside the loop costs one multiply and removes the error entirely.

The selection stays a single pass because the rate is a per instrument constant, so the maximum and the minimum remain independent.

### 8.2 The absurd result ceiling

Real cross venue perpetual spreads are single digit to low hundred parts per million.
A result above roughly 50,000 parts per million is a unit mismatch, a halted market, or a delisting.
It is never an opportunity.

Rejecting and counting those results catches the entire class of bug where two markets in one group quote prices in different units.
Without the ceiling that bug surfaces as an enormous opportunity rather than as an error.

A build time version of the same check is cheap and worth having.
For every group, compare the member mid prices at first quote and quarantine any group whose members disagree by more than a few percent.
That loop runs once over the group count and catches the mismatch before any comparison is published.

### 8.3 The stored edge is an entry edge

`ArbitrageOpportunity` records `buyTakerPpm` and `sellTakerPpm` at `server/prisma/schema.prisma:168-170`, which is two taker legs.
Two legs is the cost of opening the position.
Closing it costs two more.

So the recorded `netPpm` is the entry edge and not the realized profit of a round trip.
That is the right figure for an observatory to record.
It is not the right figure to alert on, and any threshold meant to represent a tradable edge has to account for the exit as well.

## 9. Rejected alternatives

### 9.1 A membership array per group

The conventional flat layout keeps a `groupMembers` array and a `groupStart` offset table, which is a compressed sparse row layout.
Rejected because assigning ids in group order makes the membership array redundant.
The range bounds already are the membership list.
The saving is one array, one indirection per member, and the cache behaviour that indirection would cost.

### 9.2 Stable ids across a refresh

Task 2 of the plan required ids to survive a refresh.
Rejected because the requirement had no consumer.
Nothing outside the process holds a dense id, and persistence uses `Market.id` from the Prisma schema.
Keeping ids stable would mean either leaving gaps in the id space or maintaining a free list, and both defeat decision 2.

### 9.3 A nested map keyed by group

The shape most people reach for first is a map from group key to a map from venue to a quote object.
Rejected on two counts.
It performs two string hashes and two pointer chases for what is now two indexed loads.
More importantly it puts a mutable object per market on the heap, which invites the one mistake that actually matters, which is allocating a replacement object per message rather than mutating in place.

The layout difference is worth a constant factor.
The allocation difference is worth an order of magnitude.

### 9.4 A shared lookup map keyed on venue and symbol

Rejected because building the composite key allocates a string on every message.
The venue is fixed for the lifetime of a feed, so the feed can hold the venue's own map and skip the question.
See decision 4.

### 9.5 An incremental best bid and best ask per group

Maintaining the current best as quotes arrive, rather than rescanning, sounds like the faster option.
Rejected because it is not, at this group size.
When the current best moves in the unfavourable direction the structure has to rescan anyway, so the branch is paid for nothing.
A five iteration loop over contiguous memory is already below the noise floor of `JSON.parse`.

### 9.6 Grouping on the unified symbol string

Rejected because the unified symbol encodes the settlement currency in a form that invites accidental matching, and because a symbol match is a weaker statement than a base and settlement match.
The grouping rule in decision 6 of the design of record is preserved exactly, and this document only changes how it is represented.

### 9.7 Indexing inverse contracts in version one

Rejected per decision 7.
An inverse contract quotes price in the settlement currency per contract and sizes in contracts.
It cannot share a group with a linear contract, and on the current venue set it would form groups too small to survive decision 8 anyway.

## 10. Effect on the plan

The hold in section 0 of the design of record is not lifted by this document existing.
It is lifted when this design is accepted.
On acceptance the following change.

| item | change |
|---|---|
| task 1, `InstrumentId` and `GroupId` brands | unblocked, both are plain branded numbers |
| task 2, instrument registry | unblocked, and rewritten around section 4 of this document |
| task 2, id stability requirement | removed, per decision 1 and section 9.2 |
| task 3, quote table | unchanged, plus the zero receive timestamp rule from decision 9 |
| task 11, orchestrator | unblocked, and the group scan is specified in section 5 of this document |
| decisions 5 and 6 of the design of record | decision 5 is replaced by decisions 1 to 3 here, decision 6 is preserved |

One naming divergence needs reconciling and is recorded rather than silently resolved.
Section 3.1 of the design of record places the quote table and the orchestrator under `server/src/core/`.
The repository has `server/src/engine/` instead, which already holds the `getAllSwapMarkets` stub at `server/src/engine/core.ts:15-18`.
This document assumes `server/src/engine/`, and the design of record should be corrected to match rather than the directory being renamed.

## 11. Acceptance criteria

The index is correct when all of the following hold.

1. Binance, Bybit, and OKX `BTC/USDT:USDT` resolve to three ids inside one group range.
2. Kraken Futures `BTC/USD:USD` does not appear in that range, and is dropped as a single member group on the current venue set.
3. Every group range is non empty, and `groupStart` is non decreasing with a final entry equal to the instrument count.
4. Two builds over the same market set produce identical ids.
5. A refresh over a market set with one market added and one removed preserves the live quote of every market present in both.
6. A group whose members quote prices in different units is quarantined at build time rather than published as an opportunity.
7. No comparison includes an instrument whose receive timestamp is zero.
