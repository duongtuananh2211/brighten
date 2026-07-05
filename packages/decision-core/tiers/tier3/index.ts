import type { Tier } from "../../pipeline/runner.js";
import { computeRoundTripCost } from "../../cost/round-trip.js";
import { abs, mul, sub } from "../../math/decimal.js";
import { evaluateWinStreakDampening } from "../tier0/index.js";
import { evaluateCostHurdle } from "./cost-hurdle.js";
import { sizeTrade } from "./sizing.js";
export { evaluateCostHurdle } from "./cost-hurdle.js";
export { evaluateOvertrade } from "./overtrade.js";
export { sizeTrade } from "./sizing.js";
export type {
  CostHurdleInput,
  CostHurdleOutcome,
  CostHurdlePass,
  CostHurdleRejection
} from "./cost-hurdle.js";
export type {
  OvertradeAssessment,
  OvertradeInput,
  OvertradeOutcome,
  OvertradeRejection
} from "./overtrade.js";
export type { SizingInput, SizingOutcome, SizingRejection, SizingResult } from "./sizing.js";

export interface Tier3StubOptions {
  readonly vetoReason?: string;
}

export function createTier3(): Tier {
  return {
    id: "tier3",
    run(ctx) {
      if (ctx.candidate === undefined || ctx.account === undefined) {
        return { kind: "pass" };
      }

      const winStreak = evaluateWinStreakDampening({
        winStreak: ctx.state.winStreak,
        threshold: ctx.config.params.win_streak_threshold,
        sizeDampening: ctx.config.params.size_dampening,
        riskPct: ctx.config.params.risk_pct
      });
      if (!winStreak.ok) {
        return { kind: "veto", tier: "tier3", reason: formatReason(winStreak.error) };
      }

      const result = sizeTrade({
        equity: ctx.account.equity,
        candidate: ctx.candidate,
        riskPct: winStreak.effectiveRiskPct,
        minRr: ctx.config.params.min_rr
      });

      if (!result.ok) {
        return { kind: "veto", tier: "tier3", reason: formatReason(result.error) };
      }

      const costHurdleInput =
        ctx.expectedEdge !== undefined && ctx.cost !== undefined
          ? {
              ok: true as const,
              expectedEdge: ctx.expectedEdge,
              roundTripFee: ctx.cost.roundTripFee
            }
          : deriveCostHurdleInput(result, ctx.config.params);

      if (!costHurdleInput.ok) {
        return { kind: "veto", tier: "tier3", reason: formatReason(costHurdleInput.error) };
      }

      const costHurdle = evaluateCostHurdle({
        expectedEdge: costHurdleInput.expectedEdge,
        roundTripFee: costHurdleInput.roundTripFee,
        costHurdleX: ctx.config.params.cost_hurdle_x
      });

      return costHurdle.ok
        ? { kind: "pass", enrich: { sizing: result } }
        : { kind: "veto", tier: "tier3", reason: formatReason(costHurdle.error) };
    }
  };
}

type CostParams = {
  readonly fee_rate: string;
  readonly spread: string;
  readonly slippage: string;
};

type DerivedCostHurdleInput =
  | { readonly ok: true; readonly expectedEdge: string; readonly roundTripFee: string }
  | { readonly ok: false; readonly error: { readonly code: string; readonly context?: Readonly<Record<string, unknown>> } };

function deriveCostHurdleInput(
  sizing: {
    readonly entry: string;
    readonly target: string;
    readonly volume: string;
  },
  params: CostParams
): DerivedCostHurdleInput {
  const expectedEdge = mul(abs(sub(sizing.target, sizing.entry)), sizing.volume);
  const cost = computeRoundTripCost({
    notional: mul(sizing.volume, sizing.entry),
    feeRate: params.fee_rate,
    spread: params.spread,
    slippage: params.slippage
  });

  if (!cost.ok) {
    return cost;
  }

  return { ok: true, expectedEdge, roundTripFee: cost.cost };
}

export function createTier3Stub(options: Tier3StubOptions = {}): Tier {
  const vetoReason = options.vetoReason;
  if (vetoReason === undefined) {
    return createTier3();
  }

  return {
    id: "tier3",
    run() {
      return { kind: "veto", tier: "tier3", reason: vetoReason };
    }
  };
}

export const tier3: Tier = createTier3();
export const tier3Stub: Tier = tier3;

function formatReason(error: { readonly code: string; readonly context?: Readonly<Record<string, unknown>> }): string {
  const rr = error.context?.rr;
  const minRr = error.context?.minRr;
  if (typeof rr === "string" && typeof minRr === "string") {
    return `${error.code}: rr ${rr} is below min_rr ${minRr}`;
  }

  const expectedEdge = error.context?.expectedEdge;
  const hurdle = error.context?.hurdle;
  const roundTripFee = error.context?.roundTripFee;
  const costHurdleX = error.context?.costHurdleX;
  if (
    error.code === "cost_hurdle_not_met" &&
    typeof expectedEdge === "string" &&
    typeof hurdle === "string" &&
    typeof roundTripFee === "string" &&
    typeof costHurdleX === "string"
  ) {
    return `${error.code}: expectedEdge ${expectedEdge} is below hurdle ${hurdle} (roundTripFee ${roundTripFee}, cost_hurdle_x ${costHurdleX})`;
  }

  const message = error.context?.message;
  return typeof message === "string" ? `${error.code}: ${message}` : error.code;
}
