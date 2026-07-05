interface HaltBannerProps {
  readonly reason?: string;
  readonly kind?: "drift" | "cooldown" | "daily_loss" | "max_trades" | "news" | "unknown";
  readonly activeOverrides?: readonly { ruleCode: string; expiresAt: number }[];
}

export function HaltBanner({ reason, kind, activeOverrides }: HaltBannerProps) {
  const firstPerson = kind === "drift"
    ? "I don't trust myself right now — the live edge has dropped below its backtest baseline."
    : kind === "daily_loss"
    ? "Daily loss limit reached — I'm protecting you from revenge trading."
    : kind === "cooldown"
    ? "Cooldown active after a loss — take a breath before the next trade."
    : kind === "max_trades"
    ? "Max trades for today reached — discipline means stopping when you said you would."
    : "Engine halted — trading is paused for your protection.";

  return (
    <div
      className="rounded-lg p-4 mb-4"
      style={{
        background: kind === "drift" ? "rgba(220,38,38,0.08)" : "rgba(217,119,6,0.08)",
        borderLeft: `3px solid ${kind === "drift" ? "var(--color-halt)" : "var(--color-caution)"}`,
      }}
      role="alert"
      aria-live="assertive"
    >
      <p className="text-sm font-medium mb-1" style={{ color: kind === "drift" ? "var(--color-halt)" : "var(--color-caution)" }}>
        {firstPerson}
      </p>
      {reason !== undefined && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {reason}
        </p>
      )}
      {activeOverrides !== undefined && activeOverrides.length > 0 && (
        <p className="text-xs mt-2" style={{ color: "var(--color-caution)" }}>
          Active override: {activeOverrides.map(o => `${o.ruleCode} until ${new Date(o.expiresAt).toLocaleTimeString()}`).join(", ")}
        </p>
      )}
    </div>
  );
}
