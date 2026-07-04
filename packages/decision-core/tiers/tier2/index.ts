import type { Tier } from "../../pipeline/runner.js";

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

export const tier2Stub: Tier = createTier2Stub();
