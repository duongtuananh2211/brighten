import type { ConfigSnapshot } from "@brighten/config";
import type { AuditEvent, BehavioralState, Result, Suggestion } from "../types/index.js";

export interface PersistencePort {
  readonly readBehavioralState: () => Promise<Result<BehavioralState>>;
  readonly readConfigSnapshot: (version?: number) => Promise<Result<ConfigSnapshot>>;
  readonly appendAuditEvent: (event: AuditEvent) => Promise<Result<void>>;
  readonly saveSuggestion: (suggestion: Suggestion) => Promise<Result<void>>;
}
