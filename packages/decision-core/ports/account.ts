import type { Result } from "../types/index.js";

// Decimal-string values (no number for money — AD-2).
export interface AccountBalance {
  readonly equity: string;
}

export interface ClosedTrade {
  readonly fillId: string;
  readonly symbol: string;
  /** Signed realised PnL in quote units, decimal-string. Negative = loss. */
  readonly realizedPnl: string;
  readonly closedEpochMillis: number;
}

/**
 * Read-only account port (AD-7, AD-10).
 *
 * Every implementation MUST only call read-only exchange endpoints.
 * No order placement, cancellation, or modification is ever permitted.
 */
export interface AccountPort {
  readonly readBalance: () => Promise<Result<AccountBalance>>;
  readonly readClosedTrades: (sinceEpochMillis: number) => Promise<Result<readonly ClosedTrade[]>>;
}
