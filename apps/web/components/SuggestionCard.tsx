import type { Suggestion } from "@brighten/decision-core";

interface SuggestionCardProps {
  readonly suggestion: Suggestion;
  readonly narration?: string | undefined;
  readonly winStreak?: number | undefined;
  readonly winStreakThreshold?: number | undefined;
}

export function SuggestionCard({
  suggestion,
  narration,
  winStreak,
  winStreakThreshold = 3,
}: SuggestionCardProps) {
  const s = suggestion;
  const sizing = s.sizing;
  const candidate = s.candidate;

  return (
    <section
      className="rounded-xl p-6 space-y-4"
      style={{ background: "var(--color-surface-dim)" }}
      aria-label="Trade suggestion"
      role="region"
    >
      {/* Direction + Pair */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="text-sm font-medium px-3 py-1 rounded-full"
            style={{
              background: s.direction === "short" ? "var(--color-caution)" : "var(--color-primary)",
              color: "#fff",
            }}
            aria-label={`Direction: ${s.direction}`}
          >
            {s.direction.toUpperCase()}
          </span>
          <span className="font-mono text-lg font-medium data-num" style={{ color: "var(--color-text)" }}>
            {s.pair}
          </span>
        </div>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {s.timeframe}
        </span>
      </div>

      {/* Win-streak caution banner (anti-dopamine) */}
      {winStreak !== undefined && winStreak >= winStreakThreshold && (
        <div
          className="rounded-md px-4 py-2 text-sm font-medium"
          style={{ background: "rgba(217,119,6,0.1)", color: "var(--color-caution)", borderLeft: "3px solid var(--color-caution)" }}
          role="alert"
        >
          On a {winStreak}-win streak — stay cautious, don&apos;t give it back
        </div>
      )}

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Metric label="Entry" value={candidate.entry} />
        <Metric label="Stop" value={candidate.stop} />
        <Metric label="Target" value={candidate.target} />
        <Metric label="Volume" value={sizing.volume} />
        <Metric label="Risk Amount" value={`$${sizing.riskAmount}`} />
        <Metric label="R:R" value={sizing.rr} />
      </div>

      {/* Meta row */}
      <div className="text-xs space-y-1" style={{ color: "var(--color-text-muted)" }}>
        <p>
          Config v{s.configVersion} &middot;{" "}
          {new Date(s.atEpochMillis).toLocaleString()}
        </p>
      </div>

      {/* Reason section */}
      <div className="rounded-lg p-4" style={{ background: "var(--color-surface)" }}>
        <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>
          Why
        </h3>

        {/* Structural reason (always available from payload) */}
        <ul className="text-sm space-y-1 list-disc list-inside" style={{ color: "var(--color-text)" }}>
          <li>
            Direction {s.direction.toUpperCase()} from tier1 regime assessment
          </li>
          <li>
            Entry zone {candidate.entry} with stop at {candidate.stop} from tier2
          </li>
          <li>
            R:R {sizing.rr} meets min_rr threshold — passed tier3 cost hurdle
          </li>
        </ul>

        {/* Narration slot (4.3; fallback when absent) */}
        {narration !== undefined && narration.length > 0 ? (
          <p className="mt-3 text-sm italic" style={{ color: "var(--color-text)" }}>
            {narration}
          </p>
        ) : (
          <p className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Interpretation pending — LLM narrator offline or not yet run (4.3)
          </p>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      <span
        className="font-mono text-sm data-num font-medium"
        style={{ color: "var(--color-text)" }}
        aria-label={`${label}: ${value}`}
      >
        {value}
      </span>
    </div>
  );
}
