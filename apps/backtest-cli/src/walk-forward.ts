import type { MarketSnapshot } from "@brighten/decision-core";
import { add, cmp, mul } from "@brighten/decision-core/math";

import type { IndexRange, WalkForwardSpec, WalkForwardSplitOutcome } from "./types.js";

export function splitWalkForward(
  snapshot: MarketSnapshot,
  spec: WalkForwardSpec
): WalkForwardSplitOutcome {
  const invalidSpec = validateSpec(snapshot.klines.length, spec);
  if (invalidSpec !== undefined) {
    return invalidSpec;
  }

  const total = snapshot.klines.length;
  const holdoutLen = Math.floor(Number(mul(spec.holdoutRatio, String(total))));
  const workLen = total - holdoutLen;
  const foldLen = Math.floor(workLen / spec.folds);
  const inLen = Math.floor(Number(mul(String(foldLen), spec.inSampleRatio)));

  if (holdoutLen < 1 || foldLen < 1 || inLen < 1 || foldLen - inLen < 1) {
    return reject("insufficient_klines", {
      klineCount: total,
      folds: spec.folds,
      holdoutLen,
      foldLen,
      inLen
    });
  }

  const folds = Array.from({ length: spec.folds }, (_, index) => {
    const foldFrom = index * foldLen;
    const inSample: IndexRange = { fromIndex: foldFrom, toIndex: foldFrom + inLen };
    const outOfSample: IndexRange = { fromIndex: foldFrom + inLen, toIndex: foldFrom + foldLen };
    return { inSample, outOfSample };
  });

  return {
    ok: true,
    holdout: { fromIndex: total - holdoutLen, toIndex: total },
    folds
  };
}

function validateSpec(total: number, spec: WalkForwardSpec): WalkForwardSplitOutcome | undefined {
  if (!Number.isInteger(spec.folds) || spec.folds <= 0) {
    return reject("invalid_folds", { folds: spec.folds });
  }
  if (!isRatio(spec.inSampleRatio)) {
    return reject("invalid_in_sample_ratio", { inSampleRatio: spec.inSampleRatio });
  }
  if (!isRatio(spec.holdoutRatio)) {
    return reject("invalid_holdout_ratio", { holdoutRatio: spec.holdoutRatio });
  }
  if (cmp(add(spec.inSampleRatio, spec.holdoutRatio), "1") >= 0) {
    return reject("invalid_ratio_sum", {
      inSampleRatio: spec.inSampleRatio,
      holdoutRatio: spec.holdoutRatio
    });
  }
  if (total < 3) {
    return reject("insufficient_klines", { klineCount: total });
  }

  return undefined;
}

function isRatio(value: string): boolean {
  return typeof value === "string" && cmp(value, "0") > 0 && cmp(value, "1") < 0;
}

function reject(code: string, context: Readonly<Record<string, unknown>>): WalkForwardSplitOutcome {
  return {
    ok: false,
    error: {
      code,
      source: "validation.walk_forward",
      context
    }
  };
}
