import type { AnchorReading } from '../../engine/cluster/types';

// A row read by its own request inside a multi request round carries its own ts, and every other row takes the round's arrival.
export type AnchorRow = Omit<AnchorReading, 'ts'> & { ts?: number };

// A map contains AnchorRows keyed by the venue's own market id for all markets in that venue's current round
export type AnchorMap = Map<string, AnchorRow>; // <raw_market_id, AnchorRow>
