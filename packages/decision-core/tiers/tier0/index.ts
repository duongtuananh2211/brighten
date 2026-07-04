import type { Tier } from "../../pipeline/runner.js";

export interface Tier0StubOptions {
  readonly vetoReason?: string;
}

export function createTier0Stub(options: Tier0StubOptions = {}): Tier {
  return {
    id: "tier0",
    run() {
      return options.vetoReason === undefined
        ? { kind: "pass" }
        : { kind: "veto", tier: "tier0", reason: options.vetoReason };
    }
  };
}

export const tier0Stub: Tier = createTier0Stub();
