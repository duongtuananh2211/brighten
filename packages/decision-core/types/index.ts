// [PLACEHOLDER — enriched in Story 1.7]
export interface MarketSnapshot {
  readonly pair: string;
  readonly timeframe: string;
  readonly atEpochMillis: number;
  readonly [key: string]: unknown;
}

// [PLACEHOLDER — enriched in Story 1.6]
export interface BehavioralState {
  readonly winStreak: number;
  readonly dailyLoss: string;
  readonly cooldownUntilEpochMillis?: number | undefined;
  readonly tradeCountToday: number;
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
