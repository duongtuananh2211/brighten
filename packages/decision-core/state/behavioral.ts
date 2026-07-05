import type { BehavioralState } from "../types/index.js";
import { abs, add } from "../math/decimal.js";
import { tradingDayStart } from "./trading-day.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MarketTickContext {
  readonly nowEpochMillis: number;
  readonly tradingDayBoundary: string;
  readonly tradingDayStartEpochMillis?: number | undefined;
}

export interface MarketTickResult {
  readonly state: BehavioralState;
  readonly tradingDayStartEpochMillis: number;
}

export interface RiskOutcomeInput {
  /** Signed realised PnL in quote units (decimal-string). Negative = loss. */
  readonly realizedPnl: string;
  readonly atEpochMillis: number;
}

export interface AttributedOutcomeInput {
  readonly result: "win" | "loss";
  readonly atEpochMillis: number;
}

// ─── Pure reducers ───────────────────────────────────────────────────────────

/**
 * Apply a market-tick event (day-boundary reset).
 *
 * Pure: no mutation, no Date, no IO, no random.
 */
export function applyMarketTick(
  state: BehavioralState,
  ctx: MarketTickContext,
): MarketTickResult {
  const nextStart = tradingDayStart(ctx.nowEpochMillis, ctx.tradingDayBoundary);
  const crossed =
    ctx.tradingDayStartEpochMillis !== undefined &&
    nextStart > ctx.tradingDayStartEpochMillis;

  if (crossed) {
    return {
      state: {
        winStreak: state.winStreak,
        dailyLoss: "0",
        lastLossEpochMillis: state.lastLossEpochMillis,
        tradeCountToday: 0,
      },
      tradingDayStartEpochMillis: nextStart,
    };
  }

  return {
    state,
    tradingDayStartEpochMillis:
      ctx.tradingDayStartEpochMillis !== undefined
        ? ctx.tradingDayStartEpochMillis
        : nextStart,
  };
}

/**
 * Apply risk outcome from automated probe (AD-7: read-only probe source).
 *
 * Only accumulates dailyLoss from negative PnL — does NOT touch win-streak
 * or trade count. Discretionary trades create risk but don't count toward
 * system edge metrics.
 *
 * Pure: no mutation, no Date, no IO, no random.
 */
export function applyRiskOutcome(
  state: BehavioralState,
  input: RiskOutcomeInput,
): BehavioralState {
  if (input.realizedPnl === "0") {
    return state;
  }

  // Positive PnL: no-op (profit doesn't reduce daily loss; loss limit is one-directional).
  if (!input.realizedPnl.startsWith("-")) {
    return state;
  }

  return {
    winStreak: state.winStreak,
    dailyLoss: add(state.dailyLoss, abs(input.realizedPnl)),
    lastLossEpochMillis: input.atEpochMillis,
    tradeCountToday: state.tradeCountToday,
  };
}

/**
 * Apply attributed outcome from user confirmation (AD-7: user-confirm source).
 *
 * Updates win-streak and trade-count — these measure system edge, not
 * discretionary trading. dailyLoss is NOT touched (already handled by probe).
 *
 * Pure: no mutation, no Date, no IO, no random.
 */
export function applyAttributedOutcome(
  state: BehavioralState,
  input: AttributedOutcomeInput,
): BehavioralState {
  if (input.result === "win") {
    return {
      winStreak: state.winStreak + 1,
      dailyLoss: state.dailyLoss,
      lastLossEpochMillis: state.lastLossEpochMillis,
      tradeCountToday: state.tradeCountToday + 1,
    };
  }

  // loss
  return {
    winStreak: 0,
    dailyLoss: state.dailyLoss,
    lastLossEpochMillis: input.atEpochMillis,
    tradeCountToday: state.tradeCountToday + 1,
  };
}
