type JsonRecord = Record<string, unknown>;

const TYPE_LABELS: Record<string, string> = {
  "suggestion-emitted": "📤 Suggestion",
  "suggestion-blocked": "🚫 Blocked",
  "trade-outcome": "💱 Outcome",
  "override-recorded": "🔓 Override",
};

interface AuditEventRowProps {
  readonly event: JsonRecord;
}

export function AuditEventRow({ event }: AuditEventRowProps) {
  const type = typeof event.type === "string" ? event.type : "unknown";
  const label = TYPE_LABELS[type] ?? type;
  const atEpoch = typeof event.at_epoch_millis === "number" ? event.at_epoch_millis : null;
  const payload = typeof event.payload === "object" && event.payload !== null
    ? (event.payload as JsonRecord)
    : null;

  return (
    <div
      className="rounded-lg p-4 mb-2 border-l-2"
      style={{
        background: "var(--color-surface-dim)",
        borderLeftColor: type === "suggestion-emitted" ? "var(--color-primary)"
          : type === "suggestion-blocked" ? "var(--color-caution)"
          : type === "override-recorded" ? "var(--color-caution)"
          : "var(--color-text-muted)",
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{label}</span>
        {atEpoch !== null && (
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {new Date(atEpoch).toLocaleString()}
          </span>
        )}
      </div>
      {payload !== null && (
        <div className="text-xs space-y-0.5" style={{ color: "var(--color-text-muted)" }}>
          {renderPayloadFields(type, payload)}
        </div>
      )}
    </div>
  );
}

function renderPayloadFields(type: string, p: JsonRecord) {
  switch (type) {
    case "suggestion-emitted":
      return (
        <>
          <p>Pair: {String(p.pair ?? "—")} · Direction: {String(p.direction ?? "—")}</p>
          {p.configVersion !== undefined && <p>Config v{String(p.configVersion)}</p>}
        </>
      );
    case "suggestion-blocked":
      return (
        <>
          <p>Vetoed by: {String(p.vetoedBy ?? "—")}</p>
          <p>Reason: {String(p.reason ?? "—")}</p>
        </>
      );
    case "override-recorded":
      return (
        <>
          <p>Rule: {String(p.ruleCode ?? "—")}</p>
          <p>Reason: {String(p.reason ?? "—")}</p>
        </>
      );
    case "trade-outcome":
      return (
        <>
          <p>Fill: {String(p.fillId ?? "—")}</p>
          {p.realizedPnl !== undefined && <p>PnL: {String(p.realizedPnl)}</p>}
          {p.result !== undefined && <p>Result: {String(p.result)}</p>}
        </>
      );
    default:
      return <p>{JSON.stringify(p).slice(0, 200)}</p>;
  }
}
