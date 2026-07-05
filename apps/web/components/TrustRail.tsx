interface TrustRailProps {
  readonly liveExpectancy: string;
  readonly sampleCount: number;
  readonly drifting: boolean;
  readonly baseline?: { lower: string; median: string; upper: string } | null;
}

export function TrustRail({ liveExpectancy, sampleCount, drifting, baseline }: TrustRailProps) {
  const inBand = baseline !== null && baseline !== undefined && Number(liveExpectancy) >= Number(baseline.lower);
  const showBand = baseline !== null && baseline !== undefined;

  return (
    <section
      className="rounded-lg p-4 mb-4"
      style={{ background: "var(--color-surface-dim)", borderLeft: `3px solid ${drifting ? "var(--color-halt)" : "var(--color-primary)"}` }}
      aria-label="Live drift status"
    >
      <h2 className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--color-text-muted)" }}>
        Trust Rail
      </h2>

      <div className="flex flex-wrap gap-4 sm:gap-6">
        <div>
          <span className="text-xs block" style={{ color: "var(--color-text-muted)" }}>Live Expectancy</span>
          <span className={`font-mono text-lg font-medium data-num ${drifting ? "" : ""}`}
            style={{ color: drifting ? "var(--color-halt)" : "var(--color-text)" }}>
            {liveExpectancy}
          </span>
        </div>

        <div>
          <span className="text-xs block" style={{ color: "var(--color-text-muted)" }}>Samples</span>
          <span className="font-mono text-lg data-num" style={{ color: "var(--color-text)" }}>{sampleCount}</span>
        </div>

        {showBand && baseline !== null && baseline !== undefined && (
          <div>
            <span className="text-xs block" style={{ color: "var(--color-text-muted)" }}>Baseline CI</span>
            <span className="font-mono text-sm data-num" style={{ color: "var(--color-text-muted)" }}>
              [{baseline.lower} — {baseline.upper}]
            </span>
          </div>
        )}

        <div>
          <span className="text-xs block" style={{ color: "var(--color-text-muted)" }}>Band</span>
          {showBand ? (
            <span className="text-sm font-medium" style={{ color: inBand ? "var(--color-primary)" : "var(--color-caution)" }}>
              {inBand ? "In band" : "Below lower"}
            </span>
          ) : (
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>No baseline</span>
          )}
        </div>
      </div>
    </section>
  );
}
