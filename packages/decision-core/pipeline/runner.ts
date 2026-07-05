import type { ConfigSnapshot } from "@brighten/config";
import type { ClockPort } from "../ports/index.js";
import type { LiveDriftStatus } from "../tiers/tier0/live-drift.js";
import type { OverrideGrant } from "../tiers/tier0/override.js";
import type { SizingResult } from "../tiers/tier3/sizing.js";
import type {
  AccountState,
  BehavioralState,
  CostEstimate,
  MarketSnapshot,
  Suggestion,
  TradeCandidate,
  TradeDirection
} from "../types/index.js";

export type TierId = "tier0" | "tier1" | "tier2" | "tier3";

export interface TierPassEnrichment {
  readonly direction?: TradeDirection;
  readonly candidate?: TradeCandidate;
  readonly sizing?: SizingResult;
  /** Tier-specific signals that triggered this pass (4.3 grounding). */
  readonly signals?: Record<string, unknown>;
}

export type TierOutcome =
  | { readonly kind: "pass"; readonly enrich?: TierPassEnrichment }
  | { readonly kind: "veto"; readonly tier: TierId; readonly reason: string };

export interface TierContext {
  readonly input: MarketSnapshot;
  readonly state: BehavioralState;
  readonly config: ConfigSnapshot;
  readonly direction?: TradeDirection;
  // Optional until tier2 emits candidates and account equity is fed from persistence/adapters.
  readonly candidate?: TradeCandidate;
  readonly account?: AccountState;
  readonly sizing?: SizingResult;
  // Optional until tier1 emits expected edge; decimal-string in quote units.
  readonly expectedEdge?: string;
  // Optional until the Story 1.8 fee model/adapter provides round-trip cost estimates.
  readonly cost?: CostEstimate;
  /** Live drift status computed by driver (3.5). Tier0 reads for auto-halt. */
  readonly liveDrift?: LiveDriftStatus;
  /** Active override grants (3.6). Tier0 skips veto rules matching an active grant. */
  readonly overrideGrants?: readonly OverrideGrant[];
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
  readonly direction?: TradeDirection;
  readonly candidate?: TradeCandidate;
  readonly sizing?: SizingResult;
  /** Aggregated tier signals when outcome is "suggestion" (4.3 grounding). */
  readonly signals?: Record<string, unknown>;
}

export type PipelineBaseContext = Omit<TierContext, "nowEpochMillis">;

export function runPipeline(
  tiers: readonly Tier[],
  base: PipelineBaseContext,
  clock: ClockPort
): PipelineResult {
  const nowEpochMillis = clock.nowEpochMillis();
  let ctx: TierContext = {
    ...base,
    nowEpochMillis
  };
  const accumulatedSignals: Record<string, unknown> = {};

  for (const tier of tiers) {
    const outcome = tier.run(ctx);
    if (outcome.kind === "veto") {
      return {
        outcome: "silent",
        vetoedBy: outcome.tier,
        reason: outcome.reason
      };
    }

    if (outcome.enrich !== undefined) {
      ctx = {
        ...ctx,
        ...outcome.enrich
      };
      // Aggregate tier signals for grounding (4.3)
      if (outcome.enrich.signals !== undefined) {
        Object.assign(accumulatedSignals, outcome.enrich.signals);
      }
    }
  }

  return {
    outcome: "suggestion",
    ...(ctx.direction !== undefined ? { direction: ctx.direction } : {}),
    ...(ctx.candidate !== undefined ? { candidate: ctx.candidate } : {}),
    ...(ctx.sizing !== undefined ? { sizing: ctx.sizing } : {}),
    ...(Object.keys(accumulatedSignals).length > 0 ? { signals: accumulatedSignals } : {}),
  };
}
