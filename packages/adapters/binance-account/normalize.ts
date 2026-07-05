import { toDecimal } from "@brighten/decision-core/math";

// CAUTION (AD-10): This adapter ONLY handles read-only Binance endpoints.
// No order placement, cancellation, or modification code exists here.

interface BinanceTrade {
  readonly id: number;
  readonly symbol: string;
  readonly realizedPnl: string;
  readonly time: number;
}

/** Map userTrades response list to ClosedTrade[]. PnL stays decimal-string. */
export function normalizeClosedTrades(raw: unknown): readonly {
  fillId: string;
  symbol: string;
  realizedPnl: string;
  closedEpochMillis: number;
}[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is BinanceTrade =>
        isRecord(t) &&
        typeof t.id === "number" &&
        typeof t.symbol === "string" &&
        typeof t.realizedPnl === "string" &&
        typeof t.time === "number",
    )
    .map((t) => ({
      fillId: String(t.id),
      symbol: t.symbol,
      realizedPnl: toDecimal(t.realizedPnl),
      closedEpochMillis: t.time,
    }));
}

/** Map account info response to AccountBalance. Uses totalWalletBalance field. */
export function normalizeBalance(raw: unknown): { equity: string } {
  if (!isRecord(raw)) return { equity: "0" };
  // Binance Futures totalWalletBalance (cross-margin USDT wallet)
  const total = (raw as Record<string, unknown>)["totalWalletBalance"];
  if (typeof total === "string") {
    return { equity: toDecimal(total) };
  }
  // Fallback: no recognised balance field
  return { equity: "0" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
