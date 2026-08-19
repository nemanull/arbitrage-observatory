import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../db/prisma';
import {
  writeOpportunities,
  type ArbitrageOpportunityRow,
} from '../db/writes';

export const OPPORTUNITY_CLOSED_QUEUE = 'opportunity-closed';

export const OPPORTUNITY_CLOSED_JOB = 'closed';

export type OpportunityClosedJob = {
  rows: ArbitrageOpportunityRow[];
};

const CONCURRENCY = 4;
const KEEP_COMPLETED_SECONDS = 3_600;
const KEEP_FAILED_SECONDS = 86_400;


@Processor(OPPORTUNITY_CLOSED_QUEUE, {
  concurrency: CONCURRENCY,
  removeOnComplete: { age: KEEP_COMPLETED_SECONDS, count: 1_000 },
  removeOnFail: { age: KEEP_FAILED_SECONDS },
})
  
export class OpportunityWorker extends WorkerHost {
  private readonly logger = new Logger(OpportunityWorker.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<OpportunityClosedJob, number>): Promise<number> {
    const ids = await writeOpportunities(this.prisma.client, job.data.rows);
    return ids.length;
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<OpportunityClosedJob, number>, written: number): void {
    this.logger.log({
      event: 'opportunities_written',
      jobId: job.id,
      rows: job.data.rows.length,
      written,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<OpportunityClosedJob, number> | undefined, error: Error): void {
    this.logger.error({
      event: 'opportunity_write_failed',
      jobId: job?.id,
      rows: job?.data.rows.length,
      attempts: job?.attemptsMade,
      error: error.message,
    });
  }

  // Connection level problems arrive here rather than on a job.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error({ event: 'opportunity_worker_error', error: error.message });
  }
}
