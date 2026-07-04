import type { ConfigSnapshot } from "@brighten/config";
import type { BehavioralState, MarketSnapshot, Narration, Result, Suggestion } from "../types/index.js";

export interface NarrationRequest {
  readonly input: MarketSnapshot;
  readonly state: BehavioralState;
  readonly config: ConfigSnapshot;
  readonly suggestion: Suggestion;
}

export interface NarratorPort {
  readonly narrate: (request: NarrationRequest) => Promise<Result<Narration>>;
}
