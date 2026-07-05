import type { SizingResult } from "../tiers/tier3/sizing.js";

// Ingestion adapters populate this schema; changes must be versioned.
export const MARKET_SNAPSHOT_SCHEMA_VERSION = 1;

export interface Kline {
  readonly openTime: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly closeTime: number;
  readonly quoteVolume: string;
  readonly numberOfTrades: number;
  readonly takerBuyBaseVolume: string;
  readonly takerBuyQuoteVolume: string;
}

export interface FundingPoint {
  readonly fundingTime: number;
  readonly fundingRate: string;
}

export interface OpenInterestPoint {
  readonly timestamp: number;
  readonly sumOpenInterest: string;
  readonly sumOpenInterestValue: string;
}

export interface LongShortRatioPoint {
  readonly timestamp: number;
  readonly longShortRatio: string;
  readonly longAccount: string;
  readonly shortAccount: string;
}

export interface SnapshotWarning {
  readonly source: string;
  readonly code: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface MarketSnapshot {
  readonly pair: string;
  readonly timeframe: string;
  readonly atEpochMillis: number;
  readonly klines: readonly Kline[];
  readonly funding?: readonly FundingPoint[];
  readonly openInterest?: readonly OpenInterestPoint[];
  readonly longShortRatio?: readonly LongShortRatioPoint[];
  readonly warnings: readonly SnapshotWarning[];
}

// Owned by decision-engine behavioral feedback; tiers only read this snapshot.
export interface BehavioralState {
  readonly winStreak: number;
  readonly dailyLoss: string;
  readonly lastLossEpochMillis?: number | undefined;
  readonly tradeCountToday: number;
  /** Bookkeeping field managed by the state-owner (applyMarketTick). Tiers ignore it. */
  readonly tradingDayStartEpochMillis?: number | undefined;
}

export type TradeDirection = "long" | "short";

// [PLACEHOLDER — produced by tier2 price-action rules in a fuller system]
export interface TradeCandidate {
  readonly direction: TradeDirection;
  readonly entry: string;
  readonly stop: string;
  readonly target: string;
}

// [PLACEHOLDER — enriched when read-only balance feedback is available]
export interface AccountState {
  readonly equity: string;
}

// [PLACEHOLDER — produced by the fee model/adapter in Story 1.8]
export interface CostEstimate {
  readonly roundTripFee: string;
}

// Signals that triggered this suggestion — grounding for LLM narrator (FR-7, AD-9).
export interface TriggeredSignals {
  readonly tier1?: Record<string, unknown> | undefined;
  readonly tier2?: Record<string, unknown> | undefined;
}

// A persisted trade suggestion. Drivers compose this from pipeline-surfaced
// direction/candidate/sizing plus driver-owned market/config metadata.
export interface Suggestion {
  readonly kind: "trade";
  readonly pair: string;
  readonly timeframe: string;
  readonly atEpochMillis: number;
  readonly direction: TradeDirection;
  readonly candidate: TradeCandidate;
  readonly sizing: SizingResult;
  readonly configVersion: number;
  readonly snapshotSchemaVersion: number;
  /** Grounding signals that triggered this suggestion (4.3). */
  readonly signals?: TriggeredSignals | undefined;
  /** LLM narration (4.3). Undefined if narrator not yet run or errored. */
  readonly narration?: Narration | undefined;
  /** Error info when narration failed (AD-9: non-blocking). */
  readonly narrationError?: Readonly<Record<string, unknown>> | undefined;
}

export type AuditEventType = "suggestion-emitted" | "suggestion-blocked" | "override-recorded" | "trade-outcome";

// Immutable audit log entry (AD-8). Append-only — never UPDATE/DELETE.
// Each entry carries enough context to reconstruct why a decision was made:
//   - configVersion + pair/timeframe/atEpochMillis lets determinism (AD-2) reproduce signals.
//   - reason (blocked) + Suggestion (emitted) give human-readable justification.
export interface AuditEvent {
  readonly type: AuditEventType;
  readonly atEpochMillis: number;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Optional LLM narration (AD-9). Source deferred to narrator story. */
  readonly narration?: string | undefined;
}

export interface Narration {
  readonly text: string;
  /** Model used (e.g. "deepseek-chat"). */
  readonly model?: string | undefined;
  /** System prompt sent to the LLM. */
  readonly promptSystem?: string | undefined;
  /** User prompt (grounding data) sent to the LLM. */
  readonly promptUser?: string | undefined;
  /** Raw API response for auditability. */
  readonly rawResponse?: string | undefined;
  /** Temperature used. */
  readonly temperature?: number | undefined;
  /** Latency in milliseconds. */
  readonly latencyMs?: number | undefined;
  readonly [key: string]: unknown;
}

export interface CoreError {
  readonly code: string;
  readonly source: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CoreError };
