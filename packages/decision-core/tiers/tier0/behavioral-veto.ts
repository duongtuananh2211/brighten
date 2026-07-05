import type { ConfigParams } from "@brighten/config";
import { cmp, toDecimal, toDecimalString } from "../../math/decimal.js";
import type { CoreDecimal } from "../../math/decimal.js";
import type { BehavioralState, CoreError } from "../../types/index.js";
import { isOverrideActive } from "./override.js";
import type { OverrideGrant } from "./override.js";

const source = "tier0.behavioral";
const zero = toDecimal("0");

export interface BehavioralVetoInput {
  readonly state: BehavioralState;
  readonly params: ConfigParams;
  readonly pair: string;
  readonly nowEpochMillis: number;
  /** Active override grants (3.6). Rules matching an active grant are skipped. */
  readonly overrideGrants?: readonly OverrideGrant[] | undefined;
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
      if (!isOverrideActive(input.overrideGrants, "cooldown_active", input.nowEpochMillis)) {
        return block("cooldown_active", "Cooldown after loss is active", {
          lastLossEpochMillis,
          cooldownUntilEpochMillis,
          nowEpochMillis: input.nowEpochMillis
        });
      }
      // Override active — skip this rule, continue to next
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
    if (!isOverrideActive(input.overrideGrants, "daily_loss_limit_reached", input.nowEpochMillis)) {
      return block("daily_loss_limit_reached", "Daily loss limit reached", {
        dailyLoss: toDecimalString(dailyLoss.value),
        dailyLossLimit: toDecimalString(dailyLossLimit.value)
      });
    }
  }

  if (input.state.tradeCountToday >= input.params.max_trades_per_day) {
    if (!isOverrideActive(input.overrideGrants, "max_trades_reached", input.nowEpochMillis)) {
      return block("max_trades_reached", "Max trades per day reached", {
        tradeCountToday: input.state.tradeCountToday,
        maxTradesPerDay: input.params.max_trades_per_day
      });
    }
  }

  const activeWindow = input.params.news_blackout.find(
    (window) =>
      input.nowEpochMillis >= window.startsAt &&
      input.nowEpochMillis < window.endsAt &&
      (window.pairs === undefined || window.pairs.includes(input.pair))
  );
  if (activeWindow !== undefined) {
    if (!isOverrideActive(input.overrideGrants, "news_blackout_active", input.nowEpochMillis)) {
      return block("news_blackout_active", "News blackout is active", {
        pair: input.pair,
        windowStartsAt: activeWindow.startsAt,
        windowEndsAt: activeWindow.endsAt,
        ...(activeWindow.reason === undefined ? {} : { reason: activeWindow.reason })
      });
    }
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
