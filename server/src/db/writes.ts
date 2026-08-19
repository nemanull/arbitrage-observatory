import type { Prisma } from './generated/prisma/client';
import type { Db } from './prisma';

// The exact row shape, so nothing in this file has to know what an Opportunity is.
// DateTime columns accept an ISO string, which is the form that survives a JSON round trip through the queue.
export type ArbitrageOpportunityRow =
  Prisma.ArbitrageOpportunityCreateManyInput;

export async function writeOpportunity(
  db: Db,
  row: ArbitrageOpportunityRow,
): Promise<bigint> {
  const created = await db.arbitrageOpportunity.create({
    data: row,
    select: { id: true },
  });

  return created.id;
}

// One statement for the whole batch, which is what a venue drop closing many routes at once needs.
export async function writeOpportunities(
  db: Db,
  rows: ArbitrageOpportunityRow[],
): Promise<bigint[]> {
  if (rows.length === 0) {
    return [];
  }

  const created = await db.arbitrageOpportunity.createManyAndReturn({
    data: rows,
    select: { id: true },
  });

  return created.map((row) => row.id);
}
