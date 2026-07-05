import type { Tier } from "../../pipeline/runner.js";
import { evaluateCryptoRegime } from "./crypto-regime.js";
import { evaluateFxRegime } from "./fx-regime.js";
export { accumulateCvd } from "./cvd.js";
export { evaluateCryptoRegime } from "./crypto-regime.js";
export { evaluateFxRegime } from "./fx-regime.js";
export type { CvdOutcome, CvdRejection, CvdResult } from "./cvd.js";
export type {
  CryptoRegimeInput,
  CryptoRegimeOutcome,
  CryptoRegimePass,
  CryptoRegimeRejection,
  CryptoRegimeSignals,
  CryptoRegimeVote
} from "./crypto-regime.js";
export type {
  FxRegimeInput,
  FxRegimeOutcome,
  FxRegimePass,
  FxRegimeRejection,
  FxRegimeSignals,
  FxSweepSide
} from "./fx-regime.js";

export type Tier1AssetClass = "crypto" | "fx";

export interface Tier1StubOptions {
  readonly vetoReason?: string;
}

export function createTier1Stub(options: Tier1StubOptions = {}): Tier {
  return {
    id: "tier1",
    run() {
      return options.vetoReason === undefined
        ? { kind: "pass" }
        : { kind: "veto", tier: "tier1", reason: options.vetoReason };
    }
  };
}

export function createTier1Crypto(): Tier {
  return {
    id: "tier1",
    run(ctx) {
      const outcome = evaluateCryptoRegime({
        snapshot: ctx.input,
        params: ctx.config.params
      });

      return outcome.ok
        ? { kind: "pass", enrich: { direction: outcome.direction } }
        : { kind: "veto", tier: "tier1", reason: formatReason(outcome.error) };
    }
  };
}

export function createTier1Fx(): Tier {
  return {
    id: "tier1",
    run(ctx) {
      const outcome = evaluateFxRegime({
        snapshot: ctx.input,
        params: ctx.config.params
      });

      return outcome.ok
        ? { kind: "pass", enrich: { direction: outcome.direction } }
        : { kind: "veto", tier: "tier1", reason: formatReasonFx(outcome.error) };
    }
  };
}

export function createTier1(assetClass: Tier1AssetClass): Tier {
  return assetClass === "crypto" ? createTier1Crypto() : createTier1Fx();
}

export const tier1Stub: Tier = createTier1Stub();

function formatReason(error: { readonly code: string; readonly source: string; readonly context?: Readonly<Record<string, unknown>> }): string {
  const field = error.context?.field;
  if (
    (error.code === "invalid_decimal_string" || error.code === "invalid_tier1_param") &&
    typeof field === "string"
  ) {
    const message = error.context?.message;
    return typeof message === "string" ? `${error.code}: ${field} - ${message}` : `${error.code}: ${field}`;
  }

  const minDataPoints = error.context?.minDataPoints;
  if (error.code === "insufficient_data" && typeof minDataPoints === "number") {
    return `${error.code}: requires at least ${minDataPoints} points for each tier1 crypto source`;
  }

  const fundingVote = error.context?.fundingVote;
  const longShortVote = error.context?.longShortVote;
  const cvdVote = error.context?.cvdVote;
  if (
    error.code === "conflicting_signals" &&
    typeof fundingVote === "string" &&
    typeof longShortVote === "string" &&
    typeof cvdVote === "string"
  ) {
    return `${error.code}: funding ${fundingVote}, longShort ${longShortVote}, cvd ${cvdVote}`;
  }

  const oiDeltaRatio = error.context?.oiDeltaRatio;
  const oiConfirmationMin = error.context?.oiConfirmationMin;
  if (error.code === "oi_unconfirmed" && typeof oiDeltaRatio === "string" && typeof oiConfirmationMin === "string") {
    return `${error.code}: oiDeltaRatio ${oiDeltaRatio} is below oi_confirmation_min ${oiConfirmationMin}`;
  }

  const message = error.context?.message;
  return typeof message === "string" ? `${error.code}: ${message}` : error.code;
}

function formatReasonFx(error: { readonly code: string; readonly source: string; readonly context?: Readonly<Record<string, unknown>> }): string {
  const field = error.context?.field;
  if (
    (error.code === "invalid_decimal_string" || error.code === "invalid_tier1_param") &&
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

  const highPenetration = error.context?.highPenetration;
  const lowPenetration = error.context?.lowPenetration;
  if (
    error.code === "conflicting_signals" &&
    typeof highPenetration === "string" &&
    typeof lowPenetration === "string"
  ) {
    return `${error.code}: highPenetration ${highPenetration}, lowPenetration ${lowPenetration}`;
  }

  if (
    error.code === "no_liquidity_sweep" &&
    typeof highPenetration === "string" &&
    typeof lowPenetration === "string"
  ) {
    return `${error.code}: highPenetration ${highPenetration}, lowPenetration ${lowPenetration}`;
  }

  const message = error.context?.message;
  return typeof message === "string" ? `${error.code}: ${message}` : error.code;
}
