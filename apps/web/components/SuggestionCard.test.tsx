import { describe, expect, it } from "vitest";
import { isSuggestionFresh, isSystemAlive } from "../lib/queries";

describe("isSuggestionFresh", () => {
  it("returns true when within max age", () => {
    expect(isSuggestionFresh(1_700_000_000_000, 1_700_000_100_000, 300_000)).toBe(true);
  });

  it("returns false when older than max age", () => {
    expect(isSuggestionFresh(1_700_000_000_000, 1_700_000_500_000, 300_000)).toBe(false);
  });

  it("returns true at exact boundary", () => {
    expect(isSuggestionFresh(1_700_000_000_000, 1_700_000_300_000, 300_000)).toBe(true);
  });
});

describe("isSystemAlive", () => {
  it("returns true when heartbeat is recent", () => {
    expect(isSystemAlive(1_700_000_000_000, 1_700_000_100_000, 300_000)).toBe(true);
  });

  it("returns false when heartbeat is stale", () => {
    expect(isSystemAlive(1_700_000_000_000, 1_700_000_500_000, 300_000)).toBe(false);
  });

  it("returns false when heartbeat is null", () => {
    expect(isSystemAlive(null, 1_700_000_000_000)).toBe(false);
  });

  it("returns false when heartbeat is undefined", () => {
    expect(isSystemAlive(undefined, 1_700_000_000_000)).toBe(false);
  });
});
