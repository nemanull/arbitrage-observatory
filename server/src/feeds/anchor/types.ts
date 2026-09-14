import type { AnchorReading } from '../../engine/cluster/types';

export type AnchorRow = Omit<AnchorReading, 'ts'>;

// A map contains AnchorRows keyed by the venue's own market id for all markets in that venue's current round
export type AnchorMap = Map<string, AnchorRow>; // <raw_market_id, AnchorRow>
