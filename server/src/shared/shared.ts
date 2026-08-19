// Loops rather than Math.min(...series), because a long episode can hold more samples
// than the spread operator accepts as arguments.

export function min(series: number[]): number {
  let lowest = Infinity;

  for (const value of series) {
    if (value < lowest) lowest = value;
  }

  return lowest;
}

export function max(series: number[]): number {
  let highest = -Infinity;

  for (const value of series) {
    if (value > highest) highest = value;
  }

  return highest;
}
