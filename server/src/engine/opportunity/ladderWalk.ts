import type { Cluster } from '../cluster/types';
import type { EdgeSample } from './types';

export function walkLadders(
  cluster: Cluster,
  buyIndex: number,
  sellIndex: number,
): EdgeSample | null {
  const d = cluster.depth;
  const askCount = d.askLevelCount[buyIndex];
  const bidCount = d.bidLevelCount[sellIndex];

  if (askCount === 0 || bidCount === 0) {
    return null;
  }

  const askBase = buyIndex * d.maxLevels;
  const bidBase = sellIndex * d.maxLevels;
  const askMul = cluster.askMul[buyIndex];
  const bidMul = cluster.bidMul[sellIndex];
  const askSizeMul = cluster.sizeMul[buyIndex];
  const bidSizeMul = cluster.sizeMul[sellIndex];

  let i = 0;
  let j = 0;
  let askLeft = d.askSize[askBase] * askSizeMul;
  let bidLeft = d.bidSize[bidBase] * bidSizeMul;
  let askTaken = false;
  let bidTaken = false;
  let cost = 0;
  let proceeds = 0;
  let size = 0;
  let buyLevels = 0;
  let sellLevels = 0;
  let stoppedByPrice = false;

  while (i < askCount && j < bidCount) {
    const askPx = d.askPrice[askBase + i] * askMul;
    const bidPx = d.bidPrice[bidBase + j] * bidMul;

    if (askPx >= bidPx) {
      stoppedByPrice = true;
      break;
    }

    const q = Math.min(askLeft, bidLeft);

    if (q > 0) {
      cost += q * askPx;
      proceeds += q * bidPx;
      size += q;
      askLeft -= q;
      bidLeft -= q;

      if (!askTaken) {
        askTaken = true;
        buyLevels += 1;
      }

      if (!bidTaken) {
        bidTaken = true;
        sellLevels += 1;
      }
    }

    if (askLeft <= 0) {
      i += 1;
      askTaken = false;
      if (i < askCount) {
        askLeft = d.askSize[askBase + i] * askSizeMul;
      }
    }

    if (bidLeft <= 0) {
      j += 1;
      bidTaken = false;
      if (j < bidCount) {
        bidLeft = d.bidSize[bidBase + j] * bidSizeMul;
      }
    }
  }

  return {
    avgPpm: size > 0 ? (proceeds / cost - 1) * 1_000_000 : 0,
    size,
    notional: cost,
    exhausted: !stoppedByPrice && size > 0,
    buyLevels,
    sellLevels,
  };
}
