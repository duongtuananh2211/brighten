type JsonRecord = Record<string, unknown>;

interface OverrideHistoryProps {
  readonly grants: readonly JsonRecord[];
}

export function OverrideHistory({ grants }: OverrideHistoryProps) {
  if (grants.length === 0) {
    return (
      <section className="rounded-lg p-6 text-center" style={{ background: "var(--color-surface-dim)" }}>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No overrides recorded yet</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--color-text-muted)" }}>
        Override History
      </h2>
      <div className="space-y-2">
        {grants.map((g, i) => {
          const ruleCode = typeof g.rule_code === "string" ? g.rule_code : "—";
          const reason = typeof g.reason === "string" ? g.reason : "—";
          const requestedAt = typeof g.requested_at_epoch_millis === "number" ? g.requested_at_epoch_millis : null;
          const expiresAt = typeof g.expires_at_epoch_millis === "number" ? g.expires_at_epoch_millis : null;

          return (
            <div key={i} className="rounded-md p-3 flex items-center justify-between"
              style={{ background: "var(--color-surface)" }}>
              <div>
                <span className="text-sm font-mono" style={{ color: "var(--color-text)" }}>{ruleCode}</span>
                <span className="text-xs ml-3" style={{ color: "var(--color-text-muted)" }}>{reason}</span>
              </div>
              <div className="text-xs text-right" style={{ color: "var(--color-text-muted)" }}>
                {requestedAt !== null && <div>{new Date(requestedAt).toLocaleString()}</div>}
                {expiresAt !== null && <div>until {new Date(expiresAt).toLocaleString()}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
