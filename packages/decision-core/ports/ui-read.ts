import type { BehavioralState, Result, Suggestion } from "../types/index.js";

export interface UiReadPort {
  readonly listRecentSuggestions: (limit: number) => Promise<Result<readonly Suggestion[]>>;
  readonly readCurrentState: () => Promise<Result<BehavioralState>>;
}
