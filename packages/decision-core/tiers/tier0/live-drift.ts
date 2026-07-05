import { add, cmp, div } from "../../math/decimal.js";

export interface LiveDriftStatus {
  readonly liveExpectancy: string;
  readonly drifting: boolean;
  readonly sampleCount: number;
  readonly baselineLower: string;
}

export interface LiveDriftInput {
  /** R-values from attributed outcomes, most recent last. */
  readonly liveRs: readonly string[];
  /** Baseline CI lower bound. Undefined ⇒ never drift (no baseline to compare). */
  readonly baselineLower?: string | undefined;
  readonly minSamples: number;
  readonly window: number;
}

/**
 * Evaluate live drift: compare live expectancy against backtest baseline CI.
 *
 * Always computes liveExpectancy and sampleCount (first-class metric).
 * Drifting only when sampleCount >= minSamples AND baseline is set AND
 * liveExpectancy < baselineLower.
 *
 * Pure: no Date, no IO, no random. Decimal arithmetic throughout.
 */
export function evaluateLiveDrift(input: LiveDriftInput): LiveDriftStatus {
  const recent = input.liveRs.slice(-input.window);
  const count = recent.length;
  const sampleCount = count;

  const liveExpectancy =
    count === 0
      ? "0"
      : div(recent.reduce((sum, r) => add(sum, r), "0"), String(count));

  const baselineLower = input.baselineLower ?? "0";

  const drifting =
    count >= input.minSamples &&
    input.baselineLower !== undefined &&
    cmp(liveExpectancy, input.baselineLower) < 0;

  return { liveExpectancy, drifting, sampleCount, baselineLower };
}
