interface SilenceStateProps {
  readonly alive: boolean;
}

export function SilenceState({ alive }: SilenceStateProps) {
  return (
    <section
      className="rounded-xl p-8 text-center space-y-3"
      style={{ background: "var(--color-surface-dim)" }}
      aria-label="System status"
      role="status"
    >
      {alive ? (
        <>
          <div
            className="inline-flex items-center gap-2 text-sm font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: "var(--color-caution)" }}
            />
            Waiting — no edge right now
          </div>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            The engine is running but tier1/tier2 found no actionable setup.
            This is normal — the system stays quiet when there&apos;s nothing.
          </p>
        </>
      ) : (
        <>
          <div
            className="inline-flex items-center gap-2 text-sm font-medium"
            style={{ color: "var(--color-halt)" }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: "var(--color-halt)" }}
            />
            Status unclear — data connection lost
          </div>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            No recent heartbeat from the engine. The cron-runner may be down
            or the database connection may be interrupted. Check your Supabase
            deployment.
          </p>
        </>
      )}
    </section>
  );
}
