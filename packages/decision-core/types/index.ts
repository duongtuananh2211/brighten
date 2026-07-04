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

// [PLACEHOLDER — enriched in Story 1.6/1.8]
export interface Suggestion {
  readonly kind: "stub";
  readonly atEpochMillis: number;
  readonly [key: string]: unknown;
}

// [PLACEHOLDER — enriched in persistence/audit stories]
export interface AuditEvent {
  readonly type: string;
  readonly atEpochMillis: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

// [PLACEHOLDER — enriched in narrator stories]
export interface Narration {
  readonly text: string;
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
