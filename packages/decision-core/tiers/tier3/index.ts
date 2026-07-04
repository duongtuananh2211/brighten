import type { Tier } from "../../pipeline/runner.js";

export interface Tier3StubOptions {
  readonly vetoReason?: string;
}

export function createTier3Stub(options: Tier3StubOptions = {}): Tier {
  return {
    id: "tier3",
    run() {
      return options.vetoReason === undefined
        ? { kind: "pass" }
        : { kind: "veto", tier: "tier3", reason: options.vetoReason };
    }
  };
}

export const tier3Stub: Tier = createTier3Stub();
