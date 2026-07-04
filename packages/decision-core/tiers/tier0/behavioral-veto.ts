import type { ConfigParams } from "@brighten/config";
import { cmp, toDecimal, toDecimalString } from "../../math/decimal.js";
import type { CoreDecimal } from "../../math/decimal.js";
import type { BehavioralState, CoreError } from "../../types/index.js";

const source = "tier0.behavioral";
const zero = toDecimal("0");

export interface BehavioralVetoInput {
  readonly state: BehavioralState;
  readonly params: ConfigParams;
  readonly pair: string;
  readonly nowEpochMillis: number;
}

export interface BehavioralVetoPass {
  readonly blocked: false;
}

export interface BehavioralVetoBlock {
  readonly blocked: true;
  readonly error: CoreError;
}

export type BehavioralVetoOutcome = BehavioralVetoPass | BehavioralVetoBlock;

export function evaluateBehavioralVeto(input: BehavioralVetoInput): BehavioralVetoOutcome {
  const lastLossEpochMillis = input.state.lastLossEpochMillis;
  if (lastLossEpochMillis !== undefined) {
    const cooldownUntilEpochMillis = lastLossEpochMillis + input.params.cooldown_after_loss;
    if (input.nowEpochMillis < cooldownUntilEpochMillis) {
      return block("cooldown_active", "Cooldown after loss is active", {
        lastLossEpochMillis,
        cooldownUntilEpochMillis,
        nowEpochMillis: input.nowEpochMillis
      });
    }
  }

  const dailyLoss = parseDecimal("dailyLoss", input.state.dailyLoss);
  if ("blocked" in dailyLoss) {
    return dailyLoss;
  }

  const dailyLossLimit = parseDecimal("dailyLossLimit", input.params.daily_loss_limit);
  if ("blocked" in dailyLossLimit) {
    return dailyLossLimit;
  }

  if (cmp(dailyLossLimit.value, zero) <= 0) {
    return block("invalid_daily_loss_limit", "Daily loss limit must be a decimal string greater than 0", {
      dailyLossLimit: input.params.daily_loss_limit
    });
  }

  if (cmp(dailyLoss.value, dailyLossLimit.value) >= 0) {
    return block("daily_loss_limit_reached", "Daily loss limit reached", {
      dailyLoss: toDecimalString(dailyLoss.value),
      dailyLossLimit: toDecimalString(dailyLossLimit.value)
    });
  }

  if (input.state.tradeCountToday >= input.params.max_trades_per_day) {
    return block("max_trades_reached", "Max trades per day reached", {
      tradeCountToday: input.state.tradeCountToday,
      maxTradesPerDay: input.params.max_trades_per_day
    });
  }

  const activeWindow = input.params.news_blackout.find(
    (window) =>
      input.nowEpochMillis >= window.startsAt &&
      input.nowEpochMillis < window.endsAt &&
      (window.pairs === undefined || window.pairs.includes(input.pair))
  );
  if (activeWindow !== undefined) {
    return block("news_blackout_active", "News blackout is active", {
      pair: input.pair,
      windowStartsAt: activeWindow.startsAt,
      windowEndsAt: activeWindow.endsAt,
      ...(activeWindow.reason === undefined ? {} : { reason: activeWindow.reason })
    });
  }

  return { blocked: false };
}

function parseDecimal(field: string, value: string): BehavioralVetoBlock | { readonly ok: true; readonly value: CoreDecimal } {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return block("invalid_decimal_string", "Expected parseable decimal string", { field, value });
  }
}

function block(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>>
): BehavioralVetoBlock {
  return {
    blocked: true,
    error: {
      code,
      source,
      context: {
        ...context,
        message
      }
    }
  };
}
