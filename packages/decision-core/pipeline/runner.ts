import type { ConfigSnapshot } from "@brighten/config";
import type { ClockPort } from "../ports/index.js";
import type {
  AccountState,
  BehavioralState,
  CostEstimate,
  MarketSnapshot,
  Suggestion,
  TradeCandidate
} from "../types/index.js";

export type TierId = "tier0" | "tier1" | "tier2" | "tier3";

export type TierOutcome =
  | { readonly kind: "pass" }
  | { readonly kind: "veto"; readonly tier: TierId; readonly reason: string };

export interface TierContext {
  readonly input: MarketSnapshot;
  readonly state: BehavioralState;
  readonly config: ConfigSnapshot;
  // Optional until tier2 emits candidates and account equity is fed from persistence/adapters.
  readonly candidate?: TradeCandidate;
  readonly account?: AccountState;
  // Optional until tier1 emits expected edge; decimal-string in quote units.
  readonly expectedEdge?: string;
  // Optional until the Story 1.8 fee model/adapter provides round-trip cost estimates.
  readonly cost?: CostEstimate;
  readonly nowEpochMillis: number;
}

export interface Tier {
  readonly id: TierId;
  readonly run: (ctx: TierContext) => TierOutcome;
}

export interface PipelineResult {
  readonly outcome: "suggestion" | "silent";
  readonly vetoedBy?: TierId;
  readonly reason?: string;
  readonly suggestion?: Suggestion;
}

export type PipelineBaseContext = Omit<TierContext, "nowEpochMillis">;

export function runPipeline(
  tiers: readonly Tier[],
  base: PipelineBaseContext,
  clock: ClockPort
): PipelineResult {
  const nowEpochMillis = clock.nowEpochMillis();
  const ctx: TierContext = {
    ...base,
    nowEpochMillis
  };

  for (const tier of tiers) {
    const outcome = tier.run(ctx);
    if (outcome.kind === "veto") {
      return {
        outcome: "silent",
        vetoedBy: outcome.tier,
        reason: outcome.reason
      };
    }
  }

  return {
    outcome: "suggestion",
    suggestion: {
      kind: "stub",
      atEpochMillis: nowEpochMillis
    }
  };
}
