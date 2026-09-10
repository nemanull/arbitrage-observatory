import type { AnchorReading } from '../../engine/types';

// One market's numbers out of a bulk reply.
// The poller stamps the round's start time on it, so every slot a round writes carries the same second.
export type AnchorRow = Omit<AnchorReading, 'ts'>;

// Rows keyed by the venue's own market id, the same spelling the book socket uses.
export type AnchorRows = Map<string, AnchorRow>;
