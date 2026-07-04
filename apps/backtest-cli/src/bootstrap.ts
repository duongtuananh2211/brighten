import { add, cmp, div, toDecimalString } from "@brighten/decision-core/math";
import type { CoreError } from "@brighten/decision-core";

import { mulberry32 } from "./prng.js";
import type { ExpectancyCI } from "./types.js";

export type BootstrapOutcome =
  | { readonly ok: true; readonly value: ExpectancyCI }
  | { readonly ok: false; readonly error: CoreError };

export interface BootstrapOptions {
  readonly resamples: number;
  readonly seed: number;
  readonly lowerPercentile?: string;
  readonly upperPercentile?: string;
}

export function bootstrapExpectancyCI(
  netRs: readonly string[],
  opts: BootstrapOptions
): BootstrapOutcome {
  if (netRs.length === 0) {
    return reject("empty_net_r", { tradeCount: 0 });
  }
  if (!Number.isInteger(opts.resamples) || opts.resamples <= 0) {
    return reject("invalid_resamples", { resamples: opts.resamples });
  }

  const rng = mulberry32(opts.seed);
  const expectancies: string[] = [];
  const fallback = netRs[0];
  if (fallback === undefined) {
    return reject("empty_net_r", { tradeCount: 0 });
  }

  for (let sampleIndex = 0; sampleIndex < opts.resamples; sampleIndex += 1) {
    let sum = "0";
    for (let itemIndex = 0; itemIndex < netRs.length; itemIndex += 1) {
      const selected = netRs[Math.floor(rng() * netRs.length)] ?? fallback;
      sum = add(sum, selected);
    }
    expectancies.push(toDecimalString(div(sum, String(netRs.length))));
  }

  expectancies.sort((left, right) => cmp(left, right));

  return {
    ok: true,
    value: {
      lower: percentile(expectancies, opts.lowerPercentile ?? "0.05"),
      median: percentile(expectancies, "0.5"),
      upper: percentile(expectancies, opts.upperPercentile ?? "0.95"),
      resamples: opts.resamples,
      seed: opts.seed
    }
  };
}

function percentile(sorted: readonly string[], percentileRatio: string): string {
  const index = Math.floor(Number(percentileRatio) * (sorted.length - 1));
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] ?? "0";
}

function reject(code: string, context: Readonly<Record<string, unknown>>): BootstrapOutcome {
  return {
    ok: false,
    error: { code, source: "validation.bootstrap", context }
  };
}
