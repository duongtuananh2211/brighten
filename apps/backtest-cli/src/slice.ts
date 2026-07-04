import type { MarketSnapshot } from "@brighten/decision-core";

import type { BacktestStrategyInput, IndexRange } from "./types.js";

export function sliceSnapshot(snapshot: MarketSnapshot, range: IndexRange): MarketSnapshot {
  const klines = snapshot.klines.slice(range.fromIndex, range.toIndex);
  const first = klines[0];

  return {
    ...snapshot,
    atEpochMillis: first?.openTime ?? snapshot.atEpochMillis,
    klines
  };
}

export function reindexStrategyInput(
  input: BacktestStrategyInput,
  range: IndexRange
): BacktestStrategyInput {
  return {
    ...input,
    signals: input.signals
      .filter((signal) => signal.tickIndex >= range.fromIndex && signal.tickIndex < range.toIndex)
      .map((signal) => ({
        ...signal,
        tickIndex: signal.tickIndex - range.fromIndex
      }))
  };
}
