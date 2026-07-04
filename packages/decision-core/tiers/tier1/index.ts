import type { Tier } from "../../pipeline/runner.js";

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

export const tier1Stub: Tier = createTier1Stub();
