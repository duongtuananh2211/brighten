import type { Tier } from "../../pipeline/runner.js";
import { evaluateBehavioralVeto } from "./behavioral-veto.js";
import type { LiveDriftStatus } from "./live-drift.js";
import { isOverrideActive } from "./override.js";
export { evaluateBehavioralVeto } from "./behavioral-veto.js";
export { evaluateLiveDrift } from "./live-drift.js";
export type { LiveDriftStatus, LiveDriftInput } from "./live-drift.js";
export { buildOverrideGrant, isOverrideActive } from "./override.js";
export type { OverrideGrant, BuildOverrideGrantInput } from "./override.js";
export { evaluateWinStreakDampening } from "./win-streak.js";
export type {
  BehavioralVetoBlock,
  BehavioralVetoInput,
  BehavioralVetoOutcome,
  BehavioralVetoPass
} from "./behavioral-veto.js";
export type {
  WinStreakInput,
  WinStreakOutcome,
  WinStreakRejection,
  WinStreakResult
} from "./win-streak.js";

export interface Tier0StubOptions {
  readonly vetoReason?: string;
}

export function createTier0(): Tier {
  return {
    id: "tier0",
    run(ctx) {
      // 1. live_drift_halt — systemic: entire edge may be broken (FR-10, AD-5)
      if (ctx.liveDrift?.drifting === true) {
        if (!isOverrideActive(ctx.overrideGrants, "live_drift_halt", ctx.nowEpochMillis)) {
          return {
            kind: "veto",
            tier: "tier0",
            reason: formatDriftReason(ctx.liveDrift),
          };
        }
        // Override active — skip drift halt, continue to behavioural checks
      }

      // 2. behavioral veto (cooldown, daily-loss, max-trades, news)
      const outcome = evaluateBehavioralVeto({
        state: ctx.state,
        params: ctx.config.params,
        pair: ctx.input.pair,
        nowEpochMillis: ctx.nowEpochMillis,
        overrideGrants: ctx.overrideGrants,
      });

      return outcome.blocked
        ? { kind: "veto", tier: "tier0", reason: formatReason(outcome.error) }
        : { kind: "pass" };
    }
  };
}

export function createTier0Stub(options: Tier0StubOptions = {}): Tier {
  const vetoReason = options.vetoReason;
  if (vetoReason === undefined) {
    return createTier0();
  }

  return {
    id: "tier0",
    run() {
      return { kind: "veto", tier: "tier0", reason: vetoReason };
    }
  };
}

export const tier0: Tier = createTier0();
export const tier0Stub: Tier = tier0;

function formatReason(error: { readonly code: string; readonly context?: Readonly<Record<string, unknown>> }): string {
  const cooldownUntilEpochMillis = error.context?.cooldownUntilEpochMillis;
  const nowEpochMillis = error.context?.nowEpochMillis;
  if (
    error.code === "cooldown_active" &&
    typeof cooldownUntilEpochMillis === "number" &&
    typeof nowEpochMillis === "number"
  ) {
    return `${error.code}: cooldown until ${cooldownUntilEpochMillis}, now ${nowEpochMillis}`;
  }

  const dailyLoss = error.context?.dailyLoss;
  const dailyLossLimit = error.context?.dailyLossLimit;
  if (
    error.code === "daily_loss_limit_reached" &&
    typeof dailyLoss === "string" &&
    typeof dailyLossLimit === "string"
  ) {
    return `${error.code}: dailyLoss ${dailyLoss} reached limit ${dailyLossLimit}`;
  }

  const tradeCountToday = error.context?.tradeCountToday;
  const maxTradesPerDay = error.context?.maxTradesPerDay;
  if (
    error.code === "max_trades_reached" &&
    typeof tradeCountToday === "number" &&
    typeof maxTradesPerDay === "number"
  ) {
    return `${error.code}: tradeCountToday ${tradeCountToday} reached max ${maxTradesPerDay}`;
  }

  const pair = error.context?.pair;
  const windowEndsAt = error.context?.windowEndsAt;
  if (error.code === "news_blackout_active" && typeof pair === "string" && typeof windowEndsAt === "number") {
    const reason = error.context?.reason;
    return typeof reason === "string"
      ? `${error.code}: ${pair} blocked until ${windowEndsAt} (${reason})`
      : `${error.code}: ${pair} blocked until ${windowEndsAt}`;
  }

  const message = error.context?.message;
  return typeof message === "string" ? `${error.code}: ${message}` : error.code;
}

function formatDriftReason(status: LiveDriftStatus): string {
  return `live_drift_halt: liveExpectancy ${status.liveExpectancy} below baselineLower ${status.baselineLower} (${status.sampleCount} samples)`;
}
