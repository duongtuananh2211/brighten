import type { Tier } from "../../pipeline/runner.js";
import { evaluateEntryZone } from "./entry-zone.js";
export { evaluateEntryZone } from "./entry-zone.js";
export type {
  EntryZoneInput,
  EntryZoneOutcome,
  EntryZonePass,
  EntryZoneRejection,
  EntryZoneSignals
} from "./entry-zone.js";

export interface Tier2StubOptions {
  readonly vetoReason?: string;
}

export function createTier2Stub(options: Tier2StubOptions = {}): Tier {
  return {
    id: "tier2",
    run() {
      return options.vetoReason === undefined
        ? { kind: "pass" }
        : { kind: "veto", tier: "tier2", reason: options.vetoReason };
    }
  };
}

export function createTier2(): Tier {
  return {
    id: "tier2",
    run(ctx) {
      if (ctx.direction === undefined) {
        return { kind: "veto", tier: "tier2", reason: "missing_direction" };
      }

      const outcome = evaluateEntryZone({
        direction: ctx.direction,
        snapshot: ctx.input,
        params: ctx.config.params
      });

      return outcome.ok
        ? { kind: "pass", enrich: { candidate: outcome.candidate } }
        : { kind: "veto", tier: "tier2", reason: formatReason(outcome.error) };
    }
  };
}

export const tier2Stub: Tier = createTier2Stub();

function formatReason(error: { readonly code: string; readonly context?: Readonly<Record<string, unknown>> }): string {
  const field = error.context?.field;
  if (
    (error.code === "invalid_decimal_string" || error.code === "invalid_tier2_param") &&
    typeof field === "string"
  ) {
    const message = error.context?.message;
    return typeof message === "string" ? `${error.code}: ${field} - ${message}` : `${error.code}: ${field}`;
  }

  const requiredKlines = error.context?.requiredKlines;
  const klineCount = error.context?.klineCount;
  if (error.code === "insufficient_data" && typeof requiredKlines === "number" && typeof klineCount === "number") {
    return `${error.code}: requires ${requiredKlines} klines, got ${klineCount}`;
  }

  const lastClose = error.context?.lastClose;
  const target = error.context?.target;
  if (error.code === "no_setup" && typeof lastClose === "string" && typeof target === "string") {
    return `${error.code}: lastClose ${lastClose} has reached target ${target}`;
  }

  const message = error.context?.message;
  return typeof message === "string" ? `${error.code}: ${message}` : error.code;
}
