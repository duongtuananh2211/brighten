import type { Tier } from "../../pipeline/runner.js";
import { sizeTrade } from "./sizing.js";
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

      const result = sizeTrade({
        equity: ctx.account.equity,
        candidate: ctx.candidate,
        riskPct: ctx.config.params.risk_pct,
        minRr: ctx.config.params.min_rr
      });

      return result.ok
        ? { kind: "pass" }
        : { kind: "veto", tier: "tier3", reason: formatReason(result.error) };
    }
  };
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

  const message = error.context?.message;
  return typeof message === "string" ? `${error.code}: ${message}` : error.code;
}
