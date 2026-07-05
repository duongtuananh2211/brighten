import type {
  AccountState,
  BehavioralState,
  SizingResult,
  CoreError
} from "@brighten/decision-core";
import type { ConfigSnapshot } from "@brighten/config";

// --- Deterministic strategy-input seam (epic-1 fixture) ---------------------
// State/account remain a temporary seam until the feedback loop and balance
// feed land; direction/candidate/sizing are produced inside decision-core.

export interface BacktestSignal {
  // Index into the snapshot's klines array where this signal is evaluated.
  readonly tickIndex: number;
  readonly state?: BehavioralState;
  readonly account?: AccountState;
}

export interface BacktestStrategyInput {
  // Defaults applied to every tick unless a signal overrides them.
  readonly state: BehavioralState;
  readonly account: AccountState;
  readonly signals: readonly BacktestSignal[];
}

// --- Engine intermediate + output shapes -----------------------------------

// A core-emitted suggestion the driver will simulate. Sizing is surfaced by the
// pipeline; the driver never re-implements decision rules (AD-3).
export interface EmittedTrade {
  readonly entryTickIndex: number;
  readonly entryEpochMillis: number;
  readonly sizing: SizingResult;
}

export type ExitReason = "target" | "stop" | "close";

export interface SimulatedTrade {
  readonly entryTickIndex: number;
  readonly exitTickIndex: number;
  readonly entryEpochMillis: number;
  readonly exitEpochMillis: number;
  readonly exitReason: ExitReason;
  readonly grossR: string;
  readonly realizedCost: string;
  readonly netR: string;
}

export interface RDistributionBin {
  readonly r: string;
  readonly count: number;
}

export interface BacktestMetrics {
  readonly tradeCount: number;
  // Headline credibility metrics — net of real cost (anti "feeling of winning").
  readonly expectancy: string;
  readonly maxDrawdown: string;
  readonly rDistribution: readonly RDistributionBin[];
  readonly equityCurve: readonly string[];
  // Reference-only: win rate is intentionally NOT a headline metric.
  readonly winRateReference: string;
}

export interface BacktestDataRange {
  readonly pair: string;
  readonly timeframe: string;
  readonly fromEpochMillis: number;
  readonly toEpochMillis: number;
  readonly klineCount: number;
}

// Self-contained, reproducible run record. Embeds the exact config snapshot used
// (AD-4) so results can be re-derived; ready to persist later without change.
export interface BacktestRun {
  readonly metrics: BacktestMetrics;
  readonly configSnapshot: ConfigSnapshot;
  readonly dataRange: BacktestDataRange;
  readonly snapshotSchemaVersion: number;
}

// --- Anti-overfit validation shapes (Story 1.9) -----------------------------

export interface IndexRange {
  readonly fromIndex: number;
  readonly toIndex: number;
}

export interface WalkForwardSpec {
  readonly folds: number;
  readonly inSampleRatio: string;
  readonly holdoutRatio: string;
}

export interface WalkForwardFold {
  readonly inSample: IndexRange;
  readonly outOfSample: IndexRange;
}

export type WalkForwardSplitOutcome =
  | {
      readonly ok: true;
      readonly holdout: IndexRange;
      readonly folds: readonly WalkForwardFold[];
    }
  | {
      readonly ok: false;
      readonly error: CoreError;
    };

export interface ExpectancyCI {
  readonly lower: string;
  readonly median: string;
  readonly upper: string;
  readonly resamples: number;
  readonly seed: number;
}

export type ValidationMode = "backtest" | "paper-trade";

export interface LiveEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export type ParamCapOutcome =
  | { readonly ok: true; readonly count: number; readonly cap: number }
  | { readonly ok: false; readonly error: CoreError };

export interface SegmentReport {
  readonly range: IndexRange;
  readonly metrics: BacktestMetrics;
  readonly trades: readonly SimulatedTrade[];
}

export interface FoldReport {
  readonly inSample: IndexRange;
  readonly outOfSample: SegmentReport;
}

export interface ValidationReport {
  readonly mode: ValidationMode;
  readonly spec: WalkForwardSpec;
  readonly walkForward: readonly FoldReport[];
  readonly holdout: SegmentReport;
  readonly expectancyCI: ExpectancyCI;
  readonly liveEligibility: LiveEligibility;
  readonly paramCap: ParamCapOutcome;
  readonly configSnapshot: ConfigSnapshot;
  readonly dataRange: BacktestDataRange;
  readonly snapshotSchemaVersion: number;
}
