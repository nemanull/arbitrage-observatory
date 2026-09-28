import type { Queue } from 'bullmq';
import type { OpportunityClosedJob } from '../../src/engine/opportunity/OpportunityWorker';

export type OpportunityQueueMock = jest.Mocked<Queue<OpportunityClosedJob>>;

export function createOpportunityQueueMock(): OpportunityQueueMock {
  return {
    add: jest.fn().mockResolvedValue({}),
  } as unknown as OpportunityQueueMock;
}
