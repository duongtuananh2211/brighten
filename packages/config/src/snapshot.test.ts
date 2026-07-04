import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, snapshot } from "./index.js";
import type { ConfigSnapshot, ConfigVersion } from "./index.js";

describe("config snapshots", () => {
  it("returns a self-contained deeply frozen snapshot", () => {
    const version: ConfigVersion = {
      version: 1,
      params: {
        ...DEFAULT_PARAMS,
        news_blackout: [
          {
            startsAt: 1_700_000_000_000,
            endsAt: 1_700_000_060_000,
            reason: "NFP"
          }
        ]
      },
      createdAt: 1_700_000_000_000
    };

    const configSnapshot: ConfigSnapshot = snapshot(version);

    expect(configSnapshot.version).toBe(1);
    expect(configSnapshot.params).toEqual(version.params);
    expect(Object.isFrozen(configSnapshot)).toBe(true);
    expect(Object.isFrozen(configSnapshot.params)).toBe(true);
    expect(Object.isFrozen(configSnapshot.params.news_blackout)).toBe(true);
    expect(Object.isFrozen(configSnapshot.params.news_blackout[0])).toBe(true);
    const mutableNewsBlackout = configSnapshot.params.news_blackout as unknown as Array<{
      reason: string;
    }>;
    const firstWindow = mutableNewsBlackout[0];
    if (firstWindow === undefined) {
      throw new Error("Expected snapshot fixture to include one blackout window");
    }

    expect(() => {
      firstWindow.reason = "FOMC";
    }).toThrow(TypeError);
  });
});
